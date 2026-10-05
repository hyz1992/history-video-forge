/**
 * S2-2C（详细设计 §7.1）：LLM 候选常量表（服务端受控）。
 *
 * 语义：运营声明"平台可选的 LLM 模型清单"——项目当前真实在用的模型
 * 与允许选择的候选模型，不虚构模型名。
 * 每个候选种入其声明槽位（`slots`，缺省 = smart/flash 两槽）的目录（非默认
 * 条目），tier 解析结果的模型为该槽默认条目。smart/flash 表示任务用途，
 * DeepSeek V4 Flash 与 GLM-5.3-Flash 均可用于两槽。
 *
 * 元数据来源（外部审查 P2 整改）：目录条目的 displayName/qualityTier/
 * speedTier 一律来自候选声明（按 providerKey:modelId 匹配），默认条目与候选
 * 条目统一——同一模型在 smart/flash 两个槽位展示一致，前端标签与"候选声明"
 * 而非"槽位"绑定；tier 解析模型不在候选表中时（env 配置了第三个模型）回退
 * 槽位默认（displayName=provider:model）。
 *
 * 价格由 llmTokenPricing 的已核实价格表决定，未核实模型保持 unpriced。
 */

export interface LlmModelCandidate {
  providerKey: string;
  modelId: string;
  displayName: string;
  qualityTier: string;
  speedTier: string;
  /** 候选适用的目录槽位；缺省 = 两槽都种。 */
  slots?: Array<"llm.smart" | "llm.flash">;
}

/** 平台可选 LLM 模型清单（v1）。扩展属运营后续工作：追加条目即可让前端候选列表自动扩展。 */
export const LLM_MODEL_CANDIDATES_V1: LlmModelCandidate[] = [
  {
    providerKey: "deepseek",
    modelId: "deepseek-v4-pro",
    displayName: "DeepSeek V4 Pro",
    qualityTier: "high",
    speedTier: "slow",
    slots: ["llm.smart"],
  },
  {
    providerKey: "deepseek",
    modelId: "deepseek-v4-flash",
    displayName: "DeepSeek V4 Flash",
    qualityTier: "standard",
    speedTier: "fast",
    slots: ["llm.smart", "llm.flash"],
  },
  {
    providerKey: "zhipu",
    modelId: "glm-5",
    displayName: "智谱 GLM-5",
    qualityTier: "standard",
    speedTier: "fast",
    slots: ["llm.smart"],
  },
  {
    providerKey: "zhipu",
    modelId: "glm-4",
    displayName: "智谱 GLM-4",
    qualityTier: "standard",
    speedTier: "fast",
    slots: ["llm.flash"],
  },
  {
    providerKey: "zhipu",
    modelId: "glm-5.3-flash",
    displayName: "智谱 GLM-5.3-Flash",
    qualityTier: "standard",
    speedTier: "fast",
    slots: ["llm.smart", "llm.flash"],
  },
];
