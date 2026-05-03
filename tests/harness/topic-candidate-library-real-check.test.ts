import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildDefaultChinaTopicCandidateLibraryRequest,
  runTopicCandidateLibraryRealCheck,
} from "../../harness/scripts/runtime/topic-candidate-library-real-check";

describe("topic candidate library real check", () => {
  it("keeps the default China seed request in readable Chinese", () => {
    expect(buildDefaultChinaTopicCandidateLibraryRequest()).toEqual({
      canonical_name: "中国古代重大历史事件",
      summary:
        "聚焦中国古代范围内具有强冲突、强反转、强传播潜力的具体历史事件，优先选择能够落到单一事件并兼具戏剧性的题材。",
      core_conflict: "王权、制度、战争、谋略与人性之间的激烈冲突",
      strong_scene: "宫廷博弈、战场决断、朝堂翻盘、边疆危局等强戏剧场景",
      source_hint: "system recommendation",
      recent_usage_hint:
        "近期避免重复高频知名事件，优先扩展不同朝代、不同冲突类型与不同叙事结构。",
      tags: ["china", "ancient-history", "history", "conflict"],
    });
  });

  it("writes a UTF-8 summary that preserves the request text", async () => {
    const outputDir = mkdtempSync(join(tmpdir(), "svf2-topic-candidate-library-real-check-"));
    const request = buildDefaultChinaTopicCandidateLibraryRequest();

    const result = await runTopicCandidateLibraryRealCheck(
      {
        rounds: 2,
        outputDir,
        request,
      },
      {
        sampleRunner: async ({ round }) => ({
          statusCode: 200,
          round,
          runId: `topic_run_${round}`,
          candidateCount: 3,
          candidates: [
            {
              candidate_id: `candidate-${round}`,
              event_identity: "鸿门宴",
              title: "鸿门宴：项羽与刘邦的政治博弈",
              one_line_angle: "一场改变楚汉走向的宴席",
            },
          ],
          diagnosticCodes: ["topic_candidate_generate_passed"],
          fallbackLoaded: false,
          selectorContainsFallbackCandidate: false,
          selectorTracePath: null,
          runDir: null,
        }),
      },
    );

    expect(result.projectName).toContain("China Topic Candidate Library");
    expect(existsSync(join(outputDir, "summary.json"))).toBe(true);

    const summary = JSON.parse(
      readFileSync(join(outputDir, "summary.json"), "utf8"),
    ) as {
      request: {
        canonical_name: string;
        summary: string;
      };
      rounds: Array<{
        round: number;
        statusCode: number;
      }>;
    };

    expect(summary.request.canonical_name).toBe("中国古代重大历史事件");
    expect(summary.request.summary).toContain("强冲突");
    expect(summary.rounds).toHaveLength(2);
    expect(summary.rounds[1]).toMatchObject({
      round: 2,
      statusCode: 200,
    });
  });
});
