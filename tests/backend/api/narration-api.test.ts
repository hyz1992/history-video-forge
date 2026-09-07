import { PrismaFirstAggregateWriter } from "../../../backend/src/db/repositories/prisma-first-aggregate-writer.js";
import Database from "better-sqlite3";
import { applyAllDatabaseMigrations } from "../db/migration-test-utils.js";
import { createPrismaClient } from "../../../backend/src/db/prisma-client.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { DashScopeNarrationProvider } from "../../../backend/src/modules/narration/providers/dashscope-narration-provider.js";
import { describe, expect, it, afterEach, vi } from "vitest";
import { buildApp } from "../../../backend/src/app.js";
import { prepareQuoteProject, seedQuotableCatalog } from "../cost/quote-test-context.js";
import { buildTestAuth } from "../auth/test-utils.js";
import { narrationTextHash } from "../../../backend/src/modules/narration/narration-readiness.js";
import { DEFAULT_GENERATION_CONFIGURATION } from "../../../shared/src/index.js";
import { seedGlobalVoiceProfiles } from "../../../backend/src/modules/assets/voice/voice-profile.repository.js";
import { NARRATION_FIRST_MODEL_POLICY_V1 as policy } from "../../../backend/src/modules/narration/narration-model-policy.js";
const auth = buildTestAuth({ userId: "u" });
const clients: Awaited<ReturnType<typeof createPrismaClient>>[] = [];
const dirs: string[] = [];
afterEach(async () => { vi.unstubAllEnvs(); for (const c of clients.splice(0))
    await c.$disconnect(); for (const p of dirs.splice(0)) {
    if (!resolve(p).startsWith(resolve(tmpdir()) + sep) || !p.includes("narration-task5-test-"))
        throw Error("unsafe_cleanup");
    rmSync(p, { recursive: true, force: true });
} });
async function fixture(provider?: Pick<DashScopeNarrationProvider, "generate">) {
    const dir = mkdtempSync(join(tmpdir(), "narration-task5-test-"));
    dirs.push(dir);
    const app = buildApp({ skipSnapshotLoad: true, narrationProvider: provider });
    await seedQuotableCatalog(app);
    await seedGlobalVoiceProfiles(app.db);
    const project = await prepareQuoteProject(app.db, "u");
    project.narrationTimingMode = "narration_first_v1";
    project.activeScriptRecordId = "s";
    project.activeTopicPackageId = "t";
    project.storageRootDir = dir;
    const config = structuredClone(DEFAULT_GENERATION_CONFIGURATION);
    config.capabilities["tts.synthesize"] = { mode: "fixed", provider_model_id: policy.default_provider_model_id };
    config.creative.voice_profile_id = policy.default_voice_profile_id;
    app.db.projectGenerationConfigurations.clear();
    app.db.projectGenerationConfigurations.set(project.id, { id: "c", projectId: project.id, revision: 1, schemaVersion: "generation_configuration_v1", configurationJson: config, sourceUserPreferenceRevision: null, createdAt: new Date(), updatedAt: new Date() });
    app.db.scriptRecords.set("s", { id: "s", projectId: project.id, topicPackageId: "t", scriptText: "你好", validationResultJson: { stage: "script_local_validation", decision: "pass", errors: [], warnings: [], metrics: {} }, reviewStatus: "skipped", createdAt: new Date() } as never);
    app.db.topicPackages.set("t", { id: "t", projectId: project.id, durationBandJson: { min_sec: 1, max_sec: 5 } } as never);
    return { app, project, url: "/api/projects/" + project.id, hash: narrationTextHash("你好") };
}
describe("口播显式确认与前置拒绝", () => {
    it("未确认文案拒绝并且不创建生成run", async () => { const f = await fixture(); const r = await f.app.inject({ method: "POST", url: f.url + "/script/narration/generate", auth, payload: { source_script_record_id: "s", expected_configuration_revision: 1, idempotency_key: "k" } }); expect(r.statusCode).toBe(409); expect(r.json().error).toBe("script_not_confirmed"); expect(f.app.db.generationRuns.size).toBe(0); });
    it("明确确认保存正文hash且重复确认保持凭据", async () => { const f = await fixture(); const q = { method: "POST", url: f.url + "/script/s/confirm", auth, payload: { source_text_sha256: f.hash } }; const a = await f.app.inject(q); expect(a.statusCode).toBe(200); const b = await f.app.inject(q); expect(b.json()).toEqual(a.json()); expect(f.app.db.scriptConfirmations.size).toBe(1); });
    it("确认正文hash冲突返回409且零凭据", async () => { const f = await fixture(); const r = await f.app.inject({ method: "POST", url: f.url + "/script/s/confirm", auth, payload: { source_text_sha256: "a".repeat(64) } }); expect(r.statusCode).toBe(409); expect(f.app.db.scriptConfirmations.size).toBe(0); });
    it("跨owner确认被拒绝", async () => { const f = await fixture(); const r = await f.app.inject({ method: "POST", url: f.url + "/script/s/confirm", auth: buildTestAuth({ userId: "other" }), payload: { source_text_sha256: f.hash } }); expect(r.statusCode).toBe(404); expect(f.app.db.scriptConfirmations.size).toBe(0); });
    it("未合格语速直接API拒绝，零run", async () => { const f = await fixture(); const r = await f.app.inject({ method: "POST", url: f.url + "/script/narration/generate", auth, payload: { source_script_record_id: "s", expected_configuration_revision: 1, idempotency_key: "k", settings_override: { rate: 1.1 } } }); expect(r.statusCode).toBe(422); expect(f.app.db.generationRuns.size).toBe(0); });
});
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
async function confirmScript(f: Awaited<ReturnType<typeof fixture>>) { expect((await f.app.inject({ method: "POST", url: f.url + "/script/s/confirm", auth, payload: { source_text_sha256: f.hash } })).statusCode).toBe(200); }
function generateRequest(f: Awaited<ReturnType<typeof fixture>>, key = "k") { return { method: "POST", url: f.url + "/script/narration/generate", auth, payload: { source_script_record_id: "s", expected_configuration_revision: 1, idempotency_key: key } }; }
function syntheticProvider() {
    const words = [{ text: "你", begin_index: 0, end_index: 1, begin_time: 100, end_time: 400 }, { text: "好", begin_index: 1, end_index: 2, begin_time: 400, end_time: 700 }];
    const event = (name: string, output?: unknown) => ({ kind: "json" as const, elapsedMs: 0, data: { header: { event: name, task_id: "task" }, payload: output === undefined ? {} : { output } } });
    return new DashScopeNarrationProvider({ client: { async synthesize() { return { pcm: Buffer.alloc(48000), providerTaskId: "task", providerRequestId: null, usageCharacters: 9, sentences: [{ providerSentenceIndex: 0, originalText: "你好", normalizedText: "你好", words }], rawEvents: [event("task-started"), event("result-generated", { type: "sentence-begin", sentence: { index: 0 } }), { kind: "audio", elapsedMs: 0, byteOffset: 0, byteLength: 48000 }, event("result-generated", { type: "sentence-end", sentence: { index: 0, words }, original_text: "你好", normalized_text: "你好" }), event("task-finished")] }; } } });
}
async function untilDone(f: Awaited<ReturnType<typeof fixture>>, runId: string) { for (let i = 0; i < 100; i++) {
    const run = await f.app.generationRunRepository.getRunById(runId);
    if (run && run.status !== "pending_dispatch" && run.status !== "running")
        return run;
    await new Promise(r => setTimeout(r, 5));
} throw Error("test_dispatch_timeout"); }
describe("口播提交和恢复生命周期", () => {
    it("持久化后202，同key复用，snapshot冻结有限参数且费用归script", async () => {
        const entered = deferred<void>(), release = deferred<void>();
        let calls = 0;
        const f = await fixture({ async generate(input) { calls++; entered.resolve(); await release.promise; return syntheticProvider().generate(input); } });
        await confirmScript(f);
        const a = await f.app.inject(generateRequest(f));
        expect(a.statusCode, JSON.stringify(a.json())).toBe(202);
        const id = a.json().generation_run_id;
        const snapshot = [...f.app.db.runConfigurationSnapshots.values()][0];
        expect(snapshot.stage).toBe("script");
        await entered.promise;
        const b = await f.app.inject(generateRequest(f));
        expect(b.json().generation_run_id).toBe(id);
        expect(calls).toBe(1);
        release.resolve();
        await untilDone(f, id);
        expect(f.app.db.projects.get(f.project.id)?.activeNarrationRecordId ?? null).toBeNull();
        expect([...f.app.db.narrationRecords.values()][0].status).toBe("ready");
        const usage = [...f.app.db.usageCostRecords.values()][0];
        expect(usage.outputUnits).toBe(9);
        expect(usage.actualCostMicros).toBe("1260");
        expect(usage.assetProviderJobRecordId).toBeNull();
    });
    it("未知远端结果不自动重发，同key返回旧run", async () => {
        let calls = 0;
        const f = await fixture({ async generate() { calls++; throw Error("socket_closed"); } });
        await confirmScript(f);
        const r = await f.app.inject(generateRequest(f));
        const id = r.json().generation_run_id;
        expect((await untilDone(f, id)).status).toBe("needs_reconciliation");
        expect([...f.app.db.narrationRecords.values()][0].status).toBe("unknown");
        await f.app.generationRunDispatcher.scanAndDispatch();
        const replay = await f.app.inject(generateRequest(f));
        expect(replay.json().generation_run_id).toBe(id);
        expect(calls).toBe(1);
        expect([...f.app.db.usageCostRecords.values()][0].actualCostMicros).toBeNull();
    });
    it("取消先落库，迟到完整结果不ready，保留真实usage", async () => {
        const entered = deferred<void>(), release = deferred<void>();
        const f = await fixture({ async generate(input) { entered.resolve(); await release.promise; return syntheticProvider().generate(input); } });
        await confirmScript(f);
        const r = await f.app.inject(generateRequest(f));
        await entered.promise;
        const cancel = await f.app.inject({ method: "POST", url: f.url + "/script/narrations/" + r.json().narration_record_id + "/cancel", auth, payload: {} });
        expect(cancel.statusCode).toBe(200);
        release.resolve();
        await new Promise(r => setTimeout(r, 30));
        expect([...f.app.db.narrationRecords.values()][0].status).toBe("cancelled");
        expect([...f.app.db.narrationRecords.values()][0].output).toBeNull();
        expect([...f.app.db.usageCostRecords.values()][0].outputUnits).toBe(9);
        expect(f.project.activeNarrationRecordId ?? null).toBeNull();
    });
    it("同key正文改动并重新确认后拒绝复用", async () => {
        const f = await fixture({ async generate() { throw Error("unknown"); } });
        await confirmScript(f);
        const r = await f.app.inject(generateRequest(f));
        await untilDone(f, r.json().generation_run_id);
        f.app.db.scriptRecords.get("s")!.scriptText = "你好呀。";
        const hash = narrationTextHash("你好呀。");
        await f.app.inject({ method: "POST", url: f.url + "/script/s/confirm", auth, payload: { source_text_sha256: hash } });
        const conflict = await f.app.inject(generateRequest(f));
        expect(conflict.statusCode).toBe(409);
        expect(conflict.json().error).toBe("generation_idempotency_payload_conflict");
        expect(f.app.db.generationRuns.size).toBe(1);
    });
});
async function readyCandidate(f: Awaited<ReturnType<typeof fixture>>, key: string) { const r = await f.app.inject(generateRequest(f, key)); expect(r.statusCode, JSON.stringify(r.json())).toBe(202); expect((await untilDone(f, r.json().generation_run_id)).status).toBe("succeeded"); return f.app.db.narrationRecords.get(r.json().narration_record_id)!; }
function confirmRequest(f: Awaited<ReturnType<typeof fixture>>, record: Awaited<ReturnType<typeof readyCandidate>>, active: string | null = null, band = { minMs: 1000, maxMs: 5000 }) { return { method: "POST", url: f.url + "/script/narrations/" + record.id + "/confirm", auth, payload: { source_text_sha256: record.sourceTextSha256, settings_sha256: record.settingsSha256, expected_active_narration_record_id: active, target_duration_band_snapshot: band, accept_duration_outside_band: true } }; }
describe("口播确认事务和恢复对抗", () => {
    it("同active重放不失效视觉，重新接受区间保留视觉，返回真实snapshot", async () => {
        const f = await fixture(syntheticProvider());
        await confirmScript(f);
        const candidate = await readyCandidate(f, "ready");
        const request = confirmRequest(f, candidate);
        const a = await f.app.inject(request);
        expect(a.statusCode, JSON.stringify(a.json())).toBe(200);
        expect(a.json().snapshot.narration_readiness.ready).toBe(true);
        f.project.activeStoryboardRecordId = "visual";
        const events = f.app.db.generationRunEvents.get(candidate.generationRunId)!.length;
        const replay = await f.app.inject(request);
        expect(replay.statusCode).toBe(200);
        expect(f.project.activeStoryboardRecordId).toBe("visual");
        expect(f.app.db.generationRunEvents.get(candidate.generationRunId)!.length).toBe(events);
        f.app.db.topicPackages.get("t")!.durationBandJson = { min_sec: 2, max_sec: 3 };
        const update = await f.app.inject(confirmRequest(f, candidate, candidate.id, { minMs: 2000, maxMs: 3000 }));
        expect(update.statusCode, JSON.stringify(update.json())).toBe(200);
        expect(f.project.activeStoryboardRecordId).toBe("visual");
    });
    it("不同候选并发确认只能一个赢家，迟到请求不覆盖", async () => {
        const f = await fixture(syntheticProvider());
        await confirmScript(f);
        const a = await readyCandidate(f, "a"), b = await readyCandidate(f, "b");
        const results = await Promise.all([f.app.inject(confirmRequest(f, a)), f.app.inject(confirmRequest(f, b))]);
        expect(results.map(r => r.statusCode).sort()).toEqual([200, 409]);
        expect([a.id, b.id]).toContain(f.project.activeNarrationRecordId);
    });
    it("既有provider intent但缺usage的冷恢复必须unknown且补未知费用，不重发", async () => {
        let calls = 0;
        const f = await fixture({ async generate() { calls++; throw Error("must_not_call"); } });
        await confirmScript(f);
        const original = f.app.generationRunDispatcher.dispatch;
        f.app.generationRunDispatcher.dispatch = async () => ({ dispatched: false, reason: "not_claimable" });
        const r = await f.app.inject(generateRequest(f));
        await new Promise(r => setImmediate(r));
        const id = r.json().generation_run_id;
        f.app.db.generationRunEvents.set(id, [{ id: "intent", generationRunId: id, segmentId: null, eventType: "narration_provider_intent", eventJson: { provider_request_key: "existing" }, createdAt: new Date() }]);
        f.app.generationRunDispatcher.dispatch = original;
        await original(id);
        expect(calls).toBe(0);
        expect((await f.app.generationRunRepository.getRunById(id))!.status).toBe("needs_reconciliation");
        expect([...f.app.db.usageCostRecords.values()]).toHaveLength(1);
        expect([...f.app.db.usageCostRecords.values()][0].actualCostMicros).toBeNull();
    });
    it("缺snapshot或文案硬校验漂移均拒绝外呼", async () => {
        for (const mode of ["snapshot", "validation"]) {
            let calls = 0;
            const f = await fixture({ async generate() { calls++; throw Error("must_not_call"); } });
            await confirmScript(f);
            const original = f.app.generationRunDispatcher.dispatch;
            f.app.generationRunDispatcher.dispatch = async () => ({ dispatched: false, reason: "not_claimable" });
            const r = await f.app.inject(generateRequest(f));
            await new Promise(r => setImmediate(r));
            if (mode === "snapshot")
                f.app.db.runConfigurationSnapshots.clear();
            else
                f.app.db.scriptRecords.get("s")!.validationResultJson = { decision: "hard_fail" };
            f.app.generationRunDispatcher.dispatch = original;
            await original(r.json().generation_run_id);
            expect(calls).toBe(0);
            expect((await f.app.generationRunRepository.getRunById(r.json().generation_run_id))!.status).toBe("failed");
        }
    });
});
describe("真实SQLite费用授权", () => {
    it("清空Map仍可读费用，另一client转移owner后旧owner拒绝/admin保留", async () => {
        const dir = mkdtempSync(join(tmpdir(), "narration-task5-test-"));
        dirs.push(dir);
        const path = join(dir, "isolated.db"), sqlite = new Database(path);
        applyAllDatabaseMigrations(sqlite);
        sqlite.close();
        const client = await createPrismaClient(path), other = await createPrismaClient(path);
        clients.push(client, other);
        for (const id of ["u", "other"])
            await client.user.create({ data: { id, username: id, displayName: id, passwordHash: "h", role: "USER" } });
        await client.project.create({ data: { id: "p", ownerId: "u", createdById: "u", name: "p", storageKey: "p", storageDisplayName: "p" } });
        const writer = await PrismaFirstAggregateWriter.create(client, "u");
        const app = buildApp({ firstAggregateWriter: writer, skipSnapshotLoad: true, storageBaseDir: dir });
        expect(app.prismaClient).toBe(client);
        app.db.projects.clear();
        const call = (userId: string, role: "USER" | "ADMIN" = "USER") => app.inject({ method: "GET", url: "/api/projects/p/costs/records", auth: buildTestAuth({ userId, role }) });
        expect((await call("u")).statusCode).toBe(200);
        await other.project.update({ where: { id: "p" }, data: { ownerId: "other" } });
        expect((await call("u")).statusCode).toBe(404);
        expect((await call("other")).statusCode).toBe(200);
        expect((await call("u", "ADMIN")).statusCode).toBe(200);
        await other.project.update({ where: { id: "p" }, data: { archivedAt: new Date() } });
        expect((await call("u", "ADMIN")).statusCode).toBe(404);
        expect(app.db.projects.size).toBe(0);
    });
});
describe("提交事务来源变化与无凭据恢复", () => {
    it.each(["owner", "configuration", "source", "validation"])("事务提交前%s变化必须零写", async (mode) => {
        const f = await fixture(syntheticProvider());
        await confirmScript(f);
        const original = f.app.generationRunRepository.createRunTransaction;
        f.app.generationRunRepository.createRunTransaction = async (input) => { if (mode === "owner")
            f.project.ownerId = "other"; if (mode === "configuration")
            [...f.app.db.projectGenerationConfigurations.values()][0].revision++; if (mode === "source")
            f.app.db.scriptRecords.get("s")!.scriptText = "变更"; if (mode === "validation")
            f.app.db.scriptRecords.get("s")!.validationResultJson = { decision: "hard_fail" }; return original(input); };
        const r = await f.app.inject(generateRequest(f));
        expect(r.statusCode).toBe(mode === "owner" ? 404 : 409);
        expect(f.app.db.generationRuns.size).toBe(0);
        expect(f.app.db.runConfigurationSnapshots.size).toBe(0);
        expect(f.app.db.narrationRecords.size).toBe(0);
    });
    it("既有intent无凭据且当前local失效仍保留unknown费用", async () => {
        vi.stubEnv("ALIYUN_DASHSCOPE_API_KEY", "");
        const f = await fixture();
        await confirmScript(f);
        const original = f.app.generationRunDispatcher.dispatch;
        f.app.generationRunDispatcher.dispatch = async () => ({ dispatched: false, reason: "not_claimable" });
        const r = await f.app.inject(generateRequest(f));
        await new Promise(r => setImmediate(r));
        const id = r.json().generation_run_id;
        f.app.db.scriptRecords.get("s")!.validationResultJson = { decision: "hard_fail" };
        f.app.db.generationRunEvents.set(id, [{ id: "i", generationRunId: id, segmentId: null, eventType: "narration_provider_intent", eventJson: {}, createdAt: new Date() }]);
        f.app.generationRunDispatcher.dispatch = original;
        await original(id);
        expect((await f.app.generationRunRepository.getRunById(id))!.status).toBe("needs_reconciliation");
        expect([...f.app.db.narrationRecords.values()][0].status).toBe("unknown");
        expect([...f.app.db.usageCostRecords.values()][0].actualCostMicros).toBeNull();
    });
});


