# Assets Stage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the first backend contract for the `assets` stage: consume an active `AssetPlanRecord`, create an `AssetManifest`, validate readiness structurally, persist it, expose it through project APIs, and support manual artifact registration without implementing frontend upload UI or final compose.

**Architecture:** The first slice is manifest-first. It defines shared schemas for `AssetManifest` and `AssetsValidationResult`, adds persistence and snapshot exposure, builds a deterministic execution skeleton from `AssetPlan.tasks`, derives local `motion_recipe` artifacts, records waiting/manual/provider states, and validates whether the manifest is ready or blocked. Provider adapters are introduced as interfaces with fake test adapters only; real TTS/image/video/music provider integration is left for a later plan.

**Tech Stack:** TypeScript, Zod shared schemas, Vitest, existing in-memory repository pattern, existing REST route pattern, existing project snapshot service, existing trace summary conventions.

---

## Execution Contract

Follow `AGENTS.md` strictly.

- Execute exactly one low-coupling task at a time.
- Start each task by printing:
  - `任务`
  - `目标`
  - `本次改动文件`
  - `不改什么`
  - `验证方式`
- Finish each task by printing:
  - `实际改动`
  - `验证结果`
  - `自审结论`
  - `剩余风险`
  - `下一步建议`
- Use TDD: write or update the focused test first, confirm failure, then implement.
- Commit after each task with a Chinese commit message.
- Do not implement frontend upload UI, preview UI, provider credentials, physical binary storage, or compose timeline.
- Do not modify topic/script/storyboard/asset planning semantics.
- Do not submit `storage/topic-candidate-library/`.
- Local validators only check structure, references, readiness and file metadata contracts. They must not judge asset quality, style, aesthetics, audio performance, or historical likeness.

## Planned Files

Expected create:

- `shared/src/assets/asset-manifest.schema.ts`
- `shared/src/assets/assets-validation.schema.ts`
- `backend/src/modules/assets/assets-local-validator.ts`
- `backend/src/modules/assets/assets-provider-adapter.ts`
- `backend/src/modules/assets/asset-manifest-record.repository.ts`
- `backend/src/modules/assets/assets-manifest-builder.ts`
- `backend/src/modules/assets/assets-run.service.ts`
- `backend/src/modules/assets/assets.routes.ts`
- `tests/backend/assets/assets-local-validator.test.ts`
- `tests/backend/assets/assets-manifest-builder.test.ts`
- `tests/backend/api/assets-api.test.ts`

Expected modify:

- `shared/src/index.ts`
- `tests/shared/schema-contracts.test.ts`
- `backend/src/db/client.ts`
- `backend/prisma/schema.prisma`
- `backend/src/app.ts`
- `backend/src/modules/projects/project.repository.ts`
- `backend/src/modules/projects/project-snapshot.service.ts`
- `backend/src/modules/script/script-run.service.ts`
- `backend/src/modules/storyboard/storyboard-run.service.ts`
- `backend/src/modules/asset-planning/asset-planning-run.service.ts`
- `tests/backend/repositories/repository-contracts.test.ts`
- `tests/backend/projects/project-snapshot.test.ts`
- `tests/backend/script/script-runtime-generate.test.ts`
- `tests/backend/api/storyboard-api.test.ts`
- `tests/backend/api/asset-planning-api.test.ts`
- `docs/architecture/pipeline-io-spec.md`
- `docs/data/field-design.md`
- `docs/data/schema-design.md`
- `docs/architecture/api-design.md`
- `docs/architecture/downstream-stage-high-level-design.md`
- `docs/plans/README.md`

Do not modify:

- `harness/prompts/`
- topic/script/storyboard prompt or validators
- asset planning planner prompt or validator unless an assets test proves a direct contract mismatch
- frontend files
- compose files beyond docs

## Task 1: Shared Assets Manifest Schema

**Files:**

- Create: `shared/src/assets/asset-manifest.schema.ts`
- Create: `shared/src/assets/assets-validation.schema.ts`
- Modify: `shared/src/index.ts`
- Modify: `tests/shared/schema-contracts.test.ts`

- [ ] **Step 1: Write failing schema tests**

Add tests that parse:

- a minimal `AssetManifest` with:
  - `manifest_version: "asset_manifest_v1"`
  - source ids
  - one `tts_audio` execution
  - one `tts_merged_audio` artifact
  - one segment route
  - readiness `blocked`
- an `AssetsValidationResult` with stage `assets_local_validation`.

Also add tests that reject:

- unknown execution status
- artifact with empty `artifact_id`
- segment route with invalid `visual_route_type`

