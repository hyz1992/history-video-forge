import type { DbClient, PublishPackageRecord } from "../../db/client";

export type SavePublishPackageRecordInput = Omit<
  PublishPackageRecord,
  "id" | "createdAt" | "updatedAt"
> & {
  id?: string;
  createdAt?: Date;
  updatedAt?: Date;
};


/** 默认发布包（controller 与 publish-run.service 共用；覆盖发布页可编辑字段）。 */
export function buildDefaultPublishPackage(input: {
  renderJobRecordId: string;
  topicPackageId: string;
  scriptRecordId: string;
  storyboardRecordId: string;
  assetManifestRecordId: string;
  videoExportArtifactId: string;
  coverArtifactId?: string | null;
  coverPromptDraft?: string | null;
  coverOrigin?: string;
}): Record<string, unknown> {
  return {
    package_version: "publish_package_v1",
    source_render_job_record_id: input.renderJobRecordId,
    source_topic_package_id: input.topicPackageId,
    source_script_record_id: input.scriptRecordId,
    source_storyboard_record_id: input.storyboardRecordId,
    source_asset_manifest_record_id: input.assetManifestRecordId,
    video_export_artifact_id: input.videoExportArtifactId,
    cover_artifact_id: input.coverArtifactId ?? null,
    cover_prompt_draft: input.coverPromptDraft ?? null,
    cover_origin: input.coverOrigin ?? "storyboard_image",
    title_candidates: [],
    selected_title: "",
    description: "",
    hashtags: [],
    platform_profile: "generic",
    readiness: "ready",
    notes: [],
  };
}

export async function savePublishPackageRecord(
  db: DbClient,
  input: SavePublishPackageRecordInput,
): Promise<PublishPackageRecord> {
  const now = new Date();
  const record: PublishPackageRecord = {
    id: input.id ?? db.generateId(),
    projectId: input.projectId,
    renderJobRecordId: input.renderJobRecordId,
    topicPackageId: input.topicPackageId,
    scriptRecordId: input.scriptRecordId,
    storyboardRecordId: input.storyboardRecordId,
    assetManifestRecordId: input.assetManifestRecordId,
    packageJson: input.packageJson,
    validationResultJson: input.validationResultJson ?? null,
    executionStateJson: input.executionStateJson ?? null,
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
  };

  const projectOwnerId = db.projects.get(record.projectId)?.ownerId ?? "system";
  await db.thirdAggregateWriter?.savePublish(record, projectOwnerId);
  db.publishPackageRecords.set(record.id, record);

  return record;
}

export async function getPublishPackageRecordById(
  db: DbClient,
  id: string,
): Promise<PublishPackageRecord | null> {
  return db.publishPackageRecords.get(id) ?? null;
}
