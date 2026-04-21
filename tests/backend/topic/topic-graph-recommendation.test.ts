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

function createRuntimeCandidate(title: string, angle: string) {
  return {
    ...runtimeCandidate,
    title,
    one_line_angle: angle,
  };
}

describe("topic recommendation graph", () => {
  it("keeps exactly three candidate slots when the provider returns a full candidate set", async () => {
    const db = createDbClient();
    const invokeStructuredPrompt = vi.fn(async () => [
      createRuntimeCandidate("晏子使楚", "第一槽位"),
      createRuntimeCandidate("张巡守城", "第二槽位"),
      createRuntimeCandidate("于谦守京", "第三槽位"),
    ]);

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
    expect(result.trace.nodes[0]).toMatchObject({
      node_name: "topic-candidate-generate",
      input_ref: "topic-event:晏子使楚",
      output_ref: "topic-candidate-list:3",
      failure_reason: null,
    });
    expect(result.trace).toMatchObject({
      phase: "topic",
      run_id: expect.stringMatching(/^topic_run_/),
    });
    expect(result.trace.steps).toEqual([
      expect.objectContaining({
        step_name: "topic-candidate-generate",
        phase: "topic",
        status: "succeeded",
        input_ref: "topic-event:晏子使楚",
        output_ref: "topic-candidate-list:3",
        started_at: expect.any(String),
        ended_at: expect.any(String),
        duration_ms: expect.any(Number),
      }),
    ]);
    expect(result.candidates).toHaveLength(3);
    expect(result.diagnostics.checks).toContainEqual(
      expect.objectContaining({
        code: "topic_candidate_slot_guard_passed",
      }),
    );
    expect(() => TopicCandidateCard.parse(result.candidates[0])).not.toThrow();
  });

  it("triggers a single repair pass when the provider returns too few candidates", async () => {
    const db = createDbClient();
    const invokeStructuredPrompt = vi
      .fn()
      .mockResolvedValueOnce([createRuntimeCandidate("晏子使楚", "第一槽位")])
      .mockResolvedValueOnce([
        createRuntimeCandidate("张巡守城", "第二槽位"),
        createRuntimeCandidate("于谦守京", "第三槽位"),
      ]);

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
        invokeStructuredPrompt,
      },
    );

    expect(invokeStructuredPrompt).toHaveBeenCalledTimes(2);
    expect(result.candidates).toHaveLength(3);
    expect(result.trace.nodes.map((node) => node.node_name)).toContain(
      "topic-candidate-repair",
    );
    expect(result.trace.steps.map((step) => step.step_name)).toEqual([
      "topic-candidate-generate",
      "topic-candidate-repair",
    ]);
    expect(result.diagnostics.checks).toContainEqual(
      expect.objectContaining({
        code: "topic_candidate_repair_triggered",
      }),
    );
  });

  it("returns explicit diagnostics when a single repair pass still cannot fill all three candidate slots", async () => {
    const db = createDbClient();
    const invokeStructuredPrompt = vi
      .fn()
      .mockResolvedValueOnce([createRuntimeCandidate("晏子使楚", "第一槽位")])
      .mockResolvedValueOnce([]);

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
        invokeStructuredPrompt,
      },
    );

    expect(invokeStructuredPrompt).toHaveBeenCalledTimes(2);
    expect(result.candidates).toHaveLength(1);
    expect(result.diagnostics.checks).toContainEqual(
      expect.objectContaining({
        code: "topic_candidate_slots_insufficient",
        level: "error",
      }),
    );
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
        invokeStructuredPrompt: vi.fn(async () => [
          createRuntimeCandidate("晏子使楚", "第一槽位"),
          createRuntimeCandidate("张巡守城", "第二槽位"),
          createRuntimeCandidate("于谦守京", "第三槽位"),
        ]),
      },
    );

    expect(result.candidates[0]).toMatchObject({
      title: "晏子使楚",
      one_line_angle: "第一槽位",
      family_label: runtimeCandidate.family_label,
      scope_label: runtimeCandidate.scope_label,
      viral_rubric: runtimeCandidate.viral_rubric,
    });

    const cacheRecords = [...db.candidateCache.values()];
    expect(cacheRecords).toHaveLength(3);
    expect(cacheRecords[0]).toMatchObject({
      projectId: "project-1",
      oneLineAngle: "第一槽位",
      familyLabel: runtimeCandidate.family_label,
      scopeLabel: runtimeCandidate.scope_label,
      coreConflict: runtimeCandidate.core_conflict,
      strongScene: runtimeCandidate.strong_scene,
    });
  });
});
