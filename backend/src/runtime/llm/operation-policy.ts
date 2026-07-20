/**
 * 单供应商 LLM operation policy。
 *
 * 设计约束（见 S2-0 implementation plan Task 8/9/10 与 AGENTS.md 高风险边界）：
 *
 * - operation name 必须显式映射到 operation class，禁止用字符串包含关系猜测语义。
 * - 未知 operation 走保守默认并记录 warning。
 * - 优先级固定为：invocation options > operation policy > profile/env defaults > provider default。
 * - policy 不包含 provider routing，也不硬编码模型名/供应商名。
 * - 只写入经真实 candidate 诊断（S2-0b live）+ 用户确认的精确 operation 参数；
 *   未获批准的 operation 不得获得 thinking / max tokens / timeout / maxAttempts override。
 * - thinking override 按 operation name 精确写入，禁止按 operation class 统一写入，
 *   因为同一 class 内仍包含未经验证的 operation（例如 long_structured_generation 还包含
 *   storyboard.segment-regen 和 asset-planning.planner）。
 */

export type LlmOperationClass =
  | "core_semantic_generation"
  | "long_structured_generation"
  | "short_structured_decision"
  | "shadow_review"
  | "targeted_repair";

/**
 * 显式 operation name → operation class 映射（白名单，禁止子串匹配）。
 * 新增 operation 必须在此显式登记，否则落入 unknown。
 */
