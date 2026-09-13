import { afterEach, describe, expect, it, vi } from "vitest";
const scriptGraph = vi.hoisted(() => vi.fn());
vi.mock("../../../backend/src/runtime/orchestration/script-run-graph.js", () => ({ runScriptRunGraph: scriptGraph }));
import { runScriptGeneration } from "../../../backend/src/modules/script/script-run.service.js";
import { submitGenerationRun } from "../../../backend/src/modules/generation-run/submit-protocol.js";
import { createGenerationRunRepository } from "../../../backend/src/modules/generation-run/generation-run.repository.js";
import type { RouteContext } from "../../../backend/src/app.js";
const assetPlanner = vi.hoisted(() => vi.fn());
vi.mock("../../../backend/src/modules/asset-planning/asset-planning-generation.service.js", () => ({ generateAssetPlan: assetPlanner }));
import { runAssetPlanningGeneration } from "../../../backend/src/modules/asset-planning/asset-planning-run.service.js";
import { compileNarrationAssetPlan } from "../../../backend/src/modules/asset-planning/narration-reference-compiler.js";
const planner = vi.hoisted(() => vi.fn());
const segmentPlanner = vi.hoisted(() => vi.fn());
vi.mock("../../../backend/src/modules/storyboard/storyboard-generation.service.js", () => ({ generateStoryboardPlan: planner, regenerateSingleSegment: segmentPlanner }));
import { runStoryboardGeneration, runStoryboardSegmentRegeneration } from "../../../backend/src/modules/storyboard/storyboard-run.service.js";
const cleanup: Array<() => Promise<void> | void> = [];
afterEach(async () => { vi.restoreAllMocks(); assetPlanner.mockReset(); planner.mockReset(); segmentPlanner.mockReset(); scriptGraph.mockReset(); for (const close of cleanup.splice(0).reverse()) await close(); });
import { createDbClient } from "../../../backend/src/db/client.js";
import { createLegacyProject as createProject } from "../projects/legacy-project.fixture.js";
import { activateScriptRecord, saveScriptRecord } from "../../../backend/src/modules/script/script-record.repository.js";
import { DEFAULT_GENERATION_CONFIGURATION, hashProjectNarrationTtsSettings } from "../../../shared/src/index.js";
import { buildPricingCatalogSeed } from "../../../backend/src/modules/generation-cost/pricing-catalog.seed.js";
import { seedGlobalVoiceProfiles } from "../../../backend/src/modules/assets/voice/voice-profile.repository.js";
import { upsertProjectGenerationConfiguration } from "../../../backend/src/modules/generation-config/generation-config.repository.js";
import { NARRATION_FIRST_MODEL_POLICY_V1 as policy } from "../../../backend/src/modules/narration/narration-model-policy.js";
import { activateNarrationStoryboard, captureStoryboardNarrationSource, projectTtsHash } from "../../../backend/src/modules/narration/narration-invalidation.js";
import { narrationTextHash } from "../../../backend/src/modules/narration/narration-readiness.js";
import { NarrationRecord } from "../../../shared/src/index.js";
import { computeRunPayloadFingerprint } from "../../../backend/src/modules/generation-run/generation-run.service.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { Prisma } from "../../../backend/src/generated/prisma/client.js";
import { applyAllDatabaseMigrations } from "../db/migration-test-utils.js";
import { createPrismaClient } from "../../../backend/src/db/prisma-client.js";
import { PrismaFirstAggregateWriter } from "../../../backend/src/db/repositories/prisma-first-aggregate-writer.js";
import { PrismaSecondAggregateWriter } from "../../../backend/src/db/repositories/prisma-second-aggregate-writer.js";
import { NarrationRepository } from "../../../backend/src/modules/narration/narration.repository.js";
import { DEFAULT_SUBTITLE_STYLE } from "../../../shared/src/index.js";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { hashNarrationSettings, canonicalStringify } from "../../../shared/src/index.js";
import { normalizeNarrationTiming } from "../../../backend/src/modules/narration/narration-timing-normalizer.js";
import { NarrationBundleStorage } from "../../../backend/src/modules/narration/narration-bundle-storage.js";
import { projectStoryboardTiming } from "../../../backend/src/modules/storyboard/storyboard-timing-projector.js";
import { getProjectSnapshot } from "../../../backend/src/modules/projects/project-snapshot.service.js";

async function fixture() {
  const db = createDbClient();
  const project = await createProject(db, { name: "口播失效" });
  const storage = mkdtempSync(join(tmpdir(), "narration-task6-storage-"));
  project.storageRootDir = storage;
  cleanup.push(() => rmSync(storage, { recursive: true, force: true }));
  project.narrationTimingMode = "narration_first_v1";
  const input = { projectId: project.id, topicPackageId: "topic", scriptText: "他打开城门。", openingSpan: "他打开城门。", endingSpan: "他打开城门。", estimatedDurationSec: 2, beatTraceJson: [], quoteTraceJson: [], reviewStatus: "pass", validationResultJson: null, semanticReviewResultJson: null, executionStateJson: null };
  const script = await saveScriptRecord(db, input);
  project.activeScriptRecordId = script.id;
  project.activeNarrationRecordId = "narration";
  project.activeNarrationSubtitleRevisionId = "subtitle";
  for (const key of downstreamPointers) project[key] = "old";
  for (const key of traces) project[key] = { run: "old" };
  return { db, project, script, input };
}
const downstreamPointers = ["activeStoryboardRecordId", "activeAssetPlanRecordId", "activeAssetManifestRecordId", "activeComposeRecordId", "activeRenderJobRecordId", "activePublishPackageRecordId"] as const;
const traces = ["latestStoryboardRunTraceJson", "latestAssetPlanRunTraceJson", "latestAssetsRunTraceJson", "latestComposeRunTraceJson", "latestRenderRunTraceJson"] as const;

async function readyFixture() {
  const f = await fixture(), now = new Date().toISOString(), hash = "a".repeat(64);
  const config = [...f.db.projectGenerationConfigurations.values()][0].configurationJson;
  f.project.activeTopicPackageId = "topic";
  f.script.validationResultJson = { stage: "script_local_validation", decision: "pass", errors: [], warnings: [], metrics: {} };
  f.db.scriptConfirmations.set(f.script.id, { scriptRecordId: f.script.id, projectId: f.project.id, sourceTextSha256: narrationTextHash(f.script.scriptText), confirmedAt: new Date(), confirmedBy: f.project.ownerId });
  f.db.topicPackages.set("topic", { id: "topic", projectId: f.project.id, title: "城门", familyLabel: "君臣博弈型", scopeLabel: "城门", packagingSeed: "城门", mustIncludeBeatsJson: ["打开城门"], ambiguityNotesJson: [], selectedAngle: "打开城门", coreConflict: "守城选择", strongScene: "城门", forbiddenExpansionsJson: [], riskHintsJson: [], sourceAnchorRefsJson: ["三国志"], canonicalQuotesJson: [], narrativeTensionMapJson: { hook_claim: "打开城门", pressure_escalation: "敌军逼近", mid_reveal: "空城", peak_payoff: "撤退", ending_residue: "代价" }, durationBandJson: { min_sec: 1, max_sec: 5 } } as never);
  const ref = (file: string) => ({ uri: "narration-runs/run/" + file, sha256: hash });
  const record = NarrationRecord.parse({ schemaVersion: "narration_record_v1", id: "narration", projectId: f.project.id, scriptRecordId: f.script.id, generationRunId: "run", configurationSnapshotId: "snapshot", createdAt: now, updatedAt: now, sourceTextSha256: narrationTextHash(f.script.scriptText), spokenTextSha256: hash, settingsSha256: hash, sourceProjectTtsSettingsSha256: projectTtsHash(config), textMappingVersion: "narration-native-spans/v1", timingSource: "provider_native", providerTaskId: "task", providerRequestId: "request", status: "confirmed", errorCode: null, confirmedAt: now, confirmedBy: f.project.ownerId, acceptedDurationBandSnapshot: { minMs: 1000, maxMs: 5000 }, settings: { model: "qwen-audio-3.0-tts-plus", voice: "qwen-audio-3.0-tts-plus-longyimuling", region: "cn-beijing", protocol: "dashscope_ws", parametersVersion: "neutral-pcm24k-v1", tone: "neutral", rate: 1, pitch: 1, volume: 50, sampleRate: 24000, format: "pcm", textType: "PlainText", wordTimestampEnabled: true, enableSsml: false, seed: 0, inputMode: "natural_paragraphs_single_task" }, output: { audio: { ...ref("audio.wav"), sampleRate: 24000, channels: 1, bitDepth: 16, sampleCount: 48000 }, durationMs: 2000, nativeEvents: ref("native.json"), timingMap: ref("timing.json"), initialSubtitleRevisionId: "subtitle", validationReport: { status: "pass", validatorVersion: "v1", checkedAt: now, nativeTextCoverageComplete: true, nativeTimingValid: true, audioProbeValid: true, issues: [] } } });
  const timingMap = normalizeNarrationTiming({ sourceText: f.script.scriptText, audioHash: hash, durationMs: 2000, sentences: [{ providerSentenceIndex: 0, originalText: f.script.scriptText, normalizedText: f.script.scriptText, words: [{ text: f.script.scriptText, begin_index: 0, end_index: 1, begin_time: 0, end_time: 2000 }] }] });
  record.output!.timingMap.sha256 = narrationTextHash(canonicalStringify(timingMap));
  const narrationTiming = { timingMap, narrationReference: { narration_record_id: record.id, audio_hash: hash, timing_map_hash: record.output!.timingMap.sha256, duration_ms: 2000 } };
  // Task6来源/并发测试隔离磁盘层；Task8 bundle完整性由独立存储测试及下方故障入口覆盖。
  const timingRead = vi.spyOn(NarrationBundleStorage.prototype, "readFile").mockResolvedValue(Buffer.from(canonicalStringify(timingMap)));
  f.db.narrationRecords.set(record.id, record);
  const legacyPlan = { plan_version: "storyboard_v1", source_script_record_id: f.script.id, source_topic_package_id: "topic", estimated_total_duration_sec: 2, segments: [{ segment_id: "s", order: 0, script_excerpt: f.script.scriptText, start_hint_sec: 0, end_hint_sec: 2, narrative_role: "opening", visual_intent: "推开城门", scene_description: "守将推开城门", visual_elements: ["城门"], framing_hint: "medium", content_type: "live_action", motion_hint: "push_in", editing_hint: "single", on_screen_text: [], linked_beats: [], linked_quotes: [], risk_notes: [], api_video_suitability: "remotion_sufficient" }], global_visual_notes: [] };
  const plan = projectStoryboardTiming({ ...narrationTiming, plan: { ...legacyPlan, plan_version: "storyboard_v2", segments: legacyPlan.segments.map(s => ({ ...s, start_boundary_id: timingMap.boundaries[0]!.id, end_boundary_id: timingMap.boundaries.at(-1)!.id })) } });
  const state = await captureStoryboardNarrationSource(f.db, f.project.id, f.project.ownerId);
  f.db.storyboardRecords.set("old", { id: "old", projectId: f.project.id, topicPackageId: "topic", scriptRecordId: f.script.id, planJson: plan, validationResultJson: { decision: "pass" }, executionStateJson: { narration_source: state.identity }, graphTraceSummaryJson: null, runtimeDiagnosticsJson: null, createdAt: new Date() });
  return { ...f, plan, record, narrationTiming, timingRead };
}

