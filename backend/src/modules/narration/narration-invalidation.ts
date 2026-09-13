import { createHash } from "node:crypto";
import { canonicalStringify, DEFAULT_NARRATION_CREATIVE_SETTINGS, GenerationConfigurationV1 } from "../../../../shared/src/index.js";
import type { DbClient, ProjectRecord, StoryboardRecord } from "../../db/client.js";
import type { AppPrismaTransactionClient } from "../../db/prisma-client.types.js";
import { Prisma } from "../../generated/prisma/client.js";
import { decodeNarrationRow, durationBandFromSource, readMapNarrationSource, readNarrationSource } from "./narration.repository.js";
import { hasPassingNarrationScriptValidation, narrationTextHash, resolveNarrationReadiness } from "./narration-readiness.js";
import { NarrationRecord } from "../../../../shared/src/index.js";

export class NarrationSourceError extends Error {
  readonly statusCode = 409;
}
export interface StoryboardNarrationSource {
  scriptRecordId: string;
  sourceTextSha256: string;
  narrationRecordId: string;
  audioHash: string;
  timingHash: string;
  projectTtsSettingsSha256: string;
  durationBand: { minMs: number; maxMs: number };
  activeStoryboardRecordId: string | null;
  storyboardPlanSha256?: string | null;
}
function persistence(db: DbClient) {
  const client = db.narrationPersistence.prismaClient ?? db.firstAggregateWriter?.narrationPrismaClient;
  if (!client && (db.firstAggregateWriter || db.secondAggregateWriter || db.thirdAggregateWriter)) throw new Error("narration_persistence_client_missing");
  return client;
}
function sourceIdentity(source: Awaited<ReturnType<typeof readNarrationSource>>, record: NarrationRecord | null): StoryboardNarrationSource | null {
  if (source.project.narrationTimingMode !== "narration_first_v1") return null;
  const script = source.script, confirmation = source.confirmation;
  const hash = script ? narrationTextHash(script.scriptText) : null;
  const confirmed = !!script && script.projectId === source.project.id && confirmation?.projectId === source.project.id && confirmation?.scriptRecordId === script.id && confirmation.sourceTextSha256 === hash && hasPassingNarrationScriptValidation(script.validationResultJson);
  let tts: string | null = null, band: ReturnType<typeof durationBandFromSource> | null = null;
  try { tts = projectTtsHash(source.configuration?.configurationJson); } catch { /* fail closed */ }
  try { band = durationBandFromSource(source.topic?.durationBandJson); } catch { /* fail closed */ }
  if (record && record.projectId !== source.project.id) throw new NarrationSourceError("narration_stale");
  const ready = resolveNarrationReadiness({ mode: source.project.narrationTimingMode, scriptRecordId: source.project.activeScriptRecordId, scriptTextSha256: hash, scriptConfirmed: confirmed, projectTtsSettingsSha256: tts, targetDurationBand: band, activeNarration: record });
  if (!ready.ready) throw new NarrationSourceError(ready.reason!);
  return { scriptRecordId: script!.id, sourceTextSha256: hash!, narrationRecordId: record!.id,
    audioHash: record!.output!.audio.sha256, timingHash: record!.output!.timingMap.sha256,
    projectTtsSettingsSha256: tts!, durationBand: band!, activeStoryboardRecordId: source.project.activeStoryboardRecordId };
}

/** 读取及写入动作共用同一数据库事务；Map 在最后 await 后同步重读全部来源。 */
export async function withStoryboardNarrationSource<T>(db: DbClient, projectId: string, ownerId: string,
  expected: StoryboardNarrationSource | null | undefined,
  action: (state: { source: Awaited<ReturnType<typeof readNarrationSource>>; identity: StoryboardNarrationSource | null; storyboard: StoryboardRecord | Awaited<ReturnType<AppPrismaTransactionClient["storyboardRecord"]["findUnique"]>> | null }, tx?: AppPrismaTransactionClient) => T | Promise<T>,
): Promise<T> {
  const client = persistence(db);
  const perform = async (tx?: AppPrismaTransactionClient) => {
    let source = await readNarrationSource(db, projectId, ownerId, tx);
    let record: NarrationRecord | null = null;
    if (tx && source.project.activeNarrationRecordId) {
      const row = await tx.narrationRecord.findUnique({ where: { id: source.project.activeNarrationRecordId } });
      record = row ? decodeNarrationRow(row) : null;
    }
    let storyboard = tx && source.project.activeStoryboardRecordId ? await tx.storyboardRecord.findUnique({ where: { id: source.project.activeStoryboardRecordId } }) : null;
    if (!tx) {
      source = readMapNarrationSource(db, projectId, ownerId);
      const value = source.project.activeNarrationRecordId ? db.narrationRecords.get(source.project.activeNarrationRecordId) : null;
      record = value ? NarrationRecord.parse(value) : null;
    }
    const identity = sourceIdentity(source, record);
    const activeStoryboard = tx ? storyboard : source.project.activeStoryboardRecordId ? db.storyboardRecords.get(source.project.activeStoryboardRecordId) ?? null : null;
    if (identity) identity.storyboardPlanSha256 = activeStoryboard ? narrationTextHash(canonicalStringify(activeStoryboard.planJson)) : null;
    if (expected !== undefined && canonicalStringify(identity) !== canonicalStringify(expected)) throw new NarrationSourceError("narration_stale");
    return action({ source, identity, storyboard: activeStoryboard }, tx);
  };
  return client ? client.$transaction(tx => perform(tx)) : perform();
}

