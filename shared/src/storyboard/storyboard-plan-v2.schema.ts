import { z } from "zod";
import { StoryboardPlanV1, StoryboardSegment } from "./storyboard-plan-v1.schema.js";
import { NarrationReference, NarrationVisualRange } from "../narration/narration-reference.schema.js";

export const StoryboardSegmentV2 = StoryboardSegment.innerType().extend(NarrationVisualRange.innerType().shape)
  .refine(r => r.source_end > r.source_start && r.visual_end_ms > r.visual_start_ms &&
    r.start_boundary_id !== r.end_boundary_id && r.start_hint_sec === r.visual_start_ms / 1000 &&
    r.end_hint_sec === r.visual_end_ms / 1000 && r.script_excerpt.length === r.source_end - r.source_start,
  { message: "storyboard_v2_range_invalid" });
const StoryboardPlanV2Object = StoryboardPlanV1.extend({
  plan_version: z.literal("storyboard_v2"), narration_reference: NarrationReference,
  segments: z.array(StoryboardSegmentV2).min(1),
});
export const StoryboardPlanV2 = StoryboardPlanV2Object.superRefine((p, ctx) => {
  let time = 0; let source = 0; let previousBoundary: string | undefined;
  const ids = new Set<string>();
  for (const [i, s] of p.segments.entries()) {
    if (s.visual_start_ms !== time || s.source_start !== source || s.order !== i || ids.has(s.segment_id) ||
      (previousBoundary !== undefined && s.start_boundary_id !== previousBoundary)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "storyboard_v2_discontinuous" });
    time = s.visual_end_ms; source = s.source_end; previousBoundary = s.end_boundary_id; ids.add(s.segment_id);
  }
  if (time !== p.narration_reference.duration_ms || p.estimated_total_duration_sec !== time / 1000) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "storyboard_v2_duration_mismatch" });
});
export type StoryboardPlanV2 = z.infer<typeof StoryboardPlanV2>;
