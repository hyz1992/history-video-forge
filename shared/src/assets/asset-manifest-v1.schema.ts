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
  "blocked_waiting_user",
]);

export const ManifestReadiness = z.enum([
  "ready_for_compose",
  "blocked",
  "partial",
]);

// ─── Execution Options ───────────────────────────────────────────────────────

/** provider 类型取值域（执行端与报价/提交过滤共用，单一真相源）。 */
export const AssetProviderType = z.enum(["tts", "image", "video", "sfx", "bgm"]);


export const SubtitleStyle = z
  .object({
    style_id: z.string().min(1),
    font_family: z.string().min(1),
    font_size_px: z.number().int().min(18).max(96),
    font_weight: z.number().int().min(100).max(900),
    line_height: z.number().min(1).max(2),
    max_lines: z.number().int().min(1).max(4),
    text_color: z.string().min(1),
    stroke_color: z.string().min(1),
    stroke_width_px: z.number().min(0).max(12),
    shadow: z.string().min(1),
    background_color: z.string().min(1),
    background_opacity: z.number().min(0).max(1),
    position: z.enum(["bottom", "middle", "top"]),
    horizontal_margin_px: z.number().int().min(0).max(240),
    bottom_margin_px: z.number().int().min(0).max(360),
    top_margin_px: z.number().int().min(0).max(360),
    safe_area_top_px: z.number().int().min(0).max(360),
    safe_area_bottom_px: z.number().int().min(0).max(360),
    max_width_pct: z.number().min(0.4).max(1),
    text_align: z.enum(["left", "center", "right"]),
  })
  .strict();

export const DEFAULT_SUBTITLE_STYLE = {
  style_id: "subtitle_style_default_vertical",
  font_family:
    "Microsoft YaHei, PingFang SC, Noto Sans CJK SC, Arial, sans-serif",
  font_size_px: 46,
  font_weight: 700,
  line_height: 1.5,
  max_lines: 2,
  text_color: "#ffffff",
  stroke_color: "#000000",
  stroke_width_px: 2.5,
  shadow: "0 2px 8px rgba(0,0,0,0.6)",
  background_color: "#000000",
  background_opacity: 0,
  position: "bottom",
  horizontal_margin_px: 48,
  bottom_margin_px: 120,
  top_margin_px: 120,
  safe_area_top_px: 96,
  safe_area_bottom_px: 96,
  max_width_pct: 0.9,
  text_align: "center",
} satisfies z.infer<typeof SubtitleStyle>;

export const AssetExecutionOptions = z
  .object({
    execution_mode: z.enum(["auto_available", "dry_run"]),
    voice_profile_id: z.string().nullable(),
    enabled_provider_types: z.array(AssetProviderType),
    allow_manual_placeholders: z.boolean(),
    /**
     * S2-2B：最终解析的字幕样式（快照 resolved_creative.subtitle.resolved_style
     * 投影到运行 manifest）。renderer 消费 subtitle artifact metadata.subtitle_style；
     * 缺省时执行端用系统默认（DEFAULT_SUBTITLE_STYLE）。
     */
    subtitle_style: SubtitleStyle.optional(),
  })
  .strict();

// ─── Per-type artifact metadata schemas ──────────────────────────────────────
// Each metadata schema validates required fields for its artifact type.
// .strict().passthrough() means: require listed fields, reject unknown top-level
// keys, but the passthrough override re-allows extra provider-specific fields.

const TimingSource = z.enum([
  "estimated",
  "audio_probe",
  "audio_probe_proportional",
  "provider_timestamp",
  "forced_alignment",
  "mixed",
  "provider",
  "aligned",
]);

const TtsChunkAudioMetadata = z
  .object({
    duration_sec: z.number().positive(),
    estimated_duration_sec: z.number().positive().optional(),
    duration_source: TimingSource.optional(),
    voice_profile_id: z.string().min(1),
    provider_voice_id: z.string().min(1).nullable().optional(),
    voice_profile_match_score: z.number().min(0).max(1).nullable().optional(),
    voice_profile_match_reasons: z.array(z.string().min(1)).optional(),
    timing_source: TimingSource.optional(),
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
    estimated_duration_sec: z.number().positive().optional(),
    duration_source: TimingSource.optional(),
    voice_profile_id: z.string().min(1),
    provider_voice_id: z.string().min(1).nullable().optional(),
    voice_profile_match_score: z.number().min(0).max(1).nullable().optional(),
    voice_profile_match_reasons: z.array(z.string().min(1)).optional(),
    timing_source: TimingSource.optional(),
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
    source_tts_chunk_artifact_ids: z.array(z.string().min(1)).optional(),
    caption_count: z.number().int().nonnegative(),
    duration_sec: z.number().positive().optional(),
    timing_source: TimingSource.optional(),
    subtitle_style: SubtitleStyle.optional(),
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
      // 与 AssetTaskType（asset-plan-v1）平行维护：漏改会使含 sheet execution
      // 的 manifest 解析硬失败（2026-09-18 设计 §3.1）。
      "character_sheet",
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
    source_task_id: z.string().min(1).optional(),
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

/**
 * 视频策略（S2-2A 任务 6）：项目冻结配置解析后的最终视频策略。
 * 决定 API 视频失败时的行为：严格（all_api_video 阻塞等用户决策）或自动降级。
 * 缺省 prefer_remotion 兼容旧 manifest。
 */
export const VideoStrategy = z.enum([
  "all_api_video",
  "prefer_api_video",
  "prefer_remotion",
  "all_remotion",
]);
export type VideoStrategy = z.infer<typeof VideoStrategy>;

/**
 * 视觉路线降级决策：none（未决策）/ automatic（自动降级）/ user_accepted（用户显式接受）。
 */
export const FallbackDecision = z.enum([
  "none",
  "automatic",
  "user_accepted",
]);
export type FallbackDecision = z.infer<typeof FallbackDecision>;

/** 路线决策事件（可审计）：automatic_fallback / fallback_accepted。 */
export const RouteDecisionEvent = z
  .object({
    event_type: z.enum(["automatic_fallback", "fallback_accepted"]),
    occurred_at: z.string().min(1),
    reason_code: z.string().min(1).nullable(),
  })
  .strict();
export type RouteDecisionEvent = z.infer<typeof RouteDecisionEvent>;

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
    video_strategy: VideoStrategy.default("prefer_remotion"),
    fallback_decision: FallbackDecision.default("none"),
    route_events: z.array(RouteDecisionEvent).default([]),
  })
  .strict();

// ─── Asset Manifest ──────────────────────────────────────────────────────────

export const AssetManifestV1 = z
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

export type AssetManifestV1 = z.infer<typeof AssetManifestV1>;
export type AssetTaskExecution = z.infer<typeof AssetTaskExecution>;
export type AssetArtifact = z.infer<typeof AssetArtifact>;
export type SegmentAssetRoute = z.infer<typeof SegmentAssetRoute>;
export type AssetAudioSummary = z.infer<typeof AssetAudioSummary>;
export type BgmPlacement = z.infer<typeof BgmPlacement>;
export type TtsChunkRoute = z.infer<typeof TtsChunkRoute>;
export type AssetExecutionOptions = z.infer<typeof AssetExecutionOptions>;
export type SubtitleStyle = z.infer<typeof SubtitleStyle>;
