import { z } from "zod";

export const RevealPosition = z.enum(["early", "mid", "late"]);

export const TopicDeliveryPack = z
  .object({
    opening_move: z.string().min(1),
    opening_pressure_level: z.string().min(1),
    voice_tilt: z.string().min(1),
    pacing_tilt: z.string().min(1),
    ending_tilt: z.string().min(1),
    visual_tilt: z.array(z.string()),
    hook_claim: z.string().min(1),
    hook_emotion: z.string().min(1),
    reveal_position: RevealPosition,
    caution_notes: z.array(z.string()),
  })
  .strict();

export type RevealPosition = z.infer<typeof RevealPosition>;
export type TopicDeliveryPack = z.infer<typeof TopicDeliveryPack>;
