import type { DbClient, ProjectRecord, TopicPackageRecord } from "../../db/client";
import { generateScriptDraft } from "./script-generation.service";
import { validateScriptDraft } from "./script-local-validator";
import { buildScriptInputBundle } from "./script-input-bundle.builder";
import { planTopicDelivery } from "./topic-delivery-planner";
import { reviewScriptSemantics } from "./script-semantic-review.service";

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
  const draft = generateScriptDraft({
    bundle: inputBundle,
  });
  const localValidation = validateScriptDraft({
    bundle: inputBundle,
    draft,
  });
  const semanticReview =
    localValidation.decision === "pass"
      ? reviewScriptSemantics({
          bundle: inputBundle,
          draft,
        })
      : {
          stage: "script_semantic_review",
          decision: input.allowRegen ? "regen_once" : "pass",
          patch_intent: null,
          hard_issues: [],
          soft_issues: [],
          patch_targets: [],
          summary: "本地硬校验未通过，未进入语义审校。",
          confidence: 0.5,
        };

  return {
    statusCode: 200,
    body: {
      project_id: input.project.id,
      run_mode: "sync_mock",
      allow_patch: input.allowPatch ?? false,
      allow_regen: input.allowRegen ?? false,
      input_bundle: inputBundle,
      draft,
      local_validation: localValidation,
      semantic_review: semanticReview,
    },
  };
}
