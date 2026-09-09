import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyAllDatabaseMigrations } from "../db/migration-test-utils.js";
import { createPrismaClient } from "../../../backend/src/db/prisma-client.js";
import { PrismaFirstAggregateWriter } from "../../../backend/src/db/repositories/prisma-first-aggregate-writer.js";
import { PrismaSecondAggregateWriter } from "../../../backend/src/db/repositories/prisma-second-aggregate-writer.js";
import { buildApp } from "../../../backend/src/app.js";
import { buildTestAuth } from "../auth/test-utils.js";
import { buildPricingCatalogSeed } from "../../../backend/src/modules/generation-cost/pricing-catalog.seed.js";
import { seedGlobalVoiceProfiles } from "../../../backend/src/modules/assets/voice/voice-profile.repository.js";
import { prepareQuoteProject } from "../cost/quote-test-context.js";
import { saveScriptRecord } from "../../../backend/src/modules/script/script-record.repository.js";
import { findProjectConfigRecord, getProjectGenerationConfiguration } from "../../../backend/src/modules/generation-config/generation-config.repository.js";
import { previewNarrationModeUpgrade, upgradeProjectToNarrationFirst, NarrationUpgradeError } from "../../../backend/src/modules/narration/narration-mode-upgrade.service.js";
import { UpgradeNarrationModeRequest, StoryboardPlan } from "../../../shared/src/index.js";
import { getProjectSnapshot } from "../../../backend/src/modules/projects/project-snapshot.service.js";
import { NARRATION_FIRST_MODEL_POLICY_V1 as policy } from "../../../backend/src/modules/narration/narration-model-policy.js";
import type { DbClient } from "../../../backend/src/db/client.js";

const auth = buildTestAuth({ userId: "u" });
const downstreamPointers = ["activeStoryboardRecordId", "activeAssetPlanRecordId", "activeAssetManifestRecordId", "activeComposeRecordId", "activeRenderJobRecordId", "activePublishPackageRecordId"] as const;
const traces = ["latestStoryboardRunTraceJson", "latestAssetPlanRunTraceJson", "latestAssetsRunTraceJson", "latestComposeRunTraceJson", "latestRenderRunTraceJson"] as const;
const cleanups: (() => void)[] = [];
afterEach(() => { for (const c of cleanups.splice(0)) c(); });

const selection = () => ({ provider_model_id: policy.default_provider_model_id, voice_profile_id: policy.default_voice_profile_id, policy_version: policy.policy_version });
const legacyV1Plan = (scriptRecordId: string) => ({ plan_version: "storyboard_v1", source_script_record_id: scriptRecordId, source_topic_package_id: "topic", estimated_total_duration_sec: 2, segments: [], global_visual_notes: [] });

async function seedLegacyProject(db: DbClient, options?: { withConfig?: boolean }) {
  const project = await prepareQuoteProject(db, "u");
  const script = await saveScriptRecord(db, { projectId: project.id, topicPackageId: "topic", scriptText: "他打开城门。", openingSpan: "他打开城门。", endingSpan: "他打开城门。", estimatedDurationSec: 2, beatTraceJson: [], quoteTraceJson: [], reviewStatus: "pass", validationResultJson: null, semanticReviewResultJson: null, executionStateJson: null });
  project.activeScriptRecordId = script.id;
  for (const key of downstreamPointers) project[key] = "old";
  for (const key of traces) project[key] = { run: "old" };
  db.storyboardRecords.set("old", { id: "old", projectId: project.id, topicPackageId: "topic", scriptRecordId: script.id, planJson: legacyV1Plan(script.id), validationResultJson: { decision: "pass" }, executionStateJson: null, graphTraceSummaryJson: null, runtimeDiagnosticsJson: null, createdAt: new Date() });
  db.publishPackageRecords.set("old", { id: "old", projectId: project.id, createdAt: new Date() } as never);
  if (options?.withConfig !== false) await getProjectGenerationConfiguration(db, project.id);
  return { project, script };
}

