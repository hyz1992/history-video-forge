import { describe, expect, it } from "vitest";

import {
  isTextEquivalent,
  isTextEquivalentWithDrift,
  locateSubstringFuzzy,
  normalizeTextForMatching,
} from "../../../backend/src/runtime/llm/text-match.js";

describe("normalizeTextForMatching", () => {
  it("replaces half-width punctuation with full-width equivalents", () => {
    expect(normalizeTextForMatching("abc,def:ghi")).toBe("abc，def：ghi");
    expect(normalizeTextForMatching("a.b;c?d!e")).toBe("a。b；c？d！e");
  });

  it("drops ASCII / NBSP / ideographic spaces", () => {
    expect(normalizeTextForMatching("a b")).toBe("ab");
    expect(normalizeTextForMatching("a\u00A0b")).toBe("ab");
    expect(normalizeTextForMatching("a\u3000b")).toBe("ab");
  });

  it("drops Chinese and English quote boundary characters", () => {
    expect(normalizeTextForMatching("“橘生淮南”")).toBe("橘生淮南");
    expect(normalizeTextForMatching('"abc"')).toBe("abc");
    expect(normalizeTextForMatching("「內容」")).toBe("內容");
    expect(normalizeTextForMatching("『內容』")).toBe("內容");
  });

  it("trims both ends after normalization", () => {
    expect(normalizeTextForMatching("  abc  ")).toBe("abc");
    expect(normalizeTextForMatching("\u3000abc\u3000")).toBe("abc");
  });

  it("leaves unrelated CJK characters untouched", () => {
    expect(normalizeTextForMatching("楚王压场，晏子顶回。")).toBe(
      "楚王压场，晏子顶回。",
    );
  });
});

describe("locateSubstringFuzzy", () => {
  it("returns drifted=false on strict match", () => {
    const haystack = "楚王第一次压场时，晏子没有退。";
    const result = locateSubstringFuzzy(haystack, "楚王第一次压场时");
    expect(result).toEqual({
      index: 0,
      end: "楚王第一次压场时".length,
      drifted: false,
    });
  });

  it("matches when only diff is half/full-width comma and end matches needle length", () => {
    // 真实事故场景：script 用 ASCII 半角逗号，excerpt 用中文全角逗号。
    // 半角↔全角是"替换型"映射（位置不变），end 严格等于 needle.length。
    const haystack = "她跪在舂房前,双手被木杵磨破。";
    const needle = "她跪在舂房前，双手被木杵磨破。";
    const result = locateSubstringFuzzy(haystack, needle);
    expect(result.index).toBe(0);
    expect(result.end).toBe(needle.length);
    expect(result.drifted).toBe(true);
  });

  it("matches when only diff is quote boundary punctuation and end reflects haystack length", () => {
    // haystack 含两个中文引号（删除型字符），needle 没引号。
    // haystack 比 needle 长 2，归一化后两者等价；end 必须包含两个引号位置。
    const haystack = "他说“橘生淮南则为橘”转身就走";
    const needle = "他说橘生淮南则为橘转身就走";
    const result = locateSubstringFuzzy(haystack, needle);
    expect(result.index).toBe(0);
    expect(result.end).toBe(haystack.length);
    expect(result.drifted).toBe(true);
  });

  it("matches when needle has surrounding whitespace (trim drift)", () => {
    const haystack = "楚王压场。";
    const result = locateSubstringFuzzy(haystack, "  楚王压场。  ");
    expect(result.index).toBe(0);
    expect(result.end).toBe(haystack.length);
    expect(result.drifted).toBe(true);
  });

  it("returns index=-1 when there is no match even after normalization", () => {
    const result = locateSubstringFuzzy("abcdef", "xyz");
    expect(result).toEqual({ index: -1, end: -1, drifted: false });
  });

  it("returns index=-1 for empty needle", () => {
    const result = locateSubstringFuzzy("abcdef", "");
    expect(result).toEqual({ index: -1, end: -1, drifted: false });
  });

  it("maps drift position back to real haystack index when leading space exists", () => {
    // haystack 头部有 ASCII 空格 + 内部全角逗号；needle 没空格也没全角逗号。
    // 严格 indexOf 失败（半角空格差异），归一化后命中，真实位置应是 1
    // （第 0 个字符是空格被删除，归一化后的第 0 个字符对应原索引 1）。
    // 内部全角逗号是替换型字符（→半角），位置不变；end 等于 needle.length + 1
    // （多出的 1 是头部被删除的空格）。
    const haystack = " 楚王,压场";
    const needle = "楚王，压场";
    const result = locateSubstringFuzzy(haystack, needle);
    expect(result.index).toBe(1);
    expect(result.end).toBe(1 + needle.length);
    expect(result.drifted).toBe(true);
  });

  it("end does NOT include deleted chars that come after needle match", () => {
    // haystack 中 needle 之后还有删除型字符（引号 + 空格），但这些字符属于
    // 后续内容的前缀，不属于 needle 等价区间。end 必须精确到 needle 等价内容
    // 的最后字符 +1，不能多吃后续删除字符（否则 coverage 会偏大）。
    //
    // 为触发归一化路径，needle 必须不是 haystack 的直接子串。这里 needle 把
    // 全角逗号改成半角（替换型，位置不变），forcing 走 drift 分支。
    const haystack = "前缀“橘生淮南，”后缀";
    const needle = "橘生淮南,";
    const result = locateSubstringFuzzy(haystack, needle);
    expect(result.index).toBe("前缀".length + 1); // 跳过开引号
    // needle 等价内容在原 haystack 上是 "橘生淮南，"，对应索引 4..8（含），end=9
    expect(result.end).toBe("前缀".length + 1 + "橘生淮南，".length);
    expect(result.drifted).toBe(true);
  });
});

describe("isTextEquivalent", () => {
  it("returns true for strict equality", () => {
    expect(isTextEquivalent("abc", "abc")).toBe(true);
  });

  it("returns true for punctuation-style drift", () => {
    expect(isTextEquivalent("楚王,压场", "楚王，压场")).toBe(true);
    expect(isTextEquivalent("“橘淮之辩”", "橘淮之辩")).toBe(true);
  });

  it("returns false for genuinely different text", () => {
    expect(isTextEquivalent("楚王压场", "晏子反击")).toBe(false);
  });
});

describe("isTextEquivalentWithDrift", () => {
  it("returns drifted=false on strict equality", () => {
    expect(isTextEquivalentWithDrift("abc", "abc")).toEqual({
      equivalent: true,
      drifted: false,
    });
  });

  it("returns drifted=true on punctuation-style drift", () => {
    expect(isTextEquivalentWithDrift("楚王,压场", "楚王，压场")).toEqual({
      equivalent: true,
      drifted: true,
    });
  });

  it("returns equivalent=false for genuinely different text", () => {
    expect(isTextEquivalentWithDrift("abc", "xyz")).toEqual({
      equivalent: false,
      drifted: false,
    });
  });
});