async function sqliteFixture() {
  const f = await readyFixture(), directory = mkdtempSync(join(tmpdir(), "narration-task6-")), file = join(directory, "test.db");
  const sql = new Database(file); applyAllDatabaseMigrations(sql);
  const client = await createPrismaClient(file);
  let closed = false;
  const close = async () => { if (closed) return; closed = true; await client.$disconnect(); sql.close(); rmSync(directory, { recursive: true, force: true }); };
  cleanup.push(close);
  await client.user.create({ data: { id: f.project.ownerId, username: "owner", displayName: "owner", passwordHash: "hash" } });
  await client.project.create({ data: { id: f.project.id, ownerId: f.project.ownerId, createdById: f.project.ownerId, name: "Task6", storageKey: f.project.id, storageDisplayName: "Task6", status: "script_ready", narrationTimingMode: "narration_first_v1" } });
  await client.topicPackage.create({ data: { id: "topic", projectId: f.project.id, title: "城门", selectedAngle: "选择", familyLabel: "f", scopeLabel: "s", coreConflict: "守城", strongScene: "城门", packagingSeed: "选择", canonicalQuotesJson: [], canonicalQuoteIntentsJson: [], durationBandJson: { min_sec: 1, max_sec: 5 }, narrativeTensionMapJson: {}, mustIncludeBeatsJson: [], forbiddenExpansionsJson: [], riskHintsJson: [], sourceAnchorRefsJson: [], ambiguityNotesJson: [] } });
  const first = await PrismaFirstAggregateWriter.create(client, f.project.ownerId), second = new PrismaSecondAggregateWriter(client, f.project.ownerId);
  await second.saveScript(f.script);
  await client.project.update({ where: { id: f.project.id }, data: { activeTopicPackageId: "topic", activeScriptRecordId: f.script.id } });
  const config = [...f.db.projectGenerationConfigurations.values()][0];
  await client.projectGenerationConfiguration.create({ data: { ...config, configurationJson: config.configurationJson } });
  await client.scriptConfirmation.create({ data: f.db.scriptConfirmations.get(f.script.id)! });
  await client.runConfigurationSnapshot.create({ data: { id: "snapshot", projectId: f.project.id, stage: "script", operation: "script.narration.generate", runId: "run", projectConfigurationRevision: 1, schemaVersion: "run_configuration_snapshot_v1", configurationHash: "a".repeat(64), resolvedConfigurationJson: {}, resolutionTraceJson: [], pricingVersionSetJson: [] } });
  await client.generationRun.create({ data: { id: "run", projectId: f.project.id, operation: "script.narration.generate", idempotencyKey: "run", payloadFingerprint: "a".repeat(64), runConfigurationSnapshotId: "snapshot", dispatchPayloadJson: {}, status: "succeeded" } });
  f.db.firstAggregateWriter = first; f.db.secondAggregateWriter = second; f.db.narrationPersistence.prismaClient = client;
  const repo = new NarrationRepository(f.db), { record } = f;
  await repo.createCandidate(f.project.ownerId, { ...record, status: "generating", output: null, spokenTextSha256: null, confirmedAt: null, confirmedBy: null, acceptedDurationBandSnapshot: null });
  const ref = (file: string) => ({ uri: "narration-runs/run/" + file, sha256: "a".repeat(64) });
  await repo.saveReadyBundle(f.project.ownerId, { ...record, status: "ready", confirmedAt: null, confirmedBy: null, acceptedDurationBandSnapshot: null }, { id: "subtitle", projectId: f.project.id, narrationRecordId: "narration", audioHash: record.output!.audio.sha256, timingHash: record.output!.timingMap.sha256, subtitleSettingsSnapshotJson: { presetId: null, presetVersion: null, resolvedStyle: DEFAULT_SUBTITLE_STYLE, overrides: {}, lineBreak: { strategy: "punctuation_and_length", maxCharactersPerLine: 20, version: "v1" }, resolverVersion: "v1" }, subtitleSettingsHash: "a".repeat(64), builderVersion: "v1", srt: ref("captions.srt"), vtt: ref("captions.vtt"), createdAt: record.createdAt });
  await client.narrationRecord.update({ where: { id: record.id }, data: { status: "confirmed", confirmedAt: new Date(record.confirmedAt!), confirmedBy: record.confirmedBy, acceptedDurationBandSnapshotJson: record.acceptedDurationBandSnapshot! } });
  await second.saveStoryboard(f.db.storyboardRecords.get("old")!);
  await client.project.update({ where: { id: f.project.id }, data: { activeNarrationRecordId: record.id, activeNarrationSubtitleRevisionId: "subtitle", activeStoryboardRecordId: "old", latestStoryboardRunTraceJson: { run: "old" } } });
  return { ...f, client, first, second, sql, config, close };
}

describe("Task6 SQLite 事务与冷恢复", () => {
  it.each(["owner", "mode"])("配置在await期间%s变化，事务不能写入旧来源配置", async change => {
    const f = await sqliteFixture(); try {
      const audit = { actorUserId: f.project.ownerId, projectId: f.project.id, oldRevision: 1, newRevision: 2, diff: {}, expectedOwnerId: f.project.ownerId, expectedNarrationMode: "narration_first_v1" };
      if (change === "owner") {
        await f.client.user.create({ data: { id: "other", username: "other", displayName: "other", passwordHash: "hash" } });
        await f.client.project.update({ where: { id: f.project.id }, data: { ownerId: "other" } });
      } else await f.client.project.update({ where: { id: f.project.id }, data: { narrationTimingMode: "legacy_estimated" } });
      await expect(f.first.casUpsertProjectGenerationConfiguration({ ...f.config, revision: 2 }, 1, audit)).rejects.toThrow("narration_stale");
      expect((await f.client.projectGenerationConfiguration.findUnique({ where: { projectId: f.project.id } }))?.revision).toBe(1);
    } finally { await f.close(); }
  });
  it("recovered/reordered：冷实例忽略旧Map正文和配置，直接读数据库权威", async () => {
    const f = await sqliteFixture(); try {
      f.db.scriptRecords.set(f.script.id, { ...f.script, scriptText: "过期镜像" });
      f.db.projectGenerationConfigurations.clear();
      const cold = createDbClient(); cold.narrationPersistence.prismaClient = f.client;
      expect((await captureStoryboardNarrationSource(cold, f.project.id, f.project.ownerId)).identity?.sourceTextSha256).toBe(f.record.sourceTextSha256);
      expect((await captureStoryboardNarrationSource(f.db, f.project.id, f.project.ownerId)).identity?.sourceTextSha256).toBe(f.record.sourceTextSha256);
    } finally { await f.close(); }
  });
  it("激活分镜后内存Map项目指针同步（策略路由不再误报no_active_storyboard）", async () => {
    const f = await sqliteFixture(); try {
      const state = await captureStoryboardNarrationSource(f.db, f.project.id, f.project.ownerId);
      const newStoryboard = { ...f.db.storyboardRecords.get("old")!, id: "new-sb" };
      await activateNarrationStoryboard(f.db, f.project.ownerId, state.identity!, newStoryboard);
      // 数据库权威值
      expect((await f.client.project.findUnique({ where: { id: f.project.id } }))?.activeStoryboardRecordId).toBe("new-sb");
      // 本次修复点：内存 Map 的项目对象必须同步，读 Map 的路由依赖它
      expect(f.db.projects.get(f.project.id)?.activeStoryboardRecordId).toBe("new-sb");
      expect(f.db.projects.get(f.project.id)?.status).toBe("storyboard_ready");
    } finally { await f.close(); }
  });
  it("switched：active正文保存与口播失效同事务，历史及字幕保留", async () => {
    const f = await sqliteFixture(); try {
      await saveScriptRecord(f.db, { ...f.input, id: f.script.id, scriptText: "他关闭城门！" });
      expect(await f.client.project.findUnique({ where: { id: f.project.id } })).toMatchObject({ activeNarrationRecordId: null, activeNarrationSubtitleRevisionId: null, activeStoryboardRecordId: null, latestStoryboardRunTraceJson: null });
      expect(await f.client.narrationRecord.findUnique({ where: { id: "narration" } })).toMatchObject({ status: "stale" });
      expect(await f.client.narrationSubtitleRevision.count()).toBe(1);
      expect(await f.client.storyboardRecord.count()).toBe(1);
    } finally { await f.close(); }
  });
  it("partially_failed：失效写入后正文SQL失败，整个事务回滚", async () => {
    const f = await sqliteFixture(); try {
      f.sql.exec("CREATE TRIGGER task6_reject_script BEFORE UPDATE ON ScriptRecord BEGIN SELECT RAISE(ABORT, 'task6_script_write_failed'); END");
      expect(() => f.sql.prepare("UPDATE ScriptRecord SET scriptText=? WHERE id=?").run("新正文", f.script.id)).toThrow("task6_script_write_failed");
      const transaction = f.client.$transaction.bind(f.client);
      let observedInvalidation = false;
      vi.spyOn(f.client, "$transaction").mockImplementation(async action => transaction(async tx => {
        const upsert = tx.scriptRecord.upsert.bind(tx.scriptRecord);
        vi.spyOn(tx.scriptRecord, "upsert").mockImplementation(async args => {
          expect((await tx.project.findUnique({ where: { id: f.project.id } }))?.activeNarrationRecordId).toBeNull();
          expect((await tx.narrationRecord.findUnique({ where: { id: "narration" } }))?.status).toBe("stale");
          observedInvalidation = true;
          return upsert(args);
        });
        return (action as (tx: unknown) => Promise<unknown>)(tx);
      }) as never);
      await expect(saveScriptRecord(f.db, { ...f.input, id: f.script.id, scriptText: "新正文" })).rejects.toMatchObject({ code: "P2003" });
      expect(observedInvalidation).toBe(true);
      expect(await f.client.project.findUnique({ where: { id: f.project.id } })).toMatchObject({ activeNarrationRecordId: "narration", activeStoryboardRecordId: "old" });
      expect(await f.client.narrationRecord.findUnique({ where: { id: "narration" } })).toMatchObject({ status: "confirmed" });
      expect((await f.client.scriptRecord.findUnique({ where: { id: f.script.id } }))?.scriptText).toBe(f.script.scriptText);
    } finally { await f.close(); }
  });
  it("配置CAS成功后语音投影失效，失败CAS不触碰active", async () => {
    const f = await sqliteFixture(); try {
      const config = structuredClone(f.config.configurationJson); config.creative.voice_profile_id = "other";
      const audit = { actorUserId: f.project.ownerId, projectId: f.project.id, oldRevision: 1, newRevision: 2, diff: {} };
      const updated = { ...f.config, revision: 2, configurationJson: config };
      expect((await f.first.casUpsertProjectGenerationConfiguration(updated, 99, audit)).success).toBe(false);
      expect((await f.client.project.findUnique({ where: { id: f.project.id } }))?.activeNarrationRecordId).toBe("narration");
      expect((await f.first.casUpsertProjectGenerationConfiguration(updated, 1, audit)).success).toBe(true);
      expect((await f.client.project.findUnique({ where: { id: f.project.id } }))?.activeNarrationRecordId).toBeNull();
      expect((await getProjectSnapshot(f.db, f.project.id))?.active_storyboard).toBeNull();
    } finally { await f.close(); }
  });
  it("分镜LLM期间数据库正文变化，旧实例结果不能激活", async () => {
    const f = await sqliteFixture(); try {
      planner.mockImplementation(async () => { await f.client.scriptRecord.update({ where: { id: f.script.id }, data: { scriptText: "数据库新正文" } }); return f.plan; });
      expect((await runStoryboardGeneration({ db: f.db, project: f.project })).statusCode).toBe(409);
      expect((await f.client.project.findUnique({ where: { id: f.project.id } }))?.activeStoryboardRecordId).toBe("old");
      expect(planner).toHaveBeenCalledTimes(1);
    } finally { await f.close(); }
  });
  it("完整分镜成功激活后数据库和快照都能读取新记录", async () => {
    const f = await sqliteFixture(); try {
      planner.mockResolvedValue(f.plan);
      const result = await runStoryboardGeneration({ db: f.db, project: f.project });
      expect(result.statusCode).toBe(200);
      const project = await f.client.project.findUnique({ where: { id: f.project.id } });
      expect(project!.activeStoryboardRecordId).not.toBe("old");
      expect((await getProjectSnapshot(f.db, f.project.id))?.active_storyboard?.storyboard_record_id).toBe(project!.activeStoryboardRecordId);
      expect((await getProjectSnapshot(f.db, f.project.id))?.active_storyboard?.plan).toEqual(f.plan);
    } finally { await f.close(); }
  });
});

