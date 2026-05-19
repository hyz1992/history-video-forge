# 2026-05-16 Assets Stage Completion Checklist

## Purpose

This record clarifies the current completion state of the video pipeline around:

- `asset planning`
- `assets`
- `compose`

It is a boundary checklist, not a new implementation plan. Its main purpose is to prevent overclaiming: a successful DashScope TTS/text-to-image live check does not mean the full video pipeline is complete.

## Summary

Current status:

- `asset planning`: usable as the upstream input for assets.
- `assets`: backend execution foundation is usable for fake/local, explicit DashScope TTS/text-to-image, and explicit DashScope image-to-video when a `video_clip` task exists.
- `compose`: v1 backend timeline contract is implemented.
- `renderer/export`: v1 backend render/export path is implemented.

Current safe claim:

> The project can build an asset manifest, run fake provider regression, explicitly run real DashScope TTS plus text-to-image through a controlled live-check, and has a mocked/API-covered DashScope image-to-video provider path. It can generate a backend render/export artifact from compose, but it still does not have a full product workflow with preview UI, publishing, manual review, or real image-to-video live-check evidence.

## Boundary Table

| Area | Status | Evidence | Notes |
| --- | --- | --- | --- |
| AssetPlan as assets input | done | Existing assets tests consume active `AssetPlanRecord` | Do not reopen asset planning semantics unless a blocking contract issue is found. |
| AssetManifest schema | done | `tests/shared/schema-contracts.test.ts` | Structural execution state exists. |
| Assets local validator | done | `tests/backend/assets/assets-local-validator.test.ts` | Structural only; does not judge visual/audio quality. |
| Manifest builder | done | `tests/backend/assets/assets-manifest-builder.test.ts` | Builds executions, routes, audio summary, motion placeholders. |
| AssetManifest persistence/API | done | `tests/backend/api/assets-api.test.ts` | Can generate, persist, activate, and expose assets manifest. |
| Manual artifact registration | done | API tests | Metadata registration only; no binary upload UI. |
| Provider job records | done | `tests/backend/assets/asset-provider-job-repository.test.ts` | Jobs are migrated to final manifest id after execution. |
| Local file storage | done | `tests/backend/assets/assets-file-storage.test.ts` | Writes generated artifacts under assets run storage. |
| Fake TTS/image providers | done | assets provider tests and execution regression | Default automated tests remain fake/local. |
| Local subtitle provider | done | `tests/backend/assets/local-subtitle-provider.test.ts` | Generates subtitle artifacts from TTS chunk metadata. |
| Media library schema/selector | done | `tests/backend/assets/media-library-selector.test.ts` | Local BGM/SFX selection contract exists. |
| Optional BGM warning behavior | done | assets validator/regression tests | Missing optional BGM yields warning, not blocking error. |
| DashScope TTS provider | partial | adapter tests and live-check | Real call works through explicit mode; no voice design lifecycle here. |
| DashScope text-to-image provider | partial | adapter tests and live-check | Real call works through explicit mode; prompt quality is not validated. |
| Provider mode API switch | done | service/API tests | `provider_mode=dashscope` is explicit; default remains fake/local. |
| Assets DashScope live-check | done | `npm run harness:assets-dashscope-live-check` | Latest result: `status_code=200`, providers `dashscope_tts`, `dashscope_image`. |
| DashScope image-to-video provider | partial | mocked provider tests, service/API tests, explicit live-check harness | Explicit opt-in provider exists as `dashscope_image_to_video`; real live-check has not been run in this record. |
| Assets DashScope image-to-video live-check | ready_not_run | `npm run harness:assets-dashscope-image-to-video-live-check` | Requires `ALIYUN_DASHSCOPE_API_KEY` and `ALIYUN_DASHSCOPE_IMAGE_TO_VIDEO_MODEL`; not a default gate. |
| Real SFX provider | not_started | none | Requires separate provider/design decision. |
| Real BGM provider | not_started | none | Current optional BGM missing warning is expected. |
| Remotion/local motion rendering | not_started | none | Current `motion_recipe` is a manifest artifact, not rendered video. |
| Compose timeline | done | compose backend tests and runtime smoke | Timeline contract only; not a product preview workflow. |
| Final video export | partial | renderer backend tests and runtime smoke | Backend render/export path exists; publishing and review are separate work. |
| Frontend upload/preview UI | not_started | none | Backend metadata paths exist; UI is separate work. |

