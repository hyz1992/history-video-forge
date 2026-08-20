import type { DbClient, ProjectRecord, TopicPackageRecord } from "../../db/client";
import type { LlmGateway } from "../../runtime/llm/llm-gateway.js";
import { LlmOutputError } from "../../runtime/llm/llm-output-error.js";
import { generateScriptDraft } from "./script-generation.service";
import { validateScriptDraft } from "./script-local-validator";
import { buildScriptInputBundle } from "./script-input-bundle.builder";
import { patchScriptDraft } from "./script-patch.service";
import { regenerateScriptDraft } from "./script-regenerate.service";
import { saveScriptRecord } from "./script-record.repository";
import { reviewScriptSemantics } from "./script-semantic-review.service";
import { planTopicDelivery } from "./topic-delivery-planner";
import { runScriptRunGraph } from "../../runtime/orchestration/script-run-graph.js";
import {
  createCompositeInteractionLogWriter,
  persistProjectRunArtifacts,
} from "../../runtime/trace/project-storage.js";
import { createBillingInteractionLogWriter, type LlmBillingContext } from "../generation-cost/llm-billing-writer.js";

function buildProjectStylePack() {
  return {
    narrator_persona: "冷静压迫型旁白",
    wording_register: "sharp_oral",
    subtitle_profile: "dense_short_lines",
    cover_profile: "faces_closeup",
    title_profile: "conflict_first",
    pacing_baseline: "tight",
    risk_posture: "controlled",
  };
}

function buildFamilyBiasPack(familyLabel: string) {
  return {
    family_label: familyLabel,
    opening_pressure_bias: "high",
    exposition_budget: "low",
    pacing_bias: "fast",
    voice_bias: "sharper",
    anti_patterns: ["不要先讲背景百科"],
  };
}

function mapTopicPackage(record: TopicPackageRecord) {
  return {
    topic_id: record.id,
    title: record.title,
    selected_angle: record.selectedAngle,
    family_label: record.familyLabel,
    scope_label: record.scopeLabel,
    core_conflict: record.coreConflict,
    stakes: record.stakes ?? "该事件的公开场面与后续代价不能被轻描淡写。",
    strong_scene: record.strongScene,
    packaging_seed: record.packagingSeed,
    must_include_beats: record.mustIncludeBeatsJson as string[],
    forbidden_expansions: record.forbiddenExpansionsJson as string[],
    risk_hints: record.riskHintsJson as string[],
    source_anchor_refs: record.sourceAnchorRefsJson as string[],
    canonical_quotes: record.canonicalQuotesJson,
    canonical_quote_intents: record.canonicalQuoteIntentsJson,
    ambiguity_notes: record.ambiguityNotesJson as string[],
    duration_band:
      typeof record.durationBandJson.label === "string"
        ? (record.durationBandJson.label as string)
        : "medium",
    narrative_tension_map: record.narrativeTensionMapJson as {
      hook_claim: string;
      pressure_escalation: string;
      mid_reveal: string;
      peak_payoff: string;
      ending_residue: string;
    },
    source_mode: record.sourceMode ?? "recommended",
    source_ref: record.sourceRefJson ?? null,
  };
}

export interface RunScriptGenerationInput {
  db: DbClient;
  /** S2-2A 任务 9B：付费 quote 绑定 run 的计费上下文（LLM 记账）；免 quote 路径不传。 */
  billingContext?: LlmBillingContext;
  project: ProjectRecord;
  allowPatch?: boolean;
  allowRegen?: boolean;
  allowLocalRepairRegen?: boolean;
  forceRegen?: boolean;
  userFeedback?: string;
  semanticReviewGateway?: LlmGateway;
}