describe("Task6 上游正文失效", () => {
  it("新文案激活清理旧口播，迟到文案不得覆盖较新active", async () => {
    const f = await fixture();
    f.project.activeTopicPackageId = "topic";
    const first = await saveScriptRecord(f.db, f.input), second = await saveScriptRecord(f.db, f.input);
    await activateScriptRecord(f.db, f.project, first, f.script.id);
    expect(f.project.activeScriptRecordId).toBe(first.id);
    expect(f.project.activeNarrationRecordId).toBeNull();
    await expect(activateScriptRecord(f.db, f.project, second, f.script.id)).rejects.toThrow("narration_stale");
    expect(f.project.activeScriptRecordId).toBe(first.id);
  });
  it.each(["他关上城门。", "他打开城门！"])("保存 active 正文 %s 清空口播及所有下游 active/trace", async text => {
    const f = await fixture();
    await saveScriptRecord(f.db, { ...f.input, id: f.script.id, scriptText: text });
    expect(f.project.activeNarrationRecordId).toBeNull();
    expect(f.project.activeNarrationSubtitleRevisionId).toBeNull();
    for (const key of downstreamPointers) expect(f.project[key], key).toBeNull();
    for (const key of traces) expect(f.project[key], key).toBeNull();
    expect(f.db.scriptRecords.get(f.script.id)?.scriptText).toBe(text);
  });
  it("新候选或同正文保存不能失效旧 active", async () => {
    const f = await fixture();
    await saveScriptRecord(f.db, { ...f.input, scriptText: "候选生成失败", reviewStatus: "failed" });
    await saveScriptRecord(f.db, { ...f.input, id: f.script.id });
    expect(f.project.activeNarrationRecordId).toBe("narration");
    expect(f.project.activePublishPackageRecordId).toBe("old");
  });
});

describe("Task6 分镜前置来源门禁", () => {
  it("排队运行的冻结来源变化必须在派发前拒绝", async () => {
    const f = await readyFixture();
    const source = (await captureStoryboardNarrationSource(f.db, f.project.id, f.project.ownerId)).identity!;
    planner.mockResolvedValue(f.plan);
    const result = await runStoryboardGeneration({ db: f.db, project: f.project, expectedNarrationSource: { ...source, audioHash: "b".repeat(64) } });
    expect(result.statusCode).toBe(409);
    expect(planner).not.toHaveBeenCalled();
  });
  it("新模式分镜指纹绑定来源及单镜动作，旧模式指纹保持原样", () => {
    const base = { operation: "storyboard.generate", storyboard: { narration_source: { narrationRecordId: "n1" }, segment_id: "s1" } };
    expect(computeRunPayloadFingerprint(base)).not.toBe(computeRunPayloadFingerprint({ ...base, storyboard: { ...base.storyboard, segment_id: "s2" } }));
    expect(computeRunPayloadFingerprint(base)).not.toBe(computeRunPayloadFingerprint({ ...base, storyboard: { ...base.storyboard, narration_source: { narrationRecordId: "n2" } } }));
  });
  it("全量完成后同来源重放指纹不因自己更新的active分镜改变", () => {
    const input = { operation: "storyboard.generate", storyboard: { narration_source: { narrationRecordId: "n", activeStoryboardRecordId: "old", storyboardPlanSha256: "a" }, segment_id: null } };
    expect(computeRunPayloadFingerprint(input)).toBe(computeRunPayloadFingerprint({ ...input, storyboard: { ...input.storyboard, narration_source: { narrationRecordId: "n", activeStoryboardRecordId: "new", storyboardPlanSha256: "b" } } }));
  });
  it.each(["full", "segment"])("%s：未确认口播在 LLM 前返回409", async mode => {
    const f = await fixture();
    f.project.activeNarrationRecordId = null;
    const result = mode === "full" ? await runStoryboardGeneration({ db: f.db, project: f.project }) : await runStoryboardSegmentRegeneration({ db: f.db, project: f.project, segmentId: "s", userFeedback: "调整构图" });
    expect(result.statusCode).toBe(409);
    expect(result.body.error).toMatch(/script_not_confirmed|narration_required/);
    expect(planner).not.toHaveBeenCalled();
    expect(segmentPlanner).not.toHaveBeenCalled();
  });
  it.each(["text", "active", "target", "config"])("全量派发后%s变化，迟到结果不能激活或恢复旧指针", async change => {
    const f = await readyFixture();
    planner.mockImplementation(async () => {
      if (change === "text") f.db.scriptRecords.set(f.script.id, { ...f.script, scriptText: "他关闭城门。" });
      if (change === "active") f.db.projects.set(f.project.id, { ...f.project, activeStoryboardRecordId: "newer" });
      if (change === "target") f.db.topicPackages.get("topic")!.durationBandJson = { min_sec: 2, max_sec: 6 };
      if (change === "config") [...f.db.projectGenerationConfigurations.values()][0].configurationJson.creative.voice_profile_id = "changed";
      return f.plan;
    });
    const result = await runStoryboardGeneration({ db: f.db, project: f.project });
    expect(result.statusCode).toBe(409);
    expect(f.db.projects.get(f.project.id)?.activeStoryboardRecordId).toBe(change === "active" ? "newer" : "old");
    expect(f.db.projects.get(f.project.id)?.activePublishPackageRecordId).toBe("old");
  });
  it("单镜视觉重生锁定摘录和时间并创建新历史版本", async () => {
    const f = await readyFixture();
    segmentPlanner.mockResolvedValue({ ...f.plan.segments[0], script_excerpt: "篡改", start_hint_sec: 1, end_hint_sec: 9, scene_description: "新的构图" });
    const result = await runStoryboardSegmentRegeneration({ db: f.db, project: f.project, segmentId: "s", userFeedback: "构图" });
    expect(result.statusCode).toBe(200);
    const current = f.db.storyboardRecords.get(f.project.activeStoryboardRecordId!)!;
    expect(current.id).not.toBe("old");
    expect((current.planJson as typeof f.plan).segments[0]).toMatchObject({ script_excerpt: f.script.scriptText, start_hint_sec: 0, end_hint_sec: 2, scene_description: "新的构图" });
    expect(f.db.storyboardRecords.get("old")!.planJson).toEqual(f.plan);
    expect(f.project.activeNarrationRecordId).toBe("narration");
  });
});

