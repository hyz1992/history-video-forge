import { describe, expect, it, vi } from "vitest";

/** S2-2A 任务 12：后端 e2e 验收（实施计划任务 12 步骤 1 验收清单）。
 *
 * 重点覆盖 9B 终审登记缺口：storyboard/asset-plan/publish 三入口的 quote
 * 正链路（付费部署路径：可报价目录 + mock LLM provider）并验证 billing 落账
 * （usage 记录按 interactionId 可反查、costBasis=provider_usage）。
 *
 * 其余验收项已有专项测试（任务 1-9B 全量回归），本文件对可独立断言项做
 * 简证并引用既有测试证据。
 */

const { invokeStructuredPromptMock } = vi.hoisted(() => ({
  invokeStructuredPromptMock: vi.fn(),
}));

const { writeInteractionEntryMock } = vi.hoisted(() => ({
  writeInteractionEntryMock: vi.fn(),
}));

// 文件级 mock：env 为真实 LLM 部署（provider=openai），tier-aware 工厂返回 mock provider
vi.mock("../../backend/src/config/env.js", () => {
  const env = {
    nodeEnv: "test",
    databaseUrl: "file:./test.db",
    promptAssetsDir: process.cwd().replace(/\\/g, "/") + "/prompts",
    demoMode: false,
    generation: {
      mediaCredentialConfigured: true,
    },
    assetPlanningGenerationMode: "intent_compiler" as const,
    llm: {
      provider: "openai",
      baseUrl: "https://llm.example.test/v1",
      apiKey: "test-key",
      model: "glm-4.5",
      structuredModel: "glm-4.5",
      timeoutMs: 45000,
    },
  };
  return {
    env,
    getValidatedRuntimeEnv: () => env,
  };
});
vi.mock("../../backend/src/runtime/llm/tier-aware-provider-factory.js", () => ({
  createTierAwareProviderFromEnv: vi.fn(() => ({
    invokeStructuredPrompt: invokeStructuredPromptMock,
  })),
  resolveTierProviderSnapshot: vi.fn(() => ({
    smart: { providerKey: "deepseek", modelId: "deepseek-v4-pro" },
    flash: { providerKey: "zhipu", modelId: "glm-4" },
  })),
}));

import { buildApp } from "../../backend/src/app.js";
import { createProject } from "../../backend/src/modules/projects/project.repository.js";
import { buildTestAuth } from "./auth/test-utils.js";
import { seedQuotableCatalog, buildQuotableReadinessInput } from "./cost/quote-test-context.js";
import type { ProjectRecord } from "../../backend/src/db/client.js";

const TOPIC_PACKAGE_ID = "e2e_topic_001";
const SCRIPT_RECORD_ID = "e2e_script_001";

const scriptText = "楚王当众压场，晏子必须当场顶回，全场目光都落在他身上。";

function makeInteractionEntry(overrides: Record<string, unknown> = {}) {
  return {
    generatedAt: new Date().toISOString(),
    provider: "openai",
    model: "glm-4.5",
    operationName: "storyboard.planner",
    promptId: "storyboard.planner",
    promptStage: "planner",
    promptLanguage: "zh-CN",
    promptFilePath: "prompts/storyboard/planner.md",
    promptSha256: "sha256:test",
    promptVersion: "1",
    systemPrompt: "test prompt",
    input: {},
    rawOutput: JSON.stringify({}),
    parsedOutput: {},
    errorMessage: null,
    ...overrides,
  };
}

