import { Prisma } from "../../generated/prisma/client.js";

import type { AppPrismaClient, AppPrismaTransactionClient } from "../prisma-client.types.js";
import { readLegacySnapshot, type LegacySnapshotEntry } from "../legacy-snapshot-reader.js";
import { inspectV1Snapshot } from "./inspect-v1-snapshot.js";

export type V1ImportRepairPolicy = "repair_known_safe_cache_and_active_publish";

export interface V1ImportRepair {
  code: "orphan_candidate_cache_skipped" | "duplicate_candidate_cache_skipped" | "missing_active_publish_cleared";
  recordId: string;
  detail: string;
}

export interface ImportV1SnapshotOptions {
  sourcePath: string;
  defaultOwnerId: string;
  repairPolicy?: V1ImportRepairPolicy;
}

export interface ImportV1SnapshotResult {
  status: "completed" | "already_applied";
  sourceSha256: string;
  repairs: V1ImportRepair[];
}

type UnknownRecord = Record<string, any>;

function record(value: unknown): UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("migration_invalid_record");
  return value as UnknownRecord;
}

function date(value: unknown, fallback = new Date(0)): Date {
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return fallback;
}

function json(value: unknown): Prisma.InputJsonValue {
  return (value ?? {}) as Prisma.InputJsonValue;
}

function nullableJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value === null || value === undefined ? Prisma.JsonNull : value as Prisma.InputJsonValue;
}

function canRepairInspection(options: ImportV1SnapshotOptions, issues: ReturnType<typeof inspectV1Snapshot>["issues"]): boolean {
  if (options.repairPolicy !== "repair_known_safe_cache_and_active_publish") return false;
  return issues.every((issue) => (
    (issue.code === "orphan_project_reference" && issue.collection === "candidateCache")
    || (issue.code === "duplicate_candidate_fingerprint" && issue.collection === "candidateCache")
    || (issue.code === "active_record_missing" && issue.detail?.startsWith("activePublishPackageRecordId="))
  ));
}

function storageKey(project: UnknownRecord, id: string): string {
  const candidate = typeof project.storageShortId === "string" ? project.storageShortId.trim() : "";
  return candidate || `p_${id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12)}`;
}

async function createEach(entries: LegacySnapshotEntry[], create: (id: string, row: UnknownRecord) => Promise<unknown>): Promise<void> {
  for (const [id, value] of entries) await create(id, record(value));
}

