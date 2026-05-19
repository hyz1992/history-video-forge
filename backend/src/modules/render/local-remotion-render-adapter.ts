import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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
import type {
  AssetArtifact,
  AssetManifest,
  ComposeTimeline,
  ExportArtifact,
} from "../../../../shared/src/index.js";
import type {
  RenderAdapter,
  RenderAdapterResult,
  RenderProbeResult,
} from "./render-adapter";

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

function getLocalFilePath(fileUri: string, assetBaseDir: string): string | null {
  if (fileUri.startsWith("file://")) {
    return fileURLToPath(fileUri);
  }
  if (
    fileUri.startsWith("http://") ||
    fileUri.startsWith("https://") ||
    fileUri.startsWith("data:") ||
    fileUri.includes("://")
  ) {
    return null;
  }

  return isAbsolute(fileUri) ? fileUri : join(assetBaseDir, fileUri);
}

function getImageMimeType(filePath: string): string {
  const normalized = filePath.toLowerCase();
  if (normalized.endsWith(".jpg") || normalized.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (normalized.endsWith(".webp")) {
    return "image/webp";
  }

  return "image/png";
}

async function toBrowserFileUri(input: {
  artifact: AssetArtifact;
  assetBaseDir: string;
}): Promise<string> {
  const { artifact, assetBaseDir } = input;
  if (artifact.artifact_type === "image") {
    const localFilePath = getLocalFilePath(artifact.file_uri, assetBaseDir);
    if (localFilePath) {
      const imageBytes = await readFile(localFilePath);
      return `data:${getImageMimeType(localFilePath)};base64,${imageBytes.toString(
        "base64",
      )}`;
    }
  }

  const fileUri = artifact.file_uri;
  if (
    fileUri.startsWith("file://") ||
    fileUri.startsWith("http://") ||
    fileUri.startsWith("https://") ||
    fileUri.startsWith("data:")
  ) {
    return fileUri;
  }

  const filePath = isAbsolute(fileUri) ? fileUri : join(assetBaseDir, fileUri);
  return pathToFileURL(filePath).href;
}

async function toBrowserManifest(input: {
  manifest: AssetManifest;
  assetBaseDir: string;
}): Promise<AssetManifest> {
  return {
    ...input.manifest,
    artifacts: (await Promise.all(
      input.manifest.artifacts.map(async (artifact) => ({
        ...artifact,
        file_uri: await toBrowserFileUri({
          artifact,
          assetBaseDir: input.assetBaseDir,
        }),
      })),
    )) as AssetArtifact[],
  };
}

function indexArtifacts(manifest: AssetManifest): Map<string, AssetArtifact> {
  return new Map(
    manifest.artifacts.map((artifact) => [artifact.artifact_id, artifact]),
  );
}

function getSubtitleArtifact(input: {
  timeline: ComposeTimeline;
  manifest: AssetManifest;
}): AssetArtifact | null {
  const subtitleTrack = input.timeline.tracks.find(
    (track) => track.track_type === "subtitle",
  );
  const subtitleClip = subtitleTrack?.clips[0];
  if (!subtitleClip) {
    return null;
  }

  return indexArtifacts(input.manifest).get(subtitleClip.artifact_id) ?? null;
}

function stripSrtTiming(content: string): string {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^\d+$/.test(line))
    .filter((line) => !line.includes("-->"));

  return lines.join(" ");
}

async function readSubtitleText(input: {
  timeline: ComposeTimeline;
  manifest: AssetManifest;
}): Promise<string | undefined> {
  const subtitleArtifact = getSubtitleArtifact(input);
  if (!subtitleArtifact) {
    return undefined;
  }
  if (
    subtitleArtifact.file_uri.startsWith("memory://") ||
    subtitleArtifact.file_uri.startsWith("inline://") ||
    subtitleArtifact.file_uri.startsWith("http://") ||
    subtitleArtifact.file_uri.startsWith("https://")
  ) {
    return undefined;
  }

  const filePath = subtitleArtifact.file_uri.startsWith("file://")
    ? fileURLToPath(subtitleArtifact.file_uri)
    : subtitleArtifact.file_uri;

  try {
    return stripSrtTiming(await readFile(filePath, "utf8"));
  } catch {
    return undefined;
  }
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
      const inputProps = {
        timeline,
        assetManifest: await toBrowserManifest({ manifest, assetBaseDir }),
        assetBaseDir,
        width: input.profile.width,
        height: input.profile.height,
        fps: input.profile.fps,
        subtitleText: await readSubtitleText({ timeline, manifest }),
      };

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
