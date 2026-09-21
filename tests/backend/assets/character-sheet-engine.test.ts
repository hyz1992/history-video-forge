/**
 * T3：执行引擎接线（角色 sheet）。
 *
 * 覆盖实施计划 §1 T3 的验证清单：
 * 1. 排序：character_sheet（1.5）先于 image_still（2）执行；
 * 2. 路由豁免：segment_routes 无 sheet artifact 痕迹（sheet 是参考资产，不是视觉位）；
 * 3. 记账：measuredUnitsForTask 命中 character_sheet（缺 case 时账单静默消失，设计 §3.4 F2）；
 * 4. 无注入价值不生成（P4/PP2）：确知冻结模型不具备参考图能力 → skipped_with_fallback、
 *    零派发零计费；信息缺失 → fail-open（照常生成）；
 * 5. 回归：视频依赖检查（"存在任意 image artifact"）不受影响。
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

import { createDbClient } from "../../../backend/src/db/client.js";
import { executeAssetManifest } from "../../../backend/src/modules/assets/assets-execution-engine.js";
import { createAssetProviderRegistry } from "../../../backend/src/modules/assets/assets-provider-registry.js";
import type {
  AssetManifest,
  AssetPlan,
  AssetProviderAdapter,
  AssetArtifact,
} from "../../../backend/src/modules/assets/assets-provider-adapter.js";
import type { DbClient } from "../../../backend/src/db/client.js";

const PNG_BYTES = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** 记录派发顺序的付费 adapter（fake 语义，但声明 billing 以走付费闸门与记账）。 */
function createRecordingAdapter(input: {
  providerType: "image" | "video";
  modelId: string;
  capability: "image.generate" | "video.image_to_video";
  calls: string[];
  storageDir: string;
}): AssetProviderAdapter {
  return {
    providerName: `recording_${input.providerType}`,
    providerType: input.providerType,
    billing: {
      capability: input.capability,
      providerKey: "dashscope",
      modelId: input.modelId,
    },
    canHandle: ({ taskType }) =>
      input.providerType === "image"
        ? taskType === "image_still" || taskType === "character_sheet"
        : taskType === "video_clip",
    prepare: async (ctx) => {
      input.calls.push(ctx.execution.task_id);
      return { providerJobId: null, rawRequestJson: { size: ctx.planTask.parameters.size } };
    },
    submit: async (ctx) => ({
      providerJobId: `job_${ctx.execution.task_id}`,
      rawResponseJson: { task_id: `job_${ctx.execution.task_id}` },
    }),
    poll: async () => ({ status: "completed" as const, rawResponseJson: {} }),
    download: async (ctx) => {
      const fileUri = join(input.storageDir, `${ctx.execution.task_id}.bin`);
      await writeFile(fileUri, PNG_BYTES);
      const artifact: AssetArtifact = {
        artifact_id: `artifact_${ctx.execution.task_id}`,
        artifact_type: input.providerType === "image" ? "image" : "video",
        origin: "provider",
        file_uri: fileUri,
        created_at: new Date().toISOString(),
        metadata:
          input.providerType === "image"
            ? {
                // 图片 artifact 的 metadata 必填 size（manifest schema 合同）。
                width: ctx.planTask.task_type === "character_sheet" ? 2048 : 1080,
                height: ctx.planTask.task_type === "character_sheet" ? 1152 : 1920,
                ...(ctx.planTask.task_type === "character_sheet"
                  ? {
                      sheet_role: "character_sheet",
                      character_id: ctx.planTask.parameters.character_id,
                    }
                  : {}),
              }
            : { duration_sec: 5, format: "mp4" },
      };
      return [artifact];
    },
    normalizeResult: async ({ downloadedArtifacts }) => ({
      artifacts: downloadedArtifacts,
      notes: [],
    }),
    cancel: async () => undefined,
  };
}

