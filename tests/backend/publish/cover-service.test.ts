import { describe, expect, it } from "vitest";

import { createDbClient } from "../../../backend/src/db/client.js";
import { saveAssetManifestRecord } from "../../../backend/src/modules/assets/asset-manifest-record.repository.js";
import { createProject } from "../../../backend/src/modules/projects/project.repository.js";
import { initializeCoverFromStoryboard, buildCoverPromptContext, generateCoverPromptDraft } from "../../../backend/src/modules/publish/cover.service.js";
import { saveTopicPackage } from "../../../backend/src/modules/topic/topic-package.repository.js";

describe("cover service", () => {
  it("initializes cover from #1 storyboard image artifact", async () => {
    const db = createDbClient();
    const project = await createProject(db, { name: "Cover Test" });

    const topicPackage = await saveTopicPackage(db, {
      projectId: project.id,
      title: "晏子使楚",
      selectedAngle: "楚王连续压场",
      familyLabel: "外交",
      scopeLabel: "完整事件",
      coreConflict: "楚王当众压场",
      strongScene: "晏子顶回去",
      packagingSeed: "种子",
      canonicalQuotesJson: [],
      durationBandJson: { label: "medium" },
      narrativeTensionMapJson: { hook_claim: "hook" },
    });

    project.activeTopicPackageId = topicPackage.id;

    const sourceArtifactId = "img_sb_001";
    const manifestRecord = await saveAssetManifestRecord(db, {
      projectId: project.id,
      topicPackageId: "topic_001",
      scriptRecordId: "script_001",
      storyboardRecordId: "storyboard_001",
      assetPlanRecordId: "asset_plan_001",
      manifestJson: {
        manifest_version: "asset_manifest_v1",
        art_bible: {
          era_style: "战国宫廷",
          visual_tone: "冷色压迫",
        },
        artifacts: [
          {
            artifact_id: sourceArtifactId,
            artifact_type: "image",
            origin: "provider",
            file_uri: "memory://images/sb_001.png",
            created_at: "2026-06-17T00:00:00.000Z",
            metadata: {
              mime_type: "image/png",
              width: 1080,
              height: 1920,
            },
          },
          {
            artifact_id: "img_sb_002",
            artifact_type: "image",
            origin: "provider",
            file_uri: "memory://images/sb_002.png",
            created_at: "2026-06-17T00:00:00.000Z",
            metadata: {
              mime_type: "image/png",
              width: 1080,
              height: 1920,
            },
          },
        ],
        segment_routes: [
          {
            segment_id: "sb_001",
            primary_visual_artifact_id: sourceArtifactId,
            visual_route_type: "image_only",
            readiness: "ready",
          },
          {
            segment_id: "sb_002",
            primary_visual_artifact_id: "img_sb_002",
            visual_route_type: "image_only",
            readiness: "ready",
          },
        ],
        executions: [],
      },
      validationResultJson: { stage: "assets_local_validation", decision: "pass", errors: [], warnings: [], metrics: {} },
      executionStateJson: { activated: true },
      graphTraceSummaryJson: null,
      runtimeDiagnosticsJson: null,
    });

    project.activeTopicPackageId = topicPackage.id;
    project.activeAssetManifestRecordId = manifestRecord.id;

    const result = await initializeCoverFromStoryboard(
      db,
      project.id,
      manifestRecord.id,
    );

    expect(result.coverArtifactId).toBeTruthy();
    expect(result.coverArtifactId).not.toBe(sourceArtifactId);

    // Verify the new artifact was added to the manifest
    const updatedManifest = manifestRecord.manifestJson as Record<string, unknown>;
    const artifacts = updatedManifest.artifacts as Array<Record<string, unknown>>;
    const newArtifact = artifacts.find(
      (a) => a.artifact_id === result.coverArtifactId,
    );
    expect(newArtifact).toBeTruthy();
    expect(newArtifact?.artifact_type).toBe("image");
    expect((newArtifact?.metadata as Record<string, unknown>)?.source_artifact_id).toBe(sourceArtifactId);
  });

  it("throws when no storyboard image found", async () => {
    const db = createDbClient();
    const project = await createProject(db, { name: "No Image Test" });

    const manifestRecord = await saveAssetManifestRecord(db, {
      projectId: project.id,
      topicPackageId: "topic_001",
      scriptRecordId: "script_001",
      storyboardRecordId: "storyboard_001",
      assetPlanRecordId: "asset_plan_001",
      manifestJson: {
        manifest_version: "asset_manifest_v1",
        artifacts: [],
        segment_routes: [],
        executions: [],
      },
      validationResultJson: { stage: "assets_local_validation", decision: "pass", errors: [], warnings: [], metrics: {} },
      executionStateJson: { activated: true },
      graphTraceSummaryJson: null,
      runtimeDiagnosticsJson: null,
    });

    await expect(
      initializeCoverFromStoryboard(db, project.id, manifestRecord.id),
    ).rejects.toThrow("no_segment_routes_or_artifacts");
  });

  it("sorts segment routes by segment_id to find the first one", async () => {
    const db = createDbClient();
    const project = await createProject(db, { name: "Sort Test" });

    const targetArtifactId = "img_second";

    const manifestRecord = await saveAssetManifestRecord(db, {
      projectId: project.id,
      topicPackageId: "topic_001",
      scriptRecordId: "script_001",
      storyboardRecordId: "storyboard_001",
      assetPlanRecordId: "asset_plan_001",
      manifestJson: {
        manifest_version: "asset_manifest_v1",
        artifacts: [
          {
            artifact_id: "img_first",
            artifact_type: "image",
            origin: "provider",
            file_uri: "memory://img_first.png",
            created_at: "2026-06-17T00:00:00.000Z",
            metadata: { mime_type: "image/png", width: 1080, height: 1920 },
          },
          {
            artifact_id: targetArtifactId,
            artifact_type: "image",
            origin: "provider",
            file_uri: "memory://img_second.png",
            created_at: "2026-06-17T00:00:00.000Z",
            metadata: { mime_type: "image/png", width: 1080, height: 1920 },
          },
        ],
        segment_routes: [
          {
            segment_id: "sb_002",
            primary_visual_artifact_id: targetArtifactId,
            visual_route_type: "image_only",
            readiness: "ready",
          },
          {
            segment_id: "sb_001",
            primary_visual_artifact_id: "img_first",
            visual_route_type: "image_only",
            readiness: "ready",
          },
        ],
        executions: [],
      },
      validationResultJson: { stage: "assets_local_validation", decision: "pass", errors: [], warnings: [], metrics: {} },
      executionStateJson: { activated: true },
      graphTraceSummaryJson: null,
      runtimeDiagnosticsJson: null,
    });

    // Should pick sb_001 (first alphabetically), not sb_002
    const result = await initializeCoverFromStoryboard(
      db,
      project.id,
      manifestRecord.id,
    );

    const updatedManifest = manifestRecord.manifestJson as Record<string, unknown>;
    const artifacts = updatedManifest.artifacts as Array<Record<string, unknown>>;
    const newArtifact = artifacts.find(
      (a) => a.artifact_id === result.coverArtifactId,
    );
    const sourceId = (newArtifact?.metadata as Record<string, unknown>)?.source_artifact_id;
    expect(sourceId).toBe("img_first");
  });

  it("generates cover prompt draft via LLM (fallback when no LLM)", async () => {
    const result = await generateCoverPromptDraft({
      topicTitle: "晏子使楚",
      selectedAngle: "外交智慧",
      eraStyle: "战国宫廷",
      visualTone: "庄重",
    });

    expect(result).toBeTruthy();
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(20);
  });

  it("builds cover prompt context from upstream records", () => {
    const db = createDbClient();
    const ctx = buildCoverPromptContext(db, "nonexistent", "nonexistent");
    expect(ctx).toBeTruthy();
    expect(ctx.topicTitle).toBe("");
    expect(ctx.eraStyle).toBe("");
  });
});