const OPERATION_NAME_TO_CLASS: Record<string, LlmOperationClass> = {
  // 核心语义生成：口播文案首稿
  "script.writer": "core_semantic_generation",

  // 长结构化生成：分镜规划、分镜段重生、候选构建、资产规划（输出体量大）
  "storyboard.planner": "long_structured_generation",
  "storyboard.segment-regen": "long_structured_generation",
  "topic.candidate-builder": "long_structured_generation",
  "topic.custom-refine": "long_structured_generation",
  "asset-planning.planner": "long_structured_generation",

  // 短结构化判断：选题打分选择、发布标题/简介/封面提示词
  "topic.selector": "short_structured_decision",
  "probe.strict-tool-call": "short_structured_decision",
  "publish.title-generator": "short_structured_decision",
  "publish.description-generator": "short_structured_decision",
  "publish.cover-prompt-generator": "short_structured_decision",

  // 局部修复：候选修复、结构修复、封面对话优化、资产提示词优化
  "topic.candidate-builder-repair": "targeted_repair",
  "asset-planning.asset-structural-repair": "targeted_repair",
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
 * timeout 是否允许重试，按 operation class 区分。
 *
 * Task 9 仅授权对 core_semantic_generation 与 long_structured_generation
 * 禁止超时原样重试；其余 class 保持既有"允许 timeout 重试"的行为，
 * 避免在没有基线或明确批准时扩大禁止范围。
 */
const RETRY_ON_TIMEOUT_BY_CLASS: Record<LlmOperationClass, boolean> = {
  core_semantic_generation: false,
  long_structured_generation: false,
  short_structured_decision: true,
  shadow_review: true,
  targeted_repair: true,
};

/**
 * 单个 operation 的策略。当前除 Task 10 批准的精确 thinking override 外，
 * 其余生成参数字段保持 undefined，表示"没有受控实验支持的值"，
 * 因此不会覆盖 profile/env defaults。
 */
export interface OperationPolicy {
  retryOnTimeout?: boolean;
  /** 瞬时错误（429 / 503 / 网络错误）在该 class 下的最大额外重试次数。 */
  transientRetryByClass?: Partial<Record<LlmOperationClass, number>>;
  thinking?: "enabled" | "disabled";
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  timeoutMs?: number;
  maxAttempts?: number;
}

/**
 * Task 10 / Task 12：经真实 GLM-5.2 诊断 + 用户确认后批准的精确 thinking override。
 *
 * 证据来源：harness/scripts/runtime/output/llm-s2-baseline/2026-07-15T195910/baseline-report.json
 * Task 10 单样本证明 script.writer（普通 JSON mode）与 storyboard.planner（普通 JSON mode）
 * 在 thinking=disabled 下 attempt 1 成功、reasoning tokens 为 0、Zod 与业务 validator 首次通过，
 * 且人工审读未发现明显语义退化。
 *
 * Task 12 证据来源：真实页面项目 84ed173e-529b-4a19-bc6d-092257432b3e。
 * topic.candidate-builder 在 GLM-5.2 provider-default thinking 下 attempt 1 耗时 159.954 秒，
 * completion / reasoning tokens 为 8189 / 4741，占完整选题等待的 82.5%。用户已确认先做
 * 单变量优化：只关闭该精确 operation thinking，保持 8 候选、prompt/schema/validator/
 * repair/selector/timeout/retry 不变。关闭后的真实耗时与语义质量仍由 Task 13 独立 live 验收。
 *
 * 边界（禁止扩展）：
 * - 该结论只支持本次精确 operation 策略，不允许扩展为同 class 其他 operation 的默认值；
 *   long_structured_generation 仍包含未经验证的 storyboard.segment-regen 和
 *   asset-planning.planner。
 * - 未列入本表的 operation（含 core_semantic_generation 之外的 repair/reviewer/publish 等）
 *   继续走保守默认，不获得 thinking override。
 * - 不写入 max tokens / temperature / timeout / maxAttempts；这些字段没有足够样本支撑新默认值。
 */
const APPROVED_THINKING_OVERRIDE: Partial<
  Record<string, OperationPolicy["thinking"]>
> = {
  "script.writer": "disabled",
  "storyboard.planner": "disabled",
  "topic.candidate-builder": "disabled",
};


/**
 * 默认 operation policy。
 *
 * - 不硬编码模型名或供应商名。
 * - 不写入未经批准的 thinking / max tokens / timeout / maxAttempts。
 * - timeout 重试按 class 区分（仅 core/long 禁止）。
 * - 瞬时错误在每个 class 下允许有限重试（上限 1~2 次）。
 */
export const DEFAULT_OPERATION_POLICY: Required<
  Pick<OperationPolicy, "transientRetryByClass">
> &
  OperationPolicy = {
  // retryOnTimeout 不在此处给单一值；按 class 解析（见 RETRY_ON_TIMEOUT_BY_CLASS）。
  retryOnTimeout: undefined,
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
  const approvedThinking = APPROVED_THINKING_OVERRIDE[operationName];

  if (cls === "unknown") {
    // 保守默认：禁止超时重试，瞬时错误最多重试 1 次。
    // 未知 operation 不得获得任何已批准 override。
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

  return {
    retryOnTimeout: RETRY_ON_TIMEOUT_BY_CLASS[cls],
    transientRetryByClass: DEFAULT_OPERATION_POLICY.transientRetryByClass,
    // 仅写入经真实 candidate 诊断 + 用户确认的精确 operation thinking override。
    // 未列入 APPROVED_THINKING_OVERRIDE 的 operation 此处为 undefined，
    // 不覆盖 profile/env defaults，保留 Task 9 的 retry 语义不变。
    thinking: approvedThinking,
  };
}

export interface ResolveEffectiveRequestInput {
  operationName: string;
  operationPolicy: OperationPolicy;
  profileDefault: {
    maxAttempts: number;
    timeoutMs: number;
    thinking?: "enabled" | "disabled";
    maxTokens?: number;
    temperature?: number;
    topP?: number;
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
  thinking: "enabled" | "disabled" | "provider_default";
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
  const profile = input.profileDefault;

  const thinking =
    options.thinking ??
    input.operationPolicy.thinking ??
    profile.thinking ??
    "provider_default";

  const maxAttempts =
    options.maxAttempts ??
    input.operationPolicy.maxAttempts ??
    profile.maxAttempts;

  const timeoutMs =
    options.timeoutMs ??
    input.operationPolicy.timeoutMs ??
    profile.timeoutMs;

  return {
    thinking,
    maxAttempts,
    timeoutMs,
    maxTokens: options.maxTokens ?? input.operationPolicy.maxTokens ?? profile.maxTokens,
    temperature: options.temperature ?? input.operationPolicy.temperature ?? profile.temperature,
    topP: options.topP ?? input.operationPolicy.topP ?? profile.topP,
  };
}

/**
 * 脱敏后的 LLM 配置快照字段契约（严格对齐 S2-0 plan Task 8）：
 * 只输出 profile、model、strategy、operation policy。
 * 严禁输出 API key、完整 base URL 或其它未经计划确认的扩展字段。
 */
export interface RedactedLlmConfigSnapshot {
  profile: "main" | "structured";
  model: string;
  strategy: string;
  operationPolicy: OperationPolicy;
}

export interface RedactableLlmConfig {
  profile: "main" | "structured";
  mainModel: string;
  structuredModel: string;
  mainStrategy: string;
  structuredStrategy: string;
  operationPolicy: OperationPolicy;
}

export function redactLlmConfigSnapshot(
  config: RedactableLlmConfig,
): RedactedLlmConfigSnapshot {
  return {
    profile: config.profile,
    model:
      config.profile === "structured" ? config.structuredModel : config.mainModel,
    strategy:
      config.profile === "structured"
        ? config.structuredStrategy
        : config.mainStrategy,
    operationPolicy: config.operationPolicy,
  };
}
