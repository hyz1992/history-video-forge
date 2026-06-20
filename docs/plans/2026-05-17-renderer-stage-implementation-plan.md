# Renderer / Export Stage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the first local renderer/export slice that turns an active `ComposeTimeline` into a persisted MP4 render artifact.

**Architecture:** Renderer v1 consumes the active compose record, validates referenced asset files, renders still images with deterministic motion recipes plus narration and subtitles, probes the output, persists a render job record, and exposes one generate API. It does not call DashScope image-to-video or generate missing assets.

**Tech Stack:** TypeScript, Zod shared schemas, Vitest, existing in-memory repository pattern, existing REST route pattern, existing project snapshot and trace conventions, local renderer adapter with a Remotion-compatible boundary.

---

## Scope

This plan implements:

- shared render/export schemas;
- render source validation;
- render job persistence;
- renderer adapter interface;
- first local rendering service boundary;
- local Remotion adapter for real MP4 output;
- `POST /api/projects/:projectId/render/generate`;
- project snapshot exposure;
- upstream invalidation for stale render records;
- a fake renderer runtime smoke for deterministic backend CI;
- a local Remotion smoke for real MP4 export verification.

This plan does not implement:

- DashScope image-to-video;
- frontend preview UI;
- upload UI;
- platform publishing;
- aesthetic or semantic review;
- changes to topic/script/storyboard/asset planning/assets/compose semantics.

## File Structure

Expected create:

- `shared/src/render/render-job.schema.ts`
- `shared/src/render/render-validation.schema.ts`
- `backend/src/modules/render/render-source-validator.ts`
- `backend/src/modules/render/render-record.repository.ts`
- `backend/src/modules/render/render-adapter.ts`
- `backend/src/modules/render/fake-render-adapter.ts`
- `backend/src/modules/render/local-remotion-render-adapter.ts`
- `renderer/package.json`
- `renderer/src/Root.tsx`
- `renderer/src/TimelineVideo.tsx`
- `renderer/src/timeline-props.ts`
- `renderer/remotion.config.ts`
- `backend/src/modules/render/render-run.service.ts`
- `backend/src/modules/render/render.routes.ts`
- `tests/backend/render/render-source-validator.test.ts`
- `tests/backend/render/render-run-service.test.ts`
- `tests/backend/render/local-remotion-render-adapter.test.ts`
- `tests/backend/api/render-api.test.ts`
- `harness/scripts/runtime/render-runtime-smoke.ts`
- `tests/harness/render-runtime-smoke.test.ts`

Expected modify:

- `shared/src/index.ts`
- `tests/shared/schema-contracts.test.ts`
- `backend/src/db/client.ts`
- `backend/prisma/schema.prisma`
- `backend/src/app.ts`
- `backend/src/modules/projects/project.repository.ts`
- `backend/src/modules/projects/project-snapshot.service.ts`
- upstream run services that clear downstream pointers
- `tests/backend/repositories/repository-contracts.test.ts`
- `tests/backend/projects/project-snapshot.test.ts`
- affected upstream invalidation tests
- `package.json`
- `backend/package.json`
- root or workspace TypeScript config only if Remotion compilation requires it
- formal docs after implementation

## Task 1: Shared Render Schemas

**Files:**

- Create: `shared/src/render/render-job.schema.ts`
- Create: `shared/src/render/render-validation.schema.ts`
- Modify: `shared/src/index.ts`
- Test: `tests/shared/schema-contracts.test.ts`

- [ ] **Step 1: Write failing schema tests**

Add tests to `tests/shared/schema-contracts.test.ts`:

```ts
import { ExportArtifact, RenderValidationResult } from "../../shared/src/index.js";

it("accepts a rendered video export artifact", () => {
  const result = ExportArtifact.safeParse({
    artifact_id: "render_export_001",
    artifact_type: "rendered_video",
    file_uri: "file://storage/projects/proj_001/renders/render_001/output.mp4",
    mime_type: "video/mp4",
    duration_sec: 12,
    width: 1080,
    height: 1920,
    fps: 30,
    source_compose_record_id: "compose_001",
    source_asset_manifest_record_id: "asset_manifest_001",
    metadata: { renderer: "fake" },
  });

  expect(result.success).toBe(true);
});

it("accepts a render validation result", () => {
  const result = RenderValidationResult.safeParse({
    stage: "render_local_validation",
    decision: "rendered",
    errors: [],
    warnings: [],
    metrics: {
      duration_sec: 12,
      width: 1080,
      height: 1920,
      fps: 30,
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

Expected: fail because render schemas are not exported.

- [ ] **Step 3: Implement schemas**

Create `shared/src/render/render-job.schema.ts`:

```ts
import { z } from "zod";

