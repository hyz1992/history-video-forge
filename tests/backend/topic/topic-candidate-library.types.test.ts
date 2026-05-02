import { describe, expect, it } from "vitest";

import {
  TOPIC_CANDIDATE_LIBRARY_REQUIRED_FIELDS,
  TOPIC_CANDIDATE_LIBRARY_STATUSES,
  type TopicCandidateLibraryEntry,
} from "../../../backend/src/modules/topic/topic-candidate-library.types.js";

describe("topic candidate library types", () => {
  it("freezes the v1 required text entry contract", () => {
    expect(TOPIC_CANDIDATE_LIBRARY_REQUIRED_FIELDS).toEqual([
      "candidateId",
      "seedFamily",
      "seedProfile",
      "status",
      "sourceProjectId",
      "sourceTopicRunId",
      "eventIdentity",
      "title",
      "oneLineAngle",
    ]);

    const entry: TopicCandidateLibraryEntry = {
      candidateId: "candidate-1",
      seedFamily: "history",
      seedProfile: "history-diplomacy",
      status: "raw_generated",
      sourceProjectId: "project-1",
      sourceTopicRunId: "topic-run-1",
      eventIdentity: "晏子使楚",
      title: "晏子使楚：出使楚国的压场对顶",
      oneLineAngle: "真正抓人的不是出使本身，而是当场连续顶回压场。",
    };

    expect(entry).toMatchObject({
      seedFamily: "history",
      seedProfile: "history-diplomacy",
      status: "raw_generated",
      sourceProjectId: "project-1",
      sourceTopicRunId: "topic-run-1",
      eventIdentity: "晏子使楚",
      title: "晏子使楚：出使楚国的压场对顶",
      oneLineAngle: "真正抓人的不是出使本身，而是当场连续顶回压场。",
    });
  });

  it("exposes the approved v1 lifecycle statuses", () => {
    expect(TOPIC_CANDIDATE_LIBRARY_STATUSES).toEqual([
      "raw_generated",
      "selector_pool",
      "final_selected",
      "unused",
      "fallback_ready",
      "expired",
    ]);
  });
});
