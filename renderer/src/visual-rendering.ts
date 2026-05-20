import type { CSSProperties } from "react";

import type { RenderVisualClipProp } from "./timeline-props";

export interface VisibleVisualLayer {
  clip: RenderVisualClipProp;
  opacity: number;
  localFrame: number;
  localSec: number;
}

export function getVisibleVisualLayers(input: {
  clips: RenderVisualClipProp[];
  frame: number;
  fps: number;
}): VisibleVisualLayer[] {
  const currentSec = input.frame / input.fps;
  const layers: VisibleVisualLayer[] = [];

  for (let index = 0; index < input.clips.length; index += 1) {
    const clip = input.clips[index]!;
    const nextClip = input.clips[index + 1];
    const startSec = clip.startSec;
    const endSec = clip.startSec + clip.durationSec;
    const fadeInSec =
      clip.transition?.type === "crossfade" ? clip.transition.durationSec : 0;
    const fadeOutSec =
      nextClip?.transition?.type === "crossfade"
        ? nextClip.transition.durationSec
        : 0;
    const fadeStartSec = Math.max(startSec - fadeInSec, 0);
    const visible = currentSec >= fadeStartSec && currentSec < endSec;
    if (!visible) {
      continue;
    }

    let opacity = 1;
    if (fadeInSec > 0 && currentSec < startSec) {
      opacity = (currentSec - fadeStartSec) / fadeInSec;
    }
    if (fadeOutSec > 0 && currentSec >= endSec - fadeOutSec) {
      opacity = Math.min(opacity, (endSec - currentSec) / fadeOutSec);
    }

    layers.push({
      clip,
      opacity: clamp(opacity, 0, 1),
      localSec: Math.max(0, currentSec - clip.startSec),
      localFrame: Math.max(
        0,
        Math.round((currentSec - clip.startSec) * input.fps),
      ),
    });
  }

  return layers.sort((left, right) => left.clip.startSec - right.clip.startSec);
}

export function makeVisualLayerStyle(input: {
  opacity: number;
  transform?: string;
}): CSSProperties {
  return {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    objectFit: "cover",
    opacity: input.opacity,
    transform: input.transform,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
