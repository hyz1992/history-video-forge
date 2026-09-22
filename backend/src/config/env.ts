import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  DEFAULT_OPERATION_POLICY,
  redactLlmConfigSnapshot,
  type RedactedLlmConfigSnapshot,
} from "../runtime/llm/operation-policy.js";

type RuntimeProvider = "stub" | "openai";
type StrictStructuredStrategy = "json_object" | "tool_call" | "auto";
type StrictStructuredThinking = "enabled" | "disabled";
export type AssetPlanningGenerationMode = "legacy" | "intent_compiler";

export interface AppEnv {
  nodeEnv: string;
  allowUnauthenticatedRemote: boolean;
  databaseUrl: string;
  promptAssetsDir: string;
  assetPlanningGenerationMode: AssetPlanningGenerationMode;
  /**
   * 角色 sheet 一致性（2026-09-18 设计 §3.6，实施计划 §1 T1）：开关与出场阈值的
   * 唯一 env 读取点。编译器只消费调用方机械传入的值（AssetPlanCompilerInput.characterSheet），
   * 从而"开关关/开"的单测不必操纵环境变量。
   * 2026-09-22：enabled 默认 true（用户决策，前提是默认 image 模型为 wan2.7-image；
   * 决策记录 docs/records/2026-09-22-default-image-model-switch.md）。
   */
  assetPlanningCharacterSheet: {
    enabled: boolean;
    minSegmentHits: number;
  };
  /**
   * S2-2A 任务 7：生成成本治理相关 env 状态。
   * mediaCredentialConfigured 是"unconfigured 环境"判定的单一 env 来源：
   * 媒体凭据未配置时，付费媒体目录项不得报价/真实派发（readiness 交叉校验）。
   */
  generation: {
    /** 服务端 DashScope 媒体凭据是否已配置（非空）。不暴露凭据值本身。 */
    mediaCredentialConfigured: boolean;
  };
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
    // S2-1 Task 5：tier 路由相关变量（design §4.1.1 / §4.4）。
    // env 层只做原值读取；跨字段回退（smart 缺失→LLM_MODEL；flash 缺失→smart tier）
    // 由 gateway 层组装（Task 4），不在 env 层处理。
    /** LLM_SMART_MODEL，格式 `<provider>:<model>`。未设置时为 undefined。 */
    smartModel?: string;
    /** LLM_FLASH_MODEL，格式 `<provider>:<model>`。未设置时为 undefined。 */
    flashModel?: string;
    /** LLM_PROVIDERS_CONFIG_PATH，providers.json 的绝对路径。未设置时为 undefined。 */
    providersConfigPath?: string;
  };
}

const loadedDotEnv = loadLocalDotEnv();

export const env = buildEnv(loadedDotEnv);

export function getValidatedRuntimeEnv(): AppEnv {
  const nextEnv = buildEnv(loadedDotEnv);

  if (nextEnv.llm.provider !== "stub") {
    // S2-1 新配置路径：LLM_SMART_MODEL 已配置时，smart tier 通过 factory 解析，
    // 不再强制要求旧 LLM_BASE_URL/LLM_API_KEY/LLM_MODEL。
    // 具体解析校验（providers.json 存在、apiKeyEnv 引用的密钥已配置）由
    // createTierAwareProviderFromEnv 在调用时执行，不在这里重复。
    if (!nextEnv.llm.smartModel) {
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
          `Missing runtime LLM configuration: ${missingKeys.join(", ")}. ` +
            `Either provide legacy LLM_* variables or configure S2-1 LLM_SMART_MODEL + providers.json.`,
        );
      }
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

  const allowUnauthenticatedRemote = readEnvValue("ALLOW_UNAUTHENTICATED_REMOTE", dotEnvValues) === "true";

  return {
    nodeEnv: readEnvValue("NODE_ENV", dotEnvValues) ?? "development",
    allowUnauthenticatedRemote,
    databaseUrl: readEnvValue("DATABASE_URL", dotEnvValues) ?? "file:./dev.db",
    promptAssetsDir:
      readEnvValue("PROMPT_ASSETS_DIR", dotEnvValues) ??
      path.resolve(process.cwd(), "prompts"),
    assetPlanningGenerationMode: readAssetPlanningGenerationMode(
      readEnvValue("ASSET_PLANNING_GENERATION_MODE", dotEnvValues),
    ),
    assetPlanningCharacterSheet: {
      enabled: readBooleanEnv(
        readNonEmptyEnvValue("ASSET_CHARACTER_SHEET_ENABLED", dotEnvValues),
        "ASSET_CHARACTER_SHEET_ENABLED",
        // 2026-09-22 用户决策：默认模型已切换为 wan2.7-image（支持 0 图 + 参考图调用），
        // sheet 开关的生效前提满足，且 live check 效果/成本达标（§1 T6 门禁）——
        // 默认值翻转为开。回滚面：显式设 false，或 ASSET_PLANNING_GENERATION_MODE=legacy
        //（legacy 路径不产 sheet 任务）。
        true,
      ),
      minSegmentHits: readPositiveIntegerEnv(
        readNonEmptyEnvValue(
          "ASSET_CHARACTER_SHEET_MIN_SEGMENT_HITS",
          dotEnvValues,
        ),
        "ASSET_CHARACTER_SHEET_MIN_SEGMENT_HITS",
        3,
      ),
    },
    generation: {
      mediaCredentialConfigured:
        readNonEmptyEnvValue("ALIYUN_DASHSCOPE_API_KEY", dotEnvValues) !== undefined,
    },
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
      // S2-1 Task 5：tier 路由变量原值读取（空字符串视为未设置）。
      // 跨字段回退组装在 gateway 层（Task 4），不在 env 层。
      smartModel: readNonEmptyEnvValue("LLM_SMART_MODEL", dotEnvValues),
      flashModel: readNonEmptyEnvValue("LLM_FLASH_MODEL", dotEnvValues),
      providersConfigPath: readNonEmptyEnvValue(
        "LLM_PROVIDERS_CONFIG_PATH",
        dotEnvValues,
      ),
    },
  };
}