export function captureStoryboardNarrationSource(db: DbClient, projectId: string, ownerId: string) {
  return withStoryboardNarrationSource(db, projectId, ownerId, undefined, state => structuredClone(state));
}

export async function activateNarrationStoryboard(db: DbClient, ownerId: string, expected: StoryboardNarrationSource, record: StoryboardRecord) {
  const projectPatch = { ...narrationDownstreamReset(), activeStoryboardRecordId: record.id,
    latestStoryboardRunTraceJson: record.graphTraceSummaryJson, status: "storyboard_ready", updatedAt: new Date() };
  const result = await withStoryboardNarrationSource(db, record.projectId, ownerId, expected, async ({ source }, tx) => {
    if (record.scriptRecordId !== expected.scriptRecordId || record.topicPackageId !== source.script?.topicPackageId) throw new NarrationSourceError("narration_stale");
    if (tx) {
      const data = { ...record, planJson: record.planJson as Prisma.InputJsonValue,
        validationResultJson: record.validationResultJson as Prisma.InputJsonValue,
        executionStateJson: record.executionStateJson === null ? Prisma.DbNull : record.executionStateJson as Prisma.InputJsonValue,
        graphTraceSummaryJson: record.graphTraceSummaryJson === null ? Prisma.DbNull : record.graphTraceSummaryJson as Prisma.InputJsonValue,
        runtimeDiagnosticsJson: record.runtimeDiagnosticsJson === null ? Prisma.DbNull : record.runtimeDiagnosticsJson as Prisma.InputJsonValue };
      await tx.storyboardRecord.upsert({ where: { id: record.id }, create: data, update: data });
      await tx.project.update({ where: { id: source.project.id }, data: { ...projectPatch, ...narrationDownstreamResetData(),
        activeStoryboardRecordId: record.id, latestStoryboardRunTraceJson: record.graphTraceSummaryJson === null ? Prisma.DbNull : record.graphTraceSummaryJson as Prisma.InputJsonValue } });
    } else {
      // 该分支没有 await：来源比较与 Map 两项写入不可被旧对象替换打断。
      db.storyboardRecords.set(record.id, structuredClone(record));
      Object.assign(source.project, projectPatch);
    }
    return record;
  });
  // 事务提交后才发布完整镜像，不能让页面继续读生成中的占位记录。
  db.storyboardRecords.set(record.id, structuredClone(result));
  // Prisma 事务分支不触碰内存 Map 的项目对象：提交后同步指针，
  // 否则读 Map 的路由（如策略切换 PATCH）仍看到旧 activeStoryboardRecordId 而误报 no_active_storyboard。
  const mapProject = db.projects.get(record.projectId);
  if (mapProject) Object.assign(mapProject, projectPatch);
  return result;
}

/** 与共享 hash 同源的同步投影，Map 最后校验到写入之间不产生 await。 */
export function projectTtsHash(value: unknown): string {
  const configuration = GenerationConfigurationV1.parse(value);
  return createHash("sha256").update(canonicalStringify({
    modelSelection: configuration.capabilities["tts.synthesize"],
    voiceProfileId: configuration.creative.voice_profile_id,
    narration: configuration.creative.narration ?? DEFAULT_NARRATION_CREATIVE_SETTINGS,
  })).digest("hex");
}

export function narrationDownstreamReset() {
  return {
    activeStoryboardRecordId: null, activeAssetPlanRecordId: null,
    activeAssetManifestRecordId: null, activeComposeRecordId: null,
    activeRenderJobRecordId: null, activePublishPackageRecordId: null,
    latestStoryboardRunTraceJson: null, latestAssetPlanRunTraceJson: null,
    latestAssetsRunTraceJson: null, latestComposeRunTraceJson: null, latestRenderRunTraceJson: null,
  };
}
export function narrationDownstreamResetData() {
  return { ...narrationDownstreamReset(), latestStoryboardRunTraceJson: Prisma.DbNull,
    latestAssetPlanRunTraceJson: Prisma.DbNull, latestAssetsRunTraceJson: Prisma.DbNull,
    latestComposeRunTraceJson: Prisma.DbNull, latestRenderRunTraceJson: Prisma.DbNull };
}

export function invalidateMapNarration(db: DbClient, project: ProjectRecord): void {
  if (project.narrationTimingMode !== "narration_first_v1") return;
  const record = project.activeNarrationRecordId ? db.narrationRecords.get(project.activeNarrationRecordId) : null;
  if (record?.projectId === project.id) db.narrationRecords.set(record.id, { ...record, status: "stale", updatedAt: new Date().toISOString() });
  Object.assign(project, narrationDownstreamReset(), { activeNarrationRecordId: null, activeNarrationSubtitleRevisionId: null });
}

/** 调用方必须在更新来源的同一事务中执行；不删除历史记录或磁盘文件。 */
export async function invalidatePrismaNarration(tx: AppPrismaTransactionClient, project: { id: string; narrationTimingMode?: string; activeNarrationRecordId?: string | null }): Promise<void> {
  if (project.narrationTimingMode !== "narration_first_v1") return;
  await tx.project.update({ where: { id: project.id }, data: {
    ...narrationDownstreamResetData(), activeNarrationRecordId: null, activeNarrationSubtitleRevisionId: null,
  } });
  if (project.activeNarrationRecordId) await tx.narrationRecord.updateMany({
    where: { id: project.activeNarrationRecordId, projectId: project.id }, data: { status: "stale" },
  });
}