type SubmitFixture = Awaited<ReturnType<typeof fixture>>;
type SubmitMutation = { name: string; status: number; change: (f: SubmitFixture) => void };
const submitMutations: SubmitMutation[] = [
    { name: "owner原地变化", status: 404, change: f => { f.project.ownerId = "other"; } },
    { name: "owner对象替换", status: 404, change: f => { f.app.db.projects.set(f.project.id, { ...f.project, ownerId: "other" }); } },
    { name: "归档", status: 404, change: f => { Object.assign(f.project, { archivedAt: new Date() }); } },
    { name: "项目删除", status: 404, change: f => { f.app.db.projects.delete(f.project.id); } },
    { name: "模式变化", status: 409, change: f => { f.project.narrationTimingMode = "legacy_estimated"; } },
    { name: "正文原地变化", status: 409, change: f => { f.app.db.scriptRecords.get("s")!.scriptText = "新正文"; } },
    { name: "正文对象替换", status: 409, change: f => { f.app.db.scriptRecords.set("s", { ...f.app.db.scriptRecords.get("s")!, scriptText: "新正文" }); } },
    { name: "active脚本变化", status: 409, change: f => { f.project.activeScriptRecordId = null; } },
    { name: "脚本归属变化", status: 409, change: f => { f.app.db.scriptRecords.get("s")!.projectId = "other"; } },
    { name: "确认删除", status: 409, change: f => { f.app.db.scriptConfirmations.delete("s"); } },
    { name: "确认hash变化", status: 409, change: f => { f.app.db.scriptConfirmations.get("s")!.sourceTextSha256 = "a".repeat(64); } },
    { name: "确认归属变化", status: 409, change: f => { f.app.db.scriptConfirmations.get("s")!.projectId = "other"; } },
    { name: "本地校验失败", status: 409, change: f => { f.app.db.scriptRecords.get("s")!.validationResultJson = { stage: "script_local_validation", decision: "hard_fail", errors: [], warnings: [], metrics: {} }; } },
    { name: "伪pass仍有errors", status: 409, change: f => { f.app.db.scriptRecords.get("s")!.validationResultJson = { stage: "script_local_validation", decision: "pass", errors: ["invalid"], warnings: [], metrics: {} }; } },
    { name: "revision原地变化", status: 409, change: f => { f.app.db.projectGenerationConfigurations.get(f.project.id)!.revision++; } },
    { name: "配置对象替换", status: 409, change: f => { const old = f.app.db.projectGenerationConfigurations.get(f.project.id)!; f.app.db.projectGenerationConfigurations.set(f.project.id, { ...old, revision: 2 }); } },
    { name: "配置删除", status: 409, change: f => { f.app.db.projectGenerationConfigurations.clear(); } },
    { name: "TTS模型变化", status: 409, change: f => { f.app.db.projectGenerationConfigurations.get(f.project.id)!.configurationJson.capabilities["tts.synthesize"] = { mode: "auto" }; } },
    { name: "TTS音色变化", status: 409, change: f => { f.app.db.projectGenerationConfigurations.get(f.project.id)!.configurationJson.creative.voice_profile_id = "other"; } },
];
// 只在真实 createRunTransaction 中打开窗口；读取和 digest 均先执行原方法。
async function atSubmitWindow(f: SubmitFixture, window: "source_read" | "digest", change: () => void, action: () => Promise<unknown>) {
    let inside = false, hits = 0, completedReads = 0, completedDigests = 0;
    const originalCreate = f.app.generationRunRepository.createRunTransaction;
    const originalGet = f.app.db.scriptConfirmations.get.bind(f.app.db.scriptConfirmations);
    const originalDigest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
    const fire = () => { if (hits++ !== 0) throw Error("duplicate_window"); change(); };
    f.app.generationRunRepository.createRunTransaction = async input => { inside = true; try { return await originalCreate(input); } finally { inside = false; } };
    const getSpy = vi.spyOn(f.app.db.scriptConfirmations, "get").mockImplementation(key => {
        const value = originalGet(key);
        if (inside && hits === 0 && window === "source_read") { completedReads++; queueMicrotask(fire); }
        return value;
    });
    const digestSpy = vi.spyOn(globalThis.crypto.subtle, "digest").mockImplementation(async (algorithm, data) => {
        const result = await originalDigest(algorithm, data);
        const decoded = JSON.parse(new TextDecoder().decode(data));
        if (inside && hits === 0 && window === "digest" && decoded.modelSelection) { completedDigests++; fire(); }
        return result;
    });
    try { await action(); } finally { getSpy.mockRestore(); digestSpy.mockRestore(); f.app.generationRunRepository.createRunTransaction = originalCreate; }
    expect(hits).toBe(1);
    expect(window === "source_read" ? completedReads : completedDigests).toBe(1);
}
describe("EX6 Map提交最终来源窗口", () => {
    for (const window of ["source_read", "digest"] as const) {
        it.each(submitMutations)(window + "：$name必须拒绝且零新增", async mutation => {
            const provider = { generate: vi.fn(async () => { throw Error("must_not_call"); }) };
            const f = await fixture(provider);
            await confirmScript(f);
            // 保留真实 API/prepare/repository，仅阻止不合格的旧实现把反例变成后台外呼。
            const dispatch = vi.spyOn(f.app.generationRunDispatcher, "dispatch").mockResolvedValue({ dispatched: false, reason: "not_claimable" });
            let response!: Awaited<ReturnType<typeof f.app.inject>>;
            await atSubmitWindow(f, window, () => mutation.change(f), async () => { response = await f.app.inject(generateRequest(f)); });
            await new Promise(r => setImmediate(r));
            expect.soft(response.statusCode, JSON.stringify(response.json())).toBe(mutation.status);
            expect.soft(f.app.db.generationRuns.size).toBe(0);
            expect.soft(f.app.db.runConfigurationSnapshots.size).toBe(0);
            expect.soft(f.app.db.narrationRecords.size).toBe(0);
            expect.soft([...f.app.db.generationRunEvents.values()].flat().filter(e => e.eventType === "narration_provider_intent")).toHaveLength(0);
            expect(provider.generate).not.toHaveBeenCalled();
            dispatch.mockRestore();
        });
        it.each(["名称变化", "无变化", "显式neutral覆盖", "配置等值替换", "省略默认narration"])(window + "：%s仍正常生成", async mode => {
            const provider = syntheticProvider(), generate = vi.spyOn(provider, "generate");
            const f = await fixture(provider);
            await confirmScript(f);
            let response!: Awaited<ReturnType<typeof f.app.inject>>;
            const request = generateRequest(f);
            if (mode === "显式neutral覆盖") Object.assign(request.payload, { settings_override: { tone: "neutral", rate: 1 } });
            await atSubmitWindow(f, window, () => {
                if (mode === "名称变化") f.project.name = "合法新名称";
                if (mode === "配置等值替换") f.app.db.projectGenerationConfigurations.set(f.project.id, structuredClone(f.app.db.projectGenerationConfigurations.get(f.project.id)!));
                if (mode === "省略默认narration") delete f.app.db.projectGenerationConfigurations.get(f.project.id)!.configurationJson.creative.narration;
            }, async () => { response = await f.app.inject(request); });
            expect(response.statusCode, JSON.stringify(response.json())).toBe(202);
            expect((await untilDone(f, response.json().generation_run_id)).status).toBe("succeeded");
            expect(f.app.db.generationRuns.size).toBe(1);
            expect(f.app.db.runConfigurationSnapshots.size).toBe(1);
            expect(f.app.db.narrationRecords.size).toBe(1);
            expect(generate).toHaveBeenCalledTimes(1);
            expect(generate.mock.calls[0][0].settings).toMatchObject({ tone: "neutral", rate: 1 });
        });
    }
    it("同key并发沿用阶段锁，随后重放复用同一run和snapshot", async () => {
        const f = await fixture(syntheticProvider());
        await confirmScript(f);
        const results = await Promise.all([f.app.inject(generateRequest(f)), f.app.inject(generateRequest(f))]);
        expect(results.map(r => r.statusCode).sort()).toEqual([202, 409]);
        expect(results.find(r => r.statusCode === 409)!.json().error).toBe("project_stage_run_in_progress");
        const id = results.find(r => r.statusCode === 202)!.json().generation_run_id;
        expect((await untilDone(f, id)).status).toBe("succeeded");
        const replay = await f.app.inject(generateRequest(f));
        expect(replay.statusCode).toBe(202);
        expect(replay.json().generation_run_id).toBe(id);
        expect(f.app.db.generationRuns.size).toBe(1);
        expect(f.app.db.runConfigurationSnapshots.size).toBe(1);
        expect(f.app.db.narrationRecords.size).toBe(1);
    });
});


