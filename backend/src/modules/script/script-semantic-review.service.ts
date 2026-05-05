import { ScriptSemanticReviewResult } from "../../../../shared/src/index";

interface ScriptInputBundleInput {
  hard_lane: {
    must_include_beats: string[];
    scope_label: string;
    selected_angle: string;
  };
  soft_lane: {
    narrative_tension_map: {
      hook_claim: string;
      pressure_escalation: string;
      mid_reveal: string;
      peak_payoff: string;
      ending_residue: string;
    };
  };
}

interface ScriptDraftInput {
  opening_span: string;
  ending_span: string;
  script_text: string;
}

export interface ReviewScriptSemanticsInput {
  bundle: ScriptInputBundleInput;
  draft: ScriptDraftInput;
}

export function reviewScriptSemantics(_input: ReviewScriptSemanticsInput) {
  return ScriptSemanticReviewResult.parse({
    stage: "script_semantic_review",
    decision: "skipped",
    patch_intent: null,
    hard_issues: [],
    soft_issues: [],
    patch_targets: [],
    summary: "当前环境未接入真实语义审校，跳过语义裁判。",
    confidence: 0.5,
  });
}
