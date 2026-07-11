import { existsSync } from "node:fs";

import type { AppPrismaClient } from "../prisma-client.types.js";
import { readLegacySnapshot } from "../legacy-snapshot-reader.js";

export interface LegacyImportVerification {
  ok: boolean;
  sourceSha256: string;
  danglingActiveReferences: Array<{ projectId: string; field: string; recordId: string }>;
  activeReferenceIssues: Array<{
    projectId: string;
    field: string;
    recordId: string;
    reason: "missing" | "project_mismatch";
  }>;
  activeReferencesChecked: number;
  countMismatches: Array<{ collection: string; expected: number; actual: number }>;
  expectedProjectIds: string[];
  importedProjectIds: string[];
  projectIdMismatches: string[];
  storageChecks: Array<{
    projectId: string;
    storageKey: string | null;
    sourceDirectory: string | null;
    exists: boolean;
  }>;
}

export async function verifyLegacyImport(client: AppPrismaClient, sourcePath: string): Promise<LegacyImportVerification> {
  const source = readLegacySnapshot(sourcePath);
  const migration = await client.dataMigrationRun.findUnique({ where: { sourceSha256: source.sourceSha256 } });
  if (!migration || !["imported", "verification_failed", "verified", "activated"].includes(migration.status)) {
    return {
      ok: false,
      sourceSha256: source.sourceSha256,
      danglingActiveReferences: [],
      activeReferenceIssues: [],
      activeReferencesChecked: 0,
      countMismatches: [],
      expectedProjectIds: [],
      importedProjectIds: [],
      projectIdMismatches: [],
      storageChecks: [],
    };
  }
  const report = migration.reportJson && typeof migration.reportJson === "object" && !Array.isArray(migration.reportJson)
    ? migration.reportJson as Record<string, any>
    : {};
  const repairs = Array.isArray(report.repairs) ? report.repairs as Array<{ code?: string }> : [];
  const skippedCandidateCount = repairs.filter((repair) => (
    repair.code === "orphan_candidate_cache_skipped" || repair.code === "duplicate_candidate_cache_skipped"
  )).length;
  const recommendationRoundCount = source.document.collections.recommendationRounds.reduce((total, [, value]) => (
    total + (Array.isArray(value) ? value.length : 0)
  ), 0);
  const recommendationExposureCount = source.document.collections.recommendationRounds.reduce((total, [, value]) => (
    total + (Array.isArray(value) ? value.reduce((roundTotal, round) => {
      if (!round || typeof round !== "object" || Array.isArray(round)) return roundTotal;
      const candidates = (round as Record<string, unknown>).candidates;
      return roundTotal + (Array.isArray(candidates) ? candidates.length : 0);
    }, 0) : 0)
  ), 0);
  const expectedCounts: Record<string, number> = {
    projects: source.document.collections.projects.length,
    events: source.document.collections.events.length,
    topicPackages: source.document.collections.topicPackages.length,
    candidateCache: source.document.collections.candidateCache.length - skippedCandidateCount,
    scriptRecords: source.document.collections.scriptRecords.length,
    storyboardRecords: source.document.collections.storyboardRecords.length,
    assetPlanRecords: source.document.collections.assetPlanRecords.length,
    assetManifestRecords: source.document.collections.assetManifestRecords.length,
    composeRecords: source.document.collections.composeRecords.length,
    renderJobRecords: source.document.collections.renderJobRecords.length,
    publishPackageRecords: source.document.collections.publishPackageRecords.length,
    assetProviderJobRecords: source.document.collections.assetProviderJobRecords.length,
    recommendationRounds: recommendationRoundCount,
    recommendationExposures: recommendationExposureCount,
  };
  const actualCountValues = await Promise.all([
    client.project.count(), client.eventRegistryEntry.count(), client.topicPackage.count(),
    client.recommendationCandidateCache.count(), client.scriptRecord.count(), client.storyboardRecord.count(),
    client.assetPlanRecord.count(), client.assetManifestRecord.count(), client.composeRecord.count(),
    client.renderJobRecord.count(), client.publishPackageRecord.count(), client.assetProviderJobRecord.count(),
    client.recommendationRound.count(), client.recommendationExposure.count(),
  ]);
  const actualCounts = Object.fromEntries(Object.keys(expectedCounts).map((key, index) => [key, actualCountValues[index]]));
  const countMismatches = Object.entries(expectedCounts)
    .filter(([key, expected]) => actualCounts[key] !== expected)
    .map(([collection, expected]) => ({ collection, expected, actual: actualCounts[collection] ?? -1 }));
  const projects = await client.project.findMany();
  const targetIds = {
    activeTopicPackageId: new Map((await client.topicPackage.findMany({ select: { id: true, projectId: true } })).map((row) => [row.id, row.projectId])),
    activeScriptRecordId: new Map((await client.scriptRecord.findMany({ select: { id: true, projectId: true } })).map((row) => [row.id, row.projectId])),
    activeStoryboardRecordId: new Map((await client.storyboardRecord.findMany({ select: { id: true, projectId: true } })).map((row) => [row.id, row.projectId])),
    activeAssetPlanRecordId: new Map((await client.assetPlanRecord.findMany({ select: { id: true, projectId: true } })).map((row) => [row.id, row.projectId])),
    activeAssetManifestRecordId: new Map((await client.assetManifestRecord.findMany({ select: { id: true, projectId: true } })).map((row) => [row.id, row.projectId])),
    activeComposeRecordId: new Map((await client.composeRecord.findMany({ select: { id: true, projectId: true } })).map((row) => [row.id, row.projectId])),
    activeRenderJobRecordId: new Map((await client.renderJobRecord.findMany({ select: { id: true, projectId: true } })).map((row) => [row.id, row.projectId])),
    activePublishPackageRecordId: new Map((await client.publishPackageRecord.findMany({ select: { id: true, projectId: true } })).map((row) => [row.id, row.projectId])),
  };
  const danglingActiveReferences: LegacyImportVerification["danglingActiveReferences"] = [];
  const activeReferenceIssues: LegacyImportVerification["activeReferenceIssues"] = [];
  let activeReferencesChecked = 0;
  for (const project of projects) {
    for (const [field, ids] of Object.entries(targetIds)) {
      const recordId = project[field as keyof typeof project];
      if (typeof recordId !== "string") continue;
      activeReferencesChecked += 1;
      const targetProjectId = ids.get(recordId);
      if (!targetProjectId) {
        danglingActiveReferences.push({ projectId: project.id, field, recordId });
        activeReferenceIssues.push({ projectId: project.id, field, recordId, reason: "missing" });
      } else if (targetProjectId !== project.id) {
        activeReferenceIssues.push({ projectId: project.id, field, recordId, reason: "project_mismatch" });
      }
    }
  }
  const expectedProjectIds = source.document.collections.projects.map(([id]) => id).sort();
  const importedProjectIds = projects.map((project) => project.id).sort();
  const projectIdMismatches = [
    ...expectedProjectIds.filter((id) => !importedProjectIds.includes(id)).map((id) => `missing:${id}`),
    ...importedProjectIds.filter((id) => !expectedProjectIds.includes(id)).map((id) => `unexpected:${id}`),
  ];
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const storageChecks = source.document.collections.projects.map(([projectId, value]) => {
    const sourceProject = value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
    const sourceDirectory = typeof sourceProject.storageRootDir === "string" ? sourceProject.storageRootDir : null;
    return {
      projectId,
      storageKey: projectById.get(projectId)?.storageKey ?? null,
      sourceDirectory,
      exists: sourceDirectory !== null && existsSync(sourceDirectory),
    };
  });
  const storageValid = storageChecks.every((check) => check.storageKey && check.exists);
  return {
    ok: activeReferenceIssues.length === 0
      && countMismatches.length === 0
      && projectIdMismatches.length === 0
      && storageValid,
    sourceSha256: source.sourceSha256,
    danglingActiveReferences,
    activeReferenceIssues,
    activeReferencesChecked,
    countMismatches,
    expectedProjectIds,
    importedProjectIds,
    projectIdMismatches,
    storageChecks,
  };
}
