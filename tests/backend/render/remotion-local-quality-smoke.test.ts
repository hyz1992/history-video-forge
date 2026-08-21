import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_SUBTITLE_STYLE } from "../../../shared/src/index.js";
import {
  countBrightPixelsInBand,
  countNonBlackPixelsInBand,
  decodePngRgba,
} from "../../_helpers/png-decoder";

describe("Remotion local quality smoke", () => {
  let tempDir: string | null = null;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it("renders visible local visual content and subtitle pixels", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "remotion-quality-"));
    const serveUrl = await bundle({
      entryPoint: "renderer/src/Root.tsx",
      rootDir: process.cwd(),
      outDir: join(tempDir, "bundle"),
      publicDir: null,
      enableCaching: false,
      // 与生产打包（local-remotion-render-adapter）保持一致：shared 源码内
      // 按仓库惯例用 .js 后缀导入同目录 .ts（如 creative-preset-registry →
      // ./art-style-presets.js），需 extensionAlias 才能解析到 TS 源。
      webpackOverride: (config) => ({
        ...config,
        resolve: {
          ...config.resolve,
          extensionAlias: {
            ...config.resolve?.extensionAlias,
            ".js": [".ts", ".tsx", ".js"],
          },
        },
      }),
    });
    const inputProps = {
      timeline: {},
      assetManifest: {},
      assetBaseDir: "",
      width: 540,
      height: 960,
      fps: 30,
      visualClips: [
        {
          clipId: "clip_visual_001",
          artifactId: "artifact_image_001",
          mediaType: "image",
          src: svgDataUri(),
          startSec: 0,
          durationSec: 2,
          motion: {
            recipeType: "slow_push_in",
            parameters: { distance_pct: 3 },
          },
        },
      ],
      subtitleCues: [
        { start_sec: 0, end_sec: 2, text: "Visible subtitle" },
      ],
      subtitleStyle: DEFAULT_SUBTITLE_STYLE,
    };
    const composition = await selectComposition({
      serveUrl,
      id: "TimelineVideo",
      inputProps,
      logLevel: "error",
    });
    const output = join(tempDir, "quality-frame.png");
    await renderStill({
      serveUrl,
      composition,
      inputProps,
      output,
      frame: 15,
      logLevel: "error",
    });

    const png = decodePngRgba(await readFile(output));
    expect(
      countNonBlackPixelsInBand(png, {
        yMin: 40,
        yMax: Math.floor(png.height * 0.45),
      }),
    ).toBeGreaterThan(5_000);
    expect(
      countBrightPixelsInBand(png, {
        yMin: Math.floor(png.height * 0.55),
        yMax: png.height - 96,
      }),
    ).toBeGreaterThan(200);
  }, 120_000);
});

function svgDataUri() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="540" height="960">
    <rect width="540" height="960" fill="#0f172a"/>
    <rect x="0" y="0" width="540" height="420" fill="#14b8a6"/>
    <circle cx="270" cy="210" r="110" fill="#f97316"/>
  </svg>`;

  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}
