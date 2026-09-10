import { describe, expect, it } from "vitest";

import { createDbClient } from "../../../backend/src/db/client.js";
import { executeAssetManifest } from "../../../backend/src/modules/assets/assets-execution-engine.js";
import { createAssetProviderRegistry } from "../../../backend/src/modules/assets/assets-provider-registry.js";
import { acceptSegmentFallback } from "../../../backend/src/modules/assets/assets-run.service.js";
import { validateAssetsManifest } from "../../../backend/src/modules/assets/assets-local-validator.js";
import { saveAssetManifestRecord } from "../../../backend/src/modules/assets/asset-manifest-record.repository.js";
import { createLegacyProject as createProject } from "../projects/legacy-project.fixture.js";
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
        execution_id: "exec_img_001",
        task_id: "img_001",
        task_type: "image_still",
        status: "completed",
        origin: "provider",
        started_at: "2026-05-16T00:00:00.000Z",
        completed_at: "2026-05-16T00:00:00.000Z",
        provider_id: "fake_image",
        attempts: 1,
        output_artifact_ids: ["artifact_img_001"],
        notes: [],
      },
      {
        execution_id: "exec_motion_001",
        task_id: "motion_001",
        task_type: "render_motion_cue",
        status: "completed",
        origin: "local",
        started_at: "2026-05-16T00:00:00.000Z",
        completed_at: "2026-05-16T00:00:00.000Z",
        provider_id: null,
        attempts: 0,
        output_artifact_ids: ["artifact_motion_001"],
        notes: [],
      },
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
        task_id: "img_001",
        order: 0,
        task_type: "image_still",
        source_segment_id: "sb_001",
        source_excerpt: "画面输入",
        production_intent: "生成锚点图",
        recommended_mode: "auto",
        provider_hint: "fake_image",
        prompt_draft: "历史画面",
        parameters: { image_role: "anchor" },
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
      {
        task_id: "motion_001",
        order: 1,
        task_type: "render_motion_cue",
        source_segment_id: "sb_001",
        source_excerpt: "运镜",
        production_intent: "本地运镜",
        recommended_mode: "auto",
        provider_hint: null,
        prompt_draft: null,
        parameters: { recipe_type: "push_in", source_image_task_id: "img_001" },
        manual_upload_policy: {
          allowed: false,
          required: false,
          accepted_file_types: [],
          acceptance_notes: [],
        },
        risk_notes: [],
        cost_tier: "free",
        initial_status: "planned",
      },
      {
        task_id: "video_001",
        order: 2,
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
    db.assetPlanRecords.set("asset_plan_001", {
      id: "asset_plan_001",
      projectId: project.id,
      topicPackageId: "topic_001",
      scriptRecordId: "script_001",
      storyboardRecordId: "storyboard_001",
      planJson: makeVideoAssetPlan(),
      validationResultJson: { stage: "asset_planning_local_validation", decision: "pass" },
      executionStateJson: {},
      graphTraceSummaryJson: null,
      runtimeDiagnosticsJson: null,
      createdAt: new Date(),
    });
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
    const response = await acceptSegmentFallback({
      db,
      project,
      runId: "assets_run_001",
      segmentId: "sb_001",
      expectedRunId: "assets_run_001",
      expectedVersion: "1",
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
    // 可审计事件写入正式 append-only run event 通道
    const events = db.generationRunEvents.get("assets_run_001") ?? [];
    expect(events).toContainEqual(
      expect.objectContaining({
        eventType: "fallback_accepted",
        segmentId: "sb_001",
      }),
    );
  });

  it("rejects fallback acceptance when the expected run id does not match the manifest run", async () => {
    const { db, project } = await makeBlockedManifestRecord();
    const response = await acceptSegmentFallback({
      db,
      project,
      runId: "assets_run_001",
      segmentId: "sb_001",
      expectedRunId: "assets_run_stale",
      expectedVersion: "1",
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
    const response = await acceptSegmentFallback({
      db,
      project,
      runId: "assets_run_001",
      segmentId: "sb_001",
      expectedRunId: "assets_run_001",
      expectedVersion: "1",
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
    const response = await acceptSegmentFallback({
      db,
      project,
      runId: "assets_run_001",
      segmentId: "sb_001",
      expectedRunId: "assets_run_001",
      expectedVersion: "1",
    });
    expect(response.statusCode).toBe(409);
    expect(response.body).toMatchObject({ error: "segment_fallback_incomplete" });
  });

  it("rejects fallback acceptance when the manifest version does not match (CAS)", async () => {
    const { db, project } = await makeBlockedManifestRecord();
    const response = await acceptSegmentFallback({
      db,
      project,
      runId: "assets_run_001",
      segmentId: "sb_001",
      expectedRunId: "assets_run_001",
      expectedVersion: "999",
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
    const response = await acceptSegmentFallback({
      db,
      project,
      runId: "assets_run_001",
      segmentId: "sb_001",
      expectedRunId: "assets_run_001",
      expectedVersion: "1",
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

    expect(manifest.executions.find((e) => e.task_type === "video_clip")!.status).toBe("failed");
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
    expect(manifest.executions.find((e) => e.task_type === "video_clip")!.status).toBe("skipped_with_fallback");
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
    expect(executed.executions.find((e) => e.task_type === "video_clip")!.status).toBe("failed");
    expect(executed.executions.find((e) => e.task_type === "video_clip")!.notes.join("\n")).toContain("no video adapter");
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
    expect(auto.manifest.executions.find((e) => e.task_type === "video_clip")!.status).toBe("skipped_with_fallback");
  });

  it("does not activate auto fallback when the route_auto_downgraded event cannot persist", async () => {
    const db = createDbClient();
    // mock writer：事件持久化失败（数据库不可用）
    db.thirdAggregateWriter = {
      appendGenerationRunEvent: async () => {
        throw new Error("db-down");
      },
    } as never;
    const manifest = makeVideoManifest({ strategy: "prefer_api_video" });
    const snapshot = structuredClone(manifest);

    let thrown: unknown;
    try {
      await executeAssetManifest({
        db,
        assetManifestRecordId: "manifest_001",
        assetRunId: "assets_run_001",
        manifest,
        registry: createAssetProviderRegistry([makeFailingVideoAdapter()]),
        assetPlan: makeVideoAssetPlan(),
        projectStorageRootDir: "unused",
      });
    } catch (error) {
      thrown = error;
    }
    // 事件持久化失败 → 执行失败，自动降级不得激活
    expect(thrown).toBeDefined();
    const route = manifest.segment_routes[0]!;
    expect(route.visual_route_type).toBe("video_clip");
    expect(route.readiness).toBe("blocked");
    expect(route.fallback_decision).toBe("none");
    expect(route.route_events).toEqual([]);
    // 内存事件通道未发布（数据库成功前不发布）
    expect(db.generationRunEvents.size).toBe(0);
    // 其余 manifest 内容未被篡改
    expect(manifest.segment_routes[0]!.segment_id).toBe(snapshot.segment_routes[0]!.segment_id);
  });

  it("skips video execution when the segment route is missing", async () => {
    const { db, result } = runEngine(
      makeVideoManifest({ strategy: "all_api_video" }),
    );
    // 删除段 route：无法确认策略时保守跳过，不寻找视频 adapter
    const manifest = (await result).manifest;
    manifest.segment_routes = [];
    const videoExec = manifest.executions.find((e) => e.task_type === "video_clip")!;
    videoExec.status = "planned";
    videoExec.completed_at = null;
    videoExec.provider_id = null;
    videoExec.notes = [];
    const second = await executeAssetManifest({
      db,
      assetManifestRecordId: "manifest_002",
      assetRunId: "assets_run_002",
      manifest,
      registry: createAssetProviderRegistry([makeFailingVideoAdapter()]),
      assetPlan: makeVideoAssetPlan(),
      projectStorageRootDir: "unused",
    });
    expect(second.manifest.executions.find((e) => e.task_type === "video_clip")!.status).toBe("skipped_with_fallback");
    expect(second.manifest.executions.find((e) => e.task_type === "video_clip")!.notes.join("\n")).toContain("route 缺失");
  });

  it("never creates a video provider job under all_remotion", async () => {
    const { db, result } = runEngine(
      makeVideoManifest({ strategy: "all_remotion" }),
    );
    const manifest = (await result).manifest;

    expect(manifest.executions.find((e) => e.task_type === "video_clip")!.status).toBe("skipped_with_fallback");
    expect(manifest.executions.find((e) => e.task_type === "video_clip")!.provider_id).toBeNull();
    expect(manifest.executions.find((e) => e.task_type === "video_clip")!.attempts).toBe(0);
    expect([...db.assetProviderJobRecords.values()].some(
      (job) => job.taskId === "video_001",
    )).toBe(false);
  });
});

describe("successful api video route validation", () => {
  it("accepts a successful video_clip route: primary from video producer, fallback from image producer", async () => {
    // 成功 API 视频：route video_clip、primary=video artifact、fallback=image artifact
    const db = createDbClient();
    const project = await createProject(db, { name: "Video Success" });
    const manifest = makeVideoManifest({ strategy: "prefer_api_video" });
    manifest.segment_routes[0]!.visual_route_type = "video_clip";
    manifest.segment_routes[0]!.primary_visual_artifact_id = "artifact_video_001";
    manifest.segment_routes[0]!.fallback_visual_artifact_id = "artifact_img_001";
    manifest.segment_routes[0]!.readiness = "ready";
    manifest.artifacts.push({
      artifact_id: "artifact_video_001",
      artifact_type: "video",
      origin: "provider",
      file_uri: "generated://video.mp4",
      created_at: "2026-05-16T00:00:00.000Z",
      metadata: { duration_sec: 5, width: 1080, height: 1920, fps: 30 },
    });
    const videoExecution = manifest.executions.find(
      (e) => e.task_id === "video_001",
    )!;
    videoExecution.status = "completed";
    videoExecution.started_at = "2026-05-16T00:00:00.000Z";
    videoExecution.completed_at = "2026-05-16T00:00:00.000Z";
    videoExecution.provider_id = "fake_video";
    videoExecution.attempts = 1;
    videoExecution.output_artifact_ids = ["artifact_video_001"];
    db.assetPlanRecords.set("asset_plan_success", {
      id: "asset_plan_success",
      projectId: project.id,
      topicPackageId: "topic_001",
      scriptRecordId: "script_001",
      storyboardRecordId: "storyboard_001",
      planJson: makeVideoAssetPlan(),
      validationResultJson: { stage: "asset_planning_local_validation", decision: "pass" },
      executionStateJson: {},
      graphTraceSummaryJson: null,
      runtimeDiagnosticsJson: null,
      createdAt: new Date(),
    });

    const validation = await validateAssetsManifest({
      assetPlanRecordId: "asset_plan_success",
      storyboardRecordId: "storyboard_001",
      scriptRecordId: "script_001",
      topicPackageId: "topic_001",
      assetPlan: makeVideoAssetPlan(),
      manifest,
      projectStorageRootDir: undefined,
    });
    // C1 回归保护：成功 API 视频不得产生 producer mismatch 或 execution incomplete
    expect(validation.errors).not.toContain("assets_segment_visual_producer_mismatch");
    expect(validation.errors).not.toContain("assets_execution_incomplete");
  });

  it("fails a successful video_clip route whose static fallback points to another segment", async () => {
    // 成功 API 视频的 primary 来自本段 video，但 fallback 引用跨段 image → 硬错误
    const db = createDbClient();
    const project = await createProject(db, { name: "Video Cross Fallback" });
    const manifest = makeVideoManifest({ strategy: "prefer_api_video" });
    manifest.segment_routes[0]!.visual_route_type = "video_clip";
    manifest.segment_routes[0]!.primary_visual_artifact_id = "artifact_video_001";
    manifest.segment_routes[0]!.fallback_visual_artifact_id = "artifact_img_cross";
    manifest.segment_routes[0]!.readiness = "ready";
    manifest.artifacts.push({
      artifact_id: "artifact_video_001",
      artifact_type: "video",
      origin: "provider",
      file_uri: "generated://video.mp4",
      created_at: "2026-05-16T00:00:00.000Z",
      metadata: { duration_sec: 5, width: 1080, height: 1920, fps: 30 },
    });
    manifest.artifacts.push({
      artifact_id: "artifact_img_cross",
      artifact_type: "image",
      origin: "provider",
      file_uri: "generated://cross.png",
      created_at: "2026-05-16T00:00:00.000Z",
      metadata: { width: 1080, height: 1920 },
    });
    const videoExecution = manifest.executions.find((e) => e.task_id === "video_001")!;
    videoExecution.status = "completed";
    videoExecution.completed_at = "2026-05-16T00:00:00.000Z";
    videoExecution.provider_id = "fake_video";
    videoExecution.attempts = 1;
    videoExecution.output_artifact_ids = ["artifact_video_001"];
    // 跨段 image 由另一个段的 producer 产出（本段 image producer 只有 artifact_img_001）
    const plan = makeVideoAssetPlan();
    db.assetPlanRecords.set("asset_plan_cross", {
      id: "asset_plan_cross",
      projectId: project.id,
      topicPackageId: "topic_001",
      scriptRecordId: "script_001",
      storyboardRecordId: "storyboard_001",
      planJson: plan,
      validationResultJson: { stage: "asset_planning_local_validation", decision: "pass" },
      executionStateJson: {},
      graphTraceSummaryJson: null,
      runtimeDiagnosticsJson: null,
      createdAt: new Date(),
    });

    const validation = await validateAssetsManifest({
      assetPlanRecordId: "asset_plan_cross",
      storyboardRecordId: "storyboard_001",
      scriptRecordId: "script_001",
      topicPackageId: "topic_001",
      assetPlan: plan,
      manifest,
      projectStorageRootDir: undefined,
    });
    // 跨段 fallback 必须失败（同段 image producer 只产出 artifact_img_001）
    expect(validation.errors).toContain("assets_segment_visual_producer_mismatch");
  });
});
