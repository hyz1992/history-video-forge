import { describe, expect, it, vi } from "vitest";

// 替换 runTopicRecommendationGraph，让它在 service 内抛 LlmOutputError，
// 验证 service catch 把 code 写入 diagnostics 并降级返回，而非直接 throw。
vi.mock("../../../backend/src/runtime/orchestration/topic-recommendation-graph.js", () => ({
  runTopicRecommendationGraph: vi.fn(),
}));

import { createDbClient } from "../../../backend/src/db/client.js";
import {
  recommendTopicCandidatesWithTrace,
} from "../../../backend/src/modules/topic/topic-recommendation.service.js";
import { runTopicRecommendationGraph } from "../../../backend/src/runtime/orchestration/topic-recommendation-graph.js";
import { LlmOutputError } from "../../../backend/src/runtime/llm/llm-output-error.js";

const baseInput = {
  canonicalName: "晏子使楚",
  summary: "楚王连续压场，晏子一次没退。",
  coreConflict: "楚王借公开场合连续羞辱晏子。",
  strongScene: "殿前对峙",
  sourceHint: "《晏子春秋》",
  recentUsageHint: "近期未使用",
  canonicalQuotes: ["橘生淮南则为橘"],
  canonicalQuoteIntents: [],
  tags: [],
};

describe("recommendTopicCandidatesWithTrace error classification", () => {
  it("degrades gracefully with diagnostics when graph throws LlmOutputError", async () => {
    vi.mocked(runTopicRecommendationGraph).mockImplementation(async () => {
      throw new LlmOutputError("topic_candidate_card_schema_invalid", {
        cause: [{ path: ["event_identity"], message: "Required" }],
      });
    });

    const db = createDbClient();
    const result = await recommendTopicCandidatesWithTrace(db, baseInput);

    // 降级返回：不 throw，candidates 为空，diagnostics 含 schema code
    expect(result.candidates).toEqual([]);
    expect(result.diagnostics.checks).toContainEqual(
      expect.objectContaining({
        code: "topic_candidate_card_schema_invalid",
        level: "warning",
      }),
    );
  });

  it("still throws for non-LlmOutputError exceptions (selector strict schema etc.)", async () => {
    vi.mocked(runTopicRecommendationGraph).mockImplementation(async () => {
      throw new Error("topic_selector_strict_schema_failed");
    });

    const db = createDbClient();
    await expect(
      recommendTopicCandidatesWithTrace(db, baseInput),
    ).rejects.toThrow("topic_selector_strict_schema_failed");
  });
});
