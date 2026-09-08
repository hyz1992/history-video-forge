import { z } from "zod";
import { NarrationInteger, NarrationSha256 } from "./narration-timing.schema.js";

const id = z.string().min(1);
export const NarrationReference = z.object({
  narration_record_id: id, audio_hash: NarrationSha256, timing_map_hash: NarrationSha256,
  duration_ms: NarrationInteger.positive(),
}).strict();
export type NarrationReference = z.infer<typeof NarrationReference>;
export const NarrationVisualRange = z.object({
  start_boundary_id: id, end_boundary_id: id,
  source_start: NarrationInteger, source_end: NarrationInteger,
  visual_start_ms: NarrationInteger, visual_end_ms: NarrationInteger,
}).strict().refine(r => r.source_end > r.source_start && r.visual_end_ms > r.visual_start_ms &&
  r.start_boundary_id !== r.end_boundary_id, { message: "narration_visual_range_invalid" });
export type NarrationVisualRange = z.infer<typeof NarrationVisualRange>;

