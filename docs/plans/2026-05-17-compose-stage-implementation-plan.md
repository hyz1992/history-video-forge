# Compose Stage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the first backend compose contract that turns an active `AssetManifestRecord` into a persisted `ComposeTimeline` without rendering final video.

**Architecture:** Compose v1 is timeline-first. It consumes active assets, derives timing from narration artifacts, places visual/audio/subtitle references into tracks, validates structure, persists a `ComposeRecord`, and exposes a generate API. It does not call providers, run Remotion, or export MP4.

**Tech Stack:** TypeScript, Zod shared schemas, Vitest, existing in-memory repository pattern, existing REST route pattern, existing project snapshot and trace conventions.

---

## Scope

This plan implements:

- shared `ComposeTimeline` and `ComposeValidationResult` schemas;
- compose timeline builder;
- compose local validator;
- compose record persistence;
- `POST /api/projects/:projectId/compose/generate`;
- project snapshot exposure;
- upstream invalidation for stale compose records;
- focused backend tests.

This plan does not implement:

- final video rendering;
- Remotion;
- DashScope image-to-video;
- BGM/SFX real generation;
- frontend compose preview UI;
- changes to topic/script/storyboard/asset planning semantics.

## File Structure

Expected create:

- `shared/src/compose/compose-timeline.schema.ts`
- `shared/src/compose/compose-validation.schema.ts`
- `backend/src/modules/compose/compose-timeline-builder.ts`
- `backend/src/modules/compose/compose-local-validator.ts`
- `backend/src/modules/compose/compose-record.repository.ts`
- `backend/src/modules/compose/compose-run.service.ts`
- `backend/src/modules/compose/compose.routes.ts`
- `tests/backend/compose/compose-timeline-builder.test.ts`
- `tests/backend/compose/compose-local-validator.test.ts`
- `tests/backend/api/compose-api.test.ts`

Expected modify:

- `shared/src/index.ts`
- `tests/shared/schema-contracts.test.ts`
- `backend/src/db/client.ts`
- `backend/prisma/schema.prisma`
- `backend/src/app.ts`
- `backend/src/modules/projects/project.repository.ts`
- `backend/src/modules/projects/project-snapshot.service.ts`
- upstream run services that already clear downstream pointers
- `tests/backend/repositories/repository-contracts.test.ts`
- `tests/backend/projects/project-snapshot.test.ts`
- affected upstream invalidation tests
- `docs/architecture/pipeline-io-spec.md`
- `docs/architecture/api-design.md`
- `docs/data/schema-design.md`
- `docs/data/field-design.md`
- `docs/plans/README.md`

## Task 1: Shared Compose Schemas

**Files:**

- Create: `shared/src/compose/compose-timeline.schema.ts`
- Create: `shared/src/compose/compose-validation.schema.ts`
- Modify: `shared/src/index.ts`
- Test: `tests/shared/schema-contracts.test.ts`

- [ ] **Step 1: Write failing schema tests**

Add tests to `tests/shared/schema-contracts.test.ts`:

```ts
import {
  ComposeTimeline,
  ComposeValidationResult,
} from "../../shared/src/index.js";

it("accepts a minimal compose timeline", () => {
  const result = ComposeTimeline.safeParse({
    timeline_version: "compose_timeline_v1",
    source_asset_manifest_record_id: "asset_manifest_001",
    source_asset_plan_record_id: "asset_plan_001",
    source_storyboard_record_id: "storyboard_001",
    source_script_record_id: "script_001",
    output_profile: {
      aspect_ratio: "9:16",
      width: 1080,
      height: 1920,
      fps: 30,
    },
    duration_sec: 12,
    tracks: [
      {
        track_id: "track_visual",
        track_type: "visual",
        clips: [
          {
            clip_id: "clip_visual_sb_001",
            segment_id: "sb_001",
            artifact_id: "artifact_img_001",
            start_sec: 0,
            duration_sec: 12,
            clip_kind: "image_with_motion",
            motion_artifact_id: "artifact_motion_001",
            notes: [],
          },
        ],
      },
      {
        track_id: "track_narration",
        track_type: "narration",
        clips: [
          {
            clip_id: "clip_narration",
            segment_id: null,
            artifact_id: "artifact_tts_merged",
            start_sec: 0,
            duration_sec: 12,
            clip_kind: "audio",
            motion_artifact_id: null,
            notes: [],
          },
        ],
      },
    ],
    segments: [
      {
        segment_id: "sb_001",
        start_sec: 0,
        duration_sec: 12,
        visual_clip_ids: ["clip_visual_sb_001"],
        narration_clip_ids: ["clip_narration"],
        subtitle_clip_ids: [],
        notes: [],
      },
    ],
    readiness: "ready_for_render",
    notes: [],
  });

  expect(result.success).toBe(true);
});

it("rejects compose timelines with invalid clip timing", () => {
  const result = ComposeTimeline.safeParse({
    timeline_version: "compose_timeline_v1",
    source_asset_manifest_record_id: "asset_manifest_001",
    source_asset_plan_record_id: "asset_plan_001",
    source_storyboard_record_id: "storyboard_001",
    source_script_record_id: "script_001",
    output_profile: { aspect_ratio: "9:16", width: 1080, height: 1920, fps: 30 },
    duration_sec: 12,
    tracks: [
      {
        track_id: "track_visual",
        track_type: "visual",
        clips: [
          {
            clip_id: "clip_bad",
            segment_id: "sb_001",
            artifact_id: "artifact_img_001",
            start_sec: -1,
            duration_sec: 12,
            clip_kind: "image_only",
            motion_artifact_id: null,
            notes: [],
          },
        ],
      },
    ],
    segments: [],
    readiness: "blocked",
    notes: [],
  });

  expect(result.success).toBe(false);
});

it("accepts a compose validation result", () => {
  const result = ComposeValidationResult.safeParse({
    stage: "compose_local_validation",
    decision: "ready_for_render",
    errors: [],
    warnings: [],
    metrics: {
      track_count: 2,
      clip_count: 2,
      segment_count: 1,
      duration_sec: 12,
    },
  });

  expect(result.success).toBe(true);
});
```

- [ ] **Step 2: Run focused test and confirm failure**

Run:

```bash
npx vitest run --configLoader runner tests/shared/schema-contracts.test.ts
```

Expected: fail because compose schemas are not exported.

- [ ] **Step 3: Implement schemas**

Create `shared/src/compose/compose-timeline.schema.ts`:

```ts
import { z } from "zod";

export const ComposeReadiness = z.enum([
  "ready_for_render",
  "partial",
  "blocked",
]);

export const ComposeTrackType = z.enum([
  "visual",
  "narration",
  "subtitle",
  "bgm",
  "sfx",
]);

export const ComposeClipKind = z.enum([
  "video",
  "image_with_motion",
  "image_only",
  "audio",
  "subtitle",
]);

export const ComposeClip = z
  .object({
    clip_id: z.string().min(1),
    segment_id: z.string().min(1).nullable(),
    artifact_id: z.string().min(1),
    start_sec: z.number().nonnegative(),
    duration_sec: z.number().positive(),
    clip_kind: ComposeClipKind,
    motion_artifact_id: z.string().min(1).nullable(),
    notes: z.array(z.string()),
  })
  .strict();

export const ComposeTrack = z
  .object({
    track_id: z.string().min(1),
    track_type: ComposeTrackType,
    clips: z.array(ComposeClip),
  })
  .strict();

export const ComposeTimelineSegment = z
  .object({
    segment_id: z.string().min(1),
    start_sec: z.number().nonnegative(),
    duration_sec: z.number().positive(),
    visual_clip_ids: z.array(z.string().min(1)),
    narration_clip_ids: z.array(z.string().min(1)),
    subtitle_clip_ids: z.array(z.string().min(1)),
    notes: z.array(z.string()),
  })
  .strict();

export const ComposeTimeline = z
  .object({
    timeline_version: z.literal("compose_timeline_v1"),
    source_asset_manifest_record_id: z.string().min(1),
    source_asset_plan_record_id: z.string().min(1),
    source_storyboard_record_id: z.string().min(1),
    source_script_record_id: z.string().min(1),
    output_profile: z
      .object({
        aspect_ratio: z.literal("9:16"),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        fps: z.number().positive(),
      })
      .strict(),
    duration_sec: z.number().positive(),
    tracks: z.array(ComposeTrack),
    segments: z.array(ComposeTimelineSegment),
    readiness: ComposeReadiness,
    notes: z.array(z.string()),
  })
  .strict();

export type ComposeTimeline = z.infer<typeof ComposeTimeline>;
export type ComposeTrack = z.infer<typeof ComposeTrack>;
export type ComposeClip = z.infer<typeof ComposeClip>;
export type ComposeTimelineSegment = z.infer<typeof ComposeTimelineSegment>;
export type ComposeReadiness = z.infer<typeof ComposeReadiness>;
```