function mapFixture(enabled = true) {
  const app = buildApp({ skipSnapshotLoad: true, narrationFirstEnabled: enabled });
  for (const m of buildPricingCatalogSeed({ llm: { mode: "stub" }, media: { deploymentScope: "cn-beijing" } })) app.db.providerModelCatalog.set(m.id, m);
  return { app, db: app.db };
}

function captureState(f: { db: DbClient; project: { narrationTimingMode?: string } }) {
  const pointers = Object.fromEntries(downstreamPointers.map(key => [key, f.project[key]]));
  return { mode: f.project.narrationTimingMode ?? "legacy_estimated", revision: findProjectConfigRecord(f.db, f.project.id)?.revision, pointers };
}
async function expectZeroWrite(f: { db: DbClient; project: Record<string, unknown> }, before: ReturnType<typeof captureState>, error: unknown, code: string, statusCode?: number) {
  expect(error).toBeInstanceOf(NarrationUpgradeError);
  const e = error as NarrationUpgradeError;
  expect(e.body.error).toBe(code);
  if (statusCode) expect(e.statusCode).toBe(statusCode);
  expect((f.project.narrationTimingMode ?? "legacy_estimated")).toBe(before.mode);
  expect(findProjectConfigRecord(f.db, f.project.id)?.revision).toBe(before.revision);
  for (const key of downstreamPointers) expect(f.project[key]).toBe(before.pointers[key]);
  expect([...f.db.auditLogs.values()].some(l => l.action === "narration_mode_upgraded")).toBe(false);
}

describe("Task11B 旧项目升级预览", () => {
  it("展示失效产物、模型音色变化与合格选项且零写入", async () => {
    const { app, db } = mapFixture();
    await seedGlobalVoiceProfiles(db);
    const { project } = await seedLegacyProject(db);
    const preview = await previewNarrationModeUpgrade(db, { projectId: project.id, user: { userId: "u", role: "USER" }, narrationFirstEnabled: true });
    expect(preview.narration_timing_mode).toBe("legacy_estimated");
    expect(preview.upgrade_available).toBe(true);
    expect(preview.policy_version).toBe(policy.policy_version);
    expect(preview.options.length).toBeGreaterThanOrEqual(1);
    expect(preview.recommended).toMatchObject({ provider_model_id: policy.default_provider_model_id });
    expect(preview.current_configuration).toMatchObject({ revision: 1, tts_mode: "auto", provider_model_id: null, voice_profile_id: null });
    expect(preview.script).toMatchObject({ active_script_record_id: project.activeScriptRecordId, estimated_duration_sec: 2 });
    expect(preview.affected).toEqual(expect.arrayContaining([
      { stage: "storyboard", record_id: "old" }, { stage: "publish", record_id: "old" },
    ]));
    expect(preview.affected).toHaveLength(6);
    expect(findProjectConfigRecord(db, project.id)?.revision).toBe(1);
    expect(app.db.auditLogs.size).toBe(0);
  });
  it("新模式项目不能预览升级", async () => {
    const { db } = mapFixture();
    const { project } = await seedLegacyProject(db);
    project.narrationTimingMode = "narration_first_v1";
    await expect(previewNarrationModeUpgrade(db, { projectId: project.id, user: { userId: "u", role: "USER" }, narrationFirstEnabled: true })).rejects.toMatchObject({ body: { error: "narration_upgrade_not_legacy" } });
  });
  it("发布开关关闭时预览标记不可升级且升级拒绝", async () => {
    const { app, db } = mapFixture(false);
    await seedGlobalVoiceProfiles(db);
    const { project } = await seedLegacyProject(db);
    const preview = await previewNarrationModeUpgrade(db, { projectId: project.id, user: { userId: "u", role: "USER" }, narrationFirstEnabled: false });
    expect(preview.upgrade_available).toBe(false);
    await expect(upgradeProjectToNarrationFirst(db, { projectId: project.id, user: { userId: "u", role: "USER" }, narrationFirstEnabled: false, request: { expected_active_script_record_id: project.activeScriptRecordId, expected_configuration_revision: 1, expected_downstream: { storyboard_record_id: "old", asset_plan_record_id: "old", asset_manifest_record_id: "old", compose_record_id: "old", render_job_record_id: "old", publish_package_record_id: "old" }, narration_selection: selection(), confirm_invalidation: true } })).rejects.toMatchObject({ body: { error: "narration_mode_unavailable" } });
    expect(findProjectConfigRecord(db, project.id)?.revision).toBe(1);
  });
});

