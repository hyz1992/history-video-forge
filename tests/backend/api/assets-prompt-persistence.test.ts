import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildApp } from "../../../backend/src/app.js";
import { createPrismaClient } from "../../../backend/src/db/prisma-client.js";
import { hydrateFirstAggregates } from "../../../backend/src/db/repositories/prisma-first-aggregate-hydrator.js";
import { hydrateSecondAggregates } from "../../../backend/src/db/repositories/prisma-second-aggregate-hydrator.js";
import { PrismaSecondAggregateWriter } from "../../../backend/src/db/repositories/prisma-second-aggregate-writer.js";
import { executeAssetManifest } from "../../../backend/src/modules/assets/assets-execution-engine.js";
import { buildInitialAssetManifest } from "../../../backend/src/modules/assets/assets-manifest-builder.js";
import { createAssetProviderRegistry } from "../../../backend/src/modules/assets/assets-provider-registry.js";
import type { AssetProviderAdapter } from "../../../backend/src/modules/assets/assets-provider-adapter.js";
import { AssetPlanV1 } from "../../../shared/src/asset-planning/asset-plan-v1.schema.js";
import { buildTestAuth } from "../auth/test-utils.js";
import { applyAllDatabaseMigrations } from "../db/migration-test-utils.js";

function makePlan() {
  return AssetPlanV1.parse({
    plan_version: "asset_plan_v1",
    source_storyboard_record_id: "storyboard",
    source_script_record_id: "script",
    source_topic_package_id: "topic",
    art_bible: {
      era_style: "汉代", visual_tone: "电影质感", characters: [], locations: [], props: [],
      global_prompt_prefix: "汉代历史场景", global_negative_prompts: ["现代物品"], consistency_notes: [],
    },
    visual_budget: { image_limit: 2 }, downgrade_policy: {}, global_audio_strategy: {},
    tts_plan: { voice_profile_id: "voice", estimated_total_duration_sec: 5, chunking_strategy: "segment_boundary", chunks: [] },
    tasks: ["image_still", "video_clip"].map((taskType, order) => ({
      task_id: taskType, task_type: taskType, order, source_segment_id: "segment",
      source_excerpt: "最后一席酒", production_intent: "保持人物服装一致", recommended_mode: "auto",
      provider_hint: "offline_visual", prompt_draft: `${taskType}原提示词`, parameters: { aspect_ratio: "9:16" },
      manual_upload_policy: { allowed: true, required: false, accepted_file_types: [], acceptance_notes: [] },
      risk_notes: ["服装连续性"], cost_tier: "low", initial_status: "planned",
    })),
    dependencies: [],
    cost_summary: { total_tasks: 2, by_type: { image_still: 1, video_clip: 1 }, by_cost_tier: { low: 2 }, estimated_provider_calls: 2, notes: [] },
    global_production_notes: ["仅离线回归测试"],
  });
}

