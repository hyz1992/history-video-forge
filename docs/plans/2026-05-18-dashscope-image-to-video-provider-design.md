# DashScope Image-to-Video Provider Design

Date: 2026-05-18

Status: design draft, ready for implementation planning

## 1. Background

The current backend video pipeline has reached a local v1 chain:

- `topic + script` is frozen as the current upstream.
- `storyboard -> asset planning -> assets -> compose` has a v1 backend path.
- `compose` produces a timeline contract, not a final product workflow.
- `renderer/export` can consume a compose timeline and export a local MP4 artifact.

The missing high-value asset capability is real image-to-video generation. This design places DashScope image-to-video in the `assets` stage, not in `renderer`.

## 2. Official API Facts Checked

Official sources checked on 2026-05-18:

- https://help.aliyun.com/zh/model-studio/image-to-video-general-api-reference
- https://help.aliyun.com/zh/model-studio/wan-image-to-video-guide
- https://help.aliyun.com/zh/model-studio/legacy-image-to-video-api-reference/

Current facts used by this design:

- Wan image-to-video uses `POST /api/v1/services/aigc/video-generation/video-synthesis` with `X-DashScope-Async: enable`.
- Task result polling uses `GET /api/v1/tasks/{task_id}`.
- Task status flow is `PENDING -> RUNNING -> SUCCEEDED / FAILED`.
- Successful task output includes a `video_url`; the generated URL is temporary and should be downloaded and stored immediately.
- Wan 2.7 image-to-video input uses `input.media[]`, for example `type=first_frame` with a URL.
- Supported image inputs include public HTTP/HTTPS URL, OSS temporary URL, or base64 data URI.
- Image inputs have format, resolution, aspect-ratio and file-size limits. The implementation must validate or fail early when local metadata is insufficient.
- Generation parameters include `resolution`, `duration`, `prompt_extend`, and `watermark`. `duration` affects cost and must stay explicitly controlled.

The implementation plan must re-check the same official pages before coding because provider payloads and model names can change.

## 3. Goal

Add an explicit DashScope image-to-video provider path that:

- consumes an existing `video_clip` task from `AssetPlan`;
- uses the same segment's generated or manually registered image artifact as the first frame;
- creates a provider `video` artifact in `AssetManifest`;
- records provider job state through the existing asset provider job repository;
- downloads the temporary DashScope `video_url` into project storage;
- updates `SegmentAssetRoute.primary_visual_artifact_id` and `visual_route_type=video_clip`;
- preserves image + motion fallback when video generation fails or is disabled.

## 4. Non-Goals

This design does not implement:

- renderer-side DashScope calls;
- local semantic decisions that create new video tasks;
- text-to-video without a source image;
- first-frame + last-frame generation;
- driving-audio image-to-video;
- video continuation from an existing clip;
- special effect templates;
- final MP4 export changes;
- frontend preview, upload UI, publishing, manual review, or quality scoring;
- automatic aesthetic or viral-quality judging.

## 5. Stage Ownership

DashScope image-to-video belongs to `assets` because it generates source media. The downstream contract is:

```text
AssetPlan.video_clip task
  -> assets provider execution
  -> AssetManifest video artifact
  -> compose visual clip
  -> renderer MP4 export
```

`renderer` must not call DashScope. `compose` must not call DashScope. They only consume `AssetManifest` artifacts and timeline references.

## 6. Provider Scope

First implementation supports only:

- task type: `video_clip`;
- provider type: `video`;
- provider name: `dashscope_image_to_video`;
- source input: same-segment image artifact;
- DashScope mode: first-frame image-to-video;
- output artifact type: `video`;
- output file category: `videos`;
- explicit opt-in through `provider_mode=dashscope` and a dedicated image-to-video config/model.

Default fake/local assets runs must not call DashScope image-to-video.

## 7. Input Resolution

For each `video_clip` execution:

1. Resolve `planTask.source_segment_id`.
2. Find the matching `SegmentAssetRoute`.
3. Prefer `route.primary_visual_artifact_id` when it points to an `image` artifact.
4. Fall back to `route.fallback_visual_artifact_id` when it points to an `image` artifact.
5. If no same-segment image exists, leave the video execution unhandled and preserve fallback readiness. Do not synthesize an image in the video provider.

The provider must never read `script`, `storyboard`, or `topic` directly. It may use `planTask.prompt_draft`, `planTask.source_excerpt`, and `AssetPlan.art_bible` because those are already part of the assets contract.

## 8. DashScope Request Contract

The first request builder should produce this shape:

```json
{
  "model": "wan2.7-i2v-2026-04-25",
  "input": {
    "prompt": "segment video prompt",
    "media": [
      {
        "type": "first_frame",
        "url": "data:image/png;base64,..."
      }
    ]
  },
  "parameters": {
    "resolution": "720P",
    "duration": 5,
    "prompt_extend": true,
    "watermark": false
  }
}
```

Config fields:

