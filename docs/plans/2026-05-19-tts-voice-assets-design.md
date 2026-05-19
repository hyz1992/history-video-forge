# TTS / Voice Assets Design

Date: 2026-05-19

Status: design accepted, implementation plan created

## 1. Goal

Build a reusable voice system for the video pipeline:

- maintain a global shared voice library;
- match each video task to the most suitable local voice profile;
- create a local voice profile when no existing profile matches well enough;
- defer paid provider voice creation until the assets stage actually needs TTS;
- generate TTS chunk and merged narration artifacts from the resolved provider voice;
- keep subtitle generation downstream of TTS timing.

This design keeps DashScope image-to-video live calls paused. All video generation verification should continue to use local Remotion rendering unless the user explicitly approves a real provider check.

## 2. Source References

Current project references:

- `shared/src/asset-planning/asset-plan.schema.ts`
- `shared/src/assets/asset-manifest.schema.ts`
- `backend/src/modules/assets/providers/dashscope/dashscope-tts-provider.ts`
- `backend/src/modules/assets/providers/local-subtitle-provider.ts`
- `docs/plans/2026-05-16-real-assets-generation-and-media-library-design.md`
- `docs/records/2026-05-09-video-pipeline-engineering-notes.md`

Legacy project references, used as implementation experience only:

- `D:/myproject/story-video-forge/backend/src/services/voice-profiles.ts`
- `D:/myproject/story-video-forge/backend/src/services/voice-design.ts`
- `D:/myproject/story-video-forge/backend/src/services/tts.ts`
- `D:/myproject/story-video-forge/backend/prisma/schema.prisma`

The legacy project should not be copied wholesale. The new project should reuse the concepts, not the old stage objects, UI flow, or workflow state machine.

## 3. Non-Goals

This design does not implement:

- real provider calls in default tests;
- voice cloning from uploaded user samples;
- frontend voice preview or manual selection UI;
- final subtitle styling UI;
- BGM/SFX generation;
- real DashScope image-to-video live checks;
- changes to frozen topic/script semantics.

Provider endpoint, model, payload, and status details must be re-checked against official provider documentation before implementation.

## 4. Stage Ownership

### Asset Planning

Asset planning decides what kind of narration voice is needed. It may output a structured `voice_intent`, but it must not call TTS, create provider voices, or pick a provider-private voice id.

Asset planning can provide:

- content family, such as historical, power-struggle, suspense, explainer, comedy;
- narrator persona and delivery style;
- desired traits, such as steady, cold, crisp, authoritative, warm, eerie;
- avoid traits, such as oily, exaggerated broadcast voice, childlike, theatrical;
- pace and energy hints;
- TTS chunk plan.

### Assets

Assets owns the voice library, matching, provider voice creation, TTS generation, and subtitle source timing.

Assets must:

- resolve one local global `voice_profile_id` for the project/run;
- create a local voice profile when matching confidence is too low;
- create or refresh the provider voice only when TTS generation needs it;
- use one resolved provider voice for all TTS chunks in the same video;
- emit `tts_chunk_audio`, `tts_merged_audio`, and provider job records;
- let subtitle generation consume TTS artifact timing.

### Compose / Renderer

Compose and renderer consume audio and subtitle artifacts. They do not create voices, call TTS, or modify voice selection.

## 5. Global Voice Library

The voice library is global and shared across projects. A project stores only the selected or resolved `voice_profile_id`.

Recommended first-version fields:

| Field | Meaning |
| --- | --- |
| `voice_profile_id` | Stable local global voice id. |
| `kind` | `preset / generated / system`. |
| `name` | Human-readable name. |
| `description` | Short voice description for review and selection. |
| `design_prompt` | Detailed provider voice design prompt. |
| `preview_text` | Text used for provider preview audio. |
| `provider_name` | Example: `dashscope`. |
| `provider_voice_id` | Real provider voice id, nullable until created. |
| `provider_status` | `missing / creating / ready / failed / deleted`. |
| `target_model` | TTS model expected to use this voice. |
| `recommended_content_families` | Content families this voice fits. |
| `voice_traits` | Searchable traits, such as cold, steady, crisp. |
| `avoid_traits` | Styles this voice should not be used for. |
| `gender_tone` | Broad vocal tone, not biological identity. |
| `age_band` | Broad perceived age band. |
| `pitch` | Low, mid, high, or numeric scale. |
| `pace` | Slow, medium, fast, or numeric scale. |
| `energy` | Low to high delivery energy. |
| `authority` | Low to high authority. |
| `suspense` | Low to high suspense fit. |
| `warmth` | Low to high warmth. |
| `preview_audio_uri` | Optional local or provider preview audio. |
| `usage_count` | Selection counter for future ranking. |
| `last_used_at` | Last successful use. |
| `quality_score` | Manual or future review score, nullable initially. |
| `created_at / updated_at` | Audit timestamps. |

The first implementation can store this in the current in-memory `DbClient` repository plus schema parity tests; durable Prisma persistence is a separate persistence plan if the local repository pattern requires it.

## 6. Voice Intent

Voice intent is the matching input. It should be structured enough for deterministic matching, while still allowing future LLM-assisted creation of new voice profiles.

Recommended first-version shape:

```ts
interface VoiceIntent {
  content_family: string;
  narrator_persona: string;
  desired_traits: string[];
  avoid_traits: string[];
  gender_tone?: string | null;
  age_band?: string | null;
  pitch?: string | null;
  pace?: string | null;
  energy?: number | null;
  authority?: number | null;
  suspense?: number | null;
  warmth?: number | null;
  style_notes: string[];
}
```

Sources, in priority order:

1. explicit project or request override;
2. `AssetPlan.global_audio_strategy.voice_intent`;
3. topic/script delivery voice hints and narrator persona;
4. default historical-story intent.

Asset planning can be extended in a separate asset-planning task to output this object directly. Until then, assets can derive a conservative intent from existing `voice_hint`, `voice_tilt`, content family, and `tts_plan.voice_profile_id`.

## 7. Matching Strategy

Voice matching should be explainable and mostly deterministic.

Recommended first-version algorithm:

1. Filter out profiles with `provider_status=deleted` or incompatible `target_model`.
2. Score content family match.
3. Score desired trait overlap.
4. Penalize avoid trait overlap.
5. Score numeric closeness for pace, energy, authority, suspense, and warmth.
6. Prefer `provider_status=ready` when scores are close.
7. Prefer higher `quality_score`, then lower recent overuse, then stable preset order.

Output:

```ts
interface VoiceMatchResult {
  selected_voice_profile_id: string;
  match_score: number;
  match_decision: "matched_existing" | "created_local_profile" | "fallback_system";
  match_reasons: string[];
  rejected_profile_ids: Array<{
    voice_profile_id: string;
    reason: string;
  }>;
}
```

Suggested thresholds:

- `>= 0.75`: use existing voice profile.
- `0.55 - 0.74`: use existing ready voice only if no generated profile is allowed for this run.
- `< 0.55`: create a new local generated profile.

The exact thresholds should be implementation-plan test fixtures, not hidden constants buried in provider code.

## 8. Local Voice Creation

When no voice profile matches well enough, assets creates a local profile only. This is not a provider call.

The created profile must include:

- local `voice_profile_id`;
- generated `name`;
- `description`;
- `design_prompt`;
- structured matching fields;
- `provider_status=missing`;
- `provider_voice_id=null`;
- `target_model` for designed voice TTS.

The design prompt must describe stable voice identity, not per-segment acting. It should avoid asking the voice model to change emotion every sentence. Segment emotion belongs in text, pacing, and future TTS parameters, not in a constantly mutating voice identity.

## 9. Provider Voice Lifecycle

Provider voice creation is lazy and belongs to assets execution.