describe("Task6 配置保存", () => {
  async function configured(qualified: boolean) {
    const f = await fixture();
    for (const row of buildPricingCatalogSeed({ llm: { mode: "stub" }, media: { deploymentScope: "cn-beijing" } })) f.db.providerModelCatalog.set(row.id, row);
    await seedGlobalVoiceProfiles(f.db);
    const next = structuredClone(DEFAULT_GENERATION_CONFIGURATION);
    next.capabilities["tts.synthesize"] = { mode: "fixed", provider_model_id: policy.default_provider_model_id };
    next.creative.voice_profile_id = policy.default_voice_profile_id;
    f.db.projectGenerationConfigurations.clear();
    f.db.projectGenerationConfigurations.set("config", { id: "config", projectId: f.project.id, schemaVersion: "generation_configuration_v1", revision: 1, configurationJson: qualified ? structuredClone(next) : structuredClone(DEFAULT_GENERATION_CONFIGURATION), sourceUserPreferenceRevision: null, createdAt: new Date(), updatedAt: new Date() });
    return { ...f, next };
  }
  it("switched：保存新的有效模型/音色投影使旧确认和全部下游失效", async () => {
    const f = await configured(false);
    expect((await upsertProjectGenerationConfiguration(f.db, f.project.id, { expected_revision: 1, configuration: f.next }, f.project.ownerId)).ok).toBe(true);
    expect(f.project.activeNarrationRecordId).toBeNull();
    for (const key of downstreamPointers) expect(f.project[key], key).toBeNull();
  });
  it.each(["subtitle", "visual", "explicit_defaults"])("%s 配置保存只改变无关revision，不失效口播", async change => {
    const f = await configured(true);
    if (change === "subtitle") f.next.creative.subtitle_style_overrides = { font_size_px: 48 };
    if (change === "visual") f.next.creative.art_style_preset_id = "historical_ink";
    if (change === "explicit_defaults") f.next.creative.narration = { rate: 1, tone: "neutral" };
    expect(projectTtsHash(f.next)).toBe(await hashProjectNarrationTtsSettings(f.next));
    const result = await upsertProjectGenerationConfiguration(f.db, f.project.id, { expected_revision: 1, configuration: f.next }, f.project.ownerId);
    expect(result.ok).toBe(true);
    expect(f.project.activeNarrationRecordId).toBe("narration");
  });
});

describe("Task6 R1 生命周期反例", () => {
  it.each(["active", "initial", "newer"])("文案候选失败不污染%s项目状态或回滚active", async mode => {
    const f = await readyFixture();
    f.project.status = mode === "initial" ? "topic_ready" : "storyboard_ready";
    if (mode === "initial") f.project.activeScriptRecordId = null;
    const originalStatus = f.project.status, originalScript = f.project.activeScriptRecordId;
    scriptGraph.mockImplementation(async () => {
      if (mode === "newer") f.db.projects.set(f.project.id, { ...f.project, status: "script_ready", activeScriptRecordId: "newer-script", activeNarrationRecordId: "newer-audio" });
      throw new Error("candidate failed");
    });
    const result = await runScriptGeneration({ db: f.db, project: f.project });
    expect(scriptGraph).toHaveBeenCalledOnce();
    expect(result.statusCode).toBe(500);
    expect(f.db.projects.get(f.project.id)).toMatchObject({ status: mode === "newer" ? "script_ready" : originalStatus, activeScriptRecordId: mode === "newer" ? "newer-script" : originalScript, activeNarrationRecordId: mode === "newer" ? "newer-audio" : "narration" });
    expect([...f.db.scriptRecords.values()].filter(row => row.id !== f.script.id)).toEqual([expect.objectContaining({ reviewStatus: "error", executionStateJson: expect.objectContaining({ generating: false }) })]);
  });
  it.each(["map", "sqlite"])("%s清空latest trace后保留历史但快照不回填旧trace", async mode => {
    const f = mode === "map" ? await readyFixture() : await sqliteFixture();
    f.db.storyboardRecords.get("old")!.graphTraceSummaryJson = { run_id: "old-run" };
    if ("client" in f) await f.client.storyboardRecord.update({ where: { id: "old" }, data: { graphTraceSummaryJson: { run_id: "old-run" } } });
    await saveScriptRecord(f.db, { ...f.input, id: f.script.id, scriptText: "他关闭城门！" });
    const snapshot = await getProjectSnapshot(f.db, f.project.id);
    expect(snapshot?.trace_summary.latest_storyboard_run).toBeNull();
    expect(f.db.storyboardRecords.get("old")!.graphTraceSummaryJson).toEqual({ run_id: "old-run" });
  });
  it.each(["map", "sqlite"])("%s目标区间变化先阻断，重新接受同一口播后允许单镜复用", async mode => {
    const f = mode === "map" ? await readyFixture() : await sqliteFixture();
    const band = { min_sec: 2, max_sec: 6 };
    f.db.topicPackages.get("topic")!.durationBandJson = band;
    if ("client" in f) await f.client.topicPackage.update({ where: { id: "topic" }, data: { durationBandJson: band } });
    segmentPlanner.mockResolvedValue({ ...f.plan.segments[0], scene_description: "新构图" });
    const run = () => runStoryboardSegmentRegeneration({ db: f.db, project: f.project, segmentId: "s", userFeedback: "构图" });
    expect((await run()).statusCode).toBe(409);
    expect(segmentPlanner).not.toHaveBeenCalled();
    f.db.narrationRecords.set(f.record.id, { ...f.record, acceptedDurationBandSnapshot: { minMs: 2000, maxMs: 6000 } });
    if ("client" in f) await f.client.narrationRecord.update({ where: { id: f.record.id }, data: { acceptedDurationBandSnapshotJson: { minMs: 2000, maxMs: 6000 } } });
    const result = await run();
    expect(result.statusCode).toBe(200);
    expect(result.body.plan?.segments[0]).toMatchObject({ start_hint_sec: 0, end_hint_sec: 2, script_excerpt: f.script.scriptText, scene_description: "新构图" });
  });
  it.each(["same", "feedback", "external_record", "edited_plan", "audio"])("单镜成功后的同key %s重放按权威产物判定", async change => {
    const f = await readyFixture();
    for (const row of buildPricingCatalogSeed({ llm: { mode: "stub" }, media: { deploymentScope: "cn-beijing" } })) f.db.providerModelCatalog.set(row.id, row);
    await seedGlobalVoiceProfiles(f.db);
    const repository = createGenerationRunRepository(f.db);
    segmentPlanner.mockResolvedValue({ ...f.plan.segments[0], scene_description: "新构图" });
    const dispatch = vi.fn(async (runId: string) => {
      const run = (await repository.getRunById(runId))!, snapshot = (await repository.getSnapshotById(run.runConfigurationSnapshotId))!;
      const response = await runStoryboardSegmentRegeneration({ db: f.db, project: f.project, segmentId: "s", userFeedback: "构图", expectedNarrationSource: run.dispatchPayloadJson.narration_source as never, billingContext: { db: f.db, runId, snapshot, operation: "storyboard.generate", resolved: snapshot.resolvedConfigurationJson as never } });
      await repository.updateRunStatus(runId, response.statusCode === 200 ? "succeeded" : "failed", { releaseLease: true, now: new Date() });
      return { dispatched: true, outcome: { status: "succeeded", response } };
    });
    const context = { payload: { idempotency_key: "single-key" }, params: { projectId: f.project.id }, auth: { anonymous: false, userId: f.project.ownerId }, app: { db: f.db, generationRunRepository: repository, generationRunDispatcher: { dispatch } } } as unknown as RouteContext;
    const submit = (feedback = "构图") => submitGenerationRun(context, "storyboard.generate", undefined, { segment_id: "s", user_feedback: feedback });
    const first = await submit();
    expect(first.statusCode, JSON.stringify(first.body)).toBe(200);
    const current = f.db.storyboardRecords.get(f.project.activeStoryboardRecordId!)!;
    if (change === "external_record") { f.db.storyboardRecords.set("external", { ...current, id: "external" }); f.project.activeStoryboardRecordId = "external"; }
    if (change === "edited_plan") (current.planJson as typeof f.plan).segments[0].scene_description = "外部编辑";
    if (change === "audio") f.db.narrationRecords.set(f.record.id, { ...f.record, output: { ...f.record.output!, audio: { ...f.record.output!.audio, sha256: "b".repeat(64) } } });
    const replay = await submit(change === "feedback" ? "不同反馈" : "构图");
    expect(replay.statusCode, JSON.stringify(replay.body)).toBe(change === "same" ? 200 : 409);
    if (change === "same") expect(replay.body).toMatchObject({ generation_run_id: (first.body as Record<string, unknown>).generation_run_id, idempotency_replayed: true });
    expect(dispatch).toHaveBeenCalledOnce();
    expect(segmentPlanner).toHaveBeenCalledOnce();
  });
});

describe("Task6 R2 权威快照模式", () => {
  it.each(["legacy_estimated", undefined])("数据库新模式与Map模式%s不一致时失效trace仍为空", async cachedMode => {
    const f = await sqliteFixture();
    f.db.storyboardRecords.get("old")!.graphTraceSummaryJson = { run_id: "old-run" };
    await saveScriptRecord(f.db, { ...f.input, id: f.script.id, scriptText: "正文变化！" });
    f.project.narrationTimingMode = cachedMode;
    const snapshot = await getProjectSnapshot(f.db, f.project.id);
    expect(snapshot?.narration_timing_mode).toBe("narration_first_v1");
    expect(snapshot?.active_storyboard).toBeNull();
    expect(snapshot?.trace_summary.latest_storyboard_run).toBeNull();
    expect(f.db.storyboardRecords.get("old")!.graphTraceSummaryJson).toEqual({ run_id: "old-run" });
  });
  it("数据库旧模式仍保持历史trace回填，不被Map新模式误改", async () => {
    const f = await sqliteFixture();
    await f.client.project.update({ where: { id: f.project.id }, data: { narrationTimingMode: "legacy_estimated", latestStoryboardRunTraceJson: null } });
    f.project.latestStoryboardRunTraceJson = null;
    f.db.storyboardRecords.get("old")!.graphTraceSummaryJson = { run_id: "old-run" };
    const snapshot = await getProjectSnapshot(f.db, f.project.id);
    expect(snapshot?.narration_timing_mode).toBe("legacy_estimated");
    expect(snapshot?.trace_summary.latest_storyboard_run?.run_id).toBe("old-run");
  });
});

