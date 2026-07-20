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
    expect(classifyOperation("topic.custom-refine")).toBe("long_structured_generation");
    expect(classifyOperation("asset-planning.planner")).toBe("long_structured_generation");

    // 短结构化判断
    expect(classifyOperation("topic.selector")).toBe("short_structured_decision");
    expect(classifyOperation("probe.strict-tool-call")).toBe("short_structured_decision");
    expect(classifyOperation("publish.title-generator")).toBe("short_structured_decision");
    expect(classifyOperation("publish.description-generator")).toBe("short_structured_decision");
    expect(classifyOperation("publish.cover-prompt-generator")).toBe("short_structured_decision");

    // 局部修复：候选修复、结构修复、封面对话优化、资产提示词优化
    expect(classifyOperation("topic.candidate-builder-repair")).toBe("targeted_repair");
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
    // Task 10 批准 script.writer / storyboard.planner，Task 12 补充批准 topic.candidate-builder；
    // 其余 operation 不得获得 thinking / maxTokens / timeoutMs / maxAttempts override。
    const unapprovedOperations = [
      "storyboard.segment-regen",
      "asset-planning.planner",
      "topic.selector",
      "topic.candidate-builder-repair",
      "asset-planning.asset-structural-repair",
      "script.semantic-reviewer",
      "publish.title-generator",
    ];
    for (const operationName of unapprovedOperations) {
      const policy: OperationPolicy = getOperationPolicy(operationName);
      expect(policy.thinking).toBeUndefined();
      expect(policy.maxTokens).toBeUndefined();
      expect(policy.timeoutMs).toBeUndefined();
      expect(policy.maxAttempts).toBeUndefined();
    }
  });

  it("applies approved thinking overrides only to exact operations", () => {
    // Task 10 与 Task 12 的真实诊断 + 用户确认只批准以下精确 operation 关闭 thinking。
    expect(getOperationPolicy("script.writer").thinking).toBe("disabled");
    expect(getOperationPolicy("storyboard.planner").thinking).toBe("disabled");
    expect(getOperationPolicy("topic.candidate-builder").thinking).toBe("disabled");

    // 同 class 内未经验证的 operation 不得被一起改成 disabled。
    expect(
      getOperationPolicy("storyboard.segment-regen").thinking,
    ).toBeUndefined();
    expect(
      getOperationPolicy("asset-planning.planner").thinking,
    ).toBeUndefined();

    // 未知 operation 继续走保守默认，不获得任何已批准 override。
    expect(getOperationPolicy("some.unknown.operation").thinking).toBeUndefined();
  });

  it("resolves thinking with invocation > policy > profile precedence", () => {
    // policy wins over profile when invocation absent
    const resolvedPolicyWins = resolveEffectiveRequest({
      operationName: "script.writer",
      operationPolicy: { thinking: "disabled" },
      profileDefault: { maxAttempts: 3, timeoutMs: 240000, thinking: "enabled" },
      invocationOptions: {},
    });
    expect(resolvedPolicyWins.thinking).toBe("disabled");

    // profile wins when both policy and invocation absent
    const resolvedProfileWins = resolveEffectiveRequest({
      operationName: "script.writer",
      operationPolicy: {},
      profileDefault: { maxAttempts: 3, timeoutMs: 240000, thinking: "enabled" },
      invocationOptions: {},
    });
    expect(resolvedProfileWins.thinking).toBe("enabled");
  });

  it("resolves maxTokens / temperature / topP with invocation > policy > profile precedence", () => {
    const resolved = resolveEffectiveRequest({
      operationName: "topic.selector",
      operationPolicy: { maxTokens: 1024, temperature: 0.4, topP: 0.7 },
      profileDefault: {
        maxAttempts: 3,
        timeoutMs: 240000,
        maxTokens: 2048,
        temperature: 0.5,
        topP: 0.9,
      },
      invocationOptions: { maxTokens: 4096 },
    });

    expect(resolved.maxTokens).toBe(4096); // invocation
    expect(resolved.temperature).toBe(0.4); // policy
    expect(resolved.topP).toBe(0.7); // policy
  });

  it("merged getOperationPolicy + resolveEffectiveRequest yields disabled thinking for approved operations in plain JSON mode", () => {
    // 生产普通 JSON mode 调用（invokeStructuredPrompt）走的就是这条合并路径。
    // 这里证明 script.writer / storyboard.planner 即使 invocation options 不传 thinking，
    // effective thinking 也会被 operation policy 拉成 disabled，从而进入请求体。
    const scriptResolved = resolveEffectiveRequest({
      operationName: "script.writer",
      operationPolicy: getOperationPolicy("script.writer"),
      profileDefault: { maxAttempts: 3, timeoutMs: 240000 },
      invocationOptions: {},
    });
    expect(scriptResolved.thinking).toBe("disabled");

    const storyboardResolved = resolveEffectiveRequest({
      operationName: "storyboard.planner",
      operationPolicy: getOperationPolicy("storyboard.planner"),
      profileDefault: { maxAttempts: 3, timeoutMs: 240000 },
      invocationOptions: {},
    });
    expect(storyboardResolved.thinking).toBe("disabled");

    // Task 12 补充批准的 builder 也必须通过普通 JSON mode 合并路径进入请求体。
    const candidateBuilderResolved = resolveEffectiveRequest({
      operationName: "topic.candidate-builder",
      operationPolicy: getOperationPolicy("topic.candidate-builder"),
      profileDefault: { maxAttempts: 3, timeoutMs: 240000 },
      invocationOptions: {},
    });
    expect(candidateBuilderResolved.thinking).toBe("disabled");
  });

  it("falls back to profile default for maxTokens/temperature/topP when policy absent", () => {
    const resolved = resolveEffectiveRequest({
      operationName: "topic.selector",
      operationPolicy: {},
      profileDefault: {
        maxAttempts: 3,
        timeoutMs: 240000,
        maxTokens: 2048,
        temperature: 0.5,
        topP: 0.9,
      },
      invocationOptions: {},
    });

    expect(resolved.maxTokens).toBe(2048);
    expect(resolved.temperature).toBe(0.5);
    expect(resolved.topP).toBe(0.9);
  });
});

describe("llm config redacted snapshot", () => {
  it("returns only profile/model/strategy/operationPolicy and selects by profile", () => {
    const snapshot: RedactedLlmConfigSnapshot = redactLlmConfigSnapshot({
      profile: "structured",
      mainModel: "glm-5.1",
      structuredModel: "glm-4",
      mainStrategy: "json_object",
      structuredStrategy: "tool_call",
      operationPolicy: DEFAULT_OPERATION_POLICY,
    });

    // 严格按正式计划：只输出 profile、model、strategy、operation policy
    expect(Object.keys(snapshot).sort()).toEqual(
      ["model", "operationPolicy", "profile", "strategy"].sort(),
    );
    expect(snapshot.profile).toBe("structured");
    expect(snapshot.model).toBe("glm-4");
    expect(snapshot.strategy).toBe("tool_call");
    expect(snapshot.operationPolicy).toEqual(DEFAULT_OPERATION_POLICY);
  });

  it("selects main model and strategy when profile is main", () => {
    const snapshot = redactLlmConfigSnapshot({
      profile: "main",
      mainModel: "glm-5.1",
      structuredModel: "glm-4",
      mainStrategy: "json_object",
      structuredStrategy: "tool_call",
      operationPolicy: DEFAULT_OPERATION_POLICY,
    });

    expect(snapshot.model).toBe("glm-5.1");
    expect(snapshot.strategy).toBe("json_object");
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