function sheetTask(): AssetPlan["tasks"][number] {
  return {
    task_id: "sheet_001",
    order: 2,
    task_type: "character_sheet",
    source_segment_id: null,
    source_excerpt: "束发深衣",
    production_intent: "定妆参考图",
    recommended_mode: "manual_allowed",
    provider_hint: null,
    prompt_draft: "角色定妆参考图「人物甲」：束发深衣",
    parameters: {
      character_id: "char_1",
      sheet_role: "character_sheet",
      aspect_ratio: "16:9",
      size: "2048*1152",
    },
    manual_upload_policy: {
      allowed: true,
      required: false,
      accepted_file_types: ["image/png", "image/jpeg"],
      acceptance_notes: [],
    },
    risk_notes: [],
    cost_tier: "low",
    initial_status: "planned",
  };
}

function imageTask(): AssetPlan["tasks"][number] {
  return {
    task_id: "task_img_001",
    order: 3,
    task_type: "image_still",
    source_segment_id: "sb_001",
    source_excerpt: "画面",
    production_intent: "生成分镜图",
    recommended_mode: "auto",
    provider_hint: null,
    prompt_draft: "战国宫门",
    parameters: {
      image_role: "anchor",
      size: "1080*1920",
      character_sheet_task_ids: ["sheet_001"],
    },
    manual_upload_policy: {
      allowed: true,
      required: false,
      accepted_file_types: ["image/png", "image/jpeg"],
      acceptance_notes: [],
    },
    risk_notes: [],
    cost_tier: "low",
    initial_status: "planned",
  };
}

function videoTask(): AssetPlan["tasks"][number] {
  return {
    task_id: "task_video_001",
    order: 4,
    task_type: "video_clip",
    source_segment_id: "sb_001",
    source_excerpt: "画面",
    production_intent: "生成视频片段",
    recommended_mode: "manual_allowed",
    provider_hint: null,
    prompt_draft: "战国宫门推近",
    parameters: { static_fallback_task_id: "task_img_001", duration_sec: 5, resolution: "720P" },
    manual_upload_policy: {
      allowed: true,
      required: false,
      accepted_file_types: ["video/mp4"],
      acceptance_notes: [],
    },
    risk_notes: [],
    cost_tier: "high",
    initial_status: "planned",
  };
}

function makeAssetPlan(): AssetPlan {
  const tasks = [sheetTask(), imageTask(), videoTask()];
  return {
    plan_version: "asset_plan_v1",
    source_storyboard_record_id: "storyboard_001",
    source_script_record_id: "script_001",
    source_topic_package_id: "topic_001",
    art_bible: {
      era_style: "战国",
      visual_tone: "克制写实",
      characters: [
        {
          character_id: "char_1",
          label: "人物甲",
          role: "主角",
          visual_description: "束发深衣",
          consistency_notes: [],
        },
      ],
      locations: [],
      props: [],
      global_prompt_prefix: "历史写实",
      global_negative_prompts: ["现代物品"],
      consistency_notes: [],
    },
    visual_budget: {},
    downgrade_policy: {},
    global_audio_strategy: {},
    tts_plan: {
      voice_profile_id: "voice_001",
      estimated_total_duration_sec: 10,
      chunking_strategy: "segment_boundary",
      chunks: [],
    },
    tasks,
    dependencies: [],
    cost_summary: {
      total_tasks: tasks.length,
      by_type: {},
      by_cost_tier: {},
      estimated_provider_calls: tasks.length,
      notes: [],
    },
    global_production_notes: [],
  };
}