## Current Acceptance Line

The assets stage currently reaches this line:

- default fake/local assets regression is stable;
- real DashScope TTS and text-to-image can be run explicitly;
- DashScope image-to-video can be exercised through mocked tests/API and has an explicit live-check harness;
- generated TTS, subtitle, and image artifacts are normalized into `AssetManifest`;
- generated video artifacts are normalized into `AssetManifest` as `artifact_type=video`, with image + motion fallback retained;
- provider jobs and local files are recorded;
- optional BGM absence is visible as a warning;
- no real provider call happens unless explicitly requested.

The assets stage does not yet reach this line:

- real image-to-video live-check evidence from DashScope;
- rendered motion from `motion_recipe`;
- real BGM/SFX generation or import lifecycle;
- compose-ready timeline;
- final video export;
- frontend review/acceptance workflow.

## Compose Handoff Conditions

Before starting compose implementation, the project should have a formal compose design and implementation plan.

Minimum handoff input from assets to compose should be:

- an active `AssetManifestRecord`;
- `manifest.readiness` is either `ready_for_compose` or a documented `partial` where remaining warnings are explicitly non-blocking;
- every required segment has:
  - TTS artifact or equivalent narration route;
  - subtitle artifact;
  - primary visual artifact;
  - motion artifact only if compose is expected to render still-image motion;
- optional BGM/SFX are either resolved or marked as non-blocking;
- all referenced local provider artifacts exist under project storage;
- provider job records are associated with the final manifest id;
- any real provider run is reproducible through an explicit harness command or documented manual record.

## Current Live-Check Reading

Latest controlled live-check:

```bash
npm run harness:assets-dashscope-live-check
```

Observed result:

- `status_code`: `200`
- `local_validation_decision`: `partial`
- `local_validation_errors`: `[]`
- `local_validation_warnings`: `["assets_bgm_missing_optional"]`
- `provider_names`: `["dashscope_tts", "dashscope_image"]`
- `artifact_types`: `["tts_chunk_audio", "tts_merged_audio", "subtitle_track", "image"]`

Interpretation:

- DashScope real TTS and text-to-image are working.
- The `partial` decision is caused by optional BGM absence, not provider failure.
- This is sufficient evidence for the real TTS/T2I slice, not for compose or video generation.

Explicit image-to-video live-check command:

```bash
npm run harness:assets-dashscope-image-to-video-live-check
```

Current reading:

- The command and pure harness helper exist.
- Unit/API/provider regression covers submit/poll/download/normalize through mocked DashScope responses.
- A real DashScope image-to-video call has not been run or recorded here, so this remains explicit manual evidence, not a default gate.

## Environment Naming

Current explicit DashScope environment keys:

- `ALIYUN_DASHSCOPE_API_KEY`
- `ALIYUN_DASHSCOPE_BASE_URL`
- `ALIYUN_DASHSCOPE_TEXT_TO_IMAGE_MODEL`
- `ALIYUN_DASHSCOPE_TTS_MODEL`
- `ALIYUN_DASHSCOPE_IMAGE_TO_VIDEO_MODEL`
- `ALIYUN_DASHSCOPE_IMAGE_TO_VIDEO_RESOLUTION`
- `ALIYUN_DASHSCOPE_IMAGE_TO_VIDEO_DURATION_SEC`
- `ALIYUN_DASHSCOPE_IMAGE_TO_VIDEO_POLL_INTERVAL_MS`
- `ALIYUN_DASHSCOPE_IMAGE_TO_VIDEO_MAX_POLL_ATTEMPTS`

Avoid using generic names like `ALIYUN_DASHSCOPE_MODEL` for new work because DashScope has multiple model families.

## Decision

Do not call the whole video production product complete yet.

Call this slice complete:

> Assets backend execution foundation plus explicit DashScope TTS/text-to-image live-check, and mocked/API-covered DashScope image-to-video provider integration with an explicit live-check harness.

Next engineering target:

> Either run the explicit DashScope image-to-video live-check with credentials, or keep real-provider evidence pending and move to branch closeout/review.

## Next Step Recommendation

Recommended next step: either run the explicit DashScope image-to-video live-check with credentials, or keep it pending and move to branch closeout/review.