- [ ] **Step 2: Run focused test and confirm failure**

Run:

```bash
npx vitest run --configLoader runner tests/shared/schema-contracts.test.ts
```

Expected: fail because `AssetManifest` and `AssetsValidationResult` are not exported.

- [ ] **Step 3: Implement schemas**

Implement `AssetManifest`, `AssetTaskExecution`, `AssetArtifact`, `SegmentAssetRoute`, `AssetAudioSummary`, `BgmPlacement`, `AssetManifestReadiness`, and `AssetsValidationResult` with strict Zod objects.

Use these literal values:

- `manifest_version`: `asset_manifest_v1`
- `AssetsValidationResult.stage`: `assets_local_validation`
- validation `decision`: `ready_for_compose / blocked / partial`
- execution statuses from the design document; use `completed`, not `completed_by_provider / completed_by_local / completed_by_manual`
- artifact types from the design document
- origins from the design document
- visual route types: `video_clip / image_with_motion / image_only / missing`

Implement `AssetExecutionOptions` with:

- `execution_mode: "auto_available" | "dry_run"`
- `voice_profile_id: string | null`
- `enabled_provider_types: Array<"tts" | "image" | "video" | "sfx" | "bgm">`
- `allow_manual_placeholders: boolean`

Implement minimal metadata validation for:

- `tts_chunk_audio`: `duration_sec`, `voice_profile_id`, `tts_chunk_id`, `segment_ids`, `script_excerpt`
- `tts_merged_audio`: `duration_sec`, `voice_profile_id`, `chunk_artifact_ids`
- `subtitle_track`: `format`, `source_tts_artifact_id`, `caption_count`
- `image`: `width`, `height`
- `video`: `duration_sec`, `width`, `height`, `fps`
- `motion_recipe`: `recipe_type`, `source_image_artifact_id`, `parameters`
- `sfx_audio`: `duration_sec`
- `sfx_selection`: `library_item_id` or `selection_label`
- `bgm_audio`: `duration_sec`, `loopable`
- `bgm_selection`: `library_item_id` or `selection_label`

Also add rejection tests for:

- missing required metadata on one audio, one image, and one video artifact
- invalid `enabled_provider_types` value such as `"ttss"`

- [ ] **Step 4: Export schemas**

Export the new schemas and inferred types from `shared/src/index.ts`.

- [ ] **Step 5: Verify**

Run:

```bash
npx vitest run --configLoader runner tests/shared/schema-contracts.test.ts
git diff --check
```

Expected: schema tests pass and diff check is clean.

- [ ] **Step 6: Commit**

```bash
git add shared/src/assets shared/src/index.ts tests/shared/schema-contracts.test.ts
git commit -m "新增 assets 共享 manifest schema"
```

## Task 2: Assets Local Validator

**Files:**

- Create: `backend/src/modules/assets/assets-local-validator.ts`
- Test: `tests/backend/assets/assets-local-validator.test.ts`

- [ ] **Step 1: Write failing validator tests**

Cover these cases:

- source ids mismatch produces errors:
  - `assets_source_asset_plan_mismatch`
  - `assets_source_storyboard_mismatch`
  - `assets_source_script_mismatch`
  - `assets_source_topic_mismatch`
- missing execution for an `AssetTask` produces `assets_task_execution_missing`
- dangling `selected_artifact_id` produces `assets_selected_artifact_missing`
- missing segment route produces `assets_segment_route_missing`
- segment route `missing` visual produces `assets_segment_visual_missing`
- video task without artifact but with image+motion fallback is allowed with warning `assets_video_fallback_used`
- missing optional BGM produces warning `assets_bgm_missing_optional`, not an error

- [ ] **Step 2: Run test and confirm failure**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/assets-local-validator.test.ts
```

Expected: fail because validator does not exist.

- [ ] **Step 3: Implement validator**

Implement `validateAssetsManifest(input)` with inputs:

- `assetPlanRecordId`
- `storyboardRecordId`
- `scriptRecordId`
- `topicPackageId`
- `assetPlan`
- `manifest`

Checks must be structural only:

- source ids match
- each `AssetPlan.tasks[]` has an execution
- execution artifact ids exist
- selected artifact belongs to execution artifact ids
- each storyboard segment appearing in image/video/motion tasks has a route
- route visual references exist when route is not `missing`
- readiness decision matches blocking errors

Do not inspect prompt quality, visual quality, audio quality, or semantic fitness.

- [ ] **Step 4: Verify**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/assets-local-validator.test.ts
git diff --check
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/assets/assets-local-validator.ts tests/backend/assets/assets-local-validator.test.ts
git commit -m "新增 assets 本地结构校验"
```

