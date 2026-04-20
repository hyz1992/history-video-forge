import type { DbClient, ProjectRecord, TopicPackageRecord } from "../../db/client";
import { generateScriptDraft } from "./script-generation.service";
import { validateScriptDraft } from "./script-local-validator";
import { buildScriptInputBundle } from "./script-input-bundle.builder";
import { patchScriptDraft } from "./script-patch.service";
import { regenerateScriptDraft } from "./script-regenerate.service";
import { saveScriptRecord } from "./script-record.repository";
import { reviewScriptSemantics } from "./script-semantic-review.service";
import { planTopicDelivery } from "./topic-delivery-planner";
import { runScriptRunGraph } from "../../runtime/orchestration/script-run-graph.js";

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
    strong_scene: record.strongScene,
    packaging_seed: record.packagingSeed,
    must_include_beats: record.mustIncludeBeatsJson as string[],
    forbidden_expansions: record.forbiddenExpansionsJson as string[],
    risk_hints: record.riskHintsJson as string[],
    canonical_quotes: record.canonicalQuotesJson,
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
    topicDeliveryPack,
    projectStylePack,
    familyBiasPack,
  });
  const {
    draft,
    localValidation,
    semanticReview,
    executionState,
  } = await runScriptRunGraph(
    {
      bundle: inputBundle,
      allowPatch: input.allowPatch ?? false,
      allowRegen: input.allowRegen ?? false,
    },
    {
      generateDraft: generateScriptDraft,
      validateDraft: validateScriptDraft,
      reviewSemantics: reviewScriptSemantics,
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
  });

  input.project.activeScriptRecordId = scriptRecord.id;
  input.project.status = "script_ready";
  input.project.updatedAt = new Date();

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
    },
  };
}
