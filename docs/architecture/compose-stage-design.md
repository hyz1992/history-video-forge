# Compose Stage Design

Date: 2026-05-17

> 2026-10-10 范围注记：下文 TTS chunk / merged duration 规则为 legacy 基线。新项目 `narration_first_v1` 按确认口播与 storyboard_v2 的真实区间合成，storyboard/manifest/compose 的 narration_reference 必须同源，音频/字幕复用确认产物。当前合同见 [Pipeline IO §2.6/Compose](./pipeline-io-spec.md) 与 [口播前置设计](../plans/2026-09-05-narration-first-timing-design.md)。

## Purpose

The compose stage turns an active `AssetManifestRecord` into a deterministic timeline contract for final video assembly.

Compose is an engineering assembly stage. It must not rewrite topic, script, storyboard, asset plan, prompts, or generated assets. It only decides whether available assets can be placed on a timeline, how long each visual appears, which tracks are present, and whether the output is ready for a later renderer/exporter.

## Decision

Compose v1 uses a hybrid-compatible design, but the first implementation should only build a local timeline contract:

1. Primary path: still images plus `motion_recipe` entries become visual timeline clips.
2. Optional path: existing `video` artifacts can be consumed when assets already produced them.
3. Provider boundary: DashScope image-to-video generation is implemented only in assets execution; compose v1 consumes resulting `video` artifacts when present.

This keeps compose cheap, deterministic, and testable. It also keeps I2V optional: missing or failed video clips can fall back to still images plus `motion_recipe`.

## Inputs

Required input:

- active `AssetManifestRecord`
- its `AssetManifest`
- source `AssetPlanRecord`
- source `StoryboardRecord`
- source `ScriptRecord`
- project storage root

Compose consumes only persisted upstream records. It must not call LLMs or third-party media providers.

## Outputs

Compose v1 introduces:

- `ComposeTimeline`
- `ComposeValidationResult`
- `ComposeRecord`
- project pointer `activeComposeRecordId`
- project trace `latestComposeRunTraceJson`

The timeline is a contract for a later renderer. It is not the final exported video file.

## Timeline Model

`ComposeTimeline` should include:

- `timeline_version: "compose_timeline_v1"`
- source ids:
  - `source_asset_manifest_record_id`
  - `source_asset_plan_record_id`
  - `source_storyboard_record_id`
  - `source_script_record_id`
- `output_profile`
  - `aspect_ratio`, default `9:16`
  - `width`, default `1080`
  - `height`, default `1920`
  - `fps`, default `30`
- `duration_sec`
- `tracks`
  - `visual`
  - `narration`
  - `subtitle`
  - optional `bgm`
  - optional `sfx`
- `segments`
  - one segment-level timeline group per `AssetManifest.segment_routes[]`

Each clip should be a reference to an `AssetArtifact.artifact_id`, not an embedded file path. File existence is checked through the manifest artifacts.

## Time Source（legacy）

The final narration audio is the timeline source of truth.

Priority:

1. Use TTS chunk durations when every `tts_chunk_route.artifact_id` resolves to a `tts_chunk_audio` artifact with `duration_sec`.
2. Use the merged TTS artifact `duration_sec` as total duration.
3. If chunk durations are missing but merged duration exists, distribute time across segment routes by storyboard order as a structural fallback and emit a warning.
4. If no narration duration exists, validation must block compose.

Storyboard `start_hint_sec` and `end_hint_sec` are not source-of-truth for compose.

## Visual Rules

For each segment route:

- `video_clip`: use the primary video artifact; trim or loop only as a later renderer decision.
- `image_with_motion`: use primary image artifact plus motion recipe.
- `image_only`: use primary image artifact with a default static hold.
- `missing`: block compose.

If a route has a `fallback_visual_artifact_id`, compose may use it only when primary visual is missing or when the route readiness is `fallback_ready`.

Compose v1 should not judge whether an image looks good. It only verifies that required references exist and the timeline can be assembled.

## Audio Rules

Narration:

- required
- uses `audio_summary.tts_merged_artifact_id`
- segment timing uses chunk routes when available

Subtitles:

- required for v1 timeline readiness
- use `audio_summary.subtitle_artifact_id`
- subtitle styling is deferred to renderer/exporter configuration

BGM:

- optional
- missing BGM does not block compose
- existing BGM artifact/selection can become a timeline track

SFX:

- optional
- segment route `sfx_artifact_ids` can become segment-scoped clips

## Validation

`ComposeValidationResult` should be structural only.

Errors:

- `compose_active_assets_missing`
- `compose_asset_manifest_not_ready`
- `compose_narration_missing`
- `compose_narration_duration_missing`
- `compose_subtitle_missing`
- `compose_segment_visual_missing`
- `compose_artifact_missing`
- `compose_artifact_file_missing`
- `compose_timeline_duration_invalid`

Warnings:

- `compose_assets_partial_with_nonblocking_warnings`
- `compose_bgm_missing_optional`
- `compose_sfx_missing_optional`
- `compose_chunk_timing_fallback_used`
- `compose_video_duration_alignment_deferred`

Decisions:

- `ready_for_render`
- `blocked`
- `partial`

`partial` means the timeline is structurally assembled but has non-blocking warnings. It does not mean final video quality is approved.

## API Boundary

Compose v1 should expose:

- `POST /api/projects/:projectId/compose/generate`

The route should:

1. require an active asset manifest;
2. build a timeline from the active manifest;
3. validate the timeline;
4. persist a compose record;
5. activate it only if source pointers remain stable;
6. update project status:
   - `compose_ready` for `ready_for_render`
   - `compose_blocked` for `blocked` or `partial`

No binary rendering endpoint is part of v1.

## Stale Source Rules

If a new asset manifest is activated while compose generation is running, the old compose result must return `409 stale_compose_source` and must not activate.

New upstream activations must clear stale compose pointers:

- new script clears storyboard, asset plan, asset manifest, compose;
- new storyboard clears asset plan, asset manifest, compose;
- new asset plan clears asset manifest, compose;
- new asset manifest clears compose.

## Non-Goals

Compose v1 does not:

- call DashScope image-to-video;
- render final MP4;
- run Remotion;
- generate missing assets;
- regenerate prompts;
- judge aesthetics;
- edit script/storyboard/asset plan.

Frontend preview UI can be designed as a separate workflow that consumes the
compose timeline; it is not part of the Compose v1 backend generation contract.

## Future Extension

After compose v1 is stable, the next design can choose one of two renderer paths:

1. Local renderer: Remotion consumes `ComposeTimeline` and exports MP4.
2. Provider video path: assets stage produces I2V clips, compose consumes them as `video` artifacts.

Both should reuse `ComposeTimeline` as the handoff contract.
