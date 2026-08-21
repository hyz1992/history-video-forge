import type { DbClient, ProjectRecord } from "../../../db/client.js";
import { getProjectGenerationConfiguration } from "../../generation-config/generation-config.repository.js";
import { getVoiceProfileById } from "./voice-profile.repository.js";

/**
 * S2-2B（详细设计 §6.2）：legacy 免 quote 路径的音色来源。
 *
 * 客户端请求体 `voice_profile_id` 已废弃（前端不再发送）；legacy 路径忽略
 * 客户端值，改由项目配置 `creative.voice_profile_id` 解析：
 * - `null` → 返回空串（执行端触发 intent 自动匹配，现状语义）。
 * - 非 null → 校验档案存在、非 deleted、且对项目 owner 可见；
 *   提供商与 tts.synthesize 目录默认模型同族校验（fail-closed）。
 *
 * 提交路径不经过本函数：执行音色直接取快照 `resolved_creative.voice`
 * （`createAssetsDispatchHandler`），冲突由提交校验先于 quote 消费拒绝。
 */
export async function resolveCreativeVoiceForExecution(
  db: DbClient,
  project: ProjectRecord,
): Promise<string> {
  const config = await getProjectGenerationConfiguration(db, project.id, project.ownerId);
  const creative = config.configuration.creative;
  if (creative.voice_profile_id === null) {
    return "";
  }

  const profile = await getVoiceProfileById(db, creative.voice_profile_id, {
    ownerId: project.ownerId,
  });
  if (!profile || profile.provider_status === "deleted") {
    throw new Error("generation_creative_voice_profile_unavailable");
  }

  const ttsDefault = [...db.providerModelCatalog.values()].find(
    (entry) =>
      entry.capability === "tts.synthesize" &&
      entry.status === "active" &&
      entry.isDefault,
  );
  if (
    ttsDefault &&
    profile.provider_name.trim().toLowerCase() !== ttsDefault.providerKey.trim().toLowerCase()
  ) {
    throw new Error("generation_creative_voice_provider_incompatible");
  }

  return profile.voice_profile_id;
}
