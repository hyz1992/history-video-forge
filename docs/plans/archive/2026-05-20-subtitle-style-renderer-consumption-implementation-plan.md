# Subtitle Style and Renderer Consumption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a shared subtitle style contract and make local Remotion render styled, timed subtitle cues from subtitle artifacts.

**Architecture:** Keep style metadata on `subtitle_track.metadata.subtitle_style` and keep `ComposeTimeline` unchanged for the first implementation. The renderer adapter reads subtitle artifacts from the manifest, parses SRT/VTT into cues, normalizes style with the shared `DEFAULT_SUBTITLE_STYLE` fallback, and passes cue/style props to `TimelineVideo`.

**Tech Stack:** TypeScript, Zod shared schemas, Vitest, existing local Remotion adapter, Remotion `renderStill`, Node built-ins only, no new dependencies.

---

## Session Rules

- Read `AGENTS.md` before execution.
- Read `docs/plans/2026-05-20-subtitle-style-renderer-consumption-design.md`.
- Follow TDD: write focused failing tests first, verify red, implement minimal code, verify green, commit in Chinese.
- Do not run real DashScope.
- Do not touch `storage/topic-candidate-library/`.
- Do not install dependencies.
- Do not change topic/script/storyboard/asset planning semantic generation.
- Do not implement frontend preview UI, publishing flow, manual review, karaoke captions, or forced alignment.

## File Map

- Modify `shared/src/assets/asset-manifest.schema.ts`: add `SubtitleStyle` schema, shared `DEFAULT_SUBTITLE_STYLE`, and optional `subtitle_style` metadata.
- Modify `shared/src/index.ts`: export `SubtitleStyle` and `DEFAULT_SUBTITLE_STYLE`.
- Modify `tests/backend/assets/assets-manifest-builder.test.ts` or `tests/shared/schema-contracts.test.ts`: shared schema tests.
- Modify `backend/src/modules/assets/providers/local-subtitle-provider.ts`: write the shared default subtitle style.
- Modify `tests/backend/assets/local-subtitle-provider.test.ts`: assert default style metadata.
- Create `backend/src/modules/render/subtitle-cue-reader.ts`: parse SRT/VTT and extract style.
- Create `tests/backend/render/subtitle-cue-reader.test.ts`: parser and style fallback tests.
- Modify `backend/src/modules/render/local-remotion-render-adapter.ts`: pass `subtitleCues` and `subtitleStyle` to Remotion props.
- Modify `tests/backend/render/local-remotion-render-adapter.test.ts`: inspect adapter props through a unit seam and keep render smoke.
- Modify `renderer/src/timeline-props.ts`: replace primary subtitle prop with cues/style while keeping `subtitleText` compatibility.
- Create `renderer/src/subtitle-rendering.ts`: active cue selection and CSS style normalization helpers.
- Create `tests/renderer/subtitle-rendering.test.ts`: helper tests.
- Modify `renderer/src/TimelineVideo.tsx`: render active cue with normalized style.
- Create `tests/backend/render/remotion-subtitle-still-smoke.test.ts`: local still-frame visibility smoke using `renderStill` and a Node-only PNG scan helper.
- Modify docs after code: `docs/data/field-design.md`, `docs/data/schema-design.md`, `docs/architecture/pipeline-io-spec.md`, `docs/plans/README.md`, and backlog.

## Task 1: Shared Subtitle Style Contract

**Files:**
- Modify: `shared/src/assets/asset-manifest.schema.ts`
- Modify: `shared/src/index.ts`
- Test: `tests/backend/assets/assets-manifest-builder.test.ts`

- [ ] **Step 1: Write the failing schema test**

Add a focused test near the existing `AssetArtifact timing metadata schema` tests:

```ts
it("accepts subtitle style metadata on subtitle artifacts", () => {
  expect(() =>
    AssetArtifact.parse({
      artifact_id: "artifact_subtitle_srt_001",
      artifact_type: "subtitle_track",
      origin: "provider",
      file_uri: "memory://subtitle.srt",
      created_at: "2026-05-20T00:00:00.000Z",
      metadata: {
        format: "srt",
        source_tts_artifact_id: "artifact_tts_merged",
        source_tts_chunk_artifact_ids: ["artifact_tts_chunk_001"],
        caption_count: 1,
        duration_sec: 3.2,
        timing_source: "audio_probe",
        subtitle_style: {
          style_id: "subtitle_style_default_vertical",
          font_family: "Arial, sans-serif",
          font_size_px: 48,
          font_weight: 700,
          line_height: 1.2,
          max_lines: 2,
          text_color: "#ffffff",
          stroke_color: "#000000",
          stroke_width_px: 3,
          shadow: "0 3px 14px rgba(0,0,0,0.75)",
          background_color: "#000000",
          background_opacity: 0,
          position: "bottom",
          horizontal_margin_px: 48,
          bottom_margin_px: 120,
          top_margin_px: 120,
          safe_area_top_px: 96,
          safe_area_bottom_px: 96,
          max_width_pct: 0.9,
          text_align: "center",
        },
      },
    }),
  ).not.toThrow();
});
```

