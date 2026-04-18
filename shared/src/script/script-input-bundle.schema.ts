import { z } from "zod";

import { NarrativeTensionMap, TopicPackage } from "../topic/topic-package.schema";
import {
  RevealPosition,
  TopicDeliveryPack,
} from "../topic/topic-delivery-pack.schema";

export const ScriptInputBundle = z
  .object({
    topic_package: TopicPackage,
    topic_delivery_pack: TopicDeliveryPack,
    hard_lane: z
      .object({
        event_identity: z.string().min(1),
        selected_angle: z.string().min(1),
        scope_label: z.string().min(1),
        must_include_beats: z.array(z.string()),
        forbidden_expansions: z.array(z.string()),
        duration_band: z.string().min(1),
      })
      .strict(),
    soft_lane: z
      .object({
        narrative_tension_map: NarrativeTensionMap,
        strong_scene: z.string().min(1),
        voice_hint: z.string().min(1),
      })
      .strict(),
    packaging_lane: z
      .object({
        hook_claim: z.string().min(1),
        hook_emotion: z.string().min(1),
        reveal_position: RevealPosition,
        title_profile: z.string().min(1),
        cover_profile: z.string().min(1),
        risk_posture: z.string().min(1),
      })
      .strict(),
  })
  .strict();

export type ScriptInputBundle = z.infer<typeof ScriptInputBundle>;
