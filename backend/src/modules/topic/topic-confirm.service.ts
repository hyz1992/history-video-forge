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
  mustCoverPreview?: string[];
  sourceHint: string;
  recentUsageHint: string;
}

export interface ConfirmTopicCandidateInput {
  projectDb: DbClient;
  project: ProjectRecord;
  candidate: StoredTopicCandidate;
}

function getCandidatePreviewBeats(candidate: StoredTopicCandidate) {
  return Array.from(
    new Set(
      (candidate.mustCoverPreview ?? [])
        .map((beat) => beat.trim())
        .filter(Boolean),
    ),
  );
}

function trimTerminalPunctuation(value: string) {
  return value.trim().replace(/[。.!！?？；;：:]+$/u, "");
}

function buildHookClaim(candidate: StoredTopicCandidate, entryPressure?: string) {
  const selectedAngle = trimTerminalPunctuation(candidate.oneLineAngle);

  return [entryPressure, selectedAngle].filter(Boolean).join(" ");
}

function buildNarrativeTensionMap(candidate: StoredTopicCandidate) {
  const previewBeats = getCandidatePreviewBeats(candidate);
  const entryPressure = previewBeats[0] ?? candidate.strongScene;
  const peakPayoff = previewBeats[1] ?? candidate.strongScene;
  const endingResidue = previewBeats[2] ?? peakPayoff ?? candidate.coreConflict;

  return {
    hook_claim: buildHookClaim(candidate, entryPressure),
    pressure_escalation: [candidate.coreConflict, entryPressure, peakPayoff]
      .filter(Boolean)
      .join(" "),
    mid_reveal: entryPressure,
    peak_payoff: peakPayoff,
    ending_residue: endingResidue,
  };
}

function buildStakes(candidate: StoredTopicCandidate) {
  const previewBeats = getCandidatePreviewBeats(candidate);
  const peakOrResidue =
    previewBeats[2] ?? previewBeats[1] ?? candidate.strongScene;

  return `${candidate.coreConflict} ${peakOrResidue}`;
}

function buildMustIncludeBeats(candidate: StoredTopicCandidate) {
  const previewBeats = getCandidatePreviewBeats(candidate);

  if (previewBeats.length >= 3) {
    return previewBeats;
  }

  return [
    candidate.coreConflict,
    candidate.strongScene,
    candidate.oneLineAngle,
  ];
}

function getEventCanonicalQuotes(event: EventRegistryRecord): string[] {
  return Array.from(
    new Set(
      event.canonicalQuotesJson.map((quote) => quote.trim()).filter(Boolean),
    ),
  );
}

function getEventCanonicalQuoteIntents(
  event: EventRegistryRecord,
): Array<{ quote: string; intent: string }> {
  const seen = new Set<string>();
  const intents: Array<{ quote: string; intent: string }> = [];

  for (const item of event.canonicalQuoteIntentsJson ?? []) {
    const quote = item.quote.trim();
    const intent = item.intent.trim();
    const key = `${quote}\n${intent}`;

    if (!quote || !intent || seen.has(key)) {
      continue;
    }

    seen.add(key);
    intents.push({ quote, intent });
  }

  return intents;
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
  const canonicalQuotes = getEventCanonicalQuotes(input.candidate.event);
  const canonicalQuoteIntents = getEventCanonicalQuoteIntents(
    input.candidate.event,
  );
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
    canonical_quote_intents: canonicalQuoteIntents,
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
    canonicalQuoteIntentsJson: topicPackage.canonical_quote_intents,
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
      canonical_quote_intents: saved.canonicalQuoteIntentsJson,
      ambiguity_notes: saved.ambiguityNotesJson,
      duration_band: saved.durationBandJson,
      narrative_tension_map: saved.narrativeTensionMapJson,
    },
  };
}
