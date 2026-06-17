import { z } from "zod";

export const CoverOrigin = z.enum([
  "storyboard_image",
  "manual_upload",
  "generated",
]);

export const TitleStyle = z.enum([
  "standard",
  "suspense",
  "knowledge",
  "emotional",
]);

export const PlatformProfile = z.enum([
  "douyin",
  "bilibili",
  "youtube",
  "generic",
]);

export const PublishReadiness = z.enum(["draft", "ready", "blocked"]);

export const TitleCandidate = z
  .object({
    candidate_id: z.string(),
    text: z.string(),
    style: TitleStyle,
  })
  .strict();

export const PublishPackage = z
  .object({
    package_version: z.literal("publish_package_v1"),
    source_render_job_record_id: z.string(),
    source_topic_package_id: z.string(),
    source_script_record_id: z.string(),
    source_storyboard_record_id: z.string(),
    source_asset_manifest_record_id: z.string(),

    // 视频 — 引用 render 产出的 ExportArtifact
    video_export_artifact_id: z.string(),

    // 封面 — 单张，编辑方式对齐分镜图 prompt_draft
    cover_artifact_id: z.string().nullable(),
    cover_prompt_draft: z.string().nullable(),
    cover_origin: CoverOrigin.default("storyboard_image"),

    // 标题
    title_candidates: z.array(TitleCandidate),
    selected_title: z.string(),

    // 描述
    description: z.string(),

    // 话题标签
    hashtags: z.array(z.string()),

    // 平台适配
    platform_profile: PlatformProfile.default("generic"),

    // 就绪状态
    readiness: PublishReadiness,
    notes: z.array(z.string()),
  })
  .strict();

export type CoverOrigin = z.infer<typeof CoverOrigin>;
export type TitleStyle = z.infer<typeof TitleStyle>;
export type PlatformProfile = z.infer<typeof PlatformProfile>;
export type PublishReadiness = z.infer<typeof PublishReadiness>;
export type TitleCandidate = z.infer<typeof TitleCandidate>;
export type PublishPackage = z.infer<typeof PublishPackage>;
