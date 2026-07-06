import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

type RuntimeProvider = "stub" | "openai";
type StrictStructuredStrategy = "json_object" | "tool_call" | "auto";
type StrictStructuredThinking = "enabled" | "disabled";

export interface AppEnv {
  nodeEnv: string;
  demoMode: boolean;
  databaseUrl: string;
  promptAssetsDir: string;
  llm: {
    provider: RuntimeProvider;
    baseUrl?: string;
    apiKey?: string;
    model: string;
    structuredBaseUrl?: string;
    structuredApiKey?: string;
    structuredModel?: string;
    structuredStrategy: StrictStructuredStrategy;
    structuredThinking?: StrictStructuredThinking;
    structuredTemperature?: number;
    structuredTopP?: number;
    structuredMaxTokens?: number;
    timeoutMs: number;
    maxAttempts: number;
    requestBudgetMaxRequests: number;
  };
}

const loadedDotEnv = loadLocalDotEnv();

export const env = buildEnv(loadedDotEnv);

export function getValidatedRuntimeEnv(): AppEnv {
  const nextEnv = buildEnv(loadedDotEnv);

  if (nextEnv.llm.provider !== "stub") {
    const missingKeys: string[] = [];

    if (!nextEnv.llm.baseUrl) {
      missingKeys.push("LLM_BASE_URL or OPENAI_BASE_URL");
    }
    if (!nextEnv.llm.apiKey) {
      missingKeys.push("LLM_API_KEY or OPENAI_API_KEY");
    }
    if (!nextEnv.llm.model) {
      missingKeys.push("LLM_MODEL or OPENAI_MODEL");
    }

    if (missingKeys.length > 0) {
      throw new Error(
        `Missing runtime LLM configuration: ${missingKeys.join(", ")}`,
      );
    }
  }

  return nextEnv;
}

function buildEnv(dotEnvValues: Record<string, string>): AppEnv {
  const model =
    readEnvValue("LLM_MODEL", dotEnvValues) ??
    readEnvValue("OPENAI_MODEL", dotEnvValues) ??
    "stub-model";
  const structuredModel =
    readEnvValue("LLM_STRUCTURED_MODEL", dotEnvValues) ??
    model;
  const structuredDefaults =
    readStrictStructuredModelDefaults(structuredModel);

  const demoModeRaw = readEnvValue("DEMO_MODE", dotEnvValues);
  const demoMode = demoModeRaw === "true" || demoModeRaw === "1";

  return {
    nodeEnv: readEnvValue("NODE_ENV", dotEnvValues) ?? "development",
    demoMode,
    databaseUrl: readEnvValue("DATABASE_URL", dotEnvValues) ?? "file:./dev.db",
    promptAssetsDir:
      readEnvValue("PROMPT_ASSETS_DIR", dotEnvValues) ??
      path.resolve(process.cwd(), "harness/prompts"),
    llm: {
      provider: (readEnvValue("LLM_PROVIDER", dotEnvValues) ??
        "stub") as RuntimeProvider,
      baseUrl:
        readEnvValue("LLM_BASE_URL", dotEnvValues) ??
        readEnvValue("OPENAI_BASE_URL", dotEnvValues),
      apiKey:
        readEnvValue("LLM_API_KEY", dotEnvValues) ??
        readEnvValue("OPENAI_API_KEY", dotEnvValues),
      model,
      structuredBaseUrl:
        readEnvValue("LLM_STRUCTURED_BASE_URL", dotEnvValues) ??
        readEnvValue("OPENAI_STRUCTURED_BASE_URL", dotEnvValues),
      structuredApiKey:
        readEnvValue("LLM_STRUCTURED_API_KEY", dotEnvValues) ??
        readEnvValue("OPENAI_STRUCTURED_API_KEY", dotEnvValues),
      structuredModel,
      structuredStrategy: readStrictStructuredStrategy(
        readEnvValue("LLM_STRUCTURED_STRATEGY", dotEnvValues),
        structuredDefaults.strategy,
      ),
      structuredThinking:
        readStrictStructuredThinking(
          readEnvValue("LLM_STRUCTURED_THINKING", dotEnvValues),
        ) ?? structuredDefaults.thinking,
      structuredTemperature:
        readOptionalNumber(
          readEnvValue("LLM_STRUCTURED_TEMPERATURE", dotEnvValues),
        ) ?? structuredDefaults.temperature,
      structuredTopP:
        readOptionalNumber(readEnvValue("LLM_STRUCTURED_TOP_P", dotEnvValues)) ??
        structuredDefaults.topP,
      structuredMaxTokens:
        readOptionalNumber(
          readEnvValue("LLM_STRUCTURED_MAX_TOKENS", dotEnvValues),
        ) ?? structuredDefaults.maxTokens,
      timeoutMs: Number(readEnvValue("LLM_TIMEOUT_MS", dotEnvValues) ?? "45000"),
      maxAttempts: Number(readEnvValue("LLM_MAX_ATTEMPTS", dotEnvValues) ?? "3"),
      requestBudgetMaxRequests: Number(
        readEnvValue("LLM_REQUEST_BUDGET_MAX_REQUESTS", dotEnvValues) ?? "20",
      ),
    },
  };
}

function readEnvValue(
  key: string,
  dotEnvValues: Record<string, string>,
): string | undefined {
  return process.env[key] ?? dotEnvValues[key];
}

function readStrictStructuredStrategy(
  value: string | undefined,
  defaultValue: StrictStructuredStrategy = "json_object",
): StrictStructuredStrategy {
  if (value === "tool_call" || value === "auto") {
    return value;
  }

  if (value === "json_object") {
    return value;
  }

  return defaultValue;
}

function readStrictStructuredThinking(
  value: string | undefined,
): StrictStructuredThinking | undefined {
  if (value === "enabled" || value === "disabled") {
    return value;
  }

  return undefined;
}

function readOptionalNumber(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : undefined;
}

function readStrictStructuredModelDefaults(model: string | undefined): {
  strategy: StrictStructuredStrategy;
  thinking?: StrictStructuredThinking;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
} {
  // GLM-5.1 live probes showed stable tool-call output for topic.selector.
  // Keep these as model-aware defaults so operators only choose the model,
  // while explicit LLM_STRUCTURED_* values can still override experiments.
  if (model === "glm-5.1") {
    return {
      strategy: "tool_call",
      thinking: "disabled",
      temperature: 0.5,
      topP: 0.9,
      maxTokens: 2048,
    };
  }

  return {
    strategy: "json_object",
  };
}

function loadLocalDotEnv(): Record<string, string> {
  if (process.env.NODE_ENV === "test" || process.env.VITEST) {
    return {};
  }

  const candidates = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "backend/.env"),
  ];

  for (const filePath of candidates) {
    if (!existsSync(filePath)) {
      continue;
    }

    const parsed = parseDotEnv(readFileSync(filePath, "utf8"));

    // Write parsed values into process.env so code that reads
    // process.env directly (e.g. DashScope provider) sees them.
    for (const [key, value] of Object.entries(parsed)) {
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }

    return parsed;
  }

  return {};
}

function parseDotEnv(source: string): Record<string, string> {
  const result: Record<string, string> = {};

  for (const rawLine of source.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u);
    if (!match) {
      continue;
    }

    const [, key, rawValue] = match;
    result[key] = stripQuotes(rawValue.trim());
  }

  return result;
}

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}
