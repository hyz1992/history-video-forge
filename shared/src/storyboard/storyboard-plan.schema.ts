import { z } from "zod";

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
    visual_strategy_preference: z
      .enum(["remotion_motion", "api_video"])
      .nullable()
      .optional(),
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
