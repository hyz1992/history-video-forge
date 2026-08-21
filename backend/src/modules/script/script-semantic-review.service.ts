import { ScriptSemanticReviewResult, type ResolvedCapabilityMap } from "../../../../shared/src/index";
import { env, getValidatedRuntimeEnv } from "../../config/env.js";
import { createLlmGateway, type LlmGateway } from "../../runtime/llm/llm-gateway.js";
import type { StructuredPromptProvider } from "../../runtime/llm/provider-contract.js";
import type { LlmInteractionLogWriter } from "../../runtime/llm/interaction-log.js";
import { createTierAwareProviderFromEnv } from "../../runtime/llm/tier-aware-provider-factory.js";
import { createPromptRegistry } from "../../runtime/prompts/prompt-registry.js";

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
  llmGateway?: LlmGateway;
  interactionLogWriter?: LlmInteractionLogWriter;
  /**
   * S2-2C（详细设计 §6.1）：快照冻结 capabilities（shadow reviewer 跟随
   * smart 槽位）；来源 `billingContext.resolved.resolved_capabilities`。
   */
  snapshotCapabilities?: ResolvedCapabilityMap;
}

export async function reviewScriptSemantics(input: ReviewScriptSemanticsInput) {
  const gateway = input.llmGateway ?? createSemanticReviewerGateway(input.snapshotCapabilities);
  if (!gateway) {
    return buildSkippedSemanticReview();
  }

  try {
    const rawReview = await gateway.invokeStructuredPrompt<unknown>({
      promptId: "script.semantic-reviewer",
      input: {
        bundle: input.bundle,
        draft: input.draft,
      },
      interactionLogWriter: input.interactionLogWriter,
    });

    return ScriptSemanticReviewResult.parse(normalizeSemanticReview(rawReview));
  } catch {
    return buildSkippedSemanticReview();
  }
}

function normalizeSemanticReview(rawReview: unknown) {
  if (!rawReview || typeof rawReview !== "object") {
    return rawReview;
  }

  const record = rawReview as Record<string, unknown>;
  const review = record.stage === "script_semantic_review" ? record : getWrappedAnswer(record);

  if (!review) {
    return rawReview;
  }

  const decision = review.decision;
  if (
    decision !== "pass" &&
    decision !== "patch_once" &&
    decision !== "regen_once" &&
    decision !== "return_topic"
  ) {
    return rawReview;
  }

  const summary =
    typeof review.summary === "string"
      ? review.summary
      : typeof review.explanation === "string"
        ? review.explanation
        : "";

  return {
    stage: "script_semantic_review",
    decision,
    patch_intent:
      review.patch_intent === "fix" || review.patch_intent === "lift"
        ? review.patch_intent
        : decision === "patch_once"
          ? "lift"
          : null,
    hard_issues: normalizeIssueList(review.hard_issues),
    soft_issues: normalizeIssueList(review.soft_issues ?? review.tags),
    patch_targets: normalizePatchTargets(review.patch_targets ?? review.patch_points),
    summary,
    confidence: typeof review.confidence === "number" ? review.confidence : 0.6,
  };
}

function getWrappedAnswer(record: Record<string, unknown>) {
  return record.answer &&
    typeof record.answer === "object" &&
    !Array.isArray(record.answer)
    ? (record.answer as Record<string, unknown>)
    : null;
}

function normalizeIssueList(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (typeof item === "string") {
        return item.length > 0 ? item : null;
      }
      if (!item || typeof item !== "object") {
        return null;
      }

      const record = item as Record<string, unknown>;
      const code = record.code ?? record.issue_type;
      const message = record.message ?? record.description;
      return {
        ...(typeof code === "string" && code.length > 0 ? { code } : {}),
        ...(typeof message === "string" && message.length > 0 ? { message } : {}),
        ...(typeof record.field === "string" || record.field === null
          ? { field: record.field }
          : {}),
        ...(typeof record.severity === "string" && record.severity.length > 0
          ? { severity: record.severity }
          : {}),
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);
}

function normalizePatchTargets(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (typeof item === "string") {
        return item;
      }
      if (item && typeof item === "object") {
        const record = item as Record<string, unknown>;
        const location = record.location ?? record.target_type;
        return typeof location === "string" ? location : null;
      }
      return null;
    })
    .filter((item): item is string => typeof item === "string" && item.length > 0);
}

function buildSkippedSemanticReview() {
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

/**
 * 构造语义审校 gateway（S2-2C：快照提供且非 stub 时按快照模型构造；
 * stub 部署返回 null = 跳过评审，与现状一致）。导出供 S2-2C 接线测试。
 */
export function createSemanticReviewerGateway(
  snapshotCapabilities?: ResolvedCapabilityMap,
): LlmGateway | null {
  if (env.llm.provider === "stub") {
    return null;
  }

  return createLlmGateway({
    registry: createPromptRegistry(),
    provider: createValidatedSemanticReviewerProvider(snapshotCapabilities),
  });
}

function createValidatedSemanticReviewerProvider(snapshotCapabilities?: ResolvedCapabilityMap): StructuredPromptProvider {
  getValidatedRuntimeEnv();

  return createTierAwareProviderFromEnv(
    snapshotCapabilities ? { snapshotCapabilities } : undefined,
  );
}
