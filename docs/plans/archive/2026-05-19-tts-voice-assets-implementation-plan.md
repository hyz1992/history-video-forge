# TTS / Voice Assets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a global shared voice library for assets-stage TTS, including voice intent schemas, deterministic matching, local profile creation, mocked DashScope voice design, and designed-voice TTS metadata.

**Architecture:** Asset planning expresses or implies a `VoiceIntent`; assets resolves that intent to a global local `VoiceProfile`. Provider voice creation is lazy: DashScope voice design is called only when DashScope TTS needs a provider voice id, and default tests use mocked fetch or fake/local providers only. Compose and renderer continue to consume `AssetManifest` audio/subtitle artifacts without creating or selecting voices.

**Tech Stack:** TypeScript, Zod shared schemas, Vitest, existing in-memory `DbClient`, existing assets provider engine, existing local project file storage, DashScope HTTP API boundary with mocked tests.

---

## Session Rules

- Read `AGENTS.md` before execution.
- Read `docs/plans/2026-05-19-tts-voice-assets-design.md` before execution.
- Re-check the official DashScope voice design docs before provider work:
  - https://help.aliyun.com/zh/model-studio/voice-design-user-guide
  - https://help.aliyun.com/zh/model-studio/voice-design-api-references
- Do not run real DashScope voice design or real TTS calls in default tests.
- Do not run the explicit live check unless the user approves the cost.
- Do not implement frontend voice management UI.
- Do not implement voice cloning from uploaded samples.
- Do not change frozen topic/script semantics.
- Do not change compose/renderer behavior except through already-valid `AssetManifest` artifacts.
- Do not stage or commit unless the user explicitly asks.
- Do not touch `storage/topic-candidate-library/`.

## File Map

- Create `shared/src/voice/voice-profile.schema.ts`: `VoiceIntent`, `VoiceProfile`, `VoiceMatchResult`, and provider lifecycle schemas.
- Modify `shared/src/assets/asset-manifest.schema.ts`: allow designed-voice metadata on TTS artifacts.
- Modify `shared/src/asset-planning/asset-plan.schema.ts`: allow optional `global_audio_strategy.voice_intent` without forcing asset planning prompt changes.
- Modify `shared/src/index.ts`: export voice schemas.
- Modify `tests/shared/schema-contracts.test.ts`: schema contract tests for voice profiles and TTS metadata.
- Modify `backend/src/db/client.ts`: add global `voiceProfiles` map to the current in-memory DB shape.
- Create `backend/src/modules/assets/voice/voice-presets.ts`: four shared seed presets plus system voice seed.
- Create `backend/src/modules/assets/voice/voice-profile.repository.ts`: global repository helpers.
- Create `tests/backend/assets/voice-profile-repository.test.ts`: seed and repository contract tests.
- Create `backend/src/modules/assets/voice/voice-matcher.ts`: deterministic scoring and explainable match result.
- Create `backend/src/modules/assets/voice/voice-profile-creator.ts`: deterministic local profile creation from intent.
- Create `tests/backend/assets/voice-matcher.test.ts`: matcher and local creation tests.
- Create `backend/src/modules/assets/voice/voice-resolution.service.ts`: resolve requested voice id or intent before manifest/provider execution.
- Modify `backend/src/modules/assets/assets-run.service.ts`: call the voice resolver before `buildInitialAssetManifest`.
- Modify `backend/src/modules/assets/assets-manifest-builder.ts`: preserve resolved local voice profile id in manifest options.
- Modify `tests/backend/assets/assets-run-service.test.ts`: assets integration tests for voice resolution.
- Create `backend/src/modules/assets/providers/dashscope/dashscope-voice-design-provider.ts`: mocked DashScope voice design request builder and normalization.
- Create `tests/backend/assets/dashscope-voice-design-provider.test.ts`: no-network provider tests using mocked fetch.
- Modify `backend/src/modules/assets/providers/dashscope/dashscope-tts-provider.ts`: resolve local voice profile to provider voice id before building TTS payload.
- Modify `tests/backend/assets/dashscope-tts-provider.test.ts`: designed voice integration tests.
- Create `harness/scripts/runtime/assets-dashscope-voice-live-check.ts`: explicit, non-default voice design + TTS check.
- Create `tests/harness/assets-dashscope-voice-live-check.test.ts`: script registration and guard tests.
- Modify `package.json`: add explicit live-check script.
- Modify `docs/plans/README.md`: record implementation plan status.
- Modify formal docs only after code tasks pass: `docs/architecture/pipeline-io-spec.md`, `docs/architecture/api-design.md`, `docs/data/field-design.md`, `docs/data/schema-design.md`.

