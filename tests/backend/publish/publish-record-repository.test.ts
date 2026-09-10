import { describe, expect, it } from "vitest";

import { createDbClient } from "../../../backend/src/db/client.js";
import { createLegacyProject as createProject } from "../projects/legacy-project.fixture.js";
import {
  getPublishPackageRecordById,
  savePublishPackageRecord,
} from "../../../backend/src/modules/publish/publish-record.repository.js";

describe("publish record repository", () => {
  it("saves and retrieves a PublishPackageRecord", async () => {
    const db = createDbClient();
    const project = await createProject(db, { name: "Publish Test" });

    const record = await savePublishPackageRecord(db, {
      projectId: project.id,
      renderJobRecordId: "render_001",
      topicPackageId: "topic_001",
      scriptRecordId: "script_001",
      storyboardRecordId: "storyboard_001",
      assetManifestRecordId: "asset_manifest_001",
      packageJson: {
        package_version: "publish_package_v1",
        source_render_job_record_id: "render_001",
        source_topic_package_id: "topic_001",
        source_script_record_id: "script_001",
        source_storyboard_record_id: "storyboard_001",
        source_asset_manifest_record_id: "asset_manifest_001",
        video_export_artifact_id: "export_001",
        cover_artifact_id: null,
        cover_prompt_draft: null,
        cover_origin: "storyboard_image",
        title_candidates: [],
        selected_title: "测试标题",
        description: "测试描述",
        hashtags: ["历史"],
        platform_profile: "generic",
        readiness: "draft",
        notes: [],
      },
    });

    expect(record.id).toBeTruthy();
    expect(record.projectId).toBe(project.id);

    const retrieved = await getPublishPackageRecordById(db, record.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.packageJson).toMatchObject({
      selected_title: "测试标题",
      readiness: "draft",
    });
  });

  it("returns null for non-existent record", async () => {
    const db = createDbClient();
    const result = await getPublishPackageRecordById(db, "nonexistent");
    expect(result).toBeNull();
  });

  it("accepts custom id and dates", async () => {
    const db = createDbClient();
    const project = await createProject(db, { name: "Custom ID Test" });
    const customDate = new Date("2026-06-17T10:00:00.000Z");

    const record = await savePublishPackageRecord(db, {
      id: "custom_publish_id",
      projectId: project.id,
      renderJobRecordId: "render_001",
      topicPackageId: "topic_001",
      scriptRecordId: "script_001",
      storyboardRecordId: "storyboard_001",
      assetManifestRecordId: "asset_manifest_001",
      packageJson: { test: true },
      createdAt: customDate,
      updatedAt: customDate,
    });

    expect(record.id).toBe("custom_publish_id");
    expect(record.createdAt).toEqual(customDate);
  });
});
