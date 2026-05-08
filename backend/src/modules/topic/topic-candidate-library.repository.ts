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
import {
  TOPIC_CANDIDATE_LIBRARY_ROOT_DIR,
  buildTopicCandidateLibraryDirectory,
  buildTopicCandidateLibrarySlugs,
} from "./topic-candidate-library.path.js";
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
  writeTextFile?: WriteTextFile;
}

const CANDIDATES_JSON_FILENAME = "candidates.json";
const LIBRARY_INDEX_FILENAME = "library-index.json";
const TRANSIENT_WRITE_ERROR_CODES = new Set(["UNKNOWN", "EBUSY", "EPERM"]);

type WriteTextFile = (
  filePath: string,
  contents: string,
  encoding: BufferEncoding,
) => void;

export function createTopicCandidateLibraryRepository(
  options: CreateTopicCandidateLibraryRepositoryOptions = {},
): TopicCandidateLibraryRepository {
  const rootDir = options.rootDir ?? process.cwd();
  const writeTextFile = options.writeTextFile ?? writeFileSync;

  return {
    async save(document) {
      const directoryPath = buildTopicCandidateLibraryDirectory({
        rootDir,
        seedFamily: document.seedFamily,
        seedProfile: document.seedProfile,
      });
      const filePath = `${directoryPath}/${CANDIDATES_JSON_FILENAME}`;

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

      writeTextFileWithRetry(
        writeTextFile,
        filePath,
        serializeTopicCandidateLibraryJsonDocument(nextDocument),
        "utf8",
      );
      writeLibraryIndex({
        rootDir,
        seedFamily: document.seedFamily,
        seedProfile: document.seedProfile,
        updatedAt: nextDocument.updated_at,
        writeTextFile,
      });
    },

    async listBySeed(input) {
      const directoryPath = buildTopicCandidateLibraryDirectory({
        rootDir,
        seedFamily: input.seedFamily,
        seedProfile: input.seedProfile,
      });
      const filePath = `${directoryPath}/${CANDIDATES_JSON_FILENAME}`;

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

interface TopicCandidateLibraryIndexDocument {
  entries: Array<{
    seed_family: string;
    seed_profile: string;
    seed_family_slug: string;
    seed_profile_slug: string;
    directory: string;
    candidate_file: string;
    updated_at: string;
  }>;
}

function writeLibraryIndex(input: {
  rootDir: string;
  seedFamily: string;
  seedProfile: string;
  updatedAt: string;
  writeTextFile: WriteTextFile;
}) {
  const indexPath = resolve(
    input.rootDir,
    TOPIC_CANDIDATE_LIBRARY_ROOT_DIR,
    LIBRARY_INDEX_FILENAME,
  );
  const relativeDirectory = buildTopicCandidateLibraryDirectory({
    seedFamily: input.seedFamily,
    seedProfile: input.seedProfile,
  });
  const { seedFamilySlug, seedProfileSlug } = buildTopicCandidateLibrarySlugs({
    seedFamily: input.seedFamily,
    seedProfile: input.seedProfile,
  });
  const current: TopicCandidateLibraryIndexDocument = existsSync(indexPath)
    ? JSON.parse(readFileSync(indexPath, "utf8"))
    : { entries: [] };

  const nextEntry = {
    seed_family: input.seedFamily,
    seed_profile: input.seedProfile,
    seed_family_slug: seedFamilySlug,
    seed_profile_slug: seedProfileSlug,
    directory: relativeDirectory,
    candidate_file: `${relativeDirectory}/${CANDIDATES_JSON_FILENAME}`,
    updated_at: input.updatedAt,
  };

  const nextEntries = current.entries.filter(
    (entry) =>
      !(
        entry.seed_family === input.seedFamily
        && entry.seed_profile === input.seedProfile
      ),
  );
  nextEntries.push(nextEntry);
  nextEntries.sort((left, right) =>
    `${left.seed_family}::${left.seed_profile}`.localeCompare(
      `${right.seed_family}::${right.seed_profile}`,
      "zh-CN",
    ),
  );

  writeTextFileWithRetry(
    input.writeTextFile,
    indexPath,
    JSON.stringify({ entries: nextEntries }, null, 2),
    "utf8",
  );
}

function writeTextFileWithRetry(
  writeTextFile: WriteTextFile,
  filePath: string,
  contents: string,
  encoding: BufferEncoding,
) {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      writeTextFile(filePath, contents, encoding);
      return;
    } catch (error) {
      if (attempt === maxAttempts || !isTransientWriteError(error)) {
        throw error;
      }
      waitForNextWriteAttempt();
    }
  }
}

function isTransientWriteError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && TRANSIENT_WRITE_ERROR_CODES.has(code);
}

function waitForNextWriteAttempt() {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
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