describe("Task11B 旧项目升级事务（Map）", () => {
  it("确认升级切模式、固定配置、清下游、写升级事件且历史保留", async () => {
    const { app, db } = mapFixture();
    await seedGlobalVoiceProfiles(db);
    const { project, script } = await seedLegacyProject(db);
    const result = await upgradeProjectToNarrationFirst(db, { projectId: project.id, user: { userId: "u", role: "USER" }, narrationFirstEnabled: true, request: { expected_active_script_record_id: script.id, expected_configuration_revision: 1, expected_downstream: { storyboard_record_id: "old", asset_plan_record_id: "old", asset_manifest_record_id: "old", compose_record_id: "old", render_job_record_id: "old", publish_package_record_id: "old" }, narration_selection: selection(), confirm_invalidation: true } });
    expect(result).toMatchObject({ upgraded: true, configuration_revision: 2 });
    expect(project.narrationTimingMode).toBe("narration_first_v1");
    expect(project.activeNarrationRecordId ?? null).toBeNull();
    for (const key of downstreamPointers) expect(project[key]).toBeNull();
    for (const key of traces) expect(project[key]).toBeNull();
    expect(project.activeScriptRecordId).toBe(script.id);
    const record = findProjectConfigRecord(db, project.id)!;
    expect(record.revision).toBe(2);
    expect(record.configurationJson.capabilities["tts.synthesize"]).toEqual({ mode: "fixed", provider_model_id: policy.default_provider_model_id });
    expect(record.configurationJson.creative.voice_profile_id).toBe(policy.default_voice_profile_id);
    expect(record.configurationJson.narration_policy).toMatchObject({ policy_version: policy.policy_version, selection_reason: "explicit_selection" });
    expect(db.storyboardRecords.get("old")?.planJson).toBeTruthy();
    expect(db.publishPackageRecords.get("old")).toBeTruthy();
    const audit = [...db.auditLogs.values()].find(l => l.action === "narration_mode_upgraded");
    expect(audit).toBeTruthy();
    expect(audit!.metadataJson).toMatchObject({ from_mode: "legacy_estimated", to_mode: "narration_first_v1", policy_version: policy.policy_version });
  });
  it("来源变动返回409且整笔不写", async () => {
    const { app, db } = mapFixture();
    await seedGlobalVoiceProfiles(db);
    const { project, script } = await seedLegacyProject(db);
    project.activeScriptRecordId = "concurrent";
    const before = captureState({ db, project });
    try {
      await upgradeProjectToNarrationFirst(db, { projectId: project.id, user: { userId: "u", role: "USER" }, narrationFirstEnabled: true, request: { expected_active_script_record_id: script.id, expected_configuration_revision: 1, expected_downstream: { storyboard_record_id: "old", asset_plan_record_id: "old", asset_manifest_record_id: "old", compose_record_id: "old", render_job_record_id: "old", publish_package_record_id: "old" }, narration_selection: selection(), confirm_invalidation: true } });
      throw new Error("should_reject");
    } catch (error) {
      await expectZeroWrite({ db, project }, before, error, "narration_upgrade_conflict", 409);
    }
  });
  it("下游变动返回409且整笔不写", async () => {
    const { app, db } = mapFixture();
    await seedGlobalVoiceProfiles(db);
    const { project } = await seedLegacyProject(db);
    project.activeAssetPlanRecordId = "newer";
    const before = captureState({ db, project });
    try {
      await upgradeProjectToNarrationFirst(db, { projectId: project.id, user: { userId: "u", role: "USER" }, narrationFirstEnabled: true, request: { expected_active_script_record_id: project.activeScriptRecordId!, expected_configuration_revision: 1, expected_downstream: { storyboard_record_id: "old", asset_plan_record_id: "old", asset_manifest_record_id: "old", compose_record_id: "old", render_job_record_id: "old", publish_package_record_id: "old" }, narration_selection: selection(), confirm_invalidation: true } });
      throw new Error("should_reject");
    } catch (error) {
      await expectZeroWrite({ db, project }, before, error, "narration_upgrade_conflict", 409);
    }
  });
  it("配置并发冲突返回409且整笔不写", async () => {
    const { app, db } = mapFixture();
    await seedGlobalVoiceProfiles(db);
    const { project } = await seedLegacyProject(db);
    findProjectConfigRecord(db, project.id)!.revision = 2;
    const before = captureState({ db, project });
    try {
      await upgradeProjectToNarrationFirst(db, { projectId: project.id, user: { userId: "u", role: "USER" }, narrationFirstEnabled: true, request: { expected_active_script_record_id: project.activeScriptRecordId!, expected_configuration_revision: 1, expected_downstream: { storyboard_record_id: "old", asset_plan_record_id: "old", asset_manifest_record_id: "old", compose_record_id: "old", render_job_record_id: "old", publish_package_record_id: "old" }, narration_selection: selection(), confirm_invalidation: true } });
      throw new Error("should_reject");
    } catch (error) {
      await expectZeroWrite({ db, project }, before, error, "project_generation_configuration_revision_conflict", 409);
    }
  });
  it("不合格组合422、策略版本变动409，均零写入", async () => {
    const { app, db } = mapFixture();
    await seedGlobalVoiceProfiles(db);
    const { project } = await seedLegacyProject(db);
    const request = (sel: Record<string, string>) => ({ expected_active_script_record_id: project.activeScriptRecordId!, expected_configuration_revision: 1, expected_downstream: { storyboard_record_id: "old", asset_plan_record_id: "old", asset_manifest_record_id: "old", compose_record_id: "old", render_job_record_id: "old", publish_package_record_id: "old" }, narration_selection: sel, confirm_invalidation: true });
    try {
      await upgradeProjectToNarrationFirst(db, { projectId: project.id, user: { userId: "u", role: "USER" }, narrationFirstEnabled: true, request: request({ provider_model_id: "unknown-model", voice_profile_id: "unknown-voice", policy_version: policy.policy_version }) });
      throw new Error("should_reject");
    } catch (error) {
      expect((error as { body?: { error?: string } }).body?.error).toBe("narration_selection_required");
    }
    const before = captureState({ db, project });
    try {
      await upgradeProjectToNarrationFirst(db, { projectId: project.id, user: { userId: "u", role: "USER" }, narrationFirstEnabled: true, request: request({ ...selection(), policy_version: "narration-first-old-v0" }) });
      throw new Error("should_reject");
    } catch (error) {
      expect((error as { body?: { error?: string } }).body?.error).toBe("narration_policy_changed");
    }
    expect(findProjectConfigRecord(db, project.id)?.revision).toBe(1);
    expect(project.narrationTimingMode ?? "legacy_estimated").toBe("legacy_estimated");
  });
  it("新模式项目拒绝再次升级", async () => {
    const { app, db } = mapFixture();
    await seedGlobalVoiceProfiles(db);
    const { project } = await seedLegacyProject(db);
    project.narrationTimingMode = "narration_first_v1";
    const before = captureState({ db, project });
    try {
      await upgradeProjectToNarrationFirst(db, { projectId: project.id, user: { userId: "u", role: "USER" }, narrationFirstEnabled: true, request: { expected_active_script_record_id: project.activeScriptRecordId!, expected_configuration_revision: 1, expected_downstream: { storyboard_record_id: "old", asset_plan_record_id: "old", asset_manifest_record_id: "old", compose_record_id: "old", render_job_record_id: "old", publish_package_record_id: "old" }, narration_selection: selection(), confirm_invalidation: true } });
      throw new Error("should_reject");
    } catch (error) {
      await expectZeroWrite({ db, project }, before, error, "narration_upgrade_not_legacy", 409);
    }
  });
});

