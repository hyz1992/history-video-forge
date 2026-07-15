import { describe, expect, it, vi } from "vitest";

import {
  classifyOperation,
  DEFAULT_OPERATION_POLICY,
  getOperationPolicy,
  redactLlmConfigSnapshot,
  resolveEffectiveRequest,
  type LlmOperationClass,
  type OperationPolicy,
  type RedactedLlmConfigSnapshot,
} from "../../../backend/src/runtime/llm/operation-policy.js";

describe("llm operation policy classification", () => {
  it("maps every production operation name to an explicit operation class without substring guessing", () => {
    // 核心语义生成
    expect(classifyOperation("script.writer")).toBe("core_semantic_generation");

    // 长结构化生成（输出体量大）
    expect(classifyOperation("storyboard.planner")).toBe("long_structured_generation");
    expect(classifyOperation("storyboard.segment-regen")).toBe("long_structured_generation");
    expect(classifyOperation("topic.candidate-builder")).toBe("long_structured_generation");
    expect(classifyOperation("asset-planning.planner")).toBe("long_structured_generation");

    // 短结构化判断
    expect(classifyOperation("topic.selector")).toBe("short_structured_decision");
    expect(classifyOperation("publish.title-generator")).toBe("short_structured_decision");
    expect(classifyOperation("publish.description-generator")).toBe("short_structured_decision");
    expect(classifyOperation("publish.cover-prompt-generator")).toBe("short_structured_decision");

    // 局部修复
    expect(classifyOperation("topic.candidate-builder-repair")).toBe("targeted_repair");
    expect(classifyOperation("topic.candidate-builder.diagnostics")).toBe("targeted_repair");
    expect(classifyOperation("asset-planning.asset-structural-repair")).toBe("targeted_repair");
    expect(classifyOperation("publish.cover-prompt-optimizer")).toBe("targeted_repair");
    expect(classifyOperation("asset.prompt-optimizer")).toBe("targeted_repair");

    // shadow only
    expect(classifyOperation("script.semantic-reviewer")).toBe("shadow_review");
  });

  it("does not infer semantics from substring containment", () => {
    expect(classifyOperation("storyboard")).toBe("unknown");
    expect(classifyOperation("weird.selector")).toBe("unknown");
    expect(classifyOperation("script.debug")).toBe("unknown");
    expect(classifyOperation("asset-planning.unknown")).toBe("unknown");
    expect(classifyOperation("candidate-builder")).toBe("unknown");
  });

  it("falls back to conservative default with a warning for unknown operations", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cls = classifyOperation("some.unknown.operation");
    expect(cls).toBe("unknown");
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe("llm operation policy precedence", () => {
  it("invocation options win over operation policy and profile/env defaults", () => {
    const policy = getOperationPolicy("script.writer");
    const resolved = resolveEffectiveRequest({
      operationName: "script.writer",
      operationPolicy: policy,
      profileDefault: { maxAttempts: 3, timeoutMs: 240000 },
      invocationOptions: { maxAttempts: 2, timeoutMs: 60000, thinking: "disabled" },
    });

    expect(resolved.maxAttempts).toBe(2);
    expect(resolved.timeoutMs).toBe(60000);
    expect(resolved.thinking).toBe("disabled");
  });

  it("operation policy wins over profile/env defaults when invocation options are absent", () => {
    const resolved = resolveEffectiveRequest({
      operationName: "script.writer",
      operationPolicy: { ...DEFAULT_OPERATION_POLICY, maxAttempts: 1 },
      profileDefault: { maxAttempts: 3, timeoutMs: 240000 },
      invocationOptions: {},
    });

    expect(resolved.maxAttempts).toBe(1);
    expect(resolved.timeoutMs).toBe(240000);
  });

  it("keeps provider default thinking status when neither options nor policy set thinking", () => {
    const resolved = resolveEffectiveRequest({
      operationName: "script.writer",
      operationPolicy: {},
      profileDefault: { maxAttempts: 3, timeoutMs: 240000 },
      invocationOptions: {},
    });

    expect(resolved.thinking).toBe("provider_default");
  });

  it("does not hardcode model names or provider routing in the default policy", () => {
    const serialized = JSON.stringify(DEFAULT_OPERATION_POLICY);
    expect(serialized).not.toMatch(/glm-5\.[0-9]/i);
    expect(serialized).not.toMatch(/glm-6/i);
    expect(serialized).not.toMatch(/zhipu|deepseek|openai/i);
  });

  it("does not introduce unapproved thinking / max-tokens / timeout defaults for operations", () => {
    const policy: OperationPolicy = getOperationPolicy("script.writer");
    expect(policy.thinking).toBeUndefined();
    expect(policy.maxTokens).toBeUndefined();
    expect(policy.timeoutMs).toBeUndefined();
    expect(policy.maxAttempts).toBeUndefined();
  });
});

describe("llm config redacted snapshot", () => {
  it("exposes profile, model and strategy but never api keys or full base url", () => {
    const snapshot: RedactedLlmConfigSnapshot = redactLlmConfigSnapshot({
      profile: "main",
      baseUrl: "https://open.bigmodel.cn/api/paas/v4",
      apiKey: "super-secret-key-12345",
      model: "glm-5.1",
      structuredBaseUrl: "https://open.bigmodel.cn/api/paas/v4",
      structuredApiKey: "another-secret",
      structuredModel: "glm-4",
      structuredStrategy: "tool_call",
      structuredThinking: "disabled",
      timeoutMs: 240000,
      maxAttempts: 3,
      operationPolicy: DEFAULT_OPERATION_POLICY,
    });

    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain("super-secret-key-12345");
    expect(serialized).not.toContain("another-secret");
    expect(snapshot.profile).toBe("main");
    expect(snapshot.hasApiKey).toBe(true);
    expect(snapshot.hasStructuredApiKey).toBe(true);
    expect(snapshot.baseUrlHost).toBe("open.bigmodel.cn");
    expect(snapshot.structuredBaseUrlHost).toBe("open.bigmodel.cn");
    expect(snapshot.model).toBe("glm-5.1");
    expect(snapshot.structuredModel).toBe("glm-4");
    expect(snapshot.strategy).toBe("tool_call");
    expect(snapshot.operationPolicy).toEqual(DEFAULT_OPERATION_POLICY);
  });

  it("marks base url host as unavailable when base url is missing", () => {
    const snapshot = redactLlmConfigSnapshot({
      profile: "structured",
      baseUrl: undefined,
      apiKey: undefined,
      model: "stub-model",
      structuredBaseUrl: undefined,
      structuredApiKey: undefined,
      structuredModel: "stub-model",
      structuredStrategy: "json_object",
      timeoutMs: 45000,
      maxAttempts: 3,
      operationPolicy: DEFAULT_OPERATION_POLICY,
    });

    expect(snapshot.profile).toBe("structured");
    expect(snapshot.hasApiKey).toBe(false);
    expect(snapshot.hasStructuredApiKey).toBe(false);
    expect(snapshot.baseUrlHost).toBe("unavailable");
    expect(snapshot.structuredBaseUrlHost).toBe("unavailable");
  });
});

describe("llm operation policy retry semantics (Task 9 contract)", () => {
  it("forbids retrying timeouts only for core semantic and long structured generation", () => {
    // 已批准禁止 timeout 重试的两类
    expect(getOperationPolicy("script.writer").retryOnTimeout).toBe(false);
    expect(getOperationPolicy("storyboard.planner").retryOnTimeout).toBe(false);
    expect(getOperationPolicy("topic.candidate-builder").retryOnTimeout).toBe(false);
    expect(getOperationPolicy("asset-planning.planner").retryOnTimeout).toBe(false);

    // 其余 operation 保持既有行为：允许 timeout 重试（不扩大禁止范围）
    expect(getOperationPolicy("topic.selector").retryOnTimeout).toBe(true);
    expect(getOperationPolicy("publish.title-generator").retryOnTimeout).toBe(true);
    expect(getOperationPolicy("topic.candidate-builder-repair").retryOnTimeout).toBe(true);
    expect(getOperationPolicy("asset-planning.asset-structural-repair").retryOnTimeout).toBe(true);
    expect(getOperationPolicy("script.semantic-reviewer").retryOnTimeout).toBe(true);
  });

  it("still allows limited retry for transient errors across operation classes", () => {
    const classes: LlmOperationClass[] = [
      "core_semantic_generation",
      "long_structured_generation",
      "short_structured_decision",
      "shadow_review",
      "targeted_repair",
    ];
    for (const cls of classes) {
      expect(DEFAULT_OPERATION_POLICY.transientRetryByClass[cls]).toBeGreaterThanOrEqual(1);
      expect(DEFAULT_OPERATION_POLICY.transientRetryByClass[cls]).toBeLessThanOrEqual(3);
    }
  });
});
