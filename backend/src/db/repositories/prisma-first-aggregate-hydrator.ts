import { existsSync } from "node:fs";
import { join } from "node:path";

import type { ProjectTopicCandidateState } from "../../app.js";
import type { StoredTopicCandidate } from "../../modules/topic/topic-confirm.service.js";
import type {
  CandidateCacheRecord,
  DbClient,
  EventRegistryRecord,
  ProjectGenerationConfigurationRecord,
  ProjectRecord,
  ProjectRecommendationRoundRecord,
  ProviderModelCatalogRecord,
  TopicPackageRecord,
  UserGenerationPreferenceRecord,
} from "../client.js";
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
 *  仅靠目录是否存在或 project.json 都不可靠（残留空壳目录也可能带
 *  project.json）。这里以生成产物目录（含独立 narration-runs）作为真实
 *  内容的判定标志，避免空壳目录遮蔽只生成了口播的项目。 */
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
  if (hasRealContent(dateLayout)) return dateLayout;

  const uuidLayout = join(input.storageRoot, "storage", "projects", input.storageKey);
  if (hasRealContent(uuidLayout)) return uuidLayout;

  // 两种布局都没有生成产物目录：可能是还没生成资源的新项目，
  // 或只有 trace 的早期项目。按 project.json 兜底，再按目录存在兜底，
  // 最终回退日期格式（project-storage.ts 后续写入会走这条路径）。
  if (existsSync(join(dateLayout, "project.json"))) return dateLayout;
  if (existsSync(join(uuidLayout, "project.json"))) return uuidLayout;
  if (existsSync(dateLayout)) return dateLayout;
  if (existsSync(uuidLayout)) return uuidLayout;
  return dateLayout;
}

/** 判断目录是否有真实生成内容（assets-runs / renders / publish / narration-runs 任一存在）。 */
function hasRealContent(dir: string): boolean {
  return existsSync(join(dir, "assets-runs"))
    || existsSync(join(dir, "renders"))
    || existsSync(join(dir, "publish"))
    || existsSync(join(dir, "narration-runs"));
}

export async function hydrateFirstAggregates(
  db: DbClient,
  topicCandidateStore: Map<string, ProjectTopicCandidateState>,
  client: AppPrismaClient,
  options: { storageRoot: string },
): Promise<void> {
  db.narrationPersistence.prismaClient = client;
  const [projects, events, packages, caches, rounds, userPreferences, projectConfigurations, catalog] = await Promise.all([
    client.project.findMany({ where: { archivedAt: null } }), client.eventRegistryEntry.findMany(), client.topicPackage.findMany(),
    client.recommendationCandidateCache.findMany(),
    client.recommendationRound.findMany({ orderBy: [{ projectId: "asc" }, { roundIndex: "asc" }], include: { exposures: { orderBy: { selectedAt: "asc" } } } }),
    client.userGenerationPreference.findMany(),
    client.projectGenerationConfiguration.findMany(),
    client.providerModelCatalog.findMany(),
  ]);
  const roundFilters = new Map(
    rounds.map((round) => [round.id, parseRecommendationRoundFilterJson(round.filterJson)]),
  );
  db.projects.clear(); db.events.clear(); db.topicPackages.clear(); db.candidateCache.clear();
  db.recommendationRounds.clear(); db.topicRunCounts.clear(); topicCandidateStore.clear();
  db.userGenerationPreferences.clear(); db.projectGenerationConfigurations.clear(); db.providerModelCatalog.clear();

  for (const row of projects) {
    const record: ProjectRecord = {
      id: row.id, name: row.name, ownerId: row.ownerId, createdById: row.createdById,
      status: row.status, activeTopicPackageId: row.activeTopicPackageId,
      narrationTimingMode: row.narrationTimingMode as ProjectRecord["narrationTimingMode"],
      activeNarrationRecordId: row.activeNarrationRecordId, activeNarrationSubtitleRevisionId: row.activeNarrationSubtitleRevisionId,
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
  // S2-2A：用户默认偏好、项目冻结配置与 provider/model 目录。
  // 用户偏好与目录无项目范围，全量加载；项目配置按内存态 projects 过滤孤儿行。
  for (const row of userPreferences) {
    const record: UserGenerationPreferenceRecord = {
      id: row.id, userId: row.userId, schemaVersion: row.schemaVersion, revision: row.revision,
      configurationJson: object(row.configurationJson) as UserGenerationPreferenceRecord["configurationJson"],
      createdAt: row.createdAt, updatedAt: row.updatedAt,
    };
    db.userGenerationPreferences.set(record.id, record);
  }
  for (const row of projectConfigurations) {
    if (!db.projects.has(row.projectId)) continue;
    const record: ProjectGenerationConfigurationRecord = {
      id: row.id, projectId: row.projectId, schemaVersion: row.schemaVersion, revision: row.revision,
      sourceUserPreferenceRevision: row.sourceUserPreferenceRevision,
      configurationJson: object(row.configurationJson) as ProjectGenerationConfigurationRecord["configurationJson"],
      createdAt: row.createdAt, updatedAt: row.updatedAt,
    };
    db.projectGenerationConfigurations.set(record.id, record);
  }
  for (const row of catalog) {
    const record: ProviderModelCatalogRecord = {
      id: row.id, capability: row.capability as ProviderModelCatalogRecord["capability"],
      providerKey: row.providerKey, modelId: row.modelId, modelVersion: row.modelVersion,
      displayName: row.displayName, qualityTier: row.qualityTier, speedTier: row.speedTier,
      parameterCapabilitiesJson: object(row.parameterCapabilitiesJson),
      pricingVersion: row.pricingVersion, pricingJson: object(row.pricingJson),
      status: row.status as ProviderModelCatalogRecord["status"], isDefault: row.isDefault,
      createdAt: row.createdAt, updatedAt: row.updatedAt,
    };
    db.providerModelCatalog.set(record.id, record);
  }
}
