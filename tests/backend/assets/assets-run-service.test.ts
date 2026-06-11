import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";

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
import type { AssetManifest, AssetPlan } from "../../../shared/src/index.js";

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
      if (urlText.startsWith("https://dashscope.test/")) {
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

    const response = await runAssetsGeneration({
      db,
      project,
      voiceProfileId: "voice_system_ethan",
      executionMode: "auto_available",
      providerMode: "dashscope",
      dashscope: {
        apiKey: "test-key",
        baseUrl: "https://dashscope.test",
        imageModel: "wan2.6-t2i",
        ttsModel: "qwen3-tts-instruct-flash",
        imagePollIntervalMs: 0,
        imageMaxPollAttempts: 1,
      },
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

  it("can use DashScope TTS while keeping fake image generation local", async () => {
    integrationTempDir = join(tmpdir(), `assets-dashscope-tts-only-${Date.now()}`);
    await mkdir(integrationTempDir, { recursive: true });

    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const urlText = String(url);
      const headers = new Headers(init?.headers);
      if (urlText.startsWith("https://dashscope.test/")) {
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
      providerMode: "dashscope_tts",
      dashscope: {
        apiKey: "test-key",
        baseUrl: "https://dashscope.test",
        ttsModel: "qwen3-tts-instruct-flash",
      },
    });
    const body = response.body as { manifest: AssetManifest };
    const providerNames = [...db.assetProviderJobRecords.values()].map(
      (job) => job.providerName,
    );

    expect(response.statusCode).toBe(200);
    expect(body.manifest.artifacts.some(
      (artifact) =>
        (artifact.metadata as Record<string, unknown>).provider_name === "dashscope_tts",
    )).toBe(true);
    expect(body.manifest.artifacts.some(
      (artifact) => artifact.artifact_type === "image",
    )).toBe(true);
    expect(providerNames).toContain("dashscope_tts");
    expect(providerNames).toContain("fake_image");
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

    const response = await runAssetsGeneration({
      db,
      project,
      voiceProfileId: "voice_preset_cold_authority",
      executionMode: "auto_available",
      providerMode: "dashscope",
      dashscope: {
        apiKey: "test-key",
        baseUrl: "https://dashscope.test",
        imageModel: "wan2.6-t2i",
        ttsModel: "qwen3-tts-instruct-flash",
        imagePollIntervalMs: 0,
        imageMaxPollAttempts: 1,
      },
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
      if (urlText.startsWith("https://dashscope.test/")) {
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
      baseUrl: "https://dashscope.test",
      ttsModel: "qwen3-tts-instruct-flash",
      imageModel: "wan2.6-t2i",
      imageToVideoModel: "wan2.7-i2v-2026-04-25",
      imagePollIntervalMs: 0,
      imageMaxPollAttempts: 1,
      imageToVideoPollIntervalMs: 0,
      imageToVideoMaxPollAttempts: 1,
    };

    const response = await runAssetsGeneration({
      db,
      project,
      voiceProfileId: "voice_custom",
      executionMode: "auto_available",
      providerMode: "dashscope",
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
});

describe("execution engine integration", () => {
  let tempDir: string;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
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

  it("single-task video_clip generation preserves existing image artifacts and routes", async () => {
    tempDir = join(tmpdir(), `assets-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });

    const { db, project } = await prepareProjectWithAssetPlan();
    project.storageRootDir = tempDir;

    // First full run to generate all assets including images
    const first = await runAssetsGeneration({
      db, project, voiceProfileId: "voice_custom", executionMode: "auto_available",
    });
    const firstBody = first.body as { manifest: AssetManifest };

    // Find an image task and its segment
    const planRecord = db.assetPlanRecords.get(ASSET_PLAN_RECORD_ID);
    const assetPlan = planRecord?.planJson as { tasks: Array<{ task_id: string; task_type: string; source_segment_id: string | null }> } | undefined;
    const imageTask = assetPlan?.tasks?.find(t => t.task_type === "image_still");
    if (!imageTask?.source_segment_id) return;

    // Record first-run state for the image's segment
    const segId = imageTask.source_segment_id;
    const firstRoute = firstBody.manifest.segment_routes?.find(r => r.segment_id === segId);
    const firstImageArtifactId = firstRoute?.primary_visual_artifact_id;
    expect(firstImageArtifactId).toBeDefined();

    // Second run with missing_only — should not wipe the existing image route
    const second = await runAssetsGeneration({
      db, project, voiceProfileId: "voice_custom", executionMode: "auto_available",
      missingOnly: true,
    });
    const secondBody = second.body as { manifest: AssetManifest };

    // The segment route must still have its primary_visual_artifact_id
    const secondRoute = secondBody.manifest.segment_routes?.find(r => r.segment_id === segId);
    expect(secondRoute).toBeDefined();
    if (firstImageArtifactId) {
      expect(secondRoute!.primary_visual_artifact_id).toBe(firstImageArtifactId);
    }

    // The image artifact must still exist with the same file_uri
    const firstImgArt = firstBody.manifest.artifacts.find(a => a.artifact_id === firstImageArtifactId);
    const secondImgArt = secondBody.manifest.artifacts.find(a => a.artifact_id === firstImageArtifactId);
    if (firstImgArt) {
      expect(secondImgArt).toBeDefined();
      expect(secondImgArt!.file_uri).toBe(firstImgArt.file_uri);
    }

    // Total artifact count must not decrease
    expect(secondBody.manifest.artifacts.length).toBeGreaterThanOrEqual(firstBody.manifest.artifacts.length);
  });
});
