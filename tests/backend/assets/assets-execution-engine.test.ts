import { describe, expect, it, vi } from "vitest";

import { createDbClient } from "../../../backend/src/db/client.js";
import { executeAssetManifest } from "../../../backend/src/modules/assets/assets-execution-engine.js";
import { createAssetProviderRegistry } from "../../../backend/src/modules/assets/assets-provider-registry.js";
import { NarrationSourceError } from "../../../backend/src/modules/narration/narration-invalidation.js";
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

function makeLifecycleAdapter(patch: Partial<AssetProviderAdapter> = {}): AssetProviderAdapter {
  return {
    providerName: "fake_image",
    providerType: "image",
    canHandle: ({ taskType }) => taskType === "image_still",
    prepare: async () => ({ providerJobId: null, rawRequestJson: { prompt: "古代宫殿" } }),
    submit: async () => ({ providerJobId: "remote_001", rawResponseJson: { request_id: "submit_001" } }),
    poll: async () => ({ status: "completed", rawResponseJson: { request_id: "poll_001" } }),
    download: async () => [],
    normalizeResult: async ({ downloadedArtifacts }) => ({ artifacts: downloadedArtifacts, notes: [] }),
    cancel: async () => undefined,
    ...patch,
  };
}

function runLifecycle(db: ReturnType<typeof createDbClient>, adapter: AssetProviderAdapter,
  beforeDispatch?: () => Promise<void>) {
  return executeAssetManifest({
    db, assetManifestRecordId: "manifest_001", assetRunId: "assets_run_001",
    manifest: makeManifest(), registry: createAssetProviderRegistry([adapter]),
    assetPlan: makeAssetPlan(), projectStorageRootDir: "unused", beforeDispatch,
  });
}

function onlyJob(db: ReturnType<typeof createDbClient>) {
  expect(db.assetProviderJobRecords.size).toBe(1);
  return [...db.assetProviderJobRecords.values()][0]!;
}

