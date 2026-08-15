import { describe, expect, it } from "vitest";

import { createDbClient } from "../../../backend/src/db/client.js";
import { executeAssetManifest } from "../../../backend/src/modules/assets/assets-execution-engine.js";
import { createAssetProviderRegistry } from "../../../backend/src/modules/assets/assets-provider-registry.js";
import {
  acceptSegmentFallback,
  manifestFallbackVersion,
} from "../../../backend/src/modules/assets/assets-run.service.js";
import { saveAssetManifestRecord } from "../../../backend/src/modules/assets/asset-manifest-record.repository.js";
import { createProject } from "../../../backend/src/modules/projects/project.repository.js";
import type { AssetProviderAdapter } from "../../../backend/src/modules/assets/assets-provider-adapter.js";
import type {
  AssetManifest,
  AssetPlan,
  SegmentAssetRoute,
} from "../../../shared/src/index.js";

/**
 * S2-2A 任务 6：视频策略严格模式状态机。
 *
 * - all_api_video：API 失败进入 blocked_waiting_user，不自动改 manifest route。
 * - prefer_api_video / prefer_remotion：API 失败自动降级 image_with_motion，
 *   记录 automatic_fallback 事件；缺同段 anchor 或 Remotion cue 不能伪装 ready。
 * - all_remotion：永不创建视频 provider job。
 * - accept-fallback：用户显式接受后激活 image-with-motion，写 fallback_accepted 事件。
 */

type VideoStrategy = "all_api_video" | "prefer_api_video" | "prefer_remotion" | "all_remotion";

function makeVideoManifest(input: {
  strategy: VideoStrategy;
  fallbackReady?: boolean;
  motionReady?: boolean;
}): AssetManifest {
  const { strategy, fallbackReady = true, motionReady = true } = input;
  const route: SegmentAssetRoute = {
    segment_id: "sb_001",
    tts_artifact_id: null,
    subtitle_artifact_id: null,
    primary_visual_artifact_id: fallbackReady ? "artifact_img_001" : null,
    visual_route_type: "video_clip",
    motion_artifact_id: motionReady ? "artifact_motion_001" : null,
    fallback_visual_artifact_id: fallbackReady ? "artifact_img_001" : null,
    sfx_artifact_ids: [],
    bgm_placement_ids: [],
    readiness: "blocked",
    notes: [],
  };
  return {
    manifest_version: "asset_manifest_v1",
    source_asset_plan_id: "asset_plan_001",
    source_storyboard_record_id: "storyboard_001",
    source_script_record_id: "script_001",
    execution_options: {
      execution_mode: "auto_available",
      voice_profile_id: "voice_001",
      enabled_provider_types: ["video"],
      allow_manual_placeholders: false,
    },
    executions: [
      {
        execution_id: "exec_video_001",
        task_id: "video_001",
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
    artifacts: [
      {
        artifact_id: "artifact_img_001",
        artifact_type: "image",
        origin: "provider",
        file_uri: "generated://image.png",
        created_at: "2026-05-16T00:00:00.000Z",
        metadata: { width: 1080, height: 1920 },
      },
      {
        artifact_id: "artifact_motion_001",
        artifact_type: "motion_recipe",
        origin: "inline",
        file_uri: "inline://motion-recipe/001",
        created_at: "2026-05-16T00:00:00.000Z",
        metadata: { recipe_type: "push_in" },
      },
    ],
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
        ...route,
        // S2-2A 任务 6：策略与降级决策持久化在 manifest route 上
        video_strategy: strategy,
        fallback_decision: "none",
        route_events: [],
      },
    ],
    readiness: "blocked",
    notes: [],
  };
}

function makeVideoAssetPlan(): AssetPlan {
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
        task_id: "video_001",
        order: 0,
        task_type: "video_clip",
        source_segment_id: "sb_001",
        source_excerpt: "连续动作",
        production_intent: "生成视频",
        recommended_mode: "auto",
        provider_hint: "fake_video",
        prompt_draft: "动作画面",
        parameters: { static_fallback_task_id: "img_001" },
        manual_upload_policy: {
          allowed: true,
          required: false,
          accepted_file_types: ["video/mp4"],
          acceptance_notes: [],
        },
        risk_notes: [],
        cost_tier: "high",
        initial_status: "planned",
      },
    ],
    dependencies: [],
    cost_summary: {
      total_tasks: 1,
      by_type: { video_clip: 1 },
      by_cost_tier: { high: 1 },
      estimated_provider_calls: 1,
      notes: [],
    },
    global_production_notes: [],
  };
}

