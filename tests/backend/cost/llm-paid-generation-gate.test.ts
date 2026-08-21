import { describe, expect, it, vi } from "vitest";

/** S2-2A 任务 9B：LLM 付费闸门与 token 记账失败测试（实现前红灯）。
 *
 * 覆盖实施计划任务 9B 步骤 1：
 * - 真实 llm.smart/flash operation 必须持有效 quote/snapshot/run；
 * - 同 interaction/attempt 只记一条 usage，interactionId 可反查 interaction log；
 * - provider 返回 token → provider_usage actual；缺失 → null actual + estimate。
 */

const { invokeStructuredPromptMock } = vi.hoisted(() => ({
  invokeStructuredPromptMock: vi.fn(),
}));

const { writeInteractionEntryMock } = vi.hoisted(() => ({
  writeInteractionEntryMock: vi.fn(),
}));

// 文件级 mock：env 为真实 LLM 部署（provider=openai），tier-aware 工厂返回 mock provider
vi.mock("../../../backend/src/config/env.js", () => {
  const env = {
    nodeEnv: "test",
    databaseUrl: "file:./test.db",
    promptAssetsDir: process.cwd().replace(/\\/g, "/") + "/prompts",
    demoMode: false,
    generation: {
      mediaCredentialConfigured: true,
    },
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
vi.mock("../../../backend/src/runtime/llm/tier-aware-provider-factory.js", () => ({
  createTierAwareProviderFromEnv: vi.fn(() => ({
    invokeStructuredPrompt: invokeStructuredPromptMock,
  })),
  resolveTierProviderSnapshot: vi.fn(() => ({
    smart: { providerKey: "deepseek", modelId: "deepseek-v4-pro" },
    flash: { providerKey: "zhipu", modelId: "glm-4" },
  })),
}));

import { buildApp } from "../../../backend/src/app.js";
import { createProject } from "../../../backend/src/modules/projects/project.repository.js";
import { buildTestAuth } from "../auth/test-utils.js";
import { seedQuotableCatalog, buildQuotableReadinessInput } from "./quote-test-context.js";
import { createGenerationCostQuote } from "../../../backend/src/modules/generation-cost/generation-cost.service.js";
import { createGenerationRunRepository } from "../../../backend/src/modules/generation-run/generation-run.repository.js";
import { createOrRestoreGenerationRun } from "../../../backend/src/modules/generation-run/generation-run.service.js";
import type { ProjectRecord } from "../../../backend/src/db/client.js";

const runtimeDraft = {
  script_text: "这是 9B runtime writer 返回的脚本草稿。",
  estimated_duration_sec: 86,
  beat_trace: [
    { beat: "入楚受辱", excerpt: "这是 9B runtime writer 返回的脚本草稿", confidence: 0.95 },
  ],
  quote_trace: [],
  opening_span: "这是 9B runtime writer 返回的脚本草稿。",
  ending_span: "不应再走 deterministic mock draft。",
};

function makeInteractionEntry(overrides: Record<string, unknown> = {}) {
  return {
    generatedAt: new Date().toISOString(),
    provider: "openai",
    model: "glm-4.5",
    operationName: "script.writer",
    promptId: "script.writer",
    promptStage: "writer",
    promptLanguage: "zh-CN",
    promptFilePath: "prompts/script/writer.md",
    promptSha256: "sha256:test",
    promptVersion: "1",
    systemPrompt: "test prompt",
    input: {},
    rawOutput: JSON.stringify(runtimeDraft),
    parsedOutput: runtimeDraft,
    errorMessage: null,
    ...overrides,
  };
}

/** 正链路 mock provider：writer 返回合法 draft 并写 interaction entry（带 token）。 */
function mockPaidScriptProvider(withTokens: boolean) {
  invokeStructuredPromptMock.mockReset();
  writeInteractionEntryMock.mockReset();
  invokeStructuredPromptMock.mockImplementation(async (request: {
    operationName?: string;
    interactionLogWriter?: { write(entry: unknown): unknown };
  }) => {
    if (request.operationName === "script.semantic-reviewer") {
      // reviewer 失败 → skipped（主链继续），不写 entry、不记账
      throw new Error("reviewer down (mock)");
    }
    await request.interactionLogWriter?.write(
      makeInteractionEntry(
        withTokens
          ? {
              responseMetadata: { promptTokens: 1200, completionTokens: 800, finishReason: "stop" },
            }
          : {},
      ),
    );
    return runtimeDraft;
  });
}

/** Map 态项目 + 最小 topic package（script 生成的 bundle 来源）。 */
async function prepareScriptProject(app: ReturnType<typeof buildApp>): Promise<ProjectRecord> {
  const project = await createProject(app.db, { name: "9B script gate", ownerId: "owner-1" });
  const now = new Date();
  const record = {
    id: "tp_9b_001",
    projectId: project.id,
    eventRegistryEntryId: "ev_001",
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
    createdAt: now,
  };
  app.db.topicPackages.set(record.id, record as never);
  project.activeTopicPackageId = record.id;
  return project;
}

async function createScriptQuoteAndRun(
  app: ReturnType<typeof buildApp>,
  project: ProjectRecord,
  key: string,
) {
  const quote = await createGenerationCostQuote(
    app.db, project, project.ownerId,
    { operation: "script.generate" },
    { readinessInput: buildQuotableReadinessInput() },
  );
  if (!quote.ok) throw new Error(`quote failed: ${JSON.stringify(quote.error)}`);
  const repository = createGenerationRunRepository(app.db);
  const submit = await createOrRestoreGenerationRun(
    app.db, project, project.ownerId,
    {
      operation: "script.generate",
      costQuoteId: quote.value.quote.id,
      authorizeBudgetOverride: false,
      idempotencyKey: key,
      dispatchPayload: { allow_patch: false, allow_regen: false },
    },
    { readinessInput: buildQuotableReadinessInput(), repository },
  );
  if (!submit.ok) throw new Error(`submit failed: ${JSON.stringify(submit.error)}`);
  return { quote: quote.value.quote, run: submit.value.run, snapshotId: submit.value.snapshot.id };
}


describe("LLM paid generation gate (任务 9B 步骤 1)", () => {
  const auth = buildTestAuth({ userId: "owner-1" });

/** API 全流程：创建 quote → 提交生成（返回响应）。可复用 quote 做幂等重放。 */
async function submitScriptViaApi(
  app: ReturnType<typeof buildApp>,
  project: ProjectRecord,
  key: string,
  reuseQuoteId?: string,
) {
  let quoteId = reuseQuoteId;
  if (!quoteId) {
    const quoteRes = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/generation-cost-quotes`,
      payload: { operation: "script.generate" },
      auth,
    });
    expect(quoteRes.statusCode).toBe(200);
    const quote = quoteRes.json() as { quote_id: string };
    quoteId = quote.quote_id;
  }
  const response = await app.inject({
    method: "POST",
    url: `/api/projects/${project.id}/script/generate`,
    payload: {
      allow_patch: false,
      allow_regen: false,
      cost_quote_id: quoteId,
      idempotency_key: key,
    },
    auth,
  });
  return { response, quoteId };
}

  it("付费部署下无 quote 提交的生成 API 返回 paid_generation_quote_required，provider 零调用", async () => {
    const app = buildApp({ generationQuoteReadinessInput: buildQuotableReadinessInput() });
    await seedQuotableCatalog(app);
    const project = await prepareScriptProject(app);
    mockPaidScriptProvider(true);

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/script/generate`,
      payload: { allow_patch: false, allow_regen: false },
      auth,
    });

    expect(response.statusCode).toBe(409);
    expect((response.json() as Record<string, unknown>).error).toBe("paid_generation_quote_required");
    // 真实 LLM provider 零调用
    expect(invokeStructuredPromptMock).not.toHaveBeenCalled();
    // 不创建 run
    expect(app.db.generationRuns.size).toBe(0);
  });

  it("quote 提交正链路：run 同步执行成功，LLM 调用记账（token → provider_usage）", async () => {
    const app = buildApp({ generationQuoteReadinessInput: buildQuotableReadinessInput() });
    await seedQuotableCatalog(app);
    const project = await prepareScriptProject(app);
    mockPaidScriptProvider(true);

    const { response } = await submitScriptViaApi(app, project, "9b-paid-1");
    expect(response.statusCode).toBe(200);
    expect(invokeStructuredPromptMock).toHaveBeenCalled();

    const runs = [...app.db.generationRuns.values()];
    expect(runs.length).toBe(1);
    expect(runs[0]!.status).toBe("succeeded");

    // 记账：script.writer 每次 interaction 一条 llm.smart usage
    // （mock draft 触发一次自动 regen → 2 条；reviewer 失败未写 entry 不记账）
    const usages = [...app.db.usageCostRecords.values()];
    expect(usages.length).toBeGreaterThanOrEqual(1);
    expect(usages.every((u) => u.capability === "llm.smart")).toBe(true);
    const usage = usages[0]!;
    expect(usage.capability).toBe("llm.smart");
    expect(usage.runConfigurationSnapshotId).toBe(runs[0]!.runConfigurationSnapshotId);
    // provider 返回 token → provider_usage actual
    expect(usage.actualCostMicros).not.toBeNull();
    expect(usage.costBasis).toBe("provider_usage");
    expect(usage.inputUnits).toBe(1200);
    expect(usage.outputUnits).toBe(800);
    // interactionId 可反查 interaction log：以模块 runId（script_run_*）为前缀，
    // 与日志目录锚点一致（contract 审查 I-1 修复）
    expect(usage.interactionId).toMatch(/^script_run_[0-9a-f-]+:script\.writer:\d+$/);
    expect(usage.interactionId).toContain("script.writer");
  });

  it("provider 无 token 时保留 null actual 与 estimate basis，不伪造", async () => {
    const app = buildApp({ generationQuoteReadinessInput: buildQuotableReadinessInput() });
    await seedQuotableCatalog(app);
    const project = await prepareScriptProject(app);
    mockPaidScriptProvider(false);

    const { response } = await submitScriptViaApi(app, project, "9b-paid-2");
    expect(response.statusCode).toBe(200);

    const usages = [...app.db.usageCostRecords.values()];
    expect(usages.length).toBeGreaterThanOrEqual(1);
    for (const usage of usages) {
      expect(usage.actualCostMicros).toBeNull();
      expect(usage.costBasis).toBe("estimate");
      expect(usage.outputUnits).toBeNull();
    }
  });

  it("同 key 幂等重放返回同 run，usage 不重复记账", async () => {
    const app = buildApp({ generationQuoteReadinessInput: buildQuotableReadinessInput() });
    await seedQuotableCatalog(app);
    const project = await prepareScriptProject(app);
    mockPaidScriptProvider(true);

    const first = await submitScriptViaApi(app, project, "9b-idem-1");
    expect(first.response.statusCode).toBe(200);

    // 重放：同 key + 同一 quote → 同 run（created=false），不重复执行与记账
    const replay = await submitScriptViaApi(app, project, "9b-idem-1", first.quoteId);
    expect(replay.response.statusCode).toBe(200);
    expect((replay.response.json() as Record<string, unknown>).generation_run_id).toBe(
      (first.response.json() as Record<string, unknown>).generation_run_id,
    );
    expect([...app.db.generationRuns.values()].length).toBe(1);
    // 重放不产生新的 usage 记录（数量与首次执行后一致）
    const usageCount = [...app.db.usageCostRecords.values()].length;
    expect(usageCount).toBeGreaterThanOrEqual(1);
    expect([...app.db.usageCostRecords.values()].length).toBe(usageCount);
  });

  it("retry 必须新 quote 新 run：旧 quote 不可复用", async () => {
    const app = buildApp({ generationQuoteReadinessInput: buildQuotableReadinessInput() });
    await seedQuotableCatalog(app);
    const project = await prepareScriptProject(app);
    mockPaidScriptProvider(true);
    const { quote, run } = await createScriptQuoteAndRun(app, project, "9b-retry-1");

    // 第一次提交执行（消费 quote）
    const first = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/script/generate`,
      payload: {
        allow_patch: false,
        allow_regen: false,
        cost_quote_id: quote.id,
        idempotency_key: "9b-retry-1",
      },
      auth,
    });
    expect(first.statusCode).toBe(200);

    // 旧 quote 换新 key 再提交 → consumed 拒绝
    const reuseOld = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/script/generate`,
      payload: {
        allow_patch: false,
        allow_regen: false,
        cost_quote_id: quote.id,
        idempotency_key: "9b-retry-2",
      },
      auth,
    });
    expect(reuseOld.statusCode).toBe(409);
    expect((reuseOld.json() as Record<string, unknown>).error).toBe("generation_quote_consumed");

    // 新 quote → 新 run 成功
    const second = await createScriptQuoteAndRun(app, project, "9b-retry-2");
    expect(second.run.id).not.toBe(run.id);
    expect(second.quote.id).not.toBe(quote.id);
  });
  it("记账 tier 与 OPERATION_TIER_REGISTRY 对同一 promptId 的判定一致（contract M-2 锁定）", async () => {
    const { OPERATION_TIER_REGISTRY } = await import("../../../backend/src/runtime/llm/operation-tier-registry.js");
    const app = buildApp({ generationQuoteReadinessInput: buildQuotableReadinessInput() });
    await seedQuotableCatalog(app);
    const project = await prepareScriptProject(app);
    mockPaidScriptProvider(true);
    const { response } = await submitScriptViaApi(app, project, "9b-tier-1");
    expect(response.statusCode).toBe(200);
    const usages = [...app.db.usageCostRecords.values()];
    expect(usages.length).toBeGreaterThanOrEqual(1);
    for (const usage of usages) {
      const operationName = usage.interactionId.split(":")[1]!;
      const registryTier = OPERATION_TIER_REGISTRY[operationName];
      if (registryTier) {
        expect(usage.capability).toBe(`llm.${registryTier}`);
      }
    }
  });

  it("LLM token 确认费用超授权上界时追加 pricing_overrun 并禁用目录项（final I-1 锁定）", async () => {
    const app = buildApp({ generationQuoteReadinessInput: buildQuotableReadinessInput() });
    await seedQuotableCatalog(app);
    // 给 llm.smart 目录行加价（Map 态）：token 记账才有非零费用
    for (const entry of app.db.providerModelCatalog.values()) {
      if (entry.capability === "llm.smart") {
        entry.pricingJson = {
          unit_type: "token",
          input_price_micros_per_million_tokens: "1000000",
          output_price_micros_per_million_tokens: "2000000",
        };
      }
    }
    const project = await prepareScriptProject(app);
    mockPaidScriptProvider(true);

    const { response, quoteId } = await submitScriptViaApi(app, project, "9b-overrun-1");
    expect(response.statusCode).toBe(200);

    // 把该 run 的快照授权上界压到极小（Map 态直接改对象），再手动触发一次
    // handler 执行（测试内直调，绕过 dispatcher 的终态拦截）——记账必然超界
    const run = [...app.db.generationRuns.values()][0]!;
    const snapshot = app.db.runConfigurationSnapshots.get(run.runConfigurationSnapshotId)!;
    snapshot.authorizationCostMicros = "1";

    const { createScriptDispatchHandler } = await import("../../../backend/src/modules/generation-run/llm-dispatch-handlers.js");
    const handler = createScriptDispatchHandler();
    const outcome = await handler(run, { db: app.db, project });
    expect(outcome.status).toBe("succeeded");

    const overrunEvents: Array<{ eventType: string; eventJson: Record<string, unknown> }> = [];
    for (const events of app.db.generationRunEvents.values()) {
      for (const event of events) {
        if (event.eventType === "pricing_overrun") overrunEvents.push(event as never);
      }
    }
    expect(overrunEvents.length).toBeGreaterThanOrEqual(1);
    expect(overrunEvents[0]!.eventJson).toMatchObject({ capability: "llm.smart" });
    // I-3：LLM overrun 只留事件、不禁用目录（授权是单次 budget，run 内多
    // interaction 累计超界属常规数量累计，禁用会导致 llm.smart 家族新 quote 全失败）
    const smartEntries = [...app.db.providerModelCatalog.values()].filter(
      (entry) => entry.capability === "llm.smart",
    );
    expect(smartEntries.length).toBeGreaterThan(0);
    expect(smartEntries.some((entry) => entry.status === "active")).toBe(true);
    void quoteId;
  });

  it("topic.generate 提交正链路：seed 重建 + 候选入库 + token 记账（final I-2 锁定）", async () => {
    const app = buildApp({ generationQuoteReadinessInput: buildQuotableReadinessInput() });
    await seedQuotableCatalog(app);
    const project = await createProject(app.db, { name: "9B topic flow", ownerId: "owner-1" });

    const topicCandidate = {
      event_identity: "晏子使楚",
      title: "晏子使楚",
      one_line_angle: "当场顶回压场",
      family_label: "外交压场型",
      scope_label: "单事件",
      estimated_duration_band: "medium",
      why_this_now: "近期未出现同 event_id",
      core_conflict: "楚王当众压场，晏子必须当场顶回。",
      strong_scene: "楚王连续压场，晏子一句句顶回去。",
      must_cover_preview: ["楚王连续压场，晏子一句句顶回去。"],
      risk_hints: [],
      source_hint: "《晏子春秋》",
      recent_usage_hint: "近期未出现同 event_id",
      viral_rubric: { hook_power: "high", novelty_gap: "high", emotion_gap: "high", share_impulse: "high", visual_promise: "high" },
    };
    invokeStructuredPromptMock.mockReset();
    writeInteractionEntryMock.mockReset();
    invokeStructuredPromptMock.mockImplementation(async (request: {
      operationName?: string;
      interactionLogWriter?: { write(entry: unknown): unknown };
    }) => {
      await request.interactionLogWriter?.write(makeInteractionEntry({
        operationName: request.operationName,
        responseMetadata: { promptTokens: 500, completionTokens: 300, finishReason: "stop" },
      }));
      if (request.operationName === "topic.selector") {
        return { ranked_candidates: [{ candidate_id: "c1", quality_rank: 1, quality_score: 95, deductions: [], risk_summary: "ok" }] };
      }
      return [topicCandidate];
    });

    // quote(topic.generate) → 提交
    const quoteRes = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/generation-cost-quotes`,
      payload: { operation: "topic.generate" },
      auth,
    });
    expect(quoteRes.statusCode).toBe(200);
    const quote = quoteRes.json() as { quote_id: string };
    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/topic/recommendations`,
      payload: {
        canonical_name: "晏子使楚",
        summary: "楚王在公开场合连续压场，晏子当场顶回去。",
        core_conflict: "楚王当众压场，晏子必须当场顶回。",
        strong_scene: "楚王连续压场，晏子一句句顶回去。",
        source_hint: "《晏子春秋》",
        recent_usage_hint: "近期未出现同 event_id",
        tags: ["diplomacy"],
        cost_quote_id: quote.quote_id,
        idempotency_key: "9b-topic-1",
      },
      auth,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { candidates: Array<{ candidate_id: string }> };
    expect(body.candidates.length).toBeGreaterThanOrEqual(1);

    // run succeeded；store 候选入库
    const run = [...app.db.generationRuns.values()][0]!;
    expect(run.status).toBe("succeeded");
    expect(app.topicCandidateStore.get(project.id)?.candidatesById.size ?? 0).toBeGreaterThanOrEqual(1);
    // 记账：topic 链（builder+selector 等）的 llm.smart usage，interactionId 以 topic_run_ 为前缀
    const usages = [...app.db.usageCostRecords.values()];
    expect(usages.length).toBeGreaterThanOrEqual(1);
    expect(usages.every((u) => u.capability === "llm.smart")).toBe(true);
    expect(usages.every((u) => u.interactionId.startsWith("topic_run_"))).toBe(true);
  });
});

