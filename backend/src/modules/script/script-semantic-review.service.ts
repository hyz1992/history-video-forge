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

export function reviewScriptSemantics(input: ReviewScriptSemanticsInput) {
  const openingWeak = !input.draft.opening_span.includes("所有人");
  const endingWeak = input.draft.ending_span.length < 18;

  if (openingWeak || endingWeak) {
    return ScriptSemanticReviewResult.parse({
      stage: "script_semantic_review",
      decision: "patch_once",
      patch_intent: "lift",
      hard_issues: [],
      soft_issues: [
        ...(openingWeak ? ["hook_kill_power_weak"] : []),
        ...(endingWeak ? ["ending_residue_weak"] : []),
      ],
      patch_targets: [
        ...(openingWeak ? ["opening"] : []),
        ...(endingWeak ? ["ending"] : []),
      ],
      summary: "结构合格，但开头和结尾的势能还可以再抬一次。",
      confidence: 0.82,
    });
  }

  return ScriptSemanticReviewResult.parse({
    stage: "script_semantic_review",
    decision: "pass",
    patch_intent: null,
    hard_issues: [],
    soft_issues: [],
    patch_targets: [],
    summary: "当前稿件可继续进入下游阶段。",
    confidence: 0.86,
  });
}