/** 按 operationName 返回合法结构并写 interaction entry（带 token）。 */
function mockStageResponses() {
  invokeStructuredPromptMock.mockReset();
  writeInteractionEntryMock.mockReset();
  invokeStructuredPromptMock.mockImplementation(async (request: {
    operationName?: string;
    interactionLogWriter?: { write(entry: unknown): unknown };
    regenerationContext?: unknown;
  }) => {
    const operationName = request.operationName ?? "";
    await request.interactionLogWriter?.write(
      makeInteractionEntry({
        operationName,
        promptId: operationName,
        responseMetadata: { promptTokens: 500, completionTokens: 300, finishReason: "stop" },
      }),
    );

    if (operationName === "storyboard.planner") {
      return {
        plan_version: "storyboard_v1",
        source_script_record_id: SCRIPT_RECORD_ID,
        source_topic_package_id: TOPIC_PACKAGE_ID,
        estimated_total_duration_sec: 12,
        segments: [
          {
            segment_id: "sb_e2e_1",
            order: 0,
            script_excerpt: scriptText,
            start_hint_sec: 0,
            end_hint_sec: 12,
            narrative_role: "opening",
            visual_intent: "朝堂对峙，晏子答话",
            scene_description: "大殿之上，楚王压场",
            visual_elements: ["晏子", "大殿"],
            framing_hint: "medium",
            content_type: "live_action",
            motion_hint: "push_in",
            editing_hint: "single",
            on_screen_text: [],
            linked_beats: ["answer"],
            linked_quotes: [],
            risk_notes: [],
            api_video_suitability: "remotion_sufficient",
          },
        ],
        global_visual_notes: [],
      };
    }

    if (operationName === "asset-planning.planner") {
      return {
        planning_mode: "global",
        art_bible: {
          era_style: "春秋战国",
          visual_tone: "庄重紧张",
          characters: [{
            character_id: "yanzi",
            label: "晏子",
            role: "主角",
            visual_description: "使节正装，神情沉稳",
            consistency_notes: [],
          }],
          locations: [{
            location_id: "hall",
            label: "楚宫大殿",
            role: "主场景",
            visual_description: "庄严肃穆的大殿",
            consistency_notes: [],
          }],
          props: [],
          global_prompt_prefix: "春秋战国历史短剧",
          global_negative_prompts: [],
          consistency_notes: [],
        },
        visual_budget: { mode: "balanced" },
        downgrade_policy: { video_to_image: true },
        global_audio_strategy: {
          voice_intent: {
            content_family: "历史叙事",
            narrator_persona: "沉稳讲述者",
            desired_traits: ["克制"],
            avoid_traits: ["夸张"],
            pace: "medium",
            style_notes: ["清晰"],
          },
        },
        manual_review_notes: ["人工复核史实"],
      };
    }

    if (operationName === "asset-planning.asset-structural-repair" || operationName === "asset-planning.global-structural-repair") {
      // repair 分支：返回与主分支一致的合法结构（e2e 只验证正链路，repair 不触发）
      return {
        planning_mode: "global",
        art_bible: {
          era_style: "春秋战国",
          visual_tone: "庄重紧张",
          characters: [{
            character_id: "yanzi",
            label: "晏子",
            role: "主角",
            visual_description: "使节正装，神情沉稳",
            consistency_notes: [],
          }],
          locations: [{
            location_id: "hall",
            label: "楚宫大殿",
            role: "主场景",
            visual_description: "庄严肃穆的大殿",
            consistency_notes: [],
          }],
          props: [],
          global_prompt_prefix: "春秋战国历史短剧",
          global_negative_prompts: [],
          consistency_notes: [],
        },
        visual_budget: { mode: "balanced" },
        downgrade_policy: { video_to_image: true },
        global_audio_strategy: {
          voice_intent: {
            content_family: "历史叙事",
            narrator_persona: "沉稳讲述者",
            desired_traits: ["克制"],
            avoid_traits: ["夸张"],
            pace: "medium",
            style_notes: ["清晰"],
          },
        },
        manual_review_notes: ["人工复核史实"],
      };
    }

    if (operationName === "asset-planning.segment-intent-planner") {
      return {
        planning_mode: "segment_intent_batch",
        segments: [
          {
            source_segment_id: "sb_e2e_1",
            intents: [
              {
                asset_kind: "image_still",
                production_intent: "大殿对峙全景",
                image_prompt: "楚王高坐，晏子立于殿中",
                video_prompt_reserve: "如后续升级视频，用此画面做运镜起点",
                image_role: "anchor",
                support_reason: null,
                risk_notes: ["构图稳妥"],
              },
              {
                asset_kind: "render_motion_cue",
                production_intent: "缓慢推近",
                risk_notes: ["运镜简单"],
              },
              {
                asset_kind: "sfx_cue",
                production_intent: "朝堂低频压迫音",
                required_tags: ["drum"],
                mood_tags: ["tense"],
                selection_label: "drum_roll",
                timing_basis: "tts",
                risk_notes: ["低频压迫"],
              },
              {
                asset_kind: "bgm_cue",
                production_intent: "全片庄重配乐",
                required_tags: ["弦乐"],
                mood_tags: ["庄重"],
                selection_label: "bgm_choice",
                timing_basis: "tts",
                scope: "global",
                segment_ids: [],
                volume: 0.35,
                fade_in_sec: 0.5,
                fade_out_sec: 1.5,
                risk_notes: ["配乐克制"],
              },
            ],
            budget_notes: ["本段预算低"],
          },
        ],
        budget_notes: [],
      };
    }

    if (operationName === "publish.cover-prompt-generator") {
      return { cover_prompt: "竖屏封面：晏子立于大殿，庄重" };
    }
    if (operationName === "publish.description-generator") {
      return { description: "一场外交压场与顶回的对决。" };
    }
    if (operationName === "publish.title-generator") {
      return {
        candidates: [{ candidate_id: "c1", text: "晏子使楚：当场顶回", style: "standard" }],
      };
    }

    throw new Error(`unexpected operationName: ${operationName}`);
  });
}

