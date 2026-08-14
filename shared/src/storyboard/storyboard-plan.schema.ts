import { z } from "zod";

import { ApiVideoSuitability } from "../generation/generation-configuration.schema.js";

/**
 * 分镜四档视频适配度（详细设计 6.1 节）。
 * 复用 generation-configuration.schema 的 ApiVideoSuitability（单一来源）。
 * LLM/stub 只判断"静态图+Remotion 是否足够表达动作因果"，不决定付费调用。
 * 适配度到实际路线的映射由纯函数 resolver 完成。
 */

export const StoryboardSegment = z
  .object({
    segment_id: z.string().min(1),
    order: z.number().int().nonnegative(),
    script_excerpt: z.string().min(1),
    start_hint_sec: z.number().nonnegative(),
    end_hint_sec: z.number().positive(),
    narrative_role: z.enum([
      "opening",
      "setup",
      "pressure",
      "turn",
      "peak",
      "ending",
      "bridge",
    ]),
    visual_intent: z.string().min(1),
    scene_description: z.string().min(1),
    visual_elements: z.array(z.string().min(1)).min(1),
    framing_hint: z.enum(["wide", "medium", "close", "detail", "symbolic"]),
    content_type: z.enum(["live_action", "text_card", "map", "illustration"]),
    motion_hint: z.enum(["static", "push_in", "pull_back", "pan"]),
    editing_hint: z.enum(["single", "cutaway", "montage"]),
    on_screen_text: z.array(z.string().min(1)),
    linked_beats: z.array(z.string().min(1)),
    linked_quotes: z.array(z.string().min(1)),
    risk_notes: z.array(z.string().min(1)),
    /**
     * 四档视频适配度（必填，LLM/stub 都不能留空）。
     * 取代旧 visual_strategy_preference（S2-2A 任务 4）。
     */
    api_video_suitability: ApiVideoSuitability,
    /**
     * 只读历史提示：旧 StoryboardPlan 的 visual_strategy_preference 经兼容解码器
     * 确定性映射而来。新生成的 plan 恒为 null；不写入 override、不进入新 prompt。
     */
    legacy_visual_strategy_hint: ApiVideoSuitability.nullable().default(null),
  })
  .strict()
  .refine((segment) => segment.end_hint_sec > segment.start_hint_sec, {
    message: "end_hint_sec must be greater than start_hint_sec",
  });

export const StoryboardPlan = z
  .object({
    plan_version: z.literal("storyboard_v1"),
    source_script_record_id: z.string().min(1),
    source_topic_package_id: z.string().min(1),
    estimated_total_duration_sec: z.number().positive(),
    segments: z.array(StoryboardSegment).min(1),
    global_visual_notes: z.array(z.string().min(1)),
  })
  .strict();

export type StoryboardPlan = z.infer<typeof StoryboardPlan>;
export type StoryboardSegment = z.infer<typeof StoryboardSegment>;
