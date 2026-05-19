import React from "react";
import {
  AbsoluteFill,
  Img,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

import type { TimelineVideoProps } from "./timeline-props";

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

export function TimelineVideo(props: TimelineVideoProps) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const visualUri = findPrimaryVisualUri(props);
  const scale = interpolate(
    frame,
    [0, Math.max(1, durationInFrames - 1)],
    [1, 1.06],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  return (
    <AbsoluteFill style={{ backgroundColor: "black", overflow: "hidden" }}>
      {visualUri ? (
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
      {props.subtitleText ? (
        <div
          style={{
            position: "absolute",
            left: 48,
            right: 48,
            bottom: 120,
            color: "white",
            fontFamily: "Arial, sans-serif",
            fontSize: 48,
            fontWeight: 700,
            lineHeight: 1.2,
            textAlign: "center",
            textShadow: "0 3px 14px rgba(0,0,0,0.75)",
          }}
        >
          {props.subtitleText}
        </div>
      ) : null}
    </AbsoluteFill>
  );
}
