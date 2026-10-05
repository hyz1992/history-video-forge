import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { buildApp } from "../../../backend/src/app.js";
import { createDbClient } from "../../../backend/src/db/client.js";
import { Prisma } from "../../../backend/src/generated/prisma/client.js";
import { createPrismaClient } from "../../../backend/src/db/prisma-client.js";
import { PrismaFirstAggregateWriter } from "../../../backend/src/db/repositories/prisma-first-aggregate-writer.js";
import { hydrateFirstAggregates } from "../../../backend/src/db/repositories/prisma-first-aggregate-hydrator.js";
import { applyAllDatabaseMigrations } from "../db/migration-test-utils.js";
import { buildTestAuth } from "../auth/test-utils.js";
import { buildPricingCatalogSeed } from "../../../backend/src/modules/generation-cost/pricing-catalog.seed.js";
import { seedGlobalVoiceProfiles } from "../../../backend/src/modules/assets/voice/voice-profile.repository.js";
import { DEFAULT_GENERATION_CONFIGURATION, GenerationConfigurationV1 } from "../../../shared/src/index.js";
import { upsertProjectGenerationConfiguration } from "../../../backend/src/modules/generation-config/generation-config.repository.js";
import { NARRATION_FIRST_MODEL_POLICY_V1 as policy } from "../../../backend/src/modules/narration/narration-model-policy.js";
const directories: string[] = [];
const clients: Awaited<ReturnType<typeof createPrismaClient>>[] = [];
afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    for (const c of clients.splice(0))
        await c.$disconnect();
    for (const d of directories.splice(0)) {
        if (!resolve(d).startsWith(resolve(tmpdir()) + requireSeparator()) || !d.includes("narration-task2b-"))
            throw Error("unsafe_cleanup");
        rmSync(d, { recursive: true, force: true });
    }
});
function requireSeparator() { return process.platform === "win32" ? "\\" : "/"; }
async function fixture() {
    const directory = mkdtempSync(join(tmpdir(), "narration-task2b-"));
    directories.push(directory);
    const path = join(directory, "test.db"), sql = new Database(path);
    applyAllDatabaseMigrations(sql);
    sql.close();
    const client = await createPrismaClient(path);
    clients.push(client);
    await client.user.create({ data: { id: "u", username: "u", displayName: "U", passwordHash: "h", role: "USER" } });
    const writer = await PrismaFirstAggregateWriter.create(client, "u");
    const app = buildApp({ firstAggregateWriter: writer, prismaClient: client, skipSnapshotLoad: true, storageBaseDir: join(directory, "storage") });
    for (const m of buildPricingCatalogSeed({ llm: { mode: "stub" }, media: { deploymentScope: "cn-beijing" } }))
        app.db.providerModelCatalog.set(m.id, m);
    await seedGlobalVoiceProfiles(app.db);
    return { app, client, writer, directory, path };
}
const auth = buildTestAuth({ userId: "u" });
function selected() { return { provider_model_id: policy.default_provider_model_id, voice_profile_id: policy.default_voice_profile_id, policy_version: policy.policy_version }; }
async function setDbPref(client: Awaited<ReturnType<typeof createPrismaClient>>, fixed = false, revision = 2) {
    const configuration = structuredClone(DEFAULT_GENERATION_CONFIGURATION);
    if (fixed)
        configuration.capabilities["tts.synthesize"] = { mode: "fixed", provider_model_id: "old-model" };
    await client.userGenerationPreference.upsert({ where: { userId: "u" }, create: { id: "pref", userId: "u", schemaVersion: "generation_configuration_v1", revision, configurationJson: configuration }, update: { revision, configurationJson: configuration } });
    return configuration;
}
describe("真实POST创建事务", () => {
    it("新项目在口播资格选择后仍继承两槽 fixed DeepSeek V4 Flash 默认", async () => {
        const { app, client } = await fixture();
        const configuration = await setDbPref(client);
        for (const slot of ["llm.smart", "llm.flash"] as const) {
            configuration.capabilities[slot] = { mode: "fixed", provider_model_id: `${slot}.deepseek.deepseek-v4-flash` };
        }
        await client.userGenerationPreference.update({ where: { userId: "u" }, data: { configurationJson: configuration } });
        const response = await app.inject({ method: "POST", url: "/api/projects", auth, payload: {
            name: "Flash 默认继承", narration_selection: selected(),
        } });
        expect(response.statusCode).toBe(201);
        const persisted = await client.projectGenerationConfiguration.findUniqueOrThrow({ where: { projectId: response.json().project_id } });
        expect(persisted.sourceUserPreferenceRevision).toBe(2);
        expect(persisted.configurationJson).toMatchObject({ capabilities: {
            "llm.smart": configuration.capabilities["llm.smart"],
            "llm.flash": configuration.capabilities["llm.flash"],
            "tts.synthesize": { mode: "fixed", provider_model_id: selected().provider_model_id },
        } });
        expect((await client.userGenerationPreference.findUniqueOrThrow({ where: { userId: "u" } })).configurationJson).toEqual(configuration);
    });

    it.each(["unknown_mode", "invalid_rate", "invalid_rate_with_selection"])("完整继承配置合同拒绝%s且零创建", async (invalid) => {
        const { app, client, writer } = await fixture();
        const configuration = await setDbPref(client);
        const corrupted = structuredClone(configuration) as unknown as Record<string, any>;
        if (invalid === "unknown_mode") {
            corrupted.capabilities["tts.synthesize"] = { mode: "unknown" };
        }
        else {
            corrupted.capabilities["tts.synthesize"] = { mode: "fixed", provider_model_id: selected().provider_model_id };
            corrupted.creative.voice_profile_id = selected().voice_profile_id;
            corrupted.creative.narration = { rate: 1.5, tone: "neutral" };
        }
        expect(GenerationConfigurationV1.safeParse(corrupted).success).toBe(false);
        await client.userGenerationPreference.update({ where: { userId: "u" }, data: { configurationJson: corrupted } });
        const create = vi.spyOn(writer, "createProjectWithGenerationConfiguration");
        const response = await app.inject({ method: "POST", url: "/api/projects", auth, payload: { name: "坏配置", ...(invalid === "invalid_rate_with_selection" ? { narration_selection: selected() } : {}) } });
        expect(response.statusCode).toBe(422);
        expect(response.json()).toMatchObject({ error: "narration_selection_required", reason: expect.stringContaining("配置无效") });
        expect(create).not.toHaveBeenCalled();
        expect(await client.project.count()).toBe(0);
        expect(await client.projectGenerationConfiguration.count()).toBe(0);
        expect(app.db.projects.size).toBe(0);
        expect(app.db.projectGenerationConfigurations.size).toBe(0);
        expect((await client.userGenerationPreference.findUnique({ where: { userId: "u" } }))?.configurationJson).toEqual(corrupted);
    });
    it.each(["auto", "empty"])("DB不合格fixed压过Map %s，拒绝后selection重试成功且偏好不变", async (cache) => {
        const { app, client } = await fixture();
        const preference = await setDbPref(client, true);
        if (cache === "auto") {
            const now = new Date();
            app.db.userGenerationPreferences.set("stale", { id: "stale", userId: "u", schemaVersion: "generation_configuration_v1", revision: 1, configurationJson: structuredClone(DEFAULT_GENERATION_CONFIGURATION), createdAt: now, updatedAt: now });
        }
        const upsert = vi.spyOn(client.project, "upsert");
        const rejected = await app.inject({ method: "POST", url: "/api/projects", auth, payload: { name: "保留名称" } });
        expect(rejected.statusCode).toBe(422);
        expect(rejected.json()).toMatchObject({ error: "narration_selection_required", policy_version: policy.policy_version, options: policy.qualified_options });
        expect(await client.project.count()).toBe(0);
        expect(await client.projectGenerationConfiguration.count()).toBe(0);
        expect(app.db.projects.size).toBe(0);
        const success = await app.inject({ method: "POST", url: "/api/projects", auth, payload: { name: "保留名称", narration_selection: selected() } });
        expect(success.statusCode).toBe(201);
        expect(await client.project.count()).toBe(1);
        expect(upsert).not.toHaveBeenCalled();
        expect((await client.userGenerationPreference.findUnique({ where: { userId: "u" } }))?.configurationJson).toEqual(preference);
        const fresh = createDbClient();
        await hydrateFirstAggregates(fresh, new Map(), client, { storageRoot: app.storageBaseDir });
        expect(fresh.projects.get(success.json().project_id)?.narrationTimingMode).toBe("narration_first_v1");
        const config = [...fresh.projectGenerationConfigurations.values()][0];
        expect(config.sourceUserPreferenceRevision).toBe(2);
        expect(config.configurationJson).toMatchObject({ capabilities: { "tts.synthesize": { mode: "fixed", provider_model_id: selected().provider_model_id } }, creative: { voice_profile_id: selected().voice_profile_id }, narration_policy: { policy_version: policy.policy_version, selection_reason: "explicit_selection" } });
    });
    it.each([false, true])("已有偏好记录JSON null，selection=%s仍拒绝且零创建", async (withSelection) => {
        const { app, client, writer } = await fixture();
        await setDbPref(client);
        await client.userGenerationPreference.update({ where: { userId: "u" }, data: { configurationJson: Prisma.JsonNull } });
        const before = await client.userGenerationPreference.findUniqueOrThrow({ where: { userId: "u" } });
        expect(before.configurationJson).toBeNull();
        expect(before.revision).toBe(2);
        const create = vi.spyOn(writer, "createProjectWithGenerationConfiguration");
        const response = await app.inject({ method: "POST", url: "/api/projects", auth, payload: { name: "已有坏根配置", ...(withSelection ? { narration_selection: selected() } : {}) } });
        expect(response.statusCode).toBe(422);
        expect(response.json()).toMatchObject({ error: "narration_selection_required", reason: expect.stringContaining("配置无效") });
        expect(create).not.toHaveBeenCalled();
        expect(await client.project.count()).toBe(0);
        expect(await client.projectGenerationConfiguration.count()).toBe(0);
        expect(app.db.projects.size).toBe(0);
        expect(app.db.projectGenerationConfigurations.size).toBe(0);
        expect(await client.userGenerationPreference.findUnique({ where: { userId: "u" } })).toEqual(before);
    });
    it("无偏好记录使用默认配置且不会继承Map残留fixed", async () => {
        const { app, client } = await fixture();
        const configuration = structuredClone(DEFAULT_GENERATION_CONFIGURATION);
        configuration.capabilities["tts.synthesize"] = { mode: "fixed", provider_model_id: "old-model" };
        const now = new Date();
        app.db.userGenerationPreferences.set("stale", { id: "stale", userId: "u", schemaVersion: "generation_configuration_v1", revision: 99, configurationJson: configuration, createdAt: now, updatedAt: now });
        const res = await app.inject({ method: "POST", url: "/api/projects", auth, payload: { name: "null权威" } });
        expect(res.statusCode).toBe(201);
        expect((await client.projectGenerationConfiguration.findFirst())?.sourceUserPreferenceRevision).toBeNull();
        expect(await client.userGenerationPreference.count()).toBe(0);
    });
    it.each([false, true])("读取后另一实例%s改变偏好，409且事务零写入", async (exists) => {
        const { app, client, writer, path } = await fixture();
        if (exists)
            await setDbPref(client);
        const other = await createPrismaClient(path);
        clients.push(other);
        const original = writer.getUserGenerationPreference.bind(writer);
        vi.spyOn(writer, "getUserGenerationPreference").mockImplementationOnce(async (userId) => { const before = await original(userId); await setDbPref(other, false, 3); return before; });
        const res = await app.inject({ method: "POST", url: "/api/projects", auth, payload: { name: "冲突" } });
        expect(res.statusCode).toBe(409);
        expect(res.json().error).toBe("narration_creation_context_changed");
        expect(await client.project.count()).toBe(0);
        expect(await client.projectGenerationConfiguration.count()).toBe(0);
        expect(app.db.projects.size).toBe(0);
    });
    it.each(["model_disabled", "voice_private"])("资格解析后%s且偏好变化，409仅返回当前可用组合", async (change) => {
        const { app, client, writer, path } = await fixture();
        await setDbPref(client);
        const other = await createPrismaClient(path);
        clients.push(other);
        await other.user.create({ data: { id: "other", username: "other", displayName: "Other", passwordHash: "h", role: "USER" } });
        const real = writer.createProjectWithGenerationConfiguration.bind(writer);
        const create = vi.spyOn(writer, "createProjectWithGenerationConfiguration").mockImplementationOnce(async (project, configuration, context) => {
            expect(configuration.configurationJson.narration_policy?.policy_version).toBe(policy.policy_version);
            if (change === "model_disabled") {
                app.db.providerModelCatalog.get(policy.default_provider_model_id)!.status = "disabled";
            }
            else {
                await other.voiceProfile.update({ where: { id: policy.default_voice_profile_id }, data: { kind: "generated", ownerId: "other", visibility: "private" } });
            }
            await setDbPref(other, false, 3);
            return real(project, configuration, context);
        });
        const response = await app.inject({ method: "POST", url: "/api/projects", auth, payload: { name: "资格后冲突" } });
        expect(create).toHaveBeenCalledOnce();
        expect(response.statusCode).toBe(409);
        expect(response.json()).toMatchObject({ error: "narration_creation_context_changed", policy_version: policy.policy_version, options: [] });
        expect(policy.qualified_options).toHaveLength(1);
        expect(await client.project.count()).toBe(0);
        expect(await client.projectGenerationConfiguration.count()).toBe(0);
        expect(app.db.projects.size).toBe(0);
        expect(app.db.projectGenerationConfigurations.size).toBe(0);
    });
    it("策略版本过期409零创建", async () => {
        const { app, client } = await fixture();
        const stale = await app.inject({ method: "POST", url: "/api/projects", auth, payload: { name: "过期", narration_selection: { ...selected(), policy_version: "old" } } });
        expect(stale.statusCode).toBe(409);
        expect(stale.json().error).toBe("narration_policy_changed");
        expect(await client.project.count()).toBe(0);
    });
});
it("真实writer第二次写失败回滚mode/config，metadata与Map不发布", async () => {
    const { app, client, writer } = await fixture();
    const seed = await app.inject({ method: "POST", url: "/api/projects", auth, payload: { name: "已有" } });
    expect(seed.statusCode).toBe(201);
    const config = await client.projectGenerationConfiguration.findFirst();
    let attemptId = "";
    const real = writer.createProjectWithGenerationConfiguration.bind(writer);
    vi.spyOn(writer, "createProjectWithGenerationConfiguration").mockImplementationOnce(async (project, configuration, context) => {
        attemptId = project.id;
        await real(project, { ...configuration, id: config!.id }, context);
    });
    await expect(app.inject({ method: "POST", url: "/api/projects", auth, payload: { name: "应回滚" } })).rejects.toThrow("Unique constraint");
    expect(await client.project.findUnique({ where: { id: attemptId } })).toBeNull();
    expect(await client.projectGenerationConfiguration.findUnique({ where: { projectId: attemptId } })).toBeNull();
    expect(app.db.projects.has(attemptId)).toBe(false);
    expect(await client.project.count()).toBe(1);
});
it("真实项目配置PATCH物化auto、拒绝不合格且revision冲突零写", async () => {
    const { app, client } = await fixture();
    const created = await app.inject({ method: "POST", url: "/api/projects", auth, payload: { name: "配置" } });
    const id = created.json().project_id;
    const payload = { ...structuredClone(DEFAULT_GENERATION_CONFIGURATION), expected_revision: 1 };
    const { schema_version, ...request } = payload;
    const saved = await app.inject({ method: "PATCH", url: "/api/projects/" + id + "/generation-configuration", auth, payload: request });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().configuration.capabilities["tts.synthesize"].mode).toBe("fixed");
    const before = await client.projectGenerationConfiguration.findUnique({ where: { projectId: id } });
    const bad = { ...request, expected_revision: 2, creative: { ...request.creative, voice_profile_id: "voice_system_ethan" } };
    const rejected = await app.inject({ method: "PATCH", url: "/api/projects/" + id + "/generation-configuration", auth, payload: bad });
    expect(rejected.statusCode).toBe(422);
    expect(rejected.json().error).toBe("narration_selection_required");
    const conflict = await app.inject({ method: "PATCH", url: "/api/projects/" + id + "/generation-configuration", auth, payload: request });
    expect(conflict.statusCode).toBe(409);
    expect(await client.projectGenerationConfiguration.findUnique({ where: { projectId: id } })).toEqual(before);
    const forged = await app.inject({ method: "PATCH", url: "/api/projects/" + id + "/generation-configuration", auth, payload: { ...request, expected_revision: 2, narration_policy: { policy_version: "fake", selection_reason: "qualified_fixed", qualification_report: "fake" } } });
    expect(forged.statusCode).toBe(400);
});
it("Prisma上下文缺实际writer不得静默退回Map创建", async () => {
    const { client, app: seeded } = await fixture();
    const app = buildApp({ prismaClient: client, skipSnapshotLoad: true });
    app.db.providerModelCatalog = seeded.db.providerModelCatalog;
    await seedGlobalVoiceProfiles(app.db);
    await expect(app.inject({ method: "POST", url: "/api/projects", auth, payload: { name: "配置错误" } })).rejects.toThrow("narration_creation_writer_required");
    expect(await client.project.count()).toBe(0);
    expect(app.db.projects.size).toBe(0);
    expect(app.db.projectGenerationConfigurations.size).toBe(0);
});
it("新模式保存完整合同拒绝越界参数且DB和Map保持原配置", async () => {
    const { app, client } = await fixture();
    const created = await app.inject({ method: "POST", url: "/api/projects", auth, payload: { name: "保存合同" } });
    const id = created.json().project_id;
    const before = await client.projectGenerationConfiguration.findUniqueOrThrow({ where: { projectId: id } });
    const beforeMap = structuredClone([...app.db.projectGenerationConfigurations.values()]);
    const invalid = structuredClone(DEFAULT_GENERATION_CONFIGURATION);
    invalid.creative.narration = { rate: 1.5, tone: "neutral" } as unknown as NonNullable<typeof invalid.creative.narration>;
    const result = await upsertProjectGenerationConfiguration(app.db, id, { expected_revision: 1, configuration: invalid }, "u");
    expect(result).toMatchObject({ ok: false, error: { code: "narration_selection_required", body: { reason: expect.stringContaining("配置无效") } } });
    expect(await client.projectGenerationConfiguration.findUnique({ where: { projectId: id } })).toEqual(before);
    expect([...app.db.projectGenerationConfigurations.values()]).toEqual(beforeMap);
});
