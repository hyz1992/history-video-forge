import { describe, expect, it } from "vitest";

import { createDbClient } from "../../../backend/src/db/client.js";
import { executeAssetManifest } from "../../../backend/src/modules/assets/assets-execution-engine.js";
import { createAssetProviderRegistry } from "../../../backend/src/modules/assets/assets-provider-registry.js";
import type { AssetProviderAdapter } from "../../../backend/src/modules/assets/assets-provider-adapter.js";
import type { AssetManifest, AssetPlan } from "../../../shared/src/index.js";

function makeManifest(): AssetManifest {
  return {
    manifest_version: "asset_manifest_v1",
    source_asset_plan_id: "asset_plan_001",
    source_storyboard_record_id: "storyboard_001",
    source_script_record_id: "script_001",
    execution_options: {
      execution_mode: "auto_available",
      voice_profile_id: "voice_001",
      enabled_provider_types: ["image"],
      allow_manual_placeholders: false,
    },
    executions: [
      {
        execution_id: "exec_img_001",
        task_id: "img_001",
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

function makeAssetPlan(): AssetPlan {
  return {
    plan_version: "asset_plan_v1",
    source_storyboard_record_id: "storyboard_001",
    source_script_record_id: "script_001",
    source_topic_package_id: "topic_001",
    art_bible: {
      era_style: "春秋战国",
      visual_tone: "冷峻",
      characters: [],
      locations: [],
      props: [],
      global_prompt_prefix: "中国古代历史短视频",
      global_negative_prompts: [],
      consistency_notes: [],
    },
    visual_budget: {},
    downgrade_policy: {},
    global_audio_strategy: {},
    tts_plan: {
      voice_profile_id: "voice_001",
      estimated_total_duration_sec: 2,
      chunking_strategy: "segment_boundary",
      chunks: [],
    },
    tasks: [
      {
        task_id: "img_001",
        order: 0,
        task_type: "image_still",
        source_segment_id: "sb_001",
        source_excerpt: "画面输入",
        production_intent: "生成分镜主图",
        recommended_mode: "auto",
        provider_hint: "fake_image",
        prompt_draft: "古代宫殿中景",
        parameters: {},
        manual_upload_policy: {
          allowed: true,
          required: false,
          accepted_file_types: ["image/png"],
          acceptance_notes: [],
        },
        risk_notes: [],
        cost_tier: "low",
        initial_status: "planned",
      },
    ],
    dependencies: [],
    cost_summary: {
      total_tasks: 1,
      by_type: { image_still: 1 },
      by_cost_tier: { low: 1 },
      estimated_provider_calls: 1,
      notes: [],
    },
    global_production_notes: [],
  };
}

describe("assets execution engine", () => {
  it("runs an enabled adapter and records output artifacts", async () => {
    const db = createDbClient();
    const adapter: AssetProviderAdapter = {
      providerName: "fake_image",
      providerType: "image",
      canHandle: ({ taskType }) => taskType === "image_still",
      prepare: async () => ({ providerJobId: null, rawRequestJson: {} }),
      submit: async () => ({ providerJobId: "job_001", rawResponseJson: {} }),
      poll: async () => ({ status: "completed", rawResponseJson: {} }),
      download: async () => [
        {
          artifact_id: "artifact_img_001",
          artifact_type: "image",
          origin: "provider",
          file_uri: "generated://image.png",
          created_at: "2026-05-16T00:00:00.000Z",
          metadata: { width: 1080, height: 1920 },
        },
      ],
      normalizeResult: async ({ downloadedArtifacts }) => ({
        artifacts: downloadedArtifacts,
        notes: ["fake image generated"],
      }),
      cancel: async () => undefined,
    };

    const result = await executeAssetManifest({
      db,
      assetManifestRecordId: "manifest_001",
      assetRunId: "assets_run_001",
      manifest: makeManifest(),
      registry: createAssetProviderRegistry([adapter]),
      assetPlan: makeAssetPlan(),
      projectStorageRootDir: "unused",
    });

    expect(result.manifest.artifacts).toHaveLength(1);
    expect(result.manifest.executions[0]).toMatchObject({
      status: "completed",
      provider_id: "fake_image",
    });
    expect(db.assetProviderJobRecords.size).toBe(1);
  });

  it("本地 adapter（无 billing）创建的 job 身份三元组全空（CHECK 约束一致）", async () => {
    const db = createDbClient();
    const adapter: AssetProviderAdapter = {
      providerName: "fake_local",
      providerType: "image",
      canHandle: ({ taskType }) => taskType === "image_still",
      prepare: async () => ({ providerJobId: null, rawRequestJson: {} }),
      submit: async () => ({ providerJobId: "job_local_001", rawResponseJson: {} }),
      poll: async () => ({ status: "completed", rawResponseJson: {} }),
      download: async () => [],
      normalizeResult: async ({ downloadedArtifacts }) => ({
        artifacts: downloadedArtifacts,
        notes: [],
      }),
      cancel: async () => undefined,
    };

    await executeAssetManifest({
      db,
      assetManifestRecordId: "manifest_001",
      assetRunId: "assets_run_001",
      manifest: makeManifest(),
      registry: createAssetProviderRegistry([adapter]),
      assetPlan: makeAssetPlan(),
      projectStorageRootDir: "unused",
    });

    const job = [...db.assetProviderJobRecords.values()][0]!;
    // 回归：2026-08-24 之前本地 job 混合写入（generationRunId/attemptIndex
    // 非空、providerRequestKey 为空），违反数据库 call_intent_consistency CHECK。
    expect(job.generationRunId).toBeNull();
    expect(job.providerRequestKey).toBeNull();
    expect(job.attemptIndex).toBeNull();
  });

  it("计费 adapter 创建的 job 携带完整 call-intent 三元组", async () => {
    const db = createDbClient();
    const runId = "assets_run_paid_001";
    const snapshotId = "snapshot_paid_001";
    db.generationRuns.set(runId, {
      runConfigurationSnapshotId: snapshotId,
    } as never);
    db.runConfigurationSnapshots.set(snapshotId, { id: snapshotId } as never);

    const adapter: AssetProviderAdapter = {
      providerName: "fake_paid",
      providerType: "image",
      billing: { capability: "image.generate", providerKey: "fake", modelId: "fake-model" },
      canHandle: ({ taskType }) => taskType === "image_still",
      prepare: async () => ({ providerJobId: null, rawRequestJson: {} }),
      submit: async () => ({ providerJobId: "job_paid_001", rawResponseJson: {} }),
      poll: async () => ({ status: "completed", rawResponseJson: {} }),
      download: async () => [],
      normalizeResult: async ({ downloadedArtifacts }) => ({
        artifacts: downloadedArtifacts,
        notes: [],
      }),
      cancel: async () => undefined,
    };

    await executeAssetManifest({
      db,
      assetManifestRecordId: "manifest_001",
      assetRunId: runId,
      manifest: makeManifest(),
      registry: createAssetProviderRegistry([adapter]),
      assetPlan: makeAssetPlan(),
      projectStorageRootDir: "unused",
    });

    const job = [...db.assetProviderJobRecords.values()][0]!;
    expect(job.generationRunId).toBe(runId);
    expect(job.providerRequestKey).toBe(`assets:${runId}:img_001`);
    expect(job.attemptIndex).toBe(0);
  });

  it("routes generated video artifacts as primary visual while preserving image fallback", async () => {
    const db = createDbClient();
    const manifest = makeManifest();
    manifest.execution_options.enabled_provider_types = ["video"];
    manifest.executions = [
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
    ];
    manifest.artifacts = [
      {
        artifact_id: "artifact_img_001",
        artifact_type: "image",
        origin: "provider",
        file_uri: "generated://image.png",
        created_at: "2026-05-16T00:00:00.000Z",
        metadata: { width: 1080, height: 1920 },
      },
    ];
    manifest.segment_routes[0] = {
      ...manifest.segment_routes[0]!,
      primary_visual_artifact_id: "artifact_img_001",
      visual_route_type: "image_with_motion",
      motion_artifact_id: "artifact_motion_001",
      fallback_visual_artifact_id: "artifact_img_001",
      readiness: "fallback_ready",
    };

    const assetPlan = makeAssetPlan();
    assetPlan.tasks = [
      {
        task_id: "task_video_001",
        order: 0,
        task_type: "video_clip",
        source_segment_id: "sb_001",
        source_excerpt: "video source excerpt",
        production_intent: "Generate a video clip from the segment image.",
        recommended_mode: "auto",
        provider_hint: "fake_video",
        prompt_draft: "slow push-in on an ancient court confrontation",
        parameters: {},
        manual_upload_policy: {
          allowed: false,
          required: false,
          accepted_file_types: [],
          acceptance_notes: [],
        },
        risk_notes: [],
        cost_tier: "high",
        initial_status: "planned",
      },
    ];

    const adapter: AssetProviderAdapter = {
      providerName: "fake_video",
      providerType: "video",
      canHandle: ({ taskType }) => taskType === "video_clip",
      prepare: async () => ({ providerJobId: null, rawRequestJson: {} }),
      submit: async () => ({ providerJobId: "job_video_001", rawResponseJson: {} }),
      poll: async () => ({ status: "completed", rawResponseJson: {} }),
      download: async () => [
        {
          artifact_id: "artifact_video_task_video_001",
          artifact_type: "video",
          origin: "provider",
          file_uri: "generated://video.mp4",
          created_at: "2026-05-16T00:01:00.000Z",
          metadata: {
            duration_sec: 5,
            width: 720,
            height: 1280,
            fps: 24,
          },
        },
      ],
      normalizeResult: async ({ downloadedArtifacts }) => ({
        artifacts: downloadedArtifacts,
        notes: ["fake video generated"],
      }),
      cancel: async () => undefined,
    };

    const result = await executeAssetManifest({
      db,
      assetManifestRecordId: "manifest_001",
      assetRunId: "assets_run_001",
      manifest,
      registry: createAssetProviderRegistry([adapter]),
      assetPlan,
      projectStorageRootDir: "unused",
    });
    const route = result.manifest.segment_routes.find(
      (item) => item.segment_id === "sb_001",
    );

    expect(route?.visual_route_type).toBe("video_clip");
    expect(route?.primary_visual_artifact_id).toBe(
      "artifact_video_task_video_001",
    );
    expect(route?.fallback_visual_artifact_id).toBe("artifact_img_001");
  });

  it("视频计价与执行同源：任务参数 resolution=1080P 优先于快照 api_quality（修复 1080P 按 720p 低估）", async () => {
    const db = createDbClient();
    const runId = "assets_run_paid_video_001";
    const snapshotId = "snapshot_paid_video_001";
    db.generationRuns.set(runId, {
      runConfigurationSnapshotId: snapshotId,
    } as never);
    db.runConfigurationSnapshots.set(snapshotId, {
      id: snapshotId,
      // 快照声称 720p，但任务参数（执行真相源）冻结的是 1080P——
      // 计价必须跟参数走（2026-08-28 回归：生产 5 条视频记录被按 720p 低估）
      resolvedConfigurationJson: {
        effective: { video: { api_quality: "standard_720p" } },
      },
    } as never);
    const now = new Date();
    db.providerModelCatalog.set("video.image_to_video.dashscope.wan2.7-i2v-2026-04-25", {
      id: "video.image_to_video.dashscope.wan2.7-i2v-2026-04-25",
      capability: "video.image_to_video",
      providerKey: "dashscope",
      modelId: "wan2.7-i2v-2026-04-25",
      modelVersion: null,
      displayName: "wan2.7 图生视频",
      qualityTier: null,
      speedTier: null,
      parameterCapabilitiesJson: {
        api_video_qualities: ["standard_720p", "high_1080p"],
        min_duration_seconds_per_task: 2,
        max_duration_seconds_per_task: 15,
      },
      pricingVersion: "test-pricing-2026-08-17",
      pricingJson: {
        unit_type: "video_second",
        currency: "CNY",
        price_micros_per_second_by_quality: {
          standard_720p: "600000",
          high_1080p: "1000000",
        },
        source_note: "测试 fixture",
      },
      status: "active",
      isDefault: false,
      createdAt: now,
      updatedAt: now,
    });

    const manifest = makeManifest();
    manifest.execution_options.enabled_provider_types = ["video"];
    manifest.executions = [
      {
        execution_id: "exec_video_paid_001",
        task_id: "task_video_paid_001",
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
    ];
    manifest.artifacts = [
      {
        artifact_id: "artifact_img_paid_001",
        artifact_type: "image",
        origin: "provider",
        file_uri: "generated://image.png",
        created_at: "2026-05-16T00:00:00.000Z",
        metadata: { width: 1080, height: 1920 },
      },
    ];
    manifest.segment_routes[0] = {
      ...manifest.segment_routes[0]!,
      primary_visual_artifact_id: "artifact_img_paid_001",
      visual_route_type: "image_with_motion",
      fallback_visual_artifact_id: "artifact_img_paid_001",
      readiness: "fallback_ready",
    };

    const assetPlan = makeAssetPlan();
    assetPlan.tasks = [
      {
        task_id: "task_video_paid_001",
        order: 0,
        task_type: "video_clip",
        source_segment_id: "sb_001",
        source_excerpt: "video source excerpt",
        production_intent: "Generate a 1080P video clip.",
        recommended_mode: "auto",
        provider_hint: "fake_paid_video",
        prompt_draft: "slow push-in",
        // 25 秒超出 DashScope 单任务上限：执行端 clamp 为 15 秒，
        // 计价必须同 clamp（否则按 25 秒高估）；同时验证 resolution
        // 参数优先于快照 api_quality（2026-08-28 回归）。
        parameters: { duration_sec: 25, resolution: "1080P" },
        manual_upload_policy: {
          allowed: false,
          required: false,
          accepted_file_types: [],
          acceptance_notes: [],
        },
        risk_notes: [],
        cost_tier: "high",
        initial_status: "planned",
      },
    ];

    const adapter: AssetProviderAdapter = {
      providerName: "fake_paid_video",
      providerType: "video",
      billing: {
        capability: "video.image_to_video",
        providerKey: "dashscope",
        modelId: "wan2.7-i2v-2026-04-25",
      },
      canHandle: ({ taskType }) => taskType === "video_clip",
      prepare: async () => ({ providerJobId: null, rawRequestJson: {} }),
      submit: async () => ({
        providerJobId: "job_paid_video_001",
        rawResponseJson: {},
      }),
      poll: async () => ({ status: "completed", rawResponseJson: {} }),
      download: async () => [
        {
          artifact_id: "artifact_video_paid_001",
          artifact_type: "video",
          origin: "provider",
          file_uri: "generated://video.mp4",
          created_at: "2026-05-16T00:01:00.000Z",
          metadata: { duration_sec: 15, width: 1080, height: 1920, fps: 24 },
        },
      ],
      normalizeResult: async ({ downloadedArtifacts }) => ({
        artifacts: downloadedArtifacts,
        notes: [],
      }),
      cancel: async () => undefined,
    };

    await executeAssetManifest({
      db,
      assetManifestRecordId: "manifest_paid_001",
      assetRunId: runId,
      manifest,
      registry: createAssetProviderRegistry([adapter]),
      assetPlan,
      projectStorageRootDir: "unused",
    });

    const usage = [...db.usageCostRecords.values()].find(
      (record) => record.unitType === "video_second",
    );
    expect(usage).toBeDefined();
    // duration_sec=25 被 clamp 为 15 秒执行与计价：15 × ¥1（high_1080p），
    // 既不是 25 × ¥1（高估），也不是 15 × ¥0.6（720p 低估）
    expect(usage!.estimatedCostMicros).toBe("15000000");
    expect(usage!.actualCostMicros).toBe("15000000");
    expect(usage!.costBasis).toBe("estimate");
    expect(usage!.outputUnits).toBe(15);
    expect(usage!.unitDetailJson).toEqual({ quality: "high_1080p" });
  });

  it("拆分任务：计费按 job 留痕总秒数（13s × 2 段），route primary 锁定首段", async () => {
    const db = createDbClient();
    const runId = "assets_run_split_video_001";
    const snapshotId = "snapshot_split_video_001";
    db.generationRuns.set(runId, {
      runConfigurationSnapshotId: snapshotId,
    } as never);
    db.runConfigurationSnapshots.set(snapshotId, {
      id: snapshotId,
      resolvedConfigurationJson: {
        effective: { video: { api_quality: "standard_720p" } },
      },
    } as never);
    const now = new Date();
    db.providerModelCatalog.set("video.image_to_video.dashscope.wan2.7-i2v-2026-04-25", {
      id: "video.image_to_video.dashscope.wan2.7-i2v-2026-04-25",
      capability: "video.image_to_video",
      providerKey: "dashscope",
      modelId: "wan2.7-i2v-2026-04-25",
      modelVersion: null,
      displayName: "wan2.7 图生视频",
      qualityTier: null,
      speedTier: null,
      parameterCapabilitiesJson: {
        api_video_qualities: ["standard_720p", "high_1080p"],
        min_duration_seconds_per_task: 2,
        max_duration_seconds_per_task: 15,
      },
      pricingVersion: "test-pricing-2026-08-17",
      pricingJson: {
        unit_type: "video_second",
        currency: "CNY",
        price_micros_per_second_by_quality: {
          standard_720p: "600000",
          high_1080p: "1000000",
        },
        source_note: "测试 fixture",
      },
      status: "active",
      isDefault: false,
      createdAt: now,
      updatedAt: now,
    });

    const manifest = makeManifest();
    manifest.execution_options.enabled_provider_types = ["video"];
    manifest.executions = [
      {
        execution_id: "exec_video_split_001",
        task_id: "task_video_split_001",
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
    ];
    manifest.artifacts = [
      {
        artifact_id: "artifact_img_split_001",
        artifact_type: "image",
        origin: "provider",
        file_uri: "generated://image.png",
        created_at: "2026-05-16T00:00:00.000Z",
        metadata: { width: 1080, height: 1920 },
      },
    ];
    manifest.segment_routes[0] = {
      ...manifest.segment_routes[0]!,
      primary_visual_artifact_id: "artifact_img_split_001",
      visual_route_type: "image_with_motion",
      fallback_visual_artifact_id: "artifact_img_split_001",
      readiness: "fallback_ready",
    };

    const assetPlan = makeAssetPlan();
    assetPlan.tasks = [
      {
        task_id: "task_video_split_001",
        order: 0,
        task_type: "video_clip",
        source_segment_id: "sb_001",
        source_excerpt: "video source excerpt",
        production_intent: "Generate a 26s video in two splits.",
        recommended_mode: "auto",
        provider_hint: "fake_split_video",
        prompt_draft: "slow push-in",
        parameters: { duration_sec: 25, resolution: "1080P" },
        manual_upload_policy: {
          allowed: false,
          required: false,
          accepted_file_types: [],
          acceptance_notes: [],
        },
        risk_notes: [],
        cost_tier: "high",
        initial_status: "planned",
      },
    ];

    const splitArtifacts = [0, 1].map((index) => ({
      artifact_id: `artifact_video_split_${index}`,
      artifact_type: "video" as const,
      origin: "provider" as const,
      file_uri: `generated://video_${index}.mp4`,
      created_at: "2026-05-16T00:01:00.000Z",
      metadata: {
        duration_sec: 13,
        width: 1080,
        height: 1920,
        fps: 24,
        video_split_of_task: "task_video_split_001",
        video_split_index: index,
        video_split_total: 2,
      },
    }));

    const adapter: AssetProviderAdapter = {
      providerName: "fake_split_video",
      providerType: "video",
      billing: {
        capability: "video.image_to_video",
        providerKey: "dashscope",
        modelId: "wan2.7-i2v-2026-04-25",
      },
      canHandle: ({ taskType }) => taskType === "video_clip",
      // 模拟真实 adapter 的 prepare 留痕：25 秒拆 2 段、每段 13 秒
      prepare: async () => ({
        providerJobId: null,
        rawRequestJson: { split_total: 2, split_index: 0, duration_sec: 13 },
      }),
      submit: async () => ({ providerJobId: "job_split_001", rawResponseJson: {} }),
      poll: async () => ({ status: "completed", rawResponseJson: {} }),
      download: async () => splitArtifacts,
      normalizeResult: async ({ downloadedArtifacts }) => ({
        artifacts: downloadedArtifacts,
        notes: [],
      }),
      cancel: async () => undefined,
    };

    const result = await executeAssetManifest({
      db,
      assetManifestRecordId: "manifest_split_001",
      assetRunId: runId,
      manifest,
      registry: createAssetProviderRegistry([adapter]),
      assetPlan,
      projectStorageRootDir: "unused",
    });

    const usage = [...db.usageCostRecords.values()].find(
      (record) => record.unitType === "video_second",
    );
    expect(usage).toBeDefined();
    // 2 段 × 13 秒 × ¥1（high_1080p）= ¥26——按执行留痕计，不按参数 25 秒
    expect(usage!.outputUnits).toBe(26);
    expect(usage!.estimatedCostMicros).toBe("26000000");
    expect(usage!.actualCostMicros).toBe("26000000");
    expect(usage!.unitDetailJson).toEqual({ quality: "high_1080p" });

    // route primary 锁定首段（compose 按首段锚定时间线，后续段按 index 追加）
    const route = result.manifest.segment_routes.find((item) => item.segment_id === "sb_001");
    expect(route?.visual_route_type).toBe("video_clip");
    expect(route?.primary_visual_artifact_id).toBe("artifact_video_split_0");
    expect(result.manifest.artifacts.filter((a) => a.artifact_type === "video")).toHaveLength(2);
  });
});