/** 最小项目上下文：topic package + script record（storyboard/asset-plan/publish 共用上游）。 */
async function prepareProjectWithUpstream(app: ReturnType<typeof buildApp>): Promise<ProjectRecord> {
  const project = await createProject(app.db, { name: "e2e quote positive", ownerId: "owner-1" });
  const now = new Date();
  app.db.topicPackages.set(TOPIC_PACKAGE_ID, {
    id: TOPIC_PACKAGE_ID,
    projectId: project.id,
    eventRegistryEntryId: "ev_e2e",
    canonicalName: "晏子使楚",
    title: "晏子使楚",
    selectedAngle: "外交压场型",
    familyLabel: "diplomacy",
    scopeLabel: "single_event",
    coreConflict: "楚王当众压场，晏子必须当场顶回。",
    strongScene: "楚王连续压场，晏子一句句顶回去。",
    stakes: "使节尊严与国格",
    packagingSeed: "一句话改变整个房间的气氛。",
    canonicalQuotesJson: [],
    canonicalQuoteIntentsJson: [],
    durationBandJson: { label: "medium" },
    narrativeTensionMapJson: {
      hook_claim: "楚王当众压场",
      pressure_escalation: "连续羞辱",
      mid_reveal: "晏子反击",
      peak_payoff: "全场噤声",
      ending_residue: "使节尊严立住",
    },
    mustIncludeBeatsJson: [],
    forbiddenExpansionsJson: [],
    riskHintsJson: [],
    sourceAnchorRefsJson: ["《晏子春秋》"],
    ambiguityNotesJson: [],
    sourceMode: "system_recommendation",
    sourceRefJson: null,
    createdAt: now,
  } as never);
  project.activeTopicPackageId = TOPIC_PACKAGE_ID;

  app.db.scriptRecords.set(SCRIPT_RECORD_ID, {
    id: SCRIPT_RECORD_ID,
    projectId: project.id,
    topicPackageId: TOPIC_PACKAGE_ID,
    scriptText,
    openingSpan: "楚王当众压场。",
    endingSpan: "使节尊严立住。",
    estimatedDurationSec: 12,
    beatTraceJson: [
      { beat: "answer", excerpt: "晏子当场顶回。", confidence: 0.95 },
    ],
    quoteTraceJson: [],
    reviewStatus: "pass",
    validationResultJson: { stage: "script_local_validation", decision: "pass" },
    semanticReviewResultJson: { stage: "script_semantic_review", decision: "pass", patch_intent: null },
    executionStateJson: { patch_used: false, regenerate_used: false },
    graphTraceSummaryJson: null,
    runtimeDiagnosticsJson: null,
    createdAt: now,
  } as never);
  project.activeScriptRecordId = SCRIPT_RECORD_ID;
  return project;
}

