# TTS Duration and Subtitle Timing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve assets TTS timing by normalizing long TTS chunks, recording real audio durations when available, and carrying chunk-based subtitle timing into compose.

**Architecture:** Keep `AssetPlan` as the upstream source, but derive an assets-local normalized TTS plan before manifest build and provider execution. Add dependency-free audio duration probing for downloaded TTS bytes, extend artifact timing metadata, and keep compose as a consumer of completed asset durations rather than a timing generator.

**Tech Stack:** TypeScript, Node `Buffer`, Zod shared schemas, Vitest, existing assets provider adapters, existing compose timeline builder, no new dependencies.

---

## Session Rules

- Read `AGENTS.md` before execution.
- Read `docs/plans/2026-05-19-tts-duration-subtitle-timing-design.md`.
- Follow TDD: write the focused failing test first, run it red, implement the smallest change, run it green, commit in Chinese.
- Do not run real DashScope by default.
- Do not touch `storage/topic-candidate-library/`.
- Do not install dependencies.
- Do not change topic/script/storyboard/asset planning semantic generation.
- Do not implement word-level forced alignment, subtitle styling, BGM/SFX, renderer UI, or publishing flow.

## File Map

- Modify `shared/src/assets/asset-manifest.schema.ts`: extend timing source values and subtitle metadata.
- Create `backend/src/modules/assets/tts-chunking.service.ts`: deterministic assets-local TTS chunk normalizer.
- Create `tests/backend/assets/tts-chunking-service.test.ts`: chunk splitting tests.
- Create `backend/src/modules/assets/audio-duration-probe.ts`: dependency-free WAV/PCM duration helper.
- Create `tests/backend/assets/audio-duration-probe.test.ts`: synthetic audio duration tests.
- Modify `backend/src/modules/assets/assets-run.service.ts`: apply normalized TTS plan for manifest build and provider execution.
- Modify `backend/src/modules/assets/providers/dashscope/dashscope-tts-provider.ts`: probe downloaded audio duration and set timing metadata.
- Modify `backend/src/modules/assets/providers/fake-tts-provider.ts`: preserve explicit estimated timing metadata.
- Modify `backend/src/modules/assets/providers/local-subtitle-provider.ts`: write subtitle duration and timing metadata.
- Modify `backend/src/modules/assets/assets-subtitle-generator.ts`: keep chunk timing deterministic and expose total duration helper if useful.
- Modify `tests/backend/assets/assets-run-service.test.ts`: normalized chunk integration test.
- Modify `tests/backend/assets/dashscope-tts-provider.test.ts`: probed duration and fallback tests.
- Modify `tests/backend/assets/local-subtitle-provider.test.ts`: subtitle timing metadata tests.
- Modify `tests/backend/compose/compose-timeline-builder.test.ts`: compose consumes chunk duration regression.
- Modify docs after code: `docs/data/field-design.md`, `docs/data/schema-design.md`, `docs/architecture/pipeline-io-spec.md`, `docs/plans/README.md`, and backlog.

## Task 1: Shared Timing Metadata Contract

**Files:**
- Modify: `shared/src/assets/asset-manifest.schema.ts`
- Test: use existing schema validation tests in `tests/backend/assets/assets-local-validator.test.ts` or add a focused schema assertion in `tests/backend/assets/assets-manifest-builder.test.ts`

- [ ] **Step 1: Write the failing metadata schema test**

Add a focused test that parses a `subtitle_track` artifact with timing metadata:

```ts
expect(() =>
  AssetArtifact.parse({
    artifact_id: "artifact_subtitle_srt_001",
    artifact_type: "subtitle_track",
    origin: "provider",
    file_uri: "memory://subtitle.srt",
    created_at: "2026-05-19T00:00:00.000Z",
    metadata: {
      format: "srt",
      source_tts_artifact_id: "artifact_tts_merged",
      source_tts_chunk_artifact_ids: ["artifact_tts_chunk_001"],
      caption_count: 1,
      duration_sec: 3.2,
      timing_source: "audio_probe",
    },
  }),
).not.toThrow();
```