describe("Task6 R3 提交后迟到缓存发布", () => {
  function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    return { promise, resolve };
  }
  async function confirmNewFixture(f: Awaited<ReturnType<typeof sqliteFixture>>, script: typeof f.script) {
    const snapshot = (await f.client.runConfigurationSnapshot.findUnique({ where: { id: "snapshot" } }))!;
    await f.client.runConfigurationSnapshot.create({ data: { ...snapshot, id: "snapshot-b", runId: "run-b" } });
    const run = (await f.client.generationRun.findUnique({ where: { id: "run" } }))!;
    await f.client.generationRun.create({ data: { ...run, id: "run-b", idempotencyKey: "run-b", runConfigurationSnapshotId: "snapshot-b" } });
    const stored = (await f.client.narrationRecord.findUnique({ where: { id: "narration" } }))!;
    const sourceTextSha256 = narrationTextHash(script.scriptText);
    await f.client.narrationRecord.create({ data: { ...stored, id: "nB", scriptRecordId: script.id, generationRunId: "run-b", configurationSnapshotId: "snapshot-b", sourceTextSha256, status: "generating", outputJson: Prisma.DbNull, initialSubtitleRevisionId: null, confirmedAt: null, confirmedBy: null, acceptedDurationBandSnapshotJson: Prisma.DbNull } });
    const subtitle = (await f.client.narrationSubtitleRevision.findUnique({ where: { id: "subtitle" } }))!;
    await f.client.narrationSubtitleRevision.create({ data: { ...subtitle, id: "subtitle-b", narrationRecordId: "nB" } });
    await f.client.narrationRecord.update({ where: { id: "nB" }, data: { status: "confirmed", outputJson: { ...f.record.output!, initialSubtitleRevisionId: "subtitle-b" }, initialSubtitleRevisionId: "subtitle-b", confirmedAt: new Date(f.record.confirmedAt!), confirmedBy: f.project.ownerId, acceptedDurationBandSnapshotJson: f.record.acceptedDurationBandSnapshot! } });
    await f.client.project.update({ where: { id: f.project.id }, data: { activeNarrationRecordId: "nB" } });
    f.db.narrationRecords.set("nB", { ...f.record, id: "nB", scriptRecordId: script.id, generationRunId: "run-b", configurationSnapshotId: "snapshot-b", sourceTextSha256, output: { ...f.record.output!, initialSubtitleRevisionId: "subtitle-b" } });
    f.db.projects.get(f.project.id)!.activeNarrationRecordId = "nB";
  }
  it.each(["same_object", "replaced_object"])("SQLite先提交A后提交B，A激活迟到不得覆盖%s的B及新口播", async mode => {
    const f = await sqliteFixture(), committed = deferred(), release = deferred();
    const a = await saveScriptRecord(f.db, f.input), b = await saveScriptRecord(f.db, f.input);
    const original = f.second.activateScript.bind(f.second);
    vi.spyOn(f.second, "activateScript").mockImplementation(async (...args) => {
      await original(...args);
      if (args[1].id === a.id) { committed.resolve(); await release.promise; }
    });
    const late = activateScriptRecord(f.db, f.project, a, f.script.id);
    await committed.promise;
    expect((await f.client.project.findUnique({ where: { id: f.project.id } }))?.activeScriptRecordId).toBe(a.id);
    await activateScriptRecord(f.db, { ...f.project, activeScriptRecordId: a.id }, b, a.id);
    await confirmNewFixture(f, b);
    if (mode === "replaced_object") f.db.projects.set(f.project.id, { ...f.db.projects.get(f.project.id)! });
    release.resolve(); await late;
    expect(await f.client.project.findUnique({ where: { id: f.project.id } })).toMatchObject({ activeScriptRecordId: b.id, activeNarrationRecordId: "nB" });
    expect(f.db.projects.get(f.project.id)).toMatchObject({ activeScriptRecordId: b.id, activeNarrationRecordId: "nB" });
    expect(f.db.narrationRecords.get("nB")?.status).toBe("confirmed");
  });
  it.each(["same_object", "replaced_object"])("SQLite同ID先写A后写B，A应答迟到不得回写%s正文或失效新口播", async mode => {
    const f = await sqliteFixture(), committed = deferred(), release = deferred();
    const original = f.second.saveScript.bind(f.second);
    vi.spyOn(f.second, "saveScript").mockImplementation(async record => {
      await original(record);
      if (record.scriptText === "正文A。") { committed.resolve(); await release.promise; }
    });
    const late = saveScriptRecord(f.db, { ...f.input, id: f.script.id, scriptText: "正文A。" });
    await committed.promise;
    expect((await f.client.scriptRecord.findUnique({ where: { id: f.script.id } }))?.scriptText).toBe("正文A。");
    const b = await saveScriptRecord(f.db, { ...f.input, id: f.script.id, scriptText: "正文B。" });
    await confirmNewFixture(f, b);
    if (mode === "replaced_object") {
      f.db.scriptRecords.set(b.id, { ...b });
      f.db.projects.set(f.project.id, { ...f.db.projects.get(f.project.id)! });
    }
    release.resolve(); await late;
    expect((await f.client.scriptRecord.findUnique({ where: { id: b.id } }))?.scriptText).toBe("正文B。");
    expect(f.db.scriptRecords.get(b.id)?.scriptText).toBe("正文B。");
    expect(f.db.projects.get(f.project.id)?.activeNarrationRecordId).toBe("nB");
    expect(f.db.narrationRecords.get("nB")?.status).toBe("confirmed");
    expect((await getProjectSnapshot(f.db, f.project.id))?.active_script?.script_text).toBe("正文B。");
  });
});

describe("Task6 R3 数据库提交顺序与发布窗口", () => {
  function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
  it("较早请求实际最后提交时，缓存反映数据库最后值而非请求先后", async () => {
    const f = await sqliteFixture(), entered = deferred(), release = deferred();
    const original = f.second.saveScript.bind(f.second);
    vi.spyOn(f.second, "saveScript").mockImplementation(async record => {
      if (record.scriptText === "最后提交A") { entered.resolve(); await release.promise; }
      await original(record);
    });
    const a = saveScriptRecord(f.db, { ...f.input, id: f.script.id, scriptText: "最后提交A" });
    await entered.promise;
    await saveScriptRecord(f.db, { ...f.input, id: f.script.id, scriptText: "先提交B" });
    release.resolve(); await a;
    expect((await f.client.scriptRecord.findUnique({ where: { id: f.script.id } }))?.scriptText).toBe("最后提交A");
    expect(f.db.scriptRecords.get(f.script.id)?.scriptText).toBe("最后提交A");
  });
  it("权威重读之后应答迟到，最后await后仍不得覆盖已发布新正文", async () => {
    const f = await sqliteFixture(), readComplete = deferred(), release = deferred();
    const transaction = f.client.$transaction.bind(f.client);
    let held = false;
    vi.spyOn(f.client, "$transaction").mockImplementation(async action => {
      const result = await transaction(action as never);
      if (!held && Array.isArray(result) && result.length === 3) {
        held = true; readComplete.resolve(); await release.promise;
      }
      return result;
    });
    const a = saveScriptRecord(f.db, { ...f.input, id: f.script.id, scriptText: "旧读取A" });
    await readComplete.promise;
    await saveScriptRecord(f.db, { ...f.input, id: f.script.id, scriptText: "新发布B" });
    release.resolve(); await a;
    expect(f.db.scriptRecords.get(f.script.id)?.scriptText).toBe("新发布B");
    expect((await f.client.scriptRecord.findUnique({ where: { id: f.script.id } }))?.scriptText).toBe("新发布B");
  });
  it("项目改名不阻止正常发布也不被文案激活覆盖", async () => {
    const f = await sqliteFixture(), next = await saveScriptRecord(f.db, f.input);
    const original = f.second.activateScript.bind(f.second);
    vi.spyOn(f.second, "activateScript").mockImplementation(async (...args) => {
      await original(...args); f.project.name = "新名称";
    });
    await activateScriptRecord(f.db, f.project, next, f.script.id);
    expect(f.project.name).toBe("新名称");
    expect(f.project.activeScriptRecordId).toBe(next.id);
    expect(f.db.scriptRecords.get(next.id)?.scriptText).toBe(next.scriptText);
  });
});

describe("Task6 R3 提交成功后的缓存读取故障", () => {
  it("刷新缓存失败不把已成功激活变成失败，快照从数据库取正文", async () => {
    const f = await sqliteFixture(), next = await saveScriptRecord(f.db, f.input);
    f.db.scriptRecords.set(next.id, { ...next, scriptText: "过期占位正文" });
    const transaction = f.client.$transaction.bind(f.client);
    let injected = false;
    vi.spyOn(f.client, "$transaction").mockImplementation(async action => {
      const result = await transaction(action as never);
      if (!injected && Array.isArray(result) && result.length === 3) {
        injected = true; throw new Error("task6_post_commit_cache_read_failed");
      }
      return result;
    });
    await expect(activateScriptRecord(f.db, f.project, next, f.script.id)).resolves.toBeUndefined();
    expect(injected).toBe(true);
    expect((await f.client.project.findUnique({ where: { id: f.project.id } }))?.activeScriptRecordId).toBe(next.id);
    expect((await getProjectSnapshot(f.db, f.project.id))?.active_script?.script_text).toBe(next.scriptText);
  });
});

