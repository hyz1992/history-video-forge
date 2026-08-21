import type { CreativePresetRegistrySnapshot } from "./creative-preset.schema.js";
import { ART_STYLE_PRESET_REGISTRY_V1 } from "./art-style-presets.js";
import { SUBTITLE_STYLE_PRESET_REGISTRY_V1 } from "./subtitle-style-presets.js";

/**
 * S2-2B 当前注册表快照（v1）。
 *
 * 使用边界（外部审查 P1-3 整改）：注册表**只在解析阶段**（报价/提交重解析）
 * 读取并冻结进 `resolved_creative`；执行端只消费快照冻结参数，绝不重读本快照。
 */
export const CREATIVE_PRESET_REGISTRY_SNAPSHOT_V1: CreativePresetRegistrySnapshot = {
  art_style: ART_STYLE_PRESET_REGISTRY_V1,
  subtitle: SUBTITLE_STYLE_PRESET_REGISTRY_V1,
};
