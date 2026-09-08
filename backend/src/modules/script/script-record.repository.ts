import type { DbClient, ProjectRecord, ScriptRecord } from "../../db/client";
import { invalidateMapNarration, narrationDownstreamReset, NarrationSourceError } from "../narration/narration-invalidation.js";

export async function activateScriptRecord(db: DbClient, project: ProjectRecord, record: ScriptRecord, expectedActiveScriptRecordId: string | null) {
  const patch = { ...narrationDownstreamReset(), activeScriptRecordId: record.id, status: "script_ready",
    latestScriptRunTraceJson: record.graphTraceSummaryJson, updatedAt: new Date() };
  if (db.secondAggregateWriter) await db.secondAggregateWriter.activateScript({ ...project, ...patch }, record, expectedActiveScriptRecordId);
  const current = db.projects.get(project.id);
  if (!current || current.ownerId !== project.ownerId) throw new Error("project_scope_denied");
  if (!db.secondAggregateWriter && current.narrationTimingMode === "narration_first_v1" &&
    (current.activeScriptRecordId !== expectedActiveScriptRecordId || current.activeTopicPackageId !== record.topicPackageId)) throw new NarrationSourceError("narration_stale");
  if (current.narrationTimingMode === "narration_first_v1") invalidateMapNarration(db, current);
  Object.assign(current, patch);
}

export interface SaveScriptRecordInput {
  id?: string;
  projectId: string;
  topicPackageId: string;
  scriptText: string;
  openingSpan: string;
  endingSpan: string;
  estimatedDurationSec: number;
  beatTraceJson: unknown[];
  quoteTraceJson: unknown[];
  reviewStatus: string;
  validationResultJson: Record<string, unknown> | null;
  semanticReviewResultJson: Record<string, unknown> | null;
  executionStateJson: Record<string, unknown> | null;
  graphTraceSummaryJson?: Record<string, unknown> | null;
  runtimeDiagnosticsJson?: Record<string, unknown> | null;
}

export async function saveScriptRecord(
  db: DbClient,
  input: SaveScriptRecordInput,
): Promise<ScriptRecord> {
  const record: ScriptRecord = {
    id: input.id ?? db.generateId(),
    projectId: input.projectId,
    topicPackageId: input.topicPackageId,
    scriptText: input.scriptText,
    openingSpan: input.openingSpan,
    endingSpan: input.endingSpan,
    estimatedDurationSec: input.estimatedDurationSec,
    beatTraceJson: input.beatTraceJson,
    quoteTraceJson: input.quoteTraceJson,
    reviewStatus: input.reviewStatus,
    validationResultJson: input.validationResultJson,
    semanticReviewResultJson: input.semanticReviewResultJson,
    executionStateJson: input.executionStateJson,
    graphTraceSummaryJson: input.graphTraceSummaryJson ?? null,
    runtimeDiagnosticsJson: input.runtimeDiagnosticsJson ?? null,
    createdAt: new Date(),
  };

  await db.secondAggregateWriter?.saveScript(record);
  // writer 的来源变更与失效在数据库同事务执行；Map 分支在最后一次 await 后重读。
  const project = db.projects.get(record.projectId);
  const previous = db.scriptRecords.get(record.id);
  if (project?.activeScriptRecordId === record.id && previous && previous.scriptText !== record.scriptText) {
    invalidateMapNarration(db, project);
  }
  db.scriptRecords.set(record.id, record);

  return record;
}

export async function getScriptRecordById(
  db: DbClient,
  scriptRecordId: string,
): Promise<ScriptRecord | null> {
  return db.scriptRecords.get(scriptRecordId) ?? null;
}
