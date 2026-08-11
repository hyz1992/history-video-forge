# Subtitle Style and Renderer Consumption Design

Date: 2026-05-20

Status: draft for implementation review

## 1. Goal

Close the P1 gap around subtitle styling and renderer consumption so local Remotion output can render readable, bounded, styled subtitles from the existing subtitle artifacts, while keeping the upstream topic/script/storyboard/asset planning/assets/compose semantic chain unchanged.

This design follows the completed TTS duration and subtitle timing work. It does not redesign subtitle generation, word-level alignment, BGM/SFX, frontend preview UI, publishing, manual review, or DashScope image-to-video.

## 2. Current State

Current subtitle and renderer behavior:

- Local subtitle provider writes SRT and VTT subtitle artifacts.
- Subtitle artifacts now carry `source_tts_chunk_artifact_ids`, `duration_sec`, and `timing_source`.
- Compose creates a subtitle track that references `audio_summary.subtitle_artifact_id`.
- `local-remotion-render-adapter.ts` finds the subtitle artifact and currently reduces the whole SRT file to one static `subtitleText` string.
- `renderer/src/TimelineVideo.tsx` renders that static string with hard-coded CSS.
- There is no shared subtitle style schema, no renderer-safe style normalization, no cue-level renderer payload, and no still-frame visibility smoke.

The next improvement should keep style as renderer-facing presentation metadata and avoid changing script text, subtitle text generation, or compose timing semantics.

## 3. Decisions

### 3.1 Style Contract Location

Store the first renderer-facing subtitle style contract in `subtitle_track.metadata.subtitle_style`.

Rationale:

- `AssetManifest` is already passed to renderer alongside `ComposeTimeline`.
- Subtitle style belongs to the rendered subtitle artifact, not to the narrative plan.
- Compose does not need to duplicate style fields to create a valid timeline.
- Existing `ComposeClip` can remain strict and unchanged in the first implementation.

Compose remains a timing and track assembly contract. It references the subtitle artifact; renderer resolves the artifact and reads style from metadata.

### 3.2 Shared Subtitle Style Shape

Add a shared `SubtitleStyle` schema with conservative numeric bounds. First implementation should support:

- `style_id`: stable style id, default `subtitle_style_default_vertical`.
- `font_family`: CSS font-family string.
- `font_size_px`: integer pixels.
- `font_weight`: numeric CSS weight.
- `line_height`: CSS line-height multiplier.
- `max_lines`: max visible lines.
- `text_color`: CSS color string.
- `stroke_color`: CSS color string.
- `stroke_width_px`: non-negative stroke width.
- `shadow`: CSS text-shadow string.
- `background_color`: CSS color string.
- `background_opacity`: 0-1 opacity hint.
- `position`: `bottom / middle / top`.
- `horizontal_margin_px`: left/right safe margin.
- `bottom_margin_px`: bottom offset when `position=bottom`.
- `top_margin_px`: top offset when `position=top`.
- `safe_area_top_px`: top safe area.
- `safe_area_bottom_px`: bottom safe area.
- `max_width_pct`: percentage of frame width.
- `text_align`: `left / center / right`.

Default vertical short-video style:

- large white text;
- black stroke/shadow for contrast;
- centered near the lower third;
- 2 visible lines;
- bottom safe area that avoids mobile UI and keeps lower content readable.

The schema intentionally avoids platform-specific font loading, karaoke word highlighting, animated captions, per-character layout, and multilingual typography rules in this first pass.

### 3.3 Subtitle Cue Payload

Renderer should consume subtitle cues rather than one flattened SRT text blob.

First implementation should:

- parse SRT and VTT files into `{ start_sec, end_sec, text }` cues;
- pass `subtitleCues` and `subtitleStyle` to Remotion input props;
- choose the active cue by current frame time;
- render no subtitle when no cue is active.

This improves renderer consumption without changing local subtitle provider output.

### 3.4 Renderer Normalization

Renderer must normalize style before rendering:

- If `subtitle_style` is missing, use the shared `DEFAULT_SUBTITLE_STYLE` exported by `shared/src/assets/asset-manifest.schema.ts`.
- Clamp font size, margins, opacity, max width, and line count to schema-safe values.
- Prevent text from escaping the vertical frame by applying safe top/bottom constraints.
- Render with deterministic CSS so tests can inspect generated props and still frames.

Renderer should not infer semantic subtitle quality. It only consumes structured style and cue timing.

### 3.5 Verification

Implementation must include:

- shared schema tests for `subtitle_style`;
- local subtitle provider tests proving default style is written;
- cue parser tests for SRT and VTT, including a `WEBVTT - ...` header and VTT timestamps without hours;
- render adapter tests proving subtitle cues and style are passed to Remotion props;
- renderer component tests for active cue selection and CSS normalization;
- a local Remotion still-frame smoke that renders a subtitle frame and uses a no-dependency PNG pixel scan to confirm non-background subtitle pixels exist in the expected lower safe-area band. This smoke is an opt-in/local renderer verification and requires headless Chromium availability.

Default verification must not call real DashScope.

## 4. Data Contract Changes

Extend `subtitle_track.metadata` with optional:

- `subtitle_style`: `SubtitleStyle`

No first-pass changes to:

- `ComposeTimeline`
- `ComposeClip`
- `RenderJobRecord`
- `ExportArtifact`
- topic/script/storyboard/asset planning schemas

Renderer input props should evolve from:

```ts
subtitleText?: string;
```

to:

```ts
subtitleCues?: Array<{
  start_sec: number;
  end_sec: number;
  text: string;
}>;
subtitleStyle?: SubtitleStyle;
```

`subtitleText` may remain temporarily accepted for compatibility during migration but should no longer be the primary path. Remove it after all production callers send `subtitleCues` and one release cycle has passed without fallback usage.

## 5. Error Handling

- Missing subtitle artifact: renderer keeps existing source validation behavior.
- Missing subtitle file or unsupported URI: adapter passes no cues; source validator already catches missing local files when checkable.
- Malformed SRT/VTT: parser returns valid cues it can parse and records a diagnostic note in adapter diagnostics.
- Missing `subtitle_style`: renderer uses shared `DEFAULT_SUBTITLE_STYLE`.
- Invalid `subtitle_style`: shared schema rejects the artifact; renderer helper falls back defensively when reading unknown legacy manifests.

## 6. Non-Goals

This design does not implement:

- word-level forced alignment;
- karaoke or per-word highlighting;
- subtitle editing UI;
- frontend preview UI;
- platform publishing presets;
- BGM/SFX;
- real DashScope calls;
- renderer-side generation of missing assets;
- changing topic/script/storyboard/asset planning/assets/compose semantic generation.

## 7. Acceptance

The implementation is acceptable when:

- `SubtitleStyle` parses through shared schema and existing subtitle metadata remains compatible.
- Local subtitle provider writes a default `subtitle_style`.
- Renderer adapter passes parsed subtitle cues and normalized style to Remotion.
- Remotion component renders only the active cue for the current frame.
- Still-frame smoke proves subtitle pixels are visible and remain inside the configured safe-area band.
- Focused renderer/assets tests pass without real provider calls.
- Formal docs and backlog are synchronized.
- `git diff --check` passes and each implementation task is committed in Chinese.