describe("asset prompt persistence", () => {
  let root: string;
  let client: Awaited<ReturnType<typeof createPrismaClient>>;
  let app: ReturnType<typeof buildApp>;
  let writer: PrismaSecondAggregateWriter;
  const auth = buildTestAuth({ userId: "owner" });

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "svf2-asset-prompt-"));
    const databasePath = join(root, "test.db");
    const sqlite = new Database(databasePath);
    applyAllDatabaseMigrations(sqlite);
    sqlite.close();
    client = await createPrismaClient(databasePath);
    await client.user.create({ data: { id: "owner", username: "owner", displayName: "Owner", passwordHash: "x", role: "USER" } });
    await client.project.create({ data: { id: "project", ownerId: "owner", createdById: "owner", name: "Prompt", storageKey: "project", storageDisplayName: "Prompt" } });
    await client.topicPackage.create({ data: {
      id: "topic", projectId: "project", title: "送别", selectedAngle: "归路", familyLabel: "故交", scopeLabel: "一席酒",
      coreConflict: "留与归", strongScene: "送别", packagingSeed: "旧汉节", canonicalQuotesJson: [], canonicalQuoteIntentsJson: [],
      durationBandJson: {}, narrativeTensionMapJson: {}, mustIncludeBeatsJson: [], forbiddenExpansionsJson: [], riskHintsJson: [], sourceAnchorRefsJson: [], ambiguityNotesJson: [],
    } });
    await client.scriptRecord.create({ data: {
      id: "script", projectId: "project", topicPackageId: "topic", scriptText: "最后一席酒", openingSpan: "一席酒", endingSpan: "归路",
      estimatedDurationSec: 5, beatTraceJson: [], quoteTraceJson: [], reviewStatus: "pass",
    } });
    await client.storyboardRecord.create({ data: {
      id: "storyboard", projectId: "project", topicPackageId: "topic", scriptRecordId: "script", planJson: { segments: [] }, validationResultJson: {},
    } });
    await client.assetPlanRecord.create({ data: {
      id: "plan", projectId: "project", topicPackageId: "topic", scriptRecordId: "script", storyboardRecordId: "storyboard",
      planJson: makePlan(), validationResultJson: { stage: "asset_planning_local_validation", decision: "ready", errors: [], warnings: [], metrics: { task_count: 2 } },
      executionStateJson: { plan_revision: 3 }, graphTraceSummaryJson: { run_id: "existing-run" }, runtimeDiagnosticsJson: { warnings: ["existing-note"] },
      createdAt: new Date("2026-10-03T10:00:00.000Z"),
    } });
    await client.project.update({ where: { id: "project" }, data: { activeTopicPackageId: "topic", activeScriptRecordId: "script", activeStoryboardRecordId: "storyboard", activeAssetPlanRecordId: "plan", status: "asset_plan_ready" } });
    writer = new PrismaSecondAggregateWriter(client, "owner");
    app = buildApp({ skipSnapshotLoad: true, secondAggregateWriter: writer });
    await hydrateFirstAggregates(app.db, app.topicCandidateStore, client, { storageRoot: root });
    await hydrateSecondAggregates(app.db, client);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await client?.$disconnect();
    if (!root.startsWith(join(tmpdir(), "svf2-asset-prompt-"))) throw new Error("unexpected_test_cleanup_path");
    rmSync(root, { recursive: true, force: true });
  });

  it.each(["image_still", "video_clip"] as const)("persists %s prompt through hydration and subsequent provider preparation", async (taskId) => {
    const original = structuredClone(app.db.assetPlanRecords.get("plan")!);
    const prompt = "只穿参考图中的深灰褐色汉代长袍，保持同一角色身份。";
    const response = await app.inject({ method: "PATCH", url: `/api/projects/project/assets/tasks/${taskId}/prompt`, payload: { prompt_draft: prompt }, auth });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ task_id: taskId, prompt_draft: prompt });

    const expected = structuredClone(original);
    expected.planJson.tasks.find((task) => task.task_id === taskId)!.prompt_draft = prompt;
    // 删除进程内镜像，重新从真实 SQLite 装载，覆盖页面刷新/服务恢复时的数据边界。
    app.db.assetPlanRecords.clear();
    await hydrateSecondAggregates(app.db, client);
    const reloaded = app.db.assetPlanRecords.get("plan")!;
    expect(reloaded).toEqual(expected);
    const snapshot = await app.inject({ method: "GET", url: "/api/projects/project", auth });
    expect(snapshot.statusCode).toBe(200);
    expect(snapshot.json()).toMatchObject({ active_asset_plan: { asset_plan_record_id: "plan", plan: expected.planJson } });

    const preparedPrompts: string[] = [];
    const adapter: AssetProviderAdapter = {
      providerName: "offline_visual", providerType: taskId === "image_still" ? "image" : "video",
      canHandle: ({ taskType }) => taskType === taskId,
      prepare: async ({ planTask }) => { preparedPrompts.push(planTask.prompt_draft!); return { providerJobId: null, rawRequestJson: { prompt: planTask.prompt_draft } }; },
      submit: async () => ({ providerJobId: "offline-job", rawResponseJson: {} }),
      poll: async () => ({ status: "completed", rawResponseJson: {} }), download: async () => [],
      normalizeResult: async () => ({ artifacts: [], notes: [] }), cancel: async () => undefined,
    };
    const manifest = buildInitialAssetManifest({ assetPlanRecordId: "plan", assetPlan: reloaded.planJson, segmentIds: ["segment"] });
    manifest.executions = manifest.executions.filter((execution) => execution.task_id === taskId);
    // 图生视频须先有分镜主图；离线适配器不读取该文件、不发网络请求。
    if (taskId === "video_clip") manifest.artifacts.push({
      artifact_id: "offline-image", artifact_type: "image", origin: "manual_upload",
      file_uri: "inline://offline-image", created_at: new Date().toISOString(),
      metadata: { segment_id: "segment", width: 1080, height: 1920 },
    });
    await executeAssetManifest({
      db: app.db, assetManifestRecordId: "offline-manifest", assetRunId: "offline-run", manifest,
      registry: createAssetProviderRegistry([adapter]), assetPlan: reloaded.planJson, projectStorageRootDir: root,
    });
    expect(preparedPrompts).toEqual([prompt]);
  });

  it("does not report success or change the in-memory plan when persistence fails", async () => {
    const original = structuredClone(app.db.assetPlanRecords.get("plan")!);
    vi.spyOn(writer, "saveAssetPlan").mockRejectedValueOnce(new Error("database_unavailable"));
    await expect(app.inject({ method: "PATCH", url: "/api/projects/project/assets/tasks/image_still/prompt", payload: { prompt_draft: "未保存提示词" }, auth })).rejects.toThrow("database_unavailable");
    expect(app.db.assetPlanRecords.get("plan")).toEqual(original);
    await hydrateSecondAggregates(app.db, client);
    expect(app.db.assetPlanRecords.get("plan")).toEqual(original);
  });

  it.each([
    ["image_still", {}, 400, "missing_prompt_draft"],
    ["image_still", { prompt_draft: 42 }, 400, "missing_prompt_draft"],
    ["unknown-task", { prompt_draft: "新提示词" }, 404, "task_not_found"],
  ])("preserves the stored plan for invalid request %s/%j", async (taskId, payload, statusCode, error) => {
    const original = structuredClone(app.db.assetPlanRecords.get("plan")!);
    const save = vi.spyOn(writer, "saveAssetPlan");
    const response = await app.inject({ method: "PATCH", url: `/api/projects/project/assets/tasks/${taskId}/prompt`, payload, auth });
    expect(response.statusCode).toBe(statusCode);
    expect(response.json()).toEqual({ error });
    expect(save).not.toHaveBeenCalled();
    await hydrateSecondAggregates(app.db, client);
    expect(app.db.assetPlanRecords.get("plan")).toEqual(original);
  });
});