function readAssetPlanningGenerationMode(
  value: string | undefined,
): AssetPlanningGenerationMode {
  if (value === undefined || value === "intent_compiler") {
    return "intent_compiler";
  }
  if (value === "legacy") return "legacy";
  throw new Error(
    "ASSET_PLANNING_GENERATION_MODE must be legacy or intent_compiler",
  );
}

/**
 * 读取 env 变量并把空字符串视为未设置。
 *
 * 用于 S2-1 tier 路由变量：.env 文件可能写入 `LLM_SMART_MODEL=`（空值），
 * 此时不应把空字符串传给 tier-resolver（会在解析时报"env 值为空"错），
 * 而是视为未设置，让 gateway 层走旧 env 回退路径。
 */
function readNonEmptyEnvValue(
  key: string,
  dotEnvValues: Record<string, string>,
): string | undefined {
  const value = readEnvValue(key, dotEnvValues);
  if (value === undefined || value.length === 0) {
    return undefined;
  }
  return value;
}

/**
 * 布尔开关解析：只接受 `true`/`false`，未设置用默认值，其他值启动即失败。
 * 与 `ASSET_PLANNING_GENERATION_MODE` 同口径（未知值启动失败），
 * 避免拼错的开关被静默当成"关闭"或"打开"。
 */
function readBooleanEnv(
  value: string | undefined,
  key: string,
  defaultValue: boolean,
): boolean {
  if (value === undefined) return defaultValue;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${key} must be true or false`);
}

/** 正整数解析：未设置用默认值，非正整数启动即失败（静默回退会改变计费行为）。 */
function readPositiveIntegerEnv(
  value: string | undefined,
  key: string,
  defaultValue: number,
): number {
  if (value === undefined) return defaultValue;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${key} must be a positive integer`);
  }
  return parsed;
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

/**
 * 返回脱敏后的 LLM 配置快照，用于日志与诊断。
 * 严格按 S2-0 plan Task 8：只输出 profile、model、strategy、operation policy。
 * 按 profile 选择对应 model 与 strategy，不输出 API key 或完整 base URL。
 *
 * @param profile 当前调用使用的 profile（main/structured），决定快照中 model/strategy 的口径。
 */
export function getRedactedLlmConfigSnapshot(
  profile: "main" | "structured" = "main",
): RedactedLlmConfigSnapshot {
  return redactLlmConfigSnapshot({
    profile,
    mainModel: env.llm.model,
    structuredModel: env.llm.structuredModel ?? env.llm.model,
    // main profile（普通路径）固定使用 json_object；structured strategy 来自 env。
    mainStrategy: "json_object",
    structuredStrategy: env.llm.structuredStrategy,
    operationPolicy: DEFAULT_OPERATION_POLICY,
  });
}
