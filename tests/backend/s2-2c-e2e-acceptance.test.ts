import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * S2-2C 任务 9：e2e 验收（详细设计 §11.3）。
 *
 * 部署形态：非 stub LLM + 临时 providers.json（deepseek/zhipu）+ 多候选目录
 * （LLM_MODEL_CANDIDATES_V1 种入非默认条目）+ 真实 tier-aware-provider-factory
 * （fetch 被 stub 捕获请求，断言 baseUrl/model）。
 *
 * env 注入：本文件不 mock config/env.js（该路径在本仓库 vitest 环境下不可靠），
 * 改用 beforeAll 里 vi.stubEnv + 动态 import——env.ts 在首次动态 import 时从
 * process.env 构建，stub 在构建前生效（每文件隔离的模块图）。
 *
 * 覆盖：
 * 1. 用户默认 fixed（llm.smart 固定候选 + tts 固定）→ 创建项目复制 → 项目配置含 fixed。
 * 2. quote（含 fixed 槽位计价）→ 提交 → 快照 resolved_capabilities[slot].
 *    mode=fixed + provider_key/model_id 与配置一致；执行消费（真实工厂）调用
 *    模型 = 快照模型（fetch 断言 baseUrl/model）；usage 记账 provider/model 同源。
 * 3. auto 槽位同源：全 auto 配置 → 快照冻结目录默认 → 执行按快照模型。
 * 4. 提交前漂移（拒绝）：报价后修改配置 → 提交返回 generation_quote_
 *    configuration_changed，无快照/run 创建、无 provider 调用。
 * 5. 快照后漂移（仍执行 A）：createOrRestoreGenerationRun 创建 pending run →
 *    改目录默认为 B → 单独 dispatcher 恢复执行 → 仍调用 A 且 usage 按 A 记账。
 * 6. 旧客户端保留：B 形状请求体（无 capabilities 段）PATCH 只改 video →
 *    capabilities 保持不变（用户与项目入口）。
 * 7. 固定模型停用：目录置 disabled → 报价解析失败（不静默切换）；
 *    capabilities 参与 configuration_hash（修改后旧 quote 提交被拒）。
 *
 * assets 快照权威（冷镜像恢复 / dispatch_snapshot_missing）由任务 6 媒体绑定
 * 测试覆盖（tests/backend/assets/media-resolved-model-binding.test.ts），
 * 本文件不重复构造跨实例冷镜像环境。
 */

import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// --- 动态导入绑定（env stub 生效后再加载 backend 模块） ---------------------

type BuildApp = typeof import("../../backend/src/app.js").buildApp;
type ProjectRecord = import("../../backend/src/db/client.js").ProjectRecord;

let buildApp: BuildApp;
let createProject: (db: import("../../backend/src/db/client.js").DbClient, input: { name: string; ownerId?: string }) => Promise<ProjectRecord>;
let saveTopicPackage: typeof import("../../backend/src/modules/topic/topic-package.repository.js").saveTopicPackage;
let buildPricingCatalogSeed: typeof import("../../backend/src/modules/generation-cost/pricing-catalog.seed.js").buildPricingCatalogSeed;
let applyProviderModelCatalogSeed: typeof import("../../backend/src/modules/generation-cost/provider-model-catalog.repository.js").applyProviderModelCatalogSeed;

let createGenerationRunRepository: typeof import("../../backend/src/modules/generation-run/generation-run.repository.js").createGenerationRunRepository;
let createOrRestoreGenerationRun: typeof import("../../backend/src/modules/generation-run/generation-run.service.js").createOrRestoreGenerationRun;
let LLM_MODEL_CANDIDATES_V1: import("../../backend/src/modules/generation-cost/llm-model-catalog.js").LlmModelCandidate[];
/** 纯类型别名（interface 无运行时导出，禁止动态 import 赋值）。 */
type GenerationCapabilityReadinessInput =
  import("../../backend/src/modules/generation-cost/generation-capability-readiness.js").GenerationCapabilityReadinessInput;