async function importCoreCollections(
  transaction: AppPrismaTransactionClient,
  collections: ReturnType<typeof readLegacySnapshot>["document"]["collections"],
  options: ImportV1SnapshotOptions,
  repairs: V1ImportRepair[],
): Promise<void> {
  await createEach(collections.events, (id, row) => transaction.eventRegistryEntry.create({ data: {
    id, canonicalName: row.canonicalName, aliasesJson: json(row.aliases),
    canonicalQuotesJson: json(row.canonicalQuotesJson ?? []),
    canonicalQuoteIntentsJson: json(row.canonicalQuoteIntentsJson ?? []),
    sourceType: row.sourceType, isProvisional: Boolean(row.isProvisional),
    createdAt: date(row.createdAt), updatedAt: date(row.updatedAt),
  } }));

  await createEach(collections.projects, (id, row) => transaction.project.create({ data: {
    id, ownerId: options.defaultOwnerId, name: row.name, status: row.status,
    storageKey: storageKey(row, id), storageDisplayName: row.storageDisplayName || row.name,
    storageRenameLocked: Boolean(row.storageRenameLocked),
    latestTopicRunTraceJson: nullableJson(row.latestTopicRunTraceJson),
    latestScriptRunTraceJson: nullableJson(row.latestScriptRunTraceJson),
    latestStoryboardRunTraceJson: nullableJson(row.latestStoryboardRunTraceJson),
    latestAssetPlanRunTraceJson: nullableJson(row.latestAssetPlanRunTraceJson),
    latestAssetsRunTraceJson: nullableJson(row.latestAssetsRunTraceJson),
    latestComposeRunTraceJson: nullableJson(row.latestComposeRunTraceJson),
    latestRenderRunTraceJson: nullableJson(row.latestRenderRunTraceJson),
    createdAt: date(row.createdAt), updatedAt: date(row.updatedAt),
  } }));

  await createEach(collections.topicPackages, (id, row) => transaction.topicPackage.create({ data: {
    id, projectId: row.projectId, eventRegistryEntryId: row.eventRegistryEntryId ?? null,
    title: row.title, selectedAngle: row.selectedAngle, familyLabel: row.familyLabel,
    scopeLabel: row.scopeLabel, coreConflict: row.coreConflict, strongScene: row.strongScene,
    stakes: row.stakes ?? null, packagingSeed: row.packagingSeed,
    canonicalQuotesJson: json(row.canonicalQuotesJson ?? []),
    canonicalQuoteIntentsJson: json(row.canonicalQuoteIntentsJson ?? []),
    durationBandJson: json(row.durationBandJson), narrativeTensionMapJson: json(row.narrativeTensionMapJson),
    mustIncludeBeatsJson: json(row.mustIncludeBeatsJson ?? []),
    forbiddenExpansionsJson: json(row.forbiddenExpansionsJson ?? []), riskHintsJson: json(row.riskHintsJson ?? []),
    sourceAnchorRefsJson: json(row.sourceAnchorRefsJson ?? []), ambiguityNotesJson: json(row.ambiguityNotesJson ?? []),
    createdAt: date(row.createdAt),
  } }));

  const projectIds = new Set(collections.projects.map(([id]) => id));
  const candidateWinners = new Map<string, { id: string; createdAt: number }>();
  for (const [id, value] of collections.candidateCache) {
    const row = record(value);
    if (!row.projectId || !row.fingerprint || !projectIds.has(row.projectId)) continue;
    const key = `${row.projectId}\u0000${row.fingerprint}`;
    const createdAt = date(row.createdAt).getTime();
    const current = candidateWinners.get(key);
    if (!current || createdAt > current.createdAt) candidateWinners.set(key, { id, createdAt });
  }
  for (const [id, value] of collections.candidateCache) {
    const row = record(value);
    if (row.projectId && !projectIds.has(row.projectId)) {
      repairs.push({ code: "orphan_candidate_cache_skipped", recordId: id, detail: `projectId=${row.projectId}` });
      continue;
    }
    const candidateKey = row.projectId && row.fingerprint ? `${row.projectId}\u0000${row.fingerprint}` : null;
    if (candidateKey && candidateWinners.get(candidateKey)?.id !== id) {
      repairs.push({
        code: "duplicate_candidate_cache_skipped",
        recordId: id,
        detail: `keptRecordId=${candidateWinners.get(candidateKey)?.id ?? "missing"}`,
      });
      continue;
    }
    await transaction.recommendationCandidateCache.create({ data: {
      id, projectId: row.projectId ?? null, eventRegistryEntryId: row.eventRegistryEntryId ?? null,
      eventIdentity: row.eventIdentity ?? null, fingerprint: row.fingerprint, oneLineAngle: row.oneLineAngle,
      familyLabel: row.familyLabel, scopeLabel: row.scopeLabel, viralRubricJson: json(row.viralRubricJson),
      estimatedDurationBandJson: json(row.estimatedDurationBandJson), strongScene: row.strongScene,
      coreConflict: row.coreConflict, mustCoverPreviewJson: json(row.mustCoverPreviewJson ?? []),
      createdAt: date(row.createdAt),
    } });
  }

  await createEach(collections.scriptRecords, (id, row) => transaction.scriptRecord.create({ data: {
    id, projectId: row.projectId, topicPackageId: row.topicPackageId, scriptText: row.scriptText,
    openingSpan: row.openingSpan, endingSpan: row.endingSpan, estimatedDurationSec: row.estimatedDurationSec,
    beatTraceJson: json(row.beatTraceJson ?? []), quoteTraceJson: json(row.quoteTraceJson ?? []),
    reviewStatus: row.reviewStatus, validationResultJson: nullableJson(row.validationResultJson),
    semanticReviewResultJson: nullableJson(row.semanticReviewResultJson), executionStateJson: nullableJson(row.executionStateJson),
    graphTraceSummaryJson: nullableJson(row.graphTraceSummaryJson), runtimeDiagnosticsJson: nullableJson(row.runtimeDiagnosticsJson),
    createdAt: date(row.createdAt),
  } }));

  await createEach(collections.storyboardRecords, (id, row) => transaction.storyboardRecord.create({ data: {
    id, projectId: row.projectId, topicPackageId: row.topicPackageId, scriptRecordId: row.scriptRecordId,
    planJson: json(row.planJson), validationResultJson: json(row.validationResultJson),
    executionStateJson: nullableJson(row.executionStateJson), graphTraceSummaryJson: nullableJson(row.graphTraceSummaryJson),
    runtimeDiagnosticsJson: nullableJson(row.runtimeDiagnosticsJson), createdAt: date(row.createdAt),
  } }));

  await createEach(collections.assetPlanRecords, (id, row) => transaction.assetPlanRecord.create({ data: {
    id, projectId: row.projectId, topicPackageId: row.topicPackageId, scriptRecordId: row.scriptRecordId,
    storyboardRecordId: row.storyboardRecordId, planJson: json(row.planJson), validationResultJson: json(row.validationResultJson),
    executionStateJson: json(row.executionStateJson), graphTraceSummaryJson: nullableJson(row.graphTraceSummaryJson),
    runtimeDiagnosticsJson: nullableJson(row.runtimeDiagnosticsJson), createdAt: date(row.createdAt),
  } }));

  await createEach(collections.assetManifestRecords, (id, row) => transaction.assetManifestRecord.create({ data: {
    id, projectId: row.projectId, topicPackageId: row.topicPackageId, scriptRecordId: row.scriptRecordId,
    storyboardRecordId: row.storyboardRecordId, assetPlanRecordId: row.assetPlanRecordId,
    manifestJson: json(row.manifestJson), validationResultJson: json(row.validationResultJson),
    executionStateJson: nullableJson(row.executionStateJson), graphTraceSummaryJson: nullableJson(row.graphTraceSummaryJson),
    runtimeDiagnosticsJson: nullableJson(row.runtimeDiagnosticsJson), createdAt: date(row.createdAt),
  } }));

  await createEach(collections.composeRecords, (id, row) => transaction.composeRecord.create({ data: {
    id, projectId: row.projectId, assetManifestRecordId: row.assetManifestRecordId,
    timelineJson: json(row.timelineJson), validationResultJson: json(row.validationResultJson),
    executionStateJson: nullableJson(row.executionStateJson), graphTraceSummaryJson: nullableJson(row.graphTraceSummaryJson),
    runtimeDiagnosticsJson: nullableJson(row.runtimeDiagnosticsJson), createdAt: date(row.createdAt),
  } }));

  await createEach(collections.renderJobRecords, (id, row) => transaction.renderJobRecord.create({ data: {
    id, projectId: row.projectId, composeRecordId: row.composeRecordId,
    assetManifestRecordId: row.assetManifestRecordId, status: row.status, profileJson: json(row.profileJson),
    outputArtifactJson: nullableJson(row.outputArtifactJson), validationResultJson: json(row.validationResultJson),
    executionStateJson: nullableJson(row.executionStateJson), graphTraceSummaryJson: nullableJson(row.graphTraceSummaryJson),
    runtimeDiagnosticsJson: nullableJson(row.runtimeDiagnosticsJson), createdAt: date(row.createdAt), updatedAt: date(row.updatedAt),
  } }));

  await createEach(collections.publishPackageRecords, (id, row) => transaction.publishPackageRecord.create({ data: {
    id, projectId: row.projectId, renderJobRecordId: row.renderJobRecordId, topicPackageId: row.topicPackageId,
    scriptRecordId: row.scriptRecordId, storyboardRecordId: row.storyboardRecordId,
    assetManifestRecordId: row.assetManifestRecordId, packageJson: json(row.packageJson),
    validationResultJson: nullableJson(row.validationResultJson), executionStateJson: nullableJson(row.executionStateJson),
    createdAt: date(row.createdAt), updatedAt: date(row.updatedAt),
  } }));

  await createEach(collections.assetProviderJobRecords, (id, row) => transaction.assetProviderJobRecord.create({ data: {
    id, assetManifestRecordId: row.assetManifestRecordId, assetRunId: row.assetRunId,
    executionId: row.executionId, taskId: row.taskId, providerType: row.providerType,
    providerName: row.providerName, providerJobId: row.providerJobId ?? null, status: row.status,
    attemptCount: row.attemptCount, rawRequestJson: nullableJson(row.rawRequestJson), rawResponseJson: nullableJson(row.rawResponseJson),
    errorCode: row.errorCode ?? null, errorMessage: row.errorMessage ?? null,
    submittedAt: row.submittedAt ? date(row.submittedAt) : null, lastPolledAt: row.lastPolledAt ? date(row.lastPolledAt) : null,
    completedAt: row.completedAt ? date(row.completedAt) : null, createdAt: date(row.createdAt), updatedAt: date(row.updatedAt),
  } }));

  for (const [projectId, value] of collections.recommendationRounds) {
    if (!Array.isArray(value)) throw new Error("migration_invalid_recommendation_rounds");
    for (let index = 0; index < value.length; index += 1) {
      const round = record(value[index]);
      const candidates = Array.isArray(round.candidates) ? round.candidates.map(record) : [];
      await transaction.recommendationRound.create({ data: {
        projectId, roundIndex: index + 1, createdAt: date(round.createdAt),
        exposures: { create: candidates.map((candidate) => ({
          eventRegistryEntryId: candidate.eventRegistryEntryId ?? null,
          eventIdentity: candidate.eventIdentity ?? null, title: candidate.title ?? null,
          fingerprint: candidate.fingerprint, selectedAt: date(candidate.createdAt),
        })) },
      } });
    }
  }

  const ids = {
    topic: new Set(collections.topicPackages.map(([id]) => id)), script: new Set(collections.scriptRecords.map(([id]) => id)),
    storyboard: new Set(collections.storyboardRecords.map(([id]) => id)), assetPlan: new Set(collections.assetPlanRecords.map(([id]) => id)),
    assetManifest: new Set(collections.assetManifestRecords.map(([id]) => id)), compose: new Set(collections.composeRecords.map(([id]) => id)),
    render: new Set(collections.renderJobRecords.map(([id]) => id)), publish: new Set(collections.publishPackageRecords.map(([id]) => id)),
  };
  for (const [id, value] of collections.projects) {
    const row = record(value);
    let activePublishPackageId = row.activePublishPackageRecordId ?? null;
    if (activePublishPackageId && !ids.publish.has(activePublishPackageId)) {
      repairs.push({ code: "missing_active_publish_cleared", recordId: id, detail: `activePublishPackageRecordId=${activePublishPackageId}` });
      activePublishPackageId = null;
    }
    await transaction.project.update({ where: { id }, data: {
      activeTopicPackageId: row.activeTopicPackageId ?? null, activeScriptRecordId: row.activeScriptRecordId ?? null,
      activeStoryboardRecordId: row.activeStoryboardRecordId ?? null, activeAssetPlanRecordId: row.activeAssetPlanRecordId ?? null,
      activeAssetManifestRecordId: row.activeAssetManifestRecordId ?? null, activeComposeRecordId: row.activeComposeRecordId ?? null,
      activeRenderJobRecordId: row.activeRenderJobRecordId ?? null,
      activePublishPackageRecordId: activePublishPackageId,
    } });
  }
}