describe("S2-2A e2e：三入口 quote 正链路 + billing 落账（9B 缺口收口）", () => {
  const auth = buildTestAuth({ userId: "owner-1" });

  /** 创建 quote 并通过 API 提交，返回响应与 run。 */
  async function submitWithQuote(
    app: ReturnType<typeof buildApp>,
    project: ProjectRecord,
    operation: string,
    url: string,
    key: string,
    payload: Record<string, unknown> = {},
  ) {
    const quoteRes = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/generation-cost-quotes`,
      payload: { operation },
      auth,
    });
    expect(quoteRes.statusCode).toBe(200);
    const quote = quoteRes.json() as { quote_id: string };
    const response = await app.inject({
      method: "POST",
      url,
      payload: { ...payload, cost_quote_id: quote.quote_id, idempotency_key: key },
      auth,
    });
    return { response, quoteId: quote.quote_id };
  }

  function assertBilling(
    app: ReturnType<typeof buildApp>,
    runIdPrefix: string,
    operationNames: string[],
    capability: "llm.smart" | "llm.flash" = "llm.smart",
  ) {
    const usages = [...app.db.usageCostRecords.values()];
    expect(usages.length).toBeGreaterThanOrEqual(operationNames.length);
    for (const name of operationNames) {
      const matched = usages.filter((usage) => usage.interactionId?.includes(`:${name}:`));
      expect(matched.length).toBeGreaterThan(0);
      for (const usage of matched) {
        expect(usage.interactionId).toMatch(new RegExp(`^${runIdPrefix}_[0-9a-f-]+:${name}:\\d+$`));
        expect(usage.capability).toBe(capability);
        expect(usage.costBasis).toBe("provider_usage");
        expect(usage.actualCostMicros).not.toBeNull();
        expect(usage.inputUnits).toBe(500);
        expect(usage.outputUnits).toBe(300);
      }
    }
  }

  it("storyboard.generate quote 正链路：提交成功、run succeeded、billing 落账", async () => {
    const app = buildApp({ generationQuoteReadinessInput: buildQuotableReadinessInput() });
    await seedQuotableCatalog(app);
    mockStageResponses();
    const project = await prepareProjectWithUpstream(app);

    const { response, quoteId } = await submitWithQuote(
      app, project, "storyboard.generate",
      `/api/projects/${project.id}/storyboard/generate`,
      "e2e-storyboard-1",
    );

    expect(response.statusCode).toBe(200);
    const body = response.json() as Record<string, unknown>;
    expect(body.storyboard_record_id).toBeTruthy();
    expect(body.generation_run_id).toBeTruthy();
    const run = [...app.db.generationRuns.values()].find((r) => r.quoteId === quoteId);
    expect(run?.status).toBe("succeeded");
    assertBilling(app, "storyboard_run", ["storyboard.planner"]);
  });

  it("asset_plan.generate quote 正链路：提交成功、run succeeded、billing 落账", async () => {
    const app = buildApp({ generationQuoteReadinessInput: buildQuotableReadinessInput() });
    await seedQuotableCatalog(app);
    mockStageResponses();
    const project = await prepareProjectWithUpstream(app);

    // 前置：storyboard record（asset-plan 的输入；付费部署下同样走 quote 提交）
    const sbRes = await submitWithQuote(
      app, project, "storyboard.generate",
      `/api/projects/${project.id}/storyboard/generate`,
      "e2e-sb-for-ap",
    );
    expect(sbRes.response.statusCode).toBe(200);
    expect(project.activeStoryboardRecordId).toBeTruthy();

    const { response, quoteId } = await submitWithQuote(
      app, project, "asset_plan.generate",
      `/api/projects/${project.id}/asset-plan/generate`,
      "e2e-assetplan-1",
    );

    if (response.statusCode !== 200) {
      console.log("AP RESP:", JSON.stringify(response.json()).slice(0, 1000));
    }
    expect(response.statusCode).toBe(200);
    const body = response.json() as Record<string, unknown>;
    expect(body.asset_plan_record_id).toBeTruthy();
    const run = [...app.db.generationRuns.values()].find((r) => r.quoteId === quoteId);
    expect(run?.status).toBe("succeeded");
    assertBilling(app, "asset_plan_run", [
      "asset-planning.planner",
      "asset-planning.segment-intent-planner",
    ]);
  });

  it("publish.generate quote 正链路：提交成功、run succeeded、billing 落账", async () => {
    const app = buildApp({ generationQuoteReadinessInput: buildQuotableReadinessInput() });
    await seedQuotableCatalog(app);
    mockStageResponses();
    const project = await prepareProjectWithUpstream(app);

    // 前置：完整上游（storyboard + asset plan + manifest + compose + render completed；
    // 付费部署下前置生成同样走 quote 提交）
    const sbRes = await submitWithQuote(
      app, project, "storyboard.generate",
      `/api/projects/${project.id}/storyboard/generate`,
      "e2e-sb-for-pub",
    );
    expect(sbRes.response.statusCode).toBe(200);
    const apRes = await submitWithQuote(
      app, project, "asset_plan.generate",
      `/api/projects/${project.id}/asset-plan/generate`,
      "e2e-ap-for-pub",
    );
    expect(apRes.response.statusCode).toBe(200);

    const now = new Date();
    const manifestId = "e2e_manifest_001";
    app.db.assetManifestRecords.set(manifestId, {
      id: manifestId,
      projectId: project.id,
      topicPackageId: TOPIC_PACKAGE_ID,
      scriptRecordId: SCRIPT_RECORD_ID,
      storyboardRecordId: project.activeStoryboardRecordId!,
      assetPlanRecordId: project.activeAssetPlanRecordId!,
      manifestJson: {
        manifest_version: "asset_manifest_v1",
        source_asset_plan_id: project.activeAssetPlanRecordId,
        executions: [],
        artifacts: [],
        audio_summary: {},
        segment_routes: [],
        readiness: "ready_for_compose",
        notes: [],
      },
      validationResultJson: { stage: "assets_local_validation", decision: "pass" },
      executionStateJson: { generating: false },
      graphTraceSummaryJson: null,
      runtimeDiagnosticsJson: null,
      createdAt: now,
    } as never);
    project.activeAssetManifestRecordId = manifestId;

    const composeId = "e2e_compose_001";
    app.db.composeRecords.set(composeId, {
      id: composeId,
      projectId: project.id,
      topicPackageId: TOPIC_PACKAGE_ID,
      scriptRecordId: SCRIPT_RECORD_ID,
      storyboardRecordId: project.activeStoryboardRecordId!,
      assetManifestRecordId: manifestId,
      timelineJson: { timeline_version: "compose_timeline_v1", tracks: [] },
      validationResultJson: { stage: "compose_local_validation", decision: "pass" },
      executionStateJson: null,
      graphTraceSummaryJson: null,
      runtimeDiagnosticsJson: null,
      createdAt: now,
    } as never);
    project.activeComposeRecordId = composeId;

    const renderId = "e2e_render_001";
    app.db.renderJobRecords.set(renderId, {
      id: renderId,
      projectId: project.id,
      composeRecordId: composeId,
      status: "completed",
      outputArtifactJson: {
        artifact_id: "export_001",
        file_uri: "/tmp/export.mp4",
        duration_sec: 60,
        metadata: {},
      },
      errorJson: null,
      executionStateJson: null,
      graphTraceSummaryJson: null,
      runtimeDiagnosticsJson: null,
      createdAt: now,
      updatedAt: now,
    } as never);
    project.activeRenderJobRecordId = renderId;

    const { response, quoteId } = await submitWithQuote(
      app, project, "publish.generate",
      `/api/projects/${project.id}/publish/generate`,
      "e2e-publish-1",
    );

    expect(response.statusCode).toBe(201);
    const run = [...app.db.generationRuns.values()].find((r) => r.quoteId === quoteId);
    expect(run?.status).toBe("succeeded");
    assertBilling(app, "publish_run", [
      "publish.cover-prompt-generator",
      "publish.description-generator",
      "publish.title-generator",
    ], "llm.flash");
  });
});

describe("S2-2A e2e：验收清单可独立断言项（任务 12 步骤 1）", () => {
  const auth = buildTestAuth({ userId: "owner-1" });

  it("验收 1/2：用户默认四档可设置；新项目冻结用户默认，修改默认不追溯旧项目", async () => {
    const app = buildApp();
    // 用户设置 all_api_video
    const prefRes = await app.inject({
      method: "PATCH",
      url: "/api/me/generation-preferences",
      payload: {
        expected_revision: null,
        video: { strategy: "all_api_video", api_quality: "high_1080p" },
        budget: { currency: "CNY", max_paid_cost_micros_per_run: null },
      },
      auth,
    });
    expect(prefRes.statusCode).toBe(200);

    // 新项目冻结用户默认
    const project = await createProject(app.db, { name: "e2e freeze", ownerId: "owner-1" });
    const configRes = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/generation-configuration`,
      auth,
    });
    expect(configRes.statusCode).toBe(200);
    const config = configRes.json() as { configuration: { video: { strategy: string; api_quality: string } }; source_user_preference_revision: number | null };
    expect(config.configuration.video.strategy).toBe("all_api_video");
    expect(config.configuration.video.api_quality).toBe("high_1080p");
    expect(config.source_user_preference_revision).not.toBeNull();

    // 修改用户默认不影响既有项目
    await app.inject({
      method: "PATCH",
      url: "/api/me/generation-preferences",
      payload: {
        expected_revision: 1,
        video: { strategy: "all_remotion", api_quality: "standard_720p" },
        budget: { currency: "CNY", max_paid_cost_micros_per_run: null },
      },
      auth,
    });
    const configAfter = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/generation-configuration`,
      auth,
    });
    const after = configAfter.json() as { configuration: { video: { strategy: string } } };
    expect(after.configuration.video.strategy).toBe("all_api_video");
  });

  it("验收 11：媒体 capability slot 已占位且目录项来自服务端 seed（无假 provider）", async () => {
    const app = buildApp({ generationQuoteReadinessInput: buildQuotableReadinessInput() });
    await seedQuotableCatalog(app);
    const capRes = await app.inject({ method: "GET", url: "/api/generation-capabilities", auth });
    expect(capRes.statusCode).toBe(200);
    const body = capRes.json() as {
      capabilities: Array<{ capability: string; provider_key: string; status: string; availability: string }>;
    };
    const slots = new Set(body.capabilities.map((c) => c.capability));
    // 五个 capability slot 均已占位
    for (const slot of ["llm.smart", "llm.flash", "image.generate", "video.image_to_video", "tts.synthesize"]) {
      expect(slots.has(slot)).toBe(true);
    }
    // 媒体能力只暴露 dashscope 真实可用项
    for (const entry of body.capabilities) {
      if (entry.capability.startsWith("image.") || entry.capability.startsWith("video.") || entry.capability.startsWith("tts.")) {
        expect(entry.provider_key).toBe("dashscope");
      }
    }
  });

  it("验收 13：S2-2B/C 在 roadmap 中标记为紧接后续（文档检查）", async () => {
    const roadmap = await import("fs/promises").then((fs) =>
      fs.readFile("docs/todos/roadmap-todo.md", "utf-8"),
    );
    expect(roadmap).toContain("S2-2B");
    expect(roadmap).toContain("S2-2C");
    // S2-2B/C 标记为紧接 S2-2A 的后续
    expect(roadmap).toContain("紧接后续");
  });
});
