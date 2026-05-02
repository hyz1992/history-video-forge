import type { TopicCandidateLibraryEntry } from "./topic-candidate-library.types.js";

export interface TopicCandidateLibraryDocument
  extends TopicCandidateLibraryEntry {
  familyLabel?: string;
  scopeLabel?: string;
  firstGeneratedAt?: string;
  lastSelectedAt?: string;
  timesSelected?: number;
  timesSeenInPool?: number;
  notes?: string;
}

const FRONT_MATTER_FIELDS = [
  ["candidate_id", "candidateId"],
  ["event_identity", "eventIdentity"],
  ["title", "title"],
  ["one_line_angle", "oneLineAngle"],
  ["family_label", "familyLabel"],
  ["scope_label", "scopeLabel"],
  ["status", "status"],
  ["source_project_id", "sourceProjectId"],
  ["source_topic_run_id", "sourceTopicRunId"],
  ["source_seed_family", "seedFamily"],
  ["source_seed_profile", "seedProfile"],
  ["first_generated_at", "firstGeneratedAt"],
  ["last_selected_at", "lastSelectedAt"],
  ["times_selected", "timesSelected"],
  ["times_seen_in_pool", "timesSeenInPool"],
] as const;

export function serializeTopicCandidateLibraryDocument(
  document: TopicCandidateLibraryDocument,
) {
  const frontMatterLines = FRONT_MATTER_FIELDS.flatMap(([yamlKey, fieldKey]) => {
    const value = document[fieldKey];

    if (value === undefined) {
      return [];
    }

    return `${yamlKey}: ${String(value)}`;
  });

  const notes = document.notes?.trim() ?? "";

  return ["---", ...frontMatterLines, "---", "", notes]
    .join("\n")
    .trimEnd() + "\n";
}

export function parseTopicCandidateLibraryDocument(
  content: string,
): TopicCandidateLibraryDocument {
  const frontMatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/u);

  if (!frontMatterMatch) {
    throw new Error("topic_candidate_library_invalid_front_matter");
  }

  const [, frontMatterBlock, body = ""] = frontMatterMatch;
  const record = new Map<string, string>();

  for (const rawLine of frontMatterBlock.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const separatorIndex = line.indexOf(":");
    if (separatorIndex < 0) {
      throw new Error("topic_candidate_library_invalid_front_matter");
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    record.set(key, value);
  }

  return {
    candidateId: getRequiredString(record, "candidate_id"),
    eventIdentity: getRequiredString(record, "event_identity"),
    title: getRequiredString(record, "title"),
    oneLineAngle: getRequiredString(record, "one_line_angle"),
    status: getRequiredString(record, "status") as TopicCandidateLibraryEntry["status"],
    sourceProjectId: getRequiredString(record, "source_project_id"),
    sourceTopicRunId: getRequiredString(record, "source_topic_run_id"),
    seedFamily: getRequiredString(record, "source_seed_family"),
    seedProfile: getRequiredString(record, "source_seed_profile"),
    familyLabel: record.get("family_label"),
    scopeLabel: record.get("scope_label"),
    firstGeneratedAt: record.get("first_generated_at"),
    lastSelectedAt: record.get("last_selected_at"),
    timesSelected: getOptionalNumber(record, "times_selected"),
    timesSeenInPool: getOptionalNumber(record, "times_seen_in_pool"),
    notes: body.trim(),
  };
}

function getRequiredString(record: Map<string, string>, key: string) {
  const value = record.get(key);

  if (!value) {
    throw new Error(`topic_candidate_library_missing_${key}`);
  }

  return value;
}

function getOptionalNumber(record: Map<string, string>, key: string) {
  const value = record.get(key);

  if (!value) {
    return undefined;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    throw new Error(`topic_candidate_library_invalid_${key}`);
  }

  return parsed;
}
