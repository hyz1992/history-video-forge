import { describe, expect, it } from "vitest";

import {
  parseTopicCandidateLibraryJsonDocument,
  serializeTopicCandidateLibraryJsonDocument,
} from "../../../backend/src/modules/topic/topic-candidate-library-json.codec.js";
import {
  TOPIC_CANDIDATE_LIBRARY_JSON_SCHEMA_VERSION,
  type TopicCandidateLibraryJsonDocument,
} from "../../../backend/src/modules/topic/topic-candidate-library-json.types.js";

describe("topic candidate library json codec", () => {
  it("serializes the aggregated document into stable pretty JSON", () => {
    const document: TopicCandidateLibraryJsonDocument = {
      schema_version: TOPIC_CANDIDATE_LIBRARY_JSON_SCHEMA_VERSION,
      seed_family: "中国古代重大历史事件",
      seed_profile: "中国古代重大历史事件",
      seed_family_slug:
        "u8-e4b8ade59bbde58fa4e4bba3e9878de5a4a7e58e86e58fb2e4ba8be4bbb6",
      seed_profile_slug:
        "u8-e4b8ade59bbde58fa4e4bba3e9878de5a4a7e58e86e58fb2e4ba8be4bbb6",
      updated_at: "2026-05-03T00:00:00.000Z",
      candidates: [
        {
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
          notes: "首轮真实回归保留条目",
        },
      ],
    };

    const serialized = serializeTopicCandidateLibraryJsonDocument(document);

    expect(serialized).toContain('"schema_version": 1');
    expect(serialized).toContain('"seed_family": "中国古代重大历史事件"');
    expect(serialized).toContain('"notes": "首轮真实回归保留条目"');
    expect(serialized.endsWith("\n")).toBe(true);
  });

  it("parses the aggregated JSON document back into the same shape", () => {
    const content = `{
  "schema_version": 1,
  "seed_family": "中国古代重大历史事件",
  "seed_profile": "中国古代重大历史事件",
  "seed_family_slug": "u8-e4b8ade59bbde58fa4e4bba3e9878de5a4a7e58e86e58fb2e4ba8be4bbb6",
  "seed_profile_slug": "u8-e4b8ade59bbde58fa4e4bba3e9878de5a4a7e58e86e58fb2e4ba8be4bbb6",
  "updated_at": "2026-05-03T00:00:00.000Z",
  "candidates": [
    {
      "candidate_id": "fallback-topic_run_123-1",
      "event_identity": "鸿门宴",
      "title": "鸿门宴：项羽与刘邦的政治博弈",
      "one_line_angle": "一场决定楚汉走向的宴席",
      "family_label": "权力博弈",
      "scope_label": "关键事件",
      "status": "fallback_ready",
      "source_project_id": "project-2",
      "source_topic_run_id": "topic_run_123",
      "source_seed_family": "中国古代重大历史事件",
      "source_seed_profile": "中国古代重大历史事件",
      "first_generated_at": "2026-05-03T00:00:00.000Z",
      "last_selected_at": "2026-05-03T00:10:00.000Z",
      "times_selected": 3,
      "times_seen_in_pool": 5,
      "notes": "人工标记为 fallback_ready"
    }
  ]
}
`;

    const parsed = parseTopicCandidateLibraryJsonDocument(content);

    expect(parsed).toMatchObject({
      schema_version: 1,
      seed_family: "中国古代重大历史事件",
      seed_profile: "中国古代重大历史事件",
      updated_at: "2026-05-03T00:00:00.000Z",
    });
    expect(parsed.candidates).toHaveLength(1);
    expect(parsed.candidates[0]).toMatchObject({
      candidate_id: "fallback-topic_run_123-1",
      status: "fallback_ready",
      notes: "人工标记为 fallback_ready",
      times_selected: 3,
      times_seen_in_pool: 5,
    });
  });
});