function makeManifest(): AssetManifest {
  return {
    manifest_version: "asset_manifest_v1",
    source_asset_plan_id: "asset_plan_001",
    source_storyboard_record_id: "storyboard_001",
    source_script_record_id: "script_001",
    execution_options: {
      execution_mode: "auto_available",
      voice_profile_id: "voice_001",
      enabled_provider_types: ["image", "video"],
      allow_manual_placeholders: false,
    },
    executions: [
      {
        execution_id: "exec_sheet_001",
        task_id: "sheet_001",
        task_type: "character_sheet",
        status: "planned",
        origin: "provider",
        started_at: null,
        completed_at: null,
        provider_id: null,
        attempts: 0,
        output_artifact_ids: [],
        notes: [],
      },
      {
        execution_id: "exec_img_001",
        task_id: "task_img_001",
        task_type: "image_still",
        status: "planned",
        origin: "provider",
        started_at: null,
        completed_at: null,
        provider_id: null,
        attempts: 0,
        output_artifact_ids: [],
        notes: [],
      },
      {
        execution_id: "exec_video_001",
        task_id: "task_video_001",
        task_type: "video_clip",
        status: "planned",
        origin: "provider",
        started_at: null,
        completed_at: null,
        provider_id: null,
        attempts: 0,
        output_artifact_ids: [],
        notes: [],
      },
    ],
    artifacts: [],
    audio_summary: {
      voice_profile_id: "voice_001",
      tts_total_duration_sec: null,
      tts_chunk_artifact_ids: [],
      tts_chunk_routes: [],
      tts_merged_artifact_id: null,
      subtitle_artifact_id: null,
      bgm_placements: [],
      sfx_artifact_ids: [],
    },
    segment_routes: [
      {
        segment_id: "sb_001",
        tts_artifact_id: null,
        subtitle_artifact_id: null,
        primary_visual_artifact_id: null,
        visual_route_type: "image_only",
        motion_artifact_id: null,
        fallback_visual_artifact_id: null,
        sfx_artifact_ids: [],
        bgm_placement_ids: [],
        readiness: "blocked",
        notes: [],
      },
    ],
    readiness: "blocked",
    notes: [],
  };
}

/** 付费闸门上下文：run + 快照；resolved_capabilities 可按用例裁剪。 */
function createQuotedDb(input: {
  resolvedCapabilities?: Record<string, { provider_key: string; model_id: string }>;
  withSnapshot?: boolean;
} = {}): DbClient {
  const db = createDbClient();
  const assetRunId = "assets_run_001";
  const now = new Date();
  const snapshot = {
    id: "snap_001",
    projectId: "project_001",
    userId: null,
    stage: "assets",
    operation: "assets.generate",
    runId: assetRunId,
    projectConfigurationRevision: 1,
    schemaVersion: "resolved_generation_configuration_v1",
    configurationHash: "h",
    resolvedConfigurationJson:
      input.resolvedCapabilities === undefined
        ? {}
        : { resolved_capabilities: input.resolvedCapabilities },
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
  } as unknown as import("../../../backend/src/db/client.js").RunConfigurationSnapshotRecord;
  if (input.withSnapshot !== false) db.runConfigurationSnapshots.set(snapshot.id, snapshot);
  db.generationRuns.set(assetRunId, {
    id: assetRunId,
    projectId: "project_001",
    userId: null,
    operation: "assets.generate",
    idempotencyKey: assetRunId,
    payloadFingerprint: "f",
    quoteId: null,
    runConfigurationSnapshotId: snapshot.id,
    dispatchPayloadJson: {},
    status: "running",
    dispatchLeaseOwner: "test-worker",
    dispatchLeaseExpiresAt: new Date(now.getTime() + 30_000),
    dispatchClaimCount: 1,
    createdAt: now,
    updatedAt: now,
  } as unknown as import("../../../backend/src/db/client.js").GenerationRunRecord);
  return db;
}