## Task 3: Asset Manifest Builder Skeleton

**Files:**

- Create: `backend/src/modules/assets/assets-provider-adapter.ts`
- Create: `backend/src/modules/assets/assets-manifest-builder.ts`
- Test: `tests/backend/assets/assets-manifest-builder.test.ts`

- [ ] **Step 1: Write failing builder tests**

Build a small `AssetPlan` fixture containing:

- `tts_audio`
- `subtitle_track`
- one `image_still`
- one `render_motion_cue`
- one optional `video_clip`
- one `sfx_cue`
- one `bgm_cue`

Assert that the builder:

- creates one `AssetTaskExecution` per task
- creates `motion_recipe` inline artifact for `render_motion_cue`
- records `tts_chunk_routes` using order alignment: `tts_plan.chunks[i]` maps to `storyboard.segments[i]`
- records `tts_chunk_audio.metadata.segment_ids` when test fixtures include completed TTS chunk artifacts
- marks routes blocked instead of guessing when TTS chunk count and storyboard segment count differ
- creates segment route `image_with_motion` when image + motion exist
- marks provider-dependent tasks as `planned` or `waiting_manual_upload` according to `manual_upload_policy.required`
- creates `BgmPlacement` from `bgm_cue` tasks
- sets readiness `blocked` when TTS/subtitle/image artifacts are not complete
- validates the builder output with `validateAssetsManifest()` and expects decision `blocked` or `partial`, not schema failure

- [ ] **Step 2: Run test and confirm failure**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/assets-manifest-builder.test.ts
```

Expected: fail because builder does not exist.

- [ ] **Step 3: Implement builder**

Create `assets-provider-adapter.ts` with type-only contracts:

- `AssetProviderAdapter`
- `AssetProviderContext`
- `AssetProviderRunResult`
- methods: `canHandle`, `run`, `poll`, `cancel`, `normalizeResult`

Do not implement real provider adapters in this task.

Implement `buildInitialAssetManifest(input)`:

- consumes `AssetPlan`
- creates executions for every task
- creates local inline `motion_recipe` artifacts from `render_motion_cue`
- builds `segment_routes` from planned image/video/motion tasks
- builds `audio_summary` from `tts_plan`, `sfx_cue`, `bgm_cue`, and `global_audio_strategy`
- does not call external providers
- does not create fake image/video/audio files

- [ ] **Step 4: Verify**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/assets-manifest-builder.test.ts
git diff --check
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/assets/assets-provider-adapter.ts backend/src/modules/assets/assets-manifest-builder.ts tests/backend/assets/assets-manifest-builder.test.ts
git commit -m "新增 assets manifest 构建骨架"
```

## Task 4: Persistence And Snapshot

**Files:**

- Create: `backend/src/modules/assets/asset-manifest-record.repository.ts`
- Modify: `backend/src/db/client.ts`
- Modify: `backend/prisma/schema.prisma`
- Modify: `backend/src/modules/projects/project.repository.ts`
- Modify: `backend/src/modules/projects/project-snapshot.service.ts`
- Test: `tests/backend/repositories/repository-contracts.test.ts`
- Test: `tests/backend/projects/project-snapshot.test.ts`

- [ ] **Step 1: Write failing repository and snapshot tests**

Repository test:

- saves an `AssetManifestRecord`
- reads it by id
- checks Prisma schema contains `AssetManifestRecord`, `active_asset_manifest_record_id`, and `latest_assets_run_trace_json`

Snapshot test:

- when project has active asset manifest pointer, project snapshot exposes `active_assets`
- when pointer is cleared, stale manifest is not exposed

- [ ] **Step 2: Run focused tests and confirm failure**

Run:

```bash
npx vitest run --configLoader runner tests/backend/repositories/repository-contracts.test.ts tests/backend/projects/project-snapshot.test.ts
```

- [ ] **Step 3: Implement persistence**

Add:

- `AssetManifestRecord` interface
- `assetManifestRecords` map in `DbClient`
- repository save/get helpers
- Prisma `AssetManifestRecord` model and project relation fields
- `ProjectRecord.activeAssetManifestRecordId`
- `ProjectRecord.latestAssetsRunTraceJson`
- project repository cleanup helpers that remove manifest records with the project
- snapshot `active_assets` payload

First-version record payload rules:

- `execution_state_json` stores `{ "execution_mode": "...", "activated": true | false }`.
- `runtime_diagnostics_json` may be `null`; do not invent provider diagnostics before providers exist.

