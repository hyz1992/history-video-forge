import React, { useEffect, useMemo, useState } from "react";
import {
  AbsoluteFill,
  Audio,
  continueRender,
  delayRender,
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

import type { RenderVisualClipProp, TimelineVideoProps } from "./timeline-props";
import {
  getAudioLoopSequences,
  getAudioSequenceFrames,
  getFadedAudioVolume,
  normalizeAudioVolume,
} from "./audio-rendering";
import {
  DEFAULT_SUBTITLE_STYLE_PROP,
  getActiveSubtitleCue,
  makeSubtitleContainerStyle,
} from "./subtitle-rendering";
import { makeMotionTransform } from "./motion-rendering";
import {
  getMountedVisualLayers,
  makeVisualLayerStyle,
} from "./visual-rendering";

const REMOTION_STATIC_URI_PREFIX = "remotion-static://";

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
  const src = resolveMediaSrc(clip.src);
  if (clip.mediaType === "video") {
    return <OffthreadVideo src={src} muted />;
  }

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        backgroundImage: `url(${JSON.stringify(src)})`,
        backgroundPosition: "center",
        backgroundSize: "cover",
      }}
    >
      <img
        src={src}
        decoding="sync"
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
        }}
      />
    </div>
  );
}

function resolveMediaSrc(src: string): string {
  if (src.startsWith(REMOTION_STATIC_URI_PREFIX)) {
    return staticFile(src.slice(REMOTION_STATIC_URI_PREFIX.length));
  }

  return src;
}

function preloadImage(src: string): Promise<void> {
  return new Promise((resolve) => {
    const image = new Image();
    image.decoding = "sync";
    image.onload = () => resolve();
    image.onerror = () => resolve();
    image.src = src;

    if (image.complete && image.naturalWidth > 0) {
      resolve();
    }
  });
}

function usePreloadVisualImages(visualClips?: RenderVisualClipProp[]) {
  const [delayHandle] = useState(() =>
    delayRender("preload visual still images"),
  );
  const imageSources = useMemo(
    () =>
      Array.from(
        new Set(
          (visualClips ?? [])
            .filter((clip) => clip.mediaType === "image")
            .map((clip) => resolveMediaSrc(clip.src)),
        ),
      ),
    [visualClips],
  );
  const imageSourcesKey = imageSources.join("\n");

  useEffect(() => {
    let continued = false;
    const continueOnce = () => {
      if (!continued) {
        continued = true;
        continueRender(delayHandle);
      }
    };

    if (imageSources.length === 0) {
      continueOnce();
      return;
    }

    Promise.all(imageSources.map((src) => preloadImage(src))).then(
      continueOnce,
      continueOnce,
    );

    return continueOnce;
  }, [delayHandle, imageSourcesKey]);
}

export function TimelineVideo(props: TimelineVideoProps) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  usePreloadVisualImages(props.visualClips);
  const visualUri = findPrimaryVisualUri(props);
  const visualLayers = props.visualClips
    ? getMountedVisualLayers({
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
      {(props.audioClips ?? []).map((clip) => {
        const sequence = getAudioSequenceFrames({
          startSec: clip.startSec,
          durationSec: clip.durationSec,
          fps: props.fps,
        });
        const localSec = frame / props.fps - clip.startSec;
        const volume = getFadedAudioVolume({
          baseVolume: normalizeAudioVolume(clip.volume),
          localSec,
          durationSec: clip.durationSec,
          fadeInSec: clip.fadeInSec,
          fadeOutSec: clip.fadeOutSec,
        });
        const loopSequences = clip.loop
          ? getAudioLoopSequences({
              clipDurationSec: clip.durationSec,
              sourceDurationSec: clip.sourceDurationSec,
            })
          : [{ offsetSec: 0, durationSec: clip.durationSec }];

        return (
          <Sequence
            key={clip.clipId}
            from={sequence.from}
            durationInFrames={sequence.durationInFrames}
          >
            {loopSequences.map((loopSequence, index) => {
              const loopFrames = getAudioSequenceFrames({
                startSec: loopSequence.offsetSec,
                durationSec: loopSequence.durationSec,
                fps: props.fps,
              });

              return (
                <Sequence
                  key={`${clip.clipId}_loop_${index}`}
                  from={loopFrames.from}
                  durationInFrames={loopFrames.durationInFrames}
                >
                  <Audio src={clip.src} volume={volume} />
                </Sequence>
              );
            })}
          </Sequence>
        );
      })}
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
