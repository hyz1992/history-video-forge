import type { DbClient } from "../../db/client.js";

/**
 * S2-2A 任务 7 二次重开（codex 审计 P1-A）：真实付费 provider 派发闸门。
 *
 * buildProviderRegistry 在注册每个真实 DashScope adapter 之前必须通过本 gate：
 * 对应 (capability, providerKey, modelId) 的目录行必须存在且 status=active。
 * 未通过时不得注册 adapter——执行引擎的 no-adapter 路径保证不创建外部调用、
 * 不 fetch、不建 provider job（视频走策略状态机，其余任务跳过）。
 *
 * 目录行由启动 bootstrap 按当前环境（tier/媒体配置/凭据/区域）物化：
 * demo/test、模型失配、区域未知/失配、凭据缺失都会让对应行 disabled 或缺失，
 * 从而在本 gate 处 fail-closed。目录为空（bootstrap 未运行，如纯内存态）
 * 同样拒绝真实付费派发。
 */

export type PaidMediaCapability =
  | "image.generate"
  | "video.image_to_video"
  | "tts.synthesize";

export interface ProviderDispatchGateTarget {
  capability: PaidMediaCapability;
  providerKey: string;
  modelId: string;
  /**
   * 当前部署区域（纵深防护，可选）：提供时要求匹配目录行声明的
   * deployment_scope，防止目录被非 bootstrap 手段写入他区 active 行时
   * 按旧区域价格派发。
   */
  deploymentScope?: string;
}

export type ProviderDispatchGateDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason_code:
        | "catalog_entry_missing"
        | "catalog_entry_disabled"
        | "catalog_entry_mismatch"
        | "catalog_entry_scope_mismatch";
      capability: PaidMediaCapability;
      provider_key: string;
      model_id: string;
      /** 公开原因，不含凭据细节、密钥或环境变量名。 */
      message: string;
    };

/**
 * 权威目录 gate：检查将要真实调用的 (capability, provider, model) 是否为
 * active 目录项。纯函数，只读 db.providerModelCatalog 快照。
 */
export function checkProviderDispatchGate(
  db: DbClient,
  target: ProviderDispatchGateTarget,
): ProviderDispatchGateDecision {
  const deny = (
    reason_code: Exclude<ProviderDispatchGateDecision, { allowed: true }>["reason_code"],
    message: string,
  ): ProviderDispatchGateDecision => ({
    allowed: false,
    reason_code,
    capability: target.capability,
    provider_key: target.providerKey,
    model_id: target.modelId,
    message,
  });

  let capabilityHasActiveRow = false;
  for (const entry of db.providerModelCatalog.values()) {
    if (entry.capability !== target.capability) continue;
    if (entry.status === "active") capabilityHasActiveRow = true;
    if (entry.providerKey !== target.providerKey || entry.modelId !== target.modelId) {
      continue;
    }
    if (entry.status !== "active") {
      return deny(
        "catalog_entry_disabled",
        `目录项 ${entry.id} 不可用于新运行（disabled），禁止真实派发`,
      );
    }
    if (
      target.deploymentScope !== undefined &&
      (entry.parameterCapabilitiesJson as Record<string, unknown>)["deployment_scope"] !==
        target.deploymentScope
    ) {
      return deny(
        "catalog_entry_scope_mismatch",
        `目录项 ${entry.id} 的部署区域与当前运行区域 (${target.deploymentScope}) 不一致，禁止真实派发`,
      );
    }
    return { allowed: true };
  }
  if (capabilityHasActiveRow) {
    return deny(
      "catalog_entry_mismatch",
      `capability ${target.capability} 存在 active 目录项，但与实际执行模型 (${target.providerKey}:${target.modelId}) 不匹配，禁止真实派发`,
    );
  }
  return deny(
    "catalog_entry_missing",
    `capability ${target.capability} 没有目录项 (${target.providerKey}:${target.modelId})，禁止真实派发`,
  );
}
