import type { DbClient } from "../../db/client";
import type { CustomRefinedEvent as CustomRefinedEventType } from "../../../../shared/src/topic/topic-custom-refine-output.schema.js";
import { normalizeEventInput } from "./event-normalizer";
import { recommendTopicCandidates } from "./topic-recommendation.service";
import type { BuildTopicCandidatesInput } from "./topic-candidate.builder";
import { refineCustomTopic } from "./topic-custom-refine.service.js";

// ---- 输入校验 ----

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
  if (trimmed.length < 10) {
    return { ok: false, error: "事件梗概过短（至少 10 字）" };
  }
  if (trimmed.length > 500) {
    return { ok: false, error: "事件梗概过长（最多 500 字）" };
  }
  return { ok: true, value: trimmed };
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