describe("Task11B HTTP 合同", () => {
  it("预览与升级走真实路由，匿名401、跨owner404、缺confirm_invalidation422", async () => {
    const { app, db } = mapFixture();
    await seedGlobalVoiceProfiles(db);
    const { project, script } = await seedLegacyProject(db);
    const anonymous = await app.inject({ method: "GET", url: `/api/projects/${project.id}/narration-mode/upgrade/preview` });
    expect(anonymous.statusCode).toBe(401);
    const foreign = await app.inject({ method: "POST", url: `/api/projects/${project.id}/narration-mode/upgrade`, auth: buildTestAuth({ userId: "mallory" }), payload: {} });
    expect(foreign.statusCode).toBe(404);
    const missingConfirm = await app.inject({ method: "POST", url: `/api/projects/${project.id}/narration-mode/upgrade`, auth, payload: { expected_active_script_record_id: script.id, expected_configuration_revision: 1, expected_downstream: { storyboard_record_id: "old", asset_plan_record_id: "old", asset_manifest_record_id: "old", compose_record_id: "old", render_job_record_id: "old", publish_package_record_id: "old" }, narration_selection: selection() } });
    expect(missingConfirm.statusCode).toBe(422);
    expect(findProjectConfigRecord(db, project.id)?.revision).toBe(1);
    const preview = await app.inject({ method: "GET", url: `/api/projects/${project.id}/narration-mode/upgrade/preview`, auth });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().affected).toHaveLength(6);
    const upgraded = await app.inject({ method: "POST", url: `/api/projects/${project.id}/narration-mode/upgrade`, auth, payload: { expected_active_script_record_id: script.id, expected_configuration_revision: 1, expected_downstream: { storyboard_record_id: "old", asset_plan_record_id: "old", asset_manifest_record_id: "old", compose_record_id: "old", render_job_record_id: "old", publish_package_record_id: "old" }, narration_selection: selection(), confirm_invalidation: true } });
    expect(upgraded.statusCode).toBe(200);
    expect(upgraded.json()).toMatchObject({ upgraded: true, configuration_revision: 2 });
    const snapshot = await app.inject({ method: "GET", url: `/api/projects/${project.id}`, auth });
    expect(snapshot.json().narration_timing_mode).toBe("narration_first_v1");
    expect(snapshot.json().narration_readiness).toMatchObject({ ready: false, reason: "script_not_confirmed" });
  });
});

