import { z } from "zod";

export const ScriptWritingBriefShadow = z
  .object({
    stage: z.literal("script_writing_brief_shadow"),
    topic_id: z.string().min(1),
    event_focus: z.string().min(1),
    opening_bridge_intent: z.string().min(1),
    beat_units: z
      .array(
        z
          .object({
            beat: z.string().min(1),
            scene_pressure: z.string().min(1),
            actor_action: z.string().min(1),
            opponent_reaction: z.string().min(1),
            immediate_consequence: z.string().min(1),
            source_basis: z.enum([
              "topic_package",
              "canonical_quote",
              "narrative_tension_map",
              "inferred_from_topic",
            ]),
            confidence: z.enum(["high", "medium", "low"]),
          })
          .strict(),
      )
      .min(1),
    iconic_moment_intents: z.array(
      z
        .object({
          moment: z.string().min(1),
          usage_intent: z.string().min(1),
          source_basis: z.enum([
            "canonical_quote",
            "must_include_beat",
            "source_anchor",
          ]),
        })
        .strict(),
    ),
    ending_residue_target: z.string().min(1),
    factual_bounds: z.array(z.string().min(1)),
    material_gaps: z.array(
      z
        .object({
          gap: z.string().min(1),
          impact: z.string().min(1),
        })
        .strict(),
    ),
  })
  .strict();

export type ScriptWritingBriefShadow = z.infer<
  typeof ScriptWritingBriefShadow
>;