Also assert `tts_chunk_audio.metadata.timing_source="audio_probe"` parses.

- [ ] **Step 2: Run the focused test and verify red**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/assets-manifest-builder.test.ts
```

Expected: fail because `audio_probe` is not yet an accepted timing source or subtitle timing fields are not formalized.

- [ ] **Step 3: Extend shared metadata schema**

In `shared/src/assets/asset-manifest.schema.ts`, add a local timing enum:

```ts
const TimingSource = z.enum([
  "estimated",
  "audio_probe",
  "provider_timestamp",
  "forced_alignment",
  "provider",
  "aligned",
]);
```

Use it for TTS chunk, merged TTS, and subtitle metadata. Add optional `estimated_duration_sec` and `duration_source` to TTS metadata, and add `source_tts_chunk_artifact_ids`, `duration_sec`, and `timing_source` to subtitle metadata.

- [ ] **Step 4: Run the focused test and verify green**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/assets-manifest-builder.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add shared/src/assets/asset-manifest.schema.ts tests/backend/assets/assets-manifest-builder.test.ts
git commit -m "扩展音频计时元数据"
```

## Task 2: Assets-Local TTS Chunk Normalizer

**Files:**
- Create: `backend/src/modules/assets/tts-chunking.service.ts`
- Create: `tests/backend/assets/tts-chunking-service.test.ts`

- [ ] **Step 1: Write failing chunking tests**

Create tests for:

- short chunks remain unchanged;
- long chunks split on punctuation;
- very long punctuation-free text splits by max chars;
- estimated duration is distributed and sums to the original estimate;
- derived ids are stable.

Example assertion:

```ts
const result = normalizeTtsPlanForExecution({
  ttsPlan: {
    voice_profile_id: "voice_001",
    estimated_total_duration_sec: 12,
    chunks: [
      {
        chunk_id: "chunk_1",
        order: 0,
        script_excerpt: "第一句很短。第二句也很短。第三句继续推进。",
        estimated_duration_sec: 12,
      },
    ],
  },
  maxCharsPerChunk: 8,
});

expect(result.chunks.map((chunk) => chunk.chunk_id)).toEqual([
  "chunk_1_part_1",
  "chunk_1_part_2",
  "chunk_1_part_3",
]);
expect(result.chunks.reduce((sum, chunk) => sum + chunk.estimated_duration_sec, 0))
  .toBeCloseTo(12, 5);
```

- [ ] **Step 2: Run tests and verify red**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/tts-chunking-service.test.ts
```

Expected: fail because the service does not exist.

- [ ] **Step 3: Implement normalizer**

Create `normalizeTtsPlanForExecution(input)` with defaults:

```ts
const DEFAULT_MAX_CHARS_PER_CHUNK = 180;
const MIN_DURATION_SEC = 0.5;
```

Split text by sentence punctuation `/([。！？!?；;])/`, merge punctuation back into the preceding sentence, then pack sentences until adding the next sentence would exceed the max. For oversized sentences, slice by max chars. Preserve `voice_profile_id`; recompute `estimated_total_duration_sec` as the sum of normalized chunks.

- [ ] **Step 4: Run tests and verify green**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/tts-chunking-service.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/assets/tts-chunking.service.ts tests/backend/assets/tts-chunking-service.test.ts
git commit -m "新增 TTS 分块规范化"
```

## Task 3: Wire Normalized TTS Plan Into Assets Run

**Files:**
- Modify: `backend/src/modules/assets/assets-run.service.ts`
- Test: `tests/backend/assets/assets-run-service.test.ts`

- [ ] **Step 1: Write failing service integration test**

Add a dry-run test with one long `tts_plan.chunks` item and two sentences. Assert the resulting manifest has derived `tts_chunk_routes` ids and does not mutate the stored `assetPlanRecord.planJson`.

