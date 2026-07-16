import { describe, expect, it } from "vitest";

import { projectTopicSelectorPool } from "../../../backend/src/modules/topic/topic-selector-prompt-projection.js";

describe("topic selector prompt projection", () => {
  it("keeps ranking evidence while dropping local-only and builder-self-rating fields", () => {
    const candidate = {
      candidate_id: "selector_candidate_1",
      event_identity: "高平陵之变",
      normalized_event_identity: "高平陵之变",
      title: "司马懿在高平陵之变中夺权",
      one_line_angle: "曹爽离开洛阳后，司马懿利用短暂窗口控制都城",
      family_label: "宫变夺权",
      scope_label: "魏晋",
      core_conflict: "司马懿必须在曹爽返城前控制权力中枢",
      strong_scene: "洛阳城门关闭，太后诏令送往各处",
      must_cover_preview: ["曹爽离城", "司马懿控制洛阳", "曹氏集团失势"],
      risk_hints: ["投降与后续处置不能写成当场伏杀"],
      viral_rubric: {
        hook_power: "high" as const,
        novelty_gap: "medium" as const,
        emotion_gap: "high" as const,
        share_impulse: "medium" as const,
        visual_promise: "high" as const,
      },
      fatigue_score: 0,
      recently_seen: false,
    };
    const before = structuredClone(candidate);

    const projected = projectTopicSelectorPool([candidate]);

    expect(projected).toEqual([
      {
        candidate_id: "selector_candidate_1",
        event_identity: "高平陵之变",
        title: "司马懿在高平陵之变中夺权",
        one_line_angle: "曹爽离开洛阳后，司马懿利用短暂窗口控制都城",
        family_label: "宫变夺权",
        scope_label: "魏晋",
        core_conflict: "司马懿必须在曹爽返城前控制权力中枢",
        strong_scene: "洛阳城门关闭，太后诏令送往各处",
        must_cover_preview: ["曹爽离城", "司马懿控制洛阳", "曹氏集团失势"],
        risk_hints: ["投降与后续处置不能写成当场伏杀"],
        fatigue_score: 0,
      },
    ]);
    expect(candidate).toEqual(before);
    expect(JSON.stringify(projected).length).toBeLessThan(
      JSON.stringify([candidate]).length,
    );
  });

  it("preserves candidate order and does not drop fatigue candidates", () => {
    const base = {
      event_identity: "事件",
      normalized_event_identity: "事件",
      title: "标题",
      one_line_angle: "切口",
      family_label: "题材",
      scope_label: "时代",
      core_conflict: "冲突",
      strong_scene: "场景",
      must_cover_preview: ["开场", "转折", "余震"],
      risk_hints: ["风险"],
      viral_rubric: {
        hook_power: "medium" as const,
        novelty_gap: "medium" as const,
        emotion_gap: "medium" as const,
        share_impulse: "medium" as const,
        visual_promise: "medium" as const,
      },
      recently_seen: false,
    };

    expect(
      projectTopicSelectorPool([
        { ...base, candidate_id: "candidate_1", fatigue_score: 0 },
        { ...base, candidate_id: "candidate_2", fatigue_score: 2, recently_seen: true },
      ]).map((candidate) => [candidate.candidate_id, candidate.fatigue_score]),
    ).toEqual([
      ["candidate_1", 0],
      ["candidate_2", 2],
    ]);
  });
});
