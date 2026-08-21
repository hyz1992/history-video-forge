import type { ResolvedGenerationConfigurationV1 } from "../../../../shared/src/index.js";
import type { FrozenArtStylePreset } from "./art-style-preset-merge.js";

/**
 * S2-2B 画风执行上下文（外部审查 P1-3 整改）。
 *
 * 执行端只消费快照冻结的 `resolved_creative.art_style` 参数，绝不重新读取
 * preset 注册表当前版本——注册表升级后，已创建快照的运行仍使用快照内版本。
 * 调用链：`createAssetPlanDispatchHandler`（llm-dispatch-handlers.ts）→
 * `runAssetPlanningGeneration` → `generateAssetPlan`。
 */
export function extractArtStylePresetFromResolved(
  resolved: ResolvedGenerationConfigurationV1,
): FrozenArtStylePreset | null {
  const artStyle = resolved.resolved_creative.art_style;
  if (artStyle.mode !== "fixed" || artStyle.resolved_params === null) {
    return null;
  }
  return {
    preset_id: artStyle.preset_id!,
    preset_version: artStyle.preset_version!,
    resolved_params: artStyle.resolved_params,
  };
}
