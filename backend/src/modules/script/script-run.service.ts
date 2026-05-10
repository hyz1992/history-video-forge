import type { DbClient, ProjectRecord, TopicPackageRecord } from "../../db/client";
import type { LlmGateway } from "../../runtime/llm/llm-gateway.js";
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
  createProjectRunInteractionLogWriter,
  persistProjectRunArtifacts,
} from "../../runtime/trace/project-storage.js";

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
  };
}

export interface RunScriptGenerationInput {
  db: DbClient;
  project: ProjectRecord;
  allowPatch?: boolean;
  allowRegen?: boolean;
  forceRegen?: boolean;
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
  const interactionLogWriter = createProjectRunInteractionLogWriter({
    project: input.project,
    phase: "script",
    runId,
  });
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
      regenerateDraft: regenerateScriptDraft,
    },
  );

  const scriptRecord = await saveScriptRecord(input.db, {
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
  input.project.latestScriptRunTraceJson =
    graphTraceSummary as unknown as Record<string, unknown>;
  input.project.latestStoryboardRunTraceJson = null;
  input.project.status = "script_ready";
  input.project.updatedAt = new Date();
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
      input_bundle: inputBundle,
      draft,
      local_validation: localValidation,
      semantic_review: semanticReview,
      graph_trace_summary: graphTraceSummary,
      runtime_diagnostics: runtimeDiagnostics,
    },
  };
}
