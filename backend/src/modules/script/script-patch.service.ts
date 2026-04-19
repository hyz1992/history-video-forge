import {
  ScriptDraftPackage,
  type ScriptSemanticReviewResult,
} from "../../../../shared/src/index.js";

interface ScriptInputBundleInput {
  hard_lane: {
    event_identity: string;
    selected_angle: string;
  };
}

interface ScriptDraftInput {
  script_text: string;
  estimated_duration_sec: number;
  beat_trace: Array<Record<string, unknown>>;
  quote_trace: Array<Record<string, unknown>>;
  opening_span: string;
  ending_span: string;
}

export interface PatchScriptDraftInput {
  bundle: ScriptInputBundleInput;
  draft: ScriptDraftInput;
  semanticReview: ScriptSemanticReviewResult;
  patchUsed: boolean;
}

export async function patchScriptDraft(input: PatchScriptDraftInput) {
  if (input.patchUsed) {
    throw new Error("patch_once opportunity already consumed");
  }

  const openingSpan = input.semanticReview.patch_targets.includes("opening")
    ? buildLiftedOpening(input.bundle)
    : input.draft.opening_span;
  const endingSpan = input.semanticReview.patch_targets.includes("ending")
    ? buildLiftedEnding(input.bundle)
    : input.draft.ending_span;

  return ScriptDraftPackage.parse({
    ...input.draft,
    script_text: `${openingSpan}\n${input.draft.script_text}\n${endingSpan}`,
    opening_span: openingSpan,
    ending_span: endingSpan,
  });
}

function buildLiftedOpening(bundle: ScriptInputBundleInput) {
  const trimmedAngle = bundle.hard_lane.selected_angle.replace(/[。！？?!.]+$/u, "");
  return `如果有人当着所有人的面${trimmedAngle}，你敢不敢当场顶回去？`;
}

function buildLiftedEnding(bundle: ScriptInputBundleInput) {
  return `这种场面，一退掉的就不只是自己，而是${bundle.hard_lane.event_identity}背后的整张脸面。`;
}