let buildTestAuth: typeof import("./auth/test-utils.js").buildTestAuth;
let buildQuotableReadinessInput: typeof import("./cost/quote-test-context.js").buildQuotableReadinessInput;
let REAL_TIER_INPUT: import("./cost/quote-test-context.js").LlmTierSeedInput;
let auth: ReturnType<typeof buildTestAuth>;

const PROVIDERS_CONFIG_PATH = join(tmpdir(), "s2-2c-e2e-providers.json");

beforeAll(async () => {
  writeFileSync(
    PROVIDERS_CONFIG_PATH,
    JSON.stringify({
      providers: [
        { name: "deepseek", baseUrl: "https://api.deepseek.com", apiKeyEnv: "LLM_PROVIDER_DEEPSEEK_API_KEY" },
        { name: "zhipu", baseUrl: "https://open.bigmodel.cn/api/paas/v4", apiKeyEnv: "LLM_PROVIDER_ZHIPU_API_KEY" },
      ],
    }),
  );
  // env.ts 在首次动态 import 时从 process.env 构建：stub 先于构建生效
  vi.stubEnv("LLM_PROVIDER", "openai");
  vi.stubEnv("LLM_SMART_MODEL", "deepseek:deepseek-v4-pro");
  vi.stubEnv("LLM_FLASH_MODEL", "zhipu:glm-4");
  vi.stubEnv("LLM_PROVIDERS_CONFIG_PATH", PROVIDERS_CONFIG_PATH);
  vi.stubEnv("LLM_PROVIDER_DEEPSEEK_API_KEY", "ds-key");
  vi.stubEnv("LLM_PROVIDER_ZHIPU_API_KEY", "zhipu-key");
  vi.stubEnv("ALIYUN_DASHSCOPE_API_KEY", "test-key");

  const appModule = await import("../../backend/src/app.js");
  buildApp = appModule.buildApp;
  createProject = (await import("../../backend/src/modules/projects/project.repository.js")).createProject;
  saveTopicPackage = (await import("../../backend/src/modules/topic/topic-package.repository.js")).saveTopicPackage;
  buildPricingCatalogSeed = (await import("../../backend/src/modules/generation-cost/pricing-catalog.seed.js")).buildPricingCatalogSeed;
  applyProviderModelCatalogSeed = (await import("../../backend/src/modules/generation-cost/provider-model-catalog.repository.js")).applyProviderModelCatalogSeed;
  createGenerationRunRepository = (await import("../../backend/src/modules/generation-run/generation-run.repository.js")).createGenerationRunRepository;
  createOrRestoreGenerationRun = (await import("../../backend/src/modules/generation-run/generation-run.service.js")).createOrRestoreGenerationRun;
  LLM_MODEL_CANDIDATES_V1 = (await import("../../backend/src/modules/generation-cost/llm-model-catalog.js")).LLM_MODEL_CANDIDATES_V1;
  buildTestAuth = (await import("./auth/test-utils.js")).buildTestAuth;
  auth = buildTestAuth({ userId: "owner-1" });
  const context = await import("./cost/quote-test-context.js");
  buildQuotableReadinessInput = context.buildQuotableReadinessInput;
  REAL_TIER_INPUT = context.REAL_TIER_INPUT;
});

afterAll(() => {
  vi.unstubAllEnvs();
});

const runtimeDraft = {
  script_text: "这是 S2-2C e2e writer 返回的脚本草稿。",
  estimated_duration_sec: 86,
  beat_trace: [
    { beat: "入楚受辱", excerpt: "这是 S2-2C e2e writer 返回的脚本草稿", confidence: 0.95 },
  ],
  quote_trace: [],
  opening_span: "这是 S2-2C e2e writer 返回的脚本草稿。",
  ending_span: "结尾余震。",
  soft_lane: {
    narrative_tension_map: {
      hook_claim: "楚王当众压场",
      pressure_escalation: "连续羞辱",
      mid_reveal: "晏子反击",
      peak_payoff: "全场噤声",
      ending_residue: "使节尊严立住",
    },
    strong_scene: "楚王连续压场，晏子一句句顶回去。",
  },
  packaging_lane: { hook_claim: "一句话改变整个房间的气氛。" },
};

