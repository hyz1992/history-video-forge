/**
 * 单供应商 LLM operation policy。
 *
 * 设计约束（见 S2-0 implementation plan Task 8/9 与 AGENTS.md 高风险边界）：
 *
 * - operation name 必须显式映射到 operation class，禁止用字符串包含关系猜测语义。
 * - 未知 operation 走保守默认并记录 warning。
 * - 优先级固定为：invocation options > operation policy > profile/env defaults > provider default。
 * - policy 不包含 provider routing，也不硬编码模型名/供应商名。
 * - 没有受控实验支持的 thinking / max tokens / timeout 不得擅自写入默认值。
 */

export type LlmOperationClass =
  | "core_semantic_generation"
  | "long_structured_generation"
  | "short_structured_decision"
  | "shadow_review"
  | "targeted_repair";

export type LlmThinkingStatus =
  | "enabled"
  | "disabled"
  | "provider_default";

/**
 * 显式 operation name → operation class 映射。
 * 这是白名单，不是子串匹配；新增 operation 必须在此显式登记。
 */
const OPERATION_NAME_TO_CLASS: Record<string, LlmOperationClass> = {
  // 核心语义生成：口播文案首稿
  "script.writer": "core_semantic_generation",

  // 长结构化生成：分镜规划、分镜段重生、候选构建（输出体量大）
  "storyboard.planner": "long_structured_generation",
  "storyboard.segment-regen": "long_structured_generation",
  "topic.candidate-builder": "long_structured_generation",

  // 短结构化判断：选题打分选择、发布标题/简介
  "topic.selector": "short_structured_decision",
  "publish.title-generator": "short_structured_decision",
  "publish.description-generator": "short_structured_decision",
  "publish.cover-prompt-generator": "short_structured_decision",

  // 局部修复：候选修复、封面对话优化、资产提示词优化
  "topic.candidate-builder-repair": "targeted_repair",
  "publish.cover-prompt-optimizer": "targeted_repair",
  "asset.prompt-optimizer": "targeted_repair",

  // shadow only：语义审校，仅作量尺
  "script.semantic-reviewer": "shadow_review",
};

const UNKNOWN_OPERATION_CLASS = "unknown" as const;

export type ClassifiedOperation = LlmOperationClass | "unknown";

const warnedOperations = new Set<string>();

export function classifyOperation(operationName: string): ClassifiedOperation {
  const mapped = OPERATION_NAME_TO_CLASS[operationName];
  if (mapped) {
    return mapped;
  }

  // 显式白名单未命中即为未知，必须记录 warning 且不得用子串推断。
  if (!warnedOperations.has(operationName)) {
    warnedOperations.add(operationName);
    // eslint-disable-next-line no-console
    console.warn(
      `[operation-policy] 未知 operation "${operationName}"，使用保守默认策略（禁止超时重试、瞬时错误重试上限 1）。请在 operation-policy 白名单中显式登记该 operation。`,
    );
  }

  return UNKNOWN_OPERATION_CLASS;
}

/**
 * 单个 operation 的策略。当前所有生成参数字段保持 undefined，
 * 表示"没有受控实验支持的值"，因此不会覆盖 profile/env defaults。
 * Task 8 明确禁止擅自写入 thinking / max tokens / timeout 默认值。
 */
export interface OperationPolicy {
  retryOnTimeout?: boolean;
  /** 瞬时错误（429 / 503 / 网络错误）在该 class 下的最大重试次数上限。 */
  transientRetryByClass?: Partial<Record<LlmOperationClass, number>>;
  thinking?: "enabled" | "disabled";
  maxTokens?: number;
  timeoutMs?: number;
  maxAttempts?: number;
}

/**
 * 默认 operation policy。
 *
 * - 不硬编码模型名或供应商名。
 * - 不写入未经批准的 thinking / max tokens / timeout。
 * - core_semantic_generation 与 long_structured_generation 默认禁止超时重试（Task 9 契约）。
 * - 瞬时错误在每个 class 下允许有限重试（上限 1~2 次）。
 */
export const DEFAULT_OPERATION_POLICY: Required<
  Pick<OperationPolicy, "retryOnTimeout" | "transientRetryByClass">
> &
  OperationPolicy = {
  retryOnTimeout: false,
  transientRetryByClass: {
    core_semantic_generation: 1,
    long_structured_generation: 1,
    short_structured_decision: 2,
    shadow_review: 1,
    targeted_repair: 2,
  },
  // thinking / maxTokens / timeoutMs / maxAttempts 故意保持 undefined：
  // 它们必须由受控实验（S2-0b 后续 live）+ 用户确认后才能写入。
};