- [ ] **Step 2: Run the focused test and verify red**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/assets-manifest-builder.test.ts
```

Expected: fail because `subtitle_style` is not formalized.

- [ ] **Step 3: Extend shared schema**

In `shared/src/assets/asset-manifest.schema.ts`, add and export:

```ts
export const SubtitleStyle = z
  .object({
    style_id: z.string().min(1),
    font_family: z.string().min(1),
    font_size_px: z.number().int().min(18).max(96),
    font_weight: z.number().int().min(100).max(900),
    line_height: z.number().min(1).max(2),
    max_lines: z.number().int().min(1).max(4),
    text_color: z.string().min(1),
    stroke_color: z.string().min(1),
    stroke_width_px: z.number().min(0).max(12),
    shadow: z.string().min(1),
    background_color: z.string().min(1),
    background_opacity: z.number().min(0).max(1),
    position: z.enum(["bottom", "middle", "top"]),
    horizontal_margin_px: z.number().int().min(0).max(240),
    bottom_margin_px: z.number().int().min(0).max(360),
    top_margin_px: z.number().int().min(0).max(360),
    safe_area_top_px: z.number().int().min(0).max(360),
    safe_area_bottom_px: z.number().int().min(0).max(360),
    max_width_pct: z.number().min(0.4).max(1),
    text_align: z.enum(["left", "center", "right"]),
  })
  .strict();
```

Add `subtitle_style: SubtitleStyle.optional()` to `SubtitleTrackMetadata`.

Define and export a single default style source beside the schema:

```ts
export const DEFAULT_SUBTITLE_STYLE = {
  style_id: "subtitle_style_default_vertical",
  font_family: "Arial, sans-serif",
  font_size_px: 48,
  font_weight: 700,
  line_height: 1.2,
  max_lines: 2,
  text_color: "#ffffff",
  stroke_color: "#000000",
  stroke_width_px: 3,
  shadow: "0 3px 14px rgba(0,0,0,0.75)",
  background_color: "#000000",
  background_opacity: 0,
  position: "bottom",
  horizontal_margin_px: 48,
  bottom_margin_px: 120,
  top_margin_px: 120,
  safe_area_top_px: 96,
  safe_area_bottom_px: 96,
  max_width_pct: 0.9,
  text_align: "center",
} satisfies z.infer<typeof SubtitleStyle>;
```

The default values target short vertical-video captions: two centered lines, strong stroke/shadow contrast, and a lower safe-area margin that avoids common platform UI overlays.

In `shared/src/index.ts`, export `SubtitleStyle` and `DEFAULT_SUBTITLE_STYLE`.

- [ ] **Step 4: Run tests and verify green**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/assets-manifest-builder.test.ts tests/shared/schema-contracts.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add shared/src/assets/asset-manifest.schema.ts shared/src/index.ts tests/backend/assets/assets-manifest-builder.test.ts
git commit -m "扩展字幕样式元数据"
```

## Task 2: Local Subtitle Provider Default Style

**Files:**
- Modify: `backend/src/modules/assets/providers/local-subtitle-provider.ts`
- Test: `tests/backend/assets/local-subtitle-provider.test.ts`

- [ ] **Step 1: Write the failing provider test**

Extend `records subtitle timing metadata from source TTS chunks`:

```ts
expect(srtArtifact?.metadata).toMatchObject({
  subtitle_style: {
    style_id: "subtitle_style_default_vertical",
    position: "bottom",
    text_align: "center",
    max_lines: 2,
  },
});
```

Also assert the VTT artifact receives the same `subtitle_style`.