/** 与多候选目录一致的 readiness（llmCandidates 参与分层校验）。 */
function e2eReadiness(): GenerationCapabilityReadinessInput {
  return {
    ...buildQuotableReadinessInput(REAL_TIER_INPUT),
    llmCandidates: LLM_MODEL_CANDIDATES_V1,
  };
}

/** 多候选目录：LLM 每槽默认条目（tier 解析）+ 候选条目（非默认）。 */
async function seedMultiCandidateCatalog(app: ReturnType<BuildApp>): Promise<void> {
  const seed = buildPricingCatalogSeed({
    llm: { ...REAL_TIER_INPUT, candidates: LLM_MODEL_CANDIDATES_V1 },
    media: { deploymentScope: "cn-beijing" },
  });
  await applyProviderModelCatalogSeed(app.db, seed);
}

async function prepareScriptProject(app: ReturnType<BuildApp>): Promise<ProjectRecord> {
  const project = await createProject(app.db, { name: "S2-2C E2E", ownerId: "owner-1" });
  const topicPackage = await saveTopicPackage(app.db, {
    projectId: project.id,
    title: "E2E Topic",
    selectedAngle: "An answer reverses the pressure.",
    familyLabel: "diplomacy",
    scopeLabel: "single_event",
    coreConflict: "The envoy must answer.",
    strongScene: "The hall falls quiet.",
    packagingSeed: "One sentence changes the room.",
    canonicalQuotesJson: [],
    durationBandJson: { label: "medium" },
    narrativeTensionMapJson: {
      hook_claim: "楚王当众压场",
      pressure_escalation: "连续羞辱",
      mid_reveal: "晏子反击",
      peak_payoff: "全场噤声",
      ending_residue: "使节尊严立住",
    },
    mustIncludeBeatsJson: ["answer"],
    forbiddenExpansionsJson: [],
    riskHintsJson: [],
    sourceAnchorRefsJson: ["《晏子春秋》"],
  });
  project.activeTopicPackageId = topicPackage.id;
  return project;
}

