# Remotion Local Render Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve the local Remotion renderer from a minimal MP4 proof into a low-cost, reviewable vertical-video composition path that consumes visual clips, motion recipes, narration, subtitles, and already-existing optional audio artifacts.

**Architecture:** Keep renderer/export as an output-only stage. The backend adapter will normalize `ComposeTimeline` + `AssetManifest` into explicit Remotion props, and the Remotion component will render those normalized props without reading project storage or guessing upstream intent. Compose may be extended only to expose already-existing BGM/SFX artifacts as optional timeline tracks; no provider generation, semantic rewriting, preview UI, or publish workflow is included.

**Tech Stack:** TypeScript, Zod shared schemas, Vitest, Remotion, React, existing backend render adapter boundary, existing fake/local assets providers, existing runtime smoke harness.

---

## Review Guide For A New Agent

Read these files before implementation:

- `AGENTS.md`
- `docs/records/2026-05-19-video-pipeline-follow-up-backlog.md`
- `docs/architecture/renderer-stage-design.md`
- `docs/architecture/pipeline-io-spec.md`
- `backend/src/modules/render/local-remotion-render-adapter.ts`
- `backend/src/modules/render/render-adapter.ts`
- `backend/src/modules/render/render-source-validator.ts`
- `backend/src/modules/compose/compose-timeline-builder.ts`
- `renderer/src/TimelineVideo.tsx`
- `renderer/src/timeline-props.ts`
- `tests/backend/render/local-remotion-render-adapter.test.ts`
- `tests/backend/render/remotion-subtitle-still-smoke.test.ts`
- `tests/harness/render-runtime-smoke.test.ts`

Current baseline assumptions:

- Renderer/export v1 already exists and persists `RenderJobRecord`.
- `createLocalRemotionRenderAdapter()` already produces MP4 through Remotion.
- Subtitle cue parsing and `subtitle_style` consumption are already implemented.
- `TimelineVideo` currently renders only the first visual artifact and applies a single push-in scale to the whole render.
- `renderMedia()` currently runs with `muted: true`, so narration is not actually muxed.
- Compose currently produces visual, narration, and subtitle tracks. It does not yet emit BGM/SFX tracks even when manifest artifacts exist.
- Fake TTS currently writes `.txt` files while claiming TTS audio metadata. This is fine for fake persistence tests, but not sufficient for unmuted Remotion audio rendering.

Core invariants:

- Do not call DashScope image-to-video from renderer.
- Do not call real TTS or voice design in this plan.
- Do not generate missing media in renderer.
- Do not change topic/script/storyboard/asset planning semantics.
- Do not implement frontend preview UI, publish flow, human review flow, or aesthetic scoring.
- Do not install new dependencies; Remotion packages already exist in the workspace.
- Do not touch `storage/topic-candidate-library/`.

Review checkpoints:

- Each task must be test-first.
- Each completed task must be committed with a Chinese commit message.
- Prefer focused tests over broad suites until Task 9 regression.
- If a task touches shared schema, compose, or API-facing docs, run its focused schema/docs tests in the same task.

## Scope

This plan implements:

- normalized Remotion input props for explicit visual/audio/subtitle composition;
- multi-clip visual scheduling by `start_sec` / `duration_sec`;
- first-class local rendering for image clips and video clips;
- motion recipes for `hold`, `slow_push_in`, `push_in`, `pan_left`, `pan_right`, `pan_up`, `pan_down`, `zoom_in`, and `zoom_out`;
- crossfade between adjacent visual clips;
- narration audio muxing;
- optional BGM/SFX audio rendering when concrete artifacts are already present;
- render-ready fake TTS WAV fixtures for low-cost local smoke;
- pixel-level and runtime smoke checks that prove nonblank visuals, subtitle visibility, and Remotion MP4 export.

This plan does not implement:

- paid provider calls;
- new BGM/SFX provider or material library;
- frontend preview controls;
- user upload or manual replacement UI;
- platform publishing;
- word-level alignment or karaoke captions;
- semantic/aesthetic quality gates;
- changes to prompt files.

## Design Decisions

### Decision 1: Normalize props in backend before Remotion

`TimelineVideo` should receive render-ready props:

- `visualClips`: sorted media clips with browser-readable `src`, timing, media type, optional motion, and optional transition.
- `audioClips`: narration, BGM, and SFX clips with `src`, timing, volume, and role.
- `subtitleCues` and `subtitleStyle`: existing subtitle path remains unchanged.

This avoids making the React renderer infer asset metadata from raw manifests. It also gives backend tests a pure place to verify clip selection before Remotion is involved.

### Decision 2: Keep raw timeline and manifest as diagnostics

The existing props `timeline`, `assetManifest`, `assetBaseDir`, `width`, `height`, and `fps` should remain for compatibility and debugging. New renderer logic should prefer normalized props when present.

### Decision 3: Compose emits optional audio tracks only for concrete artifacts

Compose may add BGM/SFX tracks only when artifacts already exist in `AssetManifest`:

- `bgm_audio` referenced by `audio_summary.bgm_placements[].artifact_id`;
- `sfx_audio` referenced by segment routes or `audio_summary.sfx_artifact_ids`.

Missing optional BGM/SFX still warn only; they do not block compose or render.

### Decision 4: Fake TTS becomes render-ready WAV

The fake TTS provider should write deterministic silent WAV files instead of `.txt` for TTS artifacts. This keeps tests offline while making the local Remotion smoke able to mux audio without provider calls.

### Decision 5: Quality checks stay structural and pixel-level

