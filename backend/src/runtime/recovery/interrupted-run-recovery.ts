import type { DbClient, AssetProviderJobRecord, ProjectRecord } from "../../db/client.js";

const STATUS_RECOVERY: Record<string, string> = {
  topic_generating: "topic_pending",
  script_generating: "script_ready",
  storyboard_generating: "storyboard_ready",
  asset_plan_generating: "asset_plan_ready",
  assets_generating: "assets_blocked",
  compose_generating: "compose_ready",
  render_rendering: "render_failed",
};

export interface InterruptedRunRecoveryResult {
  recoveredProjectIds: string[];
  recoveredProviderJobIds: string[];
}

function markExecutionInterrupted(record: { executionStateJson?: Record<string, unknown> | null } | undefined, recoveredAt: string) {
  if (!record) return;
  record.executionStateJson = {
    ...(record.executionStateJson ?? {}),
    generating: false,
    interrupted_at: recoveredAt,
    recovery_action: "manual_retry_required",
  };
}

function recoverProjectRecord(db: DbClient, project: ProjectRecord, recoveredAt: string): void {
  markExecutionInterrupted(project.activeScriptRecordId ? db.scriptRecords.get(project.activeScriptRecordId) : undefined, recoveredAt);
  markExecutionInterrupted(project.activeStoryboardRecordId ? db.storyboardRecords.get(project.activeStoryboardRecordId) : undefined, recoveredAt);
  markExecutionInterrupted(project.activeAssetPlanRecordId ? db.assetPlanRecords.get(project.activeAssetPlanRecordId) : undefined, recoveredAt);
  markExecutionInterrupted(project.activeAssetManifestRecordId ? db.assetManifestRecords.get(project.activeAssetManifestRecordId) : undefined, recoveredAt);
  markExecutionInterrupted(project.activeComposeRecordId ? db.composeRecords.get(project.activeComposeRecordId) : undefined, recoveredAt);
  markExecutionInterrupted(project.activeRenderJobRecordId ? db.renderJobRecords.get(project.activeRenderJobRecordId) : undefined, recoveredAt);
  markExecutionInterrupted(project.activePublishPackageRecordId ? db.publishPackageRecords.get(project.activePublishPackageRecordId) : undefined, recoveredAt);

  const nextStatus = STATUS_RECOVERY[project.status];
  if (nextStatus) project.status = nextStatus;
  project.updatedAt = new Date(recoveredAt);
}

function recoverProviderJob(job: AssetProviderJobRecord, recoveredAt: string): boolean {
  if (job.status !== "submitted" && job.status !== "running") return false;
  job.status = "failed";
  job.errorCode = "process_interrupted";
  job.errorMessage = "生成进程中断，未自动重新提交外部任务。";
  job.updatedAt = new Date(recoveredAt);
  return true;
}

export function recoverInterruptedRuns(
  db: DbClient,
  options: { recoveredAt?: string } = {},
): InterruptedRunRecoveryResult {
  const recoveredAt = options.recoveredAt ?? new Date().toISOString();
  const result: InterruptedRunRecoveryResult = {
    recoveredProjectIds: [],
    recoveredProviderJobIds: [],
  };
  for (const project of db.projects.values()) {
    if (!STATUS_RECOVERY[project.status]) continue;
    recoverProjectRecord(db, project, recoveredAt);
    result.recoveredProjectIds.push(project.id);
  }
  for (const job of db.assetProviderJobRecords.values()) {
    if (recoverProviderJob(job, recoveredAt)) result.recoveredProviderJobIds.push(job.id);
  }
  return result;
}

export async function recoverAndPersistInterruptedRuns(
  db: DbClient,
  options: { recoveredAt?: string } = {},
): Promise<InterruptedRunRecoveryResult> {
  const result = recoverInterruptedRuns(db, options);

  for (const projectId of result.recoveredProjectIds) {
    const project = db.projects.get(projectId);
    if (!project) continue;
    await db.firstAggregateWriter?.syncProject(project);

    if (project.activeScriptRecordId) {
      const record = db.scriptRecords.get(project.activeScriptRecordId);
      if (record) await db.secondAggregateWriter?.saveScript(record);
    }
    if (project.activeStoryboardRecordId) {
      const record = db.storyboardRecords.get(project.activeStoryboardRecordId);
      if (record) await db.secondAggregateWriter?.saveStoryboard(record);
    }
    if (project.activeAssetPlanRecordId) {
      const record = db.assetPlanRecords.get(project.activeAssetPlanRecordId);
      if (record) await db.secondAggregateWriter?.saveAssetPlan(record);
    }
    if (project.activeAssetManifestRecordId) {
      const record = db.assetManifestRecords.get(project.activeAssetManifestRecordId);
      if (record) await db.thirdAggregateWriter?.saveAssetManifest(record);
    }
    if (project.activeComposeRecordId) {
      const record = db.composeRecords.get(project.activeComposeRecordId);
      if (record) await db.thirdAggregateWriter?.saveCompose(record);
    }
    if (project.activeRenderJobRecordId) {
      const record = db.renderJobRecords.get(project.activeRenderJobRecordId);
      if (record) await db.thirdAggregateWriter?.saveRender(record);
    }
    if (project.activePublishPackageRecordId) {
      const record = db.publishPackageRecords.get(project.activePublishPackageRecordId);
      if (record) await db.thirdAggregateWriter?.savePublish(record);
    }
  }

  for (const jobId of result.recoveredProviderJobIds) {
    const job = db.assetProviderJobRecords.get(jobId);
    if (job) await db.thirdAggregateWriter?.saveProviderJob(job);
  }

  return result;
}
