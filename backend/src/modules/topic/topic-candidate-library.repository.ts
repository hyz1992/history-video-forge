import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";

import {
  parseTopicCandidateLibraryDocument,
  serializeTopicCandidateLibraryDocument,
  type TopicCandidateLibraryDocument,
} from "./topic-candidate-library.codec.js";
import { buildTopicCandidateLibraryDirectory } from "./topic-candidate-library.path.js";
import type { TopicCandidateLibraryStatus } from "./topic-candidate-library.types.js";

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
      const filePath = resolve(directoryPath, `${document.candidateId}.md`);

      mkdirSync(directoryPath, {
        recursive: true,
      });
      writeFileSync(
        filePath,
        serializeTopicCandidateLibraryDocument(document),
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

      if (!existsSync(directoryPath)) {
        return [];
      }

      const statuses = input.statuses ? new Set(input.statuses) : null;

      return readdirSync(directoryPath)
        .filter((entryName) => entryName.endsWith(".md"))
        .map((entryName) =>
          parseTopicCandidateLibraryDocument(
            readFileSync(resolve(directoryPath, entryName), "utf8"),
          ),
        )
        .filter((document) =>
          statuses ? statuses.has(document.status) : true,
        );
    },
  };
}
