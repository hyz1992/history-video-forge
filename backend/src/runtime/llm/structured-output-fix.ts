import {
  ExternalServiceError,
  classifyExternalError,
} from "./external-errors.js";

export interface StructuredOutputFixRequest<T> {
  operationName: string;
  rawOutput: string;
  parse: (candidate: string) => T;
  deterministicRecovery?: (rawOutput: string) => string | null;
}

export interface StructuredOutputAutoFixInput {
  operationName: string;
  rawOutput: string;
  errorMessage: string;
}

export interface StructuredOutputFixer {
  fix<T>(request: StructuredOutputFixRequest<T>): Promise<T>;
}

export function createStructuredOutputFixer(options?: {
  autoFix?: (input: StructuredOutputAutoFixInput) => Promise<string>;
}): StructuredOutputFixer {
  return {
    async fix<T>(request: StructuredOutputFixRequest<T>): Promise<T> {
      try {
        return request.parse(request.rawOutput);
      } catch (initialError) {
        const recovered = request.deterministicRecovery?.(request.rawOutput) ?? null;
        if (recovered) {
          try {
            return request.parse(recovered);
          } catch (recoveryError) {
            return tryAutoFix(request, options?.autoFix, recoveryError);
          }
        }

        return tryAutoFix(request, options?.autoFix, initialError);
      }
    },
  };
}

function tryAutoFix<T>(
  request: StructuredOutputFixRequest<T>,
  autoFix:
    | ((input: StructuredOutputAutoFixInput) => Promise<string>)
    | undefined,
  error: unknown,
): Promise<T> {
  if (!autoFix) {
    throw classifyInvalidResponse(error, request.operationName);
  }

  return autoFix({
    operationName: request.operationName,
    rawOutput: request.rawOutput,
    errorMessage: error instanceof Error ? error.message : String(error),
  }).then((fixedOutput) => {
    try {
      return request.parse(fixedOutput);
    } catch (fixedError) {
      throw classifyInvalidResponse(fixedError, request.operationName);
    }
  });
}

function classifyInvalidResponse(
  error: unknown,
  operationName: string,
): ExternalServiceError {
  return classifyExternalError(
    error instanceof Error
      ? new Error(`failed to parse structured output: ${error.message}`)
      : error,
    {
      provider: "llm",
      operation: operationName,
    },
  );
}
