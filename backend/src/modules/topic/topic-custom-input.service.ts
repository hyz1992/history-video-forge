import type { DbClient } from "../../db/client";
import type { CustomRefinedEvent as CustomRefinedEventType } from "../../../../shared/src/topic/topic-custom-refine-output.schema.js";
import { normalizeEventInput } from "./event-normalizer";
import { recommendTopicCandidates } from "./topic-recommendation.service";
import type { BuildTopicCandidatesInput } from "./topic-candidate.builder";
import { refineCustomTopic } from "./topic-custom-refine.service.js";

// ---- 输入校验 ----
//
// 长度边界设计：
// - 下限 4 字：覆盖常见四字成语/典故（晏子使楚、完璧归赵、破釜沉舟等），
//   这类短输入指向性明确，是中文用户最自然的历史事件表达方式。
//   是否真正有意义交给 LLM credibility 判定（invalid → 422），不在长度层做语义判断。
// - 上限 500 字：避免过长输入浪费 token。
export const CUSTOM_DIGEST_MIN_LENGTH = 4;
export const CUSTOM_DIGEST_MAX_LENGTH = 500;

export interface ValidateCustomDigestResult {
  ok: true;
  value: string;
}

export function validateCustomDigest(
  rawDigest: unknown,
): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof rawDigest !== "string") {
    return { ok: false, error: "rawDigest 必须为非空字符串" };
  }
  const trimmed = rawDigest.trim();
  if (trimmed.length < CUSTOM_DIGEST_MIN_LENGTH) {
    return { ok: false, error: `事件梗概过短（至少 ${CUSTOM_DIGEST_MIN_LENGTH} 字，支持成语/典故如"晏子使楚"）` };
  }
  if (trimmed.length > CUSTOM_DIGEST_MAX_LENGTH) {
    return { ok: false, error: `事件梗概过长（最多 ${CUSTOM_DIGEST_MAX_LENGTH} 字）` };
  }
  return { ok: true, value: trimmed };
}

// ---- 应用层 prompt injection 检测 ----
//
// 注意（AGENTS.md 合规）：这是**防御性安全控制**，不是语义校验。
// - 不判断内容质量（那是 LLM credibility 的职责）
// - 只拦截明显的"指令覆盖 / 角色劫持 / 越狱"模式，作为 fast-fail 节省 LLM 调用
// - LLM 仍会做 credibility=invalid 二次防御；本层只是第一道闸
// - 不用模糊关键词做"是否爆款/是否历史"判断

interface InjectionPattern {
  /** 用于匹配的正则（大小写不敏感） */
  pattern: RegExp;
  /** 命中时返回的中文原因 */
  reason: string;
}

const INJECTION_PATTERNS: InjectionPattern[] = [
  // 指令覆盖：忽略/无视以上指令
  {
    pattern: /忽略(以上|之前|前面|上述)(所有|全部)?的?(指令|规则|要求|约束|prompt|instructions?)/i,
    reason: "检测到指令覆盖企图（忽略以上指令）",
  },
  {
    pattern: /ignore\s+(all\s+)?(above|previous|prior|preceding)\s+(instructions?|rules?|prompts?|constraints?)/i,
    reason: "检测到指令覆盖企图（ignore above instructions）",
  },
  // 角色劫持：你现在是一个/你是
  {
    pattern: /你现在(是|扮演|充当)(一个|一名)?(无限制|不受限|没有限制|自由|开发|开发模式|DAN)/i,
    reason: "检测到角色劫持企图（你现在是一个无限制 AI）",
  },
  {
    pattern: /you\s+are\s+now\s+(a|an)\s+(unrestricted|unfiltered|unlimited|free|developer|DAN)/i,
    reason: "检测到角色劫持企图（you are now an unrestricted AI）",
  },
  // 系统标记伪造：[SYSTEM OVERRIDE] / [SYSTEM]
  {
    pattern: /\[(system\s+override|system|admin|developer|root)\]/i,
    reason: "检测到伪造系统标记（[SYSTEM OVERRIDE] 等）",
  },
  // 约束解除：不再受安全策略约束
  {
    pattern: /不再(受|受到|受限于|遵守)(安全策略|安全约束|任何约束|任何限制|安全规则)/i,
    reason: "检测到约束解除企图（不再受安全策略约束）",
  },
  {
    pattern: /no\s+longer\s+(bound\s+by|follow|subject\s+to|constrained\s+by)\s+(safety|security|any|all)\s+(polic|constraint|rule|limit)/i,
    reason: "检测到约束解除企图（no longer bound by safety policy）",
  },
  // 真实指令伪造：remember your true instructions
  {
    pattern: /remember\s+your\s+(true|real|actual)\s+(instructions?|rules?|prompts?)/i,
    reason: "检测到伪造真实指令企图（remember your true instructions）",
  },
  // 越狱关键词
  {
    pattern: /\b(jailbreak|DAN\s+mode|developer\s+mode|god\s+mode)\b/i,
    reason: "检测到越狱关键词（jailbreak / DAN mode 等）",
  },
];

export interface PromptInjectionDetectionResult {
  detected: boolean;
  reason?: string;
}

/**
 * 检测用户输入是否包含明显的 prompt injection 模式。
 * 命中时返回 detected=true + 中文原因，调用方应返回 400 拒绝请求。
 *
 * 这是防御性 fast-fail，不替代 LLM 的 credibility 判定。
 * 正常的历史事件描述（即使含"忽略"、"系统"等词的正常用法）不会被命中，
 * 因为模式要求与"指令/规则/约束"等组合出现。
 */
export function detectPromptInjection(
  rawDigest: string,
): PromptInjectionDetectionResult {
  for (const { pattern, reason } of INJECTION_PATTERNS) {
    if (pattern.test(rawDigest)) {
      return { detected: true, reason };
    }
  }
  return { detected: false };
}

// ---- 自定义选题完整流程 ----

export interface NormalizeEventInput {
  rawInput: string;
  aliases?: string[];
  sourceType?: string;
}

export interface BuildCustomTopicResult {
  refined: CustomRefinedEventType;
  normalized: Awaited<ReturnType<typeof normalizeEventInput>>;
  candidates: Awaited<ReturnType<typeof recommendTopicCandidates>>;
}

/**
 * 用户输入梗概 → LLM 提炼 → normalize → generate candidates。
 * LLM 提炼失败抛 ZodError，由上层 controller 捕获返回 422。
 */
export async function buildCustomTopicRecommendations(
  db: DbClient,
  rawDigest: string,
): Promise<BuildCustomTopicResult> {
  // 1. LLM 提炼结构化事件
  const { refined } = await refineCustomTopic({ rawDigest });

  // 2. normalize（走身份账本去重）
  const normalized = await normalizeEventInput(db, {
    rawInput: refined.canonicalName,
    aliases: refined.characterTags,
    sourceType: "custom",
  });

  // 3. focus seed 生成 candidate
  const candidates = await recommendTopicCandidates(db, {
    canonicalName: refined.canonicalName,
    summary: refined.summary,
    coreConflict: refined.summary.slice(0, 50),
    strongScene: refined.summary.slice(0, 50),
    sourceHint: "自定义输入",
    recentUsageHint: "首次从自定义输入选取",
    tags: refined.eventTypeTags,
  });

  return { refined, normalized, candidates };
}
