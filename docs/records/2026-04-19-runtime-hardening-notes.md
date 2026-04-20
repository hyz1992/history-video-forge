# Runtime Hardening Notes

## 当前口径

- timeout
  - 仍由 openai-compatible provider 的 `withTimeout(...)` 执行。
  - 超时统一归类为 `ExternalServiceError(code="timeout")`。

- retry
  - 仍由 `withRetry(...)` 执行。
  - 最终抛出的 `ExternalServiceError` 会携带 `attemptCount` 与 `failureMetadata.attempt_count`。

- limit / budget
  - 当前最小硬化先落在“请求次数预算”层。
  - `request-budget.ts` 负责在 provider 发起外部请求前执行消费。
  - 超限统一归类为 `ExternalServiceError(code="budget_exceeded")`。

- failure metadata
  - `ExternalServiceError` 统一携带：
    - `failureMetadata.failure_reason`
    - `failureMetadata.provider`
    - `failureMetadata.operation`
    - `failureMetadata.retryable`
    - `failureMetadata.attempt_count`
  - gateway 会保留并透传这组元数据，供 graph runner 消费。

- 当前边界
  - 本阶段未引入 token 预算或全局并发限流。
  - 本阶段未改 prompt registry / provider adapter / frontend 职责边界。
