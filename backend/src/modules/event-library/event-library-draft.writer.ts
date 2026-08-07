import type { AppPrismaClient } from "../../db/prisma-client.types.js";
import type { StoredTopicCandidate } from "../topic/topic-confirm.service.js";
import {
  createDraft,
  findExistingRefluxDraft,
} from "./event-library-draft.repository.js";

export interface WriteRefluxDraftInput {
  prisma: AppPrismaClient;
  candidate: StoredTopicCandidate;
  projectId: string;
  ownerId: string;
}

/**
 * 从推荐候选提取字段写入 EventLibraryDraft(draftKind=recommendation_reflux)。
 * 同指纹 + 同 project + 活跃状态已有 draft 则跳过（幂等）。
 * 写入失败只 log，不抛异常（设计文档 §6.3：不阻塞推荐响应）。
 */
export async function writeRefluxDraft(input: WriteRefluxDraftInput): Promise<void> {
  try {
    const candidateFingerprint = `${input.candidate.event.canonicalName}::${input.candidate.oneLineAngle}`;

    const existing = await findExistingRefluxDraft(input.prisma, {
      candidateFingerprint,
      projectId: input.projectId,
    });
    if (existing) return;

    await createDraft(input.prisma, {
      draftKind: "recommendation_reflux",
      projectId: input.projectId,
      candidateFingerprint,
      proposedTitle: input.candidate.title,
      proposedSummary: input.candidate.coreConflict || input.candidate.strongScene,
      proposedAngles: [
        {
          angleLabel: input.candidate.oneLineAngle,
          familyLabel: input.candidate.familyLabel,
          scopeLabel: input.candidate.scopeLabel,
        },
      ],
      proposedTags: {
        events: [input.candidate.event.canonicalName],
        // scopeLabel 实际语义就是朝代（如"春秋""战国""魏晋"），
        // familyLabel 是事件家族（如"军事政变型"）——保留两者供审批参考。
        dynasty: input.candidate.scopeLabel || null,
        family_label: input.candidate.familyLabel || null,
      },
      ownerId: input.ownerId,
    });
  } catch (error) {
    // 设计文档 §6.3：写入失败只记录日志，不阻塞推荐响应
    console.error("event-library-reflux-draft-write-failed", {
      error: error instanceof Error ? error.message : String(error),
      projectId: input.projectId,
    });
  }
}
