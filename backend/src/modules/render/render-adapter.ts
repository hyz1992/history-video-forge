import type { AssetManifestRecord, ComposeRecord } from "../../db/client";
import type { ExportArtifact } from "../../../../shared/src/index.js";

export interface RenderProfile {
  width: number;
  height: number;
  fps: number;
}

export interface RenderProbeResult {
  duration_sec: number;
  width: number;
  height: number;
  fps: number;
}

export interface RenderAdapterResult {
  outputArtifact: ExportArtifact;
  probe: RenderProbeResult;
  diagnostics: Record<string, unknown>;
}

export interface RenderAdapter {
  render(input: {
    projectId: string;
    composeRecord: ComposeRecord;
    assetManifestRecord: AssetManifestRecord;
    outputDir: string;
    profile: RenderProfile;
    projectStorageRootDir?: string;
  }): Promise<RenderAdapterResult>;
}
