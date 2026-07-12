import type { AssetPlanRecord, DbClient, ScriptRecord, StoryboardRecord } from "../client.js";
import type { AppPrismaClient } from "../prisma-client.types.js";

const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const nullableObject = (value: unknown): Record<string, unknown> | null => value == null ? null : object(value);
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

export async function hydrateSecondAggregates(db: DbClient, client: AppPrismaClient): Promise<void> {
  const projectIds = [...db.projects.keys()];
  const [scripts, storyboards, assetPlans] = await Promise.all([
    client.scriptRecord.findMany({ where: { projectId: { in: projectIds } } }),
    client.storyboardRecord.findMany({ where: { projectId: { in: projectIds } } }),
    client.assetPlanRecord.findMany({ where: { projectId: { in: projectIds } } }),
  ]);
  db.scriptRecords.clear(); db.storyboardRecords.clear(); db.assetPlanRecords.clear();
  for (const row of scripts) {
    const record: ScriptRecord = { ...row, beatTraceJson: array(row.beatTraceJson), quoteTraceJson: array(row.quoteTraceJson),
      validationResultJson: nullableObject(row.validationResultJson), semanticReviewResultJson: nullableObject(row.semanticReviewResultJson),
      executionStateJson: nullableObject(row.executionStateJson), graphTraceSummaryJson: nullableObject(row.graphTraceSummaryJson),
      runtimeDiagnosticsJson: nullableObject(row.runtimeDiagnosticsJson) };
    db.scriptRecords.set(record.id, record);
  }
  for (const row of storyboards) {
    const record: StoryboardRecord = { ...row, planJson: object(row.planJson), validationResultJson: object(row.validationResultJson),
      executionStateJson: nullableObject(row.executionStateJson), graphTraceSummaryJson: nullableObject(row.graphTraceSummaryJson),
      runtimeDiagnosticsJson: nullableObject(row.runtimeDiagnosticsJson) };
    db.storyboardRecords.set(record.id, record);
  }
  for (const row of assetPlans) {
    const record: AssetPlanRecord = { ...row, planJson: row.planJson as never, validationResultJson: row.validationResultJson as never,
      executionStateJson: object(row.executionStateJson), graphTraceSummaryJson: nullableObject(row.graphTraceSummaryJson),
      runtimeDiagnosticsJson: nullableObject(row.runtimeDiagnosticsJson) };
    db.assetPlanRecords.set(record.id, record);
  }
}