- [ ] **Step 2: Run the focused test and verify red**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/local-subtitle-provider.test.ts
```

Expected: fail because local subtitle provider does not write `subtitle_style`.

- [ ] **Step 3: Add default style metadata**

In `local-subtitle-provider.ts`, import `DEFAULT_SUBTITLE_STYLE` from the shared schema barrel and add `subtitle_style: DEFAULT_SUBTITLE_STYLE` to both SRT and VTT artifact metadata. Do not define a second local default style object.

- [ ] **Step 4: Run tests and verify green**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/local-subtitle-provider.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/assets/providers/local-subtitle-provider.ts tests/backend/assets/local-subtitle-provider.test.ts
git commit -m "写入默认字幕样式"
```

## Task 3: Subtitle Cue Reader

**Files:**
- Create: `backend/src/modules/render/subtitle-cue-reader.ts`
- Create: `tests/backend/render/subtitle-cue-reader.test.ts`

- [ ] **Step 1: Write failing parser tests**

Create tests:

```ts
import { describe, expect, it } from "vitest";

import {
  parseSubtitleCues,
  normalizeSubtitleStyle,
} from "../../../backend/src/modules/render/subtitle-cue-reader.js";

describe("subtitle cue reader", () => {
  it("parses SRT cues", () => {
    expect(parseSubtitleCues({
      format: "srt",
      content: "1\n00:00:00,000 --> 00:00:01,500\n第一句\n\n2\n00:00:01,500 --> 00:00:03,000\n第二句\n",
    })).toEqual([
      { start_sec: 0, end_sec: 1.5, text: "第一句" },
      { start_sec: 1.5, end_sec: 3, text: "第二句" },
    ]);
  });

  it("parses VTT cues", () => {
    expect(parseSubtitleCues({
      format: "vtt",
      content: "WEBVTT - Generated by local subtitles\n\n1\n00:00.000 --> 00:02.000\nOpening pressure.\n",
    })).toEqual([
      { start_sec: 0, end_sec: 2, text: "Opening pressure." },
    ]);
  });

  it("normalizes missing style to default style", () => {
    expect(normalizeSubtitleStyle(undefined)).toMatchObject({
      style_id: "subtitle_style_default_vertical",
      position: "bottom",
      text_align: "center",
    });
  });
});
```

- [ ] **Step 2: Run tests and verify red**

Run:

```bash
npx vitest run --configLoader runner tests/backend/render/subtitle-cue-reader.test.ts
```

Expected: fail because the module does not exist.

- [ ] **Step 3: Implement parser and style normalizer**

Create `subtitle-cue-reader.ts` with:

```ts
import {
  DEFAULT_SUBTITLE_STYLE,
  SubtitleStyle,
} from "../../../../shared/src/index.js";
import type { z } from "zod";

export type SubtitleStyleValue = z.infer<typeof SubtitleStyle>;

export interface SubtitleCue {
  start_sec: number;
  end_sec: number;
  text: string;
}

export function normalizeSubtitleStyle(value: unknown): SubtitleStyleValue {
  return SubtitleStyle.safeParse(value).success
    ? SubtitleStyle.parse(value)
    : DEFAULT_SUBTITLE_STYLE;
}
```

Implement `parseSubtitleCues()` by splitting blocks on blank lines, ignoring numeric cue ids and lines that start with `WEBVTT`, parsing timestamp lines with optional VTT hours such as `00:01.500 --> 00:02.000`, and joining remaining text lines with `\n`.

Use a timestamp parser that accepts both `HH:MM:SS,mmm` / `HH:MM:SS.mmm` and `MM:SS.mmm`. Do not require the `WEBVTT` header to be an exact line; `WEBVTT - Generated by...` must be skipped as a header line.

- [ ] **Step 4: Run tests and verify green**

Run:

```bash
npx vitest run --configLoader runner tests/backend/render/subtitle-cue-reader.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/render/subtitle-cue-reader.ts tests/backend/render/subtitle-cue-reader.test.ts
git commit -m "新增字幕 cue 读取器"
```

## Task 4: Remotion Adapter Subtitle Props

**Files:**
- Modify: `backend/src/modules/render/local-remotion-render-adapter.ts`
- Modify: `tests/backend/render/local-remotion-render-adapter.test.ts`

- [ ] **Step 1: Write failing adapter prop test**

Add an exported helper test seam in the test after fixture creation:

```ts
import { buildRemotionInputProps } from "../../../backend/src/modules/render/local-remotion-render-adapter.js";

it("passes subtitle cues and style into Remotion input props", async () => {
  tempDir = await mkdtemp(join(tmpdir(), "local-remotion-props-"));
  const fixtureFiles = await writeFixtureFiles(tempDir);
  const props = await buildRemotionInputProps({
    timeline: makeReadyComposeTimeline(2),
    manifest: makeReadyAssetManifestRecordWithFixtureFiles({
      ...fixtureFiles,
      durationSec: 2,
    }).manifestJson as AssetManifest,
    assetBaseDir: tempDir,
    width: 540,
    height: 960,
    fps: 30,
  });

  expect(props.subtitleCues).toEqual([
    { start_sec: 0, end_sec: 2, text: "Opening pressure." },
  ]);
  expect(props.subtitleStyle).toMatchObject({
    position: "bottom",
    text_align: "center",
  });
});
```

- [ ] **Step 2: Run tests and verify red**

Run:

```bash
npx vitest run --configLoader runner tests/backend/render/local-remotion-render-adapter.test.ts
```

Expected: fail because the prop builder and cue props do not exist.

- [ ] **Step 3: Implement adapter prop helper**

In `local-remotion-render-adapter.ts`, replace `readSubtitleText()` usage with the production prop builder:

```ts
export async function buildRemotionInputProps(input: {
  timeline: ComposeTimeline;
  manifest: AssetManifest;
  assetBaseDir: string;
  width: number;
  height: number;
  fps: number;
}) {
  const subtitleArtifact = getSubtitleArtifact({
    timeline: input.timeline,
    manifest: input.manifest,
  });
  const subtitleContent = subtitleArtifact
    ? await readSubtitleFileContent(subtitleArtifact)
    : undefined;

  return {
    timeline: input.timeline,
    assetManifest: await toBrowserManifest({
      manifest: input.manifest,
      assetBaseDir: input.assetBaseDir,
    }),
    assetBaseDir: input.assetBaseDir,
    width: input.width,
    height: input.height,
    fps: input.fps,
    subtitleCues: subtitleContent
      ? parseSubtitleCues({
          format: String(subtitleArtifact?.metadata.format ?? "srt"),
          content: subtitleContent,
        })
      : [],
    subtitleStyle: normalizeSubtitleStyle(
      subtitleArtifact?.metadata.subtitle_style,
    ),
  };
}
```

Use this helper inside `render()` to build `inputProps`. This function is the single production authority for Remotion input props; do not export a `ForTest` variant.

- [ ] **Step 4: Run tests and verify green**

Run:

```bash
npx vitest run --configLoader runner tests/backend/render/local-remotion-render-adapter.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/render/local-remotion-render-adapter.ts tests/backend/render/local-remotion-render-adapter.test.ts
git commit -m "传递字幕 cue 与样式给 Remotion"
```

## Task 5: TimelineVideo Subtitle Rendering Helpers

**Files:**
- Modify: `renderer/src/timeline-props.ts`
- Create: `renderer/src/subtitle-rendering.ts`
- Create: `tests/renderer/subtitle-rendering.test.ts`
- Modify: `renderer/src/TimelineVideo.tsx`

- [ ] **Step 1: Write failing renderer helper tests**

Create:

```ts
import { describe, expect, it } from "vitest";

import {
  getActiveSubtitleCue,
  makeSubtitleContainerStyle,
} from "../../renderer/src/subtitle-rendering";

describe("subtitle rendering helpers", () => {
  it("selects the active cue by frame time", () => {
    expect(getActiveSubtitleCue({
      cues: [
        { start_sec: 0, end_sec: 1, text: "first" },
        { start_sec: 1, end_sec: 2, text: "second" },
      ],
      frame: 45,
      fps: 30,
    })?.text).toBe("second");
  });

  it("constrains bottom subtitle style inside safe areas", () => {
    const style = makeSubtitleContainerStyle({
      frameWidth: 1080,
      frameHeight: 1920,
      style: {
        style_id: "subtitle_style_default_vertical",
        font_family: "Arial, sans-serif",
        font_size_px: 48,
        font_weight: 700,
        line_height: 1.2,
        max_lines: 2,
        text_color: "#ffffff",
        stroke_color: "#000000",
        stroke_width_px: 3,
        shadow: "0 3px 14px rgba(0,0,0,0.75)",
        background_color: "#000000",
        background_opacity: 0,
        position: "bottom",
        horizontal_margin_px: 48,
        bottom_margin_px: 120,
        top_margin_px: 120,
        safe_area_top_px: 96,
        safe_area_bottom_px: 96,
        max_width_pct: 0.9,
        text_align: "center",
      },
    });

    expect(style.position).toBe("absolute");
    expect(style.bottom).toBeGreaterThanOrEqual(96);
    expect(style.maxWidth).toBe("90%");
    expect(style.WebkitLineClamp).toBe(2);
    expect(style.overflow).toBe("hidden");
  });
});
```

