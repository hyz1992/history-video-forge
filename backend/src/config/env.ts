import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

type RuntimeProvider = "stub" | "openai";

export interface AppEnv {
  nodeEnv: string;
  databaseUrl: string;
  promptAssetsDir: string;
  llm: {
    provider: RuntimeProvider;
    baseUrl?: string;
    apiKey?: string;
    model: string;
    structuredModel?: string;
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
  return {
    nodeEnv: readEnvValue("NODE_ENV", dotEnvValues) ?? "development",
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
      model:
        readEnvValue("LLM_MODEL", dotEnvValues) ??
        readEnvValue("OPENAI_MODEL", dotEnvValues) ??
        "stub-model",
      structuredModel:
        readEnvValue("LLM_STRUCTURED_MODEL", dotEnvValues) ??
        readEnvValue("LLM_MODEL", dotEnvValues) ??
        readEnvValue("OPENAI_MODEL", dotEnvValues),
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

function loadLocalDotEnv(): Record<string, string> {
  const candidates = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "backend/.env"),
  ];

  for (const filePath of candidates) {
    if (!existsSync(filePath)) {
      continue;
    }

    return parseDotEnv(readFileSync(filePath, "utf8"));
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