Create `shared/src/compose/compose-validation.schema.ts`:

```ts
import { z } from "zod";

export const ComposeValidationResult = z
  .object({
    stage: z.literal("compose_local_validation"),
    decision: z.enum(["ready_for_render", "partial", "blocked"]),
    errors: z.array(z.string()),
    warnings: z.array(z.string()),
    metrics: z.record(z.string(), z.unknown()),
  })
  .strict();

export type ComposeValidationResult = z.infer<typeof ComposeValidationResult>;
```

Export both files from `shared/src/index.ts`:

```ts
export * from "./compose/compose-timeline.schema.js";
export * from "./compose/compose-validation.schema.js";
```

- [ ] **Step 4: Verify**

Run:

```bash
npx vitest run --configLoader runner tests/shared/schema-contracts.test.ts
git diff --check
```

Expected: tests pass and no whitespace errors.

- [ ] **Step 5: Commit**

```bash
git add shared/src/compose shared/src/index.ts tests/shared/schema-contracts.test.ts
git commit -m "新增 compose 共享 timeline schema"
```

## Task 2: Compose Timeline Builder

**Files:**

- Create: `backend/src/modules/compose/compose-timeline-builder.ts`
- Test: `tests/backend/compose/compose-timeline-builder.test.ts`

- [ ] **Step 1: Write failing builder tests**

Create `tests/backend/compose/compose-timeline-builder.test.ts` with fixtures for:

- one merged TTS artifact with `duration_sec: 12`;
- one TTS chunk artifact for segment `sb_001`;
- one subtitle artifact;
- one image artifact;
- one motion recipe artifact;
- one segment route with `visual_route_type: "image_with_motion"`.

Core assertion:

```ts
const timeline = buildComposeTimeline({
  assetManifestRecordId: "asset_manifest_001",
  assetPlanRecordId: "asset_plan_001",
  storyboardRecordId: "storyboard_001",
  scriptRecordId: "script_001",
  manifest: makeReadyAssetManifest(),
});

expect(timeline).toMatchObject({
  timeline_version: "compose_timeline_v1",
  duration_sec: 12,
  readiness: "ready_for_render",
});
expect(timeline.tracks.find((track) => track.track_type === "visual")?.clips[0]).toMatchObject({
  segment_id: "sb_001",
  artifact_id: "artifact_img_001",
  duration_sec: 12,
  clip_kind: "image_with_motion",
  motion_artifact_id: "artifact_motion_001",
});
expect(timeline.tracks.find((track) => track.track_type === "narration")?.clips[0]).toMatchObject({
  artifact_id: "artifact_tts_merged",
  start_sec: 0,
  duration_sec: 12,
});
```

Add another test where chunk durations are missing but merged duration exists. Expect one warning note containing `compose_chunk_timing_fallback_used`.

- [ ] **Step 2: Run failing test**

Run:

```bash
npx vitest run --configLoader runner tests/backend/compose/compose-timeline-builder.test.ts
```

Expected: fail because builder does not exist.

- [ ] **Step 3: Implement builder**

Implement:

```ts
export interface BuildComposeTimelineInput {
  assetManifestRecordId: string;
  assetPlanRecordId: string;
  storyboardRecordId: string;
  scriptRecordId: string;
  manifest: AssetManifest;
}

export function buildComposeTimeline(input: BuildComposeTimelineInput): ComposeTimeline
```

Rules:

- create output profile `{ aspect_ratio: "9:16", width: 1080, height: 1920, fps: 30 }`;
- total duration comes from merged TTS artifact metadata `duration_sec`;
- segment duration uses matching `tts_chunk_audio.metadata.duration_sec` when available;
- segment start times are cumulative in `manifest.segment_routes` order;
- visual track is built from segment routes;
- narration track uses `audio_summary.tts_merged_artifact_id`;
- subtitle track uses `audio_summary.subtitle_artifact_id`;
- BGM/SFX tracks are optional and added only when artifact ids exist;
- set timeline `readiness` to `ready_for_render` initially; validator can downgrade later.