async function sqliteFixture() {
  const { app, db } = mapFixture(true);
  await seedGlobalVoiceProfiles(db);
  const { project, script } = await seedLegacyProject(db);
  const directory = mkdtempSync(join(tmpdir(), "narration-task11b-"));
  const file = join(directory, "test.db");
  const sql = new Database(file);
  applyAllDatabaseMigrations(sql);
  sql.close();
  const client = await createPrismaClient(file);
  let closed = false;
  const close = async () => { if (closed) return; closed = true; await client.$disconnect(); rmSync(directory, { recursive: true, force: true }); };
  cleanups.push(close);
  await client.user.create({ data: { id: "u", username: "u", displayName: "u", passwordHash: "h" } });
  const first = await PrismaFirstAggregateWriter.create(client, "u");
  const second = new PrismaSecondAggregateWriter(client, "u");
  await client.project.create({ data: { id: project.id, ownerId: "u", createdById: "u", name: "Task11B", storageKey: project.id, storageDisplayName: "Task11B", status: "script_ready", narrationTimingMode: "legacy_estimated" } });
  await client.topicPackage.create({ data: { id: "topic", projectId: project.id, title: "城门", selectedAngle: "选择", familyLabel: "f", scopeLabel: "s", coreConflict: "守城", strongScene: "城门", packagingSeed: "选择", canonicalQuotesJson: [], canonicalQuoteIntentsJson: [], durationBandJson: { min_sec: 1, max_sec: 5 }, narrativeTensionMapJson: {}, mustIncludeBeatsJson: [], forbiddenExpansionsJson: [], riskHintsJson: [], sourceAnchorRefsJson: [], ambiguityNotesJson: [] } });
  await second.saveScript(script);
  await second.saveStoryboard(db.storyboardRecords.get("old")!);
  const config = findProjectConfigRecord(db, project.id)!;
  await client.projectGenerationConfiguration.create({ data: { ...config, configurationJson: config.configurationJson } });
  await client.project.update({ where: { id: project.id }, data: { activeScriptRecordId: script.id, activeTopicPackageId: "topic", activeStoryboardRecordId: "old", latestStoryboardRunTraceJson: { run: "old" }, latestAssetPlanRunTraceJson: { run: "old" }, latestAssetsRunTraceJson: { run: "old" }, latestComposeRunTraceJson: { run: "old" }, latestRenderRunTraceJson: { run: "old" } } });
  db.firstAggregateWriter = first;
  db.narrationPersistence.prismaClient = client;
  return { app, db, client, project, script, config, close, second };
}