describe("Task6 R4 已提交后的缓存故障兼容", () => {
  async function legacyFixture() {
    const f = await sqliteFixture();
    await f.client.project.update({ where: { id: f.project.id }, data: { narrationTimingMode: "legacy_estimated", activeNarrationRecordId: null, activeNarrationSubtitleRevisionId: null } });
    Object.assign(f.project, { narrationTimingMode: "legacy_estimated", activeNarrationRecordId: null, activeNarrationSubtitleRevisionId: null });
    return f;
  }
  function failCacheReads(f: Awaited<ReturnType<typeof sqliteFixture>>) {
    const transaction = f.client.$transaction.bind(f.client);
    let failures = 0;
    vi.spyOn(f.client, "$transaction").mockImplementation(async action => {
      const result = await transaction(action as never);
      if (Array.isArray(result) && result.length === 3) { failures++; throw new Error("task6_cache_read_unavailable"); }
      return result;
    });
    return () => failures;
  }
  it.each(["save_existing", "save_new_activate"])("legacy %s缓存读取故障后，成功正文在Map和snapshot可见", async action => {
    const f = await legacyFixture();
    const failures = failCacheReads(f);
    const saved = await saveScriptRecord(f.db, { ...f.input, ...(action === "save_existing" ? { id: f.script.id } : {}), scriptText: "已提交的新正文。" });
    if (action === "save_new_activate") await activateScriptRecord(f.db, f.project, saved, f.script.id);
    expect(failures()).toBe(action === "save_existing" ? 1 : 2);
    expect((await f.client.scriptRecord.findUnique({ where: { id: saved.id } }))?.scriptText).toBe(saved.scriptText);
    expect(f.db.scriptRecords.get(saved.id)?.scriptText).toBe(saved.scriptText);
    expect(f.project.activeScriptRecordId).toBe(saved.id);
    expect((await getProjectSnapshot(f.db, f.project.id))?.active_script?.script_text).toBe(saved.scriptText);
  });
  it.each([
    ["legacy", "save"], ["legacy", "activate"],
    ["new", "save"], ["new", "activate"],
  ])("%s %s读取故障与迟到应答组合仍保留已发布B", async (mode, action) => {
    const f = mode === "legacy" ? await legacyFixture() : await sqliteFixture();
    const a = await saveScriptRecord(f.db, f.input), b = await saveScriptRecord(f.db, f.input);
    let signal!: () => void, release!: () => void;
    const committed = new Promise<void>(done => { signal = done; });
    const gate = new Promise<void>(done => { release = done; });
    const save = f.second.saveScript.bind(f.second), activate = f.second.activateScript.bind(f.second);
    if (action === "save") vi.spyOn(f.second, "saveScript").mockImplementation(async record => {
      const receipt = await save(record); if (record.scriptText === "A正文") { signal(); await gate; } return receipt;
    });
    else vi.spyOn(f.second, "activateScript").mockImplementation(async (...args) => {
      const receipt = await activate(...args); if (args[1].id === a.id) { signal(); await gate; } return receipt;
    });
    const failures = failCacheReads(f);
    const late = action === "save"
      ? saveScriptRecord(f.db, { ...f.input, id: f.script.id, scriptText: "A正文" })
      : activateScriptRecord(f.db, f.project, a, f.script.id);
    await committed;
    if (action === "save") await saveScriptRecord(f.db, { ...f.input, id: f.script.id, scriptText: "B正文" });
    else await activateScriptRecord(f.db, { ...f.project, activeScriptRecordId: a.id }, b, a.id);
    release(); await late;
    expect(failures()).toBe(2);
    if (action === "save") {
      expect((await f.client.scriptRecord.findUnique({ where: { id: f.script.id } }))?.scriptText).toBe("B正文");
      expect(f.db.scriptRecords.get(f.script.id)?.scriptText).toBe("B正文");
    } else {
      expect((await f.client.project.findUnique({ where: { id: f.project.id } }))?.activeScriptRecordId).toBe(b.id);
      expect(f.project.activeScriptRecordId).toBe(b.id);
    }
  });
});

describe("Task6 R4 读取失败时仍按实际提交顺序发布", () => {
  it.each(["legacy_estimated", "narration_first_v1"])("%s先发请求最后提交且缓存读取失败，仍可见最后提交值", async mode => {
    const f = await sqliteFixture();
    f.project.narrationTimingMode = mode as typeof f.project.narrationTimingMode;
    await f.client.project.update({ where: { id: f.project.id }, data: { narrationTimingMode: mode } });
    let signal!: () => void, release!: () => void;
    const entered = new Promise<void>(done => { signal = done; }), gate = new Promise<void>(done => { release = done; });
    const save = f.second.saveScript.bind(f.second), transaction = f.client.$transaction.bind(f.client);
    vi.spyOn(f.second, "saveScript").mockImplementation(async record => {
      if (record.scriptText === "实际最后的A") { signal(); await gate; }
      return save(record);
    });
    vi.spyOn(f.client, "$transaction").mockImplementation(async action => {
      const result = await transaction(action as never);
      if (Array.isArray(result) && result.length === 3) throw new Error("cache unavailable after commit");
      return result;
    });
    const lateCommit = saveScriptRecord(f.db, { ...f.input, id: f.script.id, scriptText: "实际最后的A" });
    await entered;
    await saveScriptRecord(f.db, { ...f.input, id: f.script.id, scriptText: "先提交B" });
    release(); await lateCommit;
    expect((await f.client.scriptRecord.findUnique({ where: { id: f.script.id } }))?.scriptText).toBe("实际最后的A");
    expect(f.db.scriptRecords.get(f.script.id)?.scriptText).toBe("实际最后的A");
  });
});

describe("Task6 R4 发布顺序与权限缓存变化", () => {
  it("legacy较早激活请求最后提交且读取失败，最终active保持最后提交", async () => {
    const f = await sqliteFixture(), a = await saveScriptRecord(f.db, f.input), b = await saveScriptRecord(f.db, f.input);
    f.project.narrationTimingMode = "legacy_estimated";
    await f.client.project.update({ where: { id: f.project.id }, data: { narrationTimingMode: "legacy_estimated" } });
    let signal!: () => void, release!: () => void;
    const entered = new Promise<void>(done => { signal = done; }), gate = new Promise<void>(done => { release = done; });
    const activate = f.second.activateScript.bind(f.second), transaction = f.client.$transaction.bind(f.client);
    vi.spyOn(f.second, "activateScript").mockImplementation(async (...args) => {
      if (args[1].id === a.id) { signal(); await gate; }
      return activate(...args);
    });
    vi.spyOn(f.client, "$transaction").mockImplementation(async action => {
      const result = await transaction(action as never);
      if (Array.isArray(result) && result.length === 3) throw new Error("cache unavailable");
      return result;
    });
    const first = activateScriptRecord(f.db, f.project, a, f.script.id);
    await entered; await activateScriptRecord(f.db, f.project, b, f.script.id);
    release(); await first;
    expect((await f.client.project.findUnique({ where: { id: f.project.id } }))?.activeScriptRecordId).toBe(a.id);
    expect(f.project.activeScriptRecordId).toBe(a.id);
  });
  it.each(["owner_changed", "evicted"])("已提交后%s并且读取失败，不回写缓存也不触发失败清理", async change => {
    const f = await sqliteFixture(), a = await saveScriptRecord(f.db, f.input);
    const activate = f.second.activateScript.bind(f.second), transaction = f.client.$transaction.bind(f.client);
    vi.spyOn(f.second, "activateScript").mockImplementation(async (...args) => {
      const receipt = await activate(...args);
      if (change === "owner_changed") f.db.projects.set(f.project.id, { ...f.project, ownerId: "new-owner" });
      else f.db.projects.delete(f.project.id);
      return receipt;
    });
    vi.spyOn(f.client, "$transaction").mockImplementation(async action => {
      const result = await transaction(action as never);
      if (Array.isArray(result) && result.length === 3) throw new Error("cache unavailable");
      return result;
    });
    await expect(activateScriptRecord(f.db, f.project, a, f.script.id)).resolves.toBeUndefined();
    expect((await f.client.project.findUnique({ where: { id: f.project.id } }))?.activeScriptRecordId).toBe(a.id);
    if (change === "owner_changed") expect(f.db.projects.get(f.project.id)).toMatchObject({ ownerId: "new-owner", activeScriptRecordId: f.script.id });
    else expect(f.db.projects.has(f.project.id)).toBe(false);
  });
});

describe("Task8 真实生成服务与冻结来源接线", () => {
  it.each(["map", "sqlite"])("%s完整生成调用真实stub并持久化v2", async mode => {
    const f = mode === "sqlite" ? await sqliteFixture() : await readyFixture();
    const actual = await vi.importActual<typeof import("../../../backend/src/modules/storyboard/storyboard-generation.service.js")>("../../../backend/src/modules/storyboard/storyboard-generation.service.js");
    planner.mockImplementation(actual.generateStoryboardPlan);
    const result = await runStoryboardGeneration({ db: f.db, project: f.project });
    expect(result.statusCode, JSON.stringify(result.body)).toBe(200);
    expect(planner.mock.calls[0]![0].narrationTiming).toEqual(f.narrationTiming);
    const snapshot = await getProjectSnapshot(f.db, f.project.id);
    expect(snapshot!.active_storyboard!.plan.plan_version).toBe("storyboard_v2");
  });
  it("真实单镜服务保留完整v2来源，只更新视觉", async () => {
    const f = await readyFixture();
    const actual = await vi.importActual<typeof import("../../../backend/src/modules/storyboard/storyboard-generation.service.js")>("../../../backend/src/modules/storyboard/storyboard-generation.service.js");
    segmentPlanner.mockImplementation((input: any) => actual.regenerateSingleSegment({ ...input,
      llmGateway: { invokeStructuredPrompt: vi.fn().mockResolvedValue({ ...f.plan.segments[0], visual_intent: "新的视觉", source_start: 999, start_boundary_id: "wrong", script_excerpt: "错文", visual_start_ms: 999 }) } as any }));
    const result = await runStoryboardSegmentRegeneration({ db: f.db, project: f.project, segmentId: "s", userFeedback: "换画面" });
    expect(result.statusCode, JSON.stringify(result.body)).toBe(200);
    const record = [...f.db.storyboardRecords.values()].find(r => r.id !== "old")!;
    expect((record.planJson as any).segments[0]).toEqual({ ...f.plan.segments[0], visual_intent: "新的视觉" });
  });
  it("bundle不完整时先拒绝，planner零调用且旧active保留", async () => {
    const f = await readyFixture(); f.timingRead.mockRestore();
    const result = await runStoryboardGeneration({ db: f.db, project: f.project });
    expect(result.statusCode).toBe(500); expect(result.body).toMatchObject({ error: "internal_server_error", message: "narration_bundle_incomplete" }); expect(planner).not.toHaveBeenCalled();
    expect(f.project.activeStoryboardRecordId).toBe("old");
  });
  it.each(["text", "owner"])("磁盘读取await期间%s变化，派发前拒绝", async mode => {
    const f = await readyFixture(); f.timingRead.mockImplementation(async () => {
      if (mode === "text") f.db.scriptRecords.set(f.script.id, { ...f.script, scriptText: "已经变化" });
      else f.db.projects.set(f.project.id, { ...f.project, ownerId: "other" });
      return Buffer.from(canonicalStringify(f.narrationTiming.timingMap));
    });
    const result = await runStoryboardGeneration({ db: f.db, project: f.project });
    expect(result.statusCode).toBe(mode === "text" ? 409 : 500);
    expect(result.body).toMatchObject(mode === "text" ? { error: "script_not_confirmed" } : { error: "internal_server_error", message: "project_scope_denied" });
    expect(planner).not.toHaveBeenCalled();
    expect(f.db.projects.get(f.project.id)!.activeStoryboardRecordId).toBe("old");
  });
});

