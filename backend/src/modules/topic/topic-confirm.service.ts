import { TopicPackage } from "../../../../shared/src/index";
import type {
  DbClient,
  EventRegistryRecord,
  ProjectRecord,
} from "../../db/client";
import { migrateProjectStorageOnTopicConfirm } from "../../runtime/trace/project-storage.js";
import { saveTopicPackage } from "./topic-package.repository";

export interface StoredTopicCandidate {
  candidateId: string;
  projectId: string;
  event: EventRegistryRecord;
  title: string;
  oneLineAngle: string;
  familyLabel: string;
  scopeLabel: string;
  coreConflict: string;
  strongScene: string;
  sourceHint: string;
  recentUsageHint: string;
}

export interface ConfirmTopicCandidateInput {
  projectDb: DbClient;
  project: ProjectRecord;
  candidate: StoredTopicCandidate;
}

function buildNarrativeTensionMap(candidate: StoredTopicCandidate) {
  return {
    hook_claim: candidate.oneLineAngle.replace(/[。.!！]+$/u, ""),
    pressure_escalation: candidate.coreConflict,
    mid_reveal: candidate.oneLineAngle,
    peak_payoff: candidate.strongScene,
    ending_residue: candidate.oneLineAngle,
  };
}

function buildStakes(candidate: StoredTopicCandidate) {
  return `${candidate.coreConflict}${candidate.oneLineAngle}`;
}

function buildMustIncludeBeats(candidate: StoredTopicCandidate) {
  return [
    candidate.coreConflict,
    candidate.strongScene,
    candidate.oneLineAngle,
  ];
}

function buildForbiddenExpansions(candidate: StoredTopicCandidate) {
  return [
    `不要脱离${candidate.title}当前已确认范围去扩写未定史实`,
    "不要扩写到未定 downstream 阶段",
  ];
}

export async function confirmTopicCandidate(input: ConfirmTopicCandidateInput) {
  const durationBand = {
    label: "medium",
    min_sec: 75,
    max_sec: 95,
  };
  const narrativeTensionMap = buildNarrativeTensionMap(input.candidate);
  const stakes = buildStakes(input.candidate);
  const mustIncludeBeats = buildMustIncludeBeats(input.candidate);
  const forbiddenExpansions = buildForbiddenExpansions(input.candidate);
  const sourceAnchorRefs = [input.candidate.sourceHint];
  const canonicalQuotes: string[] = [];
  const ambiguityNotes: string[] = [];

  const topicPackage = TopicPackage.parse({
    topic_id: `topic_${input.candidate.candidateId}`,
    title: input.candidate.title,
    selected_angle: input.candidate.oneLineAngle,
    family_label: input.candidate.familyLabel,
    scope_label: input.candidate.scopeLabel,
    core_conflict: input.candidate.coreConflict,
    stakes,
    strong_scene: input.candidate.strongScene,
    packaging_seed: input.candidate.oneLineAngle,
    must_include_beats: mustIncludeBeats,
    forbidden_expansions: forbiddenExpansions,
    risk_hints: ["不要扩写到未定 downstream 阶段"],
    source_anchor_refs: sourceAnchorRefs,
    canonical_quotes: canonicalQuotes,
    ambiguity_notes: ambiguityNotes,
    duration_band: "medium",
    narrative_tension_map: narrativeTensionMap,
  });

  const saved = await saveTopicPackage(input.projectDb, {
    projectId: input.project.id,
    eventRegistryEntryId: input.candidate.event.id,
    title: topicPackage.title,
    selectedAngle: topicPackage.selected_angle,
    familyLabel: topicPackage.family_label,
    scopeLabel: topicPackage.scope_label,
    coreConflict: topicPackage.core_conflict,
    strongScene: topicPackage.strong_scene,
    stakes: topicPackage.stakes,
    packagingSeed: topicPackage.packaging_seed,
    canonicalQuotesJson: topicPackage.canonical_quotes,
    durationBandJson: durationBand,
    narrativeTensionMapJson: topicPackage.narrative_tension_map,
    mustIncludeBeatsJson: topicPackage.must_include_beats,
    forbiddenExpansionsJson: topicPackage.forbidden_expansions,
    riskHintsJson: topicPackage.risk_hints,
    sourceAnchorRefsJson: topicPackage.source_anchor_refs,
    ambiguityNotesJson: topicPackage.ambiguity_notes,
  });

  input.project.name = saved.title;
  migrateProjectStorageOnTopicConfirm(input.project, saved.title);
  input.project.status = "script_ready";
  input.project.activeTopicPackageId = saved.id;
  input.project.activeScriptRecordId = null;
  input.project.updatedAt = new Date();

  return {
    project_id: input.project.id,
    current_status: input.project.status,
    topic_package: {
      topic_package_id: saved.id,
      event_id: input.candidate.event.id,
      canonical_title: saved.title,
      selected_angle: saved.selectedAngle,
      family_label: saved.familyLabel,
      scope_label: saved.scopeLabel,
      core_conflict: saved.coreConflict,
      stakes: saved.stakes ?? "",
      strong_scene: saved.strongScene,
      must_include_beats: saved.mustIncludeBeatsJson,
      forbidden_expansions: saved.forbiddenExpansionsJson,
      source_anchor_refs: saved.sourceAnchorRefsJson,
      canonical_quotes: saved.canonicalQuotesJson,
      ambiguity_notes: saved.ambiguityNotesJson,
      duration_band: saved.durationBandJson,
      narrative_tension_map: saved.narrativeTensionMapJson,
    },
  };
}
