import { PrismaFirstAggregateWriter } from "../../../backend/src/db/repositories/prisma-first-aggregate-writer.js";
import Database from "better-sqlite3";
import { applyAllDatabaseMigrations } from "../db/migration-test-utils.js";
import { createPrismaClient } from "../../../backend/src/db/prisma-client.js";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
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
afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    for (const c of clients.splice(0))
        await c.$disconnect();
    for (const p of dirs.splice(0)) {
        if (!resolve(p).startsWith(resolve(tmpdir()) + sep) || !p.includes("narration-task5-test-"))
            throw Error("unsafe_cleanup");
        rmSync(p, { recursive: true, force: true });
    }
});
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
    app.db.projectGenerationConfigurations.set("c", { id: "c", projectId: project.id, revision: 1, schemaVersion: "generation_configuration_v1", configurationJson: config, sourceUserPreferenceRevision: null, createdAt: new Date(), updatedAt: new Date() });
    app.db.scriptRecords.set("s", { id: "s", projectId: project.id, topicPackageId: "t", scriptText: "你好", validationResultJson: { stage: "script_local_validation", decision: "pass", errors: [], warnings: [], metrics: {} }, reviewStatus: "skipped", createdAt: new Date() } as never);
    app.db.topicPackages.set("t", { id: "t", projectId: project.id, durationBandJson: { min_sec: 1, max_sec: 5 } } as never);
    return { app, project, url: "/api/projects/" + project.id, hash: narrationTextHash("你好") };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
