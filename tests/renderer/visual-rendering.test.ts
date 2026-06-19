import { describe, expect, it } from "vitest";

import {
  getMountedVisualLayers,
  getVisualSequenceFrames,
  getVisibleVisualLayers,
  makeVisualLayerStyle,
} from "../../renderer/src/visual-rendering";
import type { RenderVisualClipProp } from "../../renderer/src/timeline-props";

const clips: RenderVisualClipProp[] = [
  {
    clipId: "clip_a",
    artifactId: "artifact_a",
    mediaType: "image",
    src: "data:image/png;base64,a",
    startSec: 0,
    durationSec: 2,
  },
  {
    clipId: "clip_b",
    artifactId: "artifact_b",
    mediaType: "video",
    src: "file:///tmp/b.mp4",
    startSec: 2,
    durationSec: 2,
    transition: { type: "crossfade", durationSec: 0.25 },
  },
];

describe("visual rendering helpers", () => {
  it("returns the active clip for the current frame", () => {
    expect(getVisibleVisualLayers({ clips, frame: 15, fps: 30 })).toMatchObject([
      { clip: { clipId: "clip_a" }, opacity: 1 },
    ]);
    expect(getVisibleVisualLayers({ clips, frame: 75, fps: 30 })).toMatchObject([
      { clip: { clipId: "clip_b" }, opacity: 1 },
    ]);
  });

  it("returns both adjacent clips during crossfade", () => {
    const layers = getVisibleVisualLayers({ clips, frame: 59, fps: 30 });

    expect(layers.map((layer) => layer.clip.clipId)).toEqual([
      "clip_a",
      "clip_b",
    ]);
    expect(layers[0]!.opacity).toBeLessThan(1);
    expect(layers[1]!.opacity).toBeGreaterThan(0);
  });

  it("keeps visual layers full-frame and stable", () => {
    expect(makeVisualLayerStyle({ opacity: 0.5 })).toMatchObject({
      position: "absolute",
      inset: 0,
      width: "100%",
      height: "100%",
      objectFit: "cover",
      opacity: 0.5,
    });
  });

  it("keeps image layers mounted outside their visible window", () => {
    const layers = getMountedVisualLayers({ clips, frame: 75, fps: 30 });

    expect(layers.map((layer) => layer.clip.clipId)).toEqual([
      "clip_a",
      "clip_b",
    ]);
    expect(layers[0]).toMatchObject({
      clip: { clipId: "clip_a" },
      opacity: 0,
    });
    expect(layers[1]).toMatchObject({
      clip: { clipId: "clip_b" },
      opacity: 1,
    });
  });

  it("maps a visual clip to a local Remotion sequence window", () => {
    expect(
      getVisualSequenceFrames({
        startSec: 17.481967213114753,
        durationSec: 4.323497267759563,
        fps: 30,
      }),
    ).toEqual({
      from: 524,
      durationInFrames: 130,
    });
  });
});
