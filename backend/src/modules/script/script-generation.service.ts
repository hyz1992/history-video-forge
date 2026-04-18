import { ScriptDraftPackage } from "../../../../shared/src/index";

interface ScriptInputBundleInput {
  hard_lane: {
    event_identity: string;
    selected_angle: string;
    must_include_beats: string[];
  };
  soft_lane: {
    narrative_tension_map: {
      hook_claim: string;
      pressure_escalation: string;
      mid_reveal: string;
      peak_payoff: string;
      ending_residue: string;
    };
    strong_scene: string;
  };
  packaging_lane: {
    hook_claim: string;
  };
  topic_package: {
    canonical_quotes?: string[];
  };
}

export interface GenerateScriptDraftInput {
  bundle: ScriptInputBundleInput;
}

export function generateScriptDraft(input: GenerateScriptDraftInput) {
  const beats = input.bundle.hard_lane.must_include_beats;
  const quote = input.bundle.topic_package.canonical_quotes?.[0];
  const openingSpan = input.bundle.packaging_lane.hook_claim;
  const endingSpan = input.bundle.soft_lane.narrative_tension_map.ending_residue;

  const lines = [
    openingSpan,
    `${input.bundle.hard_lane.event_identity}这件事里，最先顶上来的不是答案，而是公开压场。`,
    ...beats.map(
      (beat, index) =>
        `${index + 1}. ${beat}，真正把局势往前推了一层。`,
    ),
    `${input.bundle.soft_lane.narrative_tension_map.mid_reveal}。`,
    `${input.bundle.soft_lane.narrative_tension_map.peak_payoff}。`,
  ];

  if (quote) {
    lines.push(`那句最关键的话就是“${quote}”。`);
  }

  lines.push(endingSpan);

  const scriptText = lines.join("\n");

  return ScriptDraftPackage.parse({
    script_text: scriptText,
    estimated_duration_sec: 88,
    beat_trace: beats.map((beat) => ({
      beat,
      excerpt: `${beat}，真正把局势往前推了一层。`,
      confidence: 0.92,
    })),
    quote_trace: quote
      ? [
          {
            quote,
            usage_type: "exact" as const,
            excerpt: `“${quote}”`,
          },
        ]
      : [],
    opening_span: openingSpan,
    ending_span: endingSpan,
  });
}
