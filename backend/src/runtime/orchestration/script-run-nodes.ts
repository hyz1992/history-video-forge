import type { ScriptInputBundle } from "../../../../shared/src/index.js";
import type { patchScriptDraft } from "../../modules/script/script-patch.service.js";
import type { regenerateScriptDraft } from "../../modules/script/script-regenerate.service.js";
import type { generateScriptDraft } from "../../modules/script/script-generation.service.js";
import type { reviewScriptSemantics } from "../../modules/script/script-semantic-review.service.js";
import type { validateScriptDraft } from "../../modules/script/script-local-validator.js";
import type { StepTraceLogEntry } from "../trace/step-trace-log.js";
import { createStepTraceLog } from "../trace/step-trace-log.js";

import {
  createNodeStateUpdate,
  type TopicScriptGraphState,
} from "./graph-state.js";
import type { RuntimeDiagnosticCheck } from "./runtime-diagnostics.js";

type ScriptDraft = Awaited<ReturnType<typeof generateScriptDraft>>;
type LocalValidation = ReturnType<typeof validateScriptDraft>;
type SemanticReview = Awaited<ReturnType<typeof reviewScriptSemantics>>;

interface PendingThinRegenCheck {
  previousScriptText: string;
}

export interface ScriptRunGraphDependencies {
  generateDraft: typeof generateScriptDraft;
  validateDraft: typeof validateScriptDraft;
  reviewSemantics: typeof reviewScriptSemantics;
  patchDraft: typeof patchScriptDraft;
  regenerateDraft: typeof regenerateScriptDraft;
}

export interface ScriptRunGraphRuntime {
  bundle: ScriptInputBundle;
  allowPatch: boolean;
  allowRegen: boolean;
  allowLocalRepairRegen: boolean;
  forceRegen: boolean;
  regenerateUsed: boolean;
  draft: ScriptDraft | null;
  localValidation: LocalValidation | null;
  semanticReview: SemanticReview | ReturnType<typeof buildSkippedSemanticReview> | null;
  lastPatchIntent: "fix" | "lift" | null;
  stepLogs: StepTraceLogEntry[];
  runtimeDiagnostics: RuntimeDiagnosticCheck[];
  pendingThinRegenCheck: PendingThinRegenCheck | null;
}

function requireDraft(draft: ScriptDraft | null, nodeName: string): ScriptDraft {
  if (!draft) {
    throw new Error(`${nodeName} requires an existing draft`);
  }

  return draft;
}

function requireLocalValidation(
  localValidation: LocalValidation | null,
  nodeName: string,
): LocalValidation {
  if (!localValidation) {
    throw new Error(`${nodeName} requires local validation output`);
  }

  return localValidation;
}

function requireSemanticReview(
  semanticReview: ScriptRunGraphRuntime["semanticReview"],
  nodeName: string,
) {
  if (!semanticReview) {
    throw new Error(`${nodeName} requires semantic review output`);
  }

  return semanticReview;
}

export function buildSkippedSemanticReview(input: {
  localDecision: "pass" | "regen_once" | "hard_fail";
  allowRegen: boolean;
  regenerateUsed?: boolean;
}) {
  const summary = resolveSkippedSemanticReviewSummary({
    localDecision: input.localDecision,
    regenerateUsed: input.regenerateUsed ?? false,
  });

  return {
    stage: "script_semantic_review" as const,
    decision: "skipped" as const,
    patch_intent: null,
    hard_issues: [],
    soft_issues: [],
    patch_targets: [],
    summary,
    confidence: 0.5,
  };
}

function resolveSkippedSemanticReviewSummary(input: {
  localDecision: "pass" | "regen_once" | "hard_fail";
  regenerateUsed: boolean;
}): string {
  if (input.localDecision === "hard_fail") {
    return "稿件存在不可恢复的结构问题（如必填字段缺失或时长极端），已停止自动推进，未进入语义审校。";
  }

  if (input.localDecision === "regen_once" && input.regenerateUsed) {
    return "已自动重新生成一次，仍未达到本地结构下限，未进入语义审校。可使用“带反馈重新生成”再做一次人工修复。";
  }

  return "本次稿件未达到本地结构下限，未进入语义审校。";
}

