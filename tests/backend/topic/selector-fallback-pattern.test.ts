import { describe, expect, it } from "vitest";

import { ExternalServiceError } from "../../../backend/src/runtime/llm/external-errors.js";
import { shouldFallbackToStructuredSelector } from "../../../backend/src/modules/topic/topic-recommendation.service.js";

describe("shouldFallbackToStructuredSelector", () => {
  it("对 Node 21+ 的 JSON.parse 措辞 'Unexpected non-whitespace character after JSON' 返回 true", () => {
    const raw = new SyntaxError(
      "Unexpected non-whitespace character after JSON at position 1323 (line 1 column 1324)",
    );
    expect(shouldFallbackToStructuredSelector(raw)).toBe(true);
  });

  it("对 Node ≤20 的 JSON.parse 措辞 'Unexpected token' 返回 true", () => {
    const raw = new SyntaxError("Unexpected token ] in JSON at position 42");
    expect(shouldFallbackToStructuredSelector(raw)).toBe(true);
  });

  it("对 provider 包装后的 ExternalServiceError（debugMessage 含 failed to parse strict tool-call arguments）返回 true", () => {
    const wrapped = new ExternalServiceError({
      provider: "llm",
      operation: "topic.selector",
      retryable: true,
      code: "invalid_response",
      userMessage: "外部服务返回了不符合约束的结果，请稍后重试。",
      debugMessage:
        "failed to parse strict tool-call arguments: Unexpected non-whitespace character after JSON at position 1323",
      cause: new SyntaxError("Unexpected non-whitespace character after JSON"),
    });
    expect(shouldFallbackToStructuredSelector(wrapped)).toBe(true);
  });

  it("对 OpenAI SDK 措辞 'is not valid JSON' / 'invalid tool arguments' 返回 true", () => {
    expect(
      shouldFallbackToStructuredSelector(new Error("... is not valid JSON ...")),
    ).toBe(true);
    expect(
      shouldFallbackToStructuredSelector(new Error("invalid tool arguments")),
    ).toBe(true);
  });

  it("对 schema 校验失败措辞返回 true", () => {
    expect(
      shouldFallbackToStructuredSelector(new Error("topic_selector_strict_schema_failed")),
    ).toBe(true);
    expect(
      shouldFallbackToStructuredSelector(new Error("strict_selector_bad_scorecard: ...")),
    ).toBe(true);
  });

  it("对无关错误返回 false（不应误触发 fallback）", () => {
    expect(shouldFallbackToStructuredSelector(new Error("network timeout"))).toBe(false);
    expect(shouldFallbackToStructuredSelector(new Error("internal server error"))).toBe(false);
    expect(shouldFallbackToStructuredSelector(new Error("rate limit exceeded"))).toBe(false);
  });

  it("对非 Error 值返回 false", () => {
    expect(shouldFallbackToStructuredSelector(null)).toBe(false);
    expect(shouldFallbackToStructuredSelector(undefined)).toBe(false);
    expect(shouldFallbackToStructuredSelector("string error")).toBe(false);
  });
});