const sqliteDownstream = { storyboard_record_id: "old", asset_plan_record_id: null, asset_manifest_record_id: null, compose_record_id: null, render_job_record_id: null, publish_package_record_id: null };
const upgradeRequest = (project: { activeScriptRecordId: string | null }) => ({ expected_active_script_record_id: project.activeScriptRecordId!, expected_configuration_revision: 1, expected_downstream: sqliteDownstream, narration_selection: selection(), confirm_invalidation: true as const });

describe("Task11B SQLite 单事务", () => {
  it("确认升级单事务生效且历史保留", async () => {
    const f = await sqliteFixture();
    try {
      const result = await upgradeProjectToNarrationFirst(f.db, { projectId: f.project.id, user: { userId: "u", role: "USER" }, narrationFirstEnabled: true, request: upgradeRequest(f.project) });
      expect(result).toMatchObject({ upgraded: true, configuration_revision: 2 });
      const row = await f.client.project.findUnique({ where: { id: f.project.id } });
      expect(row).toMatchObject({ narrationTimingMode: "narration_first_v1", activeScriptRecordId: f.script.id, activeNarrationRecordId: null, activeNarrationSubtitleRevisionId: null, activeStoryboardRecordId: null, activeAssetPlanRecordId: null, activeAssetManifestRecordId: null, activeComposeRecordId: null, activeRenderJobRecordId: null, activePublishPackageRecordId: null, latestStoryboardRunTraceJson: null });
      const config = await f.client.projectGenerationConfiguration.findUnique({ where: { projectId: f.project.id } });
      expect(config?.revision).toBe(2);
      expect((config?.configurationJson as { capabilities: { "tts.synthesize": { mode: string } } }).capabilities["tts.synthesize"].mode).toBe("fixed");
      expect(await f.client.auditLog.count({ where: { projectId: f.project.id, action: "narration_mode_upgraded" } })).toBe(1);
      expect(await f.client.storyboardRecord.count()).toBe(1);
      const snapshot = await getProjectSnapshot(f.db, f.project.id, f.app.topicCandidateStore, { demoMode: false });
      expect(snapshot?.narration_readiness).toMatchObject({ ready: false, reason: "script_not_confirmed" });
    } finally { await f.close(); }
  });
  it("来源并发变化整笔回滚", async () => {
    const f = await sqliteFixture();
    try {
      await f.second.saveScript({ ...f.script, id: "concurrent", scriptText: "他关闭城门！" });
      await f.client.project.update({ where: { id: f.project.id }, data: { activeScriptRecordId: "concurrent" } });
      await expect(upgradeProjectToNarrationFirst(f.db, { projectId: f.project.id, user: { userId: "u", role: "USER" }, narrationFirstEnabled: true, request: upgradeRequest(f.project) })).rejects.toMatchObject({ body: { error: "narration_upgrade_conflict" } });
      const row = await f.client.project.findUnique({ where: { id: f.project.id } });
      expect(row).toMatchObject({ narrationTimingMode: "legacy_estimated", activeStoryboardRecordId: "old" });
      expect(await f.client.projectGenerationConfiguration.findUnique({ where: { projectId: f.project.id } })).toMatchObject({ revision: 1 });
      expect(await f.client.auditLog.count({ where: { projectId: f.project.id, action: "narration_mode_upgraded" } })).toBe(0);
    } finally { await f.close(); }
  });
  it("配置并发变化整笔回滚", async () => {
    const f = await sqliteFixture();
    try {
      await f.client.projectGenerationConfiguration.updateMany({ data: { revision: 5 } });
      await expect(upgradeProjectToNarrationFirst(f.db, { projectId: f.project.id, user: { userId: "u", role: "USER" }, narrationFirstEnabled: true, request: upgradeRequest(f.project) })).rejects.toMatchObject({ body: { error: "project_generation_configuration_revision_conflict" } });
      expect(await f.client.projectGenerationConfiguration.findUnique({ where: { projectId: f.project.id } })).toMatchObject({ revision: 5 });
      const row = await f.client.project.findUnique({ where: { id: f.project.id } });
      expect(row).toMatchObject({ narrationTimingMode: "legacy_estimated", activeStoryboardRecordId: "old" });
      expect(await f.client.auditLog.count({ where: { projectId: f.project.id, action: "narration_mode_upgraded" } })).toBe(0);
    } finally { await f.close(); }
  });
});

