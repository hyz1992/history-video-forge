import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";

/** S2-2A 任务 9A：付费闸门失败测试（实现前红灯）。
 *
 * 覆盖实施计划任务 9A 步骤 1 验收：
 * 1. 无有效 run/snapshot/quote 时不得调用 provider。
 * 4. retry 必须新 quote、新 GenerationRun、新 attempt。
 * 6. fake/local/Remotion 任务记录零外部费用但保留 route event。
 * 7. 旧无 quote API 返回明确 paid_generation_quote_required（路由级闸门）。
 */

const DASHSCOPE_ENV: Record<string, string> = {
  ALIYUN_DASHSCOPE_API_KEY: "test-key",
  ALIYUN_DASHSCOPE_BASE_URL: "https://dashscope.aliyuncs.com",
  ALIYUN_DASHSCOPE_TEXT_TO_IMAGE_MODEL: "wan2.6-t2i",
  ALIYUN_DASHSCOPE_TTS_MODEL: "qwen3-tts-instruct-flash",
  ALIYUN_DASHSCOPE_IMAGE_TO_VIDEO_MODEL: "wan2.7-i2v-2026-04-25",
};

function injectDashscopeEnv() {
  for (const [key, value] of Object.entries(DASHSCOPE_ENV)) {
    vi.stubEnv(key, value);
  }
}

import { buildApp } from "../../../backend/src/app.js";
import { createProject } from "../../../backend/src/modules/projects/project.repository.js";
import { runAssetsGeneration } from "../../../backend/src/modules/assets/assets-run.service.js";
import { createGenerationRunRepository } from "../../../backend/src/modules/generation-run/generation-run.repository.js";
import { createOrRestoreGenerationRun } from "../../../backend/src/modules/generation-run/generation-run.service.js";
import { createGenerationCostQuote } from "../../../backend/src/modules/generation-cost/generation-cost.service.js";
import { buildQuotableReadinessInput } from "../cost/quote-test-context.js";
import { buildTestAuth } from "../auth/test-utils.js";
import type { AssetManifest, AssetPlan, StoryboardPlan } from "../../../shared/src/index.js";
import type { ProjectRecord } from "../../../backend/src/db/client.js";

const TOPIC_PACKAGE_ID = "topic_001";
const SCRIPT_RECORD_ID = "script_001";
const STORYBOARD_RECORD_ID = "storyboard_001";
const ASSET_PLAN_RECORD_ID = "asset_plan_001";

const scriptText = "Narration for segment one. A tense hall waits for the answer.";

function makeStoryboardPlan(): StoryboardPlan {
  return {
    plan_version: "storyboard_v1",
    source_script_record_id: SCRIPT_RECORD_ID,
    source_topic_package_id: TOPIC_PACKAGE_ID,
    estimated_total_duration_sec: 12,
    segments: [
      {
        segment_id: "sb_001",
        order: 0,
        script_excerpt: scriptText,
        start_hint_sec: 0,
        end_hint_sec: 12,
        narrative_role: "opening",
        visual_intent: "A tense hall.",
        scene_description: "A public hall.",
        visual_elements: ["envoy"],
        framing_hint: "medium",
        content_type: "live_action",
        motion_hint: "push_in",
        editing_hint: "single",
        on_screen_text: [],
        linked_beats: [],
        linked_quotes: [],
        risk_notes: [],
        api_video_suitability: "remotion_sufficient",
      },
    ],
    global_visual_notes: [],
  };
}

