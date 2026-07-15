export type ExternalProvider = "llm";

export interface ExternalErrorContext {
  provider: ExternalProvider;
  operation: string;
}

export interface RetryAttemptObservation {
  attempt: number;
  errorCode: string;
  errorMessage: string;
  retryable: boolean;
  delayMs?: number;
}

export interface RetryOptions extends ExternalErrorContext {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  shouldRetry?: (error: ExternalServiceError, attempt: number) => boolean;
  onAttempt?: (observation: RetryAttemptObservation) => void;
}

export interface FailureMetadata {
  failure_reason: string;
  provider: ExternalProvider;
  operation: string;
  retryable: boolean;
  attempt_count: number;
}

export class ExternalServiceError extends Error {
  readonly provider: ExternalProvider;
  readonly operation: string;
  readonly retryable: boolean;
  readonly code: string;
  readonly userMessage: string;
  readonly debugMessage: string;
  readonly attemptCount: number;
  readonly failureMetadata: FailureMetadata;
  readonly cause?: unknown;

  constructor(options: {
    provider: ExternalProvider;
    operation: string;
    retryable: boolean;
    code: string;
    userMessage: string;
    debugMessage: string;
    attemptCount?: number;
    cause?: unknown;
  }) {
    super(options.debugMessage);
    this.name = "ExternalServiceError";
    this.provider = options.provider;
    this.operation = options.operation;
    this.retryable = options.retryable;
    this.code = options.code;
    this.userMessage = options.userMessage;
    this.debugMessage = options.debugMessage;
    this.attemptCount = options.attemptCount ?? 1;
    this.failureMetadata = {
      failure_reason: options.code,
      provider: options.provider,
      operation: options.operation,
      retryable: options.retryable,
      attempt_count: this.attemptCount,
    };
    this.cause = options.cause;
  }
}

export function classifyExternalError(
  error: unknown,
  context: ExternalErrorContext,
): ExternalServiceError {
  if (error instanceof ExternalServiceError) {
    return error;
  }

  const rawMessage = error instanceof Error ? error.message : String(error);
  const message = rawMessage.toLowerCase();
  const status = extractStatus(rawMessage);

  let retryable = false;
  let code = "unknown";

  if (
    error instanceof Error &&
    (error.name === "AbortError" ||
      message.includes("timeout") ||
      message.includes("timed out"))
  ) {
    retryable = true;
    code = "timeout";
  } else if (status === 429 || message.includes("throttl")) {
    retryable = true;
    code = "rate_limited";
  } else if ([408, 500, 502, 503, 504].includes(status ?? -1)) {
    retryable = true;
    code = "service_unavailable";
  } else if (
    message.includes("network") ||
    message.includes("econnreset") ||
    message.includes("econnrefused") ||
    message.includes("enotfound") ||
    message.includes("fetch failed")
  ) {
    retryable = true;
    code = "network";
  } else if (
    message.includes("failed to parse") ||
    message.includes("output_parsing_failure")
  ) {
    code = "invalid_response";
  } else if ([400, 409, 422].includes(status ?? -1)) {
    code = "invalid_request";
  } else if (
    [401, 403].includes(status ?? -1) ||
    message.includes("api key") ||
    message.includes("unauthorized")
  ) {
    code = "configuration";
  }

  return new ExternalServiceError({
    provider: context.provider,
    operation: context.operation,
    retryable,
    code,
    userMessage: buildUserMessage(code),
    debugMessage: rawMessage,
    cause: error,
  });
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 1000;
  const maxDelayMs = options.maxDelayMs ?? 10_000;

  let lastError: ExternalServiceError | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const classified = withAttemptCount(
        classifyExternalError(error, options),
        attempt,
      );
      lastError = classified;

      const shouldRetry =
        classified.retryable &&
        attempt < maxAttempts &&
        (options.shouldRetry ? options.shouldRetry(classified, attempt) : true);

      if (!shouldRetry) {
        if (options.onAttempt) {
          safeOnAttempt(options.onAttempt, {
            attempt,
            errorCode: classified.code,
            errorMessage: classified.debugMessage,
            retryable: false,
          });
        }
        throw classified;
      }

      const delayMs = Math.min(
        maxDelayMs,
        baseDelayMs * 2 ** Math.max(0, attempt - 1),
      );

      if (options.onAttempt) {
        safeOnAttempt(options.onAttempt, {
          attempt,
          errorCode: classified.code,
          errorMessage: classified.debugMessage,
          retryable: true,
          delayMs,
        });
      }

      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  throw lastError ?? classifyExternalError(new Error("Unknown external error"), options);
}

function safeOnAttempt(
  fn: (observation: RetryAttemptObservation) => void,
  observation: RetryAttemptObservation,
): void {
  try {
    fn(observation);
  } catch {
    // 回调失败不得打断 retry 主流程
  }
}

export function withAttemptCount(
  error: ExternalServiceError,
  attemptCount: number,
): ExternalServiceError {
  return new ExternalServiceError({
    provider: error.provider,
    operation: error.operation,
    retryable: error.retryable,
    code: error.code,
    userMessage: error.userMessage,
    debugMessage: error.debugMessage,
    attemptCount,
    cause: error.cause,
  });
}

function extractStatus(message: string): number | null {
  const match = message.match(/\b(400|401|403|408|409|422|429|500|502|503|504)\b/u);
  return match ? Number(match[1]) : null;
}

function buildUserMessage(code: string): string {
  switch (code) {
    case "configuration":
      return "外部服务配置异常，请检查 API Key、模型名或 Base URL。";
    case "rate_limited":
      // 是否重试由 attempt log 决定，文案不得预设重试已发生。
      return "外部服务限流。若仍失败可稍后重试。";
    case "timeout":
      // 不得声称已自动重试；实际是否重试以 attempt log 为准。
      return "外部服务请求超时。可稍后重试。";
    case "network":
      return "外部服务网络异常。若仍失败可稍后重试。";
    case "invalid_request":
      return "外部服务拒绝了当前请求，请检查输入参数或提示词。";
    case "invalid_response":
      return "外部服务返回了不符合约束的结果，请稍后重试。";
    case "budget_exceeded":
      return "运行时请求预算已耗尽，请稍后重试或收紧范围。";
    default:
      return "外部服务调用失败，请稍后重试。";
  }
}