export function getOperationPolicy(operationName: string): OperationPolicy {
  const cls = classifyOperation(operationName);

  if (cls === "unknown") {
    // 保守默认：禁止超时重试，瞬时错误最多重试 1 次。
    return {
      retryOnTimeout: false,
      transientRetryByClass: {
        core_semantic_generation: 1,
        long_structured_generation: 1,
        short_structured_decision: 1,
        shadow_review: 1,
        targeted_repair: 1,
      },
    };
  }

  const policy: OperationPolicy = {
    retryOnTimeout:
      cls === "core_semantic_generation" || cls === "long_structured_generation"
        ? false
        : DEFAULT_OPERATION_POLICY.retryOnTimeout,
    transientRetryByClass: DEFAULT_OPERATION_POLICY.transientRetryByClass,
  };

  return policy;
}

export interface ResolveEffectiveRequestInput {
  operationName: string;
  operationPolicy: OperationPolicy;
  profileDefault: {
    maxAttempts: number;
    timeoutMs: number;
  };
  invocationOptions?: {
    thinking?: "enabled" | "disabled";
    maxTokens?: number;
    temperature?: number;
    topP?: number;
    timeoutMs?: number;
    maxAttempts?: number;
  };
}

export interface ResolvedEffectiveRequest {
  thinking: LlmThinkingStatus;
  maxAttempts: number;
  timeoutMs: number;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
}

/**
 * 严格按优先级合并：
 * invocation options > operation policy > profile/env defaults > provider default
 *
 * operation policy 当前不贡献 thinking / maxTokens / timeoutMs / maxAttempts
 * （除非后续受控实验批准），但仍参与合并以保留扩展点。
 */
export function resolveEffectiveRequest(
  input: ResolveEffectiveRequestInput,
): ResolvedEffectiveRequest {
  const options = input.invocationOptions ?? {};

  const thinking: LlmThinkingStatus =
    options.thinking ??
    input.operationPolicy.thinking ??
    "provider_default";

  const maxAttempts =
    options.maxAttempts ??
    input.operationPolicy.maxAttempts ??
    input.profileDefault.maxAttempts;

  const timeoutMs =
    options.timeoutMs ??
    input.operationPolicy.timeoutMs ??
    input.profileDefault.timeoutMs;

  return {
    thinking,
    maxAttempts,
    timeoutMs,
    maxTokens: options.maxTokens ?? input.operationPolicy.maxTokens,
    temperature: options.temperature,
    topP: options.topP,
  };
}

export interface RedactedLlmConfigSnapshot {
  provider: string;
  hasApiKey: boolean;
  hasStructuredApiKey: boolean;
  /** 仅保留 host，不输出完整 base URL 或路径。 */
  baseUrlHost: string;
  structuredBaseUrlHost: string;
  mainModel: string;
  structuredModel: string;
  structuredStrategy: string;
  structuredThinking?: string;
  timeoutMs: number;
  maxAttempts: number;
  operationPolicy: OperationPolicy;
}

export interface RedactableLlmConfig {
  provider: string;
  baseUrl?: string;
  apiKey?: string;
  model: string;
  structuredBaseUrl?: string;
  structuredApiKey?: string;
  structuredModel: string;
  structuredStrategy: string;
  structuredThinking?: string;
  timeoutMs: number;
  maxAttempts: number;
  operationPolicy: OperationPolicy;
}

function extractHost(url: string | undefined): string {
  if (!url) return "unavailable";
  try {
    return new URL(url).host || "unavailable";
  } catch {
    return "unavailable";
  }
}

export function redactLlmConfigSnapshot(
  config: RedactableLlmConfig,
): RedactedLlmConfigSnapshot {
  return {
    provider: config.provider,
    hasApiKey: Boolean(config.apiKey),
    hasStructuredApiKey: Boolean(config.structuredApiKey),
    baseUrlHost: extractHost(config.baseUrl),
    structuredBaseUrlHost: extractHost(config.structuredBaseUrl),
    mainModel: config.model,
    structuredModel: config.structuredModel,
    structuredStrategy: config.structuredStrategy,
    structuredThinking: config.structuredThinking,
    timeoutMs: config.timeoutMs,
    maxAttempts: config.maxAttempts,
    operationPolicy: config.operationPolicy,
  };
}