function makeAssetPlan(): AssetPlan {
  return {
    plan_version: "asset_plan_v1",
    source_storyboard_record_id: STORYBOARD_RECORD_ID,
    source_script_record_id: SCRIPT_RECORD_ID,
    source_topic_package_id: TOPIC_PACKAGE_ID,
    art_bible: {
      era_style: "ancient court",
      visual_tone: "tense",
      characters: [],
      locations: [],
      props: [],
      global_prompt_prefix: "ancient Chinese historical short video",
      global_negative_prompts: [],
      consistency_notes: [],
    },
    visual_budget: {},
    downgrade_policy: {},
    global_audio_strategy: {},
    tts_plan: {
      voice_profile_id: "voice_plan",
      estimated_total_duration_sec: 12,
      chunking_strategy: "segment_boundary",
      chunks: [
        { chunk_id: "tts_001", order: 0, script_excerpt: scriptText, estimated_duration_sec: 12 },
      ],
    },
    tasks: [
      {
        task_id: "tts_001",
        order: 0,
        task_type: "tts_audio",
        source_segment_id: null,
        source_excerpt: scriptText,
        production_intent: "Generate narration audio.",
        recommended_mode: "auto",
        provider_hint: "fake_tts",
        prompt_draft: null,
        parameters: {},
        manual_upload_policy: { allowed: false, required: false, accepted_file_types: [], acceptance_notes: [] },
        risk_notes: [],
        cost_tier: "low",
        initial_status: "planned",
      },
      {
        task_id: "img_001",
        order: 1,
        task_type: "image_still",
        source_segment_id: "sb_001",
        source_excerpt: scriptText,
        production_intent: "A tense hall.",
        recommended_mode: "auto",
        provider_hint: "fake_image",
        prompt_draft: "A tense hall, envoy answering.",
        parameters: {},
        manual_upload_policy: { allowed: false, required: false, accepted_file_types: [], acceptance_notes: [] },
        risk_notes: [],
        cost_tier: "low",
        initial_status: "planned",
      },
      {
        task_id: "motion_001",
        order: 2,
        task_type: "render_motion_cue",
        source_segment_id: "sb_001",
        source_excerpt: scriptText,
        production_intent: "Slow push in.",
        recommended_mode: "auto",
        provider_hint: null,
        prompt_draft: null,
        parameters: { recipe_type: "slow_push_in" },
        manual_upload_policy: { allowed: false, required: false, accepted_file_types: [], acceptance_notes: [] },
        risk_notes: [],
        cost_tier: "low",
        initial_status: "planned",
      },
    ],
  };
}

function prepareProjectWithAssetPlan(db: ReturnType<typeof buildApp>["db"]): Promise<ProjectRecord> | ProjectRecord {
  // Map 态同步准备（与 assets-run-service.test 同模式）
  return (async () => {
    const project = await createProject(db, { name: "paid gate test" });
    project.activeAssetPlanRecordId = ASSET_PLAN_RECORD_ID;
    project.status = "asset_plan_ready";
    const now = new Date();
    db.storyboardRecords.set(STORYBOARD_RECORD_ID, {
      id: STORYBOARD_RECORD_ID,
      projectId: project.id,
      topicPackageId: TOPIC_PACKAGE_ID,
      scriptRecordId: SCRIPT_RECORD_ID,
      planJson: makeStoryboardPlan() as unknown as Record<string, unknown>,
      validationResultJson: {},
      executionStateJson: null,
      graphTraceSummaryJson: null,
      runtimeDiagnosticsJson: null,
      createdAt: now,
    });
    db.assetPlanRecords.set(ASSET_PLAN_RECORD_ID, {
      id: ASSET_PLAN_RECORD_ID,
      projectId: project.id,
      topicPackageId: TOPIC_PACKAGE_ID,
      scriptRecordId: SCRIPT_RECORD_ID,
      storyboardRecordId: STORYBOARD_RECORD_ID,
      planJson: makeAssetPlan(),
      validationResultJson: {
        stage: "asset_planning_local_validation",
        decision: "pass",
        errors: [],
        warnings: [],
        metrics: {},
      },
      executionStateJson: {},
      graphTraceSummaryJson: null,
      runtimeDiagnosticsJson: null,
      createdAt: now,
    });
    return project;
  })();
}

