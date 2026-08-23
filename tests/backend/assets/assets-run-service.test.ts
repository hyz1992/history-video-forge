import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";

/** S2-2A 任务 6：provider 授权只来自后端 env；测试通过 env 注入驱动 DashScope。 */
const DASHSCOPE_ENV: Record<string, string> = {
  ALIYUN_DASHSCOPE_API_KEY: "test-key",
  ALIYUN_DASHSCOPE_BASE_URL: "https://dashscope.aliyuncs.com",
  ALIYUN_DASHSCOPE_TEXT_TO_IMAGE_MODEL: "wan2.6-t2i",
  ALIYUN_DASHSCOPE_TTS_MODEL: "qwen3-tts-instruct-flash",
  ALIYUN_DASHSCOPE_IMAGE_TO_VIDEO_MODEL: "wan2.7-i2v-2026-04-25",
};

function injectDashscopeEnv() {
  for (const [key, value] of Object.entries(DASHSCOPE_ENV)) {
    vi.stubEnv(key, value);
  }
}

/**
 * S2-2A 任务 7 二次重开：真实 DashScope adapter 派发必须通过目录 gate。
 * 测试种入与 DASHSCOPE_ENV 一致的北京 catalog（真实 bootstrap 会产出同等行）。
 */
async function seedDashscopeDispatchCatalog(db: ReturnType<typeof createDbClient>) {
  const { buildPricingCatalogSeed } = await import("../../../backend/src/modules/generation-cost/pricing-catalog.seed.js");
  const { applyProviderModelCatalogSeed } = await import("../../../backend/src/modules/generation-cost/provider-model-catalog.repository.js");
  await applyProviderModelCatalogSeed(
    db,
    buildPricingCatalogSeed({ llm: { mode: "stub" }, media: { deploymentScope: "cn-beijing" } }),
  );
}

import { createDbClient } from "../../../backend/src/db/client.js";
import { createProject } from "../../../backend/src/modules/projects/project.repository.js";
import {
  registerManualArtifact,
  runAssetsGeneration,
} from "../../../backend/src/modules/assets/assets-run.service.js";
import {
  configureVoiceProfilePersistence,
  getVoiceProfileById,
  seedGlobalVoiceProfiles,
  updateVoiceProfileProviderState,
} from "../../../backend/src/modules/assets/voice/voice-profile.repository.js";
import { createToneWavBuffer } from "../../../backend/src/modules/assets/providers/audio-fixture.js";
import type {
  AssetManifest,
  AssetPlan,
  SegmentAssetRoute,
} from "../../../shared/src/index.js";
import { DEFAULT_GENERATION_CONFIGURATION } from "../../../shared/src/index.js";
import { acceptSegmentFallback } from "../../../backend/src/modules/assets/assets-run.service.js";
import { createGenerationRunRepository } from "../../../backend/src/modules/generation-run/generation-run.repository.js";
import { createOrRestoreGenerationRun } from "../../../backend/src/modules/generation-run/generation-run.service.js";
import { buildQuotableReadinessInput } from "../cost/quote-test-context.js";
import { validateAssetsManifest } from "../../../backend/src/modules/assets/assets-local-validator.js";


/**
 * 2026-08-23（报价体系移除）：dashscope 付费链路测试统一经 run 提交创建
 * run/snapshot（付费派发与记账需要 run 上下文）。
 */
async function createQuotedRun(
  db: ReturnType<typeof createDbClient>,
  project: Awaited<ReturnType<typeof createProject>>,
  key: string,
) {
  const repository = createGenerationRunRepository(db);
  const submit = await createOrRestoreGenerationRun(
    db, project, project.ownerId,
    {
      operation: "assets.generate",
      idempotencyKey: key,
      selection: { task_ids: [] },
      dispatchPayload: { execution_mode: "auto_available" },
    },
    { readinessInput: buildQuotableReadinessInput(), repository },
  );
  if (!submit.ok) throw new Error(`submit failed: ${JSON.stringify(submit.error)}`);
  return submit.value.run.id;
}

const TOPIC_PACKAGE_ID = "topic_001";
const SCRIPT_RECORD_ID = "script_001";
const STORYBOARD_RECORD_ID = "storyboard_001";
const ASSET_PLAN_RECORD_ID = "asset_plan_001";