describe("Task8 R1 补齐结构重生与完整磁盘成功序列", () => {
  it.each(["success", "before_second", "during_second"])("v2结构regen_once：%s", async mode => {
    const f = await readyFixture();
    const actual = await vi.importActual<typeof import("../../../backend/src/modules/storyboard/storyboard-generation.service.js")>("../../../backend/src/modules/storyboard/storyboard-generation.service.js");
    let calls = 0;
    planner.mockImplementation(async (input: any) => {
      const plan = structuredClone(f.plan); plan.segments[0]!.visual_intent = ++calls === 1 ? " " : "重生后的画面";
      const result = await actual.generateStoryboardPlan({ ...input, llmGateway: { invokeStructuredPrompt: vi.fn().mockResolvedValue(plan) } as any });
      if (mode === "before_second" && calls === 1 || mode === "during_second" && calls === 2)
        f.db.scriptRecords.set(f.script.id, { ...f.script, scriptText: "后来的正文" });
      return result;
    });
    const result = await runStoryboardGeneration({ db: f.db, project: f.project });
    expect(result.statusCode, JSON.stringify(result.body)).toBe(mode === "success" ? 200 : 409);
    expect(planner).toHaveBeenCalledTimes(mode === "before_second" ? 1 : 2);
    if (calls === 2) {
      expect(planner.mock.calls[1]![0].narrationTiming).toEqual(planner.mock.calls[0]![0].narrationTiming);
      expect(planner.mock.calls[1]![0].regenerationContext.reason).toBe("storyboard_local_validation_regen_once");
    }
    if (mode !== "success") expect(f.project.activeStoryboardRecordId).toBe("old");
    else expect((await getProjectSnapshot(f.db, f.project.id))!.active_storyboard!.plan.segments[0]!.visual_intent).toBe("重生后的画面");
  });
  it("完整磁盘bundle→真实stub→v2成功；随后损坏原件则零派发且保留active", async () => {
    const f = await readyFixture(); f.timingRead.mockRestore();
    const audio = Buffer.alloc(96044); audio.write("RIFF"); audio.writeUInt32LE(96036, 4); audio.write("WAVEfmt ", 8);
    audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22); audio.writeUInt32LE(24000, 24);
    audio.writeUInt32LE(48000, 28); audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34); audio.write("data", 36); audio.writeUInt32LE(96000, 40);
    const audioHash = createHash("sha256").update(audio).digest("hex");
    const text = f.script.scriptText, words = [{ text, begin_index: 0, end_index: 1, begin_time: 0, end_time: 2000 }];
    const timingMap = normalizeNarrationTiming({ sourceText: text, audioHash, durationMs: 2000,
      sentences: [{ providerSentenceIndex: 0, originalText: text, normalizedText: text, words }] });
    const event = (name: string, output?: unknown) => ({ kind: "json", elapsedMs: 0,
      data: { header: { event: name, task_id: "task" }, payload: output === undefined ? {} : { output } } });
    const nativeEvents = [event("task-started"), event("result-generated", { type: "sentence-begin", sentence: { index: 0 } }),
      { kind: "audio", elapsedMs: 0, byteOffset: 0, byteLength: 96000 },
      event("result-generated", { type: "sentence-end", sentence: { index: 0, words }, original_text: text, normalized_text: text }), event("task-finished")];
    const store = new NarrationBundleStorage({ projectId: f.project.id, storageRootDir: f.project.storageRootDir });
    const bundle = await store.commitInitial({ record: { ...f.record, settingsSha256: await hashNarrationSettings(f.record.settings),
      status: "generating", providerRequestId: null, confirmedAt: null, confirmedBy: null, acceptedDurationBandSnapshot: null, output: null, spokenTextSha256: null },
      audio, timingMap, nativeEvents, subtitleSettings: { presetId: null, presetVersion: null, resolvedStyle: DEFAULT_SUBTITLE_STYLE, overrides: {},
        lineBreak: { strategy: "punctuation_and_length", maxCharactersPerLine: 20, version: "v1" }, resolverVersion: "v1" },
      subtitleRevisionId: "subtitle", createdAt: f.record.createdAt });
    f.db.narrationRecords.set(f.record.id, { ...bundle.record, status: "confirmed", confirmedAt: f.record.confirmedAt,
      confirmedBy: f.record.confirmedBy, acceptedDurationBandSnapshot: f.record.acceptedDurationBandSnapshot });
    f.db.narrationSubtitleRevisions.set("subtitle", bundle.initialSubtitleRevision);
    const actual = await vi.importActual<typeof import("../../../backend/src/modules/storyboard/storyboard-generation.service.js")>("../../../backend/src/modules/storyboard/storyboard-generation.service.js");
    planner.mockImplementation(actual.generateStoryboardPlan);
    const result = await runStoryboardGeneration({ db: f.db, project: f.project });
    expect(result.statusCode, JSON.stringify(result.body)).toBe(200); expect(planner).toHaveBeenCalledTimes(1);
    const snapshot = await getProjectSnapshot(f.db, f.project.id), plan = snapshot!.active_storyboard!.plan;
    expect(plan.plan_version).toBe("storyboard_v2"); expect((plan as any).narration_reference.audio_hash).toBe(audioHash);
    const active = f.project.activeStoryboardRecordId;
    await writeFile(join(f.project.storageRootDir, bundle.record.output!.timingMap.uri), "{}"); planner.mockClear();
    const rejected = await runStoryboardGeneration({ db: f.db, project: f.project });
    expect(rejected.statusCode).toBe(500); expect(rejected.body).toMatchObject({ message: "narration_bundle_incomplete" });
    expect(planner).not.toHaveBeenCalled(); expect(f.project.activeStoryboardRecordId).toBe(active);
  });
});

function task9Plan(f: Awaited<ReturnType<typeof readyFixture>>) {
  return compileNarrationAssetPlan({ sourceIds: { storyboardRecordId: "old", scriptRecordId: f.script.id, topicPackageId: "topic" }, storyboard: f.plan, narrationTiming: f.narrationTiming,
    draft: { script_text: f.script.scriptText, estimated_duration_sec: 2, opening_span: f.script.scriptText, ending_span: f.script.scriptText, beat_trace: [], quote_trace: [] },
    globalDraft: { art_bible: { era_style: "古代", visual_tone: "写实", characters: [], locations: [], props: [], global_prompt_prefix: "古代", global_negative_prompts: [], consistency_notes: [] }, visual_budget: {}, downgrade_policy: {}, global_audio_strategy: {}, manual_review_notes: ["复核"] },
    segmentVisualRoutes: new Map([["s", { segment_id: "s", segment_override: null, api_video_suitability: "remotion_sufficient", resolved_route: "remotion", reason_code: "test" }]]),
    chunks: [{ chunkIndex: 0, inputSegmentIds: ["s"], draft: { planning_mode: "segment_intent_batch", budget_notes: [], segments: [{ source_segment_id: "s", intents: [
      { asset_kind: "image_still", production_intent: "城门", image_prompt: "城门", video_prompt_reserve: "推门", image_role: "anchor", support_reason: null, risk_notes: ["核对"] },
      { asset_kind: "render_motion_cue", production_intent: "推门", risk_notes: ["缓慢"] },
      { asset_kind: "bgm_cue", production_intent: "紧张", required_tags: ["弦乐"], mood_tags: ["紧张"], selection_label: "配乐", timing_basis: "tts", scope: "global", segment_ids: [], volume: 0.2, fade_in_sec: 0, fade_out_sec: 1, risk_notes: [] },
    ] }] } }] }).plan;
}

describe("Task9A 资产规划来源门禁", () => {
  it.each(["map", "sqlite"])("%s成功引用v2并以相同冻结上下文派发", async mode => {
    const f = mode === "map" ? await readyFixture() : await sqliteFixture();
    for (const row of buildPricingCatalogSeed({ llm: { mode: "stub" }, media: { deploymentScope: "cn-beijing" } })) f.db.providerModelCatalog.set(row.id, row);
    assetPlanner.mockResolvedValue(task9Plan(f));
    const result = await runAssetPlanningGeneration({ db: f.db, project: f.project });
    expect(result.statusCode, JSON.stringify(result.body)).toBe(200);
    expect(assetPlanner).toHaveBeenCalledTimes(1);
    expect(assetPlanner.mock.calls[0]![0].narrationTiming).toEqual(f.narrationTiming);
    const active = "client" in f ? (await f.client.project.findUniqueOrThrow({ where: { id: f.project.id } })).activeAssetPlanRecordId : f.project.activeAssetPlanRecordId;
    expect(active).not.toBe("old");
    expect(f.db.assetPlanRecords.get(active!)!.planJson).toMatchObject({ plan_version: "asset_plan_v2" });
  });
  it("冷实例数据库已变更正文确认时零派发", async () => {
    const f = await sqliteFixture();
    await f.client.scriptRecord.update({ where: { id: f.script.id }, data: { scriptText: "新正文。" } });
    const result = await runAssetPlanningGeneration({ db: f.db, project: f.project });
    expect(result.statusCode, JSON.stringify(result.body)).toBe(409); expect(assetPlanner).not.toHaveBeenCalled();
  });
  it.each(["map", "sqlite"])("%s已派发结果在来源变化后不能激活或回滚active", async mode => {
    const f = mode === "map" ? await readyFixture() : await sqliteFixture();
    for (const row of buildPricingCatalogSeed({ llm: { mode: "stub" }, media: { deploymentScope: "cn-beijing" } })) f.db.providerModelCatalog.set(row.id, row);
    const plan = task9Plan(f);
    assetPlanner.mockImplementation(async () => {
      if ("client" in f) await f.client.project.update({ where: { id: f.project.id }, data: { activeNarrationRecordId: null, activeNarrationSubtitleRevisionId: null, activeAssetPlanRecordId: null, status: "script_ready" } });
      else Object.assign(f.project, { activeNarrationRecordId: null, activeAssetPlanRecordId: null, status: "script_ready" });
      return plan;
    });
    const result = await runAssetPlanningGeneration({ db: f.db, project: f.project });
    if (result.statusCode === 500) await assetPlanner.mock.results[0]!.value;
    expect(result.statusCode, JSON.stringify(result.body)).toBe(409); expect(assetPlanner).toHaveBeenCalledTimes(1);
    const current = "client" in f ? await f.client.project.findUniqueOrThrow({ where: { id: f.project.id } }) : f.project;
    expect(current.activeAssetPlanRecordId).toBeNull(); expect(current.status).toBe("script_ready");
  });
});