The plan proves that output is nonblank, timed, and inspectable. It does not judge whether the visual is compelling or publish-ready.

## File Map

Create:

- `backend/src/modules/render/remotion-input-builder.ts`
- `renderer/src/visual-rendering.ts`
- `renderer/src/motion-rendering.ts`
- `renderer/src/audio-rendering.ts`
- `tests/backend/render/remotion-input-builder.test.ts`
- `tests/renderer/visual-rendering.test.ts`
- `tests/renderer/motion-rendering.test.ts`
- `tests/renderer/audio-rendering.test.ts`
- `tests/backend/render/remotion-local-quality-smoke.test.ts`
- `tests/backend/render/png-smoke-helper.ts`

Modify:

- `backend/src/modules/render/local-remotion-render-adapter.ts`
- `backend/src/modules/render/render-adapter.ts`
- `backend/src/modules/compose/compose-timeline-builder.ts`
- `backend/src/modules/assets/providers/fake-tts-provider.ts`
- `renderer/src/TimelineVideo.tsx`
- `renderer/src/timeline-props.ts`
- `tests/backend/render/local-remotion-render-adapter.test.ts`
- `tests/backend/render/remotion-subtitle-still-smoke.test.ts`
- `tests/backend/compose/compose-timeline-builder.test.ts`
- `tests/backend/assets/fake-tts-provider.test.ts`
- `tests/harness/render-runtime-smoke.test.ts`
- `docs/architecture/pipeline-io-spec.md`
- `docs/architecture/renderer-stage-design.md`
- `docs/data/field-design.md`
- `docs/data/schema-design.md`
- `docs/plans/README.md`
- `docs/records/2026-05-19-video-pipeline-follow-up-backlog.md`

## Task 1: Normalize Remotion Input Props

**Files:**

- Create: `backend/src/modules/render/remotion-input-builder.ts`
- Modify: `backend/src/modules/render/local-remotion-render-adapter.ts`
- Modify: `renderer/src/timeline-props.ts`
- Test: `tests/backend/render/remotion-input-builder.test.ts`
- Test: `tests/backend/render/local-remotion-render-adapter.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/backend/render/remotion-input-builder.test.ts` with these cases:

```ts
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { buildRemotionInputProps } from "../../../backend/src/modules/render/remotion-input-builder.js";
import type { AssetManifest, ComposeTimeline } from "../../../shared/src/index.js";

describe("buildRemotionInputProps", () => {
  it("normalizes visual, narration, subtitle, and motion props", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "remotion-input-builder-"));
    const imagePath = join(tempDir, "image.png");
    const audioPath = join(tempDir, "narration.wav");
    const subtitlePath = join(tempDir, "subtitle.srt");
    await writeFile(imagePath, Buffer.from("iVBORw0KGgo=", "base64"));
    await writeFile(audioPath, Buffer.from("UklGRiQAAABXQVZF", "base64"));
    await writeFile(subtitlePath, "1\n00:00:00,000 --> 00:00:02,000\nHello.\n", "utf8");

    const timeline = makeTimelineWithTwoVisualsAndNarration();
    const manifest = makeManifestWithImageMotionNarrationSubtitle({
      imagePath,
      audioPath,
      subtitlePath,
    });

    const props = await buildRemotionInputProps({
      timeline,
      manifest,
      assetBaseDir: tempDir,
      width: 540,
      height: 960,
      fps: 30,
    });

    expect(props.visualClips).toMatchObject([
      {
        clipId: "clip_visual_001",
        artifactId: "artifact_img_001",
        mediaType: "image",
        startSec: 0,
        durationSec: 2,
        motion: { recipeType: "slow_push_in" },
      },
      {
        clipId: "clip_visual_002",
        artifactId: "artifact_video_001",
        mediaType: "video",
        startSec: 2,
        durationSec: 2,
      },
    ]);
    expect(props.audioClips).toMatchObject([
      {
        clipId: "clip_narration",
        role: "narration",
        startSec: 0,
        durationSec: 4,
        volume: 1,
      },
    ]);
    expect(props.subtitleCues).toEqual([
      { start_sec: 0, end_sec: 2, text: "Hello." },
    ]);
  });
});
```

The test file should define local `makeTimelineWithTwoVisualsAndNarration()` and `makeManifestWithImageMotionNarrationSubtitle()` helpers using existing shared schemas. The helper must include:

- one `image_with_motion` visual clip;
- one `video` visual clip;
- one narration audio clip;
- one subtitle clip;
- one `motion_recipe` artifact with `metadata.recipe_type = "slow_push_in"`.

- [ ] **Step 2: Run failing tests**

Run:

```bash
npx vitest run --configLoader runner tests/backend/render/remotion-input-builder.test.ts
```

Expected: fail because `backend/src/modules/render/remotion-input-builder.ts` does not exist.

- [ ] **Step 3: Implement normalized prop types**

Extend `renderer/src/timeline-props.ts`:

```ts
export type RenderVisualMediaType = "image" | "video";
export type RenderAudioRole = "narration" | "bgm" | "sfx";

export interface RenderMotionProp {
  recipeType: string;
  parameters: Record<string, unknown>;
}

export interface RenderVisualTransitionProp {
  type: "crossfade";
  durationSec: number;
}

export interface RenderVisualClipProp {
  clipId: string;
  artifactId: string;
  mediaType: RenderVisualMediaType;
  src: string;
  startSec: number;
  durationSec: number;
  motion?: RenderMotionProp;
  /** Transition into this clip from the previous visual clip. */
  transition?: RenderVisualTransitionProp;
}

export interface RenderAudioClipProp {
  clipId: string;
  artifactId: string;
  role: RenderAudioRole;
  src: string;
  startSec: number;
  durationSec: number;
  volume: number;
}

export interface TimelineVideoProps {
  timeline: unknown;
  assetManifest: unknown;
  assetBaseDir: string;
  width: number;
  height: number;
  fps: number;
  subtitleText?: string;
  subtitleCues?: SubtitleCueProp[];
  subtitleStyle?: SubtitleStyleProp;
  visualClips?: RenderVisualClipProp[];
  audioClips?: RenderAudioClipProp[];
}
```

- [ ] **Step 4: Move the builder into a focused module**

Refactor the existing `buildRemotionInputProps()` implementation out of `local-remotion-render-adapter.ts` and into `backend/src/modules/render/remotion-input-builder.ts`. This is a move-and-extend step, not a rewrite. Preserve the current subtitle parsing, subtitle style normalization, and image data-URI conversion behavior before adding visual/audio clip normalization.

The new builder must:

- preserve existing `subtitleCues` and `subtitleStyle` behavior;
- convert local image files to data URIs as the current adapter already does;
- convert local audio/video files to browser-readable `file://` URLs through `pathToFileURL`;
- sort visual and audio clips by `start_sec`;
- map visual `clip_kind` to `mediaType`;
- attach motion metadata when `clip.motion_artifact_id` exists;
- attach a default crossfade transition of `0.25` seconds to visual clips after the first clip;
- set narration volume to `1`;
- set BGM volume from placement metadata when available, otherwise `0.3`;
- set SFX volume to `0.8`.

- [ ] **Step 5: Update adapter imports**

Modify `backend/src/modules/render/local-remotion-render-adapter.ts` so it imports `buildRemotionInputProps` from `./remotion-input-builder.js`. Keep `buildRemotionInputProps` exported from the new module for production and tests.

- [ ] **Step 6: Verify**

Run:

```bash
npx vitest run --configLoader runner tests/backend/render/remotion-input-builder.test.ts tests/backend/render/local-remotion-render-adapter.test.ts
git diff --check
```

Expected: tests pass and no whitespace errors.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/render/remotion-input-builder.ts backend/src/modules/render/local-remotion-render-adapter.ts renderer/src/timeline-props.ts tests/backend/render/remotion-input-builder.test.ts tests/backend/render/local-remotion-render-adapter.test.ts
git commit -m "规范化 Remotion 输入属性"
```

## Task 2: Render Timed Visual Clips

**Files:**

- Create: `renderer/src/visual-rendering.ts`
- Modify: `renderer/src/TimelineVideo.tsx`
- Test: `tests/renderer/visual-rendering.test.ts`

- [ ] **Step 1: Write failing visual helper tests**

Create `tests/renderer/visual-rendering.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  getVisibleVisualLayers,
  makeVisualLayerStyle,
} from "../../renderer/src/visual-rendering";
import type { RenderVisualClipProp } from "../../renderer/src/timeline-props";

const clips: RenderVisualClipProp[] = [
  {
    clipId: "clip_a",
    artifactId: "artifact_a",
    mediaType: "image",
    src: "data:image/png;base64,a",
    startSec: 0,
    durationSec: 2,
  },
  {
    clipId: "clip_b",
    artifactId: "artifact_b",
    mediaType: "video",
    src: "file:///tmp/b.mp4",
    startSec: 2,
    durationSec: 2,
    transition: { type: "crossfade", durationSec: 0.25 },
  },
];

describe("visual rendering helpers", () => {
  it("returns the active clip for the current frame", () => {
    expect(getVisibleVisualLayers({ clips, frame: 15, fps: 30 })).toMatchObject([
      { clip: { clipId: "clip_a" }, opacity: 1 },
    ]);
    expect(getVisibleVisualLayers({ clips, frame: 75, fps: 30 })).toMatchObject([
      { clip: { clipId: "clip_b" }, opacity: 1 },
    ]);
  });

  it("returns both adjacent clips during crossfade", () => {
    const layers = getVisibleVisualLayers({ clips, frame: 59, fps: 30 });
    expect(layers.map((layer) => layer.clip.clipId)).toEqual(["clip_a", "clip_b"]);
    expect(layers[0]!.opacity).toBeLessThan(1);
    expect(layers[1]!.opacity).toBeGreaterThan(0);
  });

  it("keeps visual layers full-frame and stable", () => {
    expect(makeVisualLayerStyle({ opacity: 0.5 })).toMatchObject({
      position: "absolute",
      inset: 0,
      width: "100%",
      height: "100%",
      objectFit: "cover",
      opacity: 0.5,
    });
  });
});
```

- [ ] **Step 2: Run failing tests**

Run:

```bash
npx vitest run --configLoader runner tests/renderer/visual-rendering.test.ts
```

Expected: fail because `renderer/src/visual-rendering.ts` does not exist.

- [ ] **Step 3: Implement visual helper**

Create `renderer/src/visual-rendering.ts` with:

```ts
import type { CSSProperties } from "react";
import type { RenderVisualClipProp } from "./timeline-props";

export interface VisibleVisualLayer {
  clip: RenderVisualClipProp;
  opacity: number;
  localFrame: number;
  localSec: number;
}

