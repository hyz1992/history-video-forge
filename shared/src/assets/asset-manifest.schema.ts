import { z } from "zod";

// ─── Enums ───────────────────────────────────────────────────────────────────

export const ArtifactType = z.enum([
  "tts_chunk_audio",
  "tts_merged_audio",
  "subtitle_track",
  "image",
  "video",
  "motion_recipe",
  "sfx_audio",
  "sfx_selection",
  "bgm_audio",
  "bgm_selection",
]);

export const ArtifactOrigin = z.enum([
  "provider",
  "local",
  "manual_upload",
  "library",
  "inline",
  "external_url",
]);

export const ExecutionStatus = z.enum([
  "planned",
  "ready",
  "running",
  "waiting_manual_upload",
  "waiting_manual_selection",
  "completed",
  "skipped_with_fallback",
  "failed",
  "accepted",
  "rejected",
]);

export const VisualRouteType = z.enum([
  "video_clip",
  "image_with_motion",
  "image_only",
  "missing",
]);

export const SegmentReadiness = z.enum([
  "ready",
  "blocked",
  "fallback_ready",
]);

export const ManifestReadiness = z.enum([
  "ready_for_compose",
  "blocked",
  "partial",
]);

// ─── Execution Options ───────────────────────────────────────────────────────

export const AssetExecutionOptions = z
  .object({
    execution_mode: z.enum(["auto_available", "dry_run"]),
    voice_profile_id: z.string().nullable(),
    enabled_provider_types: z.array(
      z.enum(["tts", "image", "video", "sfx", "bgm"]),
    ),
    allow_manual_placeholders: z.boolean(),
  })
  .strict();

// ─── Per-type artifact metadata schemas ──────────────────────────────────────
// Each metadata schema validates required fields for its artifact type.
// .strict().passthrough() means: require listed fields, reject unknown top-level
// keys, but the passthrough override re-allows extra provider-specific fields.

const TtsChunkAudioMetadata = z
  .object({
    duration_sec: z.number().positive(),
    voice_profile_id: z.string().min(1),
    provider_voice_id: z.string().min(1).nullable().optional(),
    voice_profile_match_score: z.number().min(0).max(1).optional(),
    voice_profile_match_reasons: z.array(z.string().min(1)).optional(),
    timing_source: z.enum(["provider", "estimated", "aligned"]).optional(),
    sample_rate: z.number().int().positive().optional(),
    format: z.string().min(1).optional(),
    tts_chunk_id: z.string().min(1),
    segment_ids: z.array(z.string().min(1)),
    script_excerpt: z.string().min(1),
  })
  .strict()
  .passthrough();

const TtsMergedAudioMetadata = z
  .object({
    duration_sec: z.number().positive(),
    voice_profile_id: z.string().min(1),
    provider_voice_id: z.string().min(1).nullable().optional(),
    voice_profile_match_score: z.number().min(0).max(1).optional(),
    voice_profile_match_reasons: z.array(z.string().min(1)).optional(),
    timing_source: z.enum(["provider", "estimated", "aligned"]).optional(),
    sample_rate: z.number().int().positive().optional(),
    format: z.string().min(1).optional(),
    chunk_artifact_ids: z.array(z.string().min(1)),
  })
  .strict()
  .passthrough();

const SubtitleTrackMetadata = z
  .object({
    format: z.string().min(1),
    source_tts_artifact_id: z.string().min(1),
    caption_count: z.number().int().nonnegative(),
  })
  .strict()
  .passthrough();

const ImageMetadata = z
  .object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })
  .strict()
  .passthrough();