- [ ] **Step 2: Run test and verify red**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/assets-run-service.test.ts
```

Expected: fail because the manifest still uses the original single chunk.

- [ ] **Step 3: Apply normalized plan in service**

In `runAssetsGeneration()`, derive:

```ts
const executionAssetPlan = normalizeAssetPlanTtsForExecution(assetPlanRecord.planJson);
```

Use `executionAssetPlan` for `resolveVoiceProfile`, `buildInitialAssetManifest`, `executeAssetManifest`, and `validateAssetsManifest`. Keep `assetPlanRecord.planJson` unchanged in the database.

- [ ] **Step 4: Run service tests and verify green**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/assets-run-service.test.ts tests/backend/assets/assets-manifest-builder.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/assets/assets-run.service.ts tests/backend/assets/assets-run-service.test.ts
git commit -m "接入 TTS 执行分块"
```

## Task 4: Audio Duration Probe

**Files:**
- Create: `backend/src/modules/assets/audio-duration-probe.ts`
- Create: `tests/backend/assets/audio-duration-probe.test.ts`

- [ ] **Step 1: Write failing duration tests**

Use synthetic WAV bytes with a RIFF header and assert:

```ts
expect(readAudioDurationSec({
  data: wavBuffer,
  format: "wav",
  sampleRate: 24000,
})).toBeCloseTo(1.5, 3);
```

Add fallback tests for unknown data returning `null`.

- [ ] **Step 2: Run tests and verify red**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/audio-duration-probe.test.ts
```

- [ ] **Step 3: Implement WAV and PCM probing**

Implement:

```ts
export function readAudioDurationSec(input: {
  data: Buffer;
  format?: string;
  sampleRate?: number;
  bytesPerSample?: number;
  channels?: number;
}): number | null
```

For WAV, parse `RIFF`, `fmt `, and `data` chunks. For PCM, compute `data.length / (sampleRate * bytesPerSample * channels)`. Return `null` for unsupported or malformed inputs.

- [ ] **Step 4: Run tests and verify green**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/audio-duration-probe.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/assets/audio-duration-probe.ts tests/backend/assets/audio-duration-probe.test.ts
git commit -m "新增音频时长探测"
```

## Task 5: DashScope TTS Duration Metadata

**Files:**
- Modify: `backend/src/modules/assets/providers/dashscope/dashscope-tts-provider.ts`
- Test: `tests/backend/assets/dashscope-tts-provider.test.ts`

- [ ] **Step 1: Write failing provider tests**

Add a mocked DashScope test where downloaded WAV bytes represent 1.5 seconds, while `estimated_duration_sec` is 4. Assert chunk metadata:

```ts
expect(chunk.metadata.duration_sec).toBeCloseTo(1.5, 3);
expect(chunk.metadata.estimated_duration_sec).toBe(4);
expect(chunk.metadata.timing_source).toBe("audio_probe");
```

Also add an unknown-format fallback test asserting `duration_sec` remains estimated and `duration_probe_error` is present.

- [ ] **Step 2: Run tests and verify red**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/dashscope-tts-provider.test.ts
```

- [ ] **Step 3: Use audio duration probe**

After `downloadAudio()`, compute final duration:

```ts
const probedDurationSec = readAudioDurationSec({
  data: buffer,
  format: options.format ?? "wav",
  sampleRate: options.sampleRate ?? 24000,
});
const durationSec = probedDurationSec ?? chunk.estimated_duration_sec;
```

Set `estimated_duration_sec`, `duration_source`, `timing_source`, and optional `duration_probe_error`. Merged duration is the sum of final chunk durations.

- [ ] **Step 4: Run provider tests and verify green**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/dashscope-tts-provider.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/assets/providers/dashscope/dashscope-tts-provider.ts tests/backend/assets/dashscope-tts-provider.test.ts
git commit -m "回写 DashScope TTS 真实时长"
```

## Task 6: Subtitle Timing Metadata

**Files:**
- Modify: `backend/src/modules/assets/providers/local-subtitle-provider.ts`
- Modify if useful: `backend/src/modules/assets/assets-subtitle-generator.ts`
- Test: `tests/backend/assets/local-subtitle-provider.test.ts`

- [ ] **Step 1: Write failing subtitle provider test**

Create TTS chunk artifacts with `duration_sec` and `timing_source="audio_probe"`, execute local subtitle provider, and assert subtitle metadata:

```ts
expect(srt.metadata).toMatchObject({
  format: "srt",
  source_tts_chunk_artifact_ids: ["artifact_tts_chunk_001"],
  duration_sec: 3,
  timing_source: "audio_probe",
});
```

- [ ] **Step 2: Run tests and verify red**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/local-subtitle-provider.test.ts
```

- [ ] **Step 3: Write subtitle timing metadata**

When all source TTS chunks share a non-estimated timing source, propagate that source. Otherwise set subtitle `timing_source="estimated"`. Set `duration_sec` to the last cue end time and include `source_tts_chunk_artifact_ids`.

- [ ] **Step 4: Run tests and verify green**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/local-subtitle-provider.test.ts tests/backend/assets/assets-subtitle-generator.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/assets/providers/local-subtitle-provider.ts backend/src/modules/assets/assets-subtitle-generator.ts tests/backend/assets/local-subtitle-provider.test.ts
git commit -m "记录字幕计时来源"
```

## Task 7: Compose Timing Regression

**Files:**
- Modify: `tests/backend/compose/compose-timeline-builder.test.ts`
- Modify production only if the test exposes a gap: `backend/src/modules/compose/compose-timeline-builder.ts`

- [ ] **Step 1: Write compose regression test**

Create a manifest with two TTS chunk artifacts whose durations are 1.5 and 2.5 seconds, and a merged TTS duration of 4. Assert:

```ts
expect(timeline.duration_sec).toBe(4);
expect(timeline.segments.map((segment) => segment.duration_sec)).toEqual([
  1.5,
  2.5,
]);
expect(timeline.notes).not.toContain("compose_chunk_timing_fallback_used");
```

- [ ] **Step 2: Run test**

Run:

```bash
npx vitest run --configLoader runner tests/backend/compose/compose-timeline-builder.test.ts
```

Expected: pass if existing compose behavior already consumes chunk durations; otherwise fail and fix only the exposed gap.

- [ ] **Step 3: Commit**

```bash
git add tests/backend/compose/compose-timeline-builder.test.ts backend/src/modules/compose/compose-timeline-builder.ts
git commit -m "验证 compose 消费 TTS 时长"
```

Only stage the compose builder if it actually changed.

## Task 8: Docs and Final Regression

**Files:**
- Modify: `docs/data/field-design.md`
- Modify: `docs/data/schema-design.md`
- Modify: `docs/architecture/pipeline-io-spec.md`
- Modify: `docs/plans/README.md`
- Modify: `docs/records/2026-05-19-video-pipeline-follow-up-backlog.md`

- [ ] **Step 1: Update docs**

Document:

- assets-local chunk normalization;
- `audio_probe` timing source;
- `estimated / audio_probe / provider_timestamp / forced_alignment` layering;
- subtitle metadata timing fields;
- compose consuming chunk durations;
- no default real DashScope calls.

- [ ] **Step 2: Run focused regression**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/tts-chunking-service.test.ts tests/backend/assets/audio-duration-probe.test.ts tests/backend/assets/dashscope-tts-provider.test.ts tests/backend/assets/local-subtitle-provider.test.ts tests/backend/assets/assets-run-service.test.ts tests/backend/compose/compose-timeline-builder.test.ts
git diff --check
git status --short
```

Expected: all tests exit 0; no generated `storage/topic-candidate-library/` or `storage/voice-profiles/` files are staged.

- [ ] **Step 3: Commit**

```bash
git add docs/data/field-design.md docs/data/schema-design.md docs/architecture/pipeline-io-spec.md docs/plans/README.md docs/records/2026-05-19-video-pipeline-follow-up-backlog.md
git commit -m "同步 TTS 时长与字幕 timing 文档"
```

## Final Acceptance

The implementation is complete when:

- chunking tests prove deterministic sentence/max-char splitting;
- DashScope TTS mocked WAV tests prove real duration metadata;
- fallback tests prove unsupported formats remain estimated without failing;
- subtitle tests prove timing metadata is recorded;
- compose tests prove segment duration follows TTS chunk duration;
- default verification makes no real provider calls;
- docs and backlog are synchronized;
- `git diff --check` passes;
- every completed task has a Chinese commit.