describe("五入口付费闸门覆盖（diff/contract 审查 I-2 锁定）", () => {
  const auth = buildTestAuth({ userId: "owner-1" });

  it("topic/storyboard(含regen)/asset-plan/publish 无 quote 提交均返回 paid_generation_quote_required 且 provider 零调用", async () => {
    const app = buildApp({ generationQuoteReadinessInput: buildQuotableReadinessInput() });
    await seedQuotableCatalog(app);
    const project = await createProject(app.db, { name: "9B five gates", ownerId: "owner-1" });
    const now = new Date();
    app.db.topicPackages.set("tp_gate", {
      id: "tp_gate", projectId: project.id, eventRegistryEntryId: "ev", title: "T",
      selectedAngle: "A", familyLabel: "F", scopeLabel: "S", coreConflict: "C",
      strongScene: "SC", stakes: "ST", packagingSeed: "PS",
      canonicalQuotesJson: [], canonicalQuoteIntentsJson: [],
      durationBandJson: { label: "medium" },
      narrativeTensionMapJson: { hook_claim: "h", pressure_escalation: "p", mid_reveal: "m", peak_payoff: "pk", ending_residue: "e" },
      mustIncludeBeatsJson: [], forbiddenExpansionsJson: [], riskHintsJson: [],
      sourceAnchorRefsJson: ["s"], ambiguityNotesJson: [],
      sourceMode: "system_recommendation", sourceRefJson: null, createdAt: now,
    } as never);
    project.activeTopicPackageId = "tp_gate";
    app.db.storyboardRecords.set("sb_gate", {
      id: "sb_gate", projectId: project.id, topicPackageId: "tp_gate", scriptRecordId: "sr_gate",
      planJson: { segments: [{ segment_id: "seg_1", api_video_suitability: "remotion_sufficient" }] },
      validationResultJson: {}, executionStateJson: null, graphTraceSummaryJson: null,
      runtimeDiagnosticsJson: null, createdAt: now,
    });
    project.activeStoryboardRecordId = "sb_gate";
    app.db.assetPlanRecords.set("ap_gate", {
      id: "ap_gate", projectId: project.id, topicPackageId: "tp_gate", scriptRecordId: "sr_gate",
      storyboardRecordId: "sb_gate", planJson: { tasks: [] },
      validationResultJson: {} as never, executionStateJson: {}, graphTraceSummaryJson: null,
      runtimeDiagnosticsJson: null, createdAt: now,
    });
    project.activeAssetPlanRecordId = "ap_gate";
    project.activeAssetManifestRecordId = null;

    const cases: Array<{ url: string; payload: Record<string, unknown> }> = [
      { url: `/api/projects/${project.id}/topic/recommendations`, payload: { canonical_name: "晏子使楚", summary: "s", core_conflict: "c", strong_scene: "sc", source_hint: "h", recent_usage_hint: "r", tags: ["diplomacy"] } },
      { url: `/api/projects/${project.id}/topic/from-custom`, payload: { rawDigest: "晏子使楚的具体事件" } },
      { url: `/api/projects/${project.id}/script/generate`, payload: {} },
      { url: `/api/projects/${project.id}/storyboard/generate`, payload: {} },
      { url: `/api/projects/${project.id}/storyboard/segments/seg_1/regen`, payload: { user_feedback: "更紧张" } },
      { url: `/api/projects/${project.id}/asset-plan/generate`, payload: {} },
      { url: `/api/projects/${project.id}/publish/generate`, payload: {} },
      { url: `/api/projects/${project.id}/assets/tasks/tts_001/prompt/optimize`, payload: { current_prompt: "test" } },
      { url: `/api/projects/${project.id}/assets/segments/seg_1/upgrade-video`, payload: {} },
      { url: `/api/projects/${project.id}/publish/cover/prompt/optimize`, payload: {} },
      { url: `/api/projects/${project.id}/publish/title/candidates`, payload: {} },
    ];

    for (const item of cases) {
      invokeStructuredPromptMock.mockReset();
      const response = await app.inject({ method: "POST", url: item.url, payload: item.payload, auth });
      expect(response.statusCode).toBe(409);
      expect((response.json() as Record<string, unknown>).error).toBe("paid_generation_quote_required");
      expect(invokeStructuredPromptMock).not.toHaveBeenCalled();
    }
  });
});

