import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createTopicCandidateLibraryRepository,
  type TopicCandidateLibraryRepository,
} from "../../../backend/src/modules/topic/topic-candidate-library.repository.js";

describe("topic candidate library repository", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const directoryPath of tempDirs.splice(0)) {
      rmSync(directoryPath, {
        recursive: true,
        force: true,
      });
    }
  });

  it("writes and reads candidates under the same seed family and seed profile", async () => {
    const repository = createTestRepository(tempDirs);

    await repository.save({
      candidateId: "candidate-1",
      seedFamily: "history-diplomacy",
      seedProfile: "han-court-showdown",
      status: "unused",
      sourceProjectId: "project-1",
      sourceTopicRunId: "topic-run-1",
      eventIdentity: "晏子使楚",
      title: "晏子使楚：出使楚国的压场对顶",
      oneLineAngle: "真正抓人的不是出使本身，而是当场连续顶回压场。",
      familyLabel: "外交压场型",
      scopeLabel: "单事件",
      notes: "## 保留原因\n\n- 更多候选预览",
    });

    const records = await repository.listBySeed({
      seedFamily: "history-diplomacy",
      seedProfile: "han-court-showdown",
    });

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      candidateId: "candidate-1",
      status: "unused",
      seedFamily: "history-diplomacy",
      seedProfile: "han-court-showdown",
      title: "晏子使楚：出使楚国的压场对顶",
    });
  });

  it("filters candidates by requested status", async () => {
    const repository = createTestRepository(tempDirs);

    await repository.save({
      candidateId: "candidate-unused",
      seedFamily: "history-diplomacy",
      seedProfile: "han-court-showdown",
      status: "unused",
      sourceProjectId: "project-1",
      sourceTopicRunId: "topic-run-1",
      eventIdentity: "晏子使楚",
      title: "晏子使楚：出使楚国的压场对顶",
      oneLineAngle: "真正抓人的不是出使本身，而是当场连续顶回压场。",
    });
    await repository.save({
      candidateId: "candidate-fallback",
      seedFamily: "history-diplomacy",
      seedProfile: "han-court-showdown",
      status: "fallback_ready",
      sourceProjectId: "project-1",
      sourceTopicRunId: "topic-run-1",
      eventIdentity: "张巡守城",
      title: "张巡守城：死守孤城的极限反压",
      oneLineAngle: "最狠的不是守，而是明知道守不住还得先顶住。",
    });

    const records = await repository.listBySeed({
      seedFamily: "history-diplomacy",
      seedProfile: "han-court-showdown",
      statuses: ["fallback_ready"],
    });

    expect(records).toHaveLength(1);
    expect(records[0]?.candidateId).toBe("candidate-fallback");
  });

  it("does not read across different seed family or seed profile", async () => {
    const repository = createTestRepository(tempDirs);

    await repository.save({
      candidateId: "candidate-1",
      seedFamily: "history-diplomacy",
      seedProfile: "han-court-showdown",
      status: "unused",
      sourceProjectId: "project-1",
      sourceTopicRunId: "topic-run-1",
      eventIdentity: "晏子使楚",
      title: "晏子使楚：出使楚国的压场对顶",
      oneLineAngle: "真正抓人的不是出使本身，而是当场连续顶回压场。",
    });

    const differentFamily = await repository.listBySeed({
      seedFamily: "battle-reversal",
      seedProfile: "han-court-showdown",
    });
    const differentProfile = await repository.listBySeed({
      seedFamily: "history-diplomacy",
      seedProfile: "tang-frontier-defense",
    });

    expect(differentFamily).toEqual([]);
    expect(differentProfile).toEqual([]);
  });
});

function createTestRepository(tempDirs: string[]): TopicCandidateLibraryRepository {
  const rootDir = mkdtempSync(join(tmpdir(), "topic-candidate-library-"));
  tempDirs.push(rootDir);

  return createTopicCandidateLibraryRepository({
    rootDir,
  });
}
