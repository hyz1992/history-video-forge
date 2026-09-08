import { isDeepStrictEqual } from "node:util";

import type { AssetPlan } from "../../../../shared/src/index.js";
import {
  compileAssetPlanFromIntents,
  type AssetPlanCompilerInput,
} from "./asset-plan-intent-compiler.js";

export interface ShadowCompatibilityDifference {
  code: string;
  path: string;
  count: number;
}

export interface ShadowCompatibilityReport {
  matched: boolean;
  counts: {
    legacy_tasks: number;
    compiled_tasks: number;
    legacy_dependencies: number;
    compiled_dependencies: number;
    differences: number;
  };
  differences: ShadowCompatibilityDifference[];
}

const MAX_DIFFERENCES = 50;

function taskTypeCounts(plan: AssetPlan): Record<string, number> {
  return Object.fromEntries(
    [...new Set(plan.tasks.map((task) => task.task_type))]
      .sort()
      .map((taskType) => [
        taskType,
        plan.tasks.filter((task) => task.task_type === taskType).length,
      ]),
  );
}

function segmentCoverage(plan: AssetPlan): Record<string, number> {
  const segmentIds = plan.tasks.flatMap((task) =>
    task.source_segment_id === null ? [] : [task.source_segment_id],
  );
  return Object.fromEntries(
    [...new Set(segmentIds)].sort().map((segmentId) => [
      segmentId,
      segmentIds.filter((candidate) => candidate === segmentId).length,
    ]),
  );
}

function countStableKeys(keys: string[]): Record<string, number> {
  return Object.fromEntries(
    [...new Set(keys)].sort().map((key) => [
      key,
      keys.filter((candidate) => candidate === key).length,
    ]),
  );
}

function taskPolicyCounts(plan: AssetPlan): Record<string, number> {
  return countStableKeys(plan.tasks.map((task) => [
    task.task_type,
    task.recommended_mode,
    task.manual_upload_policy.allowed ? "upload_allowed" : "upload_denied",
    task.manual_upload_policy.required ? "upload_required" : "upload_optional",
  ].join(":")));
}

function dependencyTypeCounts(plan: AssetPlan): Record<string, number> {
  return countStableKeys(plan.dependencies.map((item) => item.dependency_type));
}

function countDistance(
  legacyCounts: Record<string, number>,
  compiledCounts: Record<string, number>,
): number {
  return [...new Set([
    ...Object.keys(legacyCounts),
    ...Object.keys(compiledCounts),
  ])].reduce(
    (distance, key) =>
      distance + Math.abs((legacyCounts[key] ?? 0) - (compiledCounts[key] ?? 0)),
    0,
  );
}

export function buildIntentCompilerShadowReport(input: {
  legacyPlan: AssetPlan;
  compilerInput: AssetPlanCompilerInput;
}): ShadowCompatibilityReport {
  const compiledPlan = compileAssetPlanFromIntents(input.compilerInput).plan;
  if (input.legacyPlan.plan_version !== "asset_plan_v1" || compiledPlan.plan_version !== "asset_plan_v1") throw new Error("legacy_asset_shadow_requires_v1");
  const differences: ShadowCompatibilityDifference[] = [];
  const compare = (
    code: string,
    path: string,
    legacyValue: unknown,
    compiledValue: unknown,
    count = 1,
  ) => {
    if (!isDeepStrictEqual(legacyValue, compiledValue)) {
      differences.push({ code, path, count });
    }
  };

  compare("source_storyboard_mismatch", "source.storyboard", input.legacyPlan.source_storyboard_record_id, compiledPlan.source_storyboard_record_id);
  compare("source_script_mismatch", "source.script", input.legacyPlan.source_script_record_id, compiledPlan.source_script_record_id);
  compare("source_topic_mismatch", "source.topic", input.legacyPlan.source_topic_package_id, compiledPlan.source_topic_package_id);
  compare("art_bible_mismatch", "policy.art_bible", input.legacyPlan.art_bible, compiledPlan.art_bible);
  compare("visual_budget_mismatch", "policy.visual_budget", input.legacyPlan.visual_budget, compiledPlan.visual_budget);
  compare("downgrade_policy_mismatch", "policy.downgrade", input.legacyPlan.downgrade_policy, compiledPlan.downgrade_policy);
  compare("audio_strategy_mismatch", "policy.audio", input.legacyPlan.global_audio_strategy, compiledPlan.global_audio_strategy);
  compare("tts_plan_mismatch", "downstream.tts_plan", input.legacyPlan.tts_plan, compiledPlan.tts_plan);
  const legacyTaskTypeCounts = taskTypeCounts(input.legacyPlan);
  const compiledTaskTypeCounts = taskTypeCounts(compiledPlan);
  compare("task_type_counts_mismatch", "downstream.task_type_counts", legacyTaskTypeCounts, compiledTaskTypeCounts, countDistance(legacyTaskTypeCounts, compiledTaskTypeCounts));
  compare("task_policy_counts_mismatch", "policy.task_policies", taskPolicyCounts(input.legacyPlan), taskPolicyCounts(compiledPlan));
  compare("segment_coverage_mismatch", "downstream.segment_coverage", segmentCoverage(input.legacyPlan), segmentCoverage(compiledPlan));
  compare("dependency_count_mismatch", "downstream.dependencies", input.legacyPlan.dependencies.length, compiledPlan.dependencies.length, Math.abs(input.legacyPlan.dependencies.length - compiledPlan.dependencies.length));
  compare("dependency_type_counts_mismatch", "downstream.dependency_types", dependencyTypeCounts(input.legacyPlan), dependencyTypeCounts(compiledPlan));
  compare("task_order_mismatch", "downstream.task_order", input.legacyPlan.tasks.map((task) => task.order), compiledPlan.tasks.map((task) => task.order));

  const boundedDifferences = differences
    .sort((left, right) => left.path.localeCompare(right.path) || left.code.localeCompare(right.code))
    .slice(0, MAX_DIFFERENCES);
  return {
    matched: differences.length === 0,
    counts: {
      legacy_tasks: input.legacyPlan.tasks.length,
      compiled_tasks: compiledPlan.tasks.length,
      legacy_dependencies: input.legacyPlan.dependencies.length,
      compiled_dependencies: compiledPlan.dependencies.length,
      differences: differences.length,
    },
    differences: boundedDifferences,
  };
}
