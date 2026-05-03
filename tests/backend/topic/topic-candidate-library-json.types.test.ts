import { describe, expect, it } from "vitest";

import {
  TOPIC_CANDIDATE_LIBRARY_JSON_SCHEMA_VERSION,
  type TopicCandidateLibraryJsonCandidate,
  type TopicCandidateLibraryJsonDocument,
} from "../../../backend/src/modules/topic/topic-candidate-library-json.types.js";

describe("topic candidate library json types", () => {
  it("defines the top-level aggregated json document contract", () => {
    const document = {
      schema_version: TOPIC_CANDIDATE_LIBRARY_JSON_SCHEMA_VERSION,
      seed_family: "中国古代重大历史事件",
      seed_profile: "中国古代重大历史事件",
      seed_family_slug:
        "u8-e4b8ade59bbde58fa4e4bba3e9878de5a4a7e58e86e58fb2e4ba8be4bbb6",
      seed_profile_slug:
        "u8-e4b8ade59bbde58fa4e4bba3e9878de5a4a7e58e86e58fb2e4ba8be4bbb6",
      updated_at: "2026-05-03T00:00:00.000Z",
      candidates: [],
    } satisfies TopicCandidateLibraryJsonDocument;

    expect(document.schema_version).toBe(1);
    expect(document.seed_family).toBe("中国古代重大历史事件");
    expect(document.seed_profile).toBe("中国古代重大历史事件");
    expect(document.candidates).toEqual([]);
  });

  it("defines the minimum candidate contract inside candidates.json", () => {
    const candidate = {
      candidate_id: "raw-topic_run_123-1",
      event_identity: "商鞅变法",
      title: "商鞅变法",
      one_line_angle: "一场改变秦国命运的改革如何引发血腥清洗",
      family_label: "政治改革",
      scope_label: "国家变革",
      status: "raw_generated",
      source_project_id: "project-1",
      source_topic_run_id: "topic_run_123",
      source_seed_family: "中国古代重大历史事件",
      source_seed_profile: "中国古代重大历史事件",
      first_generated_at: "2026-05-03T00:00:00.000Z",
      last_selected_at: "2026-05-03T00:10:00.000Z",
      times_selected: 1,
      times_seen_in_pool: 2,
      notes: "",
    } satisfies TopicCandidateLibraryJsonCandidate;

    expect(candidate.status).toBe("raw_generated");
    expect(candidate.notes).toBe("");
    expect(candidate.times_selected).toBe(1);
    expect(candidate.times_seen_in_pool).toBe(2);
  });
});
