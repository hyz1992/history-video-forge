import { randomUUID } from "node:crypto";
import type { AppPrismaClient } from "../../db/prisma-client.types.js";

// ---- EventLibraryDraft ----

export interface CreateEventLibraryDraftInput {
  draftKind: "recommendation_reflux" | "custom";
  projectId: string;
  candidateFingerprint?: string | null;
  eventRegistryEntryId?: string | null;
  proposedTitle: string;
  proposedSummary: string;
  proposedAngles: unknown[];
  proposedTags: Record<string, unknown>;
  rawCustomDigest?: string | null;
  customRefinedEvent?: unknown;
  ownerId: string;
}

export async function createDraft(
  prisma: AppPrismaClient,
  input: CreateEventLibraryDraftInput,
) {
  return prisma.eventLibraryDraft.create({
    data: {
      id: randomUUID(),
      draftKind: input.draftKind,
      projectId: input.projectId,
      candidateFingerprint: input.candidateFingerprint ?? null,
      eventRegistryEntryId: input.eventRegistryEntryId ?? null,
      proposedTitle: input.proposedTitle,
      proposedSummary: input.proposedSummary,
      proposedAnglesJson: input.proposedAngles as never,
      proposedTagsJson: input.proposedTags as never,
      rawCustomDigest: input.rawCustomDigest ?? null,
      customRefinedEventJson: (input.customRefinedEvent ?? null) as never,
      ownerId: input.ownerId,
      status: "draft",
    },
  });
}

/** 查同指纹 + draftKind + 活跃状态的已有 draft，避免重复写入 */
export async function findExistingRefluxDraft(
  prisma: AppPrismaClient,
  params: {
    candidateFingerprint: string;
    projectId: string;
  },
) {
  return prisma.eventLibraryDraft.findFirst({
    where: {
      draftKind: "recommendation_reflux",
      candidateFingerprint: params.candidateFingerprint,
      projectId: params.projectId,
      status: { in: ["draft", "pending_review"] },
    },
  });
}
