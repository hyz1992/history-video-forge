import React from "react";
import { Composition, registerRoot } from "remotion";

import { TimelineVideo } from "./TimelineVideo";

export function RemotionRoot() {
  return (
    <Composition
      id="TimelineVideo"
      component={TimelineVideo}
      durationInFrames={60}
      fps={30}
      width={540}
      height={960}
      defaultProps={{
        timeline: {},
        assetManifest: {},
        assetBaseDir: "",
        width: 540,
        height: 960,
        fps: 30,
      }}
    />
  );
}

registerRoot(RemotionRoot);