const VideoMetadata = z
  .object({
    duration_sec: z.number().positive(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    fps: z.number().positive(),
  })
  .strict()
  .passthrough();

const MotionRecipeMetadata = z
  .object({
    recipe_type: z.string().min(1),
    source_image_artifact_id: z.string().min(1),
    parameters: z.record(z.string(), z.unknown()),
  })
  .strict()
  .passthrough();

const SfxAudioMetadata = z
  .object({
    duration_sec: z.number().positive(),
  })
  .strict()
  .passthrough();

// For selection types, use z.object (not strict) so extra fields pass through,
// then refine to ensure at least one identifier is present.
const SfxSelectionMetadata = z
  .object({
    library_item_id: z.string().min(1).optional(),
    selection_label: z.string().min(1).optional(),
  })
  .refine(
    (data) =>
      typeof data.library_item_id === "string" ||
      typeof data.selection_label === "string",
    {
      message:
        "At least one of library_item_id or selection_label is required",
    },
  );

const BgmAudioMetadata = z
  .object({
    duration_sec: z.number().positive(),
    loopable: z.boolean(),
  })
  .strict()
  .passthrough();

const BgmSelectionMetadata = z
  .object({
    library_item_id: z.string().min(1).optional(),
    selection_label: z.string().min(1).optional(),
  })
  .refine(
    (data) =>
      typeof data.library_item_id === "string" ||
      typeof data.selection_label === "string",
    {
      message:
        "At least one of library_item_id or selection_label is required",
    },
  );

// ─── AssetArtifact (discriminated union on artifact_type) ────────────────────
// Each variant includes the base artifact fields plus per-type metadata.

const ArtifactBaseFields = {
  artifact_id: z.string().min(1),
  origin: ArtifactOrigin,
  file_uri: z.string().min(1),
  created_at: z.string(),
};

export const AssetArtifact = z.discriminatedUnion("artifact_type", [
  z
    .object({
      ...ArtifactBaseFields,
      artifact_type: z.literal("tts_chunk_audio"),
      metadata: TtsChunkAudioMetadata,
    })
    .strict(),
  z
    .object({
      ...ArtifactBaseFields,
      artifact_type: z.literal("tts_merged_audio"),
      metadata: TtsMergedAudioMetadata,
    })
    .strict(),
  z
    .object({
      ...ArtifactBaseFields,
      artifact_type: z.literal("subtitle_track"),
      metadata: SubtitleTrackMetadata,
    })
    .strict(),
  z
    .object({
      ...ArtifactBaseFields,
      artifact_type: z.literal("image"),
      metadata: ImageMetadata,
    })
    .strict(),
  z
    .object({
      ...ArtifactBaseFields,
      artifact_type: z.literal("video"),
      metadata: VideoMetadata,
    })
    .strict(),
  z
    .object({
      ...ArtifactBaseFields,
      artifact_type: z.literal("motion_recipe"),
      metadata: MotionRecipeMetadata,
    })
    .strict(),
  z
    .object({
      ...ArtifactBaseFields,
      artifact_type: z.literal("sfx_audio"),
      metadata: SfxAudioMetadata,
    })
    .strict(),
  z
    .object({
      ...ArtifactBaseFields,
      artifact_type: z.literal("sfx_selection"),
      metadata: SfxSelectionMetadata,
    })
    .strict(),
  z
    .object({
      ...ArtifactBaseFields,
      artifact_type: z.literal("bgm_audio"),
      metadata: BgmAudioMetadata,
    })
    .strict(),
  z
    .object({
      ...ArtifactBaseFields,
      artifact_type: z.literal("bgm_selection"),
      metadata: BgmSelectionMetadata,
    })
    .strict(),
]);

// ─── Task Execution ──────────────────────────────────────────────────────────

export const AssetTaskExecution = z
  .object({
    execution_id: z.string().min(1),
    task_id: z.string().min(1),
    task_type: z.enum([
      "tts_audio",
      "image_still",
      "video_clip",
      "subtitle_track",
      "sfx_cue",
      "bgm_cue",
      "render_motion_cue",
    ]),
    status: ExecutionStatus,
    origin: ArtifactOrigin,
    started_at: z.string().nullable(),
    completed_at: z.string().nullable(),
    provider_id: z.string().nullable(),
    attempts: z.number().int().nonnegative(),
    output_artifact_ids: z.array(z.string().min(1)),
    notes: z.array(z.string()),
  })
  .strict();

// ─── BGM Placement ───────────────────────────────────────────────────────────

export const BgmPlacement = z
  .object({
    bgm_placement_id: z.string().min(1),
    scope: z.enum(["global", "segment", "segment_span"]),
    artifact_id: z.string().min(1).nullable(),
    start_policy: z.enum(["timeline_start", "segment_start"]),
    end_policy: z.enum([
      "timeline_end",
      "segment_end",
      "fade_out_after_span",
    ]),
    segment_ids: z.array(z.string().min(1)),
    volume: z.number().min(0).max(1).default(0.3),
    fade_in_sec: z.number().nonnegative().default(0),
    fade_out_sec: z.number().nonnegative().default(0),
  })
  .strict();

// ─── TTS Chunk Route ─────────────────────────────────────────────────────────

export const TtsChunkRoute = z
  .object({
    tts_chunk_id: z.string().min(1),
    artifact_id: z.string().min(1).nullable(),
    segment_ids: z.array(z.string().min(1)),
    script_excerpt: z.string().min(1),
  })
  .strict();

// ─── Audio Summary ───────────────────────────────────────────────────────────

export const AssetAudioSummary = z
  .object({
    voice_profile_id: z.string().min(1),
    tts_total_duration_sec: z.number().positive().nullable(),
    tts_chunk_artifact_ids: z.array(z.string().min(1)),
    tts_chunk_routes: z.array(TtsChunkRoute),
    tts_merged_artifact_id: z.string().min(1).nullable(),
    subtitle_artifact_id: z.string().min(1).nullable(),
    bgm_placements: z.array(BgmPlacement),
    sfx_artifact_ids: z.array(z.string().min(1)),
  })
  .strict();

// ─── Segment Asset Route ─────────────────────────────────────────────────────

export const SegmentAssetRoute = z
  .object({
    segment_id: z.string().min(1),
    tts_artifact_id: z.string().min(1).nullable(),
    subtitle_artifact_id: z.string().min(1).nullable(),
    primary_visual_artifact_id: z.string().min(1).nullable(),
    visual_route_type: VisualRouteType,
    motion_artifact_id: z.string().min(1).nullable(),
    fallback_visual_artifact_id: z.string().min(1).nullable(),
    sfx_artifact_ids: z.array(z.string().min(1)),
    bgm_placement_ids: z.array(z.string().min(1)),
    readiness: SegmentReadiness,
    notes: z.array(z.string()),
  })
  .strict();

// ─── Asset Manifest ──────────────────────────────────────────────────────────

export const AssetManifest = z
  .object({
    manifest_version: z.literal("asset_manifest_v1"),
    source_asset_plan_id: z.string().min(1),
    source_storyboard_record_id: z.string().min(1),
    source_script_record_id: z.string().min(1),
    execution_options: AssetExecutionOptions,
    executions: z.array(AssetTaskExecution),
    artifacts: z.array(AssetArtifact),
    audio_summary: AssetAudioSummary,
    segment_routes: z.array(SegmentAssetRoute),
    readiness: ManifestReadiness,
    notes: z.array(z.string()),
  })
  .strict();

// ─── Inferred types ──────────────────────────────────────────────────────────

export type AssetManifest = z.infer<typeof AssetManifest>;
export type AssetTaskExecution = z.infer<typeof AssetTaskExecution>;
export type AssetArtifact = z.infer<typeof AssetArtifact>;
export type SegmentAssetRoute = z.infer<typeof SegmentAssetRoute>;
export type AssetAudioSummary = z.infer<typeof AssetAudioSummary>;
export type BgmPlacement = z.infer<typeof BgmPlacement>;
export type TtsChunkRoute = z.infer<typeof TtsChunkRoute>;
export type AssetExecutionOptions = z.infer<typeof AssetExecutionOptions>;
