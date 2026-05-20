import React from "react";
import {
  AbsoluteFill,
  Img,
  OffthreadVideo,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

import type { RenderVisualClipProp, TimelineVideoProps } from "./timeline-props";
import {
  DEFAULT_SUBTITLE_STYLE_PROP,
  getActiveSubtitleCue,
  makeSubtitleContainerStyle,
} from "./subtitle-rendering";
import { makeMotionTransform } from "./motion-rendering";
import {
  getVisibleVisualLayers,
  makeVisualLayerStyle,
} from "./visual-rendering";

type ArtifactLike = {
  artifact_id?: unknown;
  file_uri?: unknown;
};

type ClipLike = {
  artifact_id?: unknown;
  clip_kind?: unknown;
};

type TrackLike = {
  track_type?: unknown;
  clips?: unknown;
};

function getArtifacts(props: TimelineVideoProps): ArtifactLike[] {
  const manifest = props.assetManifest as { artifacts?: unknown };
  return Array.isArray(manifest.artifacts)
    ? (manifest.artifacts as ArtifactLike[])
    : [];
}

function getTracks(props: TimelineVideoProps): TrackLike[] {
  const timeline = props.timeline as { tracks?: unknown };
  return Array.isArray(timeline.tracks) ? (timeline.tracks as TrackLike[]) : [];
}

function findArtifactFileUri(props: TimelineVideoProps, artifactId: string) {
  const artifact = getArtifacts(props).find(
    (item) => item.artifact_id === artifactId,
  );
  return typeof artifact?.file_uri === "string" ? artifact.file_uri : null;
}

function findPrimaryVisualUri(props: TimelineVideoProps) {
  const visualTrack = getTracks(props).find(
    (track) => track.track_type === "visual",
  );
  const clips = Array.isArray(visualTrack?.clips)
    ? (visualTrack.clips as ClipLike[])
    : [];
  const firstVisualClip = clips.find(
    (clip) =>
      clip.clip_kind === "image_only" ||
      clip.clip_kind === "image_with_motion" ||
      clip.clip_kind === "video",
  );
  if (typeof firstVisualClip?.artifact_id !== "string") {
    return null;
  }

  return findArtifactFileUri(props, firstVisualClip.artifact_id);
}

function renderVisualClip(clip: RenderVisualClipProp) {
  if (clip.mediaType === "video") {
    return <OffthreadVideo src={clip.src} muted />;
  }

  return (
    <Img
      src={clip.src}
      style={{
        width: "100%",
        height: "100%",
        objectFit: "cover",
      }}
    />
  );
}

export function TimelineVideo(props: TimelineVideoProps) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const visualUri = findPrimaryVisualUri(props);
  const visualLayers = props.visualClips
    ? getVisibleVisualLayers({
        clips: props.visualClips,
        frame,
        fps: props.fps,
      })
    : [];
  const activeSubtitle =
    getActiveSubtitleCue({
      cues: props.subtitleCues ?? [],
      frame,
      fps: props.fps,
    })?.text ?? props.subtitleText;
  const scale = interpolate(
    frame,
    [0, Math.max(1, durationInFrames - 1)],
    [1, 1.06],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  return (
    <AbsoluteFill style={{ backgroundColor: "black", overflow: "hidden" }}>
      {props.visualClips
        ? visualLayers.map((layer) => (
            <div
              key={layer.clip.clipId}
              style={makeVisualLayerStyle({
                opacity: layer.opacity,
                transform: makeMotionTransform({
                  recipeType: layer.clip.motion?.recipeType ?? "hold",
                  progress:
                    layer.clip.durationSec > 0
                      ? layer.localSec / layer.clip.durationSec
                      : 0,
                  parameters: layer.clip.motion?.parameters ?? {},
                }),
              })}
            >
              {renderVisualClip(layer.clip)}
            </div>
          ))
        : null}
      {!props.visualClips && visualUri ? (
        <Img
          src={visualUri}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transform: `scale(${scale})`,
          }}
        />
      ) : null}
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
    </AbsoluteFill>
  );
}
