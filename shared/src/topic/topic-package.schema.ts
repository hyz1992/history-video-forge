import { z } from "zod";

export const NarrativeTensionMap = z
  .object({
    hook_claim: z.string().min(1),
    pressure_escalation: z.string().min(1),
    mid_reveal: z.string().min(1),
    peak_payoff: z.string().min(1),
    ending_residue: z.string().min(1),
  })
  .strict();

export const CanonicalQuoteIntent = z
  .object({
    quote: z.string().min(1),
    intent: z.string().min(1),
  })
  .strict();

export const TopicPackage = z
  .object({
    topic_id: z.string().min(1),
    title: z.string().min(1),
    selected_angle: z.string().min(1),
    family_label: z.string().min(1),
    scope_label: z.string().min(1),
    core_conflict: z.string().min(1),
    stakes: z.string().min(1),
    strong_scene: z.string().min(1),
    packaging_seed: z.string().min(1),
    must_include_beats: z.array(z.string()),
    forbidden_expansions: z.array(z.string()),
    risk_hints: z.array(z.string()),
    source_anchor_refs: z.array(z.string().min(1)).min(1),
    canonical_quotes: z.array(z.string()),
    canonical_quote_intents: z.array(CanonicalQuoteIntent).default([]),
    ambiguity_notes: z.array(z.string().min(1)),
    duration_band: z.string().min(1),
    narrative_tension_map: NarrativeTensionMap,
    source_mode: z.enum(["recommended", "library", "custom"]).default("recommended"),
    source_ref: z.record(z.unknown()).nullable().default(null),
  })
  .strict();

export type NarrativeTensionMap = z.infer<typeof NarrativeTensionMap>;
export type CanonicalQuoteIntent = z.infer<typeof CanonicalQuoteIntent>;
export type TopicPackage = z.infer<typeof TopicPackage>;
