import { buildApp } from "../../../backend/src/app.js";
import type { DbClient, ProjectRecord } from "../../../backend/src/db/client.js";
import { createLegacyProject as createProject } from "../projects/legacy-project.fixture.js";
import { applyProviderModelCatalogSeed } from "../../../backend/src/modules/generation-cost/provider-model-catalog.repository.js";
import {
  buildPricingCatalogSeed,
  DASHSCOPE_MEDIA_CANDIDATES_V1,
  type LlmTierSeedInput,
} from "../../../backend/src/modules/generation-cost/pricing-catalog.seed.js";
import type { GenerationCapabilityReadinessInput } from "../../../backend/src/modules/generation-cost/generation-capability-readiness.js";
import type { AssetPlan, StoryboardPlan } from "../../../shared/src/index.js";

/**
 * S2-2A 任务 8 测试上下文：可报价目录 + readiness 输入。
 * readiness 由调用方注入（与 bootstrap 的依赖注入模式一致），
 * 测试不依赖真实 env（vitest 下 NODE_ENV=test 会禁用真实视频派发）。
 */

export const CN_BEIJING_MEDIA_READINESS = {
  registeredModels: [
    // 与 seed 同源派生（内置候选含默认 wan2.7-image 与候选 wan2.6-t2i/wan2.6-i2v-flash），
    // 手写镜像会重现"目录行被判 media_model_not_registered"的漂移。
    ...DASHSCOPE_MEDIA_CANDIDATES_V1,
    { capability: "video.image_to_video" as const, providerKey: "dashscope", modelId: "wan2.7-i2v-2026-04-25" },
    { capability: "tts.synthesize" as const, providerKey: "dashscope", modelId: "qwen3-tts-instruct-flash" },
  ],
  credentialConfigured: true,
  deploymentScope: "cn-beijing" as const,
};

/** 全可报价 readiness（llm stub + 北京媒体 + 非 demo/test 环境）。 */
export function buildQuotableReadinessInput(
  llm: LlmTierSeedInput = { mode: "stub" },
): GenerationCapabilityReadinessInput {
  return {
    llm,
    media: CN_BEIJING_MEDIA_READINESS,
    environment: { testEnv: false },
  };
}

/** 真实 LLM tier（deepseek/zhipu，价格未核实 → unbounded）。 */
export const REAL_TIER_INPUT: LlmTierSeedInput = {
  mode: "resolved",
  smart: { providerKey: "deepseek", modelId: "deepseek-v4-pro" },
  flash: { providerKey: "zhipu", modelId: "glm-4" },
};

export async function seedQuotableCatalog(
  app: ReturnType<typeof buildApp>,
  llm: LlmTierSeedInput = { mode: "stub" },
): Promise<void> {
  await applyProviderModelCatalogSeed(
    app.db,
    buildPricingCatalogSeed({ llm, media: { deploymentScope: "cn-beijing" } }),
  );
}

export async function prepareQuoteProject(
  db: DbClient,
  ownerId = "user-a",
): Promise<ProjectRecord> {
  return createProject(db, { name: "Quote Test Project", ownerId });
}

/** 最小 storyboard plan（api_video_suitability=strongly_recommended → prefer_remotion 下仍走 api_video）。 */
export function makeQuoteStoryboardPlan(input: {
  scriptRecordId: string;
  topicPackageId: string;
}): StoryboardPlan {
  return {
    plan_version: "storyboard_v1",
    source_script_record_id: input.scriptRecordId,
    source_topic_package_id: input.topicPackageId,
    estimated_total_duration_sec: 82,
    segments: [
      {
        segment_id: "sb_001",
        order: 0,
        script_excerpt: "Opening pressure.",
        start_hint_sec: 0,
        end_hint_sec: 82,
        narrative_role: "opening",
        visual_intent: "A visible public answer.",
        scene_description: "A tense hall.",
        visual_elements: ["envoy"],
        framing_hint: "medium",
        content_type: "live_action",
        motion_hint: "push_in",
        editing_hint: "single",
        on_screen_text: [],
        linked_beats: [],
        linked_quotes: [],
        risk_notes: [],
        api_video_suitability: "api_video_strongly_recommended",
      },
    ],
    global_visual_notes: [],
  };
}

/** 最小 asset plan：1 image_still + 1 video_clip + 1 tts_audio（字符数来自 source_excerpt）。 */
export function makeQuoteAssetPlan(input: {
  storyboardRecordId: string;
  scriptRecordId: string;
  topicPackageId: string;
}): AssetPlan {
  return {
    plan_version: "asset_plan_v1",
    source_storyboard_record_id: input.storyboardRecordId,
    source_script_record_id: input.scriptRecordId,
    source_topic_package_id: input.topicPackageId,
    art_bible: {
      era_style: "ancient court",
      visual_tone: "cold pressure",
      characters: [],
      locations: [],
      props: [],
      global_prompt_prefix: "ancient Chinese historical short video",
      global_negative_prompts: ["modern building"],
      consistency_notes: [],
    },
    visual_budget: {},
    downgrade_policy: {},
    global_audio_strategy: {},
    tts_plan: {
      voice_profile_id: "voice_default_male_storyteller",
      estimated_total_duration_sec: 82,
      chunking_strategy: "segment_boundary",
      chunks: [
        { chunk_id: "chunk_001", order: 0, script_excerpt: "Opening pressure.", estimated_duration_sec: 82 },
      ],
    },
    tasks: [
      {
        task_id: "task_img_001",
        order: 0,
        task_type: "image_still",
        source_segment_id: "sb_001",
        source_excerpt: "Opening pressure.",
        production_intent: "A visible public answer.",
        recommended_mode: "auto",
        provider_hint: null,
        prompt_draft: "A tense hall, envoy answering.",
        parameters: {},
        manual_upload_policy: { allowed: false, required: false, accepted_file_types: [], acceptance_notes: [] },
        risk_notes: [],
        cost_tier: "low",
        initial_status: "planned",
      },
      {
        task_id: "task_video_001",
        order: 1,
        task_type: "video_clip",
        source_segment_id: "sb_001",
        source_excerpt: "Opening pressure.",
        production_intent: "A visible public answer.",
        recommended_mode: "auto",
        provider_hint: null,
        prompt_draft: "A tense hall, envoy answering.",
        parameters: { api_quality: "standard_720p" },
        manual_upload_policy: { allowed: false, required: false, accepted_file_types: [], acceptance_notes: [] },
        risk_notes: [],
        cost_tier: "medium",
        initial_status: "planned",
      },
      {
        task_id: "task_tts_001",
        order: 2,
        task_type: "tts_audio",
        source_segment_id: null,
        source_excerpt: "Opening pressure.",
        production_intent: "Voiceover for the opening.",
        recommended_mode: "auto",
        provider_hint: null,
        prompt_draft: null,
        parameters: { voice_profile_id: "voice_default_male_storyteller" },
        manual_upload_policy: { allowed: false, required: false, accepted_file_types: [], acceptance_notes: [] },
        risk_notes: [],
        cost_tier: "low",
        initial_status: "planned",
      },
    ],
  };
}
