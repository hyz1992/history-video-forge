import type { ProjectTopicCandidateState } from "../../app.js";
import type { DbClient } from "../../db/client.js";
import type { AppPrismaClient } from "../../db/prisma-client.types.js";
import { hydrateFirstAggregates } from "../../db/repositories/prisma-first-aggregate-hydrator.js";
import { syncEventLibraryFromFiles } from "../../modules/event-library/event-library-sync.service.js";

interface InitializeFirstAggregateRuntimeInput {
  db: DbClient;
  topicCandidateStore: Map<string, ProjectTopicCandidateState>;
  prismaClient: AppPrismaClient;
  storageRoot: string;
  syncEventLibrary?: typeof syncEventLibraryFromFiles;
  onSyncError?: (message: string) => void;
}

export async function initializeFirstAggregateRuntime(
  input: InitializeFirstAggregateRuntimeInput,
): Promise<void> {
  try {
    await (input.syncEventLibrary ?? syncEventLibraryFromFiles)(
      input.prismaClient,
      input.storageRoot,
    );
  } catch (error) {
    input.onSyncError?.(error instanceof Error ? error.message : "unknown");
  }

  await hydrateFirstAggregates(
    input.db,
    input.topicCandidateStore,
    input.prismaClient,
    { storageRoot: input.storageRoot },
  );
}