- `ALIYUN_DASHSCOPE_IMAGE_TO_VIDEO_MODEL`
- `ALIYUN_DASHSCOPE_IMAGE_TO_VIDEO_RESOLUTION`
- `ALIYUN_DASHSCOPE_IMAGE_TO_VIDEO_DURATION_SEC`
- `ALIYUN_DASHSCOPE_IMAGE_TO_VIDEO_POLL_INTERVAL_MS`
- `ALIYUN_DASHSCOPE_IMAGE_TO_VIDEO_MAX_POLL_ATTEMPTS`
- existing `ALIYUN_DASHSCOPE_API_KEY`
- existing `ALIYUN_DASHSCOPE_BASE_URL`

Request defaults:

- model: `wan2.7-i2v-2026-04-25`
- resolution: `720P`
- duration: `5`
- prompt_extend: `true`
- watermark: `false`

Duration is intentionally conservative for cost control. A later plan may allow per-task duration from `AssetPlan.tasks[].parameters`, but the first implementation should clamp to the provider-supported range and record the chosen value.

## 9. Local Image Input Strategy

The first implementation should convert local image files to base64 data URI before submit. This avoids requiring a public object storage upload path before the upload/preview stage is designed.

Rules:

- only convert local `image` artifacts;
- infer MIME from file extension or metadata;
- reject transparent PNG only if the provider actually fails or if metadata can prove alpha is present; do not add expensive image inspection in v1;
- fail with a structural provider error if the file is missing;
- do not upload files to public URLs in this plan.

## 10. Output Artifact Contract

Generated artifact:

```ts
{
  artifact_id: `artifact_video_${task_id}`,
  artifact_type: "video",
  origin: "provider",
  file_uri: "<project storage absolute path>",
  created_at: "<ISO timestamp>",
  metadata: {
    duration_sec: 5,
    width: 720,
    height: 1280,
    fps: 24,
    model: "wan2.7-i2v-2026-04-25",
    provider_name: "dashscope_image_to_video",
    provider_job_id: "<task_id>",
    source_image_artifact_id: "<image artifact id>",
    source_url: "<temporary dashscope video_url>",
    file_hash: "<sha256>",
    relative_path: "assets-runs/<run_id>/videos/dashscope_<task_id>.mp4",
    resolution: "720P",
    prompt_extend: true,
    watermark: false
  }
}
```

The current shared `video` metadata schema already requires `duration_sec`, `width`, `height`, and `fps`, and permits provider-specific fields. If width/height/fps cannot be probed from the file, the implementation should derive conservative values from request parameters only when tests prove that path. Prefer probing when a project utility exists.

## 11. Route Update Rule

When the provider returns a valid `video` artifact:

- add the artifact to `manifest.artifacts`;
- append artifact id to the `video_clip` execution output;
- set execution status to `completed`;
- set matching `SegmentAssetRoute.primary_visual_artifact_id` to the video artifact id;
- set `SegmentAssetRoute.visual_route_type` to `video_clip`;
- keep `fallback_visual_artifact_id` pointing at the still image when present;
- leave `motion_artifact_id` untouched for fallback.

When the provider fails:

- do not erase existing image or motion fallback;
- if fallback is complete, mark the video execution `skipped_with_fallback`;
- route can remain `image_with_motion` or `fallback_ready`;
- emit `assets_video_fallback_used` warning through the existing validator path.

## 12. Cost and Safety Controls

- The provider is opt-in only.
- No default test or smoke should hit a real network provider.
- Live checks must be explicit and documented.
- First implementation should run at most one video task per fixture.
- Polling defaults must be conservative.
- No automatic prompt rewriting outside DashScope's own `prompt_extend` flag.
- No local semantic upgrade from image task to video task.

## 13. Validation Boundary

Local validation may check:

- `video_clip` execution references a `video` artifact or has image + motion fallback;
- generated video file exists;
- video artifact has minimum required metadata;
- route references are internally consistent;
- provider job records exist for diagnostics when execution ran.

Local validation must not check:

- whether the video looks good;
- whether motion is cinematic;
- whether the generated clip is historically accurate;
- whether the prompt is strong;
- whether the provider output is publishable.

## 14. Required Smoke Evidence

The implementation should add:

- mocked provider unit tests for payload, submit, poll, download, normalize;
- service/API tests for opt-in provider registration;
- one fake or mocked integration path proving `video_clip -> video artifact -> route visual_route_type=video_clip`;
- one explicit live-check harness command that can be run manually with real credentials and records output under ignored runtime output.

Live check must not become a default CI gate.

## 15. Documentation Updates After Implementation

After implementation, update:

- `docs/architecture/pipeline-io-spec.md`
- `docs/architecture/api-design.md`
- `docs/data/field-design.md`
- `docs/data/schema-design.md`
- `docs/architecture/downstream-stage-high-level-design.md`
- `docs/records/` with a controlled live-check result if real provider is run

The docs must state that image-to-video is an assets provider and that renderer/export remains provider-agnostic.
