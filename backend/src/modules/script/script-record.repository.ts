import type { DbClient, ProjectRecord, ScriptRecord, ScriptWriteReceipt } from "../../db/client";
import { canonicalStringify } from "../../../../shared/src/index.js";
import { invalidateMapNarration, narrationDownstreamReset, NarrationSourceError } from "../narration/narration-invalidation.js";

type Publication = { sequence: number; identity: string };
const publications = new WeakMap<DbClient, Map<string, Publication>>();
function rememberPublication(db: DbClient, key: string, identity: string, receipt: ScriptWriteReceipt | void) {
  const entries = publications.get(db) ?? new Map<string, Publication>();
  publications.set(db, entries);
  const prior = entries.get(key);
  if (receipt && (!prior || receipt.publicationSequence >= prior.sequence))
    entries.set(key, { sequence: receipt.publicationSequence, identity });
  else if (prior?.identity !== identity) entries.delete(key);
}
function canPublish(db: DbClient, key: string, before: string, current: string, receipt: ScriptWriteReceipt | void) {
  const prior = publications.get(db)?.get(key);
  if (receipt && prior && receipt.publicationSequence < prior.sequence) return false;
  if (before === current) return true;
  // 只允许较晚提交覆盖已登记的写入；未登记的确认、取消或对象变更仍由内容比较保护。
  return !!receipt && !!prior && receipt.publicationSequence > prior.sequence && prior.identity === current;
}

/** 写入应答可能逆序；仅比较来源/产物状态，项目改名不阻止正常缓存发布。 */
function projectPublicationIdentity(db: DbClient, projectId: string): string {
  const project = db.projects.get(projectId);
  if (!project) return canonicalStringify(null);
  const keys = ["ownerId", "narrationTimingMode", "activeTopicPackageId", "activeScriptRecordId",
    "activeNarrationRecordId", "activeNarrationSubtitleRevisionId", "status", "latestScriptRunTraceJson",
    ...Object.keys(narrationDownstreamReset())] as Array<keyof ProjectRecord>;
  return canonicalStringify(Object.fromEntries(keys.map(key => [key, project[key] ?? null])));
}

/** 持久化模式发布数据库当前值；应答次序不代表提交次序。最后await后再比较缓存版本。 */
async function publishPersistedScriptCache(db: DbClient, record: ScriptRecord, receipt: ScriptWriteReceipt | void): Promise<boolean> {
  const projectId = record.projectId, scriptRecordId = record.id;
  const client = db.narrationPersistence.prismaClient ?? db.firstAggregateWriter?.narrationPrismaClient;
  if (!client) return false;
  const beforeProject = projectPublicationIdentity(db, projectId);
  const beforeScript = canonicalStringify(db.scriptRecords.get(scriptRecordId) ?? null);
  const narrationId = db.projects.get(projectId)?.activeNarrationRecordId;
  const beforeNarration = narrationId ? canonicalStringify(db.narrationRecords.get(narrationId) ?? null) : null;
  const rows = await client.$transaction(tx => Promise.all([
    tx.project.findUnique({ where: { id: projectId } }),
    tx.scriptRecord.findUnique({ where: { id: scriptRecordId } }),
    narrationId ? tx.narrationRecord.findUnique({ where: { id: narrationId } }) : Promise.resolve(null),
  ])).catch(() => null);
  // 主写入已经提交：刷新失败走调用方的版本比较发布，保持legacy结果可见，
  // 同时拒绝覆盖写入等待期间已经发布的新来源；不能无条件跳过或无条件回写。
  if (!rows) return false;
  const [project, script, narration] = rows;
  if (project?.narrationTimingMode !== "narration_first_v1") return false;
  const current = db.projects.get(projectId);
  if (!current || current.ownerId !== project.ownerId) return true;
  if (beforeProject !== projectPublicationIdentity(db, projectId)
    || beforeScript !== canonicalStringify(db.scriptRecords.get(scriptRecordId) ?? null)) return true;
  if (script?.projectId === projectId) db.scriptRecords.set(scriptRecordId, structuredClone(script) as unknown as ScriptRecord);
  const keys = ["narrationTimingMode", "activeTopicPackageId", "activeScriptRecordId",
    "activeNarrationRecordId", "activeNarrationSubtitleRevisionId", "status", "latestScriptRunTraceJson",
    ...Object.keys(narrationDownstreamReset())] as Array<keyof typeof project>;
  Object.assign(current, Object.fromEntries(keys.map(key => [key, project[key] ?? null])));
  // 只同步刚读取的历史状态；缓存中另一次确认/取消已经发布时不反写。
  const cachedNarration = narrationId ? db.narrationRecords.get(narrationId) : null;
  if (narration && cachedNarration && narration.projectId === projectId
    && beforeNarration === canonicalStringify(cachedNarration)) {
    db.narrationRecords.set(narration.id, { ...cachedNarration,
      status: narration.status as typeof cachedNarration.status, updatedAt: narration.updatedAt.toISOString() });
  }
  const scriptIdentity = canonicalStringify(db.scriptRecords.get(scriptRecordId) ?? null);
  rememberPublication(db, "script:" + scriptRecordId, scriptIdentity,
    scriptIdentity === canonicalStringify(record) ? receipt : undefined);
  rememberPublication(db, "project:" + projectId, projectPublicationIdentity(db, projectId),
    project.activeScriptRecordId === record.id && !project.activeNarrationRecordId ? receipt : undefined);
  return true;
}

