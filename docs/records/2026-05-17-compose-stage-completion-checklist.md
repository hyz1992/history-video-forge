# 2026-05-17 Compose Stage Completion Checklist

> 2026-05-19 superseded note: this checklist is a historical compose-v1 closeout snapshot. Current formal status has moved on: renderer/export v1 backend paths are implemented, and DashScope image-to-video exists as an explicit opt-in assets provider path. Compose still does not call DashScope directly; it consumes `video` artifacts when assets provide them.

## Purpose

This record clarifies the current completion state of `compose` v1.

It is a boundary checklist, not a new implementation plan. Its main purpose is to prevent overclaiming: compose v1 can build and persist a timeline contract, but it cannot render or export final video.

## Summary

Current status:

- `asset planning`: usable as upstream planning input.
- `assets`: usable as upstream manifest input for compose v1, with fake/local automation and explicit DashScope TTS/text-to-image mode.
- `compose`: backend timeline contract implemented and regression checked.
- `renderer / export`: not started.

Current safe claim:

> The project can take an active `AssetManifestRecord`, build a persisted `ComposeTimeline`, expose it through project snapshot, and invalidate it when upstream assets are refreshed. It cannot yet render Remotion output, generate image-to-video clips, or export MP4.

## Boundary Table

| Area | Status | Evidence | Notes |
| --- | --- | --- | --- |
| Compose shared schemas | done | `tests/shared/schema-contracts.test.ts` | Exports `ComposeTimeline` and `ComposeValidationResult`. |
| Timeline builder | done | `tests/backend/compose/compose-timeline-builder.test.ts` | Builds visual, narration, subtitle, optional audio tracks from `AssetManifest`. |
| Chunk timing fallback | done | builder tests | Missing chunk duration can fall back to merged narration timing with `compose_chunk_timing_fallback_used`. |
| Compose local validator | done | `tests/backend/compose/compose-local-validator.test.ts` | Structural only; does not judge quality or aesthetics. |
| Optional BGM behavior | done | validator tests | Missing optional BGM is a warning, not a blocking error. |
| Compose persistence | done | `tests/backend/repositories/repository-contracts.test.ts` | `ComposeRecord` exists in in-memory DB and Prisma parity schema. |
| Project snapshot exposure | done | `tests/backend/projects/project-snapshot.test.ts` | Snapshot exposes `active_compose` and `latest_compose_run` only from active pointers. |
| Compose generate API | done | `tests/backend/api/compose-api.test.ts` | `POST /api/projects/:projectId/compose/generate` saves and activates ready or blocked records. |
| Stale source protection | done | compose API tests | Returns `409 stale_compose_source` if active assets change during generation. |
| Upstream invalidation | done | script/storyboard/asset-planning/assets tests | New upstream activations clear stale compose pointer and latest compose trace. |
| Runtime smoke | done | `tests/harness/compose-runtime-smoke.test.ts` | Fake/local assets -> compose -> assets refresh -> stale compose cleared. |
| Formal docs sync | done | architecture/API/schema/field/downstream docs | Compose v1 boundary is now documented in formal docs. |
| Remotion rendering | not_started | none | Requires separate renderer design and implementation plan. |
| DashScope image-to-video | not_started | none | Requires separate provider/model design, including `ALIYUN_DASHSCOPE_IMAGE_TO_VIDEO_MODEL`. |
| Final MP4 export | not_started | none | Out of compose v1 scope. |
| Frontend compose preview UI | not_started | none | Separate product/UI surface. |
| Quality/aesthetic review | not_started | none | Not a local validator responsibility. |

## Current Acceptance Line

The compose stage currently reaches this line:

- active assets can be converted into a versioned `ComposeTimeline`;
- timeline structure can be locally validated;
- ready and blocked compose results can both be persisted for diagnosis;
- project snapshot exposes active compose state;
- stale compose state is cleared when upstream script, storyboard, asset plan, or assets are refreshed;
- a runtime smoke covers the minimal fake/local assets-to-compose loop.

The compose stage does not yet reach this line:

- render still images plus motion recipes into video;
- run Remotion;
- call DashScope image-to-video;
- mux narration, subtitles, BGM, SFX, and visuals into a final video file;
- export MP4;
- provide a frontend compose preview/review workflow.

## Verified Commands

Compose-focused regression:

```bash
npx vitest run --configLoader runner tests/shared/schema-contracts.test.ts tests/backend/compose tests/backend/api/compose-api.test.ts
```

Observed result:

- test files: `4 passed`
- tests: `38 passed`

Affected downstream regression:

```bash
npx vitest run --configLoader runner tests/backend/assets tests/backend/api/assets-api.test.ts tests/backend/projects/project-snapshot.test.ts
```

Observed result:

- test files: `18 passed`
- tests: `109 passed`

Diff/status checks:

```bash
git diff --check
git status --short storage/topic-candidate-library harness/scripts/runtime/output
```

Observed result:

- `git diff --check` returned success; only Windows LF-to-CRLF warnings were printed.
- generated runtime output and `storage/topic-candidate-library` did not appear in git status.

## Implemented Surface

Code contracts:

- `shared/src/compose/compose-timeline.schema.ts`
- `shared/src/compose/compose-validation.schema.ts`
- `backend/src/modules/compose/compose-timeline-builder.ts`
- `backend/src/modules/compose/compose-local-validator.ts`
- `backend/src/modules/compose/compose-record.repository.ts`
- `backend/src/modules/compose/compose-run.service.ts`
- `backend/src/modules/compose/compose.routes.ts`

API:

- `POST /api/projects/:projectId/compose/generate`

Harness:

- `npm run harness:compose-runtime-smoke`

Formal docs:

- `docs/architecture/compose-stage-design.md`
- `docs/architecture/pipeline-io-spec.md`
- `docs/architecture/api-design.md`
- `docs/data/schema-design.md`
- `docs/data/field-design.md`
- `docs/architecture/downstream-stage-high-level-design.md`

## Current Known Limits

- Global `tsc --noEmit` has not been used as the completion gate because the repository has pre-existing unrelated type errors.
- Compose v1 assumes required artifacts already exist in `AssetManifest`; it does not create missing assets.
- Compose v1 can represent motion recipes but does not render them.
- Compose v1 can include BGM/SFX tracks only when artifacts already exist.
- Local validation remains structural and must not be used as a semantic or aesthetic reviewer.

## Decision

Call this slice complete:

> Compose v1 backend timeline contract, persistence, API, snapshot exposure, upstream invalidation, formal docs, and runtime smoke.

Do not call the full video pipeline complete.

Do not start renderer/export work without a new design and implementation plan.

## Next Step Recommendation

Renderer-stage design has now been created:

- `docs/architecture/renderer-stage-design.md`
- `docs/plans/archive/2026-05-17-renderer-stage-implementation-plan.md`

Recommended next step: review the renderer design and implementation plan, then begin only Task 1 if the review passes.

Current renderer v1 direction:

- local still-image motion rendering from `motion_recipe`;
- MP4 export through a local renderer path;
- DashScope image-to-video remains a later assets provider design, not part of renderer v1.
