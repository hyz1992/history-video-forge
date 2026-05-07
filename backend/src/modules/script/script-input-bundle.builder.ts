import { ScriptInputBundle } from "../../../../shared/src/index";

interface ProjectStylePack {
  narrator_persona: string;
  wording_register: string;
  subtitle_profile: string;
  cover_profile: string;
  title_profile: string;
  pacing_baseline: string;
  risk_posture: string;
}

interface FamilyBiasPack {
  family_label: string;
  opening_pressure_bias: string;
  exposition_budget: string;
  pacing_bias: string;
  voice_bias: string;
  anti_patterns: string[];
}

interface TopicPackageInput {
  title: string;
  selected_angle: string;
  scope_label: string;
  core_conflict: string;
  stakes: string;
  must_include_beats: string[];
  forbidden_expansions: string[];
  source_anchor_refs: string[];
  canonical_quotes: string[];
  canonical_quote_intents?: Array<{ quote: string; intent: string }>;
  ambiguity_notes: string[];
  duration_band: string;
  narrative_tension_map: {
    hook_claim: string;
    pressure_escalation: string;
    mid_reveal: string;
    peak_payoff: string;
    ending_residue: string;
  };
  strong_scene: string;
}

interface TopicDeliveryPackInput {
  hook_claim: string;
  hook_emotion: string;
  reveal_position: "early" | "mid" | "late";
}

export interface BuildScriptInputBundleInput {
  topicPackage: TopicPackageInput;
  eventIdentity: string;
  topicDeliveryPack: TopicDeliveryPackInput & Record<string, unknown>;
  projectStylePack: ProjectStylePack;
  familyBiasPack: FamilyBiasPack;
}

export function buildScriptInputBundle(input: BuildScriptInputBundleInput) {
  return ScriptInputBundle.parse({
    topic_package: input.topicPackage,
    topic_delivery_pack: input.topicDeliveryPack,
    hard_lane: {
      event_identity: input.eventIdentity,
      selected_angle: input.topicPackage.selected_angle,
      scope_label: input.topicPackage.scope_label,
      core_conflict: input.topicPackage.core_conflict,
      stakes: input.topicPackage.stakes,
      must_include_beats: input.topicPackage.must_include_beats,
      forbidden_expansions: input.topicPackage.forbidden_expansions,
      source_anchor_refs: input.topicPackage.source_anchor_refs,
      canonical_quotes: input.topicPackage.canonical_quotes,
      canonical_quote_intents: input.topicPackage.canonical_quote_intents ?? [],
      ambiguity_notes: input.topicPackage.ambiguity_notes,
      duration_band: input.topicPackage.duration_band,
    },
    soft_lane: {
      narrative_tension_map: input.topicPackage.narrative_tension_map,
      strong_scene: input.topicPackage.strong_scene,
      voice_hint: `${input.projectStylePack.narrator_persona} / ${input.familyBiasPack.voice_bias}`,
    },
    packaging_lane: {
      hook_claim: input.topicDeliveryPack.hook_claim,
      hook_emotion: input.topicDeliveryPack.hook_emotion,
      reveal_position: input.topicDeliveryPack.reveal_position,
      title_profile: input.projectStylePack.title_profile,
      cover_profile: input.projectStylePack.cover_profile,
      risk_posture: input.projectStylePack.risk_posture,
    },
  });
}