export const RenderJobStatus = z.enum([
  "queued",
  "rendering",
  "completed",
  "failed",
  "stale_source",
]);

export const ExportArtifact = z
  .object({
    artifact_id: z.string().min(1),
    artifact_type: z.literal("rendered_video"),
    file_uri: z.string().min(1),
    mime_type: z.literal("video/mp4"),
    duration_sec: z.number().positive(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    fps: z.number().positive(),
    source_compose_record_id: z.string().min(1),
    source_asset_manifest_record_id: z.string().min(1),
    metadata: z.record(z.string(), z.unknown()),
  })
  .strict();

export type RenderJobStatus = z.infer<typeof RenderJobStatus>;
export type ExportArtifact = z.infer<typeof ExportArtifact>;
```

Create `shared/src/render/render-validation.schema.ts`:

```ts
import { z } from "zod";

export const RenderValidationResult = z
  .object({
    stage: z.literal("render_local_validation"),
    decision: z.enum(["ready_to_render", "rendered", "blocked", "failed"]),
    errors: z.array(z.string()),
    warnings: z.array(z.string()),
    metrics: z.record(z.string(), z.unknown()),
  })
  .strict();

export type RenderValidationResult = z.infer<typeof RenderValidationResult>;
```

Export both files from `shared/src/index.ts`:

```ts
export * from "./render/render-job.schema.js";
export * from "./render/render-validation.schema.js";
```

- [ ] **Step 4: Verify**

Run:

```bash
npx vitest run --configLoader runner tests/shared/schema-contracts.test.ts
git diff --check
```

Expected: focused tests pass and no whitespace errors.

## Task 2: Render Source Validator

**Files:**

- Create: `backend/src/modules/render/render-source-validator.ts`
- Test: `tests/backend/render/render-source-validator.test.ts`

- [ ] **Step 1: Write failing validator tests**

Create tests for:

- missing active compose returns `render_active_compose_missing`;
- missing compose record returns `render_compose_record_missing`;
- compose timeline with `blocked` readiness returns `render_timeline_not_ready`;
- missing asset artifact returns `render_artifact_missing`;
- missing local file returns `render_artifact_file_missing`;
- valid compose + manifest returns `ready_to_render`;
- missing optional BGM produces `render_bgm_missing_optional` warning only.

Core assertion:

```ts
const result = await validateRenderSources({
  composeRecord: makeReadyComposeRecord(),
  assetManifestRecord: makeReadyAssetManifestRecord(),
  projectStorageRootDir: tempDir,
});

expect(result).toMatchObject({
  stage: "render_local_validation",
  decision: "ready_to_render",
  errors: [],
});
```

- [ ] **Step 2: Run failing test**

Run:

```bash
npx vitest run --configLoader runner tests/backend/render/render-source-validator.test.ts
```

Expected: fail because validator does not exist.

- [ ] **Step 3: Implement validator**

Create:

```ts
export interface ValidateRenderSourcesInput {
  composeRecord: ComposeRecord | null;
  assetManifestRecord: AssetManifestRecord | null;
  projectStorageRootDir?: string;
}

export async function validateRenderSources(
  input: ValidateRenderSourcesInput,
): Promise<RenderValidationResult>
```

Rules:

- require compose record and source asset manifest record;
- require timeline readiness `ready_for_render`;
- every clip artifact in timeline must exist in `manifest.artifacts`;
- local `file://` or relative file references must exist when `projectStorageRootDir` is supplied;
- narration and subtitle clips are required;
- optional BGM/SFX missing warnings do not block.

- [ ] **Step 4: Verify**

Run:

```bash
npx vitest run --configLoader runner tests/backend/render/render-source-validator.test.ts
git diff --check
```

Expected: pass.

## Task 3: Render Persistence and Snapshot

**Files:**

- Create: `backend/src/modules/render/render-record.repository.ts`
- Modify: `backend/src/db/client.ts`
- Modify: `backend/prisma/schema.prisma`
- Modify: `backend/src/modules/projects/project.repository.ts`
- Modify: `backend/src/modules/projects/project-snapshot.service.ts`
- Test: `tests/backend/repositories/repository-contracts.test.ts`
- Test: `tests/backend/projects/project-snapshot.test.ts`

- [ ] **Step 1: Write failing repository and snapshot tests**

Repository assertion:

```ts
const record = await saveRenderJobRecord(db, {
  projectId: "project_001",
  composeRecordId: "compose_001",
  assetManifestRecordId: "asset_manifest_001",
  status: "completed",
  profileJson: { width: 1080, height: 1920, fps: 30 },
  outputArtifactJson: makeExportArtifact(),
  validationResultJson: makeRenderedValidation(),
  executionStateJson: { activated: true },
  graphTraceSummaryJson: { phase: "render", nodes: [] },
  runtimeDiagnosticsJson: null,
});

expect(record.id).toBeTruthy();
expect(await getRenderJobRecordById(db, record.id)).toMatchObject({
  composeRecordId: "compose_001",
  status: "completed",
});
```

Snapshot assertions:

- project with `activeRenderJobRecordId` exposes `active_render`;
- stale render pointer cleared means snapshot does not expose `active_render`.

- [ ] **Step 2: Run failing tests**

Run:

```bash
npx vitest run --configLoader runner tests/backend/repositories/repository-contracts.test.ts tests/backend/projects/project-snapshot.test.ts
```

- [ ] **Step 3: Implement persistence**

Add `RenderJobRecord` to `backend/src/db/client.ts`:

```ts
export interface RenderJobRecord {
  id: string;
  projectId: string;
  composeRecordId: string;
  assetManifestRecordId: string;
  status: "queued" | "rendering" | "completed" | "failed" | "stale_source";
  profileJson: Record<string, unknown>;
  outputArtifactJson: Record<string, unknown> | null;
  validationResultJson: Record<string, unknown>;
  executionStateJson: Record<string, unknown> | null;
  graphTraceSummaryJson: Record<string, unknown> | null;
  runtimeDiagnosticsJson: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}
```

Add:

- `renderJobRecords: Map<string, RenderJobRecord>`
- `ProjectRecord.activeRenderJobRecordId`
- `ProjectRecord.latestRenderRunTraceJson`

Add Prisma parity model `RenderJobRecord` with JSON columns matching existing record patterns.

Create repository functions:

- `saveRenderJobRecord`
- `getRenderJobRecordById`

Update project snapshot to include:

```ts
active_render: {
  render_job_record_id: record.id,
  status: record.status,
  output_artifact: record.outputArtifactJson,
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

## Task 4: Renderer Adapter Boundary

**Files:**

- Create: `backend/src/modules/render/render-adapter.ts`
- Create: `backend/src/modules/render/fake-render-adapter.ts`
- Test: `tests/backend/render/render-run-service.test.ts`

- [ ] **Step 1: Write failing adapter tests**

Test that fake adapter writes a deterministic MP4-like fixture file for runtime smoke without requiring Remotion:

```ts
const adapter = createFakeRenderAdapter();
const result = await adapter.render({
  projectId: "project_001",
  composeRecord: makeReadyComposeRecord(),
  assetManifestRecord: makeReadyAssetManifestRecord(),
  outputDir: tempDir,
  profile: { width: 1080, height: 1920, fps: 30 },
});

expect(result.outputArtifact.file_uri).toContain("output.mp4");
expect(result.probe.duration_sec).toBe(12);
```

- [ ] **Step 2: Run failing test**

Run:

```bash
npx vitest run --configLoader runner tests/backend/render/render-run-service.test.ts
```

Expected: fail because adapter does not exist.

- [ ] **Step 3: Implement adapter interface**

Create:

```ts
export interface RenderProfile {
  width: number;
  height: number;
  fps: number;
}

export interface RenderProbeResult {
  duration_sec: number;
  width: number;
  height: number;
  fps: number;
}

export interface RenderAdapterResult {
  outputArtifact: ExportArtifact;
  probe: RenderProbeResult;
  diagnostics: Record<string, unknown>;
}

export interface RenderAdapter {
  render(input: {
    projectId: string;
    composeRecord: ComposeRecord;
    assetManifestRecord: AssetManifestRecord;
    outputDir: string;
    profile: RenderProfile;
  }): Promise<RenderAdapterResult>;
}
```

The fake adapter should create the output directory, write a deterministic fixture `output.mp4`, and return probe metadata derived from the timeline duration and profile. The local Remotion adapter in the next task must use the same interface.

- [ ] **Step 4: Verify**

Run:

```bash
npx vitest run --configLoader runner tests/backend/render/render-run-service.test.ts
git diff --check
```

## Task 5: Local Remotion Adapter

**Files:**

- Create: `backend/src/modules/render/local-remotion-render-adapter.ts`
- Create: `renderer/src/Root.tsx`
- Create: `renderer/src/TimelineVideo.tsx`
- Create: `renderer/src/timeline-props.ts`
- Create: `renderer/remotion.config.ts`
- Modify: `package.json`
- Test: `tests/backend/render/local-remotion-render-adapter.test.ts`

- [ ] **Step 1: Write failing adapter integration test**

Create a test that renders a two-second fixture timeline with one image, one narration fixture, and one subtitle fixture into a temporary output directory.

Core assertion:

```ts
const adapter = createLocalRemotionRenderAdapter();
const result = await adapter.render({
  projectId: "project_001",
  composeRecord: makeReadyComposeRecord({ durationSec: 2 }),
  assetManifestRecord: makeReadyAssetManifestRecordWithFixtureFiles(tempDir),
  outputDir: tempDir,
  profile: { width: 540, height: 960, fps: 30 },
});

expect(result.outputArtifact.mime_type).toBe("video/mp4");
expect(result.outputArtifact.file_uri).toContain("output.mp4");
expect(result.probe.duration_sec).toBeGreaterThan(1.8);
expect(result.probe.width).toBe(540);
expect(result.probe.height).toBe(960);
```

Use tiny local fixture files generated inside the test temp directory. Do not call external providers.

- [ ] **Step 2: Run failing test**

Run:

```bash
npx vitest run --configLoader runner tests/backend/render/local-remotion-render-adapter.test.ts
```

Expected: fail because the local Remotion adapter and renderer entry files do not exist.

- [ ] **Step 3: Add renderer dependencies and scripts**

Create `renderer/package.json` as a dedicated workspace package for Remotion composition code:

```json
{
  "name": "@history-video-forge/renderer",
  "private": true,
  "version": "0.1.0",
  "type": "module"
}
```

Add `renderer` to the root `package.json` workspaces:

```json
{
  "workspaces": [
    "backend",
    "frontend",
    "shared",
    "renderer"
  ]
}
```

Install the runtime dependency used by the backend adapter in the backend workspace:

```bash
npm install --workspace @history-video-forge/backend @remotion/renderer
```

Install the composition dependencies in the renderer workspace:

```bash
npm install --workspace @history-video-forge/renderer remotion react react-dom
```

Then add this script to `package.json`:

```json
{
  "scripts": {
    "render:remotion:smoke": "tsx harness/scripts/runtime/render-runtime-smoke.ts --adapter=remotion"
  }
}
```

Keep React dependencies scoped to rendering; do not migrate the Vue frontend.

- [ ] **Step 4: Implement Remotion composition files**

`renderer/src/timeline-props.ts` should define the data shape passed from backend to Remotion:

```ts
export interface TimelineVideoProps {
  timeline: unknown;
  assetManifest: unknown;
  assetBaseDir: string;
  width: number;
  height: number;
  fps: number;
}
```

`renderer/src/Root.tsx` should register one composition:

```tsx
import { Composition } from "remotion";
import { TimelineVideo } from "./TimelineVideo";

export function RemotionRoot() {
  return (
    <Composition
      id="TimelineVideo"
      component={TimelineVideo}
      durationInFrames={60}
      fps={30}
      width={540}
      height={960}
      defaultProps={{
        timeline: {},
        assetManifest: {},
        assetBaseDir: "",
        width: 540,
        height: 960,
        fps: 30,
      }}
    />
  );
}
```

`renderer/src/TimelineVideo.tsx` should render:

- a black fallback background;
- image clips as absolutely positioned full-frame media;
- static hold for `image_only`;
- deterministic transform for `image_with_motion`;
- subtitle text when subtitle cues are available;
- no semantic or aesthetic edits.

- [ ] **Step 5: Implement local adapter**

`backend/src/modules/render/local-remotion-render-adapter.ts` should:

- translate `ComposeTimeline` and `AssetManifest` into `TimelineVideoProps`;
- resolve the default Remotion entry point from the repository root as `renderer/src/Root.tsx`, while allowing tests to inject an alternate entry path;
- call Remotion bundle/render APIs behind the `RenderAdapter` interface;
- pass dynamic timeline/profile data through Remotion `inputProps`;
- compute `durationInFrames` from `ComposeTimeline.duration_sec * profile.fps` through Remotion metadata or equivalent render configuration;
- write `output.mp4` under the render output directory;
- probe the result and return duration/size/fps metadata;
- return diagnostics without printing secrets or provider config.

Keep this adapter injectable. API tests may continue using `fake-render-adapter`; runtime smoke can choose fake or remotion mode.

- [ ] **Step 6: Verify**

Run:

```bash
npx vitest run --configLoader runner tests/backend/render/local-remotion-render-adapter.test.ts
npm run render:remotion:smoke
git diff --check
```

Expected: a real local MP4 is written in the temp/runtime output directory, probe metadata is returned, and no provider calls are made.

## Task 6: Render Generate API

**Files:**

- Create: `backend/src/modules/render/render-run.service.ts`
- Create: `backend/src/modules/render/render.routes.ts`
- Modify: `backend/src/app.ts`
- Test: `tests/backend/api/render-api.test.ts`

- [ ] **Step 1: Write failing API tests**

Cover:

- missing project returns `404 project_not_found`;
- missing active compose returns `409 active_compose_missing`;
- blocked compose timeline returns `409 render_timeline_not_ready`;
- valid active compose validates, renders, persists, and activates render record;
- stale active compose returns `409 stale_render_source` and does not activate;
- successful output sets project status `render_ready`;
- failed adapter sets project status `render_failed` and persists diagnostic record.

Core happy-path assertion:

```ts
const response = await app.inject({
  method: "POST",
  url: `/api/projects/${project.id}/render/generate`,
  payload: {},
});

expect(response.statusCode).toBe(200);
const body = response.json();
expect(body).toMatchObject({
  project_id: project.id,
  source_compose_record_id: composeRecord.id,
  render_job: {
    status: "completed",
  },
  output_artifact: {
    artifact_type: "rendered_video",
    mime_type: "video/mp4",
  },
  local_validation: {
    stage: "render_local_validation",
    decision: "rendered",
  },
});
expect(project.activeRenderJobRecordId).toBe(body.render_job_record_id);
```

- [ ] **Step 2: Run failing test**

Run:

```bash
npx vitest run --configLoader runner tests/backend/api/render-api.test.ts
```

Expected: fail because route/service do not exist.

- [ ] **Step 3: Implement service and route**

Service function:

```ts
export interface RunRenderGenerationInput {
  db: DbClient;
  project: ProjectRecord;
  adapter?: RenderAdapter;
}

export async function runRenderGeneration(input: RunRenderGenerationInput)
```

Flow:

1. check `project.activeComposeRecordId`;
2. load `ComposeRecord`;
3. load source `AssetManifestRecord`;
4. capture active compose id for stale check;
5. validate render sources;
6. create a render job record with `rendering` status;
7. run adapter;
8. probe output through adapter result;
9. recheck active compose id;
10. update render job status and output artifact;
11. set `project.activeRenderJobRecordId`;
12. set status `render_ready`, `render_blocked`, or `render_failed`;
13. write `latestRenderRunTraceJson`.

Route:

```ts
POST /api/projects/:projectId/render/generate
```

Register it in `backend/src/app.ts`.

- [ ] **Step 4: Verify**

Run:

```bash
npx vitest run --configLoader runner tests/backend/api/render-api.test.ts
git diff --check
```

## Task 7: Upstream Invalidation

**Files:**

- Modify: `backend/src/modules/script/script-run.service.ts`
- Modify: `backend/src/modules/storyboard/storyboard-run.service.ts`
- Modify: `backend/src/modules/asset-planning/asset-planning-run.service.ts`
- Modify: `backend/src/modules/assets/assets-run.service.ts`
- Modify: `backend/src/modules/compose/compose-run.service.ts`
- Test: `tests/backend/script/script-runtime-generate.test.ts`
- Test: `tests/backend/api/storyboard-api.test.ts`
- Test: `tests/backend/api/asset-planning-api.test.ts`
- Test: `tests/backend/api/assets-api.test.ts`
- Test: `tests/backend/api/compose-api.test.ts`

- [ ] **Step 1: Write failing invalidation tests**

Assert:

- new script activation clears active storyboard, asset plan, asset manifest, compose, and render pointers;
- new storyboard activation clears active asset plan, asset manifest, compose, and render pointers;
- new asset plan activation clears active asset manifest, compose, and render pointers;
- new asset manifest activation clears active compose and render pointers;
- new compose activation clears active render pointer;
- latest render trace is cleared with the pointer.

- [ ] **Step 2: Run failing tests**

Run affected tests:

```bash
npx vitest run --configLoader runner tests/backend/script/script-runtime-generate.test.ts tests/backend/api/storyboard-api.test.ts tests/backend/api/asset-planning-api.test.ts tests/backend/api/assets-api.test.ts tests/backend/api/compose-api.test.ts
```

- [ ] **Step 3: Implement invalidation**

Extend downstream clearing helpers to include:

```ts
project.activeRenderJobRecordId = null;
project.latestRenderRunTraceJson = null;
```

Do not delete historical render records.

- [ ] **Step 4: Verify**

Run:

```bash
npx vitest run --configLoader runner tests/backend/script/script-runtime-generate.test.ts tests/backend/api/storyboard-api.test.ts tests/backend/api/asset-planning-api.test.ts tests/backend/api/assets-api.test.ts tests/backend/api/compose-api.test.ts
git diff --check
```

## Task 8: Runtime Smoke

**Files:**

- Create: `harness/scripts/runtime/render-runtime-smoke.ts`
- Create: `tests/harness/render-runtime-smoke.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing smoke test**

The smoke should seed or run the minimal chain:

1. active asset plan;
2. `assets/generate`;
3. `compose/generate`;
4. `render/generate` with the fake adapter for deterministic CI;
5. snapshot exposes `active_render`;
6. new `compose/generate` clears stale `active_render`.

Test assertion:

```ts
const result = await runRenderRuntimeSmoke();

expect(result.status.activeRenderAfterGenerate).toBeTruthy();
expect(result.status.activeRenderAfterComposeRefresh).toBeNull();
```

- [ ] **Step 2: Run failing test**

Run:

```bash
npx vitest run --configLoader runner tests/harness/render-runtime-smoke.test.ts
```

- [ ] **Step 3: Implement smoke script**

Add script export:

```ts
export async function runRenderRuntimeSmoke(input?: RunRenderRuntimeSmokeInput)
```

Add package script:

```json
"harness:render-runtime-smoke": "tsx harness/scripts/runtime/render-runtime-smoke.ts"
```

- [ ] **Step 4: Verify**

Run:

```bash
npx vitest run --configLoader runner tests/harness/render-runtime-smoke.test.ts
npm run harness:render-runtime-smoke
git diff --check
```

## Task 9: Formal Docs Sync

**Files:**

- Modify: `docs/architecture/pipeline-io-spec.md`
- Modify: `docs/architecture/api-design.md`
- Modify: `docs/data/schema-design.md`
- Modify: `docs/data/field-design.md`
- Modify: `docs/architecture/downstream-stage-high-level-design.md`
- Modify: `docs/plans/README.md`

- [ ] **Step 1: Update docs**

Document:

- renderer input/output;
- `RenderJobRecord`;
- `ExportArtifact`;
- `RenderValidationResult`;
- `POST /api/projects/:projectId/render/generate`;
- stale source rules;
- explicit non-goals: no DashScope image-to-video, no frontend preview UI, no publish flow.

- [ ] **Step 2: Verify docs**

Run:

```bash
git diff --check
git status --short
```

Confirm no generated runtime output or `storage/topic-candidate-library/` files are staged.

## Task 10: Regression

**Files:** no planned production changes.

- [ ] **Step 1: Run render-focused tests**

```bash
npx vitest run --configLoader runner tests/shared/schema-contracts.test.ts tests/backend/render tests/backend/api/render-api.test.ts tests/harness/render-runtime-smoke.test.ts
```

- [ ] **Step 2: Run real local render smoke**

```bash
npm run render:remotion:smoke
```

- [ ] **Step 3: Run affected downstream tests**

```bash
npx vitest run --configLoader runner tests/backend/compose tests/backend/api/compose-api.test.ts tests/backend/assets tests/backend/api/assets-api.test.ts tests/backend/projects/project-snapshot.test.ts
```

- [ ] **Step 4: Run final diff checks**

```bash
git diff --check
git status --short
```

Expected:

- focused tests pass;
- affected downstream tests pass;
- no whitespace errors;
- no generated runtime output is staged;
- `.env` remains ignored.

## Completion Criteria

- Render/export shared schemas exist and are exported.
- Renderer source validation blocks missing compose, missing files, missing narration, and missing subtitles.
- Render job records are persisted and exposed in project snapshot.
- Render generate API activates only stable-source results.
- Upstream changes clear stale render pointers.
- Fake renderer runtime smoke proves compose-to-render activation and invalidation.
- Local Remotion adapter can produce a real MP4 from fixture timeline/assets.
- The first implementation remains local and does not call DashScope image-to-video.
