import { projectNarrationFrameRange } from "../../shared/src/narration/timeline-frame-projection";
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
  return getVisualLayers({ ...input, keepImageLayersMounted: false });
}

export function getMountedVisualLayers(input: {
  clips: RenderVisualClipProp[];
  frame: number;
  fps: number;
}): VisibleVisualLayer[] {
  return getVisualLayers({ ...input, keepImageLayersMounted: true });
}

function getVisualLayers(input: {
  clips: RenderVisualClipProp[];
  frame: number;
  fps: number;
  keepImageLayersMounted: boolean;
}): VisibleVisualLayer[] {
  const currentSec = input.frame / input.fps;
  const layers: VisibleVisualLayer[] = [];

  for (let index = 0; index < input.clips.length; index += 1) {
    const clip = input.clips[index]!;
    const nextClip = input.clips[index + 1];
    const frames=clip.startMs!==undefined||clip.endMs!==undefined?projectNarrationFrameRange({startMs:clip.startMs!,endMs:clip.endMs!,fps:input.fps}):null;
    const startSec = frames?frames.from/input.fps:clip.startSec;
    const endSec = frames?(frames.from+frames.durationInFrames)/input.fps:clip.startSec + clip.durationSec;
    const fadeInSec =
      clip.transition?.type === "crossfade" ? clip.transition.durationSec : 0;
    const fadeOutSec =
      nextClip?.transition?.type === "crossfade"
        ? nextClip.transition.durationSec
        : 0;
    const fadeStartSec = Math.max(startSec - fadeInSec, 0);
    const visible = currentSec >= fadeStartSec && currentSec < endSec;
    const shouldKeepMounted =
      input.keepImageLayersMounted && clip.mediaType === "image";
    if (!visible && !shouldKeepMounted) {
      continue;
    }

    let opacity = 1;
    if (!visible) {
      opacity = 0;
    } else if (fadeInSec > 0 && currentSec < startSec) {
      opacity = (currentSec - fadeStartSec) / fadeInSec;
    }
    if (visible && fadeOutSec > 0 && currentSec >= endSec - fadeOutSec) {
      opacity = Math.min(opacity, (endSec - currentSec) / fadeOutSec);
    }

    layers.push({
      clip,
      opacity: clamp(opacity, 0, 1),
      localSec: Math.max(0, currentSec - startSec),
      localFrame: Math.max(
        0,
        Math.round((currentSec - startSec) * input.fps),
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

export function getVisualSequenceFrames(input: {
  startSec: number;
  durationSec: number;
  fps: number;
  startMs?: number;
  endMs?: number;
}): { from: number; durationInFrames: number } {
  if(input.startMs!==undefined||input.endMs!==undefined)return projectNarrationFrameRange({startMs:input.startMs!,endMs:input.endMs!,fps:input.fps});
  return {
    from: Math.round(input.startSec * input.fps),
    durationInFrames: Math.max(1, Math.round(input.durationSec * input.fps)),
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
