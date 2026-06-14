import { describe, expect, it } from "vitest";

import { buildTopicCandidates } from "../../../backend/src/modules/topic/topic-candidate.builder.js";

describe("topic candidate builder", () => {
  it("builds must_cover_preview from node-like seed material instead of summary prose", () => {
    const summary = "楚王在公开场合连续羞辱晏子，晏子必须当场顶回去。";
    const coreConflict = "楚王当众羞辱，晏子不能退。";
    const strongScene = "狗门羞辱与朝堂反击";

    const candidates = buildTopicCandidates({
      canonicalName: "晏子使楚",
      summary,
      coreConflict,
      strongScene,
      sourceHint: "《晏子春秋》",
      recentUsageHint: "测试样本",
      canonicalQuotes: [
        "使狗国者，从狗门入",
        "橘生淮南则为橘，生于淮北则为枳",
      ],
      tags: ["diplomacy", "court", "humiliation", "showdown"],
    });

    // With non-instruction summary, strong_scene = summary,
    // core_conflict = summary (same), deduped, then quotes follow
    expect(candidates[0]?.must_cover_preview).toEqual([
      summary,
      "使狗国者，从狗门入",
      "橘生淮南则为橘，生于淮北则为枳",
    ]);
    // Old seed values (instruction-like) are NOT leaked verbatim
    expect(candidates[0]?.must_cover_preview).not.toEqual([
      strongScene,
      "使狗国者，从狗门入",
      "橘生淮南则为橘，生于淮北则为枳",
    ]);
    // Generated core_conflict and strong_scene should NOT be the raw
    // prompt-instruction text from the seed
    expect(candidates[0]?.core_conflict).toBe(summary);
    expect(candidates[0]?.strong_scene).toBe(summary);
  });
});
