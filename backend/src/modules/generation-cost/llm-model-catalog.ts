/**
 * S2-2C（详细设计 §7.1）：LLM 候选常量表（服务端受控）。
 *
 * 语义：运营声明"平台可选的 LLM 模型清单"——两个都是项目当前真实在用的
 * 模型（deepseek-v4-pro / glm-4），不虚构模型名。每个候选在非 stub 部署下
 * 种入 `llm.smart` 与 `llm.flash` 两个槽位目录（非默认条目），tier 解析结果
 * 的模型为该槽默认条目。
 *
 * 元数据来源（外部审查 P2 整改）：目录条目的 displayName/qualityTier/
 * speedTier 一律来自候选声明（按 providerKey:modelId 匹配），默认条目与候选
 * 条目统一——同一模型在 smart/flash 两个槽位展示一致，前端标签与"候选声明"
 * 而非"槽位"绑定；tier 解析模型不在候选表中时（env 配置了第三个模型）回退
 * 槽位默认（displayName=provider:model）。
 *
 * 价格：两模型均无已核实公开价 → unpriced（llmTokenPricing 既有逻辑），报价
 * unbounded、预算门禁必须显式授权（诚实：未知价格不伪造）。
 */

export interface LlmModelCandidate {
  providerKey: string;
  modelId: string;
  displayName: string;
  qualityTier: string;
  speedTier: string;
}

/** 平台可选 LLM 模型清单（v1）。扩展属运营后续工作：追加条目即可让前端候选列表自动扩展。 */
export const LLM_MODEL_CANDIDATES_V1: LlmModelCandidate[] = [
  {
    providerKey: "deepseek",
    modelId: "deepseek-v4-pro",
    displayName: "DeepSeek V4 Pro",
    qualityTier: "high",
    speedTier: "slow",
  },
  {
    providerKey: "zhipu",
    modelId: "glm-4",
    displayName: "智谱 GLM-4",
    qualityTier: "standard",
    speedTier: "fast",
  },
];
