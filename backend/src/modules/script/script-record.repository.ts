import type { DbClient, ScriptRecord } from "../../db/client";

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
  db.scriptRecords.set(record.id, record);

  return record;
}

export async function getScriptRecordById(
  db: DbClient,
  scriptRecordId: string,
): Promise<ScriptRecord | null> {
  return db.scriptRecords.get(scriptRecordId) ?? null;
}
