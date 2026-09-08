import { AssetPlanV2 } from "../../../../shared/src/index.js";
import { compileAssetPlanFromIntents, type AssetPlanCompilerInput } from "./asset-plan-intent-compiler.js";

/** 复用视觉意图编译，音频只引用已确认来源。 */
export function compileNarrationAssetPlan(input: Omit<AssetPlanCompilerInput, "audioSkeleton">) {
  if (input.storyboard.plan_version !== "storyboard_v2") throw new Error("narration_storyboard_v2_required");
  const result = compileAssetPlanFromIntents(input);
  return { ...result, plan: AssetPlanV2.parse(result.plan) };
}