describe("Task9A 排队身份与最后激活窗口", () => {
  it("资产计划指纹包含活动分镜和口播身份", async () => {
    const f = await readyFixture(), state = await captureStoryboardNarrationSource(f.db, f.project.id, f.project.ownerId);
    const fingerprint = (source: unknown) => computeRunPayloadFingerprint({ operation: "asset_plan.generate", storyboard: { narration_source: source } });
    expect(fingerprint(state.identity)).not.toBe(fingerprint({ ...state.identity, activeStoryboardRecordId: "new" }));
    expect(fingerprint(state.identity)).not.toBe(fingerprint({ ...state.identity, timingHash: "b".repeat(64) }));
    assetPlanner.mockResolvedValue(task9Plan(f));
    const result = await runAssetPlanningGeneration({ db: f.db, project: f.project, expectedNarrationSource: { ...state.identity, activeStoryboardRecordId: "new" } });
    expect(result.statusCode).toBe(409); expect(assetPlanner).not.toHaveBeenCalled();
  });
  it("冷实例口播已取消，即使缓存仍旧ready也零派发", async () => {
    const f = await sqliteFixture();
    await f.client.project.update({ where: { id: f.project.id }, data: { activeNarrationRecordId: null, activeNarrationSubtitleRevisionId: null } });
    const result = await runAssetPlanningGeneration({ db: f.db, project: f.project });
    expect(result.statusCode).toBe(409); expect(assetPlanner).not.toHaveBeenCalled();
  });
  it("候选持久化后来源再变化，最终事务仍拒绝激活", async () => {
    const f = await sqliteFixture();
    for (const row of buildPricingCatalogSeed({ llm: { mode: "stub" }, media: { deploymentScope: "cn-beijing" } })) f.db.providerModelCatalog.set(row.id, row);
    assetPlanner.mockResolvedValue(task9Plan(f));
    const writer = f.db.secondAggregateWriter!, save = writer.saveAssetPlan.bind(writer); let writes = 0;
    vi.spyOn(writer, "saveAssetPlan").mockImplementation(async record => {
      await save(record); writes++;
      if (writes === 2) await f.client.project.update({ where: { id: f.project.id }, data: { activeNarrationRecordId: null, activeNarrationSubtitleRevisionId: null, activeAssetPlanRecordId: null, status: "script_ready" } });
    });
    const result = await runAssetPlanningGeneration({ db: f.db, project: f.project });
    expect(result.statusCode, JSON.stringify(result.body)).toBe(409); expect(writes).toBeGreaterThanOrEqual(2);
    expect(assetPlanner).toHaveBeenCalledTimes(1);
    const current = await f.client.project.findUniqueOrThrow({ where: { id: f.project.id } });
    expect(current.activeAssetPlanRecordId).toBeNull(); expect(current.status).toBe("script_ready");
  });
});

describe("Task9A 真实提交冻结", () => {
  it.each(["same", "storyboard", "audio"])("同key %s重放按冻结上游判定", async change => {
    const f = await readyFixture();
    for (const row of buildPricingCatalogSeed({ llm: { mode: "stub" }, media: { deploymentScope: "cn-beijing" } })) f.db.providerModelCatalog.set(row.id, row);
    await seedGlobalVoiceProfiles(f.db);
    const repository = createGenerationRunRepository(f.db);
    const captured = (await captureStoryboardNarrationSource(f.db, f.project.id, f.project.ownerId)).identity;
    const dispatch = vi.fn(async (runId: string) => {
      const run = (await repository.getRunById(runId))!;
      expect(run.dispatchPayloadJson.narration_source).toEqual(captured);
      await repository.updateRunStatus(runId, "succeeded", { releaseLease: true, now: new Date() });
      return { dispatched: true, outcome: { status: "succeeded", response: { statusCode: 200, body: {} } } };
    });
    const context = { payload: { idempotency_key: "asset-key" }, params: { projectId: f.project.id }, auth: { anonymous: false, userId: f.project.ownerId }, app: { db: f.db, generationRunRepository: repository, generationRunDispatcher: { dispatch } } } as unknown as RouteContext;
    expect((await submitGenerationRun(context, "asset_plan.generate", undefined, {})).statusCode).toBe(200);
    if (change === "storyboard") f.plan.segments[0]!.scene_description = "外部编辑";
    if (change === "audio") f.db.narrationRecords.set(f.record.id, { ...f.record, output: { ...f.record.output!, audio: { ...f.record.output!.audio, sha256: "b".repeat(64) } } });
    const replay = await submitGenerationRun(context, "asset_plan.generate", undefined, {});
    expect(replay.statusCode, JSON.stringify(replay.body)).toBe(change === "same" ? 200 : 409);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
});

describe("Task9A R1 新口播替换冷缓存", () => {
  it("另一实例已切换到新的confirmed口播，旧排队身份零派发", async () => {
    const f = await sqliteFixture();
    const expected = (await captureStoryboardNarrationSource(f.db, f.project.id, f.project.ownerId)).identity;
    const oldRun = await f.client.generationRun.findUniqueOrThrow({ where: { id: "run" } });
    const oldSnapshot = await f.client.runConfigurationSnapshot.findUniqueOrThrow({ where: { id: "snapshot" } });
    await f.client.runConfigurationSnapshot.create({ data: { ...oldSnapshot, id: "snapshot-new", runId: "run-new" } });
    await f.client.generationRun.create({ data: { ...oldRun, id: "run-new", idempotencyKey: "run-new", runConfigurationSnapshotId: "snapshot-new" } });
    const oldRow = await f.client.narrationRecord.findUniqueOrThrow({ where: { id: "narration" } });
    const output = { ...f.record.output!, initialSubtitleRevisionId: "subtitle-new" };
    await f.client.narrationRecord.create({ data: { ...oldRow, id: "narration-new", generationRunId: "run-new", configurationSnapshotId: "snapshot-new", initialSubtitleRevisionId: null, status: "generating", outputJson: Prisma.DbNull, spokenTextSha256: null, confirmedAt: null, confirmedBy: null, acceptedDurationBandSnapshotJson: Prisma.DbNull } });
    const oldSubtitle = await f.client.narrationSubtitleRevision.findUniqueOrThrow({ where: { id: "subtitle" } });
    await f.client.narrationSubtitleRevision.create({ data: { ...oldSubtitle, id: "subtitle-new", narrationRecordId: "narration-new" } });
    await f.client.narrationRecord.update({ where: { id: "narration-new" }, data: { initialSubtitleRevisionId: "subtitle-new", status: "confirmed", outputJson: output, spokenTextSha256: oldRow.spokenTextSha256, confirmedAt: oldRow.confirmedAt, confirmedBy: oldRow.confirmedBy, acceptedDurationBandSnapshotJson: oldRow.acceptedDurationBandSnapshotJson! } });
    await f.client.project.update({ where: { id: f.project.id }, data: { activeNarrationRecordId: "narration-new", activeNarrationSubtitleRevisionId: "subtitle-new" } });
    expect(f.project.activeNarrationRecordId).toBe("narration");
    expect((await captureStoryboardNarrationSource(f.db, f.project.id, f.project.ownerId)).identity!.narrationRecordId).toBe("narration-new");
    const result = await runAssetPlanningGeneration({ db: f.db, project: f.project, expectedNarrationSource: expected });
    expect(result.statusCode, JSON.stringify(result.body)).toBe(409); expect(assetPlanner).not.toHaveBeenCalled();
  });
});

import { captureNarrationAssetsSource, withNarrationAssetsSource } from "../../../backend/src/modules/assets/narration-assets-context.js";
describe("Task9B 数据库资产来源门禁", () => {
  it.each(["script", "subtitle", "plan", "narration"])("冷实例%s变化阻止旧来源动作", async change => {
    const f = await sqliteFixture();
    for (const row of buildPricingCatalogSeed({ llm: { mode: "stub" }, media: { deploymentScope: "cn-beijing" } })) f.db.providerModelCatalog.set(row.id, row);
    assetPlanner.mockResolvedValue(task9Plan(f));
    expect((await runAssetPlanningGeneration({ db: f.db, project: f.project })).statusCode).toBe(200);
    const captured = await captureNarrationAssetsSource(f.db, f.project.id, f.project.ownerId);
    if (change === "script") await f.client.scriptRecord.update({ where: { id: f.script.id }, data: { scriptText: "已变化的正文。" } });
    if (change === "plan") await f.client.project.update({ where: { id: f.project.id }, data: { activeAssetPlanRecordId: null } });
    if (change === "narration") await f.client.project.update({ where: { id: f.project.id }, data: { activeNarrationRecordId: null, activeNarrationSubtitleRevisionId: null } });
    if (change === "subtitle") {
      const old = await f.client.narrationSubtitleRevision.findUniqueOrThrow({ where: { id: "subtitle" } });
      await f.client.narrationSubtitleRevision.create({ data: { ...old, id: "subtitle-new", subtitleSettingsHash: "b".repeat(64) } });
      await f.client.project.update({ where: { id: f.project.id }, data: { activeNarrationSubtitleRevisionId: "subtitle-new" } });
    }
    const activate = vi.fn();
    await expect(withNarrationAssetsSource(f.db, f.project.id, f.project.ownerId, captured.identity, activate)).rejects.toThrow();
    expect(activate).not.toHaveBeenCalled();
    expect(f.project.activeNarrationRecordId).toBe("narration");
  });
});
