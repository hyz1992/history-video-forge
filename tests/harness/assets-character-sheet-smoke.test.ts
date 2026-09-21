/**
 * 角色 sheet 假运行时冒烟（实施计划 §1 T5，假绿防线）。
 *
 * 链路闭合：intent compiler（T1 阈值/注入关系）→ buildInitialAssetManifest（§3.7 第 1 项
 * 平行枚举）→ 执行引擎（T3 排序/路由豁免/记账/跳过规则）→ fake image provider。
 *
 * 强断言（缺任一条即为假绿）：
 * ① character_sheet execution 状态 completed 且产出 image artifact（不只断言 run 走完）；
 * ② 被注入的分镜图任务 prepare 回显收到参考图（reference_image_count = 1）；
 * ③ 降级路径：sheet 未产出时分镜图仍 completed（纯文本锚点），run 不阻塞；
 * ④ 开关关闭：与现状逐字一致（零 sheet 任务、零注入、零降级 note）；
 * ⑤ 局部重跑（P3 防线）：工作 manifest"有 sheet artifact、无 sheet execution"时仍注入
 *    ——execution 级查找会在此静默失效；
 * ⑥ 确知模型不支持参考图：sheet 为 skipped_with_fallback 且零派发零计费。
 */

import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

import type { AssetManifest, AssetPlan, ScriptDraftPackage, StoryboardPlan } from "../../shared/src/index.js";
import {
  compileAssetPlanFromIntents,
  type AssetPlanCompilerInput,
} from "../../backend/src/modules/asset-planning/asset-plan-intent-compiler.js";
import { buildInitialAssetManifest } from "../../backend/src/modules/assets/assets-manifest-builder.js";
import { executeAssetManifest } from "../../backend/src/modules/assets/assets-execution-engine.js";
import { createAssetProviderRegistry } from "../../backend/src/modules/assets/assets-provider-registry.js";
import { createFakeImageProvider } from "../../backend/src/modules/assets/providers/fake-image-provider.js";
import { createDbClient, type DbClient } from "../../backend/src/db/client.js";
import type { SegmentAssetIntentBatchDraft } from "../../backend/src/modules/asset-planning/segment-asset-intent.js";

const SHEET_ENABLED = { enabled: true, minSegmentHits: 3 } as const;
const SEGMENT_COUNT = 3;
const SEGMENT_IDS = Array.from({ length: SEGMENT_COUNT }, (_, index) => `seg_${String(index + 1).padStart(3, "0")}`);

function makeStoryboard(): StoryboardPlan {
  return {
    plan_version: "storyboard_v1",
    source_script_record_id: "script_001",
    source_topic_package_id: "topic_001",
    estimated_total_duration_sec: SEGMENT_COUNT * 5,
    segments: SEGMENT_IDS.map((segmentId, index) => ({
      segment_id: segmentId,
      order: index,
      script_excerpt: `第${index + 1}段口播。`,
      start_hint_sec: index * 5,
      end_hint_sec: (index + 1) * 5,
      narrative_role: index === 0 ? "opening" : index === SEGMENT_COUNT - 1 ? "ending" : "setup",
      visual_intent: `第${index + 1}段视觉意图`,
      scene_description: `第${index + 1}段场景：人物甲在庭院。`,
      visual_elements: [],
      framing_hint: "medium",
      content_type: "live_action",
      motion_hint: "static",
      editing_hint: "single",
      on_screen_text: [],
      linked_beats: [],
      linked_quotes: [],
      risk_notes: [],
      api_video_suitability: "remotion_sufficient",
    })),
    global_visual_notes: [],
  };
}