- [ ] **Step 4: Verify**

Run:

```bash
npx vitest run --configLoader runner tests/backend/repositories/repository-contracts.test.ts tests/backend/projects/project-snapshot.test.ts
git diff --check
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/db/client.ts backend/prisma/schema.prisma backend/src/modules/assets/asset-manifest-record.repository.ts backend/src/modules/projects/project.repository.ts backend/src/modules/projects/project-snapshot.service.ts tests/backend/repositories/repository-contracts.test.ts tests/backend/projects/project-snapshot.test.ts
git commit -m "新增 assets manifest 持久化与快照"
```

## Task 5: Assets Run API

**Files:**

- Create: `backend/src/modules/assets/assets-run.service.ts`
- Create: `backend/src/modules/assets/assets.routes.ts`
- Modify: `backend/src/app.ts`
- Test: `tests/backend/api/assets-api.test.ts`

- [ ] **Step 1: Write failing API tests**

Cover:

- `POST /api/projects/:projectId/assets/generate` returns `404 project_not_found`
- returns `409 active_asset_plan_missing` when no active asset plan
- creates, validates, persists, and activates a manifest from active asset plan
- supports `execution_mode: "dry_run"` and confirms no provider adapter is invoked
- returns `409 stale_assets_source` if active asset plan changes before activation
- project status becomes `assets_blocked` when manifest is not ready

- [ ] **Step 2: Run test and confirm failure**

Run:

```bash
npx vitest run --configLoader runner tests/backend/api/assets-api.test.ts
```

- [ ] **Step 3: Implement run service and route**

Implement:

- active asset plan lookup
- source script/storyboard/topic checks through existing records
- manifest builder call
- local validator call
- stale source recheck
- record persistence
- project pointer activation
- trace summary following existing asset planning patterns

Status rules:

- validation `ready_for_compose` -> `assets_ready`
- validation `partial` or `blocked` -> `assets_blocked`
- stale source -> do not save active manifest

Do not introduce a shared project status enum in this task. The existing project status model is a string; this task only documents and tests the new string values `assets_ready` and `assets_blocked`.

- [ ] **Step 4: Verify**

Run:

```bash
npx vitest run --configLoader runner tests/backend/api/assets-api.test.ts
git diff --check
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/assets/assets-run.service.ts backend/src/modules/assets/assets.routes.ts backend/src/app.ts tests/backend/api/assets-api.test.ts
git commit -m "新增 assets manifest 生成 API"
```

## Task 6: Manual Artifact Registration

**Files:**

- Modify: `backend/src/modules/assets/assets-run.service.ts`
- Modify: `backend/src/modules/assets/assets.routes.ts`
- Test: `tests/backend/api/assets-api.test.ts`

- [ ] **Step 1: Write failing API tests**

Cover:

- registering artifact for missing project returns `404 project_not_found`
- missing active manifest returns `409 active_assets_missing`
- unknown task id returns `404 asset_task_not_found`
- disallowed MIME type returns `422 asset_manual_upload_type_not_allowed`
- allowed manual image registration appends artifact, sets selected artifact, sets task execution `status` to `completed`, and sets `completion_origin` to `manual_upload`
- if registering the final required artifact resolves all blocking items, local validation is re-run and manifest readiness changes from `blocked` to `partial` or `ready_for_compose`
- accepting an existing artifact updates `selected_artifact_id`

- [ ] **Step 2: Run focused test and confirm failure**

Run:

```bash
npx vitest run --configLoader runner tests/backend/api/assets-api.test.ts -t "manual artifact"
```

- [ ] **Step 3: Implement registration and accept routes**

Add:

- `POST /api/projects/:projectId/assets/tasks/:taskId/artifacts/register`
- `POST /api/projects/:projectId/assets/tasks/:taskId/accept`

Only register metadata. Do not implement binary upload.

After registration or accept, rebuild affected routes, re-run `validateAssetsManifest()`, and update `manifest.readiness` plus the stored validation result. Do not leave readiness stale after manual changes.

- [ ] **Step 4: Verify**

Run:

```bash
npx vitest run --configLoader runner tests/backend/api/assets-api.test.ts
git diff --check
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/assets/assets-run.service.ts backend/src/modules/assets/assets.routes.ts tests/backend/api/assets-api.test.ts
git commit -m "新增 assets 手动素材登记接口"
```

## Task 7: Upstream Invalidation

**Files:**