function makeFailingVideoAdapter(): AssetProviderAdapter {
  return {
    providerName: "fake_video",
    providerType: "video",
    canHandle: ({ taskType }) => taskType === "video_clip",
    prepare: async () => ({ providerJobId: "job_001", rawRequestJson: {} }),
    submit: async () => ({ providerJobId: "job_001", rawResponseJson: {} }),
    poll: async () => ({
      status: "failed",
      errorCode: "video_provider_error",
      errorMessage: "模拟视频生成失败",
      rawResponseJson: {},
    }),
    download: async () => [],
    normalizeResult: async () => ({ artifacts: [], notes: [] }),
    cancel: async () => undefined,
  };
}

function runEngine(manifest: AssetManifest) {
  const db = createDbClient();
  return {
    db,
    result: executeAssetManifest({
      db,
      assetManifestRecordId: "manifest_001",
      assetRunId: "assets_run_001",
      manifest,
      registry: createAssetProviderRegistry([makeFailingVideoAdapter()]),
      assetPlan: makeVideoAssetPlan(),
      projectStorageRootDir: "unused",
    }),
  };
}

describe("accept-segment-fallback", () => {
  async function makeBlockedManifestRecord() {
    const db = createDbClient();
    const project = await createProject(db, { name: "Video Strategy Test" });
    const manifest = makeVideoManifest({ strategy: "all_api_video" });
    manifest.segment_routes[0]!.readiness = "blocked_waiting_user";
    const record = await saveAssetManifestRecord(db, {
      projectId: project.id,
      topicPackageId: "topic_001",
      scriptRecordId: "script_001",
      storyboardRecordId: "storyboard_001",
      assetPlanRecordId: "asset_plan_001",
      manifestJson: manifest,
      validationResultJson: { stage: "assets_local_validation", decision: "blocked" },
      executionStateJson: { generating: false, run_id: "assets_run_001", activated: true },
    });
    project.activeAssetManifestRecordId = record.id;
    return { db, project, manifest };
  }

  it("activates image-with-motion and records fallback_accepted for a blocked segment", async () => {
    const { db, project, manifest } = await makeBlockedManifestRecord();
    const version = manifestFallbackVersion(manifest);
    const response = await acceptSegmentFallback({
      db,
      project,
      runId: "assets_run_001",
      segmentId: "sb_001",
      expectedRunId: "assets_run_001",
      expectedVersion: version,
    });

    expect(response.statusCode).toBe(200);
    const route = (response.body as { manifest: AssetManifest }).manifest.segment_routes[0]!;
    expect(route.visual_route_type).toBe("image_with_motion");
    expect(route.readiness).toBe("ready");
    expect(route.fallback_decision).toBe("user_accepted");
    expect(route.route_events).toHaveLength(1);
    expect(route.route_events[0]).toMatchObject({
      event_type: "fallback_accepted",
    });
    // 响应带新版本（CAS）
    expect(response.body).toMatchObject({ version: expect.any(String) });
    // 持久化到 active manifest 记录（原运行快照不变，这里验证的是当前可变执行视图）
    const saved = db.assetManifestRecords.get(project.activeAssetManifestRecordId!)!;
    const savedRoute = (saved.manifestJson as { segment_routes: SegmentAssetRoute[] }).segment_routes[0]!;
    expect(savedRoute.fallback_decision).toBe("user_accepted");
    expect(manifest.segment_routes[0]!.fallback_decision).toBe("none");
    // 可审计事件持久化在 executionState
    expect(saved.executionStateJson?.events).toContainEqual(
      expect.objectContaining({
        event_type: "fallback_accepted",
        segment_id: "sb_001",
        run_id: "assets_run_001",
      }),
    );
  });

  it("rejects fallback acceptance when the expected run id does not match the manifest run", async () => {
    const { db, project, manifest } = await makeBlockedManifestRecord();
    const response = await acceptSegmentFallback({
      db,
      project,
      runId: "assets_run_001",
      segmentId: "sb_001",
      expectedRunId: "assets_run_stale",
      expectedVersion: manifestFallbackVersion(manifest),
    });
    expect(response.statusCode).toBe(409);
    expect(response.body).toMatchObject({ error: "assets_fallback_run_mismatch" });
  });

  it("rejects fallback acceptance when the segment is not awaiting a decision", async () => {
    const { db, project } = await makeBlockedManifestRecord();
    db.assetManifestRecords.get(project.activeAssetManifestRecordId!)!.manifestJson = {
      ...(db.assetManifestRecords.get(project.activeAssetManifestRecordId!)!.manifestJson as Record<string, unknown>),
      segment_routes: [{
        ...makeVideoManifest({ strategy: "all_api_video" }).segment_routes[0]!,
        readiness: "blocked",
      }],
    };
    const manifest = db.assetManifestRecords.get(project.activeAssetManifestRecordId!)!.manifestJson as AssetManifest;
    const response = await acceptSegmentFallback({
      db,
      project,
      runId: "assets_run_001",
      segmentId: "sb_001",
      expectedRunId: "assets_run_001",
      expectedVersion: manifestFallbackVersion(manifest),
    });
    expect(response.statusCode).toBe(409);
    expect(response.body).toMatchObject({ error: "segment_fallback_not_awaiting_decision" });
  });

  it("rejects fallback acceptance when anchor or motion cue is missing", async () => {
    const { db, project } = await makeBlockedManifestRecord();
    db.assetManifestRecords.get(project.activeAssetManifestRecordId!)!.manifestJson = {
      ...(db.assetManifestRecords.get(project.activeAssetManifestRecordId!)!.manifestJson as Record<string, unknown>),
      segment_routes: [{
        ...makeVideoManifest({ strategy: "all_api_video", motionReady: false }).segment_routes[0]!,
        readiness: "blocked_waiting_user",
      }],
    };
    const manifest = db.assetManifestRecords.get(project.activeAssetManifestRecordId!)!.manifestJson as AssetManifest;
    const response = await acceptSegmentFallback({
      db,
      project,
      runId: "assets_run_001",
      segmentId: "sb_001",
      expectedRunId: "assets_run_001",
      expectedVersion: manifestFallbackVersion(manifest),
    });
    expect(response.statusCode).toBe(409);
    expect(response.body).toMatchObject({ error: "segment_fallback_incomplete" });
  });

  it("rejects fallback acceptance when the manifest version does not match (CAS)", async () => {
    const { db, project, manifest } = await makeBlockedManifestRecord();
    const response = await acceptSegmentFallback({
      db,
      project,
      runId: "assets_run_001",
      segmentId: "sb_001",
      expectedRunId: "assets_run_001",
      expectedVersion: "stale-version",
    });
    expect(response.statusCode).toBe(409);
    expect(response.body).toMatchObject({ error: "assets_fallback_version_mismatch" });
    // 拒绝后记录未被修改
    const saved = db.assetManifestRecords.get(project.activeAssetManifestRecordId!)!;
    expect((saved.manifestJson as { segment_routes: SegmentAssetRoute[] }).segment_routes[0]!.fallback_decision).toBe("none");
  });

  it("rejects fallback acceptance when the anchor artifact does not exist", async () => {
    const { db, project } = await makeBlockedManifestRecord();
    const record = db.assetManifestRecords.get(project.activeAssetManifestRecordId!)!;
    record.manifestJson = {
      ...(record.manifestJson as Record<string, unknown>),
      artifacts: (record.manifestJson as { artifacts: Array<{ artifact_id: string }> }).artifacts.filter(
        (item) => item.artifact_id !== "artifact_img_001",
      ),
    };
    const manifest = record.manifestJson as AssetManifest;
    const response = await acceptSegmentFallback({
      db,
      project,
      runId: "assets_run_001",
      segmentId: "sb_001",
      expectedRunId: "assets_run_001",
      expectedVersion: manifestFallbackVersion(manifest),
    });
    expect(response.statusCode).toBe(409);
    expect(response.body).toMatchObject({ error: "segment_fallback_incomplete" });
  });
});