function makeCompilerInput(characterSheet?: { enabled: boolean; minSegmentHits: number }): AssetPlanCompilerInput {
  const storyboard = makeStoryboard();
  const scriptText = storyboard.segments.map((segment) => segment.script_excerpt).join("");
  const draft: ScriptDraftPackage = {
    script_text: scriptText,
    estimated_duration_sec: storyboard.estimated_total_duration_sec,
    beat_trace: [],
    quote_trace: [],
    opening_span: storyboard.segments[0]!.script_excerpt,
    ending_span: storyboard.segments.at(-1)!.script_excerpt,
  };
  const segments: SegmentAssetIntentBatchDraft["segments"] = storyboard.segments.map((segment, index) => ({
    source_segment_id: segment.segment_id,
    intents: [
      {
        asset_kind: "image_still",
        production_intent: `第${index + 1}段分镜图`,
        image_prompt: `第${index + 1}段画面提示`,
        video_prompt_reserve: "",
        image_role: "anchor",
        support_reason: null,
        risk_notes: ["画面风险"],
      },
      {
        asset_kind: "render_motion_cue",
        production_intent: `第${index + 1}段运镜`,
        risk_notes: ["运镜风险"],
      },
      ...(index === 0
        ? [
            {
              asset_kind: "bgm_cue" as const,
              production_intent: "全片配乐",
              required_tags: ["弦乐"],
              mood_tags: ["悬疑"],
              selection_label: "配乐选择",
              timing_basis: "tts" as const,
              scope: "global" as const,
              segment_ids: [],
              volume: 0.35,
              fade_in_sec: 0.5,
              fade_out_sec: 1.5,
              risk_notes: ["配乐风险"],
            },
          ]
        : []),
    ],
  }));
  return {
    sourceIds: { storyboardRecordId: "storyboard_001", scriptRecordId: "script_001", topicPackageId: "topic_001" },
    storyboard,
    draft,
    globalDraft: {
      art_bible: {
        era_style: "战国",
        visual_tone: "克制写实",
        characters: [
          {
            character_id: "char_1",
            label: "人物甲",
            role: "主角",
            visual_description: "束发深衣",
            consistency_notes: ["服饰统一"],
          },
        ],
        locations: [],
        props: [],
        global_prompt_prefix: "历史写实",
        global_negative_prompts: ["现代物品"],
        consistency_notes: [],
      },
      visual_budget: { mode: "balanced" },
      downgrade_policy: { video_to_image: true },
      global_audio_strategy: {},
      manual_review_notes: [],
    },
    audioSkeleton: {
      tts_plan: {
        voice_profile_id: "voice_default_male_storyteller",
        estimated_total_duration_sec: storyboard.estimated_total_duration_sec,
        chunking_strategy: "segment_boundary",
        chunks: storyboard.segments.map((segment, index) => ({
          chunk_id: `tts_${String(index + 1).padStart(3, "0")}`,
          order: index,
          script_excerpt: segment.script_excerpt,
          estimated_duration_sec: 5,
        })),
      },
      tasks: [
        {
          task_id: "tts_001",
          order: 0,
          task_type: "tts_audio",
          source_segment_id: null,
          source_excerpt: scriptText,
          production_intent: "生成全片口播音频",
          recommended_mode: "auto",
          provider_hint: "default_tts",
          prompt_draft: null,
          parameters: {
            voice_profile_id: "voice_default_male_storyteller",
            chunk_ids: storyboard.segments.map((_, index) => `tts_${String(index + 1).padStart(3, "0")}`),
          },
          manual_upload_policy: { allowed: false, required: false, accepted_file_types: [], acceptance_notes: [] },
          risk_notes: [],
          cost_tier: "low",
          initial_status: "planned",
        },
        {
          task_id: "subtitle_001",
          order: 1,
          task_type: "subtitle_track",
          source_segment_id: null,
          source_excerpt: scriptText,
          production_intent: "根据 TTS 时间戳生成字幕轨",
          recommended_mode: "auto",
          provider_hint: null,
          prompt_draft: null,
          parameters: { format: "srt", source_tts_task_id: "tts_001" },
          manual_upload_policy: { allowed: false, required: false, accepted_file_types: [], acceptance_notes: [] },
          risk_notes: [],
          cost_tier: "free",
          initial_status: "planned",
        },
      ],
      dependencies: [
        {
          dependency_id: "dep_subtitle_001_after_tts_001",
          task_id: "subtitle_001",
          depends_on_task_id: "tts_001",
          dependency_type: "requires_timing",
        },
      ],
    },
    chunks: [
      {
        chunkIndex: 0,
        inputSegmentIds: SEGMENT_IDS,
        draft: { planning_mode: "segment_intent_batch", segments, budget_notes: [] },
      },
    ],
    segmentVisualRoutes: new Map(
      storyboard.segments.map((segment) => [
        segment.segment_id,
        {
          segment_id: segment.segment_id,
          segment_override: null,
          api_video_suitability: segment.api_video_suitability,
          resolved_route: "remotion" as const,
          reason_code: "smoke_route",
        },
      ]),
    ),
    ...(characterSheet ? { characterSheet } : {}),
  };
}

