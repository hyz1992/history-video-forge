import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

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
    const { repository } = createTestRepository(tempDirs);

    await repository.save({
      candidateId: "candidate-1",
      seedFamily: "中国古代重大历史事件",
      seedProfile: "中国古代重大历史事件",
      status: "unused",
      sourceProjectId: "project-1",
      sourceTopicRunId: "topic-run-1",
      eventIdentity: "商鞅变法",
      title: "商鞅变法",
      oneLineAngle: "一场改变秦国命运的改革如何引发血腥清洗",
      familyLabel: "政治改革",
      scopeLabel: "国家变革",
      notes: "首轮真实回归保留条目",
    });

    const records = await repository.listBySeed({
      seedFamily: "中国古代重大历史事件",
      seedProfile: "中国古代重大历史事件",
    });

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      candidateId: "candidate-1",
      status: "unused",
      seedFamily: "中国古代重大历史事件",
      seedProfile: "中国古代重大历史事件",
      title: "商鞅变法",
    });
  });

  it("filters candidates by requested status", async () => {
    const { repository } = createTestRepository(tempDirs);

    await repository.save({
      candidateId: "candidate-unused",
      seedFamily: "history-diplomacy",
      seedProfile: "han-court-showdown",
      status: "unused",
      sourceProjectId: "project-1",
      sourceTopicRunId: "topic-run-1",
      eventIdentity: "晏子使楚",
      title: "晏子使楚",
      oneLineAngle: "当场顶回去的不是一句嘴，而是身份场面",
      notes: "",
    });
    await repository.save({
      candidateId: "candidate-fallback",
      seedFamily: "history-diplomacy",
      seedProfile: "han-court-showdown",
      status: "fallback_ready",
      sourceProjectId: "project-1",
      sourceTopicRunId: "topic-run-1",
      eventIdentity: "张巡守城",
      title: "张巡守城",
      oneLineAngle: "明知守不住还得先顶住",
      notes: "",
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
    const { repository } = createTestRepository(tempDirs);

    await repository.save({
      candidateId: "candidate-1",
      seedFamily: "history-diplomacy",
      seedProfile: "han-court-showdown",
      status: "unused",
      sourceProjectId: "project-1",
      sourceTopicRunId: "topic-run-1",
      eventIdentity: "晏子使楚",
      title: "晏子使楚",
      oneLineAngle: "当场顶回去的不是一句嘴，而是身份场面",
      notes: "",
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

  it("stores multiple candidates in one candidates.json file instead of scattered markdown files", async () => {
    const { repository, rootDir } = createTestRepository(tempDirs);

    await repository.save({
      candidateId: "candidate-1",
      seedFamily: "history-diplomacy",
      seedProfile: "han-court-showdown",
      status: "unused",
      sourceProjectId: "project-1",
      sourceTopicRunId: "topic-run-1",
      eventIdentity: "event-1",
      title: "title-1",
      oneLineAngle: "angle-1",
      notes: "note-1",
    });
    await repository.save({
      candidateId: "candidate-2",
      seedFamily: "history-diplomacy",
      seedProfile: "han-court-showdown",
      status: "fallback_ready",
      sourceProjectId: "project-1",
      sourceTopicRunId: "topic-run-2",
      eventIdentity: "event-2",
      title: "title-2",
      oneLineAngle: "angle-2",
      notes: "note-2",
    });

    const directoryPath = resolve(
      rootDir,
      "storage/topic-candidate-library/history-diplomacy/han-court-showdown",
    );
    const filePath = resolve(directoryPath, "candidates.json");

    expect(existsSync(filePath)).toBe(true);

    const document = JSON.parse(readFileSync(filePath, "utf8")) as {
      seed_family: string;
      seed_profile: string;
      candidates: Array<{ candidate_id: string; status: string }>;
    };

    expect(document.seed_family).toBe("history-diplomacy");
    expect(document.seed_profile).toBe("han-court-showdown");
    expect(document.candidates).toHaveLength(2);
    expect(document.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          candidate_id: "candidate-1",
          status: "unused",
        }),
        expect.objectContaining({
          candidate_id: "candidate-2",
          status: "fallback_ready",
        }),
      ]),
    );
  });

  it("keeps markdown codec as legacy only and does not require markdown files for formal storage", () => {
    const repositorySource = readFileSync(
      resolve(
        process.cwd(),
        "backend/src/modules/topic/topic-candidate-library.repository.ts",
      ),
      "utf8",
    );
    const markdownCodecSource = readFileSync(
      resolve(
        process.cwd(),
        "backend/src/modules/topic/topic-candidate-library.codec.ts",
      ),
      "utf8",
    );

    expect(repositorySource).toContain("topic-candidate-library-json.codec");
    expect(repositorySource).not.toContain('topic-candidate-library.codec');
    expect(markdownCodecSource).toContain("@deprecated");
  });
});

function createTestRepository(tempDirs: string[]): {
  repository: TopicCandidateLibraryRepository;
  rootDir: string;
} {
  const rootDir = mkdtempSync(join(tmpdir(), "topic-candidate-library-"));
  tempDirs.push(rootDir);

  return {
    rootDir,
    repository: createTopicCandidateLibraryRepository({
      rootDir,
    }),
  };
}