- Modify: `backend/src/modules/projects/project.repository.ts`
- Modify: `backend/src/modules/script/script-run.service.ts`
- Modify: `backend/src/modules/storyboard/storyboard-run.service.ts`
- Modify: `backend/src/modules/asset-planning/asset-planning-run.service.ts`
- Test: `tests/backend/script/script-runtime-generate.test.ts`
- Test: `tests/backend/api/storyboard-api.test.ts`
- Test: `tests/backend/api/asset-planning-api.test.ts`

- [ ] **Step 1: Write failing invalidation tests**

Assert:

- new script activation clears active storyboard, active asset plan, and active asset manifest pointers
- new storyboard activation clears active asset plan and active asset manifest pointers
- new asset plan activation clears active asset manifest pointer
- related latest run trace pointers are cleared
- existing test fixtures are updated to include `activeAssetManifestRecordId` and `latestAssetsRunTraceJson` where `ProjectRecord` is constructed directly

- [ ] **Step 2: Run tests and confirm failure**

Run:

```bash
npx vitest run --configLoader runner tests/backend/script/script-runtime-generate.test.ts tests/backend/api/storyboard-api.test.ts tests/backend/api/asset-planning-api.test.ts
```

- [ ] **Step 3: Implement invalidation**

Extend existing pointer clearing logic. Do not delete old records; only clear active pointers and latest trace fields.

- [ ] **Step 4: Verify**

Run:

```bash
npx vitest run --configLoader runner tests/backend/script/script-runtime-generate.test.ts tests/backend/api/storyboard-api.test.ts tests/backend/api/asset-planning-api.test.ts
git diff --check
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/projects/project.repository.ts backend/src/modules/script/script-run.service.ts backend/src/modules/storyboard/storyboard-run.service.ts backend/src/modules/asset-planning/asset-planning-run.service.ts tests/backend/script/script-runtime-generate.test.ts tests/backend/api/storyboard-api.test.ts tests/backend/api/asset-planning-api.test.ts
git commit -m "补充 assets manifest 失效规则"
```

## Task 8: Architecture And API Docs

**Files:**

- Modify: `docs/architecture/pipeline-io-spec.md`
- Modify: `docs/data/field-design.md`
- Modify: `docs/data/schema-design.md`
- Modify: `docs/architecture/api-design.md`
- Modify: `docs/architecture/downstream-stage-high-level-design.md`
- Modify: `docs/plans/README.md`

- [ ] **Step 1: Update docs**

Document:

- `AssetManifest`
- `AssetsValidationResult`
- `AssetManifestRecord`
- `POST /api/projects/:projectId/assets/generate`
- manual artifact registration and accept routes
- source invalidation rules
- explicit boundary: no compose timeline, no final video export, no quality judgment

- [ ] **Step 2: Verify docs and diff**

Run:

```bash
git diff --check
git status --short
```

Confirm `storage/topic-candidate-library/` is not staged.

- [ ] **Step 3: Commit**

```bash
git add docs/architecture/pipeline-io-spec.md docs/data/field-design.md docs/data/schema-design.md docs/architecture/api-design.md docs/architecture/downstream-stage-high-level-design.md docs/plans/README.md
git commit -m "补充 assets 阶段架构文档"
```

## Task 9: Regression

**Files:** no planned code changes.

- [ ] **Step 1: Run focused assets tests**

```bash
npx vitest run --configLoader runner tests/shared/schema-contracts.test.ts tests/backend/assets/ tests/backend/api/assets-api.test.ts
```

- [ ] **Step 2: Run affected backend tests**

```bash
npx vitest run --configLoader runner tests/backend/repositories/repository-contracts.test.ts tests/backend/projects/project-snapshot.test.ts tests/backend/script/script-runtime-generate.test.ts tests/backend/api/storyboard-api.test.ts tests/backend/api/asset-planning-api.test.ts
```

- [ ] **Step 3: Run full Vitest suite if focused tests pass**

```bash
npx vitest run --configLoader runner
```

- [ ] **Step 4: Final status check**

```bash
git diff --check
git status --short
```

Confirm no unrelated files are staged or committed, especially `storage/topic-candidate-library/`.

## Completion Criteria

- Shared assets schemas parse and reject expected fixtures.
- Local validator returns structural errors/warnings only.
- Backend can create and expose an `AssetManifestRecord` from active `AssetPlanRecord`.
- Manual artifact registration records metadata without binary upload.
- Upstream invalidation clears stale active assets pointers.
- No frontend upload/preview UI is implemented in this plan.
- No real provider API is called in this plan.
- No compose timeline or final video export is implemented in this plan.