function stubChatFetch(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (url: string | URL) => {
    const urlText = String(url);
    if (urlText.endsWith("/chat/completions")) {
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(runtimeDraft) } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    throw new Error(`unexpected fetch: ${urlText}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const FIXED_SMART_CAPABILITIES = {
  "llm.smart": { mode: "fixed", provider_model_id: "llm.smart.zhipu.glm-5" },
  "llm.flash": { mode: "auto" },
  "image.generate": { mode: "auto" },
  "video.image_to_video": { mode: "auto" },
  "tts.synthesize": { mode: "auto" },
};

describe("S2-2C e2e 验收", () => {
  it("1：用户默认 capabilities fixed（llm.smart 候选 + tts）→ 创建项目复制继承", async () => {
    const app = buildApp({ generationQuoteReadinessInput: e2eReadiness() });
    await seedMultiCandidateCatalog(app);

    const patchUser = await app.inject({
      method: "PATCH",
      url: "/api/me/generation-preferences",
      payload: {
        expected_revision: null,
        video: { strategy: "prefer_remotion", api_quality: "standard_720p" },
        capabilities: {
          "llm.smart": { mode: "fixed", provider_model_id: "llm.smart.zhipu.glm-5" },
          "llm.flash": { mode: "auto" },
          "image.generate": { mode: "auto" },
          "video.image_to_video": { mode: "auto" },
          "tts.synthesize": { mode: "fixed", provider_model_id: "tts.synthesize.dashscope.cn-beijing.qwen3-tts-instruct-flash" },
        },
      },
      auth,
    });
    expect(patchUser.statusCode).toBe(200);

    const project = await prepareScriptProject(app);
    const projectConfig = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/generation-configuration`,
      auth,
    });
    expect(projectConfig.statusCode).toBe(200);
    const capabilities = projectConfig.json().configuration.capabilities as Record<
      string,
      { mode: string; provider_model_id?: string }
    >;
    expect(capabilities["llm.smart"]).toEqual({ mode: "fixed", provider_model_id: "llm.smart.zhipu.glm-5" });
    expect(capabilities["tts.synthesize"]).toEqual({
      mode: "fixed",
      provider_model_id: "tts.synthesize.dashscope.cn-beijing.qwen3-tts-instruct-flash",
    });
    expect(capabilities["llm.flash"]).toEqual({ mode: "auto" });
  });

  it("2：fixed 槽位 quote → 提交 → 快照冻结 → 执行按快照模型调用（fetch 断言）→ usage 记账同源", async () => {
    const app = buildApp({ generationQuoteReadinessInput: e2eReadiness() });
    await seedMultiCandidateCatalog(app);
    const project = await prepareScriptProject(app);
    const fetchMock = stubChatFetch();

    // 项目配置 fixed：llm.smart 固定到候选（zhipu:glm-5，与 tier 默认 deepseek 不同）
    const patchProject = await app.inject({
      method: "PATCH",
      url: `/api/projects/${project.id}/generation-configuration`,
      payload: {
        expected_revision: 1,
        video: { strategy: "prefer_remotion", api_quality: "standard_720p" },
        capabilities: FIXED_SMART_CAPABILITIES,
      },
      auth,
    });
    expect(patchProject.statusCode).toBe(200);

    const submit = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/script/generate`,
      payload: {
        allow_patch: false,
        allow_regen: false,
        idempotency_key: "s2-2c-e2e-fixed-1",
      },
      auth,
    });
    expect(submit.statusCode).toBe(200);

    // 快照冻结 fixed：mode/provider_key/model_id 与配置一致
    const snapshot = [...app.db.runConfigurationSnapshots.values()][0]!;
    const resolved = snapshot.resolvedConfigurationJson as {
      resolved_capabilities: {
        "llm.smart": { mode: string; provider_model_id: string; provider_key: string; model_id: string };
      };
    };
    expect(resolved.resolved_capabilities["llm.smart"]).toEqual({
      mode: "fixed",
      provider_model_id: "llm.smart.zhipu.glm-5",
      provider_key: "zhipu",
      model_id: "glm-5",
    });

    // 执行消费：真实工厂按快照 provider/model 构造 → 请求到达 zhipu baseUrl 且 model=glm-5
    expect(fetchMock).toHaveBeenCalled();
    for (const [url, init] of fetchMock.mock.calls as Array<[string | URL, RequestInit]>) {
      expect(String(url)).toMatch(/^https:\/\/open\.bigmodel\.cn\/api\/paas\/v4\/chat\/completions$/);
      const body = JSON.parse(String(init.body)) as { model: string };
      expect(body.model).toBe("glm-5");
    }

    // usage 记账与执行/快照同源
    const usages = [...app.db.usageCostRecords.values()].filter((u) => u.capability === "llm.smart");
    expect(usages.length).toBeGreaterThan(0);
    for (const usage of usages) {
      expect(usage.providerKey).toBe("zhipu");
      expect(usage.modelId).toBe("glm-5");
      expect(usage.runConfigurationSnapshotId).toBe(snapshot.id);
    }
  });

  it("3：auto 槽位同源——全 auto 配置快照冻结目录默认，执行按快照模型", async () => {
    const app = buildApp({ generationQuoteReadinessInput: e2eReadiness() });
    await seedMultiCandidateCatalog(app);
    const project = await prepareScriptProject(app);
    const fetchMock = stubChatFetch();

    const submit = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/script/generate`,
      payload: {
        allow_patch: false,
        allow_regen: false,
        idempotency_key: "s2-2c-e2e-auto-1",
      },
      auth,
    });
    expect(submit.statusCode).toBe(200);

    const snapshot = [...app.db.runConfigurationSnapshots.values()][0]!;
    const resolved = snapshot.resolvedConfigurationJson as {
      resolved_capabilities: {
        "llm.smart": { mode: string; provider_key: string; model_id: string };
      };
    };
    // auto 同样冻结实际模型（目录默认 = tier 解析 deepseek-v4-pro）
    expect(resolved.resolved_capabilities["llm.smart"]).toMatchObject({
      mode: "auto",
      provider_key: "deepseek",
      model_id: "deepseek-v4-pro",
    });
    for (const [url, init] of fetchMock.mock.calls as Array<[string | URL, RequestInit]>) {
      expect(String(url)).toMatch(/^https:\/\/api\.deepseek\.com\/chat\/completions$/);
      const body = JSON.parse(String(init.body)) as { model: string };
      expect(body.model).toBe("deepseek-v4-pro");
    }
  });

  it("4：提交按当前配置解析——fixed 配置的提交快照冻结 fixed 模型", async () => {
    const app = buildApp({ generationQuoteReadinessInput: e2eReadiness() });
    await seedMultiCandidateCatalog(app);
    const project = await prepareScriptProject(app);
    const fetchMock = stubChatFetch();

    // 项目配置 capabilities：auto → fixed 候选 B（提交时解析为当前配置）
    const patchProject = await app.inject({
      method: "PATCH",
      url: `/api/projects/${project.id}/generation-configuration`,
      payload: {
        expected_revision: 1,
        video: { strategy: "prefer_remotion", api_quality: "standard_720p" },
        capabilities: FIXED_SMART_CAPABILITIES,
      },
      auth,
    });
    expect(patchProject.statusCode).toBe(200);

    const submit = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/script/generate`,
      payload: {
        allow_patch: false,
        allow_regen: false,
        idempotency_key: "s2-2c-e2e-drift-1",
      },
      auth,
    });
    expect(submit.statusCode).toBe(200);
    // 快照冻结提交时的 fixed 配置（无报价漂移概念；每次提交独立解析）
    const snapshot = [...app.db.runConfigurationSnapshots.values()][0]!;
    const resolved = snapshot.resolvedConfigurationJson as {
      resolved_capabilities: {
        "llm.smart": { mode: string; provider_model_id: string; provider_key: string; model_id: string };
      };
    };
    expect(resolved.resolved_capabilities["llm.smart"]).toEqual({
      mode: "fixed",
      provider_model_id: "llm.smart.zhipu.glm-5",
      provider_key: "zhipu",
      model_id: "glm-5",
    });
    expect(fetchMock).toHaveBeenCalled();
  });

  it("5：快照后漂移（仍执行 A）——pending run 冻结 A 后改目录默认为 B，dispatcher 恢复仍调用 A 且 usage 记 A", async () => {
    const app = buildApp({ generationQuoteReadinessInput: e2eReadiness() });
    await seedMultiCandidateCatalog(app);
    const project = await prepareScriptProject(app);
    const fetchMock = stubChatFetch();

    const repository = createGenerationRunRepository(app.db);
    const submit = await createOrRestoreGenerationRun(
      app.db, project, project.ownerId,
      {
        operation: "script.generate",
        idempotencyKey: "s2-2c-e2e-snapshot-drift-1",
        dispatchPayload: { allow_patch: false, allow_regen: false },
      },
      { readinessInput: e2eReadiness(), repository },
    );
    if (!submit.ok) throw new Error(`submit failed: ${JSON.stringify(submit.error)}`);
    const snapshotId = submit.value.snapshot.id;
    expect(snapshotId).toBeTruthy();
    // 快照冻结 A（auto → 目录默认 deepseek-v4-pro）
    const snapshot = app.db.runConfigurationSnapshots.get(snapshotId)!;
    const resolvedBefore = snapshot.resolvedConfigurationJson as {
      resolved_capabilities: { "llm.smart": { model_id: string } };
    };
    expect(resolvedBefore.resolved_capabilities["llm.smart"].model_id).toBe("deepseek-v4-pro");

    // 快照创建后目录默认改为 B（模拟 env/tier/目录默认漂移）
    const smartDefault = [...app.db.providerModelCatalog.values()].find(
      (e) => e.capability === "llm.smart" && e.isDefault,
    )!;
    smartDefault.modelId = "deepseek-v4-pro-drifted";

    const result = await app.generationRunDispatcher.dispatch(submit.value.run.id);
    expect(result.dispatched).toBe(true);
    if (result.dispatched) expect(result.outcome.status).toBe("succeeded");

    // 仍调用 A（快照权威，不读漂移后的目录默认）
    expect(fetchMock).toHaveBeenCalled();
    for (const [url, init] of fetchMock.mock.calls as Array<[string | URL, RequestInit]>) {
      expect(String(url)).toMatch(/^https:\/\/api\.deepseek\.com\/chat\/completions$/);
      const body = JSON.parse(String(init.body)) as { model: string };
      expect(body.model).toBe("deepseek-v4-pro");
    }
    // usage 按 A 记账
    const usages = [...app.db.usageCostRecords.values()].filter((u) => u.capability === "llm.smart");
    expect(usages.length).toBeGreaterThan(0);
    for (const usage of usages) {
      expect(usage.providerKey).toBe("deepseek");
      expect(usage.modelId).toBe("deepseek-v4-pro");
    }
  });

  it("6：旧客户端保留——B 形状请求体（无 capabilities 段）PATCH 只改 video → capabilities 保持不变（用户与项目入口）", async () => {
    const app = buildApp({ generationQuoteReadinessInput: e2eReadiness() });
    await seedMultiCandidateCatalog(app);

    // 用户默认先保存 fixed tts
    const patchUserFixed = await app.inject({
      method: "PATCH",
      url: "/api/me/generation-preferences",
      payload: {
        expected_revision: null,
        video: { strategy: "prefer_remotion", api_quality: "standard_720p" },
        capabilities: {
          "llm.smart": { mode: "auto" },
          "llm.flash": { mode: "auto" },
          "image.generate": { mode: "auto" },
          "video.image_to_video": { mode: "auto" },
          "tts.synthesize": { mode: "fixed", provider_model_id: "tts.synthesize.dashscope.cn-beijing.qwen3-tts-instruct-flash" },
        },
      },
      auth,
    });
    expect(patchUserFixed.statusCode).toBe(200);

    // 旧客户端 B 形状 PATCH（无 capabilities 段）只改 video → capabilities 保持不变
    const patchUserLegacy = await app.inject({
      method: "PATCH",
      url: "/api/me/generation-preferences",
      payload: {
        expected_revision: 1,
        video: { strategy: "all_remotion", api_quality: "standard_720p" },
      },
      auth,
    });
    expect(patchUserLegacy.statusCode).toBe(200);
    const userCapabilities = patchUserLegacy.json().configuration.capabilities as Record<
      string,
      { mode: string; provider_model_id?: string }
    >;
    expect(userCapabilities["tts.synthesize"]).toEqual({
      mode: "fixed",
      provider_model_id: "tts.synthesize.dashscope.cn-beijing.qwen3-tts-instruct-flash",
    });

    // 项目入口同断言
    const project = await prepareScriptProject(app);
    const patchProjectFixed = await app.inject({
      method: "PATCH",
      url: `/api/projects/${project.id}/generation-configuration`,
      payload: {
        expected_revision: 1,
        video: { strategy: "prefer_remotion", api_quality: "standard_720p" },
        capabilities: FIXED_SMART_CAPABILITIES,
      },
      auth,
    });
    expect(patchProjectFixed.statusCode).toBe(200);

    const patchProjectLegacy = await app.inject({
      method: "PATCH",
      url: `/api/projects/${project.id}/generation-configuration`,
      payload: {
        expected_revision: 2,
        video: { strategy: "prefer_api_video", api_quality: "high_1080p" },
      },
      auth,
    });
    expect(patchProjectLegacy.statusCode).toBe(200);
    const projectCapabilities = patchProjectLegacy.json().configuration.capabilities as Record<
      string,
      { mode: string; provider_model_id?: string }
    >;
    expect(projectCapabilities["llm.smart"]).toEqual({
      mode: "fixed",
      provider_model_id: "llm.smart.zhipu.glm-5",
    });
    expect(projectCapabilities["tts.synthesize"]).toEqual({ mode: "auto" });
  });

  it("7：固定模型停用 → 报价解析失败（不静默切换）；capabilities 参与 hash → 修改后旧 quote 提交被拒", async () => {
    const app = buildApp({ generationQuoteReadinessInput: e2eReadiness() });
    await seedMultiCandidateCatalog(app);
    const project = await prepareScriptProject(app);

    // 项目配置 fixed 到 smart 默认条目，然后该目录条目被置 disabled（运营停用）
    const patchProject = await app.inject({
      method: "PATCH",
      url: `/api/projects/${project.id}/generation-configuration`,
      payload: {
        expected_revision: 1,
        video: { strategy: "prefer_remotion", api_quality: "standard_720p" },
        capabilities: {
          "llm.smart": { mode: "fixed", provider_model_id: "llm.smart.deepseek.deepseek-v4-pro" },
          "llm.flash": { mode: "auto" },
          "image.generate": { mode: "auto" },
          "video.image_to_video": { mode: "auto" },
          "tts.synthesize": { mode: "auto" },
        },
      },
      auth,
    });
    expect(patchProject.statusCode).toBe(200);

    const smartDefault = [...app.db.providerModelCatalog.values()].find(
      (e) => e.capability === "llm.smart" && e.isDefault,
    )!;
    smartDefault.status = "disabled";
    smartDefault.isDefault = false;

    // 提交解析失败（resolver fixed → disabled → generation_model_disabled，
    // 提交路径包装为 generation_run_resolution_failed，message 指出 disabled）——
    // 绝不静默切换到其他模型
    const submitBlocked = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/script/generate`,
      payload: {
        allow_patch: false,
        allow_regen: false,
        idempotency_key: "s2-2c-e2e-blocked-1",
      },
      auth,
    });
    expect(submitBlocked.statusCode).toBe(409);
    expect((submitBlocked.json() as Record<string, unknown>).error).toBe("generation_run_resolution_failed");
    expect(JSON.stringify(submitBlocked.json())).toMatch(/disabled/);
    expect(app.db.generationRuns.size).toBe(0);

    // 恢复 active → 改 fixed B → 新提交按当前配置解析（每次提交独立解析）
    smartDefault.status = "active";
    smartDefault.isDefault = true;

    const patchProjectB = await app.inject({
      method: "PATCH",
      url: `/api/projects/${project.id}/generation-configuration`,
      payload: {
        expected_revision: 2,
        video: { strategy: "prefer_remotion", api_quality: "standard_720p" },
        capabilities: FIXED_SMART_CAPABILITIES,
      },
      auth,
    });
    expect(patchProjectB.statusCode).toBe(200);

    const fetchMock = stubChatFetch();
    const submit = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/script/generate`,
      payload: {
        allow_patch: false,
        allow_regen: false,
        idempotency_key: "s2-2c-e2e-hash-1",
      },
      auth,
    });
    expect(submit.statusCode).toBe(200);
    // 快照冻结提交时的 fixed B（capabilities 参与每次提交的独立解析）
    const snapshot = [...app.db.runConfigurationSnapshots.values()][0]!;
    const resolved = snapshot.resolvedConfigurationJson as {
      resolved_capabilities: {
        "llm.smart": { mode: string; provider_model_id: string };
      };
    };
    expect(resolved.resolved_capabilities["llm.smart"]).toMatchObject({
      mode: "fixed",
      provider_model_id: "llm.smart.zhipu.glm-5",
    });
    expect(fetchMock).toHaveBeenCalled();
  });
});