- [ ] **Step 2: Run tests and verify red**

Run:

```bash
npx vitest run --configLoader runner tests/renderer/subtitle-rendering.test.ts
```

Expected: fail because helper does not exist.

- [ ] **Step 3: Implement props and helpers**

Update `renderer/src/timeline-props.ts`:

```ts
export interface SubtitleCueProp {
  start_sec: number;
  end_sec: number;
  text: string;
}

export interface SubtitleStyleProp {
  style_id: string;
  font_family: string;
  font_size_px: number;
  font_weight: number;
  line_height: number;
  max_lines: number;
  text_color: string;
  stroke_color: string;
  stroke_width_px: number;
  shadow: string;
  background_color: string;
  background_opacity: number;
  position: "bottom" | "middle" | "top";
  horizontal_margin_px: number;
  bottom_margin_px: number;
  top_margin_px: number;
  safe_area_top_px: number;
  safe_area_bottom_px: number;
  max_width_pct: number;
  text_align: "left" | "center" | "right";
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
}
```

Create `subtitle-rendering.ts` with active cue selection and CSS generation. Use `React.CSSProperties` for return type and set `display: "-webkit-box"`, `WebkitLineClamp`, `WebkitBoxOrient: "vertical"`, `overflow: "hidden"`, `overflowWrap: "break-word"`, and `textShadow`.

Import or mirror the shared `DEFAULT_SUBTITLE_STYLE` through a renderer-local prop constant only if the renderer build cannot import `shared/` directly. If a renderer-local constant is required, add a test that it deep-equals the shared default to prevent drift.

- [ ] **Step 4: Render active cue in TimelineVideo**

In `TimelineVideo.tsx`, replace static `props.subtitleText` rendering with:

```tsx
const activeSubtitle = getActiveSubtitleCue({
  cues: props.subtitleCues ?? [],
  frame,
  fps: props.fps,
})?.text ?? props.subtitleText;

{activeSubtitle ? (
  <div
    data-testid="timeline-subtitle"
    style={makeSubtitleContainerStyle({
      frameWidth: props.width,
      frameHeight: props.height,
      style: props.subtitleStyle ?? DEFAULT_SUBTITLE_STYLE_PROP,
    })}
  >
    {activeSubtitle}
  </div>
) : null}
```

`subtitleText` is a compatibility fallback only. Add a comment near the prop type or render path stating it can be removed after all production callers use `subtitleCues` and one release cycle has passed without fallback usage.

- [ ] **Step 5: Run tests and verify green**

Run:

```bash
npx vitest run --configLoader runner tests/renderer/subtitle-rendering.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add renderer/src/timeline-props.ts renderer/src/subtitle-rendering.ts renderer/src/TimelineVideo.tsx tests/renderer/subtitle-rendering.test.ts
git commit -m "渲染当前字幕 cue 样式"
```

## Task 6: Remotion Still Visibility Smoke

**Files:**
- Create: `tests/backend/render/remotion-subtitle-still-smoke.test.ts`

- [ ] **Step 1: Write failing still-frame smoke**

Create a test that bundles the existing Remotion root, renders a still at frame 15, and scans lower safe-area pixels:

```ts
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import { afterEach, describe, expect, it } from "vitest";

describe("Remotion subtitle still smoke", () => {
  let tempDir: string | null = null;

  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  });

  it("renders visible subtitle pixels inside the lower safe area", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "subtitle-still-"));
    const serveUrl = await bundle({
      entryPoint: "renderer/src/Root.tsx",
      rootDir: process.cwd(),
      outDir: join(tempDir, "bundle"),
      publicDir: null,
      enableCaching: false,
      webpackOverride: (config) => config,
    });
    const inputProps = {
      timeline: {},
      assetManifest: {},
      assetBaseDir: "",
      width: 540,
      height: 960,
      fps: 30,
      subtitleCues: [{ start_sec: 0, end_sec: 2, text: "Visible subtitle" }],
      subtitleStyle: {
        style_id: "subtitle_style_default_vertical",
        font_family: "Arial, sans-serif",
        font_size_px: 48,
        font_weight: 700,
        line_height: 1.2,
        max_lines: 2,
        text_color: "#ffffff",
        stroke_color: "#000000",
        stroke_width_px: 3,
        shadow: "0 3px 14px rgba(0,0,0,0.75)",
        background_color: "#000000",
        background_opacity: 0,
        position: "bottom",
        horizontal_margin_px: 48,
        bottom_margin_px: 120,
        top_margin_px: 120,
        safe_area_top_px: 96,
        safe_area_bottom_px: 96,
        max_width_pct: 0.9,
        text_align: "center",
      },
    };
    const composition = await selectComposition({
      serveUrl,
      id: "TimelineVideo",
      inputProps,
      logLevel: "error",
    });
    const output = join(tempDir, "subtitle-frame.png");
    await renderStill({
      serveUrl,
      composition,
      inputProps,
      output,
      frame: 15,
      logLevel: "error",
    });

    const png = decodePngRgba(await readFile(output));
    expect(countBrightPixelsInBand(png, {
      yMin: Math.floor(png.height * 0.55),
      yMax: png.height - 96,
    })).toBeGreaterThan(200);
  }, 120_000);
});
```

Implement `decodePngRgba()` in the test using PNG signature validation, chunk iteration, `inflateSync`, filter types 0-4, and RGBA color type 6. Implement `countBrightPixelsInBand()` by counting pixels where `r + g + b > 600` and `a > 0`.

- [ ] **Step 2: Run still smoke and verify red or green according to current state**

This smoke requires local headless Chromium support through Remotion. If the target CI environment cannot provide Chromium, keep this test as an explicit opt-in/local verification or mark it skipped in CI configuration.

Run:

```bash
npx vitest run --configLoader runner tests/backend/render/remotion-subtitle-still-smoke.test.ts
```

Expected before Task 5 implementation: fail because `subtitleCues` are not rendered. Expected after Task 5 implementation: pass.

- [ ] **Step 3: Fix only if smoke exposes a renderer issue**

If the smoke fails after Task 5, adjust only `renderer/src/subtitle-rendering.ts` or `renderer/src/TimelineVideo.tsx`. Do not change schema or provider behavior in this task.

- [ ] **Step 4: Commit**

```bash
git add tests/backend/render/remotion-subtitle-still-smoke.test.ts renderer/src/subtitle-rendering.ts renderer/src/TimelineVideo.tsx
git commit -m "验证字幕静帧可见性"
```

Only stage renderer files if they changed during this task.

## Task 7: Docs and Final Regression

**Files:**
- Modify: `docs/data/field-design.md`
- Modify: `docs/data/schema-design.md`
- Modify: `docs/architecture/pipeline-io-spec.md`
- Modify: `docs/plans/README.md`
- Modify: `docs/records/2026-05-19-video-pipeline-follow-up-backlog.md`

- [ ] **Step 1: Update docs**

Document:

- `subtitle_track.metadata.subtitle_style`;
- default vertical subtitle style;
- renderer cue parsing and active cue rendering;
- Remotion still-frame subtitle visibility smoke;
- no frontend preview UI and no word-level alignment.

- [ ] **Step 2: Run focused regression**

Run:

```bash
npx vitest run --configLoader runner tests/backend/assets/assets-manifest-builder.test.ts tests/backend/assets/local-subtitle-provider.test.ts tests/backend/render/subtitle-cue-reader.test.ts tests/backend/render/local-remotion-render-adapter.test.ts tests/renderer/subtitle-rendering.test.ts tests/backend/render/remotion-subtitle-still-smoke.test.ts
git diff --check
git status --short
```

Expected: all tests exit 0; no generated `storage/topic-candidate-library/` files are staged.

- [ ] **Step 3: Commit**

```bash
git add docs/data/field-design.md docs/data/schema-design.md docs/architecture/pipeline-io-spec.md docs/plans/README.md docs/records/2026-05-19-video-pipeline-follow-up-backlog.md
git commit -m "同步字幕样式与渲染文档"
```

## Final Acceptance

The implementation is complete when:

- shared schema accepts `subtitle_style` and keeps legacy subtitle artifacts compatible;
- local subtitle provider writes default style metadata;
- renderer adapter passes subtitle cues and style props;
- `TimelineVideo` renders the active cue with normalized safe-area style;
- still-frame smoke proves subtitle pixels are visible in the configured band;
- default verification makes no real provider calls;
- docs and backlog are synchronized;
- `git diff --check` passes;
- every completed task has a Chinese commit.