describe("video strategy execution state machine", () => {
  it("blocks all_api_video failures in blocked_waiting_user without changing the manifest route", async () => {
    const { db, result } = runEngine(
      makeVideoManifest({ strategy: "all_api_video" }),
    );
    const manifest = (await result).manifest;

    expect(manifest.executions[0]!.status).toBe("failed");
    const route = manifest.segment_routes[0]!;
    expect(route.visual_route_type).toBe("video_clip");
    expect(route.readiness).toBe("blocked_waiting_user");
    expect(route.fallback_decision).toBe("none");
    expect(route.route_events).toEqual([]);
    // fallback artifact 保留但未激活
    expect(route.primary_visual_artifact_id).toBe("artifact_img_001");
  });

  it("auto-downgrades prefer_api_video failures to image_with_motion with automatic_fallback event", async () => {
    const { db, result } = runEngine(
      makeVideoManifest({ strategy: "prefer_api_video" }),
    );
    const manifest = (await result).manifest;
    const route = manifest.segment_routes[0]!;

    // 自动降级成功 → execution 进入 validator 认可的终态，允许继续 Compose
    expect(manifest.executions[0]!.status).toBe("skipped_with_fallback");
    expect(route.visual_route_type).toBe("image_with_motion");
    expect(route.readiness).toBe("ready");
    expect(route.fallback_decision).toBe("automatic");
    expect(route.route_events).toHaveLength(1);
    expect(route.route_events[0]).toMatchObject({
      event_type: "automatic_fallback",
    });
    expect(route.notes.join("\n")).toContain("video_provider_error");
  });

  it("auto-downgrades prefer_remotion failures with automatic_fallback event", async () => {
    const { result } = runEngine(
      makeVideoManifest({ strategy: "prefer_remotion" }),
    );
    const manifest = (await result).manifest;
    const route = manifest.segment_routes[0]!;

    expect(route.visual_route_type).toBe("image_with_motion");
    expect(route.readiness).toBe("ready");
    expect(route.fallback_decision).toBe("automatic");
    expect(route.route_events[0]).toMatchObject({
      event_type: "automatic_fallback",
    });
  });

  it("never pretends readiness when the fallback anchor or Remotion cue is missing", async () => {
    const noAnchor = await runEngine(
      makeVideoManifest({ strategy: "prefer_api_video", fallbackReady: false }),
    ).result;
    expect(noAnchor.manifest.segment_routes[0]!.readiness).toBe("blocked");
    expect(noAnchor.manifest.segment_routes[0]!.visual_route_type).toBe("video_clip");
    expect(noAnchor.manifest.segment_routes[0]!.fallback_decision).toBe("none");
    expect(noAnchor.manifest.segment_routes[0]!.route_events).toEqual([]);

    const noMotion = await runEngine(
      makeVideoManifest({ strategy: "prefer_api_video", motionReady: false }),
    ).result;
    expect(noMotion.manifest.segment_routes[0]!.readiness).toBe("blocked");
    expect(noMotion.manifest.segment_routes[0]!.visual_route_type).toBe("video_clip");
    expect(noMotion.manifest.segment_routes[0]!.route_events).toEqual([]);
  });

  it("enters the strategy state machine when no video adapter exists", async () => {
    const db = createDbClient();
    const manifest = makeVideoManifest({ strategy: "all_api_video" });
    // registry 只有 image adapter，没有 video
    const registry = createAssetProviderRegistry([
      {
        providerName: "fake_image_only",
        providerType: "image",
        canHandle: ({ taskType }) => taskType === "image_still",
        prepare: async () => ({ providerJobId: null, rawRequestJson: {} }),
        submit: async () => ({ providerJobId: null, rawResponseJson: {} }),
        poll: async () => ({ status: "completed", rawResponseJson: {} }),
        download: async () => [],
        normalizeResult: async () => ({ artifacts: [], notes: [] }),
        cancel: async () => undefined,
      },
    ]);
    const result = await executeAssetManifest({
      db,
      assetManifestRecordId: "manifest_001",
      assetRunId: "assets_run_001",
      manifest,
      registry,
      assetPlan: makeVideoAssetPlan(),
      projectStorageRootDir: "unused",
    });
    const executed = result.manifest;
    expect(executed.executions[0]!.status).toBe("failed");
    expect(executed.executions[0]!.notes.join("\n")).toContain("no video adapter");
    expect(executed.segment_routes[0]!.readiness).toBe("blocked_waiting_user");

    const auto = await executeAssetManifest({
      db,
      assetManifestRecordId: "manifest_002",
      assetRunId: "assets_run_002",
      manifest: makeVideoManifest({ strategy: "prefer_api_video" }),
      registry,
      assetPlan: makeVideoAssetPlan(),
      projectStorageRootDir: "unused",
    });
    expect(auto.manifest.segment_routes[0]!.fallback_decision).toBe("automatic");
    expect(auto.manifest.executions[0]!.status).toBe("skipped_with_fallback");
  });

  it("skips video execution when the segment route is missing", async () => {
    const { db, result } = runEngine(
      makeVideoManifest({ strategy: "all_api_video" }),
    );
    // 删除段 route：无法确认策略时保守跳过，不寻找视频 adapter
    const manifest = (await result).manifest;
    manifest.segment_routes = [];
    manifest.executions[0]!.status = "planned";
    manifest.executions[0]!.completed_at = null;
    manifest.executions[0]!.provider_id = null;
    manifest.executions[0]!.notes = [];
    const second = await executeAssetManifest({
      db,
      assetManifestRecordId: "manifest_002",
      assetRunId: "assets_run_002",
      manifest,
      registry: createAssetProviderRegistry([makeFailingVideoAdapter()]),
      assetPlan: makeVideoAssetPlan(),
      projectStorageRootDir: "unused",
    });
    expect(second.manifest.executions[0]!.status).toBe("skipped_with_fallback");
    expect(second.manifest.executions[0]!.notes.join("\n")).toContain("route 缺失");
  });

  it("never creates a video provider job under all_remotion", async () => {
    const { db, result } = runEngine(
      makeVideoManifest({ strategy: "all_remotion" }),
    );
    const manifest = (await result).manifest;

    expect(manifest.executions[0]!.status).toBe("skipped_with_fallback");
    expect(manifest.executions[0]!.provider_id).toBeNull();
    expect(manifest.executions[0]!.attempts).toBe(0);
    expect([...db.assetProviderJobRecords.values()].some(
      (job) => job.taskId === "video_001",
    )).toBe(false);
  });
});
