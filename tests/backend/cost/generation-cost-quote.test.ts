import { describe, expect, it } from "vitest";

import { buildApp } from "../../../backend/src/app.js";
import type { DbClient } from "../../../backend/src/db/client.js";
import { saveScriptRecord } from "../../../backend/src/modules/script/script-record.repository.js";
import { saveStoryboardRecord } from "../../../backend/src/modules/storyboard/storyboard-record.repository.js";
import { saveAssetPlanRecord } from "../../../backend/src/modules/asset-planning/asset-plan-record.repository.js";
import { saveTopicPackage } from "../../../backend/src/modules/topic/topic-package.repository.js";
import { upsertProjectGenerationConfiguration } from "../../../backend/src/modules/generation-config/generation-config.repository.js";
import {
  createGenerationCostQuote,
  computeQuoteFingerprint,
  revalidateQuoteForCommit,
  type RevalidateQuoteResult,
} from "../../../backend/src/modules/generation-cost/generation-cost.service.js";
import { findQuoteById } from "../../../backend/src/modules/generation-cost/generation-cost.repository.js";
import { buildQuotableReadinessInput, REAL_TIER_INPUT, makeQuoteStoryboardPlan, makeQuoteAssetPlan, prepareQuoteProject, seedQuotableCatalog } from "./quote-test-context.js";
import type { GenerationCostQuoteRecord, ProjectRecord } from "../../../backend/src/db/client.js";
import type { GenerationQuoteRequest } from "../../../../shared/src/index.js";

/**
 * S2-2A 任务 8：quote 创建与提交重校验合同（详细设计 4.5 / 8.1 / 8.2）。
 * 覆盖：有效期、一次性消费、configuration/pricing hash、逐项明细、quoteFingerprint、
 * 预算比较用 authorizationCostMicros、unbounded 显式授权、配置/价格/asset plan
 * 漂移拒绝、全 operation 可报价、金额十进制字符串。
 */

function makeTopicQuoteRequest(overrides: Partial<GenerationQuoteRequest> = {}): GenerationQuoteRequest {
  return { operation: "topic.generate", ...overrides };
}

async function prepareTopicQuote(db: DbClient): Promise<GenerationCostQuoteRecord> {
  const project = await prepareQuoteProject(db);
  const result = await createGenerationCostQuote(
    db, project, project.ownerId, makeTopicQuoteRequest(),
    { readinessInput: buildQuotableReadinessInput() },
  );
  if (!result.ok) throw new Error(`quote creation failed: ${JSON.stringify(result.error)}`);
  return result.value.quote;
}

