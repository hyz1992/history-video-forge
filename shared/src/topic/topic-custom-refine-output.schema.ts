import { z } from "zod";

/**
 * 事件可信度分级。
 * - high：输入明确指向一个具体历史事件，人物/朝代/冲突均可提炼。
 * - medium：信息略有模糊但能落到一个事件上（如缺朝代）。
 * - low：输入过于宽泛（如"唐朝的历史"），LLM 仍能强行收敛到一个事件但用户应被提示收窄范围。
 * - invalid：输入无意义、随机词、纯注入或根本不是历史事件描述，禁止脑补。
 */
export const CustomRefinedCredibility = z.enum([
  "high",
  "medium",
  "low",
  "invalid",
]);

/** LLM custom-refine 的结构化输出 */
export const CustomRefinedEvent = z
  .object({
    canonicalName: z.string().min(1).max(30),
    summary: z.string().min(20).max(100),
    dynasty: z.string().min(1),
    characterTags: z.array(z.string().min(1).max(5)).min(1),
    eventTypeTags: z.array(z.string().min(1)).min(1),
    /**
     * 事件可信度。LLM 必须显式输出。
     * - high/medium：正常提炼流程。
     * - low：仍输出 canonicalName/summary 等，但 refinedNote 必填，给出收窄建议。
     * - invalid：canonicalName/summary 可填占位值（如 "无有效事件"），refinedNote 必填，说明拒绝原因。
     *   调用方据此返回 422，不进入 candidate 生成。
     */
    credibility: CustomRefinedCredibility,
    /**
     * 当 credibility 为 low/invalid 时必填；high/medium 可省略。
     * 用中文给出 1-2 句说明：为何降级，以及用户应如何调整输入。
     */
    refinedNote: z.string().max(120).optional(),
    era: z.string().optional(),
    conflictTypeTags: z.array(z.string().min(1)).optional(),
    sourceUncertainty: z.string().optional(),
    ambiguityNotes: z.string().optional(),
  })
  .strict();

export type CustomRefinedEvent = z.infer<typeof CustomRefinedEvent>;
export type CustomRefinedCredibility = z.infer<typeof CustomRefinedCredibility>;