export function createScriptRunNodes(input: {
  runtime: ScriptRunGraphRuntime;
  dependencies: ScriptRunGraphDependencies;
}) {
  const { runtime, dependencies } = input;

  function recordStepTrace(
    stepName: string,
    startedAt: Date,
    stateUpdate: Partial<TopicScriptGraphState>,
  ) {
    runtime.stepLogs.push(
      createStepTraceLog({
        stepName,
        phase: "script",
        startedAt,
        endedAt: new Date(),
        inputRef: stateUpdate.input_ref ?? null,
        outputRef: stateUpdate.output_ref ?? null,
        failureReason: stateUpdate.failure_reason ?? null,
      }),
    );
  }

  return {
    async scriptGenerate() {
      const startedAt = new Date();
      runtime.draft = await dependencies.generateDraft({
        bundle: runtime.bundle,
      });

      const stateUpdate = createNodeStateUpdate("script-generate", {
        input_ref: `script-input-bundle:${runtime.bundle.topic_package.topic_id}`,
        output_ref: "script-draft:current",
        failure_reason: null,
      });
      recordStepTrace("script-generate", startedAt, stateUpdate);

      return stateUpdate;
    },

    localValidate() {
      const startedAt = new Date();
      const draft = requireDraft(runtime.draft, "local-validate");
      runtime.localValidation = dependencies.validateDraft({
        bundle: runtime.bundle,
        draft,
      });

      if (runtime.localValidation.decision !== "pass") {
        runtime.semanticReview = buildSkippedSemanticReview({
          localDecision: runtime.localValidation.decision,
          allowRegen: runtime.allowRegen,
          regenerateUsed: runtime.regenerateUsed,
        });
      }

      if (
        runtime.pendingThinRegenCheck &&
        runtime.localValidation.errors.includes("script_body_too_thin")
      ) {
        const outputUnchanged =
          draft.script_text.trim() ===
          runtime.pendingThinRegenCheck.previousScriptText;
        runtime.runtimeDiagnostics.push({
          code: outputUnchanged
            ? "regen_output_unchanged_after_thin_context"
            : "regen_output_still_too_thin_after_repair_context",
          level: "warning",
        });
      }
      runtime.pendingThinRegenCheck = null;

      const stateUpdate = createNodeStateUpdate("local-validate", {
        input_ref: "script-draft:current",
        output_ref: "script-local-validation:current",
        failure_reason:
          runtime.localValidation.decision === "hard_fail"
            ? ((runtime.localValidation as Record<string, unknown>).summary as string)
            : null,
      });
      recordStepTrace("local-validate", startedAt, stateUpdate);

      return stateUpdate;
    },

    async semanticReview() {
      const startedAt = new Date();
      const draft = requireDraft(runtime.draft, "semantic-review");
      const localValidation = requireLocalValidation(
        runtime.localValidation,
        "semantic-review",
      );

      runtime.semanticReview =
        localValidation.decision === "pass"
          ? await dependencies.reviewSemantics({
              bundle: runtime.bundle,
              draft,
            })
          : buildSkippedSemanticReview({
              localDecision: localValidation.decision,
            allowRegen: runtime.allowRegen,
            regenerateUsed: runtime.regenerateUsed,
          });

      const stateUpdate = createNodeStateUpdate("semantic-review", {
        input_ref: "script-local-validation:current",
        output_ref: "script-semantic-review:current",
        failure_reason:
          (runtime.semanticReview.decision as string) === "hard_fail"
            ? ((runtime.semanticReview as Record<string, unknown>).summary as string)
            : null,
      });
      recordStepTrace("semantic-review", startedAt, stateUpdate);

      return stateUpdate;
    },

    async patchOnce(state: TopicScriptGraphState) {
      const startedAt = new Date();
      const draft = requireDraft(runtime.draft, "patch-once");
      const semanticReview = requireSemanticReview(
        runtime.semanticReview,
        "patch-once",
      );

      runtime.lastPatchIntent = semanticReview.patch_intent;
      runtime.draft = await dependencies.patchDraft({
        bundle: runtime.bundle,
        draft,
        semanticReview,
        patchUsed: state.patch_used,
      });

      const stateUpdate = createNodeStateUpdate("patch-once", {
        input_ref: "script-semantic-review:current",
        output_ref: "script-draft:current",
        patch_used: true,
        failure_reason: null,
      });
      recordStepTrace("patch-once", startedAt, stateUpdate);

      return stateUpdate;
    },

    async regenOnce(state: TopicScriptGraphState) {
      const startedAt = new Date();
      const previousDraft = runtime.draft;
      const previousLocalValidation = runtime.localValidation;
      runtime.pendingThinRegenCheck =
        previousDraft &&
        previousLocalValidation?.errors.includes("script_body_too_thin")
          ? {
              previousScriptText: previousDraft.script_text.trim(),
            }
          : null;

      runtime.draft = await dependencies.regenerateDraft({
        bundle: runtime.bundle,
        draft: runtime.draft ?? undefined,
        regenerateUsed: state.regenerate_used,
        localValidation: runtime.localValidation ?? undefined,
        generateDraft: (generateInput) =>
          dependencies.generateDraft({
            bundle: runtime.bundle,
            regenerationContext: generateInput?.regenerationContext,
          }),
      });
      runtime.regenerateUsed = true;

      const stateUpdate = createNodeStateUpdate("regen-once", {
        input_ref: runtime.localValidation
          ? "script-local-validation:current"
          : "script-semantic-review:current",
        output_ref: "script-draft:current",
        regenerate_used: true,
        failure_reason: null,
      });
      recordStepTrace("regen-once", startedAt, stateUpdate);

      return stateUpdate;
    },
  };
}