/** 付费闸门上下文（run + 快照）：断言 ⑥ 需要它提供"确知冻结模型"。 */
function createSmokeDb(resolvedImageModel?: string): DbClient {
  const db = createDbClient();
  const now = new Date();
  const snapshot = {
    id: "snap_smoke",
    projectId: "project_smoke",
    userId: null,
    stage: "assets",
    operation: "assets.generate",
    runId: "assets_run_smoke",
    projectConfigurationRevision: 1,
    schemaVersion: "resolved_generation_configuration_v1",
    configurationHash: "h",
    resolvedConfigurationJson:
      resolvedImageModel === undefined
        ? {}
        : { resolved_capabilities: { "image.generate": { provider_key: "dashscope", model_id: resolvedImageModel } } },
    resolutionTraceJson: [],
    quoteId: null,
    quoteFingerprint: null,
    estimatedCostMicros: null,
    authorizationCostMicros: null,
    budgetLimitMicros: null,
    budgetOverrideAuthorized: false,
    pricingHash: null,
    pricingVersionSetJson: [],
    createdAt: now,
    updatedAt: now,
  } as unknown as import("../../backend/src/db/client.js").RunConfigurationSnapshotRecord;
  db.runConfigurationSnapshots.set(snapshot.id, snapshot);
  db.generationRuns.set("assets_run_smoke", {
    id: "assets_run_smoke",
    projectId: "project_smoke",
    userId: null,
    operation: "assets.generate",
    idempotencyKey: "assets_run_smoke",
    payloadFingerprint: "f",
    quoteId: null,
    runConfigurationSnapshotId: snapshot.id,
    dispatchPayloadJson: {},
    status: "running",
    dispatchLeaseOwner: "smoke",
    dispatchLeaseExpiresAt: new Date(now.getTime() + 30_000),
    dispatchClaimCount: 1,
    createdAt: now,
    updatedAt: now,
  } as unknown as import("../../backend/src/db/client.js").GenerationRunRecord);
  return db;
}

