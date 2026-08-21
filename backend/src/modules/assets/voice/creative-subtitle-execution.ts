import type { DbClient, ProjectRecord } from "../../../db/client.js";
import { getProjectGenerationConfiguration } from "../../generation-config/generation-config.repository.js";
import {
  applySubtitleStyleOverrides,
  type SubtitleStyle,
} from "../../../../../shared/src/index.js";
import { SUBTITLE_STYLE_PRESET_REGISTRY_V1 } from "../../../../../shared/src/index.js";

/**
 * S2-2B（详细设计 §8）：legacy 免 quote 路径的字幕样式解析。
 *
 * 提交路径不经过本函数：最终样式直接取快照 `resolved_creative.subtitle`
 * （`createAssetsDispatchHandler` 投影进 execution options）。
 * legacy 路径从项目配置 `creative.subtitle_style_preset_id` + 安全覆盖解析：
 * - null → 返回 null（执行端用系统默认样式，现状行为）。
 * - 非 null → 注册表查找（fail-closed：preset 缺失按错误抛），应用白名单覆盖。
 *   覆盖字段必须在该 preset 声明的可覆盖字段内（与 resolver 同规则）。
 */
export async function resolveCreativeSubtitleForExecution(
  db: DbClient,
  project: ProjectRecord,
): Promise<SubtitleStyle | null> {
  const config = await getProjectGenerationConfiguration(db, project.id, project.ownerId);
  const creative = config.configuration.creative;
  if (creative.subtitle_style_preset_id === null) {
    return null;
  }

  const preset = SUBTITLE_STYLE_PRESET_REGISTRY_V1.find(
    (candidate) => candidate.preset_id === creative.subtitle_style_preset_id,
  );
  if (!preset) {
    throw new Error("generation_creative_preset_unavailable");
  }
  for (const field of Object.keys(creative.subtitle_style_overrides)) {
    if (!preset.resolved_params.overridable_fields.includes(field as never)) {
      throw new Error(`generation_creative_subtitle_override_invalid:${field}`);
    }
  }
  return applySubtitleStyleOverrides(
    preset.resolved_params.style,
    creative.subtitle_style_overrides,
  );
}
