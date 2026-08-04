import { z } from "zod";

import { VoiceIntent } from "../voice/voice-profile.schema";

export const AssetTaskType = z.enum([
  "tts_audio",
  "image_still",
  "video_clip",
  "subtitle_track",
  "sfx_cue",
  "bgm_cue",
  "render_motion_cue",
]);

export const AssetTaskRecommendedMode = z.enum([
  "auto",
  "manual_allowed",
  "manual_preferred",
  "placeholder_only",
]);

export const AssetTaskCostTier = z.enum(["free", "low", "medium", "high"]);

export const AssetTaskInitialStatus = z.enum(["planned", "blocked"]);

export const AssetTaskDependencyType = z.enum([
  "requires_output",
  "requires_timing",
  "requires_selection",
]);

export const ArtBibleCharacter = z
  .object({
    character_id: z.string().min(1),
    label: z.string().min(1),
    role: z.string().min(1),
    visual_description: z.string().min(1),
    consistency_notes: z.array(z.string().min(1)),
  })
  .strict();

export const ArtBibleLocation = z
  .object({
    location_id: z.string().min(1),
    label: z.string().min(1),
    role: z.string().min(1).nullish(),
    visual_description: z.string().min(1),
    consistency_notes: z.array(z.string().min(1)),
  })
  .strict();

export const ArtBibleProp = z
  .object({
    prop_id: z.string().min(1),
    label: z.string().min(1),
    role: z.string().min(1).nullish(),
    visual_description: z.string().min(1),
    consistency_notes: z.array(z.string().min(1)),
  })
  .strict();

export const ProjectArtBible = z
  .object({
    era_style: z.string().min(1),
    visual_tone: z.string().min(1),
    characters: z.array(ArtBibleCharacter),
    locations: z.array(ArtBibleLocation),
    props: z.array(ArtBibleProp),
    global_prompt_prefix: z.string().min(1),
    global_negative_prompts: z.array(z.string().min(1)),
    consistency_notes: z.array(z.string().min(1)),
  })
  .strict();

export const TtsPlanChunk = z
  .object({
    chunk_id: z.string().min(1),
    order: z.number().int().nonnegative(),
    script_excerpt: z.string().min(1),
    estimated_duration_sec: z.number().positive(),
  })
  .strict();

export const TtsPlanningSummary = z
  .object({
    voice_profile_id: z.string().min(1),
    estimated_total_duration_sec: z.number().positive(),
    chunking_strategy: z.enum(["sentence_boundary", "segment_boundary"]),
    chunks: z.array(TtsPlanChunk),
  })
  .strict();

export const ManualUploadPolicy = z
  .object({
    allowed: z.boolean().default(false),
    required: z.boolean().default(false),
    accepted_file_types: z.array(z.string().min(1)).default([]),
    acceptance_notes: z.array(z.string().min(1)).default([]),
  })
  .strict()
  .default({ allowed: false, required: false, accepted_file_types: [], acceptance_notes: [] });

export const AssetTask = z
  .object({
    task_id: z.string().min(1),
    order: z.number().int().nonnegative(),
    task_type: AssetTaskType,
    source_segment_id: z.string().min(1).nullable(),
    source_excerpt: z.string().min(1),
    production_intent: z.string().min(1),
    recommended_mode: AssetTaskRecommendedMode,
    provider_hint: z.string().min(1).nullable(),
    prompt_draft: z.string().min(1).nullable(),
    parameters: z.record(z.string(), z.unknown()),
    manual_upload_policy: ManualUploadPolicy,
    risk_notes: z.array(z.string().min(1)),
    cost_tier: AssetTaskCostTier,
    initial_status: AssetTaskInitialStatus,
  })
  .strict()
  .refine(
    (task) =>
      task.task_type === "tts_audio" ||
      task.task_type === "subtitle_track" ||
      task.task_type === "sfx_cue" ||
      task.task_type === "bgm_cue" ||
      task.task_type === "render_motion_cue" ||
      Boolean(task.prompt_draft),
    {
      message: "visual provider tasks require prompt_draft",
      path: ["prompt_draft"],
    },
  );

export const AssetTaskDependency = z
  .object({
    dependency_id: z.string().min(1),
    task_id: z.string().min(1),
    depends_on_task_id: z.string().min(1),
    dependency_type: AssetTaskDependencyType,
  })
  .strict();

export const AssetCostSummary = z
  .object({
    total_tasks: z.number().int().nonnegative(),
    by_type: z.record(z.string(), z.number().int().nonnegative()),
    by_cost_tier: z.record(z.string(), z.number().int().nonnegative()),
    estimated_provider_calls: z.number().int().nonnegative(),
    notes: z.array(z.string().min(1)),
  })
  .strict();

export const AssetPlan = z
  .object({
    plan_version: z.literal("asset_plan_v1"),
    source_storyboard_record_id: z.string().min(1),
    source_script_record_id: z.string().min(1),
    source_topic_package_id: z.string().min(1),
    art_bible: ProjectArtBible,
    visual_budget: z.record(z.string(), z.unknown()).default({}),
    downgrade_policy: z.record(z.string(), z.unknown()).default({}),
    global_audio_strategy: z
      .object({
        voice_intent: VoiceIntent.optional(),
      })
      .passthrough()
      .default({}),
    tts_plan: TtsPlanningSummary,
    tasks: z.array(AssetTask).min(1),
    dependencies: z.array(AssetTaskDependency),
    cost_summary: AssetCostSummary,
    global_production_notes: z.array(z.string().min(1)),
  })
  .strict();

export type AssetPlan = z.infer<typeof AssetPlan>;
export type AssetTask = z.infer<typeof AssetTask>;
export type ProjectArtBible = z.infer<typeof ProjectArtBible>;
