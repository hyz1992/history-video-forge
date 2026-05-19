# Voice Profile Persistence Design

Date: 2026-05-19

Status: draft for review

## 1. Goal

Persist the assets-owned global voice library so provider-created voices can be reused across projects, tasks, process restarts, and explicit live-check follow-ups.

This design is a narrow follow-up to `docs/plans/2026-05-19-tts-voice-assets-design.md`. It does not redesign voice matching, TTS generation, DashScope voice design, subtitle timing, compose, renderer, or any frozen upstream semantic stage.

## 2. Source References

Current project references:

- `docs/records/2026-05-19-video-pipeline-follow-up-backlog.md`
- `docs/plans/2026-05-19-tts-voice-assets-design.md`
- `docs/plans/2026-05-19-tts-voice-assets-implementation-plan.md`
- `docs/architecture/pipeline-io-spec.md`
- `docs/data/field-design.md`
- `docs/data/schema-design.md`
- `shared/src/voice/voice-profile.schema.ts`
- `backend/src/db/client.ts`
- `backend/src/modules/assets/voice/voice-profile.repository.ts`
- `backend/src/modules/assets/voice/provider-voice-resolution.service.ts`
- `backend/src/modules/assets/providers/dashscope/dashscope-tts-provider.ts`

## 3. Problem

The current voice library is global only inside one in-memory `DbClient` instance:

- `DbClient.voiceProfiles` stores `VoiceProfile` records in a `Map`.
- `seedGlobalVoiceProfiles()` seeds presets and the system fallback into that map.
- `resolveProviderVoice()` can create a real DashScope provider voice and update `provider_voice_id`, `provider_status`, `preview_audio_uri`, and `updated_at`.

That works during one process lifetime, but the real provider voice identity is lost when a new `DbClient` is created. After loss, a later DashScope TTS run may create another paid provider voice for the same local profile. This is the P0 gap.

## 4. Decision

Use a local JSON document as the first long-term store:

`storage/voice-profiles/voice-profiles.json`

This is preferred for the current greenfield phase because it:

- adds no dependency;
- matches the existing JSON-backed project storage style;
- maps directly to the future `voice_profiles` table described in `docs/data/schema-design.md`;
- keeps implementation small enough to validate with focused Vitest tests;
- avoids widening the task into Prisma or SQLite migration work.

SQLite or a database table remains a future migration target, not part of this task.

## 5. JSON Contract

The persisted document shape is:

```json
{
  "schema_version": "voice_profiles_v1",
  "updated_at": "2026-05-19T00:00:00.000Z",
  "profiles": []
}
```

Rules:

- Every item in `profiles` must pass the existing `VoiceProfile` Zod schema.
- `voice_profile_id` is the stable key.
- The document is global, not project-owned.
- The file must never store API keys.
- Raw provider request or response payloads do not belong in this file.
- `preview_audio_uri` may store the existing data URI returned by voice design, but the plan should note that large binary previews may move to media storage later.

## 6. Repository Boundary

The runtime still reads and writes `DbClient.voiceProfiles`. The persistent JSON store is the backing source for that map.

Repository behavior:

1. Load existing JSON into `db.voiceProfiles`.
2. Seed only missing preset/system profile ids.
3. Never overwrite an existing profile during seed.
4. Save the full sorted profile list after `saveVoiceProfile()`.
5. Save the full sorted profile list after `updateVoiceProfileProviderState()`.

Seed must be non-destructive. If the JSON file contains `voice_preset_cold_authority` with `provider_status=ready` and `provider_voice_id=voice-provider-001`, the preset seed with `provider_status=missing` must not replace it.

## 7. App and Assets Loading

The default store path belongs to the app/runtime configuration boundary. The first implementation does not need to make `buildApp()` asynchronous.

Assets generation must ensure the library is loaded before resolving a voice profile. This guard keeps direct service tests and scripts safe when they create a `DbClient` without `buildApp()`.

Tests must use temporary directories for the voice profile store. Default unit and integration tests must not write to real `storage/voice-profiles/`.

## 8. Provider Voice Reuse

When DashScope TTS needs a provider voice:

1. It resolves the local `VoiceProfile`.
2. If `provider_status=ready` and `provider_voice_id` exists, it must reuse that id.
3. It must not call DashScope voice design in that case.
4. If the profile is missing a provider id, provider voice creation remains lazy and explicit through DashScope TTS or voice live-check paths.
5. After successful creation, repository update writes the provider state back to JSON.

The focused reuse test should simulate a new `DbClient` loading a persisted ready provider voice, then run mocked DashScope TTS and assert the voice design endpoint is not called.

## 9. Initialization and Migration Notes

Operators must preserve `storage/voice-profiles/voice-profiles.json` when moving the project or cleaning storage. Losing this file can cause repeated provider voice creation and duplicate paid voice assets.

If an existing provider voice id was created during a live-check before this persistence task, it can be manually inserted into the JSON file as a `VoiceProfile` record after validating against the schema. Manual insertion should be documented, but not automated in this task.

Future database migration should:

- create a `voice_profiles` table with fields matching `VoiceProfile`;
- import the JSON file once;
- keep `voice_profile_id` stable;
- keep provider ids and status values unchanged;
- retain JSON backup until at least one TTS reuse check passes.

## 10. Non-Goals

This design does not implement:

- SQLite, Prisma, or database migration;
- frontend voice library management UI;
- manual voice locking or selection UI;
- voice cloning from uploaded samples;
- new DashScope voice design semantics;
- true TTS duration, chunking, provider timestamps, or forced alignment;
- BGM/SFX;
- DashScope image-to-video live checks;
- changes to topic, script, storyboard, compose, or renderer semantic chains.

## 11. Acceptance

The implementation is acceptable when:

- seed does not overwrite an existing ready provider voice;
- provider-created `provider_voice_id`, `provider_status`, `preview_audio_uri`, and `updated_at` survive a new `DbClient`;
- assets/DashScope TTS can reuse an existing provider voice without calling voice design;
- tests write only to temp directories;
- docs explain initialization and backup responsibility;
- `git diff --check` passes.
