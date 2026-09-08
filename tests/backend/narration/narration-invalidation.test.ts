import { afterEach, describe, expect, it, vi } from "vitest";
const scriptGraph = vi.hoisted(() => vi.fn());
vi.mock("../../../backend/src/runtime/orchestration/script-run-graph.js", () => ({ runScriptRunGraph: scriptGraph }));
import { runScriptGeneration } from "../../../backend/src/modules/script/script-run.service.js";
import { submitGenerationRun } from "../../../backend/src/modules/generation-run/submit-protocol.js";
import { createGenerationRunRepository } from "../../../backend/src/modules/generation-run/generation-run.repository.js";
import type { RouteContext } from "../../../backend/src/app.js";
const planner = vi.hoisted(() => vi.fn());
const segmentPlanner = vi.hoisted(() => vi.fn());
vi.mock("../../../backend/src/modules/storyboard/storyboard-generation.service.js", () => ({ generateStoryboardPlan: planner, regenerateSingleSegment: segmentPlanner }));
import { runStoryboardGeneration, runStoryboardSegmentRegeneration } from "../../../backend/src/modules/storyboard/storyboard-run.service.js";
const cleanup: Array<() => Promise<void> | void> = [];
afterEach(async () => { vi.restoreAllMocks(); planner.mockReset(); segmentPlanner.mockReset(); scriptGraph.mockReset(); for (const close of cleanup.splice(0).reverse()) await close(); });
import { createDbClient } from "../../../backend/src/db/client.js";
import { createProject } from "../../../backend/src/modules/projects/project.repository.js";
import { activateScriptRecord, saveScriptRecord } from "../../../backend/src/modules/script/script-record.repository.js";
import { DEFAULT_GENERATION_CONFIGURATION, hashProjectNarrationTtsSettings } from "../../../shared/src/index.js";
import { buildPricingCatalogSeed } from "../../../backend/src/modules/generation-cost/pricing-catalog.seed.js";
import { seedGlobalVoiceProfiles } from "../../../backend/src/modules/assets/voice/voice-profile.repository.js";
import { upsertProjectGenerationConfiguration } from "../../../backend/src/modules/generation-config/generation-config.repository.js";
import { NARRATION_FIRST_MODEL_POLICY_V1 as policy } from "../../../backend/src/modules/narration/narration-model-policy.js";
import { captureStoryboardNarrationSource, projectTtsHash } from "../../../backend/src/modules/narration/narration-invalidation.js";
import { narrationTextHash } from "../../../backend/src/modules/narration/narration-readiness.js";
import { NarrationRecord } from "../../../shared/src/index.js";
import { computeRunPayloadFingerprint } from "../../../backend/src/modules/generation-run/generation-run.service.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { applyAllDatabaseMigrations } from "../db/migration-test-utils.js";
import { createPrismaClient } from "../../../backend/src/db/prisma-client.js";
import { PrismaFirstAggregateWriter } from "../../../backend/src/db/repositories/prisma-first-aggregate-writer.js";
import { PrismaSecondAggregateWriter } from "../../../backend/src/db/repositories/prisma-second-aggregate-writer.js";
import { NarrationRepository } from "../../../backend/src/modules/narration/narration.repository.js";
import { DEFAULT_SUBTITLE_STYLE } from "../../../shared/src/index.js";
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
  f.db.narrationRecords.set(record.id, record);
  const plan = { plan_version: "storyboard_v1", source_script_record_id: f.script.id, source_topic_package_id: "topic", estimated_total_duration_sec: 2, segments: [{ segment_id: "s", order: 0, script_excerpt: f.script.scriptText, start_hint_sec: 0, end_hint_sec: 2, narrative_role: "opening", visual_intent: "推开城门", scene_description: "守将推开城门", visual_elements: ["城门"], framing_hint: "medium", content_type: "live_action", motion_hint: "push_in", editing_hint: "single", on_screen_text: [], linked_beats: [], linked_quotes: [], risk_notes: [], api_video_suitability: "remotion_sufficient" }], global_visual_notes: [] };
  const state = await captureStoryboardNarrationSource(f.db, f.project.id, f.project.ownerId);
  f.db.storyboardRecords.set("old", { id: "old", projectId: f.project.id, topicPackageId: "topic", scriptRecordId: f.script.id, planJson: plan, validationResultJson: { decision: "pass" }, executionStateJson: { narration_source: state.identity }, graphTraceSummaryJson: null, runtimeDiagnosticsJson: null, createdAt: new Date() });
  return { ...f, plan, record };
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