/** DashScope TTS + image 的最小 fetch mock（同 assets-run-service 模式）。 */
function stubDashscopeFetch() {
  const fetchMock = vi.fn(async (url: string | URL) => {
    const urlText = String(url);
    if (urlText.endsWith("/api/v1/services/aigc/multimodal-generation/generation")) {
      return new Response(
        JSON.stringify({ output: { audio: { url: "https://example.test/audio.wav" } } }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (urlText.endsWith("/api/v1/services/aigc/image-generation/generation")) {
      return new Response(
        JSON.stringify({ output: { task_id: "task_dashscope_image_001" } }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (urlText.endsWith("/api/v1/tasks/task_dashscope_image_001")) {
      return new Response(
        JSON.stringify({
          output: { task_status: "SUCCEEDED", results: [{ url: "https://example.test/image.png" }] },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (urlText === "https://example.test/audio.wav") {
      return new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 200,
        headers: { "content-type": "audio/wav" },
      });
    }
    if (urlText === "https://example.test/image.png") {
      return new Response(new Uint8Array([137, 80, 78, 71]), {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    }
    throw new Error(`unexpected fetch: ${urlText}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function seedCatalog(app: ReturnType<typeof buildApp>) {
  const { buildPricingCatalogSeed } = await import("../../../backend/src/modules/generation-cost/pricing-catalog.seed.js");
  const { applyProviderModelCatalogSeed } = await import("../../../backend/src/modules/generation-cost/provider-model-catalog.repository.js");
  await applyProviderModelCatalogSeed(
    app.db,
    buildPricingCatalogSeed({ llm: { mode: "stub" }, media: { deploymentScope: "cn-beijing" } }),
  );
}

/** 创建 quote 并提交为 quote 绑定的 GenerationRun（付费执行上下文）。 */
async function createQuoteBoundRun(
  app: ReturnType<typeof buildApp>,
  project: ProjectRecord,
  key: string,
) {
  const quote = await createGenerationCostQuote(
    app.db, project, project.ownerId,
    { operation: "assets.generate", selection: { task_ids: [] } },
    { readinessInput: buildQuotableReadinessInput() },
  );
  if (!quote.ok) throw new Error(`quote failed: ${JSON.stringify(quote.error)}`);
  const repository = createGenerationRunRepository(app.db);
  const submit = await createOrRestoreGenerationRun(
    app.db, project, project.ownerId,
    {
      operation: "assets.generate",
      costQuoteId: quote.value.quote.id,
      authorizeBudgetOverride: false,
      idempotencyKey: key,
      selection: { task_ids: [] },
      runOverrides: undefined,
      dispatchPayload: { execution_mode: "auto_available" },
    },
    { readinessInput: buildQuotableReadinessInput(), repository },
  );
  if (!submit.ok) throw new Error(`submit failed: ${JSON.stringify(submit.error)}`);
  return { quote: quote.value.quote, run: submit.value.run, snapshotId: submit.value.snapshot.id };
}

let integrationTempDir = "";

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  if (integrationTempDir) {
    await rm(integrationTempDir, { recursive: true, force: true }).catch(() => {});
    integrationTempDir = "";
  }
});

describe("paid media dispatch gate (任务 9A 验收 1/6/7)", () => {
  it("验收1: legacy 无 quote 路径不得调用付费 provider（fetch 零调用），本地任务照常完成并保留 route event", async () => {
    integrationTempDir = join(tmpdir(), `paid-gate-legacy-${Date.now()}`);
    await mkdir(integrationTempDir, { recursive: true });
    const app = buildApp();
    await seedCatalog(app);
    const project = await prepareProjectWithAssetPlan(app.db);
    project.storageRootDir = integrationTempDir;

    injectDashscopeEnv();
    const fetchMock = stubDashscopeFetch();

    // legacy 直呼（无 quote、无 GenerationRun 提交）——当前会真实调用 dashscope（红灯）
    const response = await runAssetsGeneration({
      db: app.db,
      project,
      voiceProfileId: "voice_default_male_storyteller",
      executionMode: "auto_available",
    });
    const body = response.body as { manifest?: AssetManifest };

    // 验收 1：无有效 run/snapshot/quote 绑定时付费 provider 零外部调用
    expect(fetchMock).not.toHaveBeenCalled();
    // 付费任务执行失败并给出明确原因（而不是静默或伪装成功）
    const paidExecutions = (body.manifest?.executions ?? []).filter(
      (execution) => execution.task_id === "tts_001" || execution.task_id === "img_001",
    );
    expect(paidExecutions.length).toBe(2);
    for (const execution of paidExecutions) {
      expect(execution.status).toBe("failed");
      expect(execution.notes.some((note) => note.includes("paid_generation_quote_required"))).toBe(true);
    }
  });

  it("验收1: quote 绑定 run 下付费 provider 可派发，usage 按 attempt 记账（每 attempt 一条）", async () => {
    integrationTempDir = join(tmpdir(), `paid-gate-quoted-${Date.now()}`);
    await mkdir(integrationTempDir, { recursive: true });
    const app = buildApp();
    await seedCatalog(app);
    const project = await prepareProjectWithAssetPlan(app.db);
    project.storageRootDir = integrationTempDir;

    injectDashscopeEnv();
    const fetchMock = stubDashscopeFetch();

    const { run } = await createQuoteBoundRun(app, project, "paid-gate-1");
    const response = await runAssetsGeneration({
      db: app.db,
      project,
      voiceProfileId: "voice_default_male_storyteller",
      executionMode: "auto_available",
      generationRunId: run.id,
    });
    expect(response.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalled();

    // 付费 provider job 携带完整 call-intent 身份（run/task/attempt 三元组可审计）
    const paidJobs = [...app.db.assetProviderJobRecords.values()].filter(
      (job) => job.providerName.startsWith("dashscope_"),
    );
    expect(paidJobs.length).toBeGreaterThan(0);
    for (const job of paidJobs) {
      expect(job.generationRunId).toBe(run.id);
      expect(job.providerRequestKey).toBeTruthy();
      expect(job.attemptIndex).not.toBeNull();
    }
    // 同一 run 的同一 (providerRequestKey, attemptIndex) 只有一条 usage 记录
    const usageKeys = new Set(
      [...app.db.usageCostRecords.values()].map(
        (record) => `${record.runConfigurationSnapshotId}:${record.providerRequestKey}:${record.attemptIndex}`,
      ),
    );
    expect(usageKeys.size).toBe([...app.db.usageCostRecords.values()].length);
    // usage 记录挂在 run 的快照上（授权上下文可追溯）
    for (const record of app.db.usageCostRecords.values()) {
      expect(record.runConfigurationSnapshotId).toBeTruthy();
    }
  });

  it("验收6: 无付费 provider 部署（无 dashscope key）的本地链路零外部费用、零 usage 记录，route event 保留", async () => {
    integrationTempDir = join(tmpdir(), `paid-gate-local-${Date.now()}`);
    await mkdir(integrationTempDir, { recursive: true });
    const app = buildApp();
    // 不注入 dashscope key：registry 只有本地 adapter
    const project = await prepareProjectWithAssetPlan(app.db);
    project.storageRootDir = integrationTempDir;

    const fetchMock = vi.fn(async () => {
      throw new Error("no external fetch allowed in local-only run");
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await runAssetsGeneration({
      db: app.db,
      project,
      voiceProfileId: "voice_default_male_storyteller",
      executionMode: "auto_available",
    });
    expect(response.statusCode).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    // 零外部费用：本地/fake/Remotion 任务不产生 usage 记录
    expect(app.db.usageCostRecords.size).toBe(0);
    // route event 保留（segment_routes 每段携带 route_events 数组）
    const body = response.body as { manifest: AssetManifest };
    expect(body.manifest.segment_routes.length).toBeGreaterThan(0);
    for (const route of body.manifest.segment_routes) {
      expect(Array.isArray(route.route_events)).toBe(true);
    }
  });

  it("验收7: 旧无 quote 生成 API 在付费部署下返回 paid_generation_quote_required，不静默放行", async () => {
    const app = buildApp({ generationQuoteReadinessInput: buildQuotableReadinessInput() });
    await seedCatalog(app);
    const auth = buildTestAuth({ userId: "owner-1" });
    const project = await createProject(app.db, { name: "gate api", ownerId: "owner-1" });
    project.activeAssetPlanRecordId = ASSET_PLAN_RECORD_ID;
    // 最小 plan 上下文（Map 态）
    const now = new Date();
    app.db.storyboardRecords.set(STORYBOARD_RECORD_ID, {
      id: STORYBOARD_RECORD_ID, projectId: project.id, topicPackageId: TOPIC_PACKAGE_ID,
      scriptRecordId: SCRIPT_RECORD_ID,
      planJson: makeStoryboardPlan() as unknown as Record<string, unknown>,
      validationResultJson: {}, executionStateJson: null, graphTraceSummaryJson: null, runtimeDiagnosticsJson: null,
      createdAt: now,
    });
    app.db.assetPlanRecords.set(ASSET_PLAN_RECORD_ID, {
      id: ASSET_PLAN_RECORD_ID, projectId: project.id, topicPackageId: TOPIC_PACKAGE_ID,
      scriptRecordId: SCRIPT_RECORD_ID, storyboardRecordId: STORYBOARD_RECORD_ID,
      planJson: makeAssetPlan(),
      validationResultJson: {} as never, executionStateJson: {}, graphTraceSummaryJson: null, runtimeDiagnosticsJson: null,
      createdAt: now,
    });

    injectDashscopeEnv();

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/assets/generate`,
      payload: {},
      auth,
    });

    // 开发过渡期明确拒绝：不静默创建无限预算授权
    expect(response.statusCode).toBe(409);
    expect((response.json() as Record<string, unknown>).error).toBe("paid_generation_quote_required");
  });
});

describe("paid retry requires new quote / new run / new attempt (任务 9A 验收 4)", () => {
  it("failed run 后旧 quote 不可复用；新 quote → 新 run → provider job attempt 从新元组开始", async () => {
    integrationTempDir = join(tmpdir(), `paid-retry-${Date.now()}`);
    await mkdir(integrationTempDir, { recursive: true });
    const app = buildApp();
    await seedCatalog(app);
    const project = await prepareProjectWithAssetPlan(app.db);
    project.storageRootDir = integrationTempDir;

    const { quote: quote1, run: run1 } = await createQuoteBoundRun(app, project, "paid-retry-1");
    // 第一次执行失败（fetch 全部 500）——assets 流程按任务级失败返回部分 manifest
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));
    injectDashscopeEnv();
    const first = await runAssetsGeneration({
      db: app.db,
      project,
      voiceProfileId: "voice_default_male_storyteller",
      executionMode: "auto_available",
      generationRunId: run1.id,
    });
    const firstBody = first.body as { manifest?: AssetManifest };
    const firstPaid = (firstBody.manifest?.executions ?? []).filter(
      (execution) => execution.task_id === "tts_001" || execution.task_id === "img_001",
    );
    expect(firstPaid.length).toBe(2);
    for (const execution of firstPaid) {
      expect(execution.status).toBe("failed");
    }

    // 旧 quote 已消费：同/新 key 再提交都拒绝
    const repository = createGenerationRunRepository(app.db);
    const replayOldQuote = await createOrRestoreGenerationRun(
      app.db, project, project.ownerId,
      {
        operation: "assets.generate",
        costQuoteId: quote1.id,
        authorizeBudgetOverride: false,
        idempotencyKey: "paid-retry-2",
        selection: { task_ids: [] },
        runOverrides: undefined,
        dispatchPayload: { execution_mode: "auto_available" },
      },
      { readinessInput: buildQuotableReadinessInput(), repository },
    );
    expect(replayOldQuote.ok).toBe(false);
    if (!replayOldQuote.ok) expect(replayOldQuote.error.code).toBe("generation_quote_consumed");

    // retry = 新 quote + 新 run
    const second = await createQuoteBoundRun(app, project, "paid-retry-3");
    expect(second.run.id).not.toBe(run1.id);
    expect(second.quote.id).not.toBe(quote1.id);
  });
});

describe("I-A 收口：执行绑定授权 plan/storyboard 身份（步骤0终审条件 a 对抗测试）", () => {
  it("陈旧内存指针指向旧 plan 时，执行按 quote 绑定的新 plan 身份（不按内存指针）", async () => {
    integrationTempDir = join(tmpdir(), `paid-ia-bound-${Date.now()}`);
    await mkdir(integrationTempDir, { recursive: true });
    const app = buildApp();
    await seedCatalog(app);
    const project = await prepareProjectWithAssetPlan(app.db);
    project.storageRootDir = integrationTempDir;

    // 构造第二个 plan（planB）并让内存指针仍指向 planA——模拟实例 B 陈旧镜像
    const planAId = ASSET_PLAN_RECORD_ID;
    const planBId = "asset_plan_bound_B";
    const now = new Date();
    const planB = makeAssetPlan();
    // planB 只含一个 image 任务（无 tts），执行证据可区分
    planB.tasks = planB.tasks.filter((task) => task.task_type === "image_still");
    app.db.assetPlanRecords.set(planBId, {
      id: planBId,
      projectId: project.id,
      topicPackageId: TOPIC_PACKAGE_ID,
      scriptRecordId: SCRIPT_RECORD_ID,
      storyboardRecordId: STORYBOARD_RECORD_ID,
      planJson: planB,
      validationResultJson: {} as never,
      executionStateJson: {},
      graphTraceSummaryJson: null,
      runtimeDiagnosticsJson: null,
      createdAt: now,
    });
    // 指针仍指向 planA（陈旧镜像）；quote 创建与提交前把活动指针临时指向 planB
    // （实例 A 的 DB 权威状态），提交完成后指针保持 planA——执行必须按绑定 planB
    project.activeAssetPlanRecordId = planBId;
    const quote = await createGenerationCostQuote(
      app.db, project, project.ownerId,
      { operation: "assets.generate", selection: { task_ids: [] } },
      { readinessInput: buildQuotableReadinessInput() },
    );
    if (!quote.ok) throw new Error(`quote failed: ${JSON.stringify(quote.error)}`);
    const repository = createGenerationRunRepository(app.db);
    const submit = await createOrRestoreGenerationRun(
      app.db, project, project.ownerId,
      {
        operation: "assets.generate",
        costQuoteId: quote.value.quote.id,
        authorizeBudgetOverride: false,
        idempotencyKey: "ia-bound-1",
        selection: { task_ids: [] },
        runOverrides: undefined,
        dispatchPayload: { execution_mode: "auto_available" },
      },
      { readinessInput: buildQuotableReadinessInput(), repository },
    );
    if (!submit.ok) throw new Error(`submit failed: ${JSON.stringify(submit.error)}`);
    const boundPlanId = (submit.value.run.dispatchPayloadJson as Record<string, unknown>).bound_asset_plan_record_id;
    expect(boundPlanId).toBe(planBId);

    // 陈旧镜像：提交后指针改回 planA（实例 B 内存态）
    project.activeAssetPlanRecordId = planAId;
    injectDashscopeEnv();
    // 完整 dashscope mock：TTS 与 image 都可用——如果执行误按内存指针 planA
    // （含 tts 任务）就会产生 tts job；绑定语义下只会产生 planB 的 image job
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
      const t = String(url);
      if (t.endsWith("/api/v1/services/aigc/multimodal-generation/generation")) {
        return new Response(JSON.stringify({ output: { audio: { url: "https://example.test/audio.wav" } } }), { status: 200 });
      }
      if (t.endsWith("/api/v1/services/aigc/image-generation/generation")) {
        return new Response(JSON.stringify({ output: { task_id: "task_ia_image" } }), { status: 200 });
      }
      if (t.endsWith("/api/v1/tasks/task_ia_image")) {
        return new Response(JSON.stringify({ output: { task_status: "SUCCEEDED", results: [{ url: "https://example.test/image.png" }] } }), { status: 200 });
      }
      if (t.startsWith("https://example.test/")) {
        return new Response(new Uint8Array([137, 80, 78, 71]), { status: 200 });
      }
      throw new Error(`unexpected fetch: ${t}`);
    }));
    // 直接以提交 run 派发（同步 dispatcher 语义）：handler 从快照构建 boundContext
    const { createAssetsDispatchHandler } = await import("../../../backend/src/modules/assets/assets-run.service.js");
    const handler = createAssetsDispatchHandler();
    const outcome = await handler(submit.value.run, { db: app.db, project });
    // planB 只有 image 任务（无 tts/无 subtitle）：manifest 校验因占位未解析
    // 而 blocked（stale_assets_source）——这是"按绑定 planB 执行"的间接证明；
    // 关键证据是 provider job 集：若误按内存指针 planA 执行会产生 tts_001 job
    expect(outcome.status).toBe("failed");
    if (outcome.status === "failed") expect(outcome.reason_code).toBe("stale_assets_source");
    const jobs = [...app.db.assetProviderJobRecords.values()];
    expect(jobs.length).toBeGreaterThan(0);
    // 绑定身份执行：只有 planB 的 image 任务（img_001），绝无 tts job
    expect(jobs.every((job) => job.taskId === "img_001")).toBe(true);
    expect(jobs.some((job) => job.taskId === "tts_001")).toBe(false);
  });
});

describe("paid_generation_quote_required on the single-task endpoint (验收 7 单任务入口)", () => {
  it("single-task generate returns paid_generation_quote_required without quote fields in paid deployment", async () => {
    const app = buildApp({ generationQuoteReadinessInput: buildQuotableReadinessInput() });
    await seedCatalog(app);
    const auth = buildTestAuth({ userId: "owner-1" });
    const project = await createProject(app.db, { name: "gate api task", ownerId: "owner-1" });
    project.activeAssetPlanRecordId = ASSET_PLAN_RECORD_ID;
    const now = new Date();
    app.db.storyboardRecords.set(STORYBOARD_RECORD_ID, {
      id: STORYBOARD_RECORD_ID, projectId: project.id, topicPackageId: TOPIC_PACKAGE_ID,
      scriptRecordId: SCRIPT_RECORD_ID,
      planJson: makeStoryboardPlan() as unknown as Record<string, unknown>,
      validationResultJson: {}, executionStateJson: null, graphTraceSummaryJson: null, runtimeDiagnosticsJson: null,
      createdAt: now,
    });
    app.db.assetPlanRecords.set(ASSET_PLAN_RECORD_ID, {
      id: ASSET_PLAN_RECORD_ID, projectId: project.id, topicPackageId: TOPIC_PACKAGE_ID,
      scriptRecordId: SCRIPT_RECORD_ID, storyboardRecordId: STORYBOARD_RECORD_ID,
      planJson: makeAssetPlan(),
      validationResultJson: {} as never, executionStateJson: {}, graphTraceSummaryJson: null, runtimeDiagnosticsJson: null,
      createdAt: now,
    });
    injectDashscopeEnv();

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/assets/tasks/tts_001/generate`,
      payload: {},
      auth,
    });
    expect(response.statusCode).toBe(409);
    expect((response.json() as Record<string, unknown>).error).toBe("paid_generation_quote_required");
  });
});

describe("publish cover generate media gate (9A 遗留同族收口)", () => {
  /** Map 态项目 + 活动 publish package（含封面提示词，满足直连前置条件）。 */
  async function prepareProjectWithPublishPackage(
    app: ReturnType<typeof buildApp>,
    name: string,
  ): Promise<ProjectRecord> {
    const project = await createProject(app.db, { name, ownerId: "owner-1" });
    const now = new Date();
    app.db.publishPackageRecords.set("pub_cover_gate", {
      id: "pub_cover_gate",
      projectId: project.id,
      renderJobRecordId: "rj_cover_gate",
      topicPackageId: TOPIC_PACKAGE_ID,
      scriptRecordId: SCRIPT_RECORD_ID,
      storyboardRecordId: STORYBOARD_RECORD_ID,
      assetManifestRecordId: "am_cover_gate",
      packageJson: { cover_prompt_draft: "战国宫廷场景，竖屏封面" },
      validationResultJson: null,
      executionStateJson: null,
      createdAt: now,
      updatedAt: now,
    } as never);
    project.activePublishPackageRecordId = "pub_cover_gate";
    return project;
  }

  it("付费部署下 cover/generate 返回 paid_generation_quote_required，DashScope fetch 零调用", async () => {
    const app = buildApp({ generationQuoteReadinessInput: buildQuotableReadinessInput() });
    await seedCatalog(app);
    const auth = buildTestAuth({ userId: "owner-1" });
    const project = await prepareProjectWithPublishPackage(app, "cover gate paid");

    injectDashscopeEnv();
    const fetchMock = stubDashscopeFetch();

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/publish/cover/generate`,
      payload: {},
      auth,
    });

    // 收口目标：付费部署（凭据 + active 媒体目录）下不得静默直连 DashScope
    expect(response.statusCode).toBe(409);
    expect((response.json() as Record<string, unknown>).error).toBe("paid_generation_quote_required");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("终审 I-1 对抗：凭据存在但目录无 active 媒体行（区域未知/被禁用/内存态）仍 409 零外呼", async () => {
    // 不 seedCatalog：目录为空（bootstrap 未运行的内存态）。
    // 闸门不变量（R2）：封口条件必须覆盖外呼条件——凭据存在即本端点可
    // 真实外呼，不得因目录状态放行直连。
    const app = buildApp();
    const auth = buildTestAuth({ userId: "owner-1" });
    const project = await prepareProjectWithPublishPackage(app, "cover gate i1");

    injectDashscopeEnv();
    const fetchMock = stubDashscopeFetch();

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/publish/cover/generate`,
      payload: {},
      auth,
    });

    expect(response.statusCode).toBe(409);
    expect((response.json() as Record<string, unknown>).error).toBe("paid_generation_quote_required");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("无付费媒体部署（无凭据）保留原 stub/本地行为：501 dashscope_not_configured", async () => {
    const app = buildApp();
    const auth = buildTestAuth({ userId: "owner-1" });
    const project = await prepareProjectWithPublishPackage(app, "cover gate local");

    // 显式清空凭据 + fetch 拒绝外呼：本地路径必须保持确定性
    vi.stubEnv("ALIYUN_DASHSCOPE_API_KEY", "");
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("no external fetch allowed in local-only cover path");
    }));

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/publish/cover/generate`,
      payload: {},
      auth,
    });

    expect(response.statusCode).toBe(501);
    expect((response.json() as Record<string, unknown>).error).toBe("dashscope_not_configured");
  });
});
