import { describe, expect, it, vi } from "vitest";

import { createDbClient } from "../../../backend/src/db/client.js";
import { runTopicRecommendationGraph } from "../../../backend/src/runtime/orchestration/topic-recommendation-graph.js";
import { TopicCandidateCard } from "../../../shared/src/index.js";

const runtimeCandidate = {
  title: "晏子使楚",
  one_line_angle: "真正抓人的不是出使本身，而是当场连续顶回压场。",
  family_label: "外交压场型",
  scope_label: "单事件",
  estimated_duration_band: "medium",
  why_this_now: "近期未出现同 event_id，且当前具备可讲张力。",
  core_conflict: "楚王当众压场，晏子必须当场顶回。",
  strong_scene: "楚王连续压场，晏子一句句顶回去。",
  must_cover_preview: ["楚王连续压场，晏子一句句顶回去。"],
  risk_hints: ["避免扩成下游阶段对象"],
  source_hint: "《晏子春秋》",
  recent_usage_hint: "近期未出现同 event_id",
  viral_rubric: {
    hook_power: "high",
    novelty_gap: "high",
    emotion_gap: "high",
    share_impulse: "high",
    visual_promise: "high",
  },
};

describe("topic recommendation graph", () => {
  it("runs topic-candidate-generate through the graph-compatible contract", async () => {
    const db = createDbClient();
    const invokeStructuredPrompt = vi.fn(async () => [runtimeCandidate]);

    const result = await runTopicRecommendationGraph(
      {
        db,
        input: {
          canonicalName: "晏子使楚",
          summary: "楚王在公开场合连续压场，晏子当场顶回去。",
          coreConflict: "楚王当众压场，晏子必须当场顶回。",
          strongScene: "楚王连续压场，晏子一句句顶回去。",
          sourceHint: "《晏子春秋》",
          recentUsageHint: "近期未出现同 event_id",
          tags: ["diplomacy", "court", "humiliation", "showdown"],
        },
        projectId: "project-1",
      },
      {
        invokeStructuredPrompt,
      },
    );

    expect(invokeStructuredPrompt).toHaveBeenCalledTimes(1);
    expect(result.trace.nodes).toEqual([
      {
        node_name: "topic-candidate-generate",
        input_ref: "topic-event:晏子使楚",
        output_ref: "topic-candidate-list:1",
        failure_reason: null,
      },
    ]);
    expect(result.candidates).toHaveLength(1);
    expect(() => TopicCandidateCard.parse(result.candidates[0])).not.toThrow();
  });

  it("keeps the candidate output contract stable while caching graph-generated candidates", async () => {
    const db = createDbClient();

    const result = await runTopicRecommendationGraph(
      {
        db,
        input: {
          canonicalName: "晏子使楚",
          summary: "楚王在公开场合连续压场，晏子当场顶回去。",
          coreConflict: "楚王当众压场，晏子必须当场顶回。",
          strongScene: "楚王连续压场，晏子一句句顶回去。",
          sourceHint: "《晏子春秋》",
          recentUsageHint: "近期未出现同 event_id",
        },
        projectId: "project-1",
      },
      {
        invokeStructuredPrompt: vi.fn(async () => [runtimeCandidate]),
      },
    );

    expect(result.candidates[0]).toMatchObject({
      title: runtimeCandidate.title,
      one_line_angle: runtimeCandidate.one_line_angle,
      family_label: runtimeCandidate.family_label,
      scope_label: runtimeCandidate.scope_label,
      viral_rubric: runtimeCandidate.viral_rubric,
    });

    const cacheRecords = [...db.candidateCache.values()];
    expect(cacheRecords).toHaveLength(1);
    expect(cacheRecords[0]).toMatchObject({
      projectId: "project-1",
      oneLineAngle: runtimeCandidate.one_line_angle,
      familyLabel: runtimeCandidate.family_label,
      scopeLabel: runtimeCandidate.scope_label,
      coreConflict: runtimeCandidate.core_conflict,
      strongScene: runtimeCandidate.strong_scene,
    });
  });
});
