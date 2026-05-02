import { describe, expect, it } from "vitest";

import {
  parseTopicCandidateLibraryDocument,
  serializeTopicCandidateLibraryDocument,
  type TopicCandidateLibraryDocument,
} from "../../../backend/src/modules/topic/topic-candidate-library.codec.js";

describe("topic candidate library codec", () => {
  it("serializes one candidate into YAML front matter plus Markdown body", () => {
    const document: TopicCandidateLibraryDocument = {
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
      firstGeneratedAt: "2026-05-02T10:00:00.000Z",
      lastSelectedAt: "2026-05-02T12:00:00.000Z",
      timesSelected: 1,
      timesSeenInPool: 2,
      notes: "## 保留原因\n\n- 可作为更多候选预览\n- 同 profile 下允许受控 fallback",
    };

    const serialized = serializeTopicCandidateLibraryDocument(document);

    expect(serialized).toContain("---\n");
    expect(serialized).toContain("candidate_id: candidate-1");
    expect(serialized).toContain("source_seed_family: history-diplomacy");
    expect(serialized).toContain("source_seed_profile: han-court-showdown");
    expect(serialized).toContain("family_label: 外交压场型");
    expect(serialized).toContain("scope_label: 单事件");
    expect(serialized).toContain("times_selected: 1");
    expect(serialized).toContain("times_seen_in_pool: 2");
    expect(serialized).toContain("\n## 保留原因\n");
  });

  it("round-trips key fields and preserves manual notes body", () => {
    const serialized = `---
candidate_id: candidate-1
event_identity: 晏子使楚
title: 晏子使楚：出使楚国的压场对顶
one_line_angle: 真正抓人的不是出使本身，而是当场连续顶回压场。
family_label: 外交压场型
scope_label: 单事件
status: fallback_ready
source_project_id: project-1
source_topic_run_id: topic-run-1
source_seed_family: history-diplomacy
source_seed_profile: han-court-showdown
first_generated_at: 2026-05-02T10:00:00.000Z
last_selected_at: 2026-05-02T12:00:00.000Z
times_selected: 1
times_seen_in_pool: 2
---

## 人工备注

- 适合补更多候选预览
- 只能在同 family/profile 下复用
`;

    const parsed = parseTopicCandidateLibraryDocument(serialized);

    expect(parsed).toMatchObject({
      candidateId: "candidate-1",
      eventIdentity: "晏子使楚",
      title: "晏子使楚：出使楚国的压场对顶",
      oneLineAngle: "真正抓人的不是出使本身，而是当场连续顶回压场。",
      familyLabel: "外交压场型",
      scopeLabel: "单事件",
      status: "fallback_ready",
      sourceProjectId: "project-1",
      sourceTopicRunId: "topic-run-1",
      seedFamily: "history-diplomacy",
      seedProfile: "han-court-showdown",
      firstGeneratedAt: "2026-05-02T10:00:00.000Z",
      lastSelectedAt: "2026-05-02T12:00:00.000Z",
      timesSelected: 1,
      timesSeenInPool: 2,
    });
    expect(parsed.notes).toContain("## 人工备注");
    expect(parsed.notes).toContain("只能在同 family/profile 下复用");
  });
});
