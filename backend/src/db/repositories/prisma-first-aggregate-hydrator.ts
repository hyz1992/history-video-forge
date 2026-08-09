import { existsSync } from "node:fs";
import { join } from "node:path";

import type { ProjectTopicCandidateState } from "../../app.js";
import type { StoredTopicCandidate } from "../../modules/topic/topic-confirm.service.js";
import type { CandidateCacheRecord, DbClient, EventRegistryRecord, ProjectRecord, ProjectRecommendationRoundRecord, TopicPackageRecord } from "../client.js";
import type { AppPrismaClient } from "../prisma-client.types.js";
import { parseRecommendationRoundFilterJson } from "./recommendation-round-filter.js";
import { buildProjectStorageRelativeDir } from "../../runtime/trace/project-storage.js";

const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const array = <T>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];

/** Reconstruct the on-disk short id from the project UUID, matching the
 *  convention used by project-storage.ts (`p_<first 8 hex chars>`). */
function buildShortId(projectId: string): string {
  const compact = projectId.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  const shortBody = (compact.slice(0, 8) || "00000000").padEnd(8, "0");
  return `p_${shortBody}`;
}

/** Resolve the on-disk storage root for a project.
 *
 *  历史原因导致磁盘上可能同时存在两种目录布局的残留：
 *  - 日期格式（project-storage.ts 现行写入路径）：
 *    storage/projects/<YYYY-MM-DD>/<displayName> [<shortId>]/
 *  - UUID 格式（早期/部分环境写入路径）：storage/projects/<storageKey>/
 *
 *  仅靠目录是否存在不足以判定真实文件所在（可能有空壳残留目录），
 *  这里用 project.json 作为"完整内容"标志：哪个目录有 project.json 就用哪个。
 *  两者都没有时（新项目首次 hydrate，目录尚未创建）默认返回日期格式。 */
function resolveProjectStorageRoot(input: {
  storageRoot: string;
  createdAt: Date;
  displayName: string;
  shortId: string;
  storageKey: string;
}): string {
  const dateLayout = join(
    input.storageRoot,
    buildProjectStorageRelativeDir({
      createdAt: input.createdAt,
      displayName: input.displayName,
      shortId: input.shortId,
    }),
  );
  if (existsSync(join(dateLayout, "project.json"))) return dateLayout;

  const uuidLayout = join(input.storageRoot, "storage", "projects", input.storageKey);
  if (existsSync(join(uuidLayout, "project.json"))) return uuidLayout;

  // 两种布局都没有 project.json：新项目首次 hydrate 目录尚未创建，
  // 或极旧项目从未写过 project.json。按日期格式目录是否存在兜底，
  // 都不存在则返回日期格式（project-storage.ts 后续会按这个布局创建）。
  if (existsSync(dateLayout)) return dateLayout;
  if (existsSync(uuidLayout)) return uuidLayout;
  return dateLayout;
}