## Task 1: Shared Voice Schemas

**Files:**
- Create: `shared/src/voice/voice-profile.schema.ts`
- Modify: `shared/src/assets/asset-manifest.schema.ts`
- Modify: `shared/src/asset-planning/asset-plan.schema.ts`
- Modify: `shared/src/index.ts`
- Modify: `tests/shared/schema-contracts.test.ts`

- [ ] **Step 1: Write failing shared schema tests**

Add tests that import the new schemas from `../shared/src/index.js` and parse:

```ts
const intent = VoiceIntent.parse({
  content_family: "historical_power",
  narrator_persona: "冷静旁白",
  desired_traits: ["cold", "authoritative", "restrained"],
  avoid_traits: ["shouting", "broadcast_exaggeration"],
  gender_tone: "male_leaning",
  age_band: "35-45",
  pitch: "mid_low",
  pace: "medium_slow",
  energy: 0.45,
  authority: 0.9,
  suspense: 0.7,
  warmth: 0.2,
  style_notes: ["短停顿", "重音明确"],
});

expect(intent.content_family).toBe("historical_power");

const profile = VoiceProfile.parse({
  voice_profile_id: "voice_cold_authority",
  kind: "preset",
  name: "冷峻权谋型",
  description: "冷静、有压迫感的历史权谋旁白",
  design_prompt:
    "35 到 45 岁偏男中低音，声线收紧，低沉克制，重音明确，停顿短促，情绪冷静而有压迫感，适合权谋、战争、内幕和高风险叙事。避免怒吼、恐吓腔、舞台表演感和过重气泡音。",
  preview_text: "诏令还没出宫门，刀兵就先到了阶下。",
  provider_name: "dashscope",
  provider_voice_id: null,
  provider_status: "missing",
  target_model: "qwen3-tts-vd-2026-01-26",
  recommended_content_families: ["historical_power", "war"],
  voice_traits: ["cold", "authoritative", "restrained"],
  avoid_traits: ["shouting", "stage_acting"],
  gender_tone: "male_leaning",
  age_band: "35-45",
  pitch: "mid_low",
  pace: "medium_slow",
  energy: 0.45,
  authority: 0.9,
  suspense: 0.7,
  warmth: 0.2,
  preview_audio_uri: null,
  usage_count: 0,
  last_used_at: null,
  quality_score: null,
  created_at: "2026-05-19T00:00:00.000Z",
  updated_at: "2026-05-19T00:00:00.000Z",
});

expect(profile.provider_status).toBe("missing");

const match = VoiceMatchResult.parse({
  selected_voice_profile_id: "voice_cold_authority",
  match_score: 0.91,
  match_decision: "matched_existing",
  match_reasons: ["content_family:historical_power", "traits:cold,authoritative"],
  rejected_profile_ids: [{ voice_profile_id: "voice_crisp_storyteller", reason: "trait_mismatch" }],
});

expect(match.match_decision).toBe("matched_existing");
```

Also extend the existing `AssetManifest` TTS artifact fixture so `tts_chunk_audio.metadata` and `tts_merged_audio.metadata` accept:

```ts
provider_voice_id: "voice-provider-001",
voice_profile_match_score: 0.91,
voice_profile_match_reasons: ["matched existing preset"],
timing_source: "estimated",
sample_rate: 24000,
format: "wav",
```

- [ ] **Step 2: Run schema tests and verify red**

Run:

```bash
npx vitest run --configLoader runner tests/shared/schema-contracts.test.ts
```

Expected: fail because `VoiceIntent`, `VoiceProfile`, and `VoiceMatchResult` are not exported.

- [ ] **Step 3: Add schemas and exports**

Create `shared/src/voice/voice-profile.schema.ts` with strict Zod schemas:

```ts
import { z } from "zod";

export const VoiceProfileKind = z.enum(["preset", "generated", "system"]);
export const VoiceProviderStatus = z.enum([
  "missing",
  "creating",
  "ready",
  "failed",
  "deleted",
]);

const Score = z.number().min(0).max(1);

export const VoiceIntent = z
  .object({
    content_family: z.string().min(1),
    narrator_persona: z.string().min(1),
    desired_traits: z.array(z.string().min(1)),
    avoid_traits: z.array(z.string().min(1)),
    gender_tone: z.string().min(1).nullable().optional(),
    age_band: z.string().min(1).nullable().optional(),
    pitch: z.string().min(1).nullable().optional(),
    pace: z.string().min(1).nullable().optional(),
    energy: Score.nullable().optional(),
    authority: Score.nullable().optional(),
    suspense: Score.nullable().optional(),
    warmth: Score.nullable().optional(),
    style_notes: z.array(z.string().min(1)),
  })
  .strict();

export const VoiceProfile = z
  .object({
    voice_profile_id: z.string().min(1),
    kind: VoiceProfileKind,
    name: z.string().min(1),
    description: z.string().min(1),
    design_prompt: z.string().min(1).max(2048),
    preview_text: z.string().min(1).max(1024),
    provider_name: z.string().min(1),
    provider_voice_id: z.string().min(1).nullable(),
    provider_status: VoiceProviderStatus,
    target_model: z.string().min(1),
    recommended_content_families: z.array(z.string().min(1)),
    voice_traits: z.array(z.string().min(1)),
    avoid_traits: z.array(z.string().min(1)),
    gender_tone: z.string().min(1).nullable(),
    age_band: z.string().min(1).nullable(),
    pitch: z.string().min(1).nullable(),
    pace: z.string().min(1).nullable(),
    energy: Score.nullable(),
    authority: Score.nullable(),
    suspense: Score.nullable(),
    warmth: Score.nullable(),
    preview_audio_uri: z.string().min(1).nullable(),
    usage_count: z.number().int().nonnegative(),
    last_used_at: z.string().nullable(),
    quality_score: Score.nullable(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .strict();

export const VoiceMatchResult = z
  .object({
    selected_voice_profile_id: z.string().min(1),
    match_score: Score,
    match_decision: z.enum([
      "matched_existing",
      "created_local_profile",
      "fallback_system",
    ]),
    match_reasons: z.array(z.string().min(1)),
    rejected_profile_ids: z.array(
      z
        .object({
          voice_profile_id: z.string().min(1),
          reason: z.string().min(1),
        })
        .strict(),
    ),
  })
  .strict();

export type VoiceIntent = z.infer<typeof VoiceIntent>;
export type VoiceProfile = z.infer<typeof VoiceProfile>;
export type VoiceMatchResult = z.infer<typeof VoiceMatchResult>;
```

Export these schemas from `shared/src/index.ts`.

In `asset-manifest.schema.ts`, add optional designed-voice metadata fields to both TTS metadata schemas:

```ts
provider_voice_id: z.string().min(1).nullable().optional(),
voice_profile_match_score: z.number().min(0).max(1).optional(),
voice_profile_match_reasons: z.array(z.string().min(1)).optional(),
timing_source: z.enum(["provider", "estimated", "aligned"]).optional(),
sample_rate: z.number().int().positive().optional(),
format: z.string().min(1).optional(),
```

In `asset-plan.schema.ts`, replace the broad `global_audio_strategy` record with a record that still passes current fixtures and allows `voice_intent`:

```ts
global_audio_strategy: z
  .object({
    voice_intent: VoiceIntent.optional(),
  })
  .passthrough()
  .default({}),
```

- [ ] **Step 4: Run schema tests and verify green**

Run:

```bash
npx vitest run --configLoader runner tests/shared/schema-contracts.test.ts
```

Expected: pass.

- [ ] **Step 5: Run diff check**

Run:

```bash
git diff --check
```

Expected: exit code 0.

## Task 2: Global Voice Repository and Seed Presets

**Files:**
- Modify: `backend/src/db/client.ts`
- Create: `backend/src/modules/assets/voice/voice-presets.ts`
- Create: `backend/src/modules/assets/voice/voice-profile.repository.ts`
- Create: `tests/backend/assets/voice-profile-repository.test.ts`

- [ ] **Step 1: Write failing repository tests**

Create tests that prove the library is global and seeded once per DB client:

```ts
import { describe, expect, it } from "vitest";
import { createDbClient } from "../../../backend/src/db/client.js";
import {
  listVoiceProfiles,
  saveVoiceProfile,
  seedGlobalVoiceProfiles,
} from "../../../backend/src/modules/assets/voice/voice-profile.repository.js";

describe("global voice profile repository", () => {
  it("seeds four shared presets plus one system voice", async () => {
    const db = createDbClient();

    await seedGlobalVoiceProfiles(db);
    await seedGlobalVoiceProfiles(db);

    const profiles = await listVoiceProfiles(db);
    expect(profiles.map((item) => item.voice_profile_id)).toEqual([
      "voice_preset_cold_authority",
      "voice_preset_steady_documentary",
      "voice_preset_crisp_storyteller",
      "voice_preset_eerie_suspense",
      "voice_system_ethan",
    ]);
  });

  it("stores generated profiles globally, not per project", async () => {
    const db = createDbClient();

    await seedGlobalVoiceProfiles(db);
    await saveVoiceProfile(db, {
      voice_profile_id: "voice_generated_test",
      kind: "generated",
      name: "测试音色",
      description: "测试用全局音色",
      design_prompt: "30 到 40 岁中性旁白声线，中音，吐字清晰，语速中等，适合测试。避免夸张表演。",
      preview_text: "这是一段测试音色的预览文本。",
      provider_name: "dashscope",
      provider_voice_id: null,
      provider_status: "missing",
      target_model: "qwen3-tts-vd-2026-01-26",
      recommended_content_families: ["test"],
      voice_traits: ["clear"],
      avoid_traits: ["overacting"],
      gender_tone: "neutral",
      age_band: "30-40",
      pitch: "mid",
      pace: "medium",
      energy: 0.5,
      authority: 0.5,
      suspense: 0.2,
      warmth: 0.4,
      preview_audio_uri: null,
      usage_count: 0,
      last_used_at: null,
      quality_score: null,
      created_at: "2026-05-19T00:00:00.000Z",
      updated_at: "2026-05-19T00:00:00.000Z",
    });

    const profiles = await listVoiceProfiles(db);
    expect(profiles.some((item) => item.voice_profile_id === "voice_generated_test")).toBe(true);
  });
});
```

- [ ] **Step 2: Run repository tests and verify red**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/voice-profile-repository.test.ts
```

Expected: fail because repository files and `DbClient.voiceProfiles` do not exist.

- [ ] **Step 3: Add DB map, seed presets, and repository helpers**

Add to `DbClient`:

```ts
voiceProfiles: Map<string, VoiceProfile>;
```

Initialize it in `createDbClient()`.

Create seed records using the four old-project archetypes:

- `voice_preset_cold_authority`
- `voice_preset_steady_documentary`
- `voice_preset_crisp_storyteller`
- `voice_preset_eerie_suspense`
- `voice_system_ethan`

Repository functions:

```ts
export async function seedGlobalVoiceProfiles(db: DbClient): Promise<void>;
export async function listVoiceProfiles(db: DbClient): Promise<VoiceProfile[]>;
export async function getVoiceProfileById(
  db: DbClient,
  id: string,
): Promise<VoiceProfile | null>;
export async function saveVoiceProfile(
  db: DbClient,
  profile: VoiceProfile,
): Promise<VoiceProfile>;
export async function updateVoiceProfileProviderState(
  db: DbClient,
  id: string,
  patch: Pick<VoiceProfile, "provider_status"> &
    Partial<Pick<VoiceProfile, "provider_voice_id" | "preview_audio_uri">>,
): Promise<VoiceProfile | null>;
```

Validate every write with `VoiceProfile.parse(profile)`.

- [ ] **Step 4: Run repository tests and verify green**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/voice-profile-repository.test.ts
```

Expected: pass.

## Task 3: Deterministic Matcher and Local Profile Creator

**Files:**
- Create: `backend/src/modules/assets/voice/voice-matcher.ts`
- Create: `backend/src/modules/assets/voice/voice-profile-creator.ts`
- Create: `tests/backend/assets/voice-matcher.test.ts`

- [ ] **Step 1: Write failing matcher tests**

Test exact decisions and reasons:

```ts
import { describe, expect, it } from "vitest";
import { createLocalVoiceProfileFromIntent } from "../../../backend/src/modules/assets/voice/voice-profile-creator.js";
import { matchVoiceProfile } from "../../../backend/src/modules/assets/voice/voice-matcher.js";
import { SHARED_VOICE_PROFILE_SEEDS } from "../../../backend/src/modules/assets/voice/voice-presets.js";

describe("voice matcher", () => {
  it("selects cold authority for historical power intent", () => {
    const result = matchVoiceProfile({
      intent: {
        content_family: "historical_power",
        narrator_persona: "克制的历史旁白",
        desired_traits: ["cold", "authoritative", "restrained"],
        avoid_traits: ["shouting"],
        gender_tone: "male_leaning",
        age_band: "35-45",
        pitch: "mid_low",
        pace: "medium_slow",
        energy: 0.45,
        authority: 0.9,
        suspense: 0.7,
        warmth: 0.2,
        style_notes: ["短停顿"],
      },
      profiles: SHARED_VOICE_PROFILE_SEEDS,
      allowLocalProfileCreation: true,
    });

    expect(result.selected_voice_profile_id).toBe("voice_preset_cold_authority");
    expect(result.match_decision).toBe("matched_existing");
    expect(result.match_score).toBeGreaterThanOrEqual(0.75);
    expect(result.match_reasons.join(" ")).toContain("desired_traits");
  });

  it("creates a local profile when no seed is close enough", () => {
    const intent = {
      content_family: "gentle_healing",
      narrator_persona: "温柔疗愈旁白",
      desired_traits: ["warm", "soft", "healing"],
      avoid_traits: ["cold", "authoritative"],
      gender_tone: "female_leaning",
      age_band: "25-35",
      pitch: "mid_high",
      pace: "slow",
      energy: 0.25,
      authority: 0.2,
      suspense: 0.1,
      warmth: 0.95,
      style_notes: ["轻柔停顿"],
    };

    const match = matchVoiceProfile({
      intent,
      profiles: SHARED_VOICE_PROFILE_SEEDS,
      allowLocalProfileCreation: true,
    });
    const profile = createLocalVoiceProfileFromIntent({
      intent,
      nowIso: "2026-05-19T00:00:00.000Z",
      voiceProfileId: "voice_generated_gentle_healing",
    });

    expect(match.match_decision).toBe("created_local_profile");
    expect(profile.provider_status).toBe("missing");
    expect(profile.provider_voice_id).toBeNull();
    expect(profile.design_prompt).toContain("温柔疗愈旁白");
    expect(profile.design_prompt).toContain("避免");
  });
});
```

- [ ] **Step 2: Run matcher tests and verify red**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/voice-matcher.test.ts
```

Expected: fail because matcher and creator do not exist.

- [ ] **Step 3: Implement matcher and creator**

Matcher input:

```ts
export interface MatchVoiceProfileInput {
  intent: VoiceIntent;
  profiles: VoiceProfile[];
  allowLocalProfileCreation: boolean;
}
```

Scoring constants:

```ts
const MATCH_EXISTING_THRESHOLD = 0.75;
const CREATE_LOCAL_THRESHOLD = 0.55;
```

Scoring components:

- `0.25` content family exact or recommended family match;
- `0.25` desired trait overlap;
- `0.15` avoid-trait penalty;
- `0.20` numeric closeness for energy, authority, suspense, warmth;
- `0.10` pitch/pace/gender/age compatibility;
- `0.05` ready provider or system status preference.

Creator must use the provider prompt slot order from the design document and never create a provider voice id. It must set `provider_status="missing"` and `target_model="qwen3-tts-vd-2026-01-26"`.

- [ ] **Step 4: Run matcher tests and verify green**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/voice-matcher.test.ts
```

Expected: pass.

## Task 4: Assets Voice Resolution Before Manifest Build

**Files:**
- Create: `backend/src/modules/assets/voice/voice-resolution.service.ts`
- Modify: `backend/src/modules/assets/assets-run.service.ts`
- Modify: `backend/src/modules/assets/assets-manifest-builder.ts`
- Modify: `tests/backend/assets/assets-run-service.test.ts`

- [ ] **Step 1: Write failing assets service tests**

Add tests that run assets generation with `voiceProfileId=""` or a missing profile id and assert:

```ts
expect(result.record.manifestJson.audio_summary.voice_profile_id).toBe("voice_preset_cold_authority");
expect(result.record.manifestJson.execution_options.voice_profile_id).toBe("voice_preset_cold_authority");
```

Add a second test with a low-match voice intent in `AssetPlan.global_audio_strategy.voice_intent` and assert a generated local profile id is used:

```ts
expect(String(result.record.manifestJson.audio_summary.voice_profile_id)).toMatch(/^voice_generated_/);
expect(db.voiceProfiles.has(result.record.manifestJson.audio_summary.voice_profile_id)).toBe(true);
```