describe("provider job lifecycle", () => {
  it("已提交后 job 持续写失败仍尝试费用记账并传播持久化异常", async () => {
    const db = createDbClient();
    db.generationRuns.set("assets_run_001", { id: "assets_run_001", projectId: "p1", runConfigurationSnapshotId: "snapshot" } as never);
    db.runConfigurationSnapshots.set("snapshot", { id: "snapshot", projectId: "p1", resolvedConfigurationJson: {}, pricingVersionSetJson: [] } as never);
    const writeError = new Error("job_write_failed");
    let usageWrites = 0;
    let submits = 0;
    let polls = 0;
    let downloads = 0;
    let dispatchedExecution: AssetManifest["executions"][number] | null = null;
    db.thirdAggregateWriter = {
      saveProviderJob: async record => {
        if (record.status !== "prepared") throw writeError;
        return record;
      },
      saveUsageCostRecord: async () => { usageWrites += 1; },
    } as NonNullable<typeof db.thirdAggregateWriter>;
    const adapter = makeLifecycleAdapter({
      billing: { capability: "image.generate", providerKey: "dashscope", modelId: "test-model" },
      submit: async ctx => {
        submits += 1;
        dispatchedExecution = ctx.execution;
        ctx.onDispatch?.();
        return { providerJobId: "remote_001", rawResponseJson: { request_id: "submit_001" } };
      },
      poll: async () => { polls += 1; return { status: "completed", rawResponseJson: null }; },
      download: async () => { downloads += 1; return []; },
    });
    await expect(runLifecycle(db, adapter)).rejects.toBe(writeError);
    expect(dispatchedExecution).toMatchObject({ status: "failed", attempts: 1 });
    expect(submits).toBe(1);
    expect(polls).toBe(0);
    expect(downloads).toBe(0);
    expect(onlyJob(db).status).toBe("prepared");
    expect(usageWrites).toBe(1);
    expect(db.usageCostRecords.size).toBe(1);
    expect([...db.usageCostRecords.values()][0]).toMatchObject({
      status: "failed", assetProviderJobRecordId: onlyJob(db).id, actualCostMicros: null,
      providerRequestKey: "assets:assets_run_001:img_001", attemptIndex: 0,
    });
  });

  it("submitted 写入失败后恢复 failed 保存真实提交返回时间而非恢复时间", async () => {
    vi.useFakeTimers();
    try {
      const db = createDbClient();
      const submittedAt = new Date("2026-10-03T01:00:01Z");
      const recoveredAt = new Date("2026-10-03T01:00:02Z");
      vi.setSystemTime(new Date("2026-10-03T01:00:00Z"));
      let submits = 0;
      let polls = 0;
      db.thirdAggregateWriter = { saveProviderJob: async record => {
        if (record.status === "submitted") {
          vi.setSystemTime(recoveredAt);
          throw new Error("job_write_failed");
        }
        return record;
      } } as NonNullable<typeof db.thirdAggregateWriter>;
      const result = await runLifecycle(db, makeLifecycleAdapter({
        submit: async () => {
          submits += 1;
          vi.setSystemTime(submittedAt);
          return { providerJobId: "remote_001", rawResponseJson: { request_id: "submit_001" } };
        },
        poll: async () => { polls += 1; return { status: "completed", rawResponseJson: null }; },
      }));
      expect(result.manifest.executions[0]?.status).toBe("failed");
      expect(submits).toBe(1);
      expect(polls).toBe(0);
      expect(onlyJob(db)).toMatchObject({
        status: "failed", submittedAt, completedAt: recoveredAt,
        providerJobId: "remote_001", rawResponseJson: { request_id: "submit_001" },
      });
    } finally { vi.useRealTimers(); }
  });

  it("submit 成功后在 poll 前保存提交 ID、响应和首次提交时间", async () => {
    const db = createDbClient();
    let submitCalls = 0;
    let pollCalls = 0;
    let atPoll: ReturnType<typeof onlyJob> | null = null;
    await runLifecycle(db, makeLifecycleAdapter({
      submit: async () => {
        submitCalls += 1;
        return { providerJobId: "remote_001", rawResponseJson: { request_id: "submit_001" } };
      },
      poll: async () => {
        pollCalls += 1;
        atPoll = structuredClone(onlyJob(db));
        return { status: "running", rawResponseJson: null };
      },
    }));
    expect(submitCalls).toBe(1);
    expect(pollCalls).toBe(1);
    expect(atPoll).toMatchObject({
      status: "submitted", providerJobId: "remote_001",
      rawResponseJson: { request_id: "submit_001" }, submittedAt: expect.any(Date),
      completedAt: null, lastPolledAt: expect.any(Date),
    });
    expect(onlyJob(db).status).toBe("running");
  });

  it.each(["running", "completed", "failed"] as const)("poll %s 保存状态、响应和轮询时间", async status => {
    const db = createDbClient();
    const result = await runLifecycle(db, makeLifecycleAdapter({
      poll: async () => ({ status, rawResponseJson: { request_id: "poll_001", state: status },
        ...(status === "failed" ? { errorCode: "remote_rejected", errorMessage: "供应商拒绝" } : {}) }),
    }));
    expect(onlyJob(db)).toMatchObject({
      status, providerJobId: "remote_001", rawResponseJson: { request_id: "poll_001", state: status },
      submittedAt: expect.any(Date), lastPolledAt: expect.any(Date),
      completedAt: status === "running" ? null : expect.any(Date),
      errorCode: status === "failed" ? "remote_rejected" : null,
      errorMessage: status === "failed" ? "供应商拒绝" : null,
    });
    expect(result.manifest.executions[0]?.status).toBe(status);
  });

  it.each(["running", "completed", "failed"] as const)("poll %s 的空响应保留提交响应", async status => {
    const db = createDbClient();
    await runLifecycle(db, makeLifecycleAdapter({ poll: async () => ({ status, rawResponseJson: null }) }));
    expect(onlyJob(db)).toMatchObject({ status, rawResponseJson: { request_id: "submit_001" } });
  });

  it.each(["submit", "poll"] as const)("%s 异常只终结非终态 job，保留已知响应", async stage => {
    const db = createDbClient();
    const result = await runLifecycle(db, makeLifecycleAdapter({
      [stage]: async () => { throw new Error(`${stage} unavailable`); },
    }));
    expect(result.manifest.executions[0]?.status).toBe("failed");
    expect(onlyJob(db)).toMatchObject({
      status: "failed", errorCode: "adapter_pipeline_error", errorMessage: `${stage} unavailable`,
      completedAt: expect.any(Date), lastPolledAt: stage === "poll" ? expect.any(Date) : null,
      providerJobId: stage === "poll" ? "remote_001" : null,
      rawResponseJson: stage === "poll" ? { request_id: "submit_001" } : null,
    });
  });

  it("prepare 异常不创建 provider job", async () => {
    const db = createDbClient();
    const result = await runLifecycle(db, makeLifecycleAdapter({
      prepare: async () => { throw new Error("prepare unavailable"); },
    }));
    expect(result.manifest.executions[0]?.status).toBe("failed");
    expect(db.assetProviderJobRecords.size).toBe(0);
  });

  it.each(["download", "normalizeResult"] as const)("远端 completed 后 %s 失败不覆盖远端终态", async stage => {
    const db = createDbClient();
    const result = await runLifecycle(db, makeLifecycleAdapter({
      [stage]: async () => { throw new Error(`${stage} unavailable`); },
    }));
    expect(result.manifest.executions[0]?.status).toBe("failed");
    expect(onlyJob(db)).toMatchObject({
      status: "completed", providerJobId: "remote_001", rawResponseJson: { request_id: "poll_001" },
      completedAt: expect.any(Date), errorCode: null, errorMessage: null,
    });
  });

  it.each(["prepare", "partial", "submitted", "completed"] as const)("%s 时来源失效保留已知状态并传播原异常与既有记账", async stage => {
    const db = createDbClient();
    db.generationRuns.set("assets_run_001", { id: "assets_run_001", projectId: "p1", runConfigurationSnapshotId: "snapshot" } as never);
    db.runConfigurationSnapshots.set("snapshot", { id: "snapshot", projectId: "p1", resolvedConfigurationJson: {}, pricingVersionSetJson: [] } as never);
    const error = new NarrationSourceError("narration_assets_source_stale");
    let stale = false;
    let downloads = 0;
    const adapter = makeLifecycleAdapter({
      billing: { capability: "image.generate", providerKey: "dashscope", modelId: "test-model" },
      prepare: async () => {
        if (stage === "prepare") throw error;
        return { providerJobId: null, rawRequestJson: {} };
      },
      submit: async ctx => {
        ctx.onDispatch?.();
        if (stage === "partial") throw error;
        if (stage === "submitted") stale = true;
        return { providerJobId: "remote_001", rawResponseJson: { request_id: "submit_001" } };
      },
      poll: async () => { stale = true; return { status: "completed", rawResponseJson: { request_id: "poll_001" } }; },
      download: async () => { downloads += 1; return []; },
    });
    await expect(runLifecycle(db, adapter, async () => { if (stale) throw error; })).rejects.toBe(error);
    expect(downloads).toBe(0);
    expect(db.usageCostRecords.size).toBe(stage === "prepare" ? 0 : 1);
    if (stage === "prepare") { expect(db.assetProviderJobRecords.size).toBe(0); return; }
    expect(onlyJob(db)).toMatchObject({
      status: stage === "partial" ? "prepared" : stage,
      providerJobId: stage === "partial" ? null : "remote_001",
      rawResponseJson: stage === "partial" ? null : { request_id: stage === "submitted" ? "submit_001" : "poll_001" },
      errorCode: null, errorMessage: null,
      lastPolledAt: stage === "completed" ? expect.any(Date) : null,
    });
    expect([...db.usageCostRecords.values()][0]).toMatchObject({
      status: "submitted", assetProviderJobRecordId: onlyJob(db).id,
      providerRequestKey: "assets:assets_run_001:img_001", attemptIndex: 0,
    });
  });

  it.each(["submitted", "completed"] as const)("%s 持久化失败不能返回成功或继续外部生命周期", async failedStatus => {
    const db = createDbClient();
    let polls = 0;
    let downloads = 0;
    // 只在写入边界注入故障；引擎与 repository 仍执行真实代码。
    db.thirdAggregateWriter = { saveProviderJob: async record => {
      if (record.status === failedStatus) throw new Error("provider_job_storage_unavailable");
      return record;
    } } as NonNullable<typeof db.thirdAggregateWriter>;
    const result = await runLifecycle(db, makeLifecycleAdapter({
      poll: async () => { polls += 1; return { status: "completed", rawResponseJson: { request_id: "poll_001" } }; },
      download: async () => { downloads += 1; return []; },
    }));
    expect(result.manifest.executions[0]?.status).toBe("failed");
    expect(polls).toBe(failedStatus === "submitted" ? 0 : 1);
    expect(downloads).toBe(0);
    expect(result.manifest.executions[0]?.notes.join(" ")).toContain("provider_job_storage_unavailable");
    if (failedStatus === "submitted") {
      expect(onlyJob(db)).toMatchObject({ status: "failed", providerJobId: "remote_001", rawResponseJson: { request_id: "submit_001" } });
    } else {
      expect(onlyJob(db)).toMatchObject({ status: "submitted", providerJobId: "remote_001", rawResponseJson: { request_id: "submit_001" } });
    }
  });
});

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