export async function hydrateFirstAggregates(
  db: DbClient,
  topicCandidateStore: Map<string, ProjectTopicCandidateState>,
  client: AppPrismaClient,
  options: { storageRoot: string },
): Promise<void> {
  const [projects, events, packages, caches, rounds] = await Promise.all([
    client.project.findMany({ where: { archivedAt: null } }), client.eventRegistryEntry.findMany(), client.topicPackage.findMany(),
    client.recommendationCandidateCache.findMany(),
    client.recommendationRound.findMany({ orderBy: [{ projectId: "asc" }, { roundIndex: "asc" }], include: { exposures: { orderBy: { selectedAt: "asc" } } } }),
  ]);
  const roundFilters = new Map(
    rounds.map((round) => [round.id, parseRecommendationRoundFilterJson(round.filterJson)]),
  );
  db.projects.clear(); db.events.clear(); db.topicPackages.clear(); db.candidateCache.clear();
  db.recommendationRounds.clear(); db.topicRunCounts.clear(); topicCandidateStore.clear();

  for (const row of projects) {
    const record: ProjectRecord = {
      id: row.id, name: row.name, ownerId: row.ownerId, createdById: row.createdById,
      status: row.status, activeTopicPackageId: row.activeTopicPackageId,
      activeScriptRecordId: row.activeScriptRecordId, activeStoryboardRecordId: row.activeStoryboardRecordId,
      activeAssetPlanRecordId: row.activeAssetPlanRecordId, activeAssetManifestRecordId: row.activeAssetManifestRecordId,
      activeComposeRecordId: row.activeComposeRecordId, activeRenderJobRecordId: row.activeRenderJobRecordId,
      activePublishPackageRecordId: row.activePublishPackageRecordId,
      latestTopicRunTraceJson: row.latestTopicRunTraceJson ? object(row.latestTopicRunTraceJson) : null,
      latestScriptRunTraceJson: row.latestScriptRunTraceJson ? object(row.latestScriptRunTraceJson) : null,
      latestStoryboardRunTraceJson: row.latestStoryboardRunTraceJson ? object(row.latestStoryboardRunTraceJson) : null,
      latestAssetPlanRunTraceJson: row.latestAssetPlanRunTraceJson ? object(row.latestAssetPlanRunTraceJson) : null,
      latestAssetsRunTraceJson: row.latestAssetsRunTraceJson ? object(row.latestAssetsRunTraceJson) : null,
      latestComposeRunTraceJson: row.latestComposeRunTraceJson ? object(row.latestComposeRunTraceJson) : null,
      latestRenderRunTraceJson: row.latestRenderRunTraceJson ? object(row.latestRenderRunTraceJson) : null,
      storageDisplayName: row.storageDisplayName,
      storageShortId: buildShortId(row.id),
      // Reconstruct the on-disk storage root from createdAt + displayName +
      // shortId, matching the layout used by project-storage.ts when files
      // 探测磁盘上的真实存储目录（日期格式优先，UUID 格式回退），
      // 兼容历史遗留的混合布局。
      storageRootDir: resolveProjectStorageRoot({
        storageRoot: options.storageRoot,
        createdAt: row.createdAt,
        displayName: row.storageDisplayName || row.name,
        shortId: buildShortId(row.id),
        storageKey: row.storageKey,
      }),
      storageRenameLocked: row.storageRenameLocked, createdAt: row.createdAt, updatedAt: row.updatedAt,
    };
    db.projects.set(record.id, record);
  }
  for (const row of events) {
    const record: EventRegistryRecord = { id: row.id, canonicalName: row.canonicalName, aliases: array<string>(row.aliasesJson),
      canonicalQuotesJson: array<string>(row.canonicalQuotesJson), canonicalQuoteIntentsJson: array(row.canonicalQuoteIntentsJson),
      sourceType: row.sourceType, isProvisional: row.isProvisional, createdAt: row.createdAt, updatedAt: row.updatedAt };
    db.events.set(record.id, record);
  }
  for (const row of packages) {
    if (!db.projects.has(row.projectId)) continue;
    const record: TopicPackageRecord = { ...row, canonicalQuotesJson: array<string>(row.canonicalQuotesJson),
      canonicalQuoteIntentsJson: array(row.canonicalQuoteIntentsJson), durationBandJson: object(row.durationBandJson),
      narrativeTensionMapJson: object(row.narrativeTensionMapJson), mustIncludeBeatsJson: array(row.mustIncludeBeatsJson),
      forbiddenExpansionsJson: array(row.forbiddenExpansionsJson), riskHintsJson: array(row.riskHintsJson),
      sourceAnchorRefsJson: array(row.sourceAnchorRefsJson), ambiguityNotesJson: array(row.ambiguityNotesJson),
      sourceRefJson: row.sourceRefJson ? object(row.sourceRefJson) : null };
    db.topicPackages.set(record.id, record);
  }
  for (const row of caches) {
    if (row.projectId && !db.projects.has(row.projectId)) continue;
    const record: CandidateCacheRecord = { ...row, filterFingerprint: row.filterFingerprint,
      viralRubricJson: object(row.viralRubricJson),
      estimatedDurationBandJson: row.estimatedDurationBandJson, mustCoverPreviewJson: array(row.mustCoverPreviewJson),
      riskHintsJson: array<string>(row.riskHintsJson) };
    db.candidateCache.set(record.id, record);
  }
  for (const row of rounds) {
    if (!db.projects.has(row.projectId)) continue;
    const record: ProjectRecommendationRoundRecord = { projectId: row.projectId, createdAt: row.createdAt,
      filterFingerprint: row.filterFingerprint,
      filterJson: roundFilters.get(row.id)!,
      candidates: row.exposures.map((item) => ({ eventRegistryEntryId: item.eventRegistryEntryId ?? "", eventIdentity: item.eventIdentity,
        title: item.title, fingerprint: item.fingerprint, filterFingerprint: item.filterFingerprint,
        createdAt: item.selectedAt })) };
    const projectRounds = db.recommendationRounds.get(row.projectId) ?? [];
    projectRounds.push(record); db.recommendationRounds.set(row.projectId, projectRounds);
    db.topicRunCounts.set(row.projectId, Math.max(db.topicRunCounts.get(row.projectId) ?? 0, row.roundIndex));
    const cacheByFingerprint = new Map(caches.filter((cache) => cache.projectId === row.projectId).map((cache) => [cache.fingerprint, cache]));
    const candidates = row.exposures.flatMap((exposure): StoredTopicCandidate[] => {
      const cache = cacheByFingerprint.get(exposure.fingerprint);
      const event = exposure.eventRegistryEntryId ? db.events.get(exposure.eventRegistryEntryId) : undefined;
      if (!cache || !event) return [];
      return [{
        candidateId: exposure.id, projectId: row.projectId, event,
        title: exposure.title ?? cache.eventIdentity ?? event.canonicalName,
        oneLineAngle: cache.oneLineAngle, familyLabel: cache.familyLabel, scopeLabel: cache.scopeLabel,
        coreConflict: cache.coreConflict, strongScene: cache.strongScene,
        mustCoverPreview: array<string>(cache.mustCoverPreviewJson), sourceHint: cache.sourceHint,
        recentUsageHint: cache.recentUsageHint, whyThisNow: cache.whyThisNow,
        riskHints: array<string>(cache.riskHintsJson), viralRubric: object(cache.viralRubricJson) as Record<string, string>,
      }];
    });
    const state: ProjectTopicCandidateState = topicCandidateStore.get(row.projectId) ?? { candidatesById: new Map(), rounds: [] };
    for (const candidate of candidates) state.candidatesById.set(candidate.candidateId, candidate);
    state.rounds.push({ roundId: row.id, roundIndex: row.roundIndex, createdAt: row.createdAt.toISOString(), candidates });
    topicCandidateStore.set(row.projectId, state);
  }
}
