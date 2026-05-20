# Renderer / Export Stage Design

Date: 2026-05-17

## Purpose

The renderer / export stage turns an active `ComposeRecord` and its `ComposeTimeline` into a local previewable video artifact.

Renderer is an output stage. It must not rewrite topic, script, storyboard, asset plan, asset manifest, prompts, or the compose timeline. Its job is to prove that the timeline can be rendered, muxed, and exported into a concrete media file.

## Decision

Renderer v1 should use a local still-image motion path first:

1. Consume `ComposeTimeline` as the source contract.
2. Render still images with deterministic motion recipes, narration, subtitles, and optional BGM/SFX.
3. Export an MP4 file and persist a render/export record.
4. Keep DashScope image-to-video out of renderer v1. Image-to-video is an assets provider path that produces `video` artifacts for compose and renderer to consume.

This is deliberately narrower than "final production video". It gives the project its first end-to-end local video output without making expensive or long-running video generation mandatory.

## Why Local Renderer First

The current pipeline already has:

- active assets that can contain TTS, subtitle, image, and motion-recipe artifacts;
- a persisted `ComposeTimeline`;
- structural compose validation and upstream invalidation;
- a runtime smoke that reaches active compose state.

The missing proof is not provider generation. The missing proof is whether an active timeline can become an inspectable file. A local renderer gives that proof with lower cost, faster tests, and fewer moving parts.

DashScope image-to-video belongs in assets execution as a provider that creates `video` artifacts; compose and renderer only consume those artifacts or the image + motion fallback.

## Inputs

Required input:

- active `ComposeRecord`
- `ComposeTimeline`
- source `AssetManifestRecord`
- project storage root
- renderer profile, defaulting to:
  - aspect ratio: `9:16`
  - width: `1080`
  - height: `1920`
  - fps: `30`
  - container: `mp4`

Renderer must load artifact file references from the source asset manifest. It should not infer missing files or call asset providers.

## Outputs

Renderer v1 should introduce:

- `RenderJobRecord`
- `RenderValidationResult`
- `ExportArtifact`
- project pointer `activeRenderJobRecordId`
- project trace `latestRenderRunTraceJson`

The primary output is a local MP4 artifact stored under the project runtime output directory.

## Render Model

`RenderJobRecord` should contain:

- `id`
- `projectId`
- `composeRecordId`
- `assetManifestRecordId`
- `status`: `queued | rendering | completed | failed | stale_source`
- `profileJson`
- `outputArtifactJson`
- `validationResultJson`
- `executionStateJson`
- `graphTraceSummaryJson`
- `runtimeDiagnosticsJson`
- `createdAt`
- `updatedAt`

`ExportArtifact` should contain:

- `artifact_id`
- `artifact_type: "rendered_video"`
- `file_uri`
- `mime_type: "video/mp4"`
- `duration_sec`
- `width`
- `height`
- `fps`
- `source_compose_record_id`
- `source_asset_manifest_record_id`
- `metadata`

## Rendering Rules

Visual track:

- `image_with_motion`: render the image using its motion recipe.
- `image_only`: render a static hold.
- `video`: consume the existing video artifact when present; trimming and looping are renderer responsibilities.
- missing file: block render.

Narration track:

- required;
- uses the narration clip artifact from the compose timeline;
- final render duration must match narration duration within a small tolerance.

Subtitle track:

- required for renderer v1;
- consumes subtitle artifact from the compose timeline;
- subtitle style is a renderer profile setting, not a script/storyboard change.

BGM/SFX:

- optional;
- included only when referenced artifacts exist;
- missing optional audio should warn, not block, unless the timeline explicitly marks the clip required.

Current local Remotion implementation note (2026-05-20):

- the backend adapter normalizes `ComposeTimeline` + `AssetManifest` into render-ready `visualClips`, `audioClips`, `subtitleCues`, and `subtitleStyle` props before calling Remotion;
- `TimelineVideo` consumes normalized props and does not infer upstream intent from raw project storage;
- image and video visual clips are scheduled by start/duration, with image + `motion_recipe` fallback supporting `hold`, `slow_push_in`, `push_in`, `pan_left`, `pan_right`, `pan_up`, `pan_down`, `zoom_in`, `zoom_out`, and crossfade between adjacent clips;
- narration audio is muxed when a renderable audio artifact exists; optional BGM/SFX are rendered only when concrete artifacts already exist and are referenced by the timeline;
- fake TTS writes deterministic render-ready WAV files for offline Remotion smoke tests;
- static quality smoke uses Remotion `renderStill` plus PNG pixel checks, so it requires headless Chromium and only proves nonblank visuals plus visible subtitles.

## Validation

`RenderValidationResult` should be structural and file-oriented.

Errors:

- `render_active_compose_missing`
- `render_compose_record_missing`
- `render_timeline_not_ready`
- `render_asset_manifest_missing`
- `render_artifact_missing`
- `render_artifact_file_missing`
- `render_narration_missing`
- `render_subtitle_missing`
- `render_output_missing`
- `render_output_duration_mismatch`
- `render_output_probe_failed`
- `render_stale_source`

Warnings:

- `render_bgm_missing_optional`
- `render_sfx_missing_optional`
- `render_video_trim_or_loop_used`
- `render_motion_recipe_fallback_used`
- `render_probe_partial_metadata`

Decisions:

- `ready_to_render`
- `rendered`
- `blocked`
- `failed`

Renderer validation must not judge visual quality, story quality, historical correctness, or whether a video is attractive enough to publish.

## API Boundary

Renderer v1 should expose:

- `POST /api/projects/:projectId/render/generate`

The route should:

1. require an active compose record;
2. verify the compose timeline is `ready_for_render` or explicitly allow rendering a `partial` timeline only when the request opts in;
3. validate all referenced files;
4. create a render job record;
5. render/export the MP4;
6. probe the output file;
7. activate the render record only if source pointers remain stable;
8. update project status:
   - `render_ready` for successful output;
   - `render_blocked` for structural blockers;
   - `render_failed` for renderer execution failures.

No frontend preview UI is part of renderer v1.

## Stale Source Rules

Renderer must activate only against stable sources.

If active compose changes while rendering is in progress, the render result must return `409 stale_render_source` and must not activate.

New upstream activations must clear stale render pointers:

- new script clears storyboard, asset plan, asset manifest, compose, render;
- new storyboard clears asset plan, asset manifest, compose, render;
- new asset plan clears asset manifest, compose, render;
- new asset manifest clears compose and render;
- new compose clears render.

Historical render records may remain for diagnosis, but project snapshot must only expose the active render pointer.

## Non-Goals

Renderer v1 does not:

- call DashScope image-to-video;
- generate missing images, audio, subtitles, BGM, or SFX;
- implement a media review UI;
- implement user upload;
- publish to any platform;
- judge aesthetics or virality;
- rewrite upstream contracts;
- solve full production polish.

## Future Extension

After renderer v1 exports a local MP4, the next extensions can be designed separately:

1. Optional real DashScope image-to-video live-check evidence and provider hardening.
2. Frontend render preview and accept/reject workflow.
3. Subtitle style presets and BGM/SFX mixing controls.
4. Publish-ready quality review and manual edit loop.