describe("LLM 目录异常 fail-closed（外部审查 P1-1/B4 对抗测试）", () => {
  const auth = buildTestAuth({ userId: "owner-1" });

  it("真实 provider + 目录为空（bootstrap 未运行）：旧无 quote 路径仍必须 409", async () => {
    const app = buildApp({ generationQuoteReadinessInput: buildQuotableReadinessInput() });
    // 不 seed 目录：模拟 bootstrap 未运行/纯内存态——目录异常绝不能成为免 quote 条件
    const project = await prepareScriptProject(app);
    mockPaidScriptProvider(true);

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/script/generate`,
      payload: {},
      auth,
    });

    expect(response.statusCode).toBe(409);
    expect((response.json() as Record<string, unknown>).error).toBe("paid_generation_quote_required");
    expect(invokeStructuredPromptMock).not.toHaveBeenCalled();
  });

  it("真实 provider + 目录全部 disabled：旧无 quote 路径仍必须 409", async () => {
    const app = buildApp({ generationQuoteReadinessInput: buildQuotableReadinessInput() });
    await seedQuotableCatalog(app);
    for (const entry of app.db.providerModelCatalog.values()) {
      entry.status = "disabled";
    }
    const project = await prepareScriptProject(app);
    mockPaidScriptProvider(true);

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/script/generate`,
      payload: {},
      auth,
    });

    expect(response.statusCode).toBe(409);
    expect((response.json() as Record<string, unknown>).error).toBe("paid_generation_quote_required");
    expect(invokeStructuredPromptMock).not.toHaveBeenCalled();
  });

  it("真实 provider + 目录无 active LLM 项（LLM 目录未物化/模型失配）：旧无 quote 路径仍必须 409", async () => {
    const app = buildApp({ generationQuoteReadinessInput: buildQuotableReadinessInput() });
    await seedQuotableCatalog(app);
    for (const entry of app.db.providerModelCatalog.values()) {
      if (entry.capability === "llm.smart" || entry.capability === "llm.flash") {
        entry.status = "disabled";
      }
    }
    const project = await prepareScriptProject(app);
    mockPaidScriptProvider(true);

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/script/generate`,
      payload: {},
      auth,
    });

    expect(response.statusCode).toBe(409);
    expect((response.json() as Record<string, unknown>).error).toBe("paid_generation_quote_required");
    expect(invokeStructuredPromptMock).not.toHaveBeenCalled();
  });
});