Before generating TTS:

1. Resolve local `voice_profile_id`.
2. Load voice profile.
3. If `kind=system` and `provider_voice_id` is already a built-in provider voice, use it directly.
4. If `provider_status=ready` and `provider_voice_id` exists, use it.
5. If `provider_status=creating`, query provider status and update the local profile.
6. If `provider_status=missing` or `failed`, call provider voice creation.
7. Wait or poll until ready within a bounded timeout.
8. If not ready, fail the TTS execution with a diagnosable voice error unless an explicit fallback policy allows system voice.

Provider job records should distinguish:

- voice creation job;
- TTS chunk generation job.

The voice profile record stores the reusable provider voice id. The TTS artifacts store the voice profile id and provider voice id used for that run.

## 10. DashScope Voice Design API Boundary

Official references checked on 2026-05-19:

- https://help.aliyun.com/zh/model-studio/voice-design-user-guide
- https://help.aliyun.com/zh/model-studio/voice-design-api-references

Legacy cross-check:

- `D:/myproject/story-video-forge/backend/src/services/voice-design.ts`

First implementation should target Qwen Voice Design unless a separate implementation plan explicitly adds CosyVoice:

- endpoint, China region: `POST https://dashscope.aliyuncs.com/api/v1/services/audio/tts/customization`;
- endpoint, international region: `POST https://dashscope-intl.aliyuncs.com/api/v1/services/audio/tts/customization`;
- headers: `Authorization: Bearer <api_key>` and `Content-Type: application/json`;
- voice design model: `qwen-voice-design`;
- create action: `input.action = "create"`;
- list action: `input.action = "list"`;
- query action: `input.action = "query"`;
- delete action: `input.action = "delete"`;
- designed TTS target model must match the synthesis model used by TTS, for example `qwen3-tts-vd-2026-01-26`;
- `voice_prompt` supports Chinese and English and has a Qwen limit of 2048 characters;
- `preview_text` supports multiple languages for Qwen and has a 1024-character limit;
- `preferred_name` is Qwen-only, allows numbers, English letters, and underscores, and is limited to 16 characters;
- preview audio parameters should default to `sample_rate=24000` and `response_format=wav`;
- create response returns Qwen provider voice id as `output.voice`;
- preview audio may be returned as `output.preview_audio.data` base64 with `sample_rate` and `response_format`;
- list/query responses for Qwen return `voice`, `target_model`, `language`, and timestamps, but not a CosyVoice-style status field.

Provider status normalization:

| Provider result | Local `provider_status` |
| --- | --- |
| Qwen create/query/list returns `voice` | `ready` |
| Qwen request fails or returns no `voice` | `failed` |
| CosyVoice `OK` | `ready` |
| CosyVoice `DEPLOYING` | `creating` |
| CosyVoice `UNDEPLOYED` | `failed` |

The local implementation should still keep `creating` as a first-class status because CosyVoice exposes asynchronous status and future Qwen behavior may change. For Qwen, first implementation can treat a successful create response with `output.voice` as ready.

Provider request builders should be isolated from TTS generation:

```ts
interface DashScopeVoiceDesignCreateInput {
  voicePrompt: string;
  previewText: string;
  preferredName: string;
  targetModel: string;
  language?: "zh" | "en" | "de" | "it" | "pt" | "es" | "ja" | "ko" | "fr" | "ru";
  sampleRate?: 8000 | 16000 | 24000 | 48000;
  responseFormat?: "pcm" | "wav" | "mp3" | "opus";
}
```

`preferredName` must be sanitized before sending to the provider. Legacy project behavior used lower-case ASCII, replaced whitespace and hyphens with underscores, stripped unsupported characters, collapsed duplicate underscores, and capped the result at 16 characters. The new implementation should keep that rule because it matches the Qwen API constraint and avoids provider-side name errors.

Voice prompt rules:

- describe a stable reusable voice identity, not per-segment acting, plot emotion, or scene-by-scene performance;
- follow the provider writing guidance for `voice_prompt`: be specific, multi-dimensional, objective, original, and concise;
- include concrete dimensions: gender tone, age band, pitch, pace, emotional baseline, timbre traits, clarity, pause style, and usage scenario;
- include negative constraints when they matter, such as avoiding broadcast exaggeration, oily magnetic tone, shouting, ghostly acting, or excessive breathiness;
- avoid vague praise such as "good voice", "advanced voice", or "very viral";
- do not ask to imitate a real person, celebrity, actor, copyrighted voice, or platform-specific famous voice;
- keep the same `target_model` for voice design and TTS synthesis;
- keep prompts within the provider limit: Qwen-TTS design supports up to 2048 characters, while CosyVoice design supports up to 500 characters.

Recommended `design_prompt` slot order:

1. voice identity: age band plus gender tone, such as "35 到 45 岁偏男中低音";
2. acoustic traits: pitch, timbre, breath, resonance, clarity;
3. delivery traits: speaking pace, pauses, stress, sentence endings;
4. emotional baseline: restrained, calm, warm, suspenseful, authoritative, or bright;
5. content fit: suitable content families and narration scenarios;
6. avoid list: explicit traits that should not appear.

Prompt construction should prefer this compact shape:

```text
{age_band}{gender_tone}中文旁白声线，{pitch}，{timbre_traits}，吐字{clarity}，语速{pace}，停连{pause_style}，情绪基底{emotion_baseline}，适合{content_family/use_case}。避免{avoid_traits}。
```

The old project voice presets are useful seed patterns for the first global library:

| Voice archetype | Positive traits | Good fit | Avoid |
| --- | --- | --- | --- |
| 纪实沉稳型 | mature neutral/male-leaning, mid-low, clean and thick, clear diction, medium-slow, natural pauses, restrained | documentary narration, historical recap, general knowledge | oily magnetic tone, exaggerated announcer style, overacting |
| 清朗讲述型 | younger neutral, bright mid voice, crisp, medium pace, lightly brisk, friendly, layered expression | explainers, light comedy, creative stories | childlike voice, showy tone, excessive liveliness |
| 冷峻权谋型 | male-leaning mid-low, tightened voice, restrained, clear stress, short pauses, calm pressure | power struggle, war, inside story, high-risk narrative | shouting, threatening tone, stage acting, heavy vocal fry |
| 幽冷悬疑型 | cool neutral, mid-low, light breath, closed sentence endings, slow pace, eerie but grounded | folklore, Liaozhai, weird tales, suspense | screaming, exaggerated breath, film-trailer suspense acting |

`preview_text` must also be deliberate:

- use one or two representative narration sentences from the target content family;
- include natural pauses or turning points that reveal pace and sentence endings;
- avoid generic preview text when a content-specific sample is available;
- keep it short enough for repeated provider preview calls and within the provider's request limit.

The matching fields in `VoiceIntent` and `VoiceProfile` must mirror these prompt slots. This is what makes global reuse precise: the library should match on structured dimensions first, then keep the full `design_prompt` as provider input and human-debuggable rationale.

The provider adapter must persist enough diagnostics for debugging:

- endpoint base URL without API key;
- request model and action;
- target model;
- sanitized preferred name;
- prompt hash, not necessarily full prompt in trace;
- provider request id;
- raw normalized provider output;
- preview audio storage location if saved.

## 11. TTS Generation

TTS generation continues to produce:

- `tts_chunk_audio` per chunk;
- `tts_merged_audio` for full narration;
- `subtitle_track` through the separate local subtitle execution.

Changes from current behavior:

- `ctx.manifest.audio_summary.voice_profile_id` points to a local global voice profile id.
- DashScope TTS provider must resolve the provider voice id before building payload.
- All chunks in one assets run must use the same resolved provider voice id and target model.
- Metadata should include both local and provider ids:
  - `voice_profile_id`;
  - `provider_voice_id`;
  - `voice_profile_match_score`;
  - `voice_profile_match_reasons`;
  - `tts_chunk_id`;
  - `duration_sec`;
  - `format`;
  - `sample_rate`;
  - `timing_source`.

Current chunk splitting remains in `AssetPlan.tts_plan`. Future work can improve chunk planning, but this design should not reopen script content or prompt semantics.

## 12. Subtitle Dependency

Subtitle generation stays as a separate `subtitle_track` execution.

Priority for subtitle timing:

1. TTS provider word or caption timestamps, if available.
2. Forced alignment or ASR output, if added in a separate subtitle alignment plan.
3. Estimated timing from chunk durations and text length.

If timing is estimated, metadata must mark `timing_source=estimated`. Compose and renderer can still consume it, but any review UI should expose that it is not precise alignment.

## 13. API Boundary

First implementation should not introduce a full frontend voice management UI.

Backend API can be phased:

1. internal repository and service only;
2. optional read-only list/debug endpoint for harness visibility;
3. explicit create/update/generate endpoints when voice management UI is planned.

Assets generate API should keep accepting `voice_profile_id` as an override, but the value now means local global voice profile id. If absent, assets resolves one from voice intent.

## 14. Testing Strategy

Default tests must not call paid provider APIs.

Required first implementation tests:

- voice profile schema/repository contract;
- deterministic match scoring and explanations;
- local generated profile creation when no profile matches;
- provider voice adapter payload and response normalization with mocked fetch;
- TTS provider resolves local profile to provider voice id before chunk generation;
- TTS artifacts include local and provider voice metadata;
- existing subtitle provider still consumes TTS artifacts;
- `provider_mode=dashscope` remains explicit;
- real voice creation live check exists only as an explicit harness command.

Real provider checks:

- do not run by default;
- require explicit user approval;
- should write trace/status under ignored runtime output;
- should never print API keys.

## 15. Failure and Fallback Policy

Failure cases:

- no local profile can be matched or created;
- provider voice creation fails;
- provider voice remains `creating` after timeout;
- provider voice is deleted or missing;
- TTS chunk generation fails after voice creation succeeds.

Default behavior:

- fail the TTS execution with a structured error and diagnostics;
- do not silently switch voices mid-video;
- do not randomly pick another provider voice inside the adapter.

Optional fallback, if enabled explicitly:

- use a system voice such as `Ethan`;
- record `voice_fallback_used`;
- include the original intended `voice_profile_id` in diagnostics.

## 16. Implementation Slices

Recommended implementation order:

1. Shared voice profile and match result schemas.
2. Global in-memory voice profile repository and seed presets.
3. Deterministic matcher and local profile creator.
4. Assets service integration to resolve `voice_profile_id`.
5. Provider voice adapter with mocked DashScope create/query/list behavior.
6. DashScope TTS provider integration with resolved provider voice id.
7. Metadata, diagnostics, and provider job record updates.
8. Explicit live-check harness for voice creation plus TTS, not default gate.
9. Formal docs sync and focused regression.

## 17. Open Decisions for Implementation Plan

- Whether first persistence is in-memory only or Prisma-backed immediately.
- Whether voice intent is added to shared `AssetPlan` schema in the first task or derived inside assets until a separate asset-planning update.
- Whether a system voice fallback is allowed by default or only by explicit request.
- Whether provider voice creation and TTS chunk generation share the same provider job table or use separate job record kinds.

## 18. Summary

The voice system should be a reusable assets capability, not a one-off TTS option. The key design choice is to make the voice library global, searchable, and explainably matchable, while delaying paid provider voice creation until the assets stage actually needs a voice for TTS.

This gives the pipeline better narrative fit, lower cost, and a clean boundary: planning expresses voice intent, assets resolves and creates voices, compose and renderer consume the resulting audio and subtitle artifacts.