describe("generation cost quote creation", () => {
  it("creates a quote with 10-minute expiry, hashes and itemized items", async () => {
    const app = buildApp();
    await seedQuotableCatalog(app);
    const quote = await prepareTopicQuote(app.db);

    expect(quote.id).toBeTruthy();
    expect(quote.operation).toBe("topic.generate");
    // 默认有效期 10 分钟
    const now = Date.now();
    const expiresAt = quote.expiresAt.getTime();
    expect(expiresAt - now).toBeGreaterThan(9 * 60 * 1000);
    expect(expiresAt - now).toBeLessThanOrEqual(10 * 60 * 1000 + 1000);
    expect(quote.consumedAt).toBeNull();
    expect(quote.configurationHash).toMatch(/^fnv1a64:[0-9a-f]{16}$/);
    expect(quote.pricingHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(quote.quoteFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
    // stub LLM 零价：逐项明细仍存在
    expect(quote.itemsJson.length).toBe(1);
    expect(quote.itemsJson[0]).toMatchObject({
      capability: "llm.smart",
      unit_type: "token",
      estimated_cost_micros: "0",
      authorization_cost_micros: "0",
      unbounded: false,
    });
    expect(quote.estimatedCostMicros).toBe("0");
    expect(quote.authorizationCostMicros).toBe("0");
    expect(quote.containsUnboundedItem).toBe(false);
  });

  it("quoteFingerprint is a deterministic SHA-256 of the canonical payload", () => {
    const payload = {
      payload_version: "quote_fingerprint_v1",
      project_id: "p1",
      operation: "topic.generate",
      configuration_hash: "fnv1a64:0011223344556677",
      catalog_hash: "fnv1a64:8877665544332211",
      pricing_hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      pricing_version_set: ["v2", "v1"],
      items: [
        { capability: "llm.smart", provider_model_id: "llm.smart.stub.stub-model", unit_type: "token", units: { estimated_input_tokens: 40000, estimated_output_tokens: 20000 }, estimated_cost_micros: "0" },
      ],
      estimated_cost_micros: "0",
      authorization_cost_micros: "0",
      contains_unbounded_item: false,
      budget_limit_micros: null,
      expires_at: "2026-08-19T10:00:00.000Z",
    } as const;
    const first = computeQuoteFingerprint(payload);
    const second = computeQuoteFingerprint(payload);
    expect(first).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(second).toBe(first);
    // 键序变化不得改变指纹（canonical JSON 键排序）
    const reordered = { ...payload, pricing_version_set: ["v1", "v2"] };
    expect(computeQuoteFingerprint(reordered)).toBe(first);
  });

  it("quotes every real LLM operation (topic/script/storyboard/asset-plan/publish) and assets", async () => {
    const app = buildApp();
    await seedQuotableCatalog(app);
    const project = await prepareQuoteProject(app.db);
    for (const operation of ["topic.generate", "script.generate", "storyboard.generate", "asset_plan.generate", "publish.generate"] as const) {
      const result = await createGenerationCostQuote(
        app.db, project, project.ownerId, { operation },
        { readinessInput: buildQuotableReadinessInput() },
      );
      expect(result.ok, `operation ${operation}`).toBe(true);
      if (result.ok) {
        expect(result.value.quote.operation).toBe(operation);
        expect(result.value.quote.itemsJson.length).toBeGreaterThan(0);
      }
    }
    const assetsResult = await createGenerationCostQuote(
      app.db, project, project.ownerId, { operation: "assets.generate" },
      { readinessInput: buildQuotableReadinessInput() },
    );
    expect(assetsResult.ok).toBe(true);
  });

  it("includes media workload items for assets.generate from the asset plan and resolved routes", async () => {
    const app = buildApp();
    await seedQuotableCatalog(app);
    const ctx = await prepareAssetsContext(app.db);

    const result = await createGenerationCostQuote(
      app.db, ctx.project, ctx.project.ownerId, { operation: "assets.generate" },
      { readinessInput: buildQuotableReadinessInput() },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const items = result.value.quote.itemsJson as Array<Record<string, unknown>>;
    const capabilities = items.map((item) => item.capability).sort();
    // llm.flash（prompt 优化）+ image + video（api_video 路线）+ tts
    expect(capabilities).toEqual(["image.generate", "llm.flash", "tts.synthesize", "video.image_to_video"]);
    const imageItem = items.find((item) => item.capability === "image.generate")!;
    expect(imageItem).toMatchObject({ unit_type: "image", estimated_cost_micros: "200000", authorization_cost_micros: "200000", unbounded: false });
    const videoItem = items.find((item) => item.capability === "video.image_to_video")!;
    expect(videoItem).toMatchObject({ unit_type: "video_second", unbounded: false });
    // 估算 = 每任务默认 7 秒 × 0.6 元/秒 = 4.2 元；授权上界 = 任务数 × 上限 15s × 0.6 = 9 元
    expect(videoItem.estimated_cost_micros).toBe("4200000");
    expect(videoItem.authorization_cost_micros).toBe("9000000");
    const ttsItem = items.find((item) => item.capability === "tts.synthesize")!;
    // "Opening pressure." = 17 字符 → ceil(17×800000/10000) = 1360
    expect(ttsItem.estimated_cost_micros).toBe("1360");
  });

  it("quotes no video capability under all_remotion strategy", async () => {
    const app = buildApp();
    await seedQuotableCatalog(app);
    const project = await prepareQuoteProject(app.db);
    await upsertProjectGenerationConfiguration(
      app.db, project.id,
      { expected_revision: 1, configuration: { ...buildDefaultConfig(), video: { strategy: "all_remotion", api_quality: "standard_720p" } } },
      project.ownerId,
    );
    await prepareAssetsContext(app.db, project);

    const result = await createGenerationCostQuote(
      app.db, project, project.ownerId, { operation: "assets.generate" },
      { readinessInput: buildQuotableReadinessInput() },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const capabilities = (result.value.quote.itemsJson as Array<Record<string, unknown>>).map((item) => item.capability);
    expect(capabilities).not.toContain("video.image_to_video");
    expect(capabilities).toContain("image.generate");
  });

  it("marks unbounded items: no trusted bound, must not be treated as zero in the budget gate", async () => {
    const app = buildApp();
    await seedQuotableCatalog(app, REAL_TIER_INPUT);
    const project = await prepareQuoteProject(app.db);
    const result = await createGenerationCostQuote(
      app.db, project, project.ownerId, { operation: "topic.generate" },
      { readinessInput: buildQuotableReadinessInput(REAL_TIER_INPUT) },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const quote = result.value.quote;
    expect(quote.containsUnboundedItem).toBe(true);
    // 金额列 NOT NULL（数据库合同）：unbounded 归一为 "0"，预算门禁以标志为键，
    // 绝不把金额当作可信上界参与比较。
    expect(quote.authorizationCostMicros).toBe("0");
    expect(quote.estimatedCostMicros).toBe("0");
    expect((quote.itemsJson as Array<Record<string, unknown>>)[0]).toMatchObject({ unbounded: true });
  });
});

describe("generation cost quote commit revalidation", () => {
  it("passes when configuration, prices and asset plan are unchanged", async () => {
    const app = buildApp();
    await seedQuotableCatalog(app);
    const ctx = await prepareAssetsContext(app.db);
    const quote = await createAssetsQuote(app, ctx);
    const result = await revalidate(quote, ctx.project, app.db);
    expect(result.ok).toBe(true);
  });

  it("rejects when project configuration changed (configuration hash drift)", async () => {
    const app = buildApp();
    await seedQuotableCatalog(app);
    const ctx = await prepareAssetsContext(app.db);
    const quote = await createAssetsQuote(app, ctx);
    await upsertProjectGenerationConfiguration(
      app.db, ctx.project.id,
      { expected_revision: 1, configuration: { ...buildDefaultConfig(), video: { strategy: "all_api_video", api_quality: "standard_720p" } } },
      ctx.project.ownerId,
    );
    const result = await revalidate(quote, ctx.project, app.db);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("generation_quote_configuration_changed");
  });

  it("rejects when catalog price changed (pricing hash drift)", async () => {
    const app = buildApp();
    await seedQuotableCatalog(app);
    const ctx = await prepareAssetsContext(app.db);
    const quote = await createAssetsQuote(app, ctx);
    const imageEntry = [...app.db.providerModelCatalog.values()].find((e) => e.capability === "image.generate")!;
    const mutated = { ...imageEntry, pricingJson: { ...imageEntry.pricingJson, price_micros_per_image: "300000" } };
    app.db.providerModelCatalog.set(mutated.id, mutated);
    const result = await revalidate(quote, ctx.project, app.db);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("generation_quote_price_changed");
  });

  it("rejects when asset plan changed (quote fingerprint mismatch)", async () => {
    const app = buildApp();
    await seedQuotableCatalog(app);
    const ctx = await prepareAssetsContext(app.db);
    const quote = await createAssetsQuote(app, ctx);
    const plan = app.db.assetPlanRecords.get(ctx.project.activeAssetPlanRecordId!)!;
    const tasks = (plan.planJson as { tasks: Array<Record<string, unknown>> }).tasks;
    tasks.push({ ...tasks[0]!, task_id: "task_img_002" });
    plan.planJson = { ...plan.planJson } as never;
    const result = await revalidate(quote, ctx.project, app.db);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("generation_quote_fingerprint_mismatch");
  });

  it("rejects when selection changed (fingerprint mismatch)", async () => {
    const app = buildApp();
    await seedQuotableCatalog(app);
    const ctx = await prepareAssetsContext(app.db);
    const quote = await createAssetsQuote(app, ctx);
    const result = await revalidate(quote, ctx.project, app.db, { task_ids: ["task_img_001"] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("generation_quote_fingerprint_mismatch");
  });

  it("rejects expired and consumed quotes", async () => {
    const app = buildApp();
    await seedQuotableCatalog(app);
    const ctx = await prepareAssetsContext(app.db);
    const quote = await createAssetsQuote(app, ctx);

    const expired = { ...quote, expiresAt: new Date(Date.now() - 1000) };
    const expiredResult = await revalidate(expired, ctx.project, app.db);
    expect(expiredResult.ok).toBe(false);
    if (!expiredResult.ok) expect(expiredResult.error.code).toBe("generation_quote_expired");

    const consumed = { ...quote, consumedAt: new Date() };
    const consumedResult = await revalidate(consumed, ctx.project, app.db);
    expect(consumedResult.ok).toBe(false);
    if (!consumedResult.ok) expect(consumedResult.error.code).toBe("generation_quote_consumed");
  });

  it("rejects quotes from another project or another operation", async () => {
    const app = buildApp();
    await seedQuotableCatalog(app);
    const ctx = await prepareAssetsContext(app.db);
    const quote = await createAssetsQuote(app, ctx);

    const otherProject = await prepareQuoteProject(app.db, "user-b");
    const projectResult = await revalidate(quote, otherProject, app.db);
    expect(projectResult.ok).toBe(false);
    if (!projectResult.ok) expect(projectResult.error.code).toBe("generation_quote_not_owner");

    const opResult = await revalidate({ ...quote, operation: "publish.generate" }, ctx.project, app.db);
    expect(opResult.ok).toBe(false);
    if (!opResult.ok) expect(opResult.error.code).toBe("generation_quote_operation_mismatch");
  });

  it("budget gate compares authorizationCostMicros (not estimate): over budget when estimate < budget < authorization", async () => {
    const app = buildApp();
    await seedQuotableCatalog(app);
    const ctx = await prepareAssetsContext(app.db);
    // 预算 5 元：估算 4.4 元（视频 4.2 + 图片 0.2 + tts 0.00136）低于预算，
    // 但授权上界 9.2 元（视频 9 + 图片 0.2 + tts 0.00136）高于预算 → over_budget。
    await upsertProjectGenerationConfiguration(
      app.db, ctx.project.id,
      { expected_revision: 1, configuration: { ...buildDefaultConfig(), budget: { currency: "CNY", max_paid_cost_micros_per_run: "5000000" } } },
      ctx.project.ownerId,
    );
    const result = await createGenerationCostQuote(
      app.db, ctx.project, ctx.project.ownerId, { operation: "assets.generate" },
      { readinessInput: buildQuotableReadinessInput() },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const quote = result.value.quote;
    expect(quote.overBudget).toBe(true);
    expect(quote.budgetLimitMicros).toBe("5000000");
    expect(BigInt(quote.estimatedCostMicros)).toBeLessThan(5_000_000n);
    expect(BigInt(quote.authorizationCostMicros)).toBeGreaterThan(5_000_000n);

    // 预算 10 元 > 授权上界 → 不超额
    await upsertProjectGenerationConfiguration(
      app.db, ctx.project.id,
      { expected_revision: 2, configuration: { ...buildDefaultConfig(), budget: { currency: "CNY", max_paid_cost_micros_per_run: "10000000" } } },
      ctx.project.ownerId,
    );
    const result2 = await createGenerationCostQuote(
      app.db, ctx.project, ctx.project.ownerId, { operation: "assets.generate" },
      { readinessInput: buildQuotableReadinessInput() },
    );
    expect(result2.ok).toBe(true);
    if (result2.ok) expect(result2.value.quote.overBudget).toBe(false);
  });
});

describe("quote record lookups are project-scoped", () => {
  it("findQuoteById returns null for a quote of another project", async () => {
    const app = buildApp();
    await seedQuotableCatalog(app);
    const quote = await prepareTopicQuote(app.db);
    const otherProject = await prepareQuoteProject(app.db, "user-b");
    expect(await findQuoteById(app.db, otherProject.id, quote.id)).toBeNull();
    expect(await findQuoteById(app.db, quote.projectId, quote.id)).not.toBeNull();
  });
});

// --- 上下文辅助 -------------------------------------------------------------

async function prepareAssetsContext(db: DbClient, projectOverride?: ProjectRecord) {
  const project = projectOverride ?? (await prepareQuoteProject(db));
  const topicPackage = await saveTopicPackage(db, { projectId: project.id, title: "T" } as never);
  const script = await saveScriptRecord(db, { projectId: project.id, topicPackageId: topicPackage.id, scriptText: "Opening pressure.", estimatedDurationSec: 82 } as never);
  const storyboard = await saveStoryboardRecord(db, { projectId: project.id, topicPackageId: topicPackage.id, scriptRecordId: script.id, planJson: makeQuoteStoryboardPlan({ scriptRecordId: script.id, topicPackageId: topicPackage.id }) } as never);
  const plan = await saveAssetPlanRecord(db, { projectId: project.id, topicPackageId: topicPackage.id, scriptRecordId: script.id, storyboardRecordId: storyboard.id, planJson: makeQuoteAssetPlan({ storyboardRecordId: storyboard.id, scriptRecordId: script.id, topicPackageId: topicPackage.id }) } as never);
  project.activeStoryboardRecordId = storyboard.id;
  project.activeScriptRecordId = script.id;
  project.activeAssetPlanRecordId = plan.id;
  return { project, storyboard, plan };
}

async function createAssetsQuote(app: ReturnType<typeof buildApp>, ctx: Awaited<ReturnType<typeof prepareAssetsContext>>) {
  const result = await createGenerationCostQuote(
    app.db, ctx.project, ctx.project.ownerId, { operation: "assets.generate" },
    { readinessInput: buildQuotableReadinessInput() },
  );
  if (!result.ok) throw new Error(`quote creation failed: ${JSON.stringify(result.error)}`);
  return result.value.quote;
}

function revalidate(quote: GenerationCostQuoteRecord, project: ProjectRecord, db: DbClient, selection?: { task_ids: string[]; mode?: "missing_only" }): Promise<RevalidateQuoteResult> {
  return revalidateQuoteForCommit(
    db, project, quote,
    { operation: "assets.generate", selection, runOverrides: undefined },
    { readinessInput: buildQuotableReadinessInput() },
  );
}

function buildDefaultConfig() {
  return {
    schema_version: "generation_configuration_v1",
    video: { strategy: "prefer_remotion", api_quality: "standard_720p" },
    budget: { currency: "CNY", max_paid_cost_micros_per_run: null },
    creative: { voice_profile_id: null, art_style_preset_id: null, subtitle_style_preset_id: null },
    capabilities: {
      "llm.smart": { mode: "auto" },
      "llm.flash": { mode: "auto" },
      "image.generate": { mode: "auto" },
      "video.image_to_video": { mode: "auto" },
      "tts.synthesize": { mode: "auto" },
    },
  } as const;
}
