import type { TopicPackage } from "../../../../shared/src/index";

export type TopicPackageScriptSufficiencyStatus =
  | "ok"
  | "observe"
  | "needs_attention";

export interface TopicPackageScriptSufficiencyReport {
  status: TopicPackageScriptSufficiencyStatus;
  warnings: string[];
  metrics: {
    tensionFieldCount: number;
    distinctTensionFieldCount: number;
    selectedAngleRepeatCount: number;
    mustIncludeBeatCount: number;
    distinctMustIncludeBeatCount: number;
  };
}

const TRAILING_PUNCTUATION = /[.,;:!?，。；：！？、]+$/gu;

function normalizeStructuralText(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(TRAILING_PUNCTUATION, "")
    .replace(/\s+/g, " ");
}

function includesNormalized(haystack: string, needle: string): boolean {
  const normalizedHaystack = normalizeStructuralText(haystack);
  const normalizedNeedle = normalizeStructuralText(needle);

  return (
    normalizedNeedle.length > 0 &&
    (normalizedHaystack === normalizedNeedle ||
      normalizedHaystack.includes(normalizedNeedle))
  );
}

function uniqueNormalized(values: string[]): string[] {
  return Array.from(new Set(values.map(normalizeStructuralText).filter(Boolean)));
}

function getTensionFields(topicPackage: TopicPackage): string[] {
  const tensionMap = topicPackage.narrative_tension_map;

  return [
    tensionMap.hook_claim,
    tensionMap.pressure_escalation,
    tensionMap.mid_reveal,
    tensionMap.peak_payoff,
    tensionMap.ending_residue,
  ];
}

function countSelectedAngleRepeats(topicPackage: TopicPackage): number {
  const selectedAngle = topicPackage.selected_angle;
  const fields = [
    ...getTensionFields(topicPackage),
    topicPackage.stakes,
    ...topicPackage.must_include_beats,
  ];

  return fields.filter((field) => includesNormalized(field, selectedAngle)).length;
}

function countDistinctEffectiveBeats(topicPackage: TopicPackage): number {
  const baseMaterials = [
    topicPackage.selected_angle,
    topicPackage.core_conflict,
    topicPackage.strong_scene,
  ].map(normalizeStructuralText);
  const effectiveBeats = topicPackage.must_include_beats.filter((beat) => {
    const normalizedBeat = normalizeStructuralText(beat);

    return (
      normalizedBeat.length > 0 && !baseMaterials.includes(normalizedBeat)
    );
  });

  return uniqueNormalized(effectiveBeats).length;
}

export function assessTopicPackageScriptSufficiency(
  topicPackage: TopicPackage,
): TopicPackageScriptSufficiencyReport {
  const tensionFields = getTensionFields(topicPackage);
  const distinctTensionFields = uniqueNormalized(tensionFields);
  const selectedAngleRepeatCount = countSelectedAngleRepeats(topicPackage);
  const distinctMustIncludeBeatCount =
    countDistinctEffectiveBeats(topicPackage);
  const warnings: string[] = [];

  if (distinctTensionFields.length < tensionFields.length) {
    warnings.push("tension_map_repetition_risk");
  }

  if (selectedAngleRepeatCount >= 3) {
    warnings.push("selected_angle_repetition_risk");
  }

  if (
    topicPackage.must_include_beats.length < 3 ||
    distinctMustIncludeBeatCount < 3
  ) {
    warnings.push("must_include_beats_material_risk");
  }

  return {
    status: warnings.length > 0 ? "needs_attention" : "ok",
    warnings,
    metrics: {
      tensionFieldCount: tensionFields.length,
      distinctTensionFieldCount: distinctTensionFields.length,
      selectedAngleRepeatCount,
      mustIncludeBeatCount: topicPackage.must_include_beats.length,
      distinctMustIncludeBeatCount,
    },
  };
}
