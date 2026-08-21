import type {
  ArtStyleResolvedParams,
  ProjectArtBible,
} from "../../../../shared/src/index.js";

/**
 * S2-2B 画风 preset 确定性兜底合并（详细设计 §7.2）。
 *
 * 本地只做配置应用，不做语义判断：
 * - `global_negative_prompts`：取并集——preset 项必须全部存在（LLM 缺项本地
 *   补齐），LLM 额外项保留。
 * - `global_prompt_prefix`：LLM 输出包含 preset 前缀文本 → 保留 LLM 版本；
 *   否则本地用 preset 值兜底。
 * - `visual_tone`/`era_style`：只由 LLM 在 prompt 约束下吸收，本地不覆盖。
 * - 无 preset（null）→ 输入原样返回（与现状一致）。
 * - 纯函数：不修改输入对象，相同输入产出相同输出。
 */
export interface FrozenArtStylePreset {
  preset_id: string;
  preset_version: string;
  resolved_params: ArtStyleResolvedParams;
}

export function mergeArtStylePresetIntoArtBible(input: {
  artBible: ProjectArtBible;
  preset: FrozenArtStylePreset | null;
}): ProjectArtBible {
  const { artBible, preset } = input;
  if (!preset) {
    return artBible;
  }

  const presetPrefix = preset.resolved_params.global_prompt_prefix;
  const llmKeptPrefix =
    artBible.global_prompt_prefix.includes(presetPrefix);

  return {
    ...artBible,
    global_prompt_prefix: llmKeptPrefix
      ? artBible.global_prompt_prefix
      : presetPrefix,
    global_negative_prompts: [
      ...new Set([
        ...preset.resolved_params.global_negative_prompts,
        ...artBible.global_negative_prompts,
      ]),
    ],
  };
}