- [ ] **Step 4: Verify**

Run:

```bash
npx vitest run --configLoader runner tests/backend/compose/compose-timeline-builder.test.ts
git diff --check
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/compose/compose-timeline-builder.ts tests/backend/compose/compose-timeline-builder.test.ts
git commit -m "新增 compose timeline 构建器"
```

## Task 3: Compose Local Validator

**Files:**

- Create: `backend/src/modules/compose/compose-local-validator.ts`
- Test: `tests/backend/compose/compose-local-validator.test.ts`

- [ ] **Step 1: Write failing validator tests**

Create tests for:

- missing narration artifact produces `compose_narration_missing`;
- missing narration duration produces `compose_narration_duration_missing`;
- missing subtitle artifact produces `compose_subtitle_missing`;
- missing segment visual produces `compose_segment_visual_missing`;
- missing referenced artifact produces `compose_artifact_missing`;
- missing optional BGM only produces `compose_bgm_missing_optional`;
- valid timeline returns `ready_for_render`.

Core assertion:

```ts
const result = await validateComposeTimeline({
  manifest: makeReadyAssetManifest(),
  timeline: makeReadyTimeline(),
  projectStorageRootDir: tempDir,
});

expect(result).toMatchObject({
  stage: "compose_local_validation",
  decision: "ready_for_render",
  errors: [],
});
```

- [ ] **Step 2: Run failing test**

Run:

```bash
npx vitest run --configLoader runner tests/backend/compose/compose-local-validator.test.ts
```

Expected: fail because validator does not exist.

- [ ] **Step 3: Implement validator**

Implement:

```ts
export interface ValidateComposeTimelineInput {
  manifest: AssetManifest;
  timeline: ComposeTimeline;
  projectStorageRootDir?: string;
}

export async function validateComposeTimeline(
  input: ValidateComposeTimelineInput,
): Promise<ComposeValidationResult>
```

Rules:

- every timeline clip `artifact_id` must exist in `manifest.artifacts`;
- narration track must exist and include the merged TTS artifact;
- subtitle track must exist when `audio_summary.subtitle_artifact_id` is set;
- every segment must have at least one visual clip;
- `duration_sec` must be positive and at least as long as the last clip end;
- if `projectStorageRootDir` is supplied, verify referenced local file paths exist for provider/local/manual/library artifacts;
- do not inspect visual/audio quality.

- [ ] **Step 4: Verify**

Run:

```bash
npx vitest run --configLoader runner tests/backend/compose/compose-local-validator.test.ts
git diff --check
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/compose/compose-local-validator.ts tests/backend/compose/compose-local-validator.test.ts
git commit -m "新增 compose 本地结构校验"
```

## Task 4: Compose Persistence and Snapshot

**Files:**

- Create: `backend/src/modules/compose/compose-record.repository.ts`
- Modify: `backend/src/db/client.ts`
- Modify: `backend/prisma/schema.prisma`
- Modify: `backend/src/modules/projects/project.repository.ts`
- Modify: `backend/src/modules/projects/project-snapshot.service.ts`
- Test: `tests/backend/repositories/repository-contracts.test.ts`
- Test: `tests/backend/projects/project-snapshot.test.ts`

- [ ] **Step 1: Write failing repository and snapshot tests**

Repository test:

```ts
const record = await saveComposeRecord(db, {
  projectId: "project_001",
  assetManifestRecordId: "asset_manifest_001",
  timelineJson: makeReadyTimeline(),
  validationResultJson: makeReadyComposeValidation(),
  executionStateJson: { activated: true },
  graphTraceSummaryJson: { phase: "compose", nodes: [] },
  runtimeDiagnosticsJson: null,
});

expect(record.id).toBeTruthy();
expect(await getComposeRecordById(db, record.id)).toMatchObject({
  assetManifestRecordId: "asset_manifest_001",
});
```

Snapshot test:

- project with `activeComposeRecordId` exposes `active_compose`;
- stale compose pointer cleared means snapshot does not expose `active_compose`.

- [ ] **Step 2: Run failing tests**

Run:

```bash
npx vitest run --configLoader runner tests/backend/repositories/repository-contracts.test.ts tests/backend/projects/project-snapshot.test.ts
```

