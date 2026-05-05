import { describe, expect, it } from "vitest";

import { planTopicDelivery } from "../../../backend/src/modules/script/topic-delivery-planner.js";

const projectStylePack = {
  narrator_persona: "冷静压迫型旁白",
  wording_register: "sharp_oral",
  subtitle_profile: "dense_short_lines",
  cover_profile: "faces_closeup",
  title_profile: "conflict_first",
  pacing_baseline: "tight",
  risk_posture: "controlled",
};

const familyBiasPack = {
  family_label: "外交压场型",
  opening_pressure_bias: "high",
  exposition_budget: "low",
  pacing_bias: "fast",
  voice_bias: "sharper",
  anti_patterns: ["不要先讲背景百科"],
};

function createTopicPackage(hookClaim: string) {
  return {
    title: "晏子使楚",
    family_label: "外交压场型",
    strong_scene: "楚王连续设局压人，晏子一句话当场翻盘。",
    narrative_tension_map: {
      hook_claim: hookClaim,
      pressure_escalation: "从羞辱身形升级到羞辱齐国。",
      mid_reveal: "晏子守的是齐国场面。",
      peak_payoff: "橘枳之喻把楚王第三次压场顶回去。",
      ending_residue: "这种场面，一退就不只是退掉自己。",
    },
  };
}

describe("topic delivery planner", () => {
  it("keeps an existing hook question as a packaging promise without appending a challenge suffix", () => {
    const pack = planTopicDelivery({
      topicPackage: createTopicPackage("楚王为什么要连压晏子三次？"),
      projectStylePack,
      familyBiasPack,
    });

    expect(pack.hook_claim).toBe("楚王为什么要连压晏子三次？");
    expect(pack.hook_claim).not.toContain("你敢当场顶回去吗");
  });

  it("keeps a declarative hook claim sourced from narrative_tension_map without forcing it into a challenge sentence", () => {
    const pack = planTopicDelivery({
      topicPackage: createTopicPackage("楚王不是只压了晏子一次，而是连压三次"),
      projectStylePack,
      familyBiasPack,
    });

    expect(pack.hook_claim).toBe("楚王不是只压了晏子一次，而是连压三次");
    expect(pack.hook_claim).not.toContain("你敢当场顶回去吗");
    expect(pack.caution_notes).toEqual(
      expect.arrayContaining([
        "不要把 hook 写成课堂导入",
        "不要让包装 promise 偏离 narrative_tension_map.hook_claim",
        "不要先讲背景百科",
      ]),
    );
  });

  it("does not turn a strong scene into the same default challenge template", () => {
    const pack = planTopicDelivery({
      topicPackage: createTopicPackage("楚王连续压场，晏子一次都没退"),
      projectStylePack,
      familyBiasPack,
    });

    expect(pack.hook_claim).toBe("楚王连续压场，晏子一次都没退");
    expect(pack.hook_claim).not.toBe(
      "楚王连续压场，晏子一次都没退，你敢当场顶回去吗？",
    );
  });
});