export function getVisibleVisualLayers(input: {
  clips: RenderVisualClipProp[];
  frame: number;
  fps: number;
}): VisibleVisualLayer[] {
  const currentSec = input.frame / input.fps;
  const layers: VisibleVisualLayer[] = [];

  for (let index = 0; index < input.clips.length; index += 1) {
    const clip = input.clips[index]!;
    const nextClip = input.clips[index + 1];
    const startSec = clip.startSec;
    const endSec = clip.startSec + clip.durationSec;
    const fadeInSec = clip.transition?.type === "crossfade"
      ? clip.transition.durationSec
      : 0;
    const fadeOutSec = nextClip?.transition?.type === "crossfade"
      ? nextClip.transition.durationSec
      : 0;
    const fadeStartSec = Math.max(startSec - fadeInSec, 0);
    const visible = currentSec >= fadeStartSec && currentSec < endSec;
    if (!visible) continue;

    let opacity = 1;
    if (fadeInSec > 0 && currentSec < startSec) {
      opacity = (currentSec - fadeStartSec) / fadeInSec;
    }
    if (fadeOutSec > 0 && currentSec >= endSec - fadeOutSec) {
      opacity = Math.min(opacity, (endSec - currentSec) / fadeOutSec);
    }

    layers.push({
      clip,
      opacity: clamp(opacity, 0, 1),
      localSec: Math.max(0, currentSec - clip.startSec),
      localFrame: Math.max(0, Math.round((currentSec - clip.startSec) * input.fps)),
    });
  }

  return layers.sort((a, b) => a.clip.startSec - b.clip.startSec);
}

