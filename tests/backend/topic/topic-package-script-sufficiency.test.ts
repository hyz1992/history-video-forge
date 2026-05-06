import { describe, expect, it } from "vitest";

import { assessTopicPackageScriptSufficiency } from "../../../backend/src/modules/topic/topic-package-script-sufficiency.js";
import type { TopicPackage } from "../../../shared/src/index.js";

function createTopicPackage(
  overrides: Partial<TopicPackage> = {},
): TopicPackage {
  return {
    topic_id: "topic_zhuanzhu-ciwangliao",
    title: "Zhuanzhu Assassinates Wang Liao",
    selected_angle:
      "A banquet assassination decides the first turn in Wu power.",
    family_label: "assassination pressure",
    scope_label: "single event",
    core_conflict: "There is only one chance to strike at the banquet.",
    stakes:
      "If the assassin misses, the whole faction is exposed immediately.",
    strong_scene: "The sword is hidden inside the fish.",
    packaging_seed:
      "A banquet assassination decides the first turn in Wu power.",
    must_include_beats: [
      "The assassin enters the banquet with the fish.",
      "The sword is revealed from inside the fish.",
      "The guards react as the assassin pays the cost.",
    ],
    forbidden_expansions: ["Do not expand beyond the confirmed event."],
    risk_hints: ["Keep the event scope narrow."],
    source_anchor_refs: ["Shiji"],
    canonical_quotes: [],
    ambiguity_notes: [],
    duration_band: "medium",
    narrative_tension_map: {
      hook_claim:
        "A banquet assassination decides the first turn in Wu power.",
      pressure_escalation:
        "There is only one chance to strike at the banquet.",
      mid_reveal: "The sword is revealed from inside the fish.",
      peak_payoff: "The sword is hidden inside the fish.",
      ending_residue: "The guards react as the assassin pays the cost.",
    },
    ...overrides,
  };
}

describe("topic package script sufficiency", () => {
  it("flags repeated and thin zhuanzhu-like package material", () => {
    const selectedAngle =
      "A banquet assassination decides the first turn in Wu power.";
    const topicPackage = createTopicPackage({
      selected_angle: selectedAngle,
      stakes: `There is only one chance to strike. ${selectedAngle}`,
      must_include_beats: [
        "There is only one chance to strike.",
        "The sword is hidden inside the fish.",
        selectedAngle,
      ],
      narrative_tension_map: {
        hook_claim: selectedAngle,
        pressure_escalation: "There is only one chance to strike.",
        mid_reveal: selectedAngle,
        peak_payoff: "The sword is hidden inside the fish.",
        ending_residue: selectedAngle,
      },
    });

    const report = assessTopicPackageScriptSufficiency(topicPackage);

    expect(report.status).toBe("needs_attention");
    expect(report.metrics.tensionFieldCount).toBe(5);
    expect(report.metrics.distinctTensionFieldCount).toBeLessThan(
      report.metrics.tensionFieldCount,
    );
    expect(report.metrics.selectedAngleRepeatCount).toBeGreaterThanOrEqual(4);
    expect(report.metrics.distinctMustIncludeBeatCount).toBeLessThan(3);
    expect(report.warnings).toEqual(
      expect.arrayContaining([
        "tension_map_repetition_risk",
        "selected_angle_repetition_risk",
        "must_include_beats_material_risk",
      ]),
    );
  });

  it("does not flag repetition warnings when fields carry distinct material", () => {
    const report = assessTopicPackageScriptSufficiency(createTopicPackage());

    expect(report.status).toBe("ok");
    expect(report.metrics.tensionFieldCount).toBe(5);
    expect(report.metrics.distinctTensionFieldCount).toBe(5);
    expect(report.metrics.selectedAngleRepeatCount).toBe(1);
    expect(report.metrics.mustIncludeBeatCount).toBe(3);
    expect(report.metrics.distinctMustIncludeBeatCount).toBe(3);
    expect(report.warnings).not.toContain("tension_map_repetition_risk");
    expect(report.warnings).not.toContain("selected_angle_repetition_risk");
    expect(report.warnings).not.toContain(
      "must_include_beats_material_risk",
    );
  });
});