- [ ] **Step 3: Implement persistence**

Add `ComposeRecord` to `backend/src/db/client.ts`:

```ts
export interface ComposeRecord {
  id: string;
  projectId: string;
  assetManifestRecordId: string;
  timelineJson: Record<string, unknown>;
  validationResultJson: Record<string, unknown>;
  executionStateJson: Record<string, unknown> | null;
  graphTraceSummaryJson: Record<string, unknown> | null;
  runtimeDiagnosticsJson: Record<string, unknown> | null;
  createdAt: Date;
}
```

Add:

- `composeRecords: Map<string, ComposeRecord>`
- `ProjectRecord.activeComposeRecordId`
- `ProjectRecord.latestComposeRunTraceJson`

Add Prisma parity model `ComposeRecord` with JSON columns matching existing record patterns.

Create repository functions:

- `saveComposeRecord`
- `getComposeRecordById`

Update project snapshot to include:

```ts
active_compose: {
  compose_record_id: record.id,
  timeline: record.timelineJson,
  validation_result: record.validationResultJson,
  execution_state: record.executionStateJson,
} | null
```

- [ ] **Step 4: Verify**

Run:

```bash
npx vitest run --configLoader runner tests/backend/repositories/repository-contracts.test.ts tests/backend/projects/project-snapshot.test.ts
git diff --check
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/db/client.ts backend/prisma/schema.prisma backend/src/modules/compose/compose-record.repository.ts backend/src/modules/projects/project.repository.ts backend/src/modules/projects/project-snapshot.service.ts tests/backend/repositories/repository-contracts.test.ts tests/backend/projects/project-snapshot.test.ts
git commit -m "新增 compose 记录持久化与快照"
```

## Task 5: Compose Generate API

**Files:**

- Create: `backend/src/modules/compose/compose-run.service.ts`
- Create: `backend/src/modules/compose/compose.routes.ts`
- Modify: `backend/src/app.ts`
- Test: `tests/backend/api/compose-api.test.ts`

- [ ] **Step 1: Write failing API tests**

Cover:

- missing project returns `404 project_not_found`;
- missing active assets returns `409 active_assets_missing`;
- valid active assets creates, validates, persists, and activates compose timeline;
- stale active asset manifest returns `409 stale_compose_source` and does not activate;
- blocked validation sets project status `compose_blocked`;
- ready validation sets project status `compose_ready`.

Core happy-path assertion:

```ts
const response = await app.inject({
  method: "POST",
  url: `/api/projects/${project.id}/compose/generate`,
  payload: {},
});

expect(response.statusCode).toBe(200);
const body = response.json();
expect(body).toMatchObject({
  project_id: project.id,
  source_asset_manifest_record_id: assetManifestRecord.id,
  timeline: {
    timeline_version: "compose_timeline_v1",
  },
  local_validation: {
    stage: "compose_local_validation",
  },
  graph_trace_summary: {
    phase: "compose",
  },
});
expect(project.activeComposeRecordId).toBe(body.compose_record_id);
```

- [ ] **Step 2: Run failing test**

Run:

```bash
npx vitest run --configLoader runner tests/backend/api/compose-api.test.ts
```

Expected: fail because route/service do not exist.

- [ ] **Step 3: Implement service and route**

Service function:

```ts
export interface RunComposeGenerationInput {
  db: DbClient;
  project: ProjectRecord;
}

export async function runComposeGeneration(input: RunComposeGenerationInput)
```

Flow:

1. check `project.activeAssetManifestRecordId`;
2. load `AssetManifestRecord`;
3. capture active asset manifest id for stale check;
4. build timeline;
5. validate timeline;
6. recheck active asset manifest id;
7. save compose record;
8. set `project.activeComposeRecordId`;
9. set status `compose_ready` or `compose_blocked`;
10. write `latestComposeRunTraceJson`.

Route:

```ts
POST /api/projects/:projectId/compose/generate
```

Register it in `backend/src/app.ts`.

- [ ] **Step 4: Verify**

Run:

```bash
npx vitest run --configLoader runner tests/backend/api/compose-api.test.ts
git diff --check
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/compose/compose-run.service.ts backend/src/modules/compose/compose.routes.ts backend/src/app.ts tests/backend/api/compose-api.test.ts
git commit -m "新增 compose timeline 生成 API"
```

