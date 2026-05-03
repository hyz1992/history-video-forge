import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";

import {
  parseTopicCandidateLibraryJsonDocument,
  serializeTopicCandidateLibraryJsonDocument,
} from "./topic-candidate-library-json.codec.js";
import {
  TOPIC_CANDIDATE_LIBRARY_JSON_SCHEMA_VERSION,
  type TopicCandidateLibraryJsonDocument,
} from "./topic-candidate-library-json.types.js";
import { buildTopicCandidateLibraryDirectory } from "./topic-candidate-library.path.js";
import type { TopicCandidateLibraryStatus } from "./topic-candidate-library.types.js";

export interface TopicCandidateLibraryDocument {
  candidateId: string;
  seedFamily: string;
  seedProfile: string;
  status: TopicCandidateLibraryStatus;
  sourceProjectId: string;
  sourceTopicRunId: string;
  eventIdentity: string;
  title: string;
  oneLineAngle: string;
  familyLabel?: string;
  scopeLabel?: string;
  firstGeneratedAt?: string;
  lastSelectedAt?: string;
  timesSelected?: number;
  timesSeenInPool?: number;
  notes?: string;
}

export interface TopicCandidateLibraryRepository {
  save(document: TopicCandidateLibraryDocument): Promise<void>;
  listBySeed(input: {
    seedFamily: string;
    seedProfile: string;
    statuses?: TopicCandidateLibraryStatus[];
  }): Promise<TopicCandidateLibraryDocument[]>;
}

interface CreateTopicCandidateLibraryRepositoryOptions {
  rootDir?: string;
}

const CANDIDATES_JSON_FILENAME = "candidates.json";

export function createTopicCandidateLibraryRepository(
  options: CreateTopicCandidateLibraryRepositoryOptions = {},
): TopicCandidateLibraryRepository {
  const rootDir = options.rootDir ?? process.cwd();

  return {
    async save(document) {
      const directoryPath = resolve(
        rootDir,
        buildTopicCandidateLibraryDirectory({
          seedFamily: document.seedFamily,
          seedProfile: document.seedProfile,
        }),
      );
      const filePath = resolve(directoryPath, CANDIDATES_JSON_FILENAME);

      mkdirSync(directoryPath, {
        recursive: true,
      });

      const current = existsSync(filePath)
        ? parseTopicCandidateLibraryJsonDocument(readFileSync(filePath, "utf8"))
        : createEmptyJsonDocument(document);

      const nextCandidate = toJsonCandidate(document);
      const nextCandidates = current.candidates.filter(
        (candidate) => candidate.candidate_id !== document.candidateId,
      );
      nextCandidates.push(nextCandidate);

      const nextDocument: TopicCandidateLibraryJsonDocument = {
        ...current,
        updated_at: nextCandidate.last_selected_at ?? nextCandidate.first_generated_at,
        candidates: nextCandidates,
      };

      writeFileSync(
        filePath,
        serializeTopicCandidateLibraryJsonDocument(nextDocument),
        "utf8",
      );
    },

    async listBySeed(input) {
      const directoryPath = resolve(
        rootDir,
        buildTopicCandidateLibraryDirectory({
          seedFamily: input.seedFamily,
          seedProfile: input.seedProfile,
        }),
      );
      const filePath = resolve(directoryPath, CANDIDATES_JSON_FILENAME);

      if (!existsSync(filePath)) {
        return [];
      }

      const document = parseTopicCandidateLibraryJsonDocument(
        readFileSync(filePath, "utf8"),
      );
      const statuses = input.statuses ? new Set(input.statuses) : null;

      return document.candidates
        .filter((candidate) =>
          statuses ? statuses.has(candidate.status) : true,
        )
        .map(fromJsonCandidate);
    },
  };
}

function createEmptyJsonDocument(
  document: TopicCandidateLibraryDocument,
): TopicCandidateLibraryJsonDocument {
  const directory = buildTopicCandidateLibraryDirectory({
    seedFamily: document.seedFamily,
    seedProfile: document.seedProfile,
  });
  const parts = directory.split("/");
  const seedFamilySlug = parts.at(-2) ?? "unknown";
  const seedProfileSlug = parts.at(-1) ?? "unknown";

  return {
    schema_version: TOPIC_CANDIDATE_LIBRARY_JSON_SCHEMA_VERSION,
    seed_family: document.seedFamily,
    seed_profile: document.seedProfile,
    seed_family_slug: seedFamilySlug,
    seed_profile_slug: seedProfileSlug,
    updated_at: document.lastSelectedAt ?? document.firstGeneratedAt ?? new Date().toISOString(),
    candidates: [],
  };
}

function toJsonCandidate(document: TopicCandidateLibraryDocument) {
  return {
    candidate_id: document.candidateId,
    event_identity: document.eventIdentity,
    title: document.title,
    one_line_angle: document.oneLineAngle,
    family_label: document.familyLabel ?? "",
    scope_label: document.scopeLabel ?? "",
    status: document.status,
    source_project_id: document.sourceProjectId,
    source_topic_run_id: document.sourceTopicRunId,
    source_seed_family: document.seedFamily,
    source_seed_profile: document.seedProfile,
    first_generated_at: document.firstGeneratedAt ?? new Date().toISOString(),
    last_selected_at: document.lastSelectedAt,
    times_selected: document.timesSelected ?? 0,
    times_seen_in_pool: document.timesSeenInPool ?? 0,
    notes: document.notes ?? "",
  };
}

function fromJsonCandidate(candidate: TopicCandidateLibraryJsonDocument["candidates"][number]): TopicCandidateLibraryDocument {
  return {
    candidateId: candidate.candidate_id,
    seedFamily: candidate.source_seed_family,
    seedProfile: candidate.source_seed_profile,
    status: candidate.status,
    sourceProjectId: candidate.source_project_id,
    sourceTopicRunId: candidate.source_topic_run_id,
    eventIdentity: candidate.event_identity,
    title: candidate.title,
    oneLineAngle: candidate.one_line_angle,
    familyLabel: candidate.family_label || undefined,
    scopeLabel: candidate.scope_label || undefined,
    firstGeneratedAt: candidate.first_generated_at,
    lastSelectedAt: candidate.last_selected_at,
    timesSelected: candidate.times_selected,
    timesSeenInPool: candidate.times_seen_in_pool,
    notes: candidate.notes,
  };
}