export async function runScriptGeneration(input: RunScriptGenerationInput) {
  if (!input.project.activeTopicPackageId) {
    return {
      statusCode: 409,
      body: {
        error: "active_topic_package_missing",
      },
    };
  }

  const record = input.db.topicPackages.get(input.project.activeTopicPackageId);
  if (!record) {
    return {
      statusCode: 404,
      body: {
        error: "topic_package_not_found",
      },
    };
  }

  const topicPackage = mapTopicPackage(record);
  const projectStylePack = buildProjectStylePack();
  const familyBiasPack = buildFamilyBiasPack(topicPackage.family_label);
  const topicDeliveryPack = planTopicDelivery({
    topicPackage,
    projectStylePack,
    familyBiasPack,
  });
  const inputBundle = buildScriptInputBundle({
    topicPackage,
    eventIdentity: record.eventRegistryEntryId ?? record.id,
    topicDeliveryPack,
    projectStylePack,
    familyBiasPack,
  });
  const runId = `script_run_${input.db.generateId()}`;
  // 9B：付费 quote 绑定 run 的 writer 包计费包装（LLM interaction 记账）
  const plainWriter = createCompositeInteractionLogWriter({
    project: input.project,
    phase: "script",
    runId,
  });
  const interactionLogWriter = input.billingContext
    ? createBillingInteractionLogWriter({ billing: input.billingContext, inner: plainWriter })
    : plainWriter;
  const previousActiveScriptRecordId = input.project.activeScriptRecordId;
  // Declare outside try so catch block can access it for failure-record update
  let generatingRecord: { id: string } | undefined;

  try {
    // Save preliminary record BEFORE graph execution so refresh shows generating state
    generatingRecord = await saveScriptRecord(input.db, {
      projectId: input.project.id,
      topicPackageId: record.id,
      scriptText: "",
      openingSpan: "",
      endingSpan: "",
      estimatedDurationSec: 0,
      beatTraceJson: [],
      quoteTraceJson: [],
      reviewStatus: "generating",
      validationResultJson: { stage: "script_local_validation", decision: "generating", errors: [], warnings: [], metrics: {} },
      semanticReviewResultJson: { stage: "script_semantic_review", decision: "generating", patch_intent: null },
      executionStateJson: { generating: true, run_id: runId },
      graphTraceSummaryJson: null,
      runtimeDiagnosticsJson: null,
    });
    input.project.status = "script_generating";
    await input.db.firstAggregateWriter?.syncProject(input.project);

    const {
    draft,
    localValidation,
    semanticReview,
    executionState,
    graphTraceSummary,
    runtimeDiagnostics,
  } = await runScriptRunGraph(
    {
      bundle: inputBundle,
      allowPatch: false,
      allowRegen: input.allowRegen ?? false,
      allowLocalRepairRegen: input.allowLocalRepairRegen ?? true,
      forceRegen: input.forceRegen ?? false,
      runId,
    },
    {
      generateDraft: (generateInput) =>
        generateScriptDraft({
          ...generateInput,
          interactionLogWriter,
        }),
      validateDraft: validateScriptDraft,
      reviewSemantics: (reviewInput) =>
        reviewScriptSemantics({
          ...reviewInput,
          llmGateway: input.semanticReviewGateway,
          interactionLogWriter,
        }),
      patchDraft: patchScriptDraft,
      regenerateDraft: (regenerateInput) =>
        regenerateScriptDraft({
          ...regenerateInput,
          userFeedback: input.userFeedback,
        }),
    },
  );

  const scriptRecord = await saveScriptRecord(input.db, {
    id: generatingRecord.id,
    projectId: input.project.id,
    topicPackageId: record.id,
    scriptText: draft.script_text,
    openingSpan: draft.opening_span,
    endingSpan: draft.ending_span,
    estimatedDurationSec: draft.estimated_duration_sec,
    beatTraceJson: draft.beat_trace,
    quoteTraceJson: draft.quote_trace,
    reviewStatus: semanticReview.decision,
    validationResultJson: localValidation as Record<string, unknown>,
    semanticReviewResultJson: semanticReview as Record<string, unknown>,
    executionStateJson: executionState,
    graphTraceSummaryJson: graphTraceSummary as unknown as Record<string, unknown>,
    runtimeDiagnosticsJson: runtimeDiagnostics as unknown as Record<string, unknown>,
  });

  input.project.activeScriptRecordId = scriptRecord.id;
  input.project.activeStoryboardRecordId = null;
  input.project.activeAssetPlanRecordId = null;
  input.project.activeAssetManifestRecordId = null;
  input.project.activeComposeRecordId = null;
  input.project.activeRenderJobRecordId = null;
  input.project.latestScriptRunTraceJson =
    graphTraceSummary as unknown as Record<string, unknown>;
  input.project.latestStoryboardRunTraceJson = null;
  input.project.latestAssetPlanRunTraceJson = null;
  input.project.latestAssetsRunTraceJson = null;
  input.project.latestComposeRunTraceJson = null;
  input.project.latestRenderRunTraceJson = null;
  input.project.status = "script_ready";
  input.project.updatedAt = new Date();
  await input.db.secondAggregateWriter?.activateScript(input.project, scriptRecord);
  persistProjectRunArtifacts({
    project: input.project,
    phase: "script",
    runId,
    traceSummary: graphTraceSummary as unknown as Record<string, unknown>,
    runtimeDiagnostics: runtimeDiagnostics as unknown as Record<string, unknown>,
  });

  return {
    statusCode: 200,
    body: {
      project_id: input.project.id,
      run_mode: "sync_runtime",
      allow_patch: input.allowPatch ?? false,
      allow_regen: input.allowRegen ?? false,
      allow_local_repair_regen: input.allowLocalRepairRegen ?? true,
      input_bundle: inputBundle,
      draft,
      local_validation: localValidation,
      semantic_review: semanticReview,
      graph_trace_summary: graphTraceSummary,
      runtime_diagnostics: runtimeDiagnostics,
    },
  };
  } catch (error) {
    const errorCode =
      error instanceof LlmOutputError ? error.code : "internal_server_error";

    // Clean up generating record state — best effort, must not stay on generating: true
    if (generatingRecord) {
      try {
        await saveScriptRecord(input.db, {
          id: generatingRecord.id,
          projectId: input.project.id,
          topicPackageId: record.id,
          scriptText: "",
          openingSpan: "",
          endingSpan: "",
          estimatedDurationSec: 0,
          beatTraceJson: [],
          quoteTraceJson: [],
          reviewStatus: "error",
          validationResultJson: {
            stage: "script_local_validation",
            decision: "error",
            errors: ["internal_server_error"],
            warnings: [],
            metrics: {},
          },
          semanticReviewResultJson: null,
          executionStateJson: {
            generating: false,
            error: errorCode,
            run_id: runId,
          },
          graphTraceSummaryJson: null,
          runtimeDiagnosticsJson: null,
        });
      } catch (cleanupError) {
        // 关键：清理失败时一定要记录，避免静默吞错让记录卡在 generating: true
        const cleanupMsg =
          cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
        console.error(
          `[script] failed to clear generating state for record ${generatingRecord.id}: ${cleanupMsg}`,
        );
        interactionLogWriter.writeError(
          `script_generating_state_cleanup_failed:${cleanupMsg}`,
        );
      }
    }

    // Clean up generating state — unexpected error
    input.project.activeScriptRecordId = previousActiveScriptRecordId;
    input.project.status = previousActiveScriptRecordId ? "script_ready" : "script_failed";
    input.project.updatedAt = new Date();
    await input.db.firstAggregateWriter?.syncProject(input.project).catch(() => undefined);
    const message =
      error instanceof Error ? (error.stack ?? error.message) : String(error);
    interactionLogWriter.writeError(message);
    if (error instanceof LlmOutputError && error.cause !== undefined) {
      interactionLogWriter.writeError(JSON.stringify(error.cause));
    }
    return {
      statusCode: 500,
      body: {
        error: errorCode,
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}
