import path from "node:path";

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  databaseUrl: process.env.DATABASE_URL ?? "file:./dev.db",
  promptAssetsDir:
    process.env.PROMPT_ASSETS_DIR ?? path.resolve(process.cwd(), "harness/prompts"),
  llm: {
    provider: process.env.LLM_PROVIDER ?? "stub",
    baseUrl: process.env.LLM_BASE_URL,
    apiKey: process.env.LLM_API_KEY,
    model: process.env.LLM_MODEL ?? "stub-model",
    structuredModel: process.env.LLM_STRUCTURED_MODEL,
    timeoutMs: Number(process.env.LLM_TIMEOUT_MS ?? "45000"),
  },
} as const;