export async function importV1Snapshot(
  client: AppPrismaClient,
  options: ImportV1SnapshotOptions,
): Promise<ImportV1SnapshotResult> {
  const inspection = inspectV1Snapshot(options.sourcePath);
  if (!inspection.canImport && !canRepairInspection(options, inspection.issues)) {
    throw new Error(`migration_inspection_failed:${inspection.issues.map((issue) => issue.code).join(",")}`);
  }
  const existing = await client.dataMigrationRun.findUnique({ where: { sourceSha256: inspection.sourceSha256 } });
  if (existing?.status === "completed") {
    const report = record(existing.reportJson);
    return { status: "already_applied", sourceSha256: inspection.sourceSha256, repairs: (report.repairs ?? []) as V1ImportRepair[] };
  }
  const source = readLegacySnapshot(options.sourcePath);
  const repairs: V1ImportRepair[] = [];
  await client.$transaction(async (transaction) => {
    await importCoreCollections(transaction, source.document.collections, options, repairs);
    await transaction.dataMigrationRun.create({ data: {
      sourceSha256: source.sourceSha256, sourceVersion: source.document.version, status: "completed",
      reportJson: json({ counts: inspection.counts, repairs, sourcePath: source.sourcePath }),
      startedAt: new Date(), completedAt: new Date(),
    } });
  });
  return { status: "completed", sourceSha256: source.sourceSha256, repairs };
}
