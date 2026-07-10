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