export async function activateScriptRecord(db: DbClient, project: ProjectRecord, record: ScriptRecord, expectedActiveScriptRecordId: string | null) {
  const patch = { ...narrationDownstreamReset(), activeScriptRecordId: record.id, status: "script_ready",
    latestScriptRunTraceJson: record.graphTraceSummaryJson, updatedAt: new Date() };
  const writer = db.secondAggregateWriter;
  const publishedBeforeWrite = projectPublicationIdentity(db, project.id);
  let receipt: ScriptWriteReceipt | void = undefined;
  if (writer) {
    receipt = await writer.activateScript({ ...project, ...patch }, record, expectedActiveScriptRecordId);
    if (await publishPersistedScriptCache(db, record, receipt)) return;
  }
  const current = db.projects.get(project.id);
  // 数据库已成功时，后来的缓存发布优先；包括owner变化/删除，不能触发旧候选失败清理。
  if (writer && !canPublish(db, "project:" + project.id, publishedBeforeWrite, projectPublicationIdentity(db, project.id), receipt)) return;
  if (!current || current.ownerId !== project.ownerId) throw new Error("project_scope_denied");
  if (!writer && current.narrationTimingMode === "narration_first_v1" &&
    (current.activeScriptRecordId !== expectedActiveScriptRecordId || current.activeTopicPackageId !== record.topicPackageId)) throw new NarrationSourceError("narration_stale");
  if (current.narrationTimingMode === "narration_first_v1") invalidateMapNarration(db, current);
  Object.assign(current, patch);
  rememberPublication(db, "project:" + project.id, projectPublicationIdentity(db, project.id), receipt);
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

  const writer = db.secondAggregateWriter;
  const publishedRecord = canonicalStringify(db.scriptRecords.get(record.id) ?? null);
  const publishedProject = projectPublicationIdentity(db, record.projectId);
  const receipt = await writer?.saveScript(record);
  if (writer && await publishPersistedScriptCache(db, record, receipt)) return record;
  if (writer && !canPublish(db, "script:" + record.id, publishedRecord, canonicalStringify(db.scriptRecords.get(record.id) ?? null), receipt)) return record;
  // writer 的来源变更与失效在数据库同事务执行；Map 分支在最后一次 await 后重读。
  const project = db.projects.get(record.projectId);
  const previous = db.scriptRecords.get(record.id);
  if (project?.activeScriptRecordId === record.id && previous && previous.scriptText !== record.scriptText
    && (!writer || canPublish(db, "project:" + record.projectId, publishedProject, projectPublicationIdentity(db, record.projectId), receipt))) {
    invalidateMapNarration(db, project);
  }
  db.scriptRecords.set(record.id, record);
  rememberPublication(db, "script:" + record.id, canonicalStringify(record), receipt);

  return record;
}

export async function getScriptRecordById(
  db: DbClient,
  scriptRecordId: string,
): Promise<ScriptRecord | null> {
  return db.scriptRecords.get(scriptRecordId) ?? null;
}
