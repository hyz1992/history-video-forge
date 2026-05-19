import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createFakeRenderAdapter } from "../../../backend/src/modules/render/fake-render-adapter.js";
import type {
  AssetManifestRecord,
  ComposeRecord,
} from "../../../backend/src/db/client.js";
import type { ComposeTimeline } from "../../../shared/src/index.js";

function makeReadyComposeTimeline(): ComposeTimeline {
  return {
    timeline_version: "compose_timeline_v1",
    source_asset_manifest_record_id: "asset_manifest_001",
    source_asset_plan_record_id: "asset_plan_001",
    source_storyboard_record_id: "storyboard_001",
    source_script_record_id: "script_001",
    output_profile: {
      aspect_ratio: "9:16",
      width: 1080,
      height: 1920,
      fps: 30,
    },
    duration_sec: 12,
    tracks: [],
    segments: [],
    readiness: "ready_for_render",
    notes: [],
  };
}

function makeReadyComposeRecord(): ComposeRecord {
  return {
    id: "compose_001",
    projectId: "project_001",
    assetManifestRecordId: "asset_manifest_001",
    timelineJson: makeReadyComposeTimeline(),
    validationResultJson: {
      stage: "compose_local_validation",
      decision: "ready_for_render",
      errors: [],
      warnings: [],
      metrics: {},
    },
    executionStateJson: null,
    graphTraceSummaryJson: null,
    runtimeDiagnosticsJson: null,
    createdAt: new Date("2026-05-18T00:00:00.000Z"),
  };
}

function makeReadyAssetManifestRecord(): AssetManifestRecord {
  return {
    id: "asset_manifest_001",
    projectId: "project_001",
    topicPackageId: "topic_001",
    scriptRecordId: "script_001",
    storyboardRecordId: "storyboard_001",
    assetPlanRecordId: "asset_plan_001",
    manifestJson: {
      manifest_version: "asset_manifest_v1",
      artifacts: [],
    },
    validationResultJson: {
      stage: "assets_local_validation",
      decision: "ready_for_compose",
      errors: [],
      warnings: [],
      metrics: {},
    },
    executionStateJson: null,
    graphTraceSummaryJson: null,
    runtimeDiagnosticsJson: null,
    createdAt: new Date("2026-05-18T00:00:00.000Z"),
  };
}

describe("fake render adapter", () => {
  let tempDir: string | null = null;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { force: true, recursive: true });
      tempDir = null;
    }
  });

  it("writes a deterministic MP4-like output artifact with probe metadata", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "fake-render-adapter-"));
    const adapter = createFakeRenderAdapter();

    const result = await adapter.render({
      projectId: "project_001",
      composeRecord: makeReadyComposeRecord(),
      assetManifestRecord: makeReadyAssetManifestRecord(),
      outputDir: tempDir,
      profile: { width: 1080, height: 1920, fps: 30 },
    });

    expect(result.outputArtifact).toMatchObject({
      artifact_id: "render_export_compose_001",
      artifact_type: "rendered_video",
      mime_type: "video/mp4",
      duration_sec: 12,
      width: 1080,
      height: 1920,
      fps: 30,
      source_compose_record_id: "compose_001",
      source_asset_manifest_record_id: "asset_manifest_001",
      metadata: { renderer: "fake" },
    });
    expect(result.outputArtifact.file_uri).toContain("output.mp4");
    expect(result.probe).toEqual({
      duration_sec: 12,
      width: 1080,
      height: 1920,
      fps: 30,
    });
    expect(result.diagnostics).toMatchObject({
      renderer: "fake",
      project_id: "project_001",
    });

    await expect(stat(result.outputArtifact.file_uri)).resolves.toBeTruthy();
    await expect(readFile(result.outputArtifact.file_uri, "utf8")).resolves.toContain(
      "fake-render-adapter",
    );
  });
});
