import { Prisma } from "../../generated/prisma/client.js";

import type { AppPrismaClient, AppPrismaTransactionClient } from "../prisma-client.types.js";
import { readLegacySnapshot, type LegacySnapshotEntry } from "../legacy-snapshot-reader.js";
import { inspectLegacySnapshot } from "./inspect-legacy-snapshot.js";
import { verifyLegacyImport } from "./verify-legacy-import.js";

export type LegacyImportRepairPolicy = "repair_known_safe_cache_and_active_publish";

export interface LegacyImportRepair {
  code: "orphan_candidate_cache_skipped" | "duplicate_candidate_cache_skipped" | "missing_active_publish_cleared";
  recordId: string;
  detail: string;
}

export interface ImportLegacySnapshotOptions {
  sourcePath: string;
  defaultOwnerId: string;
  repairPolicy?: LegacyImportRepairPolicy;
}

export interface ImportLegacySnapshotResult {
  status: "verified" | "already_applied";
  sourceSha256: string;
  repairs: LegacyImportRepair[];
}

export type LegacyMigrationStatus =
  | "importing"
  | "imported"
  | "verified"
  | "verification_failed"
  | "import_failed"
  | "activated";

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

function canRepairInspection(options: ImportLegacySnapshotOptions, issues: ReturnType<typeof inspectLegacySnapshot>["issues"]): boolean {
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
  options: ImportLegacySnapshotOptions,
  repairs: LegacyImportRepair[],
): Promise<void> {
  await createEach(collections.events, (id, row) => transaction.eventRegistryEntry.create({ data: {
    id, canonicalName: row.canonicalName, aliasesJson: json(row.aliases),
    canonicalQuotesJson: json(row.canonicalQuotesJson ?? []),
    canonicalQuoteIntentsJson: json(row.canonicalQuoteIntentsJson ?? []),
    sourceType: row.sourceType, isProvisional: Boolean(row.isProvisional),
    createdAt: date(row.createdAt), updatedAt: date(row.updatedAt),
  } }));

  await createEach(collections.projects, (id, row) => transaction.project.create({ data: {
    id, ownerId: options.defaultOwnerId, createdById: options.defaultOwnerId, name: row.name, status: row.status,
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function migrationReport(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function reportVerificationOk(report: UnknownRecord): boolean {
  const verification = migrationReport(report.verification);
  return verification.ok === true;
}

async function assertQualifiedOwner(client: AppPrismaClient, ownerId: string): Promise<void> {
  const owner = await client.user.findUnique({ where: { id: ownerId } });
  if (!owner || owner.role !== "ADMIN" || owner.status !== "ACTIVE") {
    throw new Error("migration_owner_not_qualified");
  }
}

async function targetBusinessCounts(client: AppPrismaClient): Promise<Record<string, number>> {
  const values = await Promise.all([
    client.project.count(),
    client.eventRegistryEntry.count(),
    client.topicPackage.count(),
    client.recommendationCandidateCache.count(),
    client.scriptRecord.count(),
    client.storyboardRecord.count(),
    client.assetPlanRecord.count(),
    client.assetManifestRecord.count(),
    client.composeRecord.count(),
    client.renderJobRecord.count(),
    client.publishPackageRecord.count(),
    client.assetProviderJobRecord.count(),
    client.recommendationRound.count(),
    client.recommendationExposure.count(),
  ]);
  const names = [
    "projects",
    "events",
    "topicPackages",
    "candidateCache",
    "scriptRecords",
    "storyboardRecords",
    "assetPlanRecords",
    "assetManifestRecords",
    "composeRecords",
    "renderJobRecords",
    "publishPackageRecords",
    "assetProviderJobRecords",
    "recommendationRounds",
    "recommendationExposures",
  ];
  return Object.fromEntries(names.map((name, index) => [name, values[index]]));
}

async function assertEmptyTarget(client: AppPrismaClient): Promise<void> {
  const counts = await targetBusinessCounts(client);
  const nonEmpty = Object.entries(counts).filter(([, count]) => count > 0);
  if (nonEmpty.length > 0) {
    throw new Error(`migration_target_not_empty:${nonEmpty.map(([name, count]) => `${name}=${count}`).join(",")}`);
  }
}

async function finalizeVerification(
  client: AppPrismaClient,
  sourcePath: string,
  sourceSha256: string,
): Promise<ImportLegacySnapshotResult> {
  const existing = await client.dataMigrationRun.findUniqueOrThrow({ where: { sourceSha256 } });
  const report = migrationReport(existing.reportJson);
  try {
    const verification = await verifyLegacyImport(client, sourcePath);
    const status: LegacyMigrationStatus = verification.ok ? "verified" : "verification_failed";
    await client.dataMigrationRun.update({
      where: { sourceSha256 },
      data: {
        status,
        reportJson: json({ ...report, verification }),
        completedAt: verification.ok ? new Date() : null,
      },
    });
    if (!verification.ok) throw new Error("migration_verification_failed");
    return {
      status: "verified",
      sourceSha256,
      repairs: Array.isArray(report.repairs) ? report.repairs as LegacyImportRepair[] : [],
    };
  } catch (error) {
    if (error instanceof Error && error.message === "migration_verification_failed") throw error;
    await client.dataMigrationRun.update({
      where: { sourceSha256 },
      data: {
        status: "verification_failed",
        reportJson: json({
          ...report,
          verificationError: { code: "verification_execution_failed", message: errorMessage(error) },
        }),
        completedAt: null,
      },
    });
    throw new Error("migration_verification_execution_failed");
  }
}

export async function importLegacySnapshot(
  client: AppPrismaClient,
  options: ImportLegacySnapshotOptions,
): Promise<ImportLegacySnapshotResult> {
  const inspection = inspectLegacySnapshot(options.sourcePath);
  if (!inspection.canImport && !canRepairInspection(options, inspection.issues)) {
    throw new Error(`migration_inspection_failed:${inspection.issues.map((issue) => issue.code).join(",")}`);
  }
  const existing = await client.dataMigrationRun.findUnique({ where: { sourceSha256: inspection.sourceSha256 } });
  if (existing) {
    const report = migrationReport(existing.reportJson);
    if (report.defaultOwnerId && report.defaultOwnerId !== options.defaultOwnerId) {
      throw new Error("migration_owner_mismatch");
    }
    if (existing.status === "activated") {
      if (!reportVerificationOk(report)) throw new Error("migration_activated_without_verification");
      return {
        status: "already_applied",
        sourceSha256: inspection.sourceSha256,
        repairs: Array.isArray(report.repairs) ? report.repairs as LegacyImportRepair[] : [],
      };
    }
    if (existing.status === "verified" && reportVerificationOk(report)) {
      return {
        status: "already_applied",
        sourceSha256: inspection.sourceSha256,
        repairs: Array.isArray(report.repairs) ? report.repairs as LegacyImportRepair[] : [],
      };
    }
    if (["imported", "verification_failed", "verified"].includes(existing.status)) {
      return finalizeVerification(client, options.sourcePath, inspection.sourceSha256);
    }
    if (!["importing", "import_failed"].includes(existing.status)) {
      throw new Error(`migration_status_unsupported:${existing.status}`);
    }
  }

  await assertQualifiedOwner(client, options.defaultOwnerId);
  await assertEmptyTarget(client);
  const source = readLegacySnapshot(options.sourcePath);
  const repairs: LegacyImportRepair[] = [];
  const previousReport = existing ? migrationReport(existing.reportJson) : {};
  const attempt = typeof previousReport.attempt === "number" ? previousReport.attempt + 1 : 1;
  const baseReport = {
    attempt,
    counts: inspection.counts,
    defaultOwnerId: options.defaultOwnerId,
    repairs: [],
    sourcePath: source.sourcePath,
  };
  if (existing) {
    await client.dataMigrationRun.update({
      where: { sourceSha256: source.sourceSha256 },
      data: { status: "importing", reportJson: json(baseReport), startedAt: new Date(), completedAt: null },
    });
  } else {
    await client.dataMigrationRun.create({ data: {
      sourceSha256: source.sourceSha256,
      sourceVersion: source.document.version,
      status: "importing",
      reportJson: json(baseReport),
      startedAt: new Date(),
    } });
  }
  try {
    await client.$transaction(async (transaction) => {
      await importCoreCollections(transaction, source.document.collections, options, repairs);
      await transaction.dataMigrationRun.update({
        where: { sourceSha256: source.sourceSha256 },
        data: {
          status: "imported",
          reportJson: json({ ...baseReport, repairs }),
        },
      });
    });
  } catch (error) {
    await client.dataMigrationRun.update({
      where: { sourceSha256: source.sourceSha256 },
      data: {
        status: "import_failed",
        reportJson: json({
          ...baseReport,
          attemptedRepairs: repairs,
          importError: { code: "import_transaction_failed", message: errorMessage(error) },
        }),
        completedAt: null,
      },
    });
    throw error;
  }
  return finalizeVerification(client, options.sourcePath, source.sourceSha256);
}