- [ ] **Step 2: Run service tests and verify red**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/assets-run-service.test.ts
```

Expected: fail because assets service still trusts the request `voiceProfileId` directly.

- [ ] **Step 3: Implement voice resolution service**

Resolution priority:

1. explicit request `voiceProfileId` if it exists in global library and is not deleted;
2. `assetPlan.global_audio_strategy.voice_intent`;
3. conservative default intent:

```ts
{
  content_family: "historical_power",
  narrator_persona: "克制的历史旁白",
  desired_traits: ["cold", "authoritative", "restrained"],
  avoid_traits: ["shouting", "broadcast_exaggeration"],
  gender_tone: "male_leaning",
  age_band: "35-45",
  pitch: "mid_low",
  pace: "medium_slow",
  energy: 0.45,
  authority: 0.85,
  suspense: 0.65,
  warmth: 0.2,
  style_notes: ["重音明确", "短停顿"],
}
```

Return:

```ts
export interface ResolveVoiceProfileResult {
  voiceProfileId: string;
  matchResult: VoiceMatchResult;
}
```

`assets-run.service.ts` must call this resolver before `buildInitialAssetManifest` and pass the resolved id into execution options.

- [ ] **Step 4: Run service tests and verify green**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/assets-run-service.test.ts
```

Expected: pass.

## Task 5: DashScope Voice Design Provider Boundary

**Files:**
- Create: `backend/src/modules/assets/providers/dashscope/dashscope-voice-design-provider.ts`
- Create: `tests/backend/assets/dashscope-voice-design-provider.test.ts`

- [ ] **Step 1: Write failing provider boundary tests**

Test request payload, preferred name sanitization, and response normalization:

```ts
import { describe, expect, it, vi } from "vitest";
import {
  buildDashscopeVoiceDesignCreatePayload,
  createDashscopeDesignedVoice,
  sanitizePreferredVoiceName,
} from "../../../backend/src/modules/assets/providers/dashscope/dashscope-voice-design-provider.js";

describe("DashScope voice design provider boundary", () => {
  it("sanitizes preferred_name for Qwen voice design", () => {
    expect(sanitizePreferredVoiceName("冷峻 权谋-01")).toBe("voice_01");
    expect(sanitizePreferredVoiceName("Historical Power Voice 001")).toBe("historical_power");
  });

  it("builds a Qwen voice design create payload", () => {
    expect(buildDashscopeVoiceDesignCreatePayload({
      voicePrompt: "35 到 45 岁偏男中低音，吐字清晰。",
      previewText: "诏令还没出宫门，刀兵就先到了阶下。",
      preferredName: "cold_authority",
      targetModel: "qwen3-tts-vd-2026-01-26",
    })).toEqual({
      model: "qwen-voice-design",
      input: {
        action: "create",
        target_model: "qwen3-tts-vd-2026-01-26",
        preferred_name: "cold_authority",
        voice_prompt: "35 到 45 岁偏男中低音，吐字清晰。",
        preview_text: "诏令还没出宫门，刀兵就先到了阶下。",
      },
      parameters: {
        sample_rate: 24000,
        response_format: "wav",
      },
    });
  });

  it("normalizes create response without real network", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      output: {
        voice: "voice-provider-001",
        preview_audio: {
          data: Buffer.from("preview").toString("base64"),
          sample_rate: 24000,
          response_format: "wav",
        },
      },
      request_id: "req_voice_001",
    }), { status: 200 })));

    const result = await createDashscopeDesignedVoice({
      apiKey: "test-key",
      baseUrl: "https://dashscope.test",
      voicePrompt: "35 到 45 岁偏男中低音，吐字清晰。",
      previewText: "诏令还没出宫门，刀兵就先到了阶下。",
      preferredName: "cold_authority",
      targetModel: "qwen3-tts-vd-2026-01-26",
    });

    expect(result.providerVoiceId).toBe("voice-provider-001");
    expect(result.providerStatus).toBe("ready");
    expect(result.requestId).toBe("req_voice_001");
    expect(result.previewAudioBase64).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run provider boundary tests and verify red**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/dashscope-voice-design-provider.test.ts
```

Expected: fail because provider boundary file does not exist.

- [ ] **Step 3: Implement provider boundary**

Create pure helpers plus mocked-fetch friendly `createDashscopeDesignedVoice`. Do not import the assets provider adapter interface here; this boundary is used by voice resolution and DashScope TTS.

Provider result type:

```ts
export interface DashscopeDesignedVoiceResult {
  providerVoiceId: string;
  providerStatus: "ready" | "failed";
  requestId: string | null;
  previewAudioBase64: string | null;
  rawResponseJson: Record<string, unknown>;
}
```

Endpoint:

```ts
`${baseUrl.replace(/\/$/, "")}/api/v1/services/audio/tts/customization`
```

Reject empty API keys with `dashscope_api_key_missing`.