describe("character_sheet 执行引擎接线（T3）", () => {
  let tempDir: string | null = null;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  async function makeStorage() {
    tempDir = join(tmpdir(), `character-sheet-engine-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(tempDir, { recursive: true });
    return tempDir;
  }

  async function run(input: {
    resolvedCapabilities?: Record<string, { provider_key: string; model_id: string }>;
    model?: string;
  }) {
    const storageDir = await makeStorage();
    const calls: string[] = [];
    const db = createQuotedDb({
      ...(input.resolvedCapabilities ? { resolvedCapabilities: input.resolvedCapabilities } : {}),
    });
    const registry = createAssetProviderRegistry([
      createRecordingAdapter({
        providerType: "image",
        modelId: input.model ?? "wan2.7-image",
        capability: "image.generate",
        calls,
        storageDir,
      }),
      createRecordingAdapter({
        providerType: "video",
        modelId: "wan2.7-i2v-2026-04-25",
        capability: "video.image_to_video",
        calls,
        storageDir,
      }),
    ]);
    const result = await executeAssetManifest({
      db,
      assetManifestRecordId: "manifest_001",
      assetRunId: "assets_run_001",
      manifest: makeManifest(),
      assetPlan: makeAssetPlan(),
      registry,
      projectStorageRootDir: storageDir,
    });
    return { db, result, calls };
  }

  it("sheet 先于分镜图与视频执行；segment_routes 无 sheet 痕迹；sheet 计费入账", async () => {
    const { db, result, calls } = await run({
      resolvedCapabilities: { "image.generate": { provider_key: "dashscope", model_id: "wan2.7-image" } },
    });

    // 1. 排序：TASK_TYPE_PRIORITY 的 character_sheet=1.5（T1 补齐）令 sheet 先派发。
    expect(calls).toEqual(["sheet_001", "task_img_001", "task_video_001"]);

    // 2 & 5. sheet 不进任何 segment route；分镜图/视频照常写入 route。
    const routesJson = JSON.stringify(result.manifest.segment_routes);
    expect(routesJson).not.toContain("sheet_001");
    expect(routesJson).not.toContain("artifact_sheet_001");
    expect(result.manifest.segment_routes[0]?.primary_visual_artifact_id).toBe(
      "artifact_task_img_001",
    );
    expect(
      result.manifest.executions.find((item) => item.task_id === "task_video_001")?.status,
    ).toBe("completed");

    // 3. 记账：sheet 的账单不得静默消失（unitType image / count 1）。
    const sheetJob = [...db.assetProviderJobRecords.values()].find(
      (job) => job.taskId === "sheet_001",
    );
    expect(sheetJob).toBeDefined();
    const sheetUsage = [...db.usageCostRecords.values()].find(
      (record) => record.assetProviderJobRecordId === sheetJob!.id,
    );
    expect(sheetUsage).toMatchObject({
      capability: "image.generate",
      modelId: "wan2.7-image",
      unitType: "image",
      outputUnits: 1,
    });
  });

  it("确知冻结模型不具备参考图能力：sheet 置 skipped_with_fallback、零派发、零计费", async () => {
    const { db, result, calls } = await run({
      resolvedCapabilities: {
        "image.generate": { provider_key: "dashscope", model_id: "wan2.6-t2i" },
      },
    });

    const sheetExecution = result.manifest.executions.find((item) => item.task_id === "sheet_001");
    expect(sheetExecution?.status).toBe("skipped_with_fallback");
    expect(sheetExecution?.notes.join("\n")).toContain("不具备参考图能力");
    // 不派发：sheet 从未进入 adapter.prepare；分镜图与视频不受影响。
    expect(calls).toEqual(["task_img_001", "task_video_001"]);
    // 零派发 ⇒ 无 job 记录（无外部调用）、无 usage 记录（零计费）。
    expect(
      [...db.assetProviderJobRecords.values()].filter((job) => job.taskId === "sheet_001"),
    ).toEqual([]);
    expect(db.usageCostRecords.size).toBe(2); // 只有分镜图与视频两笔
  });

  it("fail-open：快照缺 resolved_capabilities 或槽位非 dashscope 时照常生成", async () => {
    const noCapabilities = await run({});
    expect(noCapabilities.calls).toContain("sheet_001");
    expect(
      noCapabilities.result.manifest.executions.find((item) => item.task_id === "sheet_001")?.status,
    ).toBe("completed");

    const otherProvider = await run({
      resolvedCapabilities: {
        "image.generate": { provider_key: "autodl", model_id: "wan2.6-t2i" },
      },
    });
    expect(otherProvider.calls).toContain("sheet_001");

    // 未识别的模型族（能力未知）同样 fail-open。
    const unknownFamily = await run({
      resolvedCapabilities: {
        "image.generate": { provider_key: "dashscope", model_id: "wanx-future-model" },
      },
      model: "wanx-future-model",
    });
    expect(unknownFamily.calls).toContain("sheet_001");
  });
});
