import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { ComposeTimeline as ComposeTimelineSchema } from "../../../../shared/src/index.js";
import type { ExportArtifact } from "../../../../shared/src/index.js";
import type {
  RenderAdapter,
  RenderAdapterResult,
  RenderProbeResult,
} from "./render-adapter";

function getTimelineDurationSec(timelineJson: Record<string, unknown>): number {
  const timelineResult = ComposeTimelineSchema.safeParse(timelineJson);
  if (timelineResult.success) {
    return timelineResult.data.duration_sec;
  }

  return 0;
}

export function createFakeRenderAdapter(): RenderAdapter {
  return {
    async render(input): Promise<RenderAdapterResult> {
      await mkdir(input.outputDir, { recursive: true });

      const durationSec = getTimelineDurationSec(input.composeRecord.timelineJson);
      const outputPath = join(input.outputDir, "output.mp4");
      const probe: RenderProbeResult = {
        duration_sec: durationSec,
        width: input.profile.width,
        height: input.profile.height,
        fps: input.profile.fps,
      };

      await writeFile(
        outputPath,
        [
          "fake-render-adapter",
          `project_id=${input.projectId}`,
          `compose_record_id=${input.composeRecord.id}`,
          `asset_manifest_record_id=${input.assetManifestRecord.id}`,
          `duration_sec=${durationSec}`,
          `width=${input.profile.width}`,
          `height=${input.profile.height}`,
          `fps=${input.profile.fps}`,
        ].join("\n"),
        "utf8",
      );

      let fileSizeBytes = 0;
      try { fileSizeBytes = (await stat(outputPath)).size; } catch { /* keep 0 */ }

      const outputArtifact: ExportArtifact = {
        artifact_id: `render_export_${input.composeRecord.id}`,
        artifact_type: "rendered_video",
        file_uri: outputPath,
        mime_type: "video/mp4",
        duration_sec: probe.duration_sec,
        width: probe.width,
        height: probe.height,
        fps: probe.fps,
        source_compose_record_id: input.composeRecord.id,
        source_asset_manifest_record_id: input.assetManifestRecord.id,
        metadata: { renderer: "fake", file_size_bytes: fileSizeBytes },
      };

      return {
        outputArtifact,
        probe,
        diagnostics: {
          renderer: "fake",
          project_id: input.projectId,
          output_path: outputPath,
        },
      };
    },
  };
}
