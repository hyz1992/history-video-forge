import { existsSync, statSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeAssetManifestDates } from "../assets/manifest-date-normalizer.js";
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
  concurrency?: number;
  timeoutMs?: number;
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

export function resolveLocalRemotionRenderConcurrency(
  input?: number,
): number {
  return input ?? 1;
}

export function resolveLocalRemotionRenderTimeoutMs(input?: number): number {
  return input ?? 180_000;
}

export function createLocalRemotionRenderAdapter(
  options: CreateLocalRemotionRenderAdapterOptions = {},
): RenderAdapter {
  const repoRootDir = options.remotionRootDir ?? getRepoRootDir();
  const entryPoint = options.entryPoint ?? getDefaultEntryPoint(repoRootDir);
  const compositionId = options.compositionId ?? DEFAULT_COMPOSITION_ID;
  const browserExecutable =
    options.browserExecutable ?? findLocalBrowserExecutable();
  const concurrency = resolveLocalRemotionRenderConcurrency(options.concurrency);
  const timeoutInMilliseconds = resolveLocalRemotionRenderTimeoutMs(
    options.timeoutMs,
  );

  return {
    async render(input): Promise<RenderAdapterResult> {
      const timeline = ComposeTimelineSchema.parse(input.composeRecord.timelineJson);
      const manifest = AssetManifestSchema.parse(
        normalizeAssetManifestDates(
          input.assetManifestRecord.manifestJson as Record<string, unknown>,
        ),
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
        projectStorageRootDir: input.projectStorageRootDir,
        width: input.profile.width,
        height: input.profile.height,
        fps: input.profile.fps,
      });

      const bundleOutDir = await mkdtemp(
        join(tmpdir(), "story-video-forge-remotion-bundle-"),
      );
      try {
        const serveUrl = await bundle({
          entryPoint,
          rootDir: repoRootDir,
          outDir: bundleOutDir,
          publicDir: input.projectStorageRootDir ?? input.outputDir,
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
          concurrency,
          timeoutInMilliseconds,
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
          muted: false,
          logLevel: "error",
          browserExecutable,
          binariesDirectory: options.binariesDirectory ?? null,
          concurrency,
          timeoutInMilliseconds,
        });
      } finally {
        await rm(bundleOutDir, { recursive: true, force: true });
      }

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
          file_size_bytes: (() => { try { return statSync(outputLocation).size; } catch { return 0; } })(),
        },
      };

      return {
        outputArtifact,
        probe,
        diagnostics: {
          renderer: "remotion",
          composition_id: compositionId,
          duration_in_frames: durationInFrames,
          render_concurrency: concurrency,
          timeout_in_milliseconds: timeoutInMilliseconds,
          audio_clip_count: inputProps.audioClips?.length ?? 0,
          visual_clip_count: inputProps.visualClips?.length ?? 0,
          subtitle_cue_count: inputProps.subtitleCues?.length ?? 0,
        },
      };
    },
  };
}