export function makeVisualLayerStyle(input: {
  opacity: number;
  transform?: string;
}): CSSProperties {
  return {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    objectFit: "cover",
    opacity: input.opacity,
    transform: input.transform,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
```

- [ ] **Step 4: Update `TimelineVideo`**

Modify `renderer/src/TimelineVideo.tsx`:

- use `props.visualClips` when present;
- render `Img` for `mediaType === "image"`;
- render Remotion `OffthreadVideo` for `mediaType === "video"`;
- preserve current raw-manifest fallback path only when `visualClips` is missing;
- keep black background as final fallback.

The component should continue to render subtitles exactly as before.

- [ ] **Step 5: Verify**

Run:

```bash
npx vitest run --configLoader runner tests/renderer/visual-rendering.test.ts tests/renderer/subtitle-rendering.test.ts tests/backend/render/remotion-subtitle-still-smoke.test.ts
git diff --check
```

Expected: renderer helper tests pass, existing subtitle tests pass, and static subtitle smoke still passes.

- [ ] **Step 6: Commit**

```bash
git add renderer/src/visual-rendering.ts renderer/src/TimelineVideo.tsx tests/renderer/visual-rendering.test.ts
git commit -m "按时间渲染多段视觉轨"
```

## Task 3: Apply Motion Recipes

**Files:**

- Create: `renderer/src/motion-rendering.ts`
- Modify: `renderer/src/TimelineVideo.tsx`
- Test: `tests/renderer/motion-rendering.test.ts`
- Test: `tests/backend/render/remotion-input-builder.test.ts`

- [ ] **Step 1: Write failing motion tests**

Create `tests/renderer/motion-rendering.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { makeMotionTransform } from "../../renderer/src/motion-rendering";

describe("motion rendering", () => {
  it("keeps hold clips still", () => {
    expect(makeMotionTransform({
      recipeType: "hold",
      progress: 0.5,
      parameters: {},
    })).toBe("scale(1) translate3d(0%, 0%, 0)");
  });

  it("applies slow push-in", () => {
    expect(makeMotionTransform({
      recipeType: "slow_push_in",
      progress: 1,
      parameters: {},
    })).toBe("scale(1.06) translate3d(0%, 0%, 0)");
  });

  it("applies pan directions", () => {
    expect(makeMotionTransform({
      recipeType: "pan_left",
      progress: 1,
      parameters: { distance_pct: 4 },
    })).toBe("scale(1.04) translate3d(-4%, 0%, 0)");
    expect(makeMotionTransform({
      recipeType: "pan_up",
      progress: 1,
      parameters: { distance_pct: 3 },
    })).toBe("scale(1.04) translate3d(0%, -3%, 0)");
  });
});
```

- [ ] **Step 2: Run failing tests**

Run:

```bash
npx vitest run --configLoader runner tests/renderer/motion-rendering.test.ts
```

Expected: fail because `renderer/src/motion-rendering.ts` does not exist.

- [ ] **Step 3: Implement motion helper**

Create `renderer/src/motion-rendering.ts`:

```ts
export function makeMotionTransform(input: {
  recipeType: string;
  progress: number;
  parameters: Record<string, unknown>;
}): string {
  const progress = clamp(input.progress, 0, 1);
  const distancePct = readNumber(input.parameters.distance_pct, 4);

  if (input.recipeType === "hold") {
    return "scale(1) translate3d(0%, 0%, 0)";
  }
  if (input.recipeType === "zoom_out") {
    return `scale(${format(1.06 - 0.06 * progress)}) translate3d(0%, 0%, 0)`;
  }
  if (input.recipeType === "zoom_in" || input.recipeType === "push_in" || input.recipeType === "slow_push_in") {
    return `scale(${format(1 + 0.06 * progress)}) translate3d(0%, 0%, 0)`;
  }
  if (input.recipeType === "pan_left") {
    return `scale(1.04) translate3d(${format(-distancePct * progress)}%, 0%, 0)`;
  }
  if (input.recipeType === "pan_right") {
    return `scale(1.04) translate3d(${format(distancePct * progress)}%, 0%, 0)`;
  }
  if (input.recipeType === "pan_up") {
    return `scale(1.04) translate3d(0%, ${format(-distancePct * progress)}%, 0)`;
  }
  if (input.recipeType === "pan_down") {
    return `scale(1.04) translate3d(0%, ${format(distancePct * progress)}%, 0)`;
  }

  return `scale(${format(1 + 0.04 * progress)}) translate3d(0%, 0%, 0)`;
}

function readNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function format(value: number) {
  return Number(value.toFixed(4)).toString();
}
```

- [ ] **Step 4: Wire motion into `TimelineVideo`**

For each visible visual layer:

- compute `progress = localSec / clip.durationSec`;
- call `makeMotionTransform()` when `clip.motion` exists;
- pass the transform into `makeVisualLayerStyle()`;
- default missing motion to `hold`.

- [ ] **Step 5: Verify**

Run:

```bash
npx vitest run --configLoader runner tests/renderer/motion-rendering.test.ts tests/renderer/visual-rendering.test.ts tests/backend/render/remotion-input-builder.test.ts tests/backend/render/remotion-subtitle-still-smoke.test.ts
git diff --check
```

Expected: all focused tests pass.

- [ ] **Step 6: Commit**

```bash
git add renderer/src/motion-rendering.ts renderer/src/TimelineVideo.tsx tests/renderer/motion-rendering.test.ts
git commit -m "应用本地镜头动效"
```

## Task 4: Make Fake TTS Render-Ready

**Files:**

- Modify: `backend/src/modules/assets/providers/fake-tts-provider.ts`
- Test: `tests/backend/assets/fake-tts-provider.test.ts`
- Test: `tests/harness/render-runtime-smoke.test.ts`

- [ ] **Step 1: Write failing fake TTS tests**

Add assertions to `tests/backend/assets/fake-tts-provider.test.ts`:

```ts
import { readFile } from "node:fs/promises";

// Add these assertions inside the existing
// "produces TTS chunk and merged audio artifacts and updates routes" test,
// after `mergedArtifacts` has been computed.
expect(mergedArtifacts[0]!.file_uri.endsWith(".wav")).toBe(true);
expect(mergedArtifacts[0]!.metadata).toMatchObject({
  format: "wav",
  duration_source: "estimated",
  timing_source: "estimated",
});

const mergedBytes = await readFile(mergedArtifacts[0]!.file_uri);
expect(mergedBytes.subarray(0, 4).toString("ascii")).toBe("RIFF");
expect(mergedBytes.subarray(8, 12).toString("ascii")).toBe("WAVE");

for (const chunk of chunkArtifacts) {
  expect(chunk.file_uri.endsWith(".wav")).toBe(true);
  expect(chunk.metadata).toMatchObject({
    format: "wav",
    duration_source: "estimated",
    timing_source: "estimated",
  });
}
```

- [ ] **Step 2: Run failing tests**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/fake-tts-provider.test.ts
```

Expected: fail because fake TTS writes `.txt` files.

- [ ] **Step 3: Add local WAV helper inside fake provider**

Modify `backend/src/modules/assets/providers/fake-tts-provider.ts`:

- replace `.txt` filenames with `.wav`;
- write deterministic PCM silence WAV buffers;
- keep duration metadata derived from `estimated_duration_sec`;
- set `format: "wav"`;
- set `duration_source: "estimated"`;
- set `timing_source: "estimated"`.

The helper should be local to the fake provider:

```ts
function createSilentWavBuffer(input: {
  durationSec: number;
  sampleRate?: number;
}) {
  const sampleRate = input.sampleRate ?? 16_000;
  const channels = 1;
  const bytesPerSample = 2;
  const sampleCount = Math.max(1, Math.round(input.durationSec * sampleRate));
  const dataSize = sampleCount * channels * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
  buffer.writeUInt16LE(channels * bytesPerSample, 32);
  buffer.writeUInt16LE(bytesPerSample * 8, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}
```

- [ ] **Step 4: Verify fake TTS without unmuting render yet**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/fake-tts-provider.test.ts tests/harness/render-runtime-smoke.test.ts
git diff --check
```

Expected: fake TTS emits WAV, deterministic render smoke still passes, and local Remotion rendering remains muted until Task 6.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/assets/providers/fake-tts-provider.ts tests/backend/assets/fake-tts-provider.test.ts tests/harness/render-runtime-smoke.test.ts
git commit -m "让假口播音频可被本地渲染消费"
```

## Task 5: Expose Optional BGM And SFX Tracks From Compose

**Files:**

- Modify: `backend/src/modules/compose/compose-timeline-builder.ts`
- Modify: `backend/src/modules/render/remotion-input-builder.ts`
- Test: `tests/backend/compose/compose-timeline-builder.test.ts`
- Test: `tests/backend/render/remotion-input-builder.test.ts`

- [ ] **Step 0: Confirm schema compatibility**

Before writing tests, verify `shared/src/compose/compose-timeline.schema.ts` still defines:

```ts
export const ComposeTrackType = z.enum(["visual", "narration", "subtitle", "bgm", "sfx"]);
export const ComposeClipKind = z.enum(["video", "image_with_motion", "image_only", "audio", "subtitle"]);
```

This confirms BGM/SFX clips can use `clip_kind: "audio"` while `track_type` carries the role distinction.

- [ ] **Step 1: Write failing compose tests**

Add tests to `tests/backend/compose/compose-timeline-builder.test.ts`:

```ts
it("adds optional BGM track when a concrete bgm_audio artifact is placed", () => {
  const manifest = makeReadyManifestWithBgmAudio();
  const timeline = buildComposeTimeline(makeBuildInput(manifest));

  const bgmTrack = timeline.tracks.find((track) => track.track_type === "bgm");
  expect(bgmTrack?.clips).toMatchObject([
    {
      clip_kind: "audio",
      artifact_id: "artifact_bgm_001",
      start_sec: 0,
      duration_sec: timeline.duration_sec,
    },
  ]);
});

it("adds SFX track from concrete segment route sfx artifacts", () => {
  const manifest = makeReadyManifestWithSfxAudio();
  const timeline = buildComposeTimeline(makeBuildInput(manifest));

  const sfxTrack = timeline.tracks.find((track) => track.track_type === "sfx");
  expect(sfxTrack?.clips).toMatchObject([
    {
      clip_kind: "audio",
      artifact_id: "artifact_sfx_001",
      segment_id: "sb_001",
    },
  ]);
});
```

The helper manifests must include actual `bgm_audio` / `sfx_audio` artifacts in `manifest.artifacts`. Do not introduce a provider or library lookup.

- [ ] **Step 2: Run failing compose tests**

Run:

```bash
npx vitest run --configLoader runner tests/backend/compose/compose-timeline-builder.test.ts
```

Expected: fail because compose does not emit BGM/SFX tracks.

- [ ] **Step 3: Implement optional tracks**

Modify `backend/src/modules/compose/compose-timeline-builder.ts`:

- add `createBgmTrack()`;
- add `createSfxTrack()`;
- include these tracks after subtitle track when they contain clips;
- for global BGM, set `start_sec = 0` and `duration_sec = totalDurationSec`;
- for segment BGM, use segment timing from `segment_ids`;
- for SFX, use the segment start and artifact duration, capped to the segment duration;
- do not block when optional BGM/SFX is missing.

- [ ] **Step 4: Extend render input builder tests**

Add assertions in `tests/backend/render/remotion-input-builder.test.ts`:

```ts
expect(props.audioClips).toEqual(
  expect.arrayContaining([
    expect.objectContaining({ role: "bgm", artifactId: "artifact_bgm_001", volume: 0.3 }),
    expect.objectContaining({ role: "sfx", artifactId: "artifact_sfx_001", volume: 0.8 }),
  ]),
);
```

- [ ] **Step 5: Implement BGM/SFX prop mapping**

Modify `backend/src/modules/render/remotion-input-builder.ts`:

- map `track_type === "bgm"` to `role: "bgm"`;
- map `track_type === "sfx"` to `role: "sfx"`;
- use clip timing from `ComposeTimeline`;
- use BGM placement volume when a placement references the artifact; otherwise `0.3`;
- use SFX volume `0.8`.

- [ ] **Step 6: Verify**

Run:

```bash
npx vitest run --configLoader runner tests/backend/compose/compose-timeline-builder.test.ts tests/backend/render/remotion-input-builder.test.ts tests/backend/render/render-source-validator.test.ts
git diff --check
```

Expected: compose and renderer focused tests pass. Missing optional audio remains non-blocking in source validator.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/compose/compose-timeline-builder.ts backend/src/modules/render/remotion-input-builder.ts tests/backend/compose/compose-timeline-builder.test.ts tests/backend/render/remotion-input-builder.test.ts
git commit -m "暴露可选音效与背景音乐轨"
```

## Task 6: Render Narration And Optional Audio

**Files:**

- Create: `renderer/src/audio-rendering.ts`
- Modify: `renderer/src/TimelineVideo.tsx`
- Modify: `backend/src/modules/render/local-remotion-render-adapter.ts`
- Test: `tests/renderer/audio-rendering.test.ts`
- Test: `tests/backend/render/local-remotion-render-adapter.test.ts`

- [ ] **Step 1: Write failing audio helper tests**

Create `tests/renderer/audio-rendering.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  getAudioSequenceFrames,
  normalizeAudioVolume,
} from "../../renderer/src/audio-rendering";

describe("audio rendering helpers", () => {
  it("converts audio timing into Remotion frame offsets", () => {
    expect(getAudioSequenceFrames({
      startSec: 1.5,
      durationSec: 2,
      fps: 30,
    })).toEqual({
      from: 45,
      durationInFrames: 60,
    });
  });

  it("clamps audio volume", () => {
    expect(normalizeAudioVolume(-1)).toBe(0);
    expect(normalizeAudioVolume(0.35)).toBe(0.35);
    expect(normalizeAudioVolume(2)).toBe(1);
  });
});
```

- [ ] **Step 2: Run failing tests**

Run:

```bash
npx vitest run --configLoader runner tests/renderer/audio-rendering.test.ts
```

Expected: fail because `renderer/src/audio-rendering.ts` does not exist.

- [ ] **Step 3: Implement audio helper**

Create `renderer/src/audio-rendering.ts`:

```ts
export function getAudioSequenceFrames(input: {
  startSec: number;
  durationSec: number;
  fps: number;
}) {
  return {
    from: Math.max(0, Math.round(input.startSec * input.fps)),
    durationInFrames: Math.max(1, Math.round(input.durationSec * input.fps)),
  };
}

export function normalizeAudioVolume(volume: number) {
  return Math.min(1, Math.max(0, volume));
}
```

- [ ] **Step 4: Render audio clips in `TimelineVideo`**

Modify `renderer/src/TimelineVideo.tsx`:

- import `Audio` and `Sequence` from Remotion;
- render each `props.audioClips` entry inside a `Sequence`;
- use `getAudioSequenceFrames()` for timing;
- pass `volume={normalizeAudioVolume(clip.volume)}`;
- render narration even when no BGM/SFX exists.

- [ ] **Step 5: Unmute local Remotion render**

Only do this after Task 4 has made fake TTS emit renderable WAV files.

Modify `backend/src/modules/render/local-remotion-render-adapter.ts`:

```ts
await renderMedia({
  serveUrl,
  composition,
  inputProps,
  codec: "h264",
  outputLocation,
  overwrite: true,
  muted: false,
  logLevel: "error",
  browserExecutable,
  binariesDirectory: options.binariesDirectory ?? null,
});
```

- [ ] **Step 6: Strengthen adapter diagnostics**

Include these diagnostics from normalized props:

```ts
audio_clip_count: inputProps.audioClips.length,
visual_clip_count: inputProps.visualClips.length,
subtitle_cue_count: inputProps.subtitleCues.length,
```

- [ ] **Step 7: Verify**

Run:

```bash
npx vitest run --configLoader runner tests/renderer/audio-rendering.test.ts tests/backend/render/local-remotion-render-adapter.test.ts
npm run render:remotion:smoke
git diff --check
```

Expected: helper tests pass, local Remotion adapter test still produces MP4 with unmuted audio, and the Remotion smoke can consume fake WAV narration. If the existing adapter fixture WAV is too small for Remotion, replace it in the test with a generated valid silent WAV helper local to the test file.

- [ ] **Step 8: Commit**

```bash
git add renderer/src/audio-rendering.ts renderer/src/TimelineVideo.tsx backend/src/modules/render/local-remotion-render-adapter.ts tests/renderer/audio-rendering.test.ts tests/backend/render/local-remotion-render-adapter.test.ts
git commit -m "合成口播音频轨"
```

## Task 7: Add Local Render Quality Smoke

**Files:**

- Create: `tests/backend/render/remotion-local-quality-smoke.test.ts`
- Create: `tests/backend/render/png-smoke-helper.ts`
- Modify: `tests/backend/render/remotion-subtitle-still-smoke.test.ts`
- Test: `tests/backend/render/remotion-local-quality-smoke.test.ts`

- [ ] **Step 1: Write failing quality smoke**

Create `tests/backend/render/remotion-local-quality-smoke.test.ts`.

The test should:

- build a temporary fixture manifest with two image visual clips;
- render still frame near the first clip and near the second clip;
- assert both frames are nonblank;
- assert subtitle pixels are visible in the lower safe area;
- use a shared local PNG decoder helper extracted from the existing `remotion-subtitle-still-smoke.test.ts`;
- avoid real providers.

Core assertions:

```ts
expect(countNonBlackPixels(firstFrame)).toBeGreaterThan(500);
expect(countNonBlackPixels(secondFrame)).toBeGreaterThan(500);
expect(countBrightPixelsInBand(secondFrame, {
  yMin: Math.floor(secondFrame.height * 0.55),
  yMax: secondFrame.height - 96,
})).toBeGreaterThan(200);
```

- [ ] **Step 2: Run failing smoke**

Run:

```bash
npx vitest run --configLoader runner tests/backend/render/remotion-local-quality-smoke.test.ts
```

Expected: fail until the shared PNG helper is extracted and the smoke fixture is wired. If the visual/audio behavior from Tasks 1-6 already makes the smoke pass, record it as a regression test and continue.

- [ ] **Step 3: Share PNG test helpers without adding dependencies**

Create `tests/backend/render/png-smoke-helper.ts` and move the PNG helper functions from `tests/backend/render/remotion-subtitle-still-smoke.test.ts` into that file:

```ts
export interface DecodedPng {
  width: number;
  height: number;
  data: Uint8Array;
}

export function decodePngRgba(bytes: Uint8Array): DecodedPng;
export function countBrightPixelsInBand(
  png: DecodedPng,
  band: { yMin: number; yMax: number },
): number;
export function countNonBlackPixels(png: DecodedPng): number;
```

Both `remotion-subtitle-still-smoke.test.ts` and `remotion-local-quality-smoke.test.ts` must import from this helper. Do not add an image parsing dependency.

- [ ] **Step 4: Verify smoke**

Run:

```bash
npx vitest run --configLoader runner tests/backend/render/remotion-local-quality-smoke.test.ts tests/backend/render/remotion-subtitle-still-smoke.test.ts
git diff --check
```

Expected: both Remotion static smoke tests pass. These tests require headless Chromium.

- [ ] **Step 5: Commit**

```bash
git add tests/backend/render/remotion-local-quality-smoke.test.ts tests/backend/render/remotion-subtitle-still-smoke.test.ts
git add tests/backend/render/png-smoke-helper.ts
git commit -m "增加本地成片画面质量冒烟测试"
```

## Task 8: Runtime Smoke With Real Remotion Adapter

**Files:**

- Modify: `harness/scripts/runtime/render-runtime-smoke.ts`
- Modify: `tests/harness/render-runtime-smoke.test.ts`

- [ ] **Step 1: Write failing runtime assertions**

Extend `tests/harness/render-runtime-smoke.test.ts`:

```ts
expect(renderResponse.runtime_diagnostics).toMatchObject({
  renderer: "remotion",
  audio_clip_count: expect.any(Number),
  visual_clip_count: expect.any(Number),
  subtitle_cue_count: expect.any(Number),
});
expect(renderResponse.runtime_diagnostics.audio_clip_count).toBeGreaterThan(0);
expect(renderResponse.runtime_diagnostics.visual_clip_count).toBeGreaterThan(0);
expect(renderResponse.output_artifact.duration_sec).toBeGreaterThan(0);
```

- [ ] **Step 2: Run failing focused test**

Run:

```bash
npx vitest run --configLoader runner tests/harness/render-runtime-smoke.test.ts
```

Expected: fail until diagnostics and fake WAV changes are in place.

- [ ] **Step 3: Record richer smoke trace**

Modify `harness/scripts/runtime/render-runtime-smoke.ts` so `trace.md` records:

- adapter mode;
- render output artifact path;
- visual clip count;
- audio clip count;
- subtitle cue count;
- stale render invalidation result after compose refresh.

Keep JSON outputs under the existing smoke output directory.

- [ ] **Step 4: Verify**

Run:

```bash
npx vitest run --configLoader runner tests/harness/render-runtime-smoke.test.ts
npm run harness:render-runtime-smoke
npm run render:remotion:smoke
git diff --check
```

Expected: fake runtime smoke and Remotion runtime smoke pass. No real provider calls occur.

- [ ] **Step 5: Commit**

```bash
git add harness/scripts/runtime/render-runtime-smoke.ts tests/harness/render-runtime-smoke.test.ts
git commit -m "增强本地渲染运行时冒烟"
```

## Task 9: Formal Docs And Final Regression

**Files:**

- Modify: `docs/architecture/pipeline-io-spec.md`
- Modify: `docs/architecture/renderer-stage-design.md`
- Modify: `docs/data/field-design.md`
- Modify: `docs/data/schema-design.md`
- Modify: `docs/plans/README.md`
- Modify: `docs/records/2026-05-19-video-pipeline-follow-up-backlog.md`

- [ ] **Step 1: Update formal docs**

Document:

- normalized Remotion props are an adapter-internal contract;
- renderer consumes `video` artifacts and image + `motion_recipe` fallback;
- supported local motion recipes;
- narration is muxed by default when renderable audio exists;
- optional BGM/SFX are rendered only when concrete artifacts already exist;
- fake TTS now writes render-ready WAV for offline tests;
- Remotion quality smoke requires headless Chromium;
- renderer still never calls DashScope image-to-video.

Also fix any formal docs that still say `RenderValidationResult.stage` is `render_source_validation`; current shared schema and code use `render_local_validation`.

- [ ] **Step 2: Update backlog checkboxes**

In `docs/records/2026-05-19-video-pipeline-follow-up-backlog.md`, check only the Remotion local-quality items that are implemented by Tasks 1-8. Leave true provider/video-generation validation and BGM/SFX provider backlog unchecked.

- [ ] **Step 3: Run focused regression**

Run:

```bash
npx vitest run --configLoader runner tests/backend/render/remotion-input-builder.test.ts tests/backend/render/local-remotion-render-adapter.test.ts tests/backend/render/remotion-subtitle-still-smoke.test.ts tests/backend/render/remotion-local-quality-smoke.test.ts tests/renderer/visual-rendering.test.ts tests/renderer/motion-rendering.test.ts tests/renderer/audio-rendering.test.ts tests/harness/render-runtime-smoke.test.ts
```

Expected: all focused renderer quality tests pass.

- [ ] **Step 4: Run affected downstream tests**

Run:

```bash
npx vitest run --configLoader runner tests/backend/compose/compose-timeline-builder.test.ts tests/backend/assets/fake-tts-provider.test.ts tests/backend/render/render-source-validator.test.ts tests/backend/api/render-api.test.ts tests/backend/projects/project-snapshot.test.ts
```

Expected: affected backend tests pass.

- [ ] **Step 5: Run local Remotion smoke**

Run:

```bash
npm run render:remotion:smoke
```

Expected: writes a local MP4 through the Remotion adapter, with nonzero duration and no provider calls.

- [ ] **Step 6: Final diff checks**

Run:

```bash
git diff --check
git status --short
```

Expected:

- no whitespace errors;
- no generated smoke output staged;
- `storage/topic-candidate-library/` untouched;
- only intentional source, test, and doc files changed.

- [ ] **Step 7: Commit**

```bash
git add docs/architecture/pipeline-io-spec.md docs/architecture/renderer-stage-design.md docs/data/field-design.md docs/data/schema-design.md docs/plans/README.md docs/records/2026-05-19-video-pipeline-follow-up-backlog.md
git commit -m "同步本地成片质量文档"
```

## Acceptance Criteria

- Remotion adapter passes normalized `visualClips`, `audioClips`, `subtitleCues`, and `subtitleStyle`.
- `TimelineVideo` renders timed visual clips instead of only the first visual artifact.
- Image clips and video clips have distinct rendering paths.
- Motion recipes are deterministic and covered by pure tests.
- Crossfade occurs between adjacent visual clips.
- Narration audio is rendered unmuted when a renderable audio file exists.
- Optional BGM/SFX render only when concrete artifacts already exist.
- Fake TTS emits valid local WAV files for offline render smoke.
- Static smoke verifies nonblank visuals and visible subtitles.
- Runtime smoke verifies fake/local assets to compose to render, and stale render invalidation after compose refresh.
- No real DashScope calls are introduced.
- No new dependencies are installed.

## Known Residual Risks

- Headless Chromium is required for Remotion smoke tests.
- Pixel smoke proves visibility, not publish-grade visual quality.
- Audio mux verification relies on render diagnostics and successful Remotion export; it does not perform waveform or loudness analysis.
- Video artifact rendering is supported by renderer logic, but real DashScope image-to-video remains an explicit opt-in provider check outside this plan.
- BGM/SFX provider creation and library lifecycle remain a separate P1 backlog item.