describe("Task11B 无冻结配置的老项目", () => {
  it("预览按 revision 0 展示且严格零写入（不回填配置）", async () => {
    const { app, db } = mapFixture();
    await seedGlobalVoiceProfiles(db);
    const { project } = await seedLegacyProject(db, { withConfig: false });
    const seeded = findProjectConfigRecord(db, project.id);
    if (seeded) db.projectGenerationConfigurations.delete(seeded.id);
    const preview = await previewNarrationModeUpgrade(db, { projectId: project.id, user: { userId: "u", role: "USER" }, narrationFirstEnabled: true });
    expect(preview.current_configuration).toMatchObject({ revision: 0, tts_mode: "auto", provider_model_id: null, voice_profile_id: null });
    expect(findProjectConfigRecord(db, project.id)).toBeNull();
    expect(db.auditLogs.size).toBe(0);
  });
  it("缺配置项目确认升级在事务内创建 revision 1 固定配置", async () => {
    const { app, db } = mapFixture();
    await seedGlobalVoiceProfiles(db);
    const { project } = await seedLegacyProject(db, { withConfig: false });
    const seeded = findProjectConfigRecord(db, project.id);
    if (seeded) db.projectGenerationConfigurations.delete(seeded.id);
    const result = await upgradeProjectToNarrationFirst(db, { projectId: project.id, user: { userId: "u", role: "USER" }, narrationFirstEnabled: true, request: { expected_active_script_record_id: project.activeScriptRecordId!, expected_configuration_revision: 0, expected_downstream: { storyboard_record_id: "old", asset_plan_record_id: "old", asset_manifest_record_id: "old", compose_record_id: "old", render_job_record_id: "old", publish_package_record_id: "old" }, narration_selection: selection(), confirm_invalidation: true } });
    expect(result).toMatchObject({ upgraded: true, configuration_revision: 1 });
    const record = findProjectConfigRecord(db, project.id)!;
    expect(record.revision).toBe(1);
    expect(record.configurationJson.capabilities["tts.synthesize"]).toEqual({ mode: "fixed", provider_model_id: policy.default_provider_model_id });
    expect(project.narrationTimingMode).toBe("narration_first_v1");
    expect(db.publishPackageRecords.get("old")).toBeTruthy();
  });
  it("rev-0 且来源并发冲突时拒绝且配置仍缺失（零写入）", async () => {
    const { app, db } = mapFixture();
    await seedGlobalVoiceProfiles(db);
    const { project } = await seedLegacyProject(db, { withConfig: false });
    const seeded = findProjectConfigRecord(db, project.id);
    if (seeded) db.projectGenerationConfigurations.delete(seeded.id);
    const originalScriptId = project.activeScriptRecordId!;
    project.activeScriptRecordId = "concurrent";
    try {
      await upgradeProjectToNarrationFirst(db, { projectId: project.id, user: { userId: "u", role: "USER" }, narrationFirstEnabled: true, request: { expected_active_script_record_id: originalScriptId, expected_configuration_revision: 0, expected_downstream: { storyboard_record_id: "old", asset_plan_record_id: "old", asset_manifest_record_id: "old", compose_record_id: "old", render_job_record_id: "old", publish_package_record_id: "old" }, narration_selection: selection(), confirm_invalidation: true } });
      throw new Error("should_reject");
    } catch (error) {
      expect((error as { body?: { error?: string } }).body?.error).toBe("narration_upgrade_conflict");
    }
    expect(findProjectConfigRecord(db, project.id)).toBeNull();
    expect(project.narrationTimingMode ?? "legacy_estimated").toBe("legacy_estimated");
    expect(db.auditLogs.size).toBe(0);
  });
  it("预期 revision 0 但配置已存在时冲突零写入", async () => {
    const { app, db } = mapFixture();
    await seedGlobalVoiceProfiles(db);
    const { project } = await seedLegacyProject(db);
    const before = captureState({ db, project });
    try {
      await upgradeProjectToNarrationFirst(db, { projectId: project.id, user: { userId: "u", role: "USER" }, narrationFirstEnabled: true, request: { expected_active_script_record_id: project.activeScriptRecordId!, expected_configuration_revision: 0, expected_downstream: { storyboard_record_id: "old", asset_plan_record_id: "old", asset_manifest_record_id: "old", compose_record_id: "old", render_job_record_id: "old", publish_package_record_id: "old" }, narration_selection: selection(), confirm_invalidation: true } });
      throw new Error("should_reject");
    } catch (error) {
      await expectZeroWrite({ db, project }, before, error, "project_generation_configuration_revision_conflict", 409);
    }
  });
});

describe("Task11B v2 合同缺真实时间不回退 v1", () => {
  it("storyboard_v2 缺视觉区间被联合 schema 拒绝，不落入 v1", () => {
    const malformed = { ...legacyV1Plan("s"), plan_version: "storyboard_v2" };
    expect(StoryboardPlan.safeParse(malformed).success).toBe(false);
  });
  it("UpgradeNarrationModeRequest 要求 confirm_invalidation 严格为 true", () => {
    expect(UpgradeNarrationModeRequest.safeParse({ expected_active_script_record_id: "s", expected_configuration_revision: 1, expected_downstream: { storyboard_record_id: null, asset_plan_record_id: null, asset_manifest_record_id: null, compose_record_id: null, render_job_record_id: null, publish_package_record_id: null }, narration_selection: selection(), confirm_invalidation: false }).success).toBe(false);
  });
});
