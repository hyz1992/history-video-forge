/**
 * Operation → Tier 映射注册表（S2-1）。
 *
 * 设计约束（见 docs/plans/2026-07-17-s2-1-multi-provider-model-routing-design.md §4.2）：
 *
 * - tier 是模型路由的唯一配置维度，与 mode（tool_call vs json_object）正交。
 * - tier 划分按"是否需要 reasoning 深度"二元化：smart / flash。
 * - 每个 operation 显式登记所需 tier；未知 operation 默认 smart（保守，避免误用 flash 牺牲质量）。
 * - topic.selector 必须是 smart——S2-0 已证明切到 flash 会回到风险召回 0/2 死结。
 * - 已从生产链路移除的 operation（如 topic.light-review）不在 registry 中，运行时落入未知默认 smart。
 * - 与 operation-policy.ts 正交：本注册表管"用哪个模型"，operation-policy 管"怎么调"（thinking/retry/timeout）。
 */

export type OperationTier = "smart" | "flash";

/**
 * 显式 operation → tier 映射（白名单）。
 * 新增 operation 必须在此显式登记，否则落入未知默认 smart。
 */
export const OPERATION_TIER_REGISTRY: Record<string, OperationTier> = {
  // 核心语义生成：长口播文案，需要深度叙事
  "script.writer": "smart",

  // 长结构化生成：输出体量大或字段值是创意文本
  "storyboard.planner": "smart",
  "storyboard.segment-regen": "smart",
  "topic.candidate-builder": "smart",
  "topic.candidate-builder-repair": "smart",
  "asset-planning.planner": "smart",
  "asset-planning.asset-structural-repair": "smart",

  // 短结构化判断：需要 reasoning 才能保证召回（S2-0 实测：flash 召回 0/2）
  "topic.selector": "smart",

  // shadow 语义评审：需要深度语义判断
  "script.semantic-reviewer": "smart",

  // 短结构化生成：输出短、字段固定、不需要 reasoning
  "publish.title-generator": "flash",
  "publish.description-generator": "flash",
  "publish.cover-prompt-generator": "flash",
  "publish.cover-prompt-optimizer": "flash",
  "asset.prompt-optimizer": "flash",

  // 自定义选题提炼：输入自由文本 → 结构化事件，涉及事实边界判断
  "topic.custom-refine": "smart",
};

const DEFAULT_TIER: OperationTier = "smart";
const warnedOperations = new Set<string>();

/**
 * 按 operation 名查询 tier。
 *
 * 未知 operation（不在 registry 中）默认返回 smart，并对每个未知 operation 记一次 warning
 * （沿用 operation-policy.ts 的 warnedOperations 模式，避免日志爆炸）。
 */
export function getOperationTier(operationName: string): OperationTier {
  const tier = OPERATION_TIER_REGISTRY[operationName];
  if (tier) {
    return tier;
  }

  if (!warnedOperations.has(operationName)) {
    warnedOperations.add(operationName);
    // eslint-disable-next-line no-console
    console.warn(
      `[operation-tier-registry] 未知 operation "${operationName}"，默认使用 smart tier。请在 OPERATION_TIER_REGISTRY 中显式登记该 operation。`,
    );
  }

  return DEFAULT_TIER;
}
