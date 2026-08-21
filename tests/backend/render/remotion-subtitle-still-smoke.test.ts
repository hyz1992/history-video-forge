import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_SUBTITLE_STYLE } from "../../../shared/src/index.js";
import {
  countBrightPixelsInBand,
  decodePngRgba,
} from "../../_helpers/png-decoder";

describe("Remotion subtitle still smoke", () => {
  let tempDir: string | null = null;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it("renders visible subtitle pixels inside the lower safe area", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "subtitle-still-"));
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
    expect(
      countBrightPixelsInBand(png, {
        yMin: Math.floor(png.height * 0.55),
        yMax: png.height - 96,
      }),
    ).toBeGreaterThan(200);
  }, 120_000);
});