## Task 6: Upstream Invalidation

**Files:**

- Modify: `backend/src/modules/projects/project.repository.ts`
- Modify: existing script/storyboard/asset-planning/assets run services that clear downstream pointers
- Test: existing upstream invalidation tests

- [ ] **Step 1: Write failing invalidation tests**

Assert:

- new script activation clears active storyboard, asset plan, asset manifest, and compose pointers;
- new storyboard activation clears active asset plan, asset manifest, and compose pointers;
- new asset plan activation clears active asset manifest and compose pointers;
- new asset manifest activation clears active compose pointer;
- latest compose trace is cleared with the pointer.

- [ ] **Step 2: Run failing tests**

Run the affected existing tests:

```bash
npx vitest run --configLoader runner tests/backend/script/script-runtime-generate.test.ts tests/backend/api/storyboard-api.test.ts tests/backend/api/asset-planning-api.test.ts tests/backend/api/assets-api.test.ts
```

- [ ] **Step 3: Implement invalidation**

Extend existing downstream clearing helpers to include:

```ts
project.activeComposeRecordId = null;
project.latestComposeRunTraceJson = null;
```

Do not delete historical compose records.

- [ ] **Step 4: Verify**

Run:

```bash
npx vitest run --configLoader runner tests/backend/script/script-runtime-generate.test.ts tests/backend/api/storyboard-api.test.ts tests/backend/api/asset-planning-api.test.ts tests/backend/api/assets-api.test.ts
git diff --check
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/projects/project.repository.ts backend/src/modules/script/script-run.service.ts backend/src/modules/storyboard/storyboard-run.service.ts backend/src/modules/asset-planning/asset-planning-run.service.ts backend/src/modules/assets/assets-run.service.ts tests/backend/script/script-runtime-generate.test.ts tests/backend/api/storyboard-api.test.ts tests/backend/api/asset-planning-api.test.ts tests/backend/api/assets-api.test.ts
git commit -m "补充 compose 上游失效规则"
```

## Task 7: Architecture and API Docs

**Files:**

- Modify: `docs/architecture/pipeline-io-spec.md`
- Modify: `docs/architecture/api-design.md`
- Modify: `docs/data/schema-design.md`
- Modify: `docs/data/field-design.md`
- Modify: `docs/architecture/downstream-stage-high-level-design.md`
- Modify: `docs/plans/README.md`

- [ ] **Step 1: Update docs**

Document:

- compose input/output;
- `ComposeTimeline`;
- `ComposeValidationResult`;
- `ComposeRecord`;
- `POST /api/projects/:projectId/compose/generate`;
- stale source rules;
- explicit non-goals: no render, no Remotion, no DashScope I2V in v1.

- [ ] **Step 2: Verify docs**

Run:

```bash
git diff --check
git status --short
```

Confirm no generated runtime output or `storage/topic-candidate-library/` files are staged.

- [ ] **Step 3: Commit**

```bash
git add docs/architecture/pipeline-io-spec.md docs/architecture/api-design.md docs/data/schema-design.md docs/data/field-design.md docs/architecture/downstream-stage-high-level-design.md docs/plans/README.md
git commit -m "补充 compose 阶段架构文档"
```

## Task 8: Regression

**Files:** no planned production changes.

- [ ] **Step 1: Run compose-focused tests**

```bash
npx vitest run --configLoader runner tests/shared/schema-contracts.test.ts tests/backend/compose tests/backend/api/compose-api.test.ts
```

- [ ] **Step 2: Run affected downstream tests**

```bash
npx vitest run --configLoader runner tests/backend/assets tests/backend/api/assets-api.test.ts tests/backend/projects/project-snapshot.test.ts
```

- [ ] **Step 3: Run final diff checks**

```bash
git diff --check
git status --short
```

Expected:

- focused tests pass;
- no whitespace errors;
- no generated runtime output is staged;
- `.env` remains ignored.

## Completion Criteria

- `ComposeTimeline` and `ComposeValidationResult` are exported shared contracts.
- Compose timeline can be built from an active `AssetManifest`.
- Compose validator blocks missing narration, subtitle, visual, and invalid artifact references.
- Compose records are persisted and exposed in project snapshot.
- Compose generate API activates only stable-source results.
- Upstream changes clear stale compose pointers.
- No renderer, provider call, or final MP4 export is implemented.
