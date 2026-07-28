/**
 * LLM 输出文本对齐归一化工具（设计：docs/plans/2026-07-28-llm-output-text-normalization-design.md）。
 *
 * 用途：LLM 在两次独立调用之间（如 topic package → script → storyboard），
 * 经常出现标点风格漂移（全/半角逗号、引号边界、空格），导致 validator 用
 * String.prototype.indexOf / === / Set.has 严格比较时假阴性，触发 regen 但
 * LLM 仍输出一致风格 → 链路卡死。
 *
 * 本模块提供"标点风格归一化"软匹配：
 *   - 替换型：半角逗号 ↔ 全角逗号、句号、冒号、分号、问号、感叹号。
 *   - 删除型：ASCII 空格、不间断空格、全角空格、中英文引号边界符。
 *   - 两侧 trim。
 *
 * 严格相等/严格 indexOf 优先；只有严格匹配失败时才走归一化兜底，并标记
 * drifted=true，让调用方能记 `*_drift:{id}` warning，便于运营观察漂移率。
 *
 * 设计边界（见 design §4.2）：
 *   - 不做模糊匹配（编辑距离、子串包含）——避免误命中无关文本。
 *   - 不做语义改写、同义词替换、字符顺序重排。
 *   - 调用方决定是否把 drift 降级为 warning，本模块不替调用方决策。
 */

const NORMALIZE_PUNCT_MAP: Record<string, string> = {
  ",": "，",
  ".": "。",
  ":": "：",
  ";": "；",
  "?": "？",
  "!": "！",
  "“": "",
  "”": "",
  '"': "",
  "‘": "",
  "’": "",
  "'": "",
  "「": "",
  "」": "",
  "『": "",
  "』": "",
  " ": "",
  "\u00A0": "",
  "\u3000": "",
};

function isDroppedByNormalize(ch: string): boolean {
  return (NORMALIZE_PUNCT_MAP[ch] ?? ch) === "";
}

// 注意：haystack 侧不能 trim。位置映射（locateSubstringFuzzy）依赖 haystack
// 的真实字符索引，trim 会改变索引。needle 侧 trim 是为了容忍 LLM 在 excerpt
// 两侧多打/少打空格。两侧归一化都只做标点替换 + 删除，不动其他字符。
function normalizeHaystackForMatching(value: string): string {
  let out = "";
  for (const ch of value) {
    out += NORMALIZE_PUNCT_MAP[ch] ?? ch;
  }
  return out;
}

export function normalizeTextForMatching(value: string): string {
  return normalizeHaystackForMatching(value).trim();
}

export interface LocateResult {
  /** needle 在 haystack 中的真实起始字符索引；-1 表示即使归一化后也无法匹配。 */
  index: number;
  /** true 表示严格匹配失败、靠归一化兜底命中。调用方可据此记 drift warning。 */
  drifted: boolean;
}

/**
 * 在 haystack 中定位 needle。
 *
 * 行为：
 *   1. 先做严格 indexOf。命中则返回 { index, drifted: false }。
 *   2. 严格失败时，两侧都做 normalizeTextForMatching，在归一化后的 haystack 里
 *      查找归一化后的 needle。命中则把归一化坐标映射回原 haystack 的真实字符
 *      索引，并返回 drifted: true。
 *   3. 归一化后仍无法命中，返回 { index: -1, drifted: false }。
 *
 * 映射规则：归一化把"删除型字符"（引号、空格）移除，但保留"替换型字符"
 * （半角→全角标点）的字符位置。所以归一化后的索引对应原 haystack 中第 N 个
 * "未被删除"的字符。
 */
export function locateSubstringFuzzy(haystack: string, needle: string): LocateResult {
  // 空字符串 fast path：JS 的 "".indexOf("") 返回 0，但我们对空 needle
  // 一律视为无法定位，避免误命中。
  if (needle.length === 0) {
    return { index: -1, drifted: false };
  }

  const direct = haystack.indexOf(needle);
  if (direct !== -1) {
    return { index: direct, drifted: false };
  }

  const normalizedHaystack = normalizeHaystackForMatching(haystack);
  const normalizedNeedle = normalizeTextForMatching(needle);
  if (normalizedNeedle.length === 0) {
    return { index: -1, drifted: false };
  }

  const normalizedStart = normalizedHaystack.indexOf(normalizedNeedle);
  if (normalizedStart === -1) {
    return { index: -1, drifted: false };
  }

  // 把归一化后的位置映射回原 haystack 的真实位置。
  // 关键点：删除型字符（引号、空格）在归一化后不占位，所以归一化坐标 N
  // 对应原 haystack 中"第 N 个未被删除的字符"。我们要跳过前 N 个未删除字符之前
  // 的所有删除型字符，定位到那第 N 个未删除字符的真实索引。
  let normalizedIndex = 0;
  for (let i = 0; i < haystack.length; i++) {
    if (isDroppedByNormalize(haystack[i])) {
      continue;
    }
    if (normalizedIndex === normalizedStart) {
      return { index: i, drifted: true };
    }
    normalizedIndex += 1;
  }
  return { index: -1, drifted: false };
}

/**
 * 判断两个字符串在标点风格归一化后是否等价。
 *
 * 严格相等优先（fast path）；严格失败时归一化再相等比较。
 * 不返回 drifted 标志，因为 beat/quote 名字比较场景下，调用方只需知道是否等价。
 */
export function isTextEquivalent(a: string, b: string): boolean {
  if (a === b) return true;
  return normalizeTextForMatching(a) === normalizeTextForMatching(b);
}

/**
 * 判断 a 是否能归一化等价于 b 中的某个 token，并返回 drifted 标志。
 *
 * 用于 beat/quote Set 比较场景：把候选集合归一化为 key → raw value 的 map，
 * 通过 normalizedKey 查找；若 raw value 与查询值不严格相等，说明发生了漂移。
 */
export function isTextEquivalentWithDrift(
  a: string,
  b: string,
): { equivalent: boolean; drifted: boolean } {
  if (a === b) {
    return { equivalent: true, drifted: false };
  }
  const equivalent = normalizeTextForMatching(a) === normalizeTextForMatching(b);
  return { equivalent, drifted: equivalent };
}
