import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { bundle } from "@remotion/bundler";
import {
  getVideoMetadata,
  renderMedia,
  selectComposition,
} from "@remotion/renderer";

import {
  AssetManifest as AssetManifestSchema,
  ComposeTimeline as ComposeTimelineSchema,
} from "../../../../shared/src/index.js";
import type { ComposeTimeline, ExportArtifact } from "../../../../shared/src/index.js";
import type {
  RenderAdapter,
  RenderAdapterResult,
  RenderProbeResult,
} from "./render-adapter";
import { buildRemotionInputProps } from "./remotion-input-builder.js";

const DEFAULT_COMPOSITION_ID = "TimelineVideo";

export interface CreateLocalRemotionRenderAdapterOptions {
  entryPoint?: string;
  remotionRootDir?: string;
  compositionId?: string;
  browserExecutable?: string;
  binariesDirectory?: string | null;
}

function getRepoRootDir() {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
}

function getDefaultEntryPoint(repoRootDir: string) {
  return join(repoRootDir, "renderer", "src", "Root.tsx");
}

function findLocalBrowserExecutable(): string | undefined {
  const candidates = [
    process.env.REMOTION_BROWSER_EXECUTABLE,
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    process.env.ProgramFiles
      ? join(process.env.ProgramFiles, "Google", "Chrome", "Application", "chrome.exe")
      : null,
    process.env["ProgramFiles(x86)"]
      ? join(
          process.env["ProgramFiles(x86)"],
          "Google",
          "Chrome",
          "Application",
          "chrome.exe",
        )
      : null,
    process.env.LOCALAPPDATA
      ? join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe")
      : null,
    process.env.ProgramFiles
      ? join(process.env.ProgramFiles, "Microsoft", "Edge", "Application", "msedge.exe")
      : null,
    process.env["ProgramFiles(x86)"]
      ? join(
          process.env["ProgramFiles(x86)"],
          "Microsoft",
          "Edge",
          "Application",
          "msedge.exe",
        )
      : null,
  ].filter((value): value is string => Boolean(value));

  return candidates.find((candidate) => existsSync(candidate));
}

function makeProbe(input: {
  metadataDurationSec: number | null;
  timeline: ComposeTimeline;
  width: number;
  height: number;
  fps: number;
}): RenderProbeResult {
  return {
    duration_sec: input.metadataDurationSec ?? input.timeline.duration_sec,
    width: input.width,
    height: input.height,
    fps: input.fps,
  };
}

export function createLocalRemotionRenderAdapter(
  options: CreateLocalRemotionRenderAdapterOptions = {},
): RenderAdapter {
  const repoRootDir = options.remotionRootDir ?? getRepoRootDir();
  const entryPoint = options.entryPoint ?? getDefaultEntryPoint(repoRootDir);
  const compositionId = options.compositionId ?? DEFAULT_COMPOSITION_ID;
  const browserExecutable =
    options.browserExecutable ?? findLocalBrowserExecutable();

  return {
    async render(input): Promise<RenderAdapterResult> {
      const timeline = ComposeTimelineSchema.parse(input.composeRecord.timelineJson);
      const manifest = AssetManifestSchema.parse(
        input.assetManifestRecord.manifestJson,
      );
      const outputLocation = join(input.outputDir, "output.mp4");
      const durationInFrames = Math.max(
        1,
        Math.round(timeline.duration_sec * input.profile.fps),
      );
      const assetBaseDir = input.outputDir;
      const inputProps = await buildRemotionInputProps({
        timeline,
        manifest,
        assetBaseDir,
        width: input.profile.width,
        height: input.profile.height,
        fps: input.profile.fps,
      });

      const serveUrl = await bundle({
        entryPoint,
        rootDir: repoRootDir,
        outDir: join(input.outputDir, "remotion-bundle"),
        publicDir: null,
        enableCaching: false,
        webpackOverride: (config) => config,
      });
      const selectedComposition = await selectComposition({
        serveUrl,
        id: compositionId,
        inputProps,
        logLevel: "error",
        browserExecutable,
        binariesDirectory: options.binariesDirectory ?? null,
      });
      const composition = {
        ...selectedComposition,
        durationInFrames,
        fps: input.profile.fps,
        width: input.profile.width,
        height: input.profile.height,
      };

      await renderMedia({
        serveUrl,
        composition,
        inputProps,
        codec: "h264",
        outputLocation,
        overwrite: true,
        muted: true,
        logLevel: "error",
        browserExecutable,
        binariesDirectory: options.binariesDirectory ?? null,
      });

      const metadata = await getVideoMetadata(outputLocation, {
        logLevel: "error",
        binariesDirectory: options.binariesDirectory ?? null,
      });
      const probe = makeProbe({
        metadataDurationSec: metadata.durationInSeconds,
        timeline,
        width: metadata.width,
        height: metadata.height,
        fps: metadata.fps,
      });
      const outputArtifact: ExportArtifact = {
        artifact_id: `render_export_${input.composeRecord.id}`,
        artifact_type: "rendered_video",
        file_uri: outputLocation,
        mime_type: "video/mp4",
        duration_sec: probe.duration_sec,
        width: probe.width,
        height: probe.height,
        fps: probe.fps,
        source_compose_record_id: input.composeRecord.id,
        source_asset_manifest_record_id: input.assetManifestRecord.id,
        metadata: {
          renderer: "remotion",
          composition_id: compositionId,
        },
      };

      return {
        outputArtifact,
        probe,
        diagnostics: {
          renderer: "remotion",
          composition_id: compositionId,
          duration_in_frames: durationInFrames,
        },
      };
    },
  };
}