- [ ] **Step 4: Run provider boundary tests and verify green**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/dashscope-voice-design-provider.test.ts
```

Expected: pass.

## Task 6: Designed Voice Resolution for DashScope TTS

**Files:**
- Create: `backend/src/modules/assets/voice/provider-voice-resolution.service.ts`
- Modify: `backend/src/modules/assets/providers/dashscope/dashscope-tts-provider.ts`
- Modify: `backend/src/modules/assets/assets-run.service.ts`
- Modify: `tests/backend/assets/dashscope-tts-provider.test.ts`

- [ ] **Step 1: Write failing TTS provider tests**

Add a test where the manifest uses local `voice_preset_cold_authority` and the repository record is missing a provider id. Mock voice design fetch and TTS fetch. Assert the TTS payload uses provider id:

```ts
expect(ttsPayload.input.voice).toBe("voice-provider-001");
expect(result.manifest.audio_summary.voice_profile_id).toBe("voice_preset_cold_authority");
expect(chunkArtifact.metadata.provider_voice_id).toBe("voice-provider-001");
expect(mergedArtifact.metadata.provider_voice_id).toBe("voice-provider-001");
```

Also assert the local profile is updated:

```ts
const profile = db.voiceProfiles.get("voice_preset_cold_authority");
expect(profile?.provider_status).toBe("ready");
expect(profile?.provider_voice_id).toBe("voice-provider-001");
```

- [ ] **Step 2: Run TTS provider tests and verify red**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/dashscope-tts-provider.test.ts
```

Expected: fail because DashScope TTS currently sends the local `voice_profile_id` as the provider `voice`.

- [ ] **Step 3: Implement provider voice resolution**

Add a service:

```ts
export interface ResolveProviderVoiceInput {
  db: DbClient;
  localVoiceProfileId: string;
  apiKey: string;
  baseUrl?: string;
}

export interface ResolveProviderVoiceResult {
  localVoiceProfileId: string;
  providerVoiceId: string;
  targetModel: string;
  matchScore: number | null;
  matchReasons: string[];
}
```

Rules:

- system voice with `provider_voice_id` returns immediately;
- ready profile with `provider_voice_id` returns immediately;
- missing or failed DashScope profile calls `createDashscopeDesignedVoice`;
- successful create updates local profile to `provider_status="ready"`;
- failure throws `voice_provider_creation_failed`;
- no fallback voice is used by default.

Pass `db` into `createDashscopeTtsProvider` options only in DashScope mode. In `buildDashscopeTtsPayload`, rename the field from `voiceProfileId` to `providerVoiceId` to prevent accidental local-id usage.

- [ ] **Step 4: Run TTS provider tests and verify green**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/dashscope-tts-provider.test.ts
```

Expected: pass.

## Task 7: Artifact Metadata, Provider Jobs, and Subtitle Continuity

**Files:**
- Modify: `backend/src/modules/assets/providers/dashscope/dashscope-tts-provider.ts`
- Modify: `backend/src/modules/assets/assets-execution-engine.ts`
- Modify: `tests/backend/assets/local-subtitle-provider.test.ts`
- Modify: `tests/backend/assets/assets-execution-engine.test.ts`

- [ ] **Step 1: Write failing metadata and subtitle tests**

Add assertions that designed TTS artifacts include:

```ts
expect(chunkArtifact.metadata).toMatchObject({
  voice_profile_id: "voice_preset_cold_authority",
  provider_voice_id: "voice-provider-001",
  sample_rate: 24000,
  format: "wav",
  timing_source: "estimated",
});
```

Add a subtitle continuity assertion:

```ts
expect(result.manifest.audio_summary.subtitle_artifact_id).toBeTruthy();
expect(result.manifest.segment_routes.every((route) => route.subtitle_artifact_id)).toBe(true);
```

- [ ] **Step 2: Run focused assets tests and verify red**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/dashscope-tts-provider.test.ts tests/backend/assets/local-subtitle-provider.test.ts tests/backend/assets/assets-execution-engine.test.ts
```

Expected: fail on missing designed-voice metadata or subtitle continuity if provider changes broke ordering.

- [ ] **Step 3: Add metadata and keep existing route updates**

DashScope TTS artifacts must include:

- `voice_profile_id`: local global id;
- `provider_voice_id`: provider id used in request;
- `voice_profile_match_score`: nullable when unavailable;
- `voice_profile_match_reasons`: array;
- `timing_source`: `"estimated"` until provider word timestamps are available;
- `sample_rate`;
- `format`.

The execution engine must continue to update:

- `audio_summary.tts_chunk_routes[].artifact_id`;
- `segment_routes[].tts_artifact_id`;
- `audio_summary.tts_merged_artifact_id`;
- subtitle artifacts after TTS artifacts.

- [ ] **Step 4: Run focused assets tests and verify green**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/dashscope-tts-provider.test.ts tests/backend/assets/local-subtitle-provider.test.ts tests/backend/assets/assets-execution-engine.test.ts
```

Expected: pass.

## Task 8: Explicit Voice Live-Check Harness Without Default Provider Calls

**Files:**
- Create: `harness/scripts/runtime/assets-dashscope-voice-live-check.ts`
- Create: `tests/harness/assets-dashscope-voice-live-check.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing harness registration tests**

Test the script exists, package script exists, and the command refuses to run without explicit environment confirmation:

```ts
expect(packageJson.scripts["harness:assets-dashscope-voice-live-check"]).toBe(
  "tsx harness/scripts/runtime/assets-dashscope-voice-live-check.ts",
);
```

The script must require:

```text
RUN_DASHSCOPE_VOICE_LIVE_CHECK=1
ALIYUN_DASHSCOPE_API_KEY=<non-empty>
```

When the confirmation variable is absent, expected output contains `live_check_not_enabled`.

- [ ] **Step 2: Run harness tests and verify red**

Run:

```bash
npx vitest run --configLoader runner tests/harness/assets-dashscope-voice-live-check.test.ts
```

Expected: fail because the harness file and package script do not exist.

- [ ] **Step 3: Add guarded live-check script**

The script should:

1. exit with a clear message when `RUN_DASHSCOPE_VOICE_LIVE_CHECK !== "1"`;
2. create a single designed voice using a short seed prompt;
3. synthesize one short sentence with that provider voice id;
4. write output under ignored runtime storage;
5. print provider request id and local file path;
6. never print API key;
7. avoid image-to-video calls.

Do not run this command during normal implementation verification.

- [ ] **Step 4: Run harness tests and verify green**

Run:

```bash
npx vitest run --configLoader runner tests/harness/assets-dashscope-voice-live-check.test.ts
```

Expected: pass.

## Task 9: Formal Docs and Focused Regression

**Files:**
- Modify: `docs/architecture/pipeline-io-spec.md`
- Modify: `docs/architecture/api-design.md`
- Modify: `docs/data/field-design.md`
- Modify: `docs/data/schema-design.md`
- Modify: `docs/plans/README.md`

- [ ] **Step 1: Update formal docs with implemented facts**

Document:

- `VoiceIntent`, `VoiceProfile`, and `VoiceMatchResult`;
- global voice library is assets-owned and shared across projects;
- provider voice creation is lazy and belongs to assets TTS execution;
- default tests and default provider mode do not call real provider APIs;
- `provider_voice_id` is stored in TTS artifact metadata when a designed provider voice is used;
- subtitle timing remains estimated unless provider timestamps or alignment are added.

- [ ] **Step 2: Run focused regression**

Run:

```bash
npx vitest run --configLoader runner tests/shared/schema-contracts.test.ts
npx vitest run --configLoader runner tests/backend/assets/voice-profile-repository.test.ts tests/backend/assets/voice-matcher.test.ts tests/backend/assets/assets-run-service.test.ts
npx vitest run --configLoader runner tests/backend/assets/dashscope-voice-design-provider.test.ts tests/backend/assets/dashscope-tts-provider.test.ts tests/backend/assets/local-subtitle-provider.test.ts
npx vitest run --configLoader runner tests/harness/assets-dashscope-voice-live-check.test.ts
git diff --check
```

Expected: every Vitest command passes and `git diff --check` exits 0.

- [ ] **Step 3: Inspect status**

Run:

```bash
git status --short
```

Expected: only files related to this plan and pre-existing unrelated workspace changes appear. Do not stage or commit.

## Completion Criteria

- Shared voice schemas are exported and covered by schema contracts.
- Global voice repository seeds the four reusable presets plus a system voice.
- Voice matching is deterministic, explainable, and can create a local generated profile without provider calls.
- Assets generation resolves a local global `voice_profile_id` before manifest build.
- DashScope voice design provider is mocked in tests and never called by default.
- DashScope TTS uses provider voice id, while artifacts retain the local global voice profile id.
- Subtitle generation still runs after TTS and consumes TTS artifacts.
- The explicit voice live-check exists but remains opt-in and unexecuted unless the user approves the cost.
- Formal docs describe the implemented behavior.