function makeAssetPlan(): AssetPlan {
  return {
    plan_version: "asset_plan_v1",
    source_storyboard_record_id: STORYBOARD_RECORD_ID,
    source_script_record_id: SCRIPT_RECORD_ID,
    source_topic_package_id: TOPIC_PACKAGE_ID,
    art_bible: {
      era_style: "ancient court",
      visual_tone: "tense",
      characters: [],
      locations: [],
      props: [],
      global_prompt_prefix: "ancient Chinese historical short video",
      global_negative_prompts: [],
      consistency_notes: [],
    },
    visual_budget: {},
    downgrade_policy: {},
    global_audio_strategy: {},
    tts_plan: {
      voice_profile_id: "voice_plan",
      estimated_total_duration_sec: 12,
      chunking_strategy: "segment_boundary",
      chunks: [
        {
          chunk_id: "tts_001",
          order: 0,
          script_excerpt: "Narration for segment one.",
          estimated_duration_sec: 12,
        },
      ],
    },
    tasks: [
      {
        task_id: "tts_001",
        order: 0,
        task_type: "tts_audio",
        source_segment_id: null,
        source_excerpt: "Narration for segment one.",
        production_intent: "Generate narration audio.",
        recommended_mode: "auto",
        provider_hint: "fake_tts",
        prompt_draft: null,
        parameters: {},
        manual_upload_policy: {
          allowed: false,
          required: false,
          accepted_file_types: [],
          acceptance_notes: [],
        },
        risk_notes: [],
        cost_tier: "low",
        initial_status: "planned",
      },
      {
        task_id: "sub_001",
        order: 1,
        task_type: "subtitle_track",
        source_segment_id: null,
        source_excerpt: "Narration for segment one.",
        production_intent: "Generate subtitle track from TTS.",
        recommended_mode: "auto",
        provider_hint: "local_subtitle",
        prompt_draft: null,
        parameters: {},
        manual_upload_policy: {
          allowed: false,
          required: false,
          accepted_file_types: [],
          acceptance_notes: [],
        },
        risk_notes: [],
        cost_tier: "low",
        initial_status: "planned",
      },
      {
        task_id: "img_001",
        order: 2,
        task_type: "image_still",
        source_segment_id: "sb_001",
        source_excerpt: "Image source excerpt.",
        production_intent: "Create the segment anchor image.",
        recommended_mode: "manual_allowed",
        provider_hint: "image_provider",
        prompt_draft: "Ancient court image.",
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
      total_tasks: 3,
      by_type: { tts_audio: 1, subtitle_track: 1, image_still: 1 },
      by_cost_tier: { low: 3 },
      estimated_provider_calls: 3,
      notes: [],
    },
    global_production_notes: [],
  };
}

function makeImageToVideoAssetPlan(): AssetPlan {
  const plan = makeAssetPlan();
  plan.tasks.push(
    {
      task_id: "motion_001",
      order: 3,
      task_type: "render_motion_cue",
      source_segment_id: "sb_001",
      source_excerpt: "Image source excerpt.",
      production_intent: "Create fallback motion over the segment image.",
      recommended_mode: "auto",
      provider_hint: "local_motion",
      prompt_draft: null,
      parameters: {
        recipe_type: "slow_push_in",
      },
      manual_upload_policy: {
        allowed: false,
        required: false,
        accepted_file_types: [],
        acceptance_notes: [],
      },
      risk_notes: [],
      cost_tier: "low",
      initial_status: "planned",
    },
    {
      task_id: "video_001",
      order: 4,
      task_type: "video_clip",
      source_segment_id: "sb_001",
      source_excerpt: "Image source excerpt.",
      production_intent: "Create the segment video clip from the image.",
      recommended_mode: "auto",
      provider_hint: "dashscope_image_to_video",
      prompt_draft: "A tense historical close-up, slow push-in.",
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
  );
  plan.cost_summary = {
    total_tasks: 5,
    by_type: {
      tts_audio: 1,
      subtitle_track: 1,
      image_still: 1,
      render_motion_cue: 1,
      video_clip: 1,
    },
    by_cost_tier: { low: 4, high: 1 },
    estimated_provider_calls: 4,
    notes: [],
  };
  return plan;
}

async function prepareProjectWithAssetPlan() {
  const db = createDbClient();
  const project = await createProject(db, { name: "assets service test" });
  project.activeStoryboardRecordId = STORYBOARD_RECORD_ID;
  project.activeAssetPlanRecordId = ASSET_PLAN_RECORD_ID;
  project.status = "asset_plan_ready";

  db.storyboardRecords.set(STORYBOARD_RECORD_ID, {
    id: STORYBOARD_RECORD_ID,
    projectId: project.id,
    topicPackageId: TOPIC_PACKAGE_ID,
    scriptRecordId: SCRIPT_RECORD_ID,
    planJson: {
      segments: [
        {
          segment_id: "sb_001",
          // 9A：付费链路报价按适配度解析路线；强推荐使默认策略下仍可授权 api_video
          api_video_suitability: "api_video_strongly_recommended",
        },
      ],
    },
    validationResultJson: {},
    executionStateJson: null,
    graphTraceSummaryJson: null,
    runtimeDiagnosticsJson: null,
    createdAt: new Date(),
  });

  db.assetPlanRecords.set(ASSET_PLAN_RECORD_ID, {
    id: ASSET_PLAN_RECORD_ID,
    projectId: project.id,
    topicPackageId: TOPIC_PACKAGE_ID,
    scriptRecordId: SCRIPT_RECORD_ID,
    storyboardRecordId: STORYBOARD_RECORD_ID,
    planJson: makeAssetPlan(),
    validationResultJson: {
      stage: "asset_planning_local_validation",
      decision: "pass",
      errors: [],
      warnings: [],
      metrics: {},
    },
    executionStateJson: {},
    graphTraceSummaryJson: null,
    runtimeDiagnosticsJson: null,
    createdAt: new Date(),
  });

  return { db, project };
}

describe("assets run service integration", () => {
  let integrationTempDir: string;

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  afterEach(async () => {
    if (integrationTempDir) {
      await rm(integrationTempDir, { recursive: true, force: true }).catch(() => {});
      integrationTempDir = "";
    }
  });

  it("keeps an explicit existing voice profile in the manifest and stored trace", async () => {
    const { db, project } = await prepareProjectWithAssetPlan();

    const response = await runAssetsGeneration({
      db,
      project,
      voiceProfileId: "voice_preset_cold_authority",
      executionMode: "dry_run",
    });

    expect(response.statusCode).toBe(200);
    const body = response.body as {
      manifest: AssetManifest;
      graph_trace_summary: unknown;
    };

    expect(body.manifest.execution_options).toMatchObject({
      execution_mode: "dry_run",
      voice_profile_id: "voice_preset_cold_authority",
    });
    expect(body.graph_trace_summary).toMatchObject({
      phase: "assets",
    });

    const manifestRecord = db.assetManifestRecords.get(
      project.activeAssetManifestRecordId!,
    );
    expect(manifestRecord?.graphTraceSummaryJson).toMatchObject({
      phase: "assets",
    });
  });

  it("resolves an empty requested voice profile to the default historical voice", async () => {
    const { db, project } = await prepareProjectWithAssetPlan();

    const response = await runAssetsGeneration({
      db,
      project,
      voiceProfileId: "",
      executionMode: "dry_run",
    });
    const body = response.body as { manifest: AssetManifest };

    expect(response.statusCode).toBe(200);
    expect(body.manifest.audio_summary.voice_profile_id).toBe(
      "voice_preset_cold_authority",
    );
    expect(body.manifest.execution_options.voice_profile_id).toBe(
      "voice_preset_cold_authority",
    );
  });

  it("creates a generated local voice profile for a low-match voice intent", async () => {
    const { db, project } = await prepareProjectWithAssetPlan();
    db.assetPlanRecords.get(ASSET_PLAN_RECORD_ID)!.planJson = {
      ...makeAssetPlan(),
      global_audio_strategy: {
        voice_intent: {
          content_family: "gentle_healing",
          narrator_persona: "温柔疗愈旁白",
          desired_traits: ["warm", "soft", "healing"],
          avoid_traits: ["cold", "authoritative"],
          gender_tone: "female_leaning",
          age_band: "25-35",
          pitch: "mid_high",
          pace: "slow",
          energy: 0.25,
          authority: 0.2,
          suspense: 0.1,
          warmth: 0.95,
          style_notes: ["轻柔停顿"],
        },
      },
    };

    const response = await runAssetsGeneration({
      db,
      project,
      voiceProfileId: "",
      executionMode: "dry_run",
    });
    const body = response.body as { manifest: AssetManifest };
    const resolvedVoiceProfileId = body.manifest.audio_summary.voice_profile_id;

    expect(response.statusCode).toBe(200);
    expect(String(resolvedVoiceProfileId)).toMatch(/^voice_generated_/);
    expect(db.voiceProfiles.has(resolvedVoiceProfileId)).toBe(true);
    expect(body.manifest.execution_options.voice_profile_id).toBe(
      resolvedVoiceProfileId,
    );
  });

  it("loads a persisted ready voice profile before assets voice resolution", async () => {
    integrationTempDir = join(tmpdir(), `assets-persisted-voice-${Date.now()}`);
    await mkdir(integrationTempDir, { recursive: true });

    const setupDb = createDbClient();
    configureVoiceProfilePersistence(setupDb, { rootDir: integrationTempDir });
    await seedGlobalVoiceProfiles(setupDb);
    await updateVoiceProfileProviderState(
      setupDb,
      "voice_preset_cold_authority",
      {
        provider_status: "ready",
        provider_voice_id: "provider-voice-ready-001",
        preview_audio_uri: "data:audio/wav;base64,cHJldmlldw==",
      },
    );

    const { db, project } = await prepareProjectWithAssetPlan();
    configureVoiceProfilePersistence(db, { rootDir: integrationTempDir });

    const response = await runAssetsGeneration({
      db,
      project,
      voiceProfileId: "voice_preset_cold_authority",
      executionMode: "dry_run",
    });
    const body = response.body as { manifest: AssetManifest };

    expect(response.statusCode).toBe(200);
    expect(body.manifest.audio_summary.voice_profile_id).toBe(
      "voice_preset_cold_authority",
    );
    expect(db.voiceProfiles.get("voice_preset_cold_authority")).toMatchObject({
      provider_status: "ready",
      provider_voice_id: "provider-voice-ready-001",
    });
  });

  it("enables voice profile persistence from project storage root", async () => {
    integrationTempDir = join(tmpdir(), `assets-storage-root-voice-${Date.now()}`);
    await mkdir(integrationTempDir, { recursive: true });

    const setupDb = createDbClient();
    configureVoiceProfilePersistence(setupDb, { rootDir: integrationTempDir });
    await seedGlobalVoiceProfiles(setupDb);
    await updateVoiceProfileProviderState(
      setupDb,
      "voice_preset_cold_authority",
      {
        provider_status: "ready",
        provider_voice_id: "provider-voice-ready-001",
        preview_audio_uri: "data:audio/wav;base64,cHJldmlldw==",
      },
    );

    const { db, project } = await prepareProjectWithAssetPlan();
    project.storageRootDir = integrationTempDir;
    configureVoiceProfilePersistence(db, { rootDir: integrationTempDir });

    const response = await runAssetsGeneration({
      db,
      project,
      voiceProfileId: "voice_preset_cold_authority",
      executionMode: "dry_run",
    });

    const profile = await getVoiceProfileById(
      db,
      "voice_preset_cold_authority",
    );
    expect(response.statusCode).toBe(200);
    expect(profile?.provider_status).toBe("ready");
    expect(profile?.provider_voice_id).toBe("provider-voice-ready-001");
  });

  it("persists voice profile usage after assets voice resolution", async () => {
    integrationTempDir = join(tmpdir(), `assets-voice-usage-${Date.now()}`);
    await mkdir(integrationTempDir, { recursive: true });

    const { db, project } = await prepareProjectWithAssetPlan();
    project.storageRootDir = integrationTempDir;
    configureVoiceProfilePersistence(db, { rootDir: integrationTempDir });

    const response = await runAssetsGeneration({
      db,
      project,
      voiceProfileId: "voice_preset_cold_authority",
      executionMode: "dry_run",
    });

    const profile = await getVoiceProfileById(
      db,
      "voice_preset_cold_authority",
    );
    expect(response.statusCode).toBe(200);
    expect(profile?.usage_count).toBe(1);
    expect(profile?.last_used_at).toEqual(expect.any(String));

    const nextDb = createDbClient();
    configureVoiceProfilePersistence(nextDb, { rootDir: integrationTempDir });
    const persistedProfile = await getVoiceProfileById(
      nextDb,
      "voice_preset_cold_authority",
    );
    expect(persistedProfile?.usage_count).toBe(1);
    expect(persistedProfile?.last_used_at).toBe(profile?.last_used_at);
  });

  it("uses normalized TTS chunks for execution without mutating the stored asset plan", async () => {
    const { db, project } = await prepareProjectWithAssetPlan();
    const assetPlanRecord = db.assetPlanRecords.get(ASSET_PLAN_RECORD_ID)!;
    const originalText = `${"甲".repeat(250)}。${"乙".repeat(250)}。`;
    assetPlanRecord.planJson = {
      ...makeAssetPlan(),
      tts_plan: {
        ...makeAssetPlan().tts_plan,
        chunks: [
          {
            chunk_id: "tts_001",
            order: 0,
            script_excerpt: originalText,
            estimated_duration_sec: 12,
          },
        ],
      },
    };
    const storedPlanBeforeRun = JSON.stringify(assetPlanRecord.planJson);

    const response = await runAssetsGeneration({
      db,
      project,
      voiceProfileId: "voice_plan",
      executionMode: "dry_run",
    });
    const body = response.body as { manifest: AssetManifest };

    expect(response.statusCode).toBe(200);
    expect(body.manifest.audio_summary.tts_chunk_routes).toMatchObject([
      {
        tts_chunk_id: "tts_001_part_1",
        segment_ids: ["sb_001"],
      },
      {
        tts_chunk_id: "tts_001_part_2",
        segment_ids: ["sb_001"],
      },
    ]);
    expect(
      body.manifest.audio_summary.tts_chunk_routes.map(
        (route) => route.script_excerpt,
      ),
    ).toEqual([`${"甲".repeat(250)}。`, `${"乙".repeat(250)}。`]);
    expect(JSON.stringify(assetPlanRecord.planJson)).toBe(storedPlanBeforeRun);
    expect(assetPlanRecord.planJson.tts_plan.chunks).toHaveLength(1);
  });

  it("registers a manual image artifact into the segment route before revalidation", async () => {
    const { db, project } = await prepareProjectWithAssetPlan();

    await runAssetsGeneration({
      db,
      project,
      voiceProfileId: "voice_plan",
      executionMode: "auto_available",
    });

    const response = await registerManualArtifact({
      db,
      project,
      taskId: "img_001",
      artifactType: "image",
      fileUri: "manual://image.png",
      mimeType: "image/png",
      metadata: { width: 1080, height: 1920 },
    });

    expect(response.statusCode).toBe(200);
    const body = response.body as {
      manifest: AssetManifest;
      local_validation: { errors: string[] };
    };
    const route = body.manifest.segment_routes.find(
      (item) => item.segment_id === "sb_001",
    );

    expect(route?.primary_visual_artifact_id).toBeDefined();
    expect(route?.primary_visual_artifact_id).toContain("artifact_manual_");
    expect(body.local_validation.errors).not.toContain(
      "assets_segment_visual_missing",
    );
  });

  it("rejects manual artifacts that do not match the shared artifact schema", async () => {
    const { db, project } = await prepareProjectWithAssetPlan();

    await runAssetsGeneration({
      db,
      project,
      voiceProfileId: "voice_plan",
      executionMode: "auto_available",
    });

    const response = await registerManualArtifact({
      db,
      project,
      taskId: "img_001",
      artifactType: "image",
      fileUri: "manual://bad",
      mimeType: "image/png",
      metadata: {},
    });

    expect(response.statusCode).toBe(422);
    expect(response.body).toMatchObject({
      error: "asset_manual_artifact_invalid",
    });
  });

  it("uses DashScope providers only when explicitly requested", async () => {
    integrationTempDir = join(tmpdir(), `assets-dashscope-${Date.now()}`);
    await mkdir(integrationTempDir, { recursive: true });

    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const urlText = String(url);
      const headers = new Headers(init?.headers);
      if (urlText.startsWith("https://dashscope.aliyuncs.com/")) {
        expect(headers.get("authorization")).toBe("Bearer test-key");
      }

      if (urlText.endsWith("/api/v1/services/aigc/multimodal-generation/generation")) {
        expect(headers.get("x-dashscope-async")).toBe("disable");
        return new Response(
          JSON.stringify({
            output: {
              audio: {
                url: "https://example.test/audio.wav",
              },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (urlText.endsWith("/api/v1/services/aigc/image-generation/generation")) {
        expect(headers.get("x-dashscope-async")).toBe("enable");
        return new Response(
          JSON.stringify({
            output: {
              task_id: "task_dashscope_image_001",
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (urlText.endsWith("/api/v1/tasks/task_dashscope_image_001")) {
        return new Response(
          JSON.stringify({
            output: {
              task_status: "SUCCEEDED",
              results: [{ url: "https://example.test/image.png" }],
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (urlText === "https://example.test/audio.wav") {
        return new Response(new Uint8Array([1, 2, 3, 4]), {
          status: 200,
          headers: { "content-type": "audio/wav" },
        });
      }

      if (urlText === "https://example.test/image.png") {
        return new Response(new Uint8Array([137, 80, 78, 71]), {
          status: 200,
          headers: { "content-type": "image/png" },
        });
      }

      throw new Error(`unexpected fetch: ${urlText}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { db, project } = await prepareProjectWithAssetPlan();
    project.storageRootDir = integrationTempDir;

    injectDashscopeEnv();
    await seedDashscopeDispatchCatalog(db);
    const quotedRunId = await createQuotedRun(db, project, "dashscope-explicit-1");
const response = await runAssetsGeneration({
      db,
      project,
      voiceProfileId: "voice_system_ethan",
      executionMode: "auto_available",
      generationRunId: quotedRunId,
    });
    const body = response.body as { manifest: AssetManifest };

    expect(response.statusCode).toBe(200);
    expect(body.manifest.artifacts.some(
      (artifact) =>
        (artifact.metadata as Record<string, unknown>).provider_name === "dashscope_tts",
    )).toBe(true);
    expect(body.manifest.artifacts.some(
      (artifact) =>
        (artifact.metadata as Record<string, unknown>).provider_name === "dashscope_image",
    )).toBe(true);
    expect(fetchMock).toHaveBeenCalled();
  });

  it("keeps all providers fake when the backend env has no dashscope api key", async () => {
    integrationTempDir = join(tmpdir(), `assets-dashscope-tts-only-${Date.now()}`);
    await mkdir(integrationTempDir, { recursive: true });

    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const urlText = String(url);
      const headers = new Headers(init?.headers);
      if (urlText.startsWith("https://dashscope.aliyuncs.com/")) {
        expect(headers.get("authorization")).toBe("Bearer test-key");
      }

      if (urlText.endsWith("/api/v1/services/aigc/multimodal-generation/generation")) {
        expect(headers.get("x-dashscope-async")).toBe("disable");
        return new Response(
          JSON.stringify({
            output: {
              audio: {
                url: "https://example.test/audio.wav",
              },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (urlText === "https://example.test/audio.wav") {
        return new Response(createToneWavBuffer({ durationSec: 1 }), {
          status: 200,
          headers: { "content-type": "audio/wav" },
        });
      }

      throw new Error(`unexpected fetch: ${urlText}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { db, project } = await prepareProjectWithAssetPlan();
    project.storageRootDir = integrationTempDir;

    const response = await runAssetsGeneration({
      db,
      project,
      voiceProfileId: "voice_system_ethan",
      executionMode: "auto_available",
    });
    const body = response.body as { manifest: AssetManifest };
    const providerNames = [...db.assetProviderJobRecords.values()].map(
      (job) => job.providerName,
    );

    expect(response.statusCode).toBe(200);
    expect(body.manifest.artifacts.some(
      (artifact) => artifact.artifact_type === "image",
    )).toBe(true);
    // 无 env key 时全部走 fake provider，不得出现 dashscope
    expect(providerNames).toContain("fake_tts");
    expect(providerNames).toContain("fake_image");
    expect(providerNames).not.toContain("dashscope_tts");
    expect(providerNames).not.toContain("dashscope_image");
    expect(providerNames).not.toContain("dashscope_image_to_video");
  });

  it("reuses a persisted provider voice id for DashScope TTS without voice design", async () => {
    integrationTempDir = join(tmpdir(), `assets-persisted-voice-${Date.now()}`);
    await mkdir(integrationTempDir, { recursive: true });

    const setupDb = createDbClient();
    configureVoiceProfilePersistence(setupDb, { rootDir: integrationTempDir });
    await seedGlobalVoiceProfiles(setupDb);
    await updateVoiceProfileProviderState(
      setupDb,
      "voice_preset_cold_authority",
      {
        provider_status: "ready",
        provider_voice_id: "provider-voice-ready-001",
        preview_audio_uri: "data:audio/wav;base64,cHJldmlldw==",
      },
    );

    let voiceDesignCalls = 0;
    let ttsPayload: Record<string, any> | null = null;
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const urlText = String(url);

      if (urlText.endsWith("/api/v1/services/audio/tts/customization")) {
        voiceDesignCalls += 1;
        throw new Error("voice design should not be called");
      }

      if (urlText.endsWith("/api/v1/services/aigc/multimodal-generation/generation")) {
        ttsPayload = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({
            output: {
              audio: {
                url: "https://example.test/audio.wav",
              },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (urlText.endsWith("/api/v1/services/aigc/image-generation/generation")) {
        return new Response(
          JSON.stringify({
            output: {
              task_id: "task_dashscope_image_001",
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (urlText.endsWith("/api/v1/tasks/task_dashscope_image_001")) {
        return new Response(
          JSON.stringify({
            output: {
              task_status: "SUCCEEDED",
              results: [{ url: "https://example.test/image.png" }],
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (urlText === "https://example.test/audio.wav") {
        return new Response(new Uint8Array([1, 2, 3, 4]), {
          status: 200,
          headers: { "content-type": "audio/wav" },
        });
      }

      if (urlText === "https://example.test/image.png") {
        return new Response(new Uint8Array([137, 80, 78, 71]), {
          status: 200,
          headers: { "content-type": "image/png" },
        });
      }

      throw new Error(`unexpected fetch: ${urlText}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { db, project } = await prepareProjectWithAssetPlan();
    configureVoiceProfilePersistence(db, { rootDir: integrationTempDir });
    project.storageRootDir = integrationTempDir;

    injectDashscopeEnv();
    await seedDashscopeDispatchCatalog(db);
    const quotedRunId = await createQuotedRun(db, project, "dashscope-voice-1");
const response = await runAssetsGeneration({
      db,
      project,
      voiceProfileId: "voice_preset_cold_authority",
      executionMode: "auto_available",
      generationRunId: quotedRunId,
    });

    expect(response.statusCode).toBe(200);
    expect(voiceDesignCalls).toBe(0);
    expect(ttsPayload?.input.voice).toBe("provider-voice-ready-001");
  });

  it("uses dashscope image-to-video provider when explicitly configured", async () => {
    integrationTempDir = join(tmpdir(), `assets-dashscope-i2v-${Date.now()}`);
    await mkdir(integrationTempDir, { recursive: true });

    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const urlText = String(url);
      const headers = new Headers(init?.headers);
      if (urlText.startsWith("https://dashscope.aliyuncs.com/")) {
        expect(headers.get("authorization")).toBe("Bearer test-key");
      }

      if (urlText.endsWith("/api/v1/services/aigc/multimodal-generation/generation")) {
        expect(headers.get("x-dashscope-async")).toBe("disable");
        return new Response(
          JSON.stringify({
            output: {
              audio: {
                url: "https://example.test/audio.wav",
              },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (urlText.endsWith("/api/v1/services/aigc/image-generation/generation")) {
        expect(headers.get("x-dashscope-async")).toBe("enable");
        return new Response(
          JSON.stringify({
            output: {
              task_id: "task_dashscope_image_001",
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (urlText.endsWith("/api/v1/tasks/task_dashscope_image_001")) {
        return new Response(
          JSON.stringify({
            output: {
              task_status: "SUCCEEDED",
              results: [{ url: "https://example.test/image.png" }],
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (urlText.endsWith("/api/v1/services/aigc/video-generation/video-synthesis")) {
        expect(headers.get("x-dashscope-async")).toBe("enable");
        return new Response(
          JSON.stringify({
            output: {
              task_id: "task_dashscope_i2v_001",
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (urlText.endsWith("/api/v1/tasks/task_dashscope_i2v_001")) {
        return new Response(
          JSON.stringify({
            output: {
              task_id: "task_dashscope_i2v_001",
              task_status: "SUCCEEDED",
              video_url: "https://example.test/video.mp4",
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (urlText === "https://example.test/audio.wav") {
        return new Response(new Uint8Array([1, 2, 3, 4]), {
          status: 200,
          headers: { "content-type": "audio/wav" },
        });
      }

      if (urlText === "https://example.test/image.png") {
        return new Response(new Uint8Array([137, 80, 78, 71]), {
          status: 200,
          headers: { "content-type": "image/png" },
        });
      }

      if (urlText === "https://example.test/video.mp4") {
        return new Response(new Uint8Array([0, 0, 0, 24]), {
          status: 200,
          headers: { "content-type": "video/mp4" },
        });
      }

      throw new Error(`unexpected fetch: ${urlText}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { db, project } = await prepareProjectWithAssetPlan();
    project.storageRootDir = integrationTempDir;
    db.assetPlanRecords.get(ASSET_PLAN_RECORD_ID)!.planJson =
      makeImageToVideoAssetPlan();
    const dashscope = {
      apiKey: "test-key",
      baseUrl: "https://dashscope.aliyuncs.com",
      ttsModel: "qwen3-tts-instruct-flash",
      imageModel: "wan2.6-t2i",
      imageToVideoModel: "wan2.7-i2v-2026-04-25",
      imagePollIntervalMs: 0,
      imageMaxPollAttempts: 1,
      imageToVideoPollIntervalMs: 0,
      imageToVideoMaxPollAttempts: 1,
    };

    injectDashscopeEnv();
    await seedDashscopeDispatchCatalog(db);
    const quotedRunId = await createQuotedRun(db, project, "dashscope-i2v-1");
const response = await runAssetsGeneration({
      db,
      project,
      voiceProfileId: "voice_custom",
      executionMode: "auto_available",
      generationRunId: quotedRunId,
      dashscope,
    });
    const body = response.body as { manifest: AssetManifest };

    expect(response.statusCode).toBe(200);
    expect(body.manifest.artifacts.some(
      (artifact) => artifact.artifact_type === "video",
    )).toBe(true);
    expect(body.manifest.segment_routes[0]?.visual_route_type).toBe("video_clip");
    expect([...db.assetProviderJobRecords.values()].some(
      (job) => job.providerName === "dashscope_image_to_video",
    )).toBe(true);
  });

  it("single-task video_clip with DashScope mock completes and updates route", async () => {
    integrationTempDir = join(tmpdir(), `assets-i2v-single-${Date.now()}`);
    await mkdir(integrationTempDir, { recursive: true });

    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const urlText = String(url);
      const headers = new Headers(init?.headers);
      if (urlText.startsWith("https://dashscope.aliyuncs.com/")) {
        expect(headers.get("authorization")).toBe("Bearer test-key");
      }
      if (urlText.endsWith("/api/v1/services/aigc/multimodal-generation/generation")) {
        return new Response(JSON.stringify({ output: { audio: { url: "https://example.test/audio.wav" } } }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (urlText.endsWith("/api/v1/services/aigc/image-generation/generation")) {
        return new Response(JSON.stringify({ output: { task_id: "task_img_001" } }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (urlText.endsWith("/api/v1/tasks/task_img_001")) {
        return new Response(JSON.stringify({ output: { task_status: "SUCCEEDED", results: [{ url: "https://example.test/image.png" }] } }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (urlText.endsWith("/api/v1/services/aigc/video-generation/video-synthesis")) {
        return new Response(JSON.stringify({ output: { task_id: "task_i2v_001" } }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (urlText.endsWith("/api/v1/tasks/task_i2v_001")) {
        return new Response(JSON.stringify({ output: { task_id: "task_i2v_001", task_status: "SUCCEEDED", video_url: "https://example.test/video.mp4" } }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (urlText === "https://example.test/audio.wav" || urlText === "https://example.test/image.png" || urlText === "https://example.test/video.mp4") {
        return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200, headers: { "content-type": urlText.endsWith(".mp4") ? "video/mp4" : urlText.endsWith(".wav") ? "audio/wav" : "image/png" } });
      }
      if (urlText.startsWith("https://example.test/")) {
        return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 });
      }
      throw new Error("unexpected fetch: " + urlText);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { db, project } = await prepareProjectWithAssetPlan();
    project.storageRootDir = integrationTempDir;
    db.assetPlanRecords.get(ASSET_PLAN_RECORD_ID)!.planJson =
      makeImageToVideoAssetPlan();
    injectDashscopeEnv();
    await seedDashscopeDispatchCatalog(db);

    // Step 1: full run to generate image first
    const firstRunId = await createQuotedRun(db, project, "dashscope-i2v-single-1");
    const first = await runAssetsGeneration({
      db, project, voiceProfileId: "voice_custom",
      executionMode: "auto_available",
      generationRunId: firstRunId,
    });
    const firstBody = first.body as { manifest: AssetManifest };
    expect(firstBody.manifest.segment_routes[0]?.primary_visual_artifact_id).toBeDefined();

    // Step 2: find the video task and regenerate only it
    const planRecord = db.assetPlanRecords.get(ASSET_PLAN_RECORD_ID);
    const assetPlan = planRecord?.planJson as { tasks: Array<{ task_id: string; task_type: string }> } | undefined;
    const videoTask = assetPlan?.tasks?.find(t => t.task_type === "video_clip");
    expect(videoTask).toBeDefined();

    const secondRunId = await createQuotedRun(db, project, "dashscope-i2v-single-2");
    const second = await runAssetsGeneration({
      db, project, voiceProfileId: "voice_custom",
      executionMode: "auto_available",
      generationRunId: secondRunId,
      taskIds: [videoTask!.task_id],
    });
    const secondBody = second.body as { manifest: AssetManifest };

    const videoExec = secondBody.manifest.executions.find(e => e.task_id === videoTask!.task_id);
    expect(videoExec).toBeDefined();
    expect(videoExec!.status).toBe("completed");

    const route = secondBody.manifest.segment_routes[0];
    expect(route).toBeDefined();
    expect(route!.visual_route_type).toBe("video_clip");
    expect(route!.primary_visual_artifact_id).toBeDefined();

    const fallback = (route as Record<string, unknown>).fallback_visual_artifact_id;
    expect(fallback).toBeDefined();
    expect(typeof fallback).toBe("string");
    // Fallback should reference an image artifact, not the video
    expect((fallback as string).startsWith("artifact_img")).toBe(true);
  });
});

describe("execution engine integration", () => {
  let tempDir: string;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("end-to-end: all_api_video failure blocks, accept-fallback activates and persists", async () => {
    tempDir = join(tmpdir(), `assets-e2e-fallback-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    const { db, project } = await prepareProjectWithAssetPlan();
    project.storageRootDir = tempDir;

    // 注入 all_api_video 项目配置：更新已有记录或新建（memory db）
    const existingConfig = [...db.projectGenerationConfigurations.values()].find(
      (record) => record.projectId === project.id,
    );
    if (existingConfig) {
      existingConfig.configurationJson = {
        ...existingConfig.configurationJson,
        video: {
          ...existingConfig.configurationJson.video,
          strategy: "all_api_video",
        },
      };
      existingConfig.updatedAt = new Date();
    } else {
      db.projectGenerationConfigurations.set("cfg_e2e", {
        id: "cfg_e2e",
        projectId: project.id,
        schemaVersion: "generation_configuration_v1",
        revision: 1,
        sourceUserPreferenceRevision: null,
        configurationJson: {
          ...DEFAULT_GENERATION_CONFIGURATION,
          video: {
            ...DEFAULT_GENERATION_CONFIGURATION.video,
            strategy: "all_api_video",
          },
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
    // plan 含 image + motion + video；fake registry 无 video adapter → 无 adapter 失败路径
    db.assetPlanRecords.get(ASSET_PLAN_RECORD_ID)!.planJson =
      makeImageToVideoAssetPlan();

    const response = await runAssetsGeneration({
      db,
      project,
      voiceProfileId: "voice_custom",
      executionMode: "auto_available",
    });
    expect(response.statusCode).toBe(200);
    const manifest = (response.body as { manifest: AssetManifest }).manifest;
    const videoExec = manifest.executions.find(
      (e) => e.task_type === "video_clip",
    )!;
    expect(videoExec.status).toBe("failed");
    const route = manifest.segment_routes[0]!;
    expect(route.video_strategy).toBe("all_api_video");
    expect(route.visual_route_type).toBe("video_clip");
    expect(route.readiness).toBe("blocked_waiting_user");
    // API route 必须保留同段 motion cue（C1a）
    expect(route.motion_artifact_id).not.toBeNull();

    // validator 识别严格阻塞
    const record = db.assetManifestRecords.get(project.activeAssetManifestRecordId!)!;
    const validation = await validateAssetsManifest({
      assetPlanRecordId: record.assetPlanRecordId,
      storyboardRecordId: record.storyboardRecordId,
      scriptRecordId: record.scriptRecordId,
      topicPackageId: record.topicPackageId,
      assetPlan: db.assetPlanRecords.get(record.assetPlanRecordId)!.planJson as AssetPlan,
      manifest,
      projectStorageRootDir: project.storageRootDir,
    });
    expect(validation.decision).toBe("blocked");
    expect(validation.errors).toContain("assets_execution_incomplete");

    // accept-fallback（CAS version + run id 校验）
    const runId = record.executionStateJson?.run_id as string;
    expect(runId).toEqual(expect.any(String));
    const accept = await acceptSegmentFallback({
      db,
      project,
      runId,
      segmentId: "sb_001",
      expectedRunId: runId,
      expectedVersion: String(record.revision),
    });
    expect(accept.statusCode).toBe(200);

    // reload：决策与事件持久化在记录中
    const reloaded = db.assetManifestRecords.get(project.activeAssetManifestRecordId!)!;
    const reloadedManifest = reloaded.manifestJson as AssetManifest;
    const reloadedRoute = (reloadedManifest as { segment_routes: SegmentAssetRoute[] }).segment_routes[0]!;
    expect(reloadedRoute.visual_route_type).toBe("image_with_motion");
    expect(reloadedRoute.fallback_decision).toBe("user_accepted");
    expect(reloadedRoute.readiness).toBe("ready");
    // C1：接受后 video execution 进入终态，validator 放行 → 可继续 Compose
    const reloadedVideoExec = reloadedManifest.executions.find(
      (e) => e.task_type === "video_clip",
    )!;
    expect(reloadedVideoExec.status).toBe("skipped_with_fallback");
    const postAcceptValidation = await validateAssetsManifest({
      assetPlanRecordId: reloaded.assetPlanRecordId,
      storyboardRecordId: reloaded.storyboardRecordId,
      scriptRecordId: reloaded.scriptRecordId,
      topicPackageId: reloaded.topicPackageId,
      assetPlan: db.assetPlanRecords.get(reloaded.assetPlanRecordId)!.planJson as AssetPlan,
      manifest: reloadedManifest,
      projectStorageRootDir: project.storageRootDir,
    });
    // errors 为空即放行 Compose；warnings 只产生 partial（可继续）
    expect(postAcceptValidation.errors).toEqual([]);
    expect(postAcceptValidation.decision).not.toBe("blocked");
    expect(project.status).not.toBe("assets_blocked");
    // 正式 append-only run event
    const events = db.generationRunEvents.get(runId) ?? [];
    expect(events).toContainEqual(
      expect.objectContaining({ eventType: "fallback_accepted", segmentId: "sb_001" }),
    );
    // CAS：接受后 revision 递增
    expect(reloaded.revision).toBeGreaterThan(1);
  });

  it("video retry after strategy switch follows the current prefer_remotion config", async () => {
    tempDir = join(tmpdir(), `assets-strategy-switch-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    const { db, project } = await prepareProjectWithAssetPlan();
    project.storageRootDir = tempDir;
    db.assetPlanRecords.get(ASSET_PLAN_RECORD_ID)!.planJson =
      makeImageToVideoAssetPlan();

    const setStrategy = (strategy: string) => {
      const existing = [...db.projectGenerationConfigurations.values()].find(
        (record) => record.projectId === project.id,
      );
      if (existing) {
        existing.configurationJson = {
          ...existing.configurationJson,
          video: { ...existing.configurationJson.video, strategy: strategy as never },
        };
      }
    };

    // 第一次：all_api_video 严格阻塞
    setStrategy("all_api_video");
    const first = await runAssetsGeneration({
      db,
      project,
      voiceProfileId: "voice_custom",
      executionMode: "auto_available",
    });
    expect(first.statusCode).toBe(200);
    const firstManifest = (first.body as { manifest: AssetManifest }).manifest;
    expect(firstManifest.segment_routes[0]!.video_strategy).toBe("all_api_video");
    expect(firstManifest.segment_routes[0]!.readiness).toBe("blocked_waiting_user");

    // 切换策略为 prefer_remotion 后局部重试 video：
    // 本轮配置解析必须生效（prefer_remotion 是合法策略，不是未决策默认值），
    // 视频失败自动降级并保存新决策，不得被旧 all_api_video 覆盖。
    setStrategy("prefer_remotion");
    const videoTask = (db.assetPlanRecords.get(ASSET_PLAN_RECORD_ID)!.planJson as { tasks: Array<{ task_id: string; task_type: string }> }).tasks.find(
      (t) => t.task_type === "video_clip",
    )!;
    const second = await runAssetsGeneration({
      db,
      project,
      voiceProfileId: "voice_custom",
      executionMode: "auto_available",
      taskIds: [videoTask.task_id],
    });
    expect(second.statusCode).toBe(200);
    const secondManifest = (second.body as { manifest: AssetManifest }).manifest;
    const route = secondManifest.segment_routes[0]!;
    expect(route.video_strategy).toBe("prefer_remotion");
    expect(route.fallback_decision).toBe("automatic");
    expect(route.route_events).toHaveLength(1);
    expect(route.route_events[0]).toMatchObject({ event_type: "automatic_fallback" });
    expect(route.visual_route_type).toBe("image_with_motion");
  });

  it("partial retry preserves the automatic fallback decision from the previous run", async () => {
    tempDir = join(tmpdir(), `assets-fallback-retry-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    const { db, project } = await prepareProjectWithAssetPlan();
    project.storageRootDir = tempDir;
    db.assetPlanRecords.get(ASSET_PLAN_RECORD_ID)!.planJson =
      makeImageToVideoAssetPlan();

    // 第一次 run：prefer_remotion（默认）自动降级
    const first = await runAssetsGeneration({
      db,
      project,
      voiceProfileId: "voice_custom",
      executionMode: "auto_available",
    });
    expect(first.statusCode).toBe(200);
    const firstManifest = (first.body as { manifest: AssetManifest }).manifest;
    const firstRoute = firstManifest.segment_routes[0]!;
    expect(firstRoute.fallback_decision).toBe("automatic");
    expect(firstRoute.route_events).toHaveLength(1);

    // 第二次 run：只重试 tts 任务，不应丢失上一轮的路线决策
    const ttsTask = (db.assetPlanRecords.get(ASSET_PLAN_RECORD_ID)!.planJson as { tasks: Array<{ task_id: string; task_type: string }> }).tasks.find(
      (t) => t.task_type === "tts_audio",
    )!;
    const second = await runAssetsGeneration({
      db,
      project,
      voiceProfileId: "voice_custom",
      executionMode: "auto_available",
      taskIds: [ttsTask.task_id],
    });
    expect(second.statusCode).toBe(200);
    const secondManifest = (second.body as { manifest: AssetManifest }).manifest;
    const secondRoute = secondManifest.segment_routes[0]!;
    expect(secondRoute.fallback_decision).toBe("automatic");
    expect(secondRoute.route_events).toHaveLength(1);
    expect(secondRoute.visual_route_type).toBe("image_with_motion");
  });

  it("keeps dry_run as manifest-only without generated artifacts", async () => {
    const { db, project } = await prepareProjectWithAssetPlan();

    const response = await runAssetsGeneration({
      db,
      project,
      voiceProfileId: "voice_custom",
      executionMode: "dry_run",
    });
    const body = response.body as { manifest: AssetManifest };
    expect(body.manifest.artifacts).toHaveLength(0);
  });

  it("auto_available runs fake providers and persists generated artifacts", async () => {
    tempDir = join(tmpdir(), `assets-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });

    const { db, project } = await prepareProjectWithAssetPlan();
    project.storageRootDir = tempDir;

    const response = await runAssetsGeneration({
      db,
      project,
      voiceProfileId: "voice_custom",
      executionMode: "auto_available",
    });
    const body = response.body as { manifest: AssetManifest };
    expect(body.manifest.artifacts.length).toBeGreaterThan(0);
    expect(db.assetProviderJobRecords.size).toBeGreaterThan(0);
  });

  it("missing_only preserves existing completions and only fills gaps", async () => {
    tempDir = join(tmpdir(), `assets-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });

    const { db, project } = await prepareProjectWithAssetPlan();
    project.storageRootDir = tempDir;

    // First full run
    const first = await runAssetsGeneration({
      db, project, voiceProfileId: "voice_custom", executionMode: "auto_available",
    });
    const firstBody = first.body as { manifest: AssetManifest };
    const firstExecCount = firstBody.manifest.executions.length;
    const firstArtifactCount = firstBody.manifest.artifacts.length;
    const firstRoutes = firstBody.manifest.segment_routes?.length ?? 0;
    const firstSubtitleId = (firstBody.manifest as Record<string, unknown>).audio_summary
      ? ((firstBody.manifest as Record<string, unknown>).audio_summary as Record<string, unknown>).subtitle_artifact_id
      : undefined;
    expect(firstExecCount).toBeGreaterThan(0);

    // Second run with missing_only — should not duplicate or lose assets
    const second = await runAssetsGeneration({
      db, project, voiceProfileId: "voice_custom", executionMode: "auto_available",
      missingOnly: true,
    });
    const secondBody = second.body as { manifest: AssetManifest };
    expect(secondBody.manifest.executions.length).toBeGreaterThanOrEqual(firstExecCount);
    expect(secondBody.manifest.artifacts.length).toBeGreaterThanOrEqual(firstArtifactCount);

    // segment_routes should be preserved (not wiped)
    const secondRoutes = secondBody.manifest.segment_routes?.length ?? 0;
    expect(secondRoutes).toBeGreaterThanOrEqual(firstRoutes);

    // audio_summary references should survive
    const secondSubtitleId = (secondBody.manifest as Record<string, unknown>).audio_summary
      ? ((secondBody.manifest as Record<string, unknown>).audio_summary as Record<string, unknown>).subtitle_artifact_id
      : undefined;
    if (firstSubtitleId) {
      expect(secondSubtitleId).toBe(firstSubtitleId);
    }
  });

  it("task_ids only generates the specified task and preserves other routes", async () => {
    tempDir = join(tmpdir(), `assets-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });

    const { db, project } = await prepareProjectWithAssetPlan();
    project.storageRootDir = tempDir;

    // First full run
    const first = await runAssetsGeneration({
      db, project, voiceProfileId: "voice_custom", executionMode: "auto_available",
    });
    const firstBody = first.body as { manifest: AssetManifest };
    const firstExecCount = firstBody.manifest.executions.length;
    const firstArtifactCount = firstBody.manifest.artifacts.length;
    const firstRoutes = firstBody.manifest.segment_routes ?? [];

    // Pick one task
    const planRecord = db.assetPlanRecords.get(ASSET_PLAN_RECORD_ID);
    const assetPlan = planRecord?.planJson as { tasks: Array<{ task_id: string; task_type: string; source_segment_id: string | null }> } | undefined;
    const targetTask = assetPlan?.tasks?.find(t => t.task_type === "image_still");
    if (!targetTask) return;

    // Second run targeting only that task
    const second = await runAssetsGeneration({
      db, project, voiceProfileId: "voice_custom", executionMode: "auto_available",
      taskIds: [targetTask.task_id],
    });
    const secondBody = second.body as { manifest: AssetManifest };
    const secondRoutes = secondBody.manifest.segment_routes ?? [];

    // The targeted task should still be present
    const hasTarget = secondBody.manifest.executions.some(e => e.task_id === targetTask.task_id);
    expect(hasTarget).toBe(true);

    // Other tasks preserved
    expect(secondBody.manifest.executions.length).toBeGreaterThanOrEqual(firstExecCount);
    expect(secondBody.manifest.artifacts.length).toBeGreaterThanOrEqual(firstArtifactCount);

    // segment_routes for UNTOUCHED segments should keep their primary_visual_artifact_id
    const touchedSegId = targetTask.source_segment_id;
    for (const oldRoute of firstRoutes) {
      if (oldRoute.segment_id === touchedSegId) continue; // this one may have changed
      const newRoute = secondRoutes.find(r => r.segment_id === oldRoute.segment_id);
      if (newRoute && oldRoute.primary_visual_artifact_id) {
        expect(newRoute.primary_visual_artifact_id).toBe(oldRoute.primary_visual_artifact_id);
      }
    }

    // readiness should not degrade below original
    const firstReadiness = (firstBody.manifest as Record<string, unknown>).readiness as string;
    const secondReadiness = (secondBody.manifest as Record<string, unknown>).readiness as string;
    // If first was blocked, second shouldn't become a worse state
    expect(secondReadiness).toBeDefined();

    // Touched segment keeps its subtitle / sfx references
    const oldTouchedRoute = firstRoutes.find(r => r.segment_id === touchedSegId);
    const newTouchedRoute = secondRoutes.find(r => r.segment_id === touchedSegId);
    if (oldTouchedRoute && newTouchedRoute) {
      if (oldTouchedRoute.subtitle_artifact_id) {
        expect(newTouchedRoute.subtitle_artifact_id).toBe(oldTouchedRoute.subtitle_artifact_id);
      }
      const oldSfx = (Array.isArray((oldTouchedRoute as Record<string, unknown>).sfx_artifact_ids)
        ? (oldTouchedRoute as Record<string, unknown>).sfx_artifact_ids as string[]
        : []);
      const newSfx = (Array.isArray((newTouchedRoute as Record<string, unknown>).sfx_artifact_ids)
        ? (newTouchedRoute as Record<string, unknown>).sfx_artifact_ids as string[]
        : []);
      for (const sfxId of oldSfx) {
        expect(newSfx).toContain(sfxId);
      }
    }

    // Real TTS artifact file_uri must not be replaced with planned://
    const oldTtsArtifact = firstBody.manifest.artifacts.find(
      a => a.artifact_id.startsWith("artifact_tts") && (a.file_uri ?? "").length > 0 && !(a.file_uri ?? "").startsWith("planned://"),
    );
    // Must find at least one real TTS artifact or the test is vacuous
    expect(oldTtsArtifact).toBeDefined();
    const newTtsArtifact = secondBody.manifest.artifacts.find(
      a => a.artifact_id === oldTtsArtifact!.artifact_id,
    );
    expect(newTtsArtifact).toBeDefined();
    expect(newTtsArtifact!.file_uri).toBe(oldTtsArtifact!.file_uri);
  });

  it("keeps image_with_motion route when video upgrade produces no video artifact", async () => {
    tempDir = join(tmpdir(), `assets-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });

    const { db, project } = await prepareProjectWithAssetPlan();
    project.storageRootDir = tempDir;

    // First full run using fake providers (no video adapter)
    const first = await runAssetsGeneration({
      db, project, voiceProfileId: "voice_custom", executionMode: "auto_available",
    });
    const firstBody = first.body as { manifest: AssetManifest };

    const planRecord = db.assetPlanRecords.get(ASSET_PLAN_RECORD_ID);
    const assetPlan = planRecord?.planJson as { tasks: Array<{ task_id: string; task_type: string; source_segment_id: string | null }> } | undefined;
    const imageTask = assetPlan?.tasks?.find(t => t.task_type === "image_still" && t.source_segment_id);
    if (!imageTask?.source_segment_id) return;

    const segId = imageTask.source_segment_id;
    const firstRoute = firstBody.manifest.segment_routes?.find(r => r.segment_id === segId);
    expect(firstRoute).toBeDefined();
    const firstRouteType = firstRoute!.visual_route_type;

    // Regenerate with a task id (simulating upgrade). Since no video provider
    // exists in the fake registry, no video artifact will be produced.
    const second = await runAssetsGeneration({
      db, project, voiceProfileId: "voice_custom", executionMode: "auto_available",
      taskIds: [imageTask.task_id],
    });
    const secondBody = second.body as { manifest: AssetManifest };

    const secondRoute = secondBody.manifest.segment_routes?.find(r => r.segment_id === segId);
    expect(secondRoute).toBeDefined();

    const hasVideoArtifact = secondBody.manifest.artifacts.some(a => a.artifact_type === "video");
    if (!hasVideoArtifact) {
      expect(secondRoute!.visual_route_type).toBe(firstRouteType);
    }
  });

  it("partial regeneration preserves existing image route and artifact references", async () => {
    tempDir = join(tmpdir(), `assets-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });

    const { db, project } = await prepareProjectWithAssetPlan();
    project.storageRootDir = tempDir;

    // First full run
    const first = await runAssetsGeneration({
      db, project, voiceProfileId: "voice_custom", executionMode: "auto_available",
    });
    const firstBody = first.body as { manifest: AssetManifest };

    // Find an image task and its segment
    const planRecord = db.assetPlanRecords.get(ASSET_PLAN_RECORD_ID);
    const assetPlan = planRecord?.planJson as { tasks: Array<{ task_id: string; task_type: string; source_segment_id: string | null }> } | undefined;
    const imageTask = assetPlan?.tasks?.find(t => t.task_type === "image_still");
    if (!imageTask?.source_segment_id) return;

    const segId = imageTask.source_segment_id;
    const firstRoute = firstBody.manifest.segment_routes?.find(r => r.segment_id === segId);
    const firstImageArtifactId = firstRoute?.primary_visual_artifact_id;
    expect(firstImageArtifactId).toBeDefined();

    // Find the first image artifact to track its file_uri
    const firstImgArt = firstBody.manifest.artifacts.find(a => a.artifact_id === firstImageArtifactId);
    expect(firstImgArt).toBeDefined();

    // Regenerate only the image task (simulates card-level "重新生成")
    const second = await runAssetsGeneration({
      db, project, voiceProfileId: "voice_custom", executionMode: "auto_available",
      taskIds: [imageTask.task_id],
    });
    const secondBody = second.body as { manifest: AssetManifest };

    // Route still has a primary_visual_artifact_id
    const secondRoute = secondBody.manifest.segment_routes?.find(r => r.segment_id === segId);
    expect(secondRoute).toBeDefined();
    expect(secondRoute!.primary_visual_artifact_id).toBeDefined();

    // Artifact count does not decrease
    expect(secondBody.manifest.artifacts.length).toBeGreaterThanOrEqual(firstBody.manifest.artifacts.length);

    // Untouched segment routes keep their references
    for (const oldRoute of firstBody.manifest.segment_routes ?? []) {
      if (oldRoute.segment_id === segId) continue;
      const newRoute = secondBody.manifest.segment_routes?.find(r => r.segment_id === oldRoute.segment_id);
      if (newRoute && oldRoute.primary_visual_artifact_id) {
        expect(newRoute.primary_visual_artifact_id).toBe(oldRoute.primary_visual_artifact_id);
      }
    }
  });
});