describe("角色 sheet 假运行时冒烟（T5）", () => {
  let storageDir: string | null = null;

  afterEach(async () => {
    if (storageDir) {
      await rm(storageDir, { recursive: true, force: true });
      storageDir = null;
    }
  });

  async function makeStorage() {
    storageDir = join(tmpdir(), `character-sheet-smoke-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(storageDir, { recursive: true });
    return storageDir;
  }

  function compilePlan(characterSheet?: { enabled: boolean; minSegmentHits: number }): AssetPlan {
    try {
      return compileAssetPlanFromIntents(makeCompilerInput(characterSheet)).plan;
    } catch (error) {
      throw new Error(`compile_failed: ${JSON.stringify((error as { issues?: unknown }).issues)}`);
    }
  }

  function buildManifest(plan: AssetPlan): AssetManifest {
    return buildInitialAssetManifest({
      assetPlanRecordId: "asset_plan_smoke",
      assetPlan: plan,
      segmentIds: SEGMENT_IDS,
    });
  }

  async function run(manifest: AssetManifest, plan: AssetPlan, input: {
    db?: DbClient;
    referenceImagesSupported?: boolean;
    storageDir: string;
  }) {
    return executeAssetManifest({
      db: input.db ?? createSmokeDb(),
      assetManifestRecordId: "manifest_smoke",
      assetRunId: "assets_run_smoke",
      manifest,
      assetPlan: plan,
      registry: createAssetProviderRegistry([
        createFakeImageProvider({
          model: "wan2.7-image",
          referenceImagesSupported: input.referenceImagesSupported ?? true,
        }),
      ]),
      projectStorageRootDir: input.storageDir,
    });
  }

  function imagePrepareMarkers(db: DbClient) {
    return [...db.assetProviderJobRecords.values()]
      .filter((job) => job.taskId.startsWith("img_"))
      .map((job) => ({
        taskId: job.taskId,
        referenceImageCount: (job.rawRequestJson as { reference_image_count?: number }).reference_image_count ?? 0,
      }));
  }

  it("① ② sheet 产出 image artifact，且分镜图 prepare 回显收到参考图", async () => {
    const dir = await makeStorage();
    const plan = compilePlan(SHEET_ENABLED);
    const db = createSmokeDb("wan2.7-image");
    const { manifest } = await run(buildManifest(plan), plan, { db, storageDir: dir });

    const sheetExecution = manifest.executions.find((execution) => execution.task_type === "character_sheet");
    expect(sheetExecution?.status).toBe("completed");
    expect(sheetExecution?.output_artifact_ids.length).toBe(1);
    const sheetArtifact = manifest.artifacts.find(
      (artifact) => artifact.metadata?.sheet_role === "character_sheet",
    );
    expect(sheetArtifact).toBeDefined();
    // 横版 2K：尺寸来自任务参数（不是被硬编码的 1080×1920）。
    expect(sheetArtifact?.metadata).toMatchObject({ width: 2048, height: 1152, character_id: "char_1" });

    // ② 三个分镜图任务的 prepare 都回显收到 1 张参考图。
    const markers = imagePrepareMarkers(db);
    expect(markers).toHaveLength(SEGMENT_COUNT);
    expect(markers.every((marker) => marker.referenceImageCount === 1)).toBe(true);

    // 路由豁免：sheet 不进 segment_routes。
    expect(JSON.stringify(manifest.segment_routes)).not.toContain(sheetArtifact!.artifact_id);
  });

  it("③ 降级路径：sheet 未产出时分镜图仍 completed（纯文本锚点）", async () => {
    const dir = await makeStorage();
    const plan = compilePlan(SHEET_ENABLED);
    const manifest = buildManifest(plan);
    const db = createSmokeDb("wan2.7-image");
    // 模拟 sheet 生成失败：无产物、execution 置 failed（终态，引擎不再重试）。
    for (const execution of manifest.executions) {
      if (execution.task_type === "character_sheet") execution.status = "failed";
    }
    const { manifest: result } = await run(manifest, plan, { db, storageDir: dir });

    expect(
      result.executions.filter((execution) => execution.task_type === "image_still")
        .every((execution) => execution.status === "completed"),
    ).toBe(true);
    expect(result.artifacts.some((artifact) => artifact.artifact_type === "image")).toBe(true);
    // 无 sheet 产物 ⇒ 纯文本锚点：零注入且不产生"不支持参考图"之外的降级 note。
    expect(imagePrepareMarkers(db).every((marker) => marker.referenceImageCount === 0)).toBe(true);
  });

  it("④ 开关关闭：零 sheet 任务、零注入，与现状逐字一致", async () => {
    const dir = await makeStorage();
    const plan = compilePlan(undefined);
    const manifest = buildManifest(plan);
    const db = createSmokeDb("wan2.7-image");
    const { manifest: result } = await run(manifest, plan, { db, storageDir: dir });

    expect(plan.tasks.some((task) => task.task_type === "character_sheet")).toBe(false);
    expect(
      plan.tasks.every((task) => task.parameters.character_sheet_task_ids === undefined),
    ).toBe(true);
    expect(result.executions.some((execution) => execution.task_type === "character_sheet")).toBe(false);
    expect(imagePrepareMarkers(db).every((marker) => marker.referenceImageCount === 0)).toBe(true);
    expect(
      result.executions.every((execution) => execution.notes.every((note) => !note.startsWith("[sheet]"))),
    ).toBe(true);
  });

  it("⑤ 局部重跑：工作 manifest 有 sheet artifact、无 sheet execution 时仍注入", async () => {
    const dir = await makeStorage();
    const plan = compilePlan(SHEET_ENABLED);
    const db = createSmokeDb("wan2.7-image");
    const first = await run(buildManifest(plan), plan, { db, storageDir: dir });

    // 模拟"仅重生成单个分镜任务"：run.service 会把非目标的旧 execution 过滤丢弃
    //（局部重跑只保留目标 execution），而旧 artifact 全部注入工作 manifest。
    const rerunManifest: AssetManifest = {
      ...first.manifest,
      executions: first.manifest.executions
        .filter((execution) => execution.task_type !== "character_sheet")
        .map((execution) =>
          execution.task_type === "image_still"
            ? { ...execution, status: "planned" as const, notes: [], output_artifact_ids: [] }
            : execution,
        ),
    };
    expect(rerunManifest.artifacts.some((artifact) => artifact.metadata?.sheet_role === "character_sheet")).toBe(true);
    expect(rerunManifest.executions.some((execution) => execution.task_type === "character_sheet")).toBe(false);

    const dbRerun = createSmokeDb("wan2.7-image");
    await run(rerunManifest, plan, { db: dbRerun, storageDir: dir });
    // execution 级查找会在此静默失效（无 sheet execution）；metadata 级查找仍注入。
    expect(imagePrepareMarkers(dbRerun).every((marker) => marker.referenceImageCount === 1)).toBe(true);
  });

  it("⑥ 确知模型不支持参考图：sheet 为 skipped_with_fallback 且零派发零计费", async () => {
    const dir = await makeStorage();
    const plan = compilePlan(SHEET_ENABLED);
    const db = createSmokeDb("wan2.6-t2i");
    const { manifest } = await run(buildManifest(plan), plan, {
      db,
      storageDir: dir,
      referenceImagesSupported: false,
    });

    const sheetExecution = manifest.executions.find((execution) => execution.task_type === "character_sheet");
    expect(sheetExecution?.status).toBe("skipped_with_fallback");
    expect(sheetExecution?.notes.join("\n")).toContain("不具备参考图能力");
    // 零派发：无该任务的 provider job；零计费：无 usage 记录。
    expect([...db.assetProviderJobRecords.values()].some((job) => job.taskId.startsWith("sheet_"))).toBe(false);
    expect(db.usageCostRecords.size).toBe(0);
    // 分镜图照常生成（文本锚点）。
    expect(
      manifest.executions.filter((execution) => execution.task_type === "image_still")
        .every((execution) => execution.status === "completed"),
    ).toBe(true);
  });
});
