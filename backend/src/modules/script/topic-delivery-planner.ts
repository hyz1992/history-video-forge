import { TopicDeliveryPack } from "../../../../shared/src/index";

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
  family_label: string;
  strong_scene: string;
  narrative_tension_map: {
    hook_claim: string;
    pressure_escalation: string;
    mid_reveal: string;
    peak_payoff: string;
    ending_residue: string;
  };
}

export interface PlanTopicDeliveryInput {
  topicPackage: TopicPackageInput;
  projectStylePack: ProjectStylePack;
  familyBiasPack: FamilyBiasPack;
}

function resolveHookEmotion(input: PlanTopicDeliveryInput) {
  if (
    input.topicPackage.family_label === "外交压场型" ||
    input.topicPackage.family_label === "君臣博弈型"
  ) {
    return "压迫";
  }

  if (input.familyBiasPack.opening_pressure_bias === "high") {
    return "紧张";
  }

  return "好奇";
}

function resolveRevealPosition(input: PlanTopicDeliveryInput) {
  if (input.familyBiasPack.exposition_budget === "low") {
    return "mid";
  }

  return "late";
}

export function planTopicDelivery(input: PlanTopicDeliveryInput) {
  return TopicDeliveryPack.parse({
    opening_move: "question",
    opening_pressure_level: input.familyBiasPack.opening_pressure_bias,
    voice_tilt: input.familyBiasPack.voice_bias,
    pacing_tilt: input.familyBiasPack.pacing_bias,
    ending_tilt: "judgment",
    visual_tilt: ["faces", "courtroom"],
    hook_claim: input.topicPackage.narrative_tension_map.hook_claim,
    hook_emotion: resolveHookEmotion(input),
    reveal_position: resolveRevealPosition(input),
    caution_notes: [
      "不要把 hook 写成课堂导入",
      "不要让包装 promise 偏离 narrative_tension_map.hook_claim",
      ...input.familyBiasPack.anti_patterns,
    ],
  });
}
