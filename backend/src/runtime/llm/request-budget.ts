import { ExternalServiceError } from "./external-errors.js";

export interface RequestBudget {
  consume(operation: string): void;
}

export interface RequestBudgetOptions {
  maxRequests: number;
}

class FixedRequestBudget implements RequestBudget {
  private usedRequests = 0;

  constructor(private readonly maxRequests: number) {}

  consume(operation: string): void {
    this.usedRequests += 1;
    if (this.usedRequests <= this.maxRequests) {
      return;
    }

    throw new ExternalServiceError({
      provider: "llm",
      operation,
      retryable: false,
      code: "budget_exceeded",
      userMessage: "运行时请求预算已耗尽，请稍后重试或收紧回归范围。",
      debugMessage: `Request budget exceeded after ${this.maxRequests} requests.`,
    });
  }
}

export function createRequestBudget(options: RequestBudgetOptions): RequestBudget {
  return new FixedRequestBudget(options.maxRequests);
}
