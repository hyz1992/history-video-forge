import { z } from "zod";

export const ViralRubricLevel = z.enum(["low", "medium", "high"]);

export const ViralRubric = z
  .object({
    hook_power: ViralRubricLevel,
    novelty_gap: ViralRubricLevel,
    emotion_gap: ViralRubricLevel,
    share_impulse: ViralRubricLevel,
    visual_promise: ViralRubricLevel,
  })
  .strict();

export const TopicCandidateCard = z
  .object({
    title: z.string().min(1),
    one_line_angle: z.string().min(1),
    family_label: z.string().min(1),
    scope_label: z.string().min(1),
    estimated_duration_band: z.string().min(1),
    why_this_now: z.string().min(1),
    core_conflict: z.string().min(1),
    strong_scene: z.string().min(1),
    must_cover_preview: z.array(z.string()),
    risk_hints: z.array(z.string()),
    source_hint: z.string().min(1),
    recent_usage_hint: z.string().min(1),
    viral_rubric: ViralRubric,
  })
  .strict();

export type TopicCandidateCard = z.infer<typeof TopicCandidateCard>;
export type ViralRubric = z.infer<typeof ViralRubric>;