async function confirmScript(f: Awaited<ReturnType<typeof fixture>>) { expect((await f.app.inject({ method: "POST", url: f.url + "/script/s/confirm", auth, payload: { source_text_sha256: f.hash } })).statusCode).toBe(200); }
function generateRequest(f: Awaited<ReturnType<typeof fixture>>, key = "k") { return { method: "POST", url: f.url + "/script/narration/generate", auth, payload: { source_script_record_id: "s", expected_configuration_revision: 1, idempotency_key: key } }; }
function syntheticProvider() {
    const words = [{ text: "你", begin_index: 0, end_index: 1, begin_time: 100, end_time: 400 }, { text: "好", begin_index: 1, end_index: 2, begin_time: 400, end_time: 700 }];
    const event = (name: string, output?: unknown) => ({ kind: "json" as const, elapsedMs: 0, data: { header: { event: name, task_id: "task" }, payload: output === undefined ? {} : { output } } });
    return new DashScopeNarrationProvider({ client: { async synthesize() { return { pcm: Buffer.alloc(48000), providerTaskId: "task", providerRequestId: null, usageCharacters: 9, sentences: [{ providerSentenceIndex: 0, originalText: "你好", normalizedText: "你好", words }], rawEvents: [event("task-started"), event("result-generated", { type: "sentence-begin", sentence: { index: 0 } }), { kind: "audio", elapsedMs: 0, byteOffset: 0, byteLength: 48000 }, event("result-generated", { type: "sentence-end", sentence: { index: 0, words }, original_text: "你好", normalized_text: "你好" }), event("task-finished")] }; } } });
}
async function untilDone(f: Awaited<ReturnType<typeof fixture>>, runId: string) {
    for (let i = 0; i < 100; i++) {
        const run = await f.app.generationRunRepository.getRunById(runId);
        if (run && run.status !== "pending_dispatch" && run.status !== "running")
            return run;
        await new Promise(r => setTimeout(r, 5));
    }
    throw Error("test_dispatch_timeout");
}
async function readyCandidate(f: Awaited<ReturnType<typeof fixture>>, key: string) { const r = await f.app.inject(generateRequest(f, key)); expect(r.statusCode, JSON.stringify(r.json())).toBe(202); expect((await untilDone(f, r.json().generation_run_id)).status).toBe("succeeded"); return f.app.db.narrationRecords.get(r.json().narration_record_id)!; }
function confirmRequest(f: Awaited<ReturnType<typeof fixture>>, record: Awaited<ReturnType<typeof readyCandidate>>, active: string | null = null, band = { minMs: 1000, maxMs: 5000 }) { return { method: "POST", url: f.url + "/script/narrations/" + record.id + "/confirm", auth, payload: { source_text_sha256: record.sourceTextSha256, settings_sha256: record.settingsSha256, expected_active_narration_record_id: active, target_duration_band_snapshot: band, accept_duration_outside_band: true } }; }
async function activeFixture() { const f = await fixture(syntheticProvider()); await confirmScript(f); const candidate = await readyCandidate(f, 'ready'); expect((await f.app.inject(confirmRequest(f, candidate))).statusCode).toBe(200); return { ...f, record: f.app.db.narrationRecords.get(candidate.id)! }; }
describe('Task9C 字幕配置派生', () => {
    it('保存字幕预设派生版本，保留原始bundle和音频，重复保存幂等', async () => {
        const f = await activeFixture(), before = f.app.db.projects.get(f.project.id)!.activeNarrationSubtitleRevisionId;
        const config = [...f.app.db.projectGenerationConfigurations.values()][0]!;
        const presets = await f.app.inject({ method: 'GET', url: '/api/creative-presets', auth });
        const { SUBTITLE_STYLE_PRESET_REGISTRY_V1 } = await import('../../../shared/src/index.js');
        const creative = { ...config.configurationJson.creative, subtitle_style_preset_id: SUBTITLE_STYLE_PRESET_REGISTRY_V1.find(p => p.preset_id !== config.configurationJson.creative.subtitle_style_preset_id)!.preset_id };
        const save = () => f.app.inject({ method: 'PATCH', url: f.url + '/generation-configuration', auth, payload: { expected_revision: config.revision, video: config.configurationJson.video, creative, capabilities: config.configurationJson.capabilities } });
        const r = await save();
        expect(r.statusCode, JSON.stringify(r.json())).toBe(200);
        expect(r.json().subtitle_update, JSON.stringify(r.json())).toEqual({ status: "ready" });
        const { ProjectGenerationConfigurationResponse } = await import("../../../shared/src/index.js");
        expect(ProjectGenerationConfigurationResponse.safeParse(r.json()).success).toBe(true);
        expect(f.app.db.projects.get(f.project.id)!.activeNarrationSubtitleRevisionId).not.toBe(before);
        expect(f.app.db.narrationRecords.get(f.record.id)!.output).toEqual(f.record.output);
        const revision = f.app.db.narrationSubtitleRevisions.get(f.app.db.projects.get(f.project.id)!.activeNarrationSubtitleRevisionId!)!;
        expect(revision.subtitleSettingsSnapshotJson.presetId).toBe(creative.subtitle_style_preset_id);
        expect(f.app.db.generationRuns.size).toBe(1);
    });
    it('显式字幕重试按当前设置幂等且跨用户拒绝', async () => {
        const f = await activeFixture(), revision = f.app.db.narrationSubtitleRevisions.get(f.app.db.projects.get(f.project.id)!.activeNarrationSubtitleRevisionId!)!;
        const request = { method: 'POST', url: f.url + '/script/narrations/' + f.record.id + '/subtitles', auth, payload: { expected_narration_record_id: f.record.id, expected_audio_hash: f.record.output!.audio.sha256, subtitle_settings_hash: revision.subtitleSettingsHash } };
        const r = await f.app.inject(request);
        expect(r.statusCode, JSON.stringify(r.json())).toBe(200);
        expect(r.json().revision.id).toBe(revision.id);
        expect((await f.app.inject({ ...request, auth: buildTestAuth({ userId: 'other' }) })).statusCode).toBe(404);
        expect(f.app.db.narrationSubtitleRevisions.size).toBe(1);
    });
});
import { NarrationBundleStorage } from "../../../backend/src/modules/narration/narration-bundle-storage.js";
import { deriveNarrationSubtitleRevision } from "../../../backend/src/modules/narration/narration-subtitle-revision.service.js";
import { resolveNarrationSubtitleSettings, narrationSubtitleSettingsHash } from "../../../backend/src/modules/narration/narration-subtitle-settings.js";
import { SUBTITLE_STYLE_PRESET_REGISTRY_V1 } from "../../../shared/src/index.js";
function configOf(f: Awaited<ReturnType<typeof activeFixture>>) { return [...f.app.db.projectGenerationConfigurations.values()][0]!; }
function newCreative(f: Awaited<ReturnType<typeof activeFixture>>, size = 52) { return { ...configOf(f).configurationJson.creative, subtitle_style_preset_id: SUBTITLE_STYLE_PRESET_REGISTRY_V1[0]!.preset_id, subtitle_style_overrides: { font_size_px: size } }; }
async function saveCreative(f: Awaited<ReturnType<typeof activeFixture>>, creative = newCreative(f)) { const c = configOf(f); return f.app.inject({ method: 'PATCH', url: f.url + '/generation-configuration', auth, payload: { expected_revision: c.revision, video: c.configurationJson.video, capabilities: c.configurationJson.capabilities, creative } }); }
describe('Task9C 生命周期和原件不变量', () => {
    it('仅样式变化SRT相同仍创建完整快照，重复保存/切回复用历史', async () => {
        const f = await activeFixture(), initial = f.app.db.narrationSubtitleRevisions.get(f.project.activeNarrationSubtitleRevisionId!)!;
        const original = readFileSync(join(f.project.storageRootDir, f.record.output!.audio.uri));
        const bundle = readFileSync(join(f.project.storageRootDir, 'narration-runs', f.record.generationRunId, 'bundle', 'manifest.json'));
        expect((await saveCreative(f)).json().subtitle_update).toEqual({ status: 'ready' });
        const first = f.app.db.narrationSubtitleRevisions.get(f.project.activeNarrationSubtitleRevisionId!)!;
        expect(first.id).not.toBe(initial.id);
        expect(first.srt.sha256).toBe(initial.srt.sha256);
        expect((await saveCreative(f)).statusCode).toBe(200);
        expect(f.project.activeNarrationSubtitleRevisionId).toBe(first.id);
        expect((await saveCreative(f, newCreative(f, 56))).statusCode).toBe(200);
        expect(f.project.activeNarrationSubtitleRevisionId).not.toBe(first.id);
        expect((await saveCreative(f)).statusCode).toBe(200);
        expect(f.project.activeNarrationSubtitleRevisionId).toBe(first.id);
        expect(readFileSync(join(f.project.storageRootDir, f.record.output!.audio.uri))).toEqual(original);
        expect(readFileSync(join(f.project.storageRootDir, 'narration-runs', f.record.generationRunId, 'bundle', 'manifest.json'))).toEqual(bundle);
        expect(f.app.db.generationRuns.size).toBe(1);
    });
    it('本地派生失败保留活动字幕及旧成品，重试恢复', async () => {
        const f = await activeFixture(), old = f.project.activeNarrationSubtitleRevisionId;
        f.project.activeComposeRecordId = 'old-compose';
        f.project.activeRenderJobRecordId = 'old-render';
        const commit = vi.spyOn(NarrationBundleStorage.prototype, 'commitSubtitleRevision').mockRejectedValueOnce(new Error('test_disk_failure'));
        const r = await saveCreative(f);
        expect(r.statusCode).toBe(200);
        expect(r.json().subtitle_update).toEqual({ status: 'pending', error: 'narration_subtitle_update_required' });
        expect(commit).toHaveBeenCalledOnce();
        expect(f.project.activeNarrationSubtitleRevisionId).toBe(old);
        expect(f.project.activeRenderJobRecordId).toBe('old-render');
        const revision = await deriveNarrationSubtitleRevision(f.app, f.project.id, 'u');
        expect(revision.id).not.toBe(old);
        expect(f.project.activeRenderJobRecordId).toBeNull();
        expect(f.project.activeComposeRecordId).toBeNull();
    });
    it.each(['settings', 'narration', 'preset'])('派生文件完成后%s变化拒绝旧结果激活', async (change) => {
        const f = await activeFixture(), old = f.project.activeNarrationSubtitleRevisionId;
        configOf(f).configurationJson.creative = newCreative(f);
        const original = NarrationBundleStorage.prototype.commitSubtitleRevision;
        const preset = SUBTITLE_STYLE_PRESET_REGISTRY_V1[0]!, version = preset.preset_version;
        vi.spyOn(NarrationBundleStorage.prototype, 'commitSubtitleRevision').mockImplementationOnce(async function (value) {
            const result = await original.call(this, value);
            if (change === 'settings')
                configOf(f).configurationJson.creative = newCreative(f, 56);
            if (change === 'narration')
                f.project.activeNarrationRecordId = null;
            if (change === 'preset')
                preset.preset_version = 'v99';
            return result;
        });
        try {
            await expect(deriveNarrationSubtitleRevision(f.app, f.project.id, 'u')).rejects.toThrow();
            expect(f.project.activeNarrationSubtitleRevisionId).toBe(old);
            expect(f.app.db.narrationSubtitleRevisions.size).toBe(1);
        }
        finally {
            preset.preset_version = version;
        }
    });
    it('旧请求配置hash或音频hash冲突无新增revision', async () => {
        const f = await activeFixture(), settings = narrationSubtitleSettingsHash(resolveNarrationSubtitleSettings(configOf(f).configurationJson));
        for (const field of ['expected_audio_hash', 'subtitle_settings_hash']) {
            const request = { expected_narration_record_id: f.record.id, expected_audio_hash: f.record.output!.audio.sha256, subtitle_settings_hash: settings, [field]: 'a'.repeat(64) };
            expect((await f.app.inject({ method: 'POST', url: f.url + '/script/narrations/' + f.record.id + '/subtitles', auth, payload: request })).statusCode).toBe(409);
        }
        expect(f.app.db.narrationSubtitleRevisions.size).toBe(1);
    });
});
import { runnable, persistentRunnable } from '../narration/subtitle-revision-test-context.js';
import { importNarrationManifest } from '../../../backend/src/modules/assets/narration-manifest-importer.js';
import { AssetManifestV2 } from '../../../shared/src/index.js';
import { cp, mkdir, writeFile } from 'node:fs/promises';
async function manifestFixture() { const f = await runnable(), manifest = await importNarrationManifest(f); const image = join(f.path, 'visual.png'); await writeFile(image, 'visual-bytes'); manifest.artifacts.push({ artifact_id: 'image', artifact_type: 'image', origin: 'local', file_uri: image, created_at: new Date().toISOString(), metadata: { width: 720, height: 1280 } }); f.db.assetManifestRecords.set('m', { id: 'm', projectId: 'p1', topicPackageId: 't1', scriptRecordId: 's1', storyboardRecordId: 'sb', assetPlanRecordId: 'ap', revision: 1, manifestJson: manifest, validationResultJson: { decision: 'pass' }, executionStateJson: null, graphTraceSummaryJson: null, runtimeDiagnosticsJson: null, createdAt: new Date() }); f.project.activeAssetManifestRecordId = 'm'; return { ...f, manifest, image }; }
describe('Task9C 视觉复用与真实数据库', () => {
    it('已有manifest只替换字幕引用，视觉文件和历史manifest不变', async () => {
        const f = await manifestFixture(), before = structuredClone(f.manifest), c = [...f.db.projectGenerationConfigurations.values()][0]!;
        c.configurationJson.creative.subtitle_style_preset_id = SUBTITLE_STYLE_PRESET_REGISTRY_V1[0]!.preset_id;
        const revision = await deriveNarrationSubtitleRevision({ db: f.db, storageBaseDir: f.path }, 'p1', f.project.ownerId);
        expect(f.project.activeAssetManifestRecordId).not.toBe('m');
        const next = AssetManifestV2.parse(f.db.assetManifestRecords.get(f.project.activeAssetManifestRecordId!)!.manifestJson);
        expect(next.subtitle_revision_id).toBe(revision.id);
        expect(next.artifacts.find(a => a.artifact_id === 'image')).toEqual(before.artifacts.find(a => a.artifact_id === 'image'));
        expect(next.executions).toEqual(before.executions);
        expect(readFileSync(f.image, 'utf8')).toBe('visual-bytes');
        expect(f.db.assetManifestRecords.get('m')!.manifestJson).toEqual(before);
    });
    it('SQLite清空Map仍从数据库派生并切活动字幕', async () => {
        const f = await persistentRunnable(), storage = join(f.path, 'storage', 'projects', 'p1');
        await mkdir(storage, { recursive: true });
        await cp(join(f.path, 'narration-runs'), join(storage, 'narration-runs'), { recursive: true });
        f.db.projects.clear();
        f.db.projectGenerationConfigurations.clear();
        f.db.narrationRecords.clear();
        f.db.narrationSubtitleRevisions.clear();
        const result = await deriveNarrationSubtitleRevision({ db: f.db, storageBaseDir: f.path }, 'p1', f.project.ownerId);
        expect((await f.client.project.findUniqueOrThrow({ where: { id: 'p1' } })).activeNarrationSubtitleRevisionId).toBe(result.id);
        expect(result.id).not.toBe('sub1');
        expect(await f.client.narrationSubtitleRevision.count()).toBe(2);
        expect((await deriveNarrationSubtitleRevision({ db: f.db, storageBaseDir: f.path }, 'p1', f.project.ownerId)).id).toBe(result.id);
    });
});
import { getNarrationProjectSnapshot } from '../../../backend/src/modules/projects/project-snapshot.service.js';
it('派生失败快照明确字幕待更新，重试后恢复ready', async () => {
    const f = await activeFixture();
    vi.spyOn(NarrationBundleStorage.prototype, 'commitSubtitleRevision').mockRejectedValueOnce(new Error('disk_failure'));
    await saveCreative(f);
    const snapshot = () => getNarrationProjectSnapshot(f.app.db, f.project.id, 'u', f.app.storageBaseDir, f.app.topicCandidateStore);
    expect((await snapshot()).narration_subtitle_readiness).toMatchObject({ ready: false, reason: 'narration_subtitle_update_required' });
    await deriveNarrationSubtitleRevision(f.app, f.project.id, 'u');
    expect((await snapshot()).narration_subtitle_readiness).toMatchObject({ ready: true, reason: null });
});
it('候选生成后字幕设置变化，确认时派生当前样式而不覆盖初始bundle', async () => {
    const f = await fixture(syntheticProvider());
    await confirmScript(f);
    const candidate = await readyCandidate(f, 'ready');
    const c = [...f.app.db.projectGenerationConfigurations.values()][0]!;
    c.configurationJson.creative.subtitle_style_preset_id = SUBTITLE_STYLE_PRESET_REGISTRY_V1[0]!.preset_id;
    const response = await f.app.inject(confirmRequest(f, candidate));
    expect(response.statusCode).toBe(200);
    expect(response.json().snapshot.narration_subtitle_readiness.ready).toBe(true);
    expect(f.project.activeNarrationSubtitleRevisionId).not.toBe(candidate.output!.initialSubtitleRevisionId);
});
import { runComposeGeneration } from '../../../backend/src/modules/compose/compose-run.service.js';
import { runRenderGeneration } from '../../../backend/src/modules/render/render-run.service.js';
it('字幕待更新时新compose/render在创建run前返回明确阻塞', async () => {
    const f = await activeFixture();
    configOf(f).configurationJson.creative = newCreative(f);
    for (const run of [runComposeGeneration, runRenderGeneration]) {
        const r = await run({ db: f.app.db, project: f.project });
        expect(r.statusCode).toBe(409);
        expect(r.body.error).toBe('narration_subtitle_update_required');
    }
    expect(f.app.db.composeRecords.size).toBe(0);
    expect(f.app.db.renderJobRecords.size).toBe(0);
});
async function coldFixture() { const f = await persistentRunnable(), storage = join(f.path, 'storage', 'projects', 'p1'); await mkdir(storage, { recursive: true }); await cp(join(f.path, 'narration-runs'), join(storage, 'narration-runs'), { recursive: true }); return { ...f, app: { db: f.db, storageBaseDir: f.path } }; }
it('SQLite字幕插入后活动指针写失败整笔回滚，重启后本地重试恢复', async () => {
    const f = await coldFixture(), sql = new Database(join(f.path, 'test.db'));
    sql.exec("CREATE TRIGGER fail_subtitle_activation BEFORE UPDATE OF activeNarrationSubtitleRevisionId ON Project WHEN (SELECT count(*) FROM NarrationSubtitleRevision)>1 BEGIN SELECT RAISE(ABORT, 'test_subtitle_inserted_then_activation_failed'); END");
    const failure = await deriveNarrationSubtitleRevision(f.app, 'p1', f.project.ownerId).catch(error => error);
    expect(failure).toMatchObject({ name: 'PrismaClientKnownRequestError', code: 'P2003' });
    expect(failure.message).toContain('tx.project.update');
    expect(await f.client.narrationSubtitleRevision.count()).toBe(1);
    expect((await f.client.project.findUniqueOrThrow({ where: { id: 'p1' } })).activeNarrationSubtitleRevisionId).toBe('sub1');
    sql.exec('DROP TRIGGER fail_subtitle_activation');
    sql.close();
    f.db.narrationSubtitleRevisions.clear();
    f.db.projects.clear();
    const r = await deriveNarrationSubtitleRevision(f.app, 'p1', f.project.ownerId);
    expect(r.id).not.toBe('sub1');
    expect(await f.client.narrationSubtitleRevision.count()).toBe(2);
});
it.each(['settings', 'narration'])('SQLite另一实例更换%s，旧派生不写DB', async (change) => {
    const f = await coldFixture(), other = await createPrismaClient(join(f.path, 'test.db'));
    clients.push(other);
    const original = NarrationBundleStorage.prototype.commitSubtitleRevision;
    vi.spyOn(NarrationBundleStorage.prototype, 'commitSubtitleRevision').mockImplementationOnce(async function (input) {
        const r = await original.call(this, input);
        if (change === 'narration')
            await other.project.update({ where: { id: 'p1' }, data: { activeNarrationRecordId: null } });
        else {
            const c = await other.projectGenerationConfiguration.findUniqueOrThrow({ where: { projectId: 'p1' } });
            const config = structuredClone(c.configurationJson) as any;
            config.creative.subtitle_style_preset_id = SUBTITLE_STYLE_PRESET_REGISTRY_V1[0]!.preset_id;
            await other.projectGenerationConfiguration.update({ where: { projectId: 'p1' }, data: { configurationJson: config, revision: { increment: 1 } } });
        }
        return r;
    });
    await expect(deriveNarrationSubtitleRevision(f.app, 'p1', f.project.ownerId)).rejects.toThrow();
    expect(await f.client.narrationSubtitleRevision.count()).toBe(1);
    expect((await f.client.project.findUniqueOrThrow({ where: { id: 'p1' } })).activeNarrationSubtitleRevisionId).toBe('sub1');
});
it.each(['missing', 'corrupt'])('当前设置字幕%s后保存失败必须持续pending，修复文件并显式重试恢复', async (kind) => {
    const f = await activeFixture(), revision = f.app.db.narrationSubtitleRevisions.get(f.project.activeNarrationSubtitleRevisionId!)!, path = join(f.project.storageRootDir, revision.srt.uri), original = readFileSync(path);
    if (kind === 'missing')
        await (await import('node:fs/promises')).unlink(path);
    else
        await writeFile(path, 'broken');
    const response = await saveCreative(f, configOf(f).configurationJson.creative);
    expect(response.json().subtitle_update.status).toBe('pending');
    const snapshot = await getNarrationProjectSnapshot(f.app.db, f.project.id, 'u', f.app.storageBaseDir, f.app.topicCandidateStore);
    expect(snapshot.narration_subtitle_readiness.ready).toBe(false);
    expect((await runComposeGeneration({ db: f.app.db, project: f.project })).body.error).toBe('narration_subtitle_update_required');
    await writeFile(path, original);
    await deriveNarrationSubtitleRevision(f.app, f.project.id, 'u');
    expect((await getNarrationProjectSnapshot(f.app.db, f.project.id, 'u', f.app.storageBaseDir, f.app.topicCandidateStore)).narration_subtitle_readiness.ready).toBe(true);
});
it('SQLite热Map与另一实例旧Map不得消费已失效compose', async () => {
    const f = await coldFixture();
    f.project.activeComposeRecordId = 'stale-compose';
    await deriveNarrationSubtitleRevision(f.app, 'p1', f.project.ownerId);
    const result = await runRenderGeneration({ db: f.db, project: f.project });
    expect(result.body.error).toBe('active_compose_missing');
    expect(f.project.activeComposeRecordId).toBeNull();
    f.project.activeComposeRecordId = 'stale-again';
    const again = await runRenderGeneration({ db: f.db, project: f.project });
    expect(again.body.error).toBe('active_compose_missing');
    expect(f.project.activeComposeRecordId).toBeNull();
});
import { createDbClient } from '../../../backend/src/db/client.js';
it('两个SQLite实例持有不同预设版本时，新目标已保存但未激活也阻止旧派生', async () => {
    const f = await coldFixture(), other = await createPrismaClient(join(f.path, 'test.db'));
    clients.push(other);
    const db2 = createDbClient();
    db2.narrationPersistence.prismaClient = other;
    const row = await f.client.projectGenerationConfiguration.findUniqueOrThrow({ where: { projectId: 'p1' } }), config = structuredClone(row.configurationJson) as any;
    const preset = SUBTITLE_STYLE_PRESET_REGISTRY_V1[0]!, oldVersion = preset.preset_version;
    config.creative.subtitle_style_preset_id = preset.preset_id;
    await f.client.projectGenerationConfiguration.update({ where: { projectId: 'p1' }, data: { configurationJson: config } });
    const oldEntered = deferred<void>(), newEntered = deferred<void>(), releaseOld = deferred<void>(), releaseNew = deferred<void>();
    const original = NarrationBundleStorage.prototype.commitSubtitleRevision;
    vi.spyOn(NarrationBundleStorage.prototype, 'commitSubtitleRevision').mockImplementation(async function (input: any) {
        const built = await original.call(this, input);
        if (input.settingsSnapshot.presetVersion === oldVersion) {
            oldEntered.resolve();
            await releaseOld.promise;
        }
        else {
            newEntered.resolve();
            await releaseNew.promise;
        }
        return built;
    });
    const old = deriveNarrationSubtitleRevision(f.app, 'p1', f.project.ownerId).catch(e => e);
    await oldEntered.promise;
    preset.preset_version = 'v99';
    const newer = deriveNarrationSubtitleRevision({ db: db2, storageBaseDir: f.path }, 'p1', f.project.ownerId).catch(e => e);
    await newEntered.promise;
    preset.preset_version = oldVersion;
    releaseOld.resolve();
    expect((await old).message).toBe('narration_subtitle_context_changed');
    expect((await f.client.project.findUniqueOrThrow({ where: { id: 'p1' } })).activeNarrationSubtitleRevisionId).toBe('sub1');
    // 已知更高版本目标不能被旧实例的新重试降回旧版本。
    await expect(deriveNarrationSubtitleRevision(f.app, 'p1', f.project.ownerId)).rejects.toThrow('narration_subtitle_resolver_stale');
    preset.preset_version = 'v99';
    releaseNew.resolve();
    try {
        const result = await newer;
        expect(result).not.toBeInstanceOf(Error);
        expect(result.subtitleSettingsSnapshotJson.presetVersion).toBe('v99');
    }
    finally {
        preset.preset_version = oldVersion;
    }
});
it('SQLite带manifest的字幕激活中途失败保留旧视觉和下游，成功后刷新热缓存', async () => {
    const f = await coldFixture(), m = await importNarrationManifest(f);
    await f.client.assetManifestRecord.create({ data: { id: 'm', projectId: 'p1', topicPackageId: 't1', scriptRecordId: 's1', storyboardRecordId: 'sb', assetPlanRecordId: 'ap', manifestJson: m, validationResultJson: { decision: 'pass' } } });
    await f.client.project.update({ where: { id: 'p1' }, data: { activeAssetManifestRecordId: 'm' } });
    f.project.activeAssetManifestRecordId = 'm';
    const sql = new Database(join(f.path, 'test.db'));
    sql.exec("CREATE TRIGGER fail_manifest_activation BEFORE UPDATE OF activeNarrationSubtitleRevisionId ON Project WHEN (SELECT count(*) FROM NarrationSubtitleRevision)>1 AND (SELECT count(*) FROM AssetManifestRecord)>1 BEGIN SELECT RAISE(ABORT, 'subtitle_and_manifest_created'); END");
    try {
        const failure = await deriveNarrationSubtitleRevision(f.app, 'p1', f.project.ownerId).catch(e => e);
        expect(failure).toMatchObject({ code: 'P2003' });
        expect(await f.client.narrationSubtitleRevision.count()).toBe(1);
        expect(await f.client.assetManifestRecord.count()).toBe(1);
        expect(f.project.activeAssetManifestRecordId).toBe('m');
    }
    finally {
        sql.exec('DROP TRIGGER fail_manifest_activation');
        sql.close();
    }
    const revision = await deriveNarrationSubtitleRevision(f.app, 'p1', f.project.ownerId);
    const project = await f.client.project.findUniqueOrThrow({ where: { id: 'p1' } });
    expect(project.activeNarrationSubtitleRevisionId).toBe(revision.id);
    expect(project.activeAssetManifestRecordId).not.toBe('m');
    expect(f.project.activeAssetManifestRecordId).toBe(project.activeAssetManifestRecordId);
    expect(f.db.assetManifestRecords.get(project.activeAssetManifestRecordId!)!.manifestJson.subtitle_revision_id).toBe(revision.id);
    expect((await f.client.assetManifestRecord.findUniqueOrThrow({ where: { id: 'm' } })).manifestJson).toEqual(m);
});
import * as asrClient from '../../../backend/src/modules/assets/providers/dashscope/dashscope-asr-client.js';
it('字幕保存与重试不派发TTS或ASR', async () => {
    const f = await activeFixture(), tts = vi.spyOn(DashScopeNarrationProvider.prototype, 'generate'), asr = vi.spyOn(asrClient, 'transcribeAudioFile');
    await saveCreative(f);
    await deriveNarrationSubtitleRevision(f.app, f.project.id, 'u');
    expect(tts).not.toHaveBeenCalled();
    expect(asr).not.toHaveBeenCalled();
    expect(f.app.db.generationRuns.size).toBe(1);
});
it('更高预设版本目标失败后，旧部署即使改覆盖配置也不能降级', async () => {
    const f = await activeFixture(), preset = SUBTITLE_STYLE_PRESET_REGISTRY_V1[0]!, version = preset.preset_version;
    try {
        preset.preset_version = 'v99';
        vi.spyOn(NarrationBundleStorage.prototype, 'commitSubtitleRevision').mockRejectedValueOnce(new Error('disk_failure'));
        expect((await saveCreative(f)).json().subtitle_update.status).toBe('pending');
        preset.preset_version = version;
        configOf(f).configurationJson.creative = newCreative(f, 56);
        await expect(deriveNarrationSubtitleRevision(f.app, f.project.id, 'u')).rejects.toThrow('narration_subtitle_resolver_stale');
    }
    finally {
        preset.preset_version = version;
    }
});
it('同字幕目标并发请求只激活一个revision并返回同一版本', async () => {
    const f = await activeFixture();
    configOf(f).configurationJson.creative = newCreative(f);
    const results = await Promise.all([deriveNarrationSubtitleRevision(f.app, f.project.id, 'u'), deriveNarrationSubtitleRevision(f.app, f.project.id, 'u')]);
    expect(results[0].id).toBe(results[1].id);
    expect(f.app.db.narrationSubtitleRevisions.size).toBe(2);
});
it.each(['ready_to_other', 'failed_to_none'])('历史预设版本约束跨%s切换保持，恢复高版本合法', async (scenario) => {
    const f = await activeFixture(), a = SUBTITLE_STYLE_PRESET_REGISTRY_V1[0]!, b = SUBTITLE_STYLE_PRESET_REGISTRY_V1[1]!, version = a.preset_version;
    try {
        a.preset_version = 'v99';
        if (scenario === 'failed_to_none')
            vi.spyOn(NarrationBundleStorage.prototype, 'commitSubtitleRevision').mockRejectedValueOnce(new Error('disk_failure'));
        const saved = await saveCreative(f);
        expect(saved.json().subtitle_update.status).toBe(scenario === 'failed_to_none' ? 'pending' : 'ready');
        a.preset_version = version;
        configOf(f).configurationJson.creative = { ...configOf(f).configurationJson.creative, subtitle_style_preset_id: scenario === 'failed_to_none' ? null : b.preset_id, subtitle_style_overrides: {} };
        await deriveNarrationSubtitleRevision(f.app, f.project.id, 'u');
        configOf(f).configurationJson.creative = newCreative(f);
        await expect(deriveNarrationSubtitleRevision(f.app, f.project.id, 'u')).rejects.toThrow('narration_subtitle_resolver_stale');
        a.preset_version = 'v99';
        expect((await deriveNarrationSubtitleRevision(f.app, f.project.id, 'u')).subtitleSettingsSnapshotJson.presetVersion).toBe('v99');
    }
    finally {
        a.preset_version = version;
    }
});