describe("EX7 Map文案确认最终来源", () => {
    const changes = submitMutations.filter(m => !/配置|revision|TTS|确认/.test(m.name));
    it.each(changes)("$name：确认前当前来源变化不落旧凭据", async mutation => {
        const f = await fixture();
        const get = f.app.db.scriptConfirmations.get.bind(f.app.db.scriptConfirmations);
        let reads = 0, hits = 0;
        const spy = vi.spyOn(f.app.db.scriptConfirmations, "get").mockImplementation(id => {
            const result = get(id);
            if (reads++ === 0) queueMicrotask(() => { hits++; mutation.change(f); });
            return result;
        });
        const response = await f.app.inject({ method: "POST", url: f.url + "/script/s/confirm", auth, payload: { source_text_sha256: f.hash } });
        spy.mockRestore();
        expect(hits).toBe(1);
        expect(reads).toBeGreaterThan(0);
        expect.soft(response.statusCode, JSON.stringify(response.json())).toBe(mutation.status);
        expect(f.app.db.scriptConfirmations.size).toBe(0);
        expect(f.app.db.generationRuns.size).toBe(0);
    });
    it.each(["project", "script"])("同hash确认凭据的%s归属不一致必须拒绝", async field => {
        const f = await fixture();
        await confirmScript(f);
        const confirmation = f.app.db.scriptConfirmations.get("s")!;
        if (field === "project") confirmation.projectId = "foreign";
        else confirmation.scriptRecordId = "foreign";
        const before = structuredClone(confirmation);
        const result = await f.app.inject({ method: "POST", url: f.url + "/script/s/confirm", auth, payload: { source_text_sha256: f.hash } });
        expect(result.statusCode).toBe(409);
        expect(f.app.db.scriptConfirmations.get("s")).toEqual(before);
    });
    it("正常改名与同来源重复确认保留首次凭据", async () => {
        const f = await fixture();
        const get = f.app.db.scriptConfirmations.get.bind(f.app.db.scriptConfirmations);
        let once = false;
        const spy = vi.spyOn(f.app.db.scriptConfirmations, "get").mockImplementation(id => { const result = get(id); if (!once) { once = true; queueMicrotask(() => { f.app.db.projects.set(f.project.id, { ...f.project, name: "新名称" }); }); } return result; });
        await confirmScript(f); spy.mockRestore();
        const before = structuredClone(f.app.db.scriptConfirmations.get("s"));
        await confirmScript(f);
        expect(f.app.db.scriptConfirmations.get("s")).toEqual(before);
    });
});
