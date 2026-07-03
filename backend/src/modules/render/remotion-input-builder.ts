import { readFile } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { resolveArtifactFileUri } from "../assets/artifact-file-resolver.js";
import type {
  AssetArtifact,
  AssetManifest,
  ComposeClip,
  ComposeTimeline,
} from "../../../../shared/src/index.js";
import type {
  RenderAudioClipProp,
  RenderAudioRole,
  RenderVisualClipProp,
  RenderVisualMediaType,
  TimelineVideoProps,
} from "../../../../renderer/src/timeline-props";
import {
  normalizeSubtitleStyle,
  parseSubtitleCues,
  type SubtitleCue,
} from "./subtitle-cue-reader.js";

const DEFAULT_CROSSFADE_SEC = 0.25;
const REMOTION_STATIC_URI_PREFIX = "remotion-static://";
// 字幕 cue 与 narration 真实时长差异超过该阈值时按比例缩放
const SUBTITLE_NARRATION_DRIFT_THRESHOLD_SEC = 0.1;
// 仅当字幕 timing_source 为 estimated / mixed / 缺失时缩放；forced_alignment / provider_timestamp 等视为真实对齐
const SCALABLE_SUBTITLE_TIMING_SOURCES = new Set(["estimated", "mixed"]);

/** Resolve an artifact file_uri to a local filesystem path using the shared resolver. */
function getLocalFilePath(
  fileUri: string,
  projectStorageRootDir?: string,
): string | null {
  const resolved = resolveArtifactFileUri({ fileUri, projectStorageRootDir });
  return resolved ?? null;
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

function getAudioMimeType(filePath: string): string {
  const normalized = filePath.toLowerCase();
  if (normalized.endsWith(".mp3")) {
    return "audio/mpeg";
  }
  if (normalized.endsWith(".flac")) {
    return "audio/flac";
  }
  if (normalized.endsWith(".aac")) {
    return "audio/aac";
  }
  if (normalized.endsWith(".m4a")) {
    return "audio/mp4";
  }

  return "audio/wav";
}

function isAudioArtifact(artifact: AssetArtifact): boolean {
  return (
    artifact.artifact_type === "tts_chunk_audio" ||
    artifact.artifact_type === "tts_merged_audio" ||
    artifact.artifact_type === "sfx_audio" ||
    artifact.artifact_type === "bgm_audio"
  );
}

function toRemotionStaticUri(input: {
  filePath: string;
  staticRootDir: string;
}): string | null {
  const relativePath = relative(input.staticRootDir, input.filePath);
  if (
    !relativePath ||
    relativePath.startsWith("..") ||
    isAbsolute(relativePath)
  ) {
    return null;
  }

  return `${REMOTION_STATIC_URI_PREFIX}${relativePath.replace(/\\/g, "/")}`;
}

async function toBrowserFileUri(input: {
  artifact: AssetArtifact;
  assetBaseDir: string;
  projectStorageRootDir?: string;
}): Promise<string> {
  const { artifact, assetBaseDir, projectStorageRootDir } = input;
  if (artifact.artifact_type === "image" || artifact.artifact_type === "video") {
    const localFilePath = getLocalFilePath(artifact.file_uri, projectStorageRootDir);
    if (!localFilePath) {
      // fallback to assetBaseDir resolution for backward compat
      const fallback = resolveArtifactFileUri({ fileUri: artifact.file_uri, projectStorageRootDir: assetBaseDir });
      if (fallback) {
        const staticUri = toRemotionStaticUri({
          filePath: fallback,
          staticRootDir: assetBaseDir,
        });
        if (staticUri) return staticUri;
        if (artifact.artifact_type === "video") {
          return pathToFileURL(fallback).href;
        }
        const imageBytes = await readFile(fallback);
        return `data:${getImageMimeType(fallback)};base64,${imageBytes.toString("base64")}`;
      }
    } else {
      const staticUri = toRemotionStaticUri({
        filePath: localFilePath,
        staticRootDir: projectStorageRootDir ?? assetBaseDir,
      });
      if (staticUri) return staticUri;
      if (artifact.artifact_type === "video") {
        return pathToFileURL(localFilePath).href;
      }
      const imageBytes = await readFile(localFilePath);
      return `data:${getImageMimeType(localFilePath)};base64,${imageBytes.toString("base64")}`;
    }
  }
  if (isAudioArtifact(artifact)) {
    const localFilePath = getLocalFilePath(artifact.file_uri, projectStorageRootDir);
    if (!localFilePath) {
      const fallback = resolveArtifactFileUri({ fileUri: artifact.file_uri, projectStorageRootDir: assetBaseDir });
      if (fallback) {
        const audioBytes = await readFile(fallback);
        return `data:${getAudioMimeType(fallback)};base64,${audioBytes.toString("base64")}`;
      }
    } else {
      const audioBytes = await readFile(localFilePath);
      return `data:${getAudioMimeType(localFilePath)};base64,${audioBytes.toString("base64")}`;
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

  // Use shared resolver; fallback to assetBaseDir for backward compat
  const resolved = resolveArtifactFileUri({ fileUri, projectStorageRootDir });
  if (resolved) return pathToFileURL(resolved).href;
  return pathToFileURL(join(assetBaseDir, fileUri)).href;
}

function indexArtifacts(manifest: AssetManifest): Map<string, AssetArtifact> {
  return new Map(
    manifest.artifacts.map((artifact) => [artifact.artifact_id, artifact]),
  );
}

function getSubtitleArtifact(input: {
  timeline: ComposeTimeline;
  artifactsById: Map<string, AssetArtifact>;
}): AssetArtifact | null {
  const subtitleTrack = input.timeline.tracks.find(
    (track) => track.track_type === "subtitle",
  );
  const subtitleClip = subtitleTrack?.clips[0];
  if (!subtitleClip) {
    return null;
  }

  return input.artifactsById.get(subtitleClip.artifact_id) ?? null;
}

async function readSubtitleFileContent(input: {
  artifact: AssetArtifact;
  projectStorageRootDir?: string;
}): Promise<string | undefined> {
  const { artifact, projectStorageRootDir } = input;
  if (
    artifact.file_uri.startsWith("memory://") ||
    artifact.file_uri.startsWith("inline://") ||
    artifact.file_uri.startsWith("http://") ||
    artifact.file_uri.startsWith("https://")
  ) {
    return undefined;
  }

  const filePath = resolveArtifactFileUri({
    fileUri: artifact.file_uri,
    projectStorageRootDir,
  });
  if (!filePath) return undefined;

  try {
    return await readFile(filePath, "utf8");
  } catch {
    return undefined;
  }
}

function visualMediaTypeForClip(
  clip: ComposeClip,
): RenderVisualMediaType | null {
  if (clip.clip_kind === "video") {
    return "video";
  }
  if (
    clip.clip_kind === "image_only" ||
    clip.clip_kind === "image_with_motion"
  ) {
    return "image";
  }

  return null;
}

function audioRoleForTrack(trackType: string): RenderAudioRole | null {
  if (trackType === "narration" || trackType === "bgm" || trackType === "sfx") {
    return trackType;
  }

  return null;
}

function volumeForAudioClip(input: {
  manifest: AssetManifest;
  role: RenderAudioRole;
  artifactId: string;
}): number {
  if (input.role === "bgm") {
    const placement = input.manifest.audio_summary.bgm_placements.find(
      (item) => item.artifact_id === input.artifactId,
    );
    return placement?.volume ?? 0.3;
  }
  if (input.role === "sfx") {
    return 0.8;
  }

  return 1;
}

function bgmRenderSettings(input: {
  manifest: AssetManifest;
  artifact: AssetArtifact;
  artifactId: string;
}): Pick<
  RenderAudioClipProp,
  "fadeInSec" | "fadeOutSec" | "loop" | "sourceDurationSec"
> {
  const placement = input.manifest.audio_summary.bgm_placements.find(
    (item) => item.artifact_id === input.artifactId,
  );
  if (!placement || input.artifact.artifact_type !== "bgm_audio") {
    return {};
  }

  return {
    fadeInSec: placement.fade_in_sec,
    fadeOutSec: placement.fade_out_sec,
    loop: input.artifact.metadata.loopable,
    sourceDurationSec: input.artifact.metadata.duration_sec,
  };
}

async function buildVisualClips(input: {
  manifest: AssetManifest;
  timeline: ComposeTimeline;
  artifactsById: Map<string, AssetArtifact>;
  assetBaseDir: string;
  projectStorageRootDir?: string;
}): Promise<RenderVisualClipProp[]> {
  const visualTrack = input.timeline.tracks.find(
    (track) => track.track_type === "visual",
  );
  const clips = visualTrack?.clips ?? [];
  const routeBySegment = new Map(
    input.manifest.segment_routes.map((route) => [route.segment_id, route]),
  );
  const visualClips = await Promise.all(
    clips.map(async (clip, index): Promise<RenderVisualClipProp[]> => {
      const artifact = input.artifactsById.get(clip.artifact_id);
      const mediaType = visualMediaTypeForClip(clip);
      if (!artifact || !mediaType) {
        return [];
      }

      const motionArtifact = clip.motion_artifact_id
        ? input.artifactsById.get(clip.motion_artifact_id)
        : null;
      const motion =
        motionArtifact?.artifact_type === "motion_recipe"
          ? {
              recipeType: motionArtifact.metadata.recipe_type,
              parameters: motionArtifact.metadata.parameters,
            }
          : undefined;

      const renderClip: RenderVisualClipProp = {
        clipId: clip.clip_id,
        artifactId: clip.artifact_id,
        mediaType,
        src: await toBrowserFileUri({
          artifact,
          assetBaseDir: input.assetBaseDir,
          projectStorageRootDir: input.projectStorageRootDir,
        }),
        startSec: clip.start_sec,
        durationSec: clip.duration_sec,
        ...(motion ? { motion } : {}),
        ...(index > 0 && mediaType === "video"
          ? {
              transition: {
                type: "crossfade" as const,
                durationSec: DEFAULT_CROSSFADE_SEC,
              },
            }
          : {}),
      };

      if (mediaType !== "video" || artifact.artifact_type !== "video") {
        return [renderClip];
      }

      const sourceDurationSec = Math.min(
        artifact.metadata.duration_sec,
        clip.duration_sec,
      );
      const remainingDurationSec = clip.duration_sec - sourceDurationSec;
      const route =
        typeof clip.segment_id === "string"
          ? routeBySegment.get(clip.segment_id)
          : undefined;
      const fallbackArtifactId = route?.fallback_visual_artifact_id;
      const fallbackArtifact = fallbackArtifactId
        ? input.artifactsById.get(fallbackArtifactId)
        : undefined;
      if (
        remainingDurationSec <= 0.001 ||
        !fallbackArtifactId ||
        fallbackArtifact?.artifact_type !== "image"
      ) {
        return [renderClip];
      }

      renderClip.durationSec = sourceDurationSec;
      return [
        renderClip,
        {
          clipId: `${clip.clip_id}_fallback_still`,
          artifactId: fallbackArtifactId,
          mediaType: "image",
          src: await toBrowserFileUri({
            artifact: fallbackArtifact,
            assetBaseDir: input.assetBaseDir,
            projectStorageRootDir: input.projectStorageRootDir,
          }),
          startSec: clip.start_sec + sourceDurationSec,
          durationSec: remainingDurationSec,
        },
      ];
    }),
  );

  return visualClips
    .flat()
    .sort((left, right) => left.startSec - right.startSec);
}

async function buildAudioClips(input: {
  manifest: AssetManifest;
  timeline: ComposeTimeline;
  artifactsById: Map<string, AssetArtifact>;
  assetBaseDir: string;
  projectStorageRootDir?: string;
}): Promise<RenderAudioClipProp[]> {
  const audioTracks = input.timeline.tracks.filter((track) =>
    ["narration", "bgm", "sfx"].includes(track.track_type),
  );
  const audioClips = await Promise.all(
    audioTracks.flatMap((track) => {
      const role = audioRoleForTrack(track.track_type);
      if (!role) {
        return [];
      }

      return track.clips.map(
        async (clip): Promise<RenderAudioClipProp | null> => {
          const artifact = input.artifactsById.get(clip.artifact_id);
          if (!artifact) {
            return null;
          }

          return {
            clipId: clip.clip_id,
            artifactId: clip.artifact_id,
            role,
            src: await toBrowserFileUri({
              artifact,
              assetBaseDir: input.assetBaseDir,
              projectStorageRootDir: input.projectStorageRootDir,
            }),
            startSec: clip.start_sec,
            durationSec: clip.duration_sec,
            volume: volumeForAudioClip({
              manifest: input.manifest,
              role,
              artifactId: clip.artifact_id,
            }),
            ...(role === "bgm"
              ? bgmRenderSettings({
                  manifest: input.manifest,
                  artifact,
                  artifactId: clip.artifact_id,
                })
              : {}),
          };
        },
      );
    }),
  );

  return audioClips
    .filter((clip): clip is RenderAudioClipProp => clip !== null)
    .sort((left, right) => left.startSec - right.startSec);
}

function getNarrationDurationSec(timeline: ComposeTimeline): number | null {
  const narrationTrack = timeline.tracks.find(
    (track) => track.track_type === "narration",
  );
  const firstClip = narrationTrack?.clips[0];
  if (!firstClip) return null;
  return firstClip.duration_sec;
}

function readSubtitleTimingSource(
  artifact: AssetArtifact | null,
): string | undefined {
  if (!artifact || artifact.artifact_type !== "subtitle_track") {
    return undefined;
  }
  const metadata = artifact.metadata as { timing_source?: unknown };
  return typeof metadata.timing_source === "string"
    ? metadata.timing_source
    : undefined;
}

function shouldScaleSubtitleCues(
  timingSource: string | undefined,
): boolean {
  // 缺失或显式声明为 estimated / mixed 时才缩放
  if (timingSource === undefined) return true;
  return SCALABLE_SUBTITLE_TIMING_SOURCES.has(timingSource);
}

function normalizeSubtitleCuesToNarration(input: {
  cues: SubtitleCue[];
  narrationDurationSec: number | null;
  timingSource: string | undefined;
}): SubtitleCue[] {
  const { cues, narrationDurationSec, timingSource } = input;
  if (cues.length === 0) return cues;
  if (narrationDurationSec === null || narrationDurationSec <= 0) return cues;
  if (!shouldScaleSubtitleCues(timingSource)) return cues;

  const lastEndSec = cues[cues.length - 1]!.end_sec;
  if (lastEndSec <= 0) return cues;

  const driftSec = Math.abs(lastEndSec - narrationDurationSec);
  if (driftSec <= SUBTITLE_NARRATION_DRIFT_THRESHOLD_SEC) {
    return cues;
  }

  const scale = narrationDurationSec / lastEndSec;
  return cues.map((cue) => ({
    start_sec: cue.start_sec * scale,
    end_sec: cue.end_sec * scale,
    text: cue.text,
  }));
}

export async function buildRemotionInputProps(input: {
  timeline: ComposeTimeline;
  manifest: AssetManifest;
  assetBaseDir: string;
  projectStorageRootDir?: string;
  width: number;
  height: number;
  fps: number;
}): Promise<TimelineVideoProps> {
  const artifactsById = indexArtifacts(input.manifest);
  const subtitleArtifact = getSubtitleArtifact({
    timeline: input.timeline,
    artifactsById,
  });
  const subtitleContent = subtitleArtifact
    ? await readSubtitleFileContent({
        artifact: subtitleArtifact,
        projectStorageRootDir: input.projectStorageRootDir,
      })
    : undefined;
  const rawSubtitleCues = subtitleContent
    ? parseSubtitleCues({
        format: String(subtitleArtifact?.metadata.format ?? "srt"),
        content: subtitleContent,
      })
    : [];
  const subtitleCues = normalizeSubtitleCuesToNarration({
    cues: rawSubtitleCues,
    narrationDurationSec: getNarrationDurationSec(input.timeline),
    timingSource: readSubtitleTimingSource(subtitleArtifact),
  });

  return {
    timeline: input.timeline,
    assetManifest: input.manifest,
    assetBaseDir: input.assetBaseDir,
    width: input.width,
    height: input.height,
    fps: input.fps,
    subtitleCues,
    subtitleStyle: normalizeSubtitleStyle(
      subtitleArtifact?.metadata.subtitle_style,
    ),
    visualClips: await buildVisualClips({
      manifest: input.manifest,
      timeline: input.timeline,
      artifactsById,
      assetBaseDir: input.assetBaseDir,
      projectStorageRootDir: input.projectStorageRootDir,
    }),
    audioClips: await buildAudioClips({
      manifest: input.manifest,
      timeline: input.timeline,
      artifactsById,
      assetBaseDir: input.assetBaseDir,
      projectStorageRootDir: input.projectStorageRootDir,
    }),
  };
}
