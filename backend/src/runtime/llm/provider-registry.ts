/**
 * Provider 注册表（S2-1 Task 2）。
 *
 * 设计约束（见 docs/plans/archive/2026-07-17-s2-1-multi-provider-model-routing-design.md §4.1.2）：
 *
 * - providers.json 只管 provider 注册（name + baseUrl + apiKeyEnv 引用），不存密钥、不存 tier 映射。
 * - tier → provider:model 映射走 env（Task 3 实现），与本注册表正交。
 * - apiKeyEnv 引用 env 变量名，不直接存明文密钥（符合 V2 ProviderCredential 原则）。
 * - 缺失 providers.json 时回退到单 provider 模式（provider 名为 DEFAULT_PROVIDER_NAME）。
 * - 格式错误（缺字段、name 重复、apiKeyEnv 为空、JSON 不合法）必须立即抛错，不静默回退。
 * - 不支持 hot reload：启动时读取一次，缓存使用。
 */

import { existsSync, readFileSync } from "node:fs";

/** 单 provider 兼容模式下使用的 provider 名。 */
export const DEFAULT_PROVIDER_NAME = "default";

/** providers.json 中单个 provider 条目的运行时表示。 */
export interface ProviderRegistryEntry {
  /** provider 名，必须与 LLM_SMART_MODEL / LLM_FLASH_MODEL 中冒号前的 provider 名一致。 */
  name: string;
  /** provider 的 OpenAI 兼容 /chat/completions endpoint。 */
  baseUrl: string;
  /**
   * 引用存放 api key 的 env 变量名。
   * 单 provider 兼容模式下为 null（此时 api key 直接由 envFallback.apiKey 提供）。
   */
  apiKeyEnv: string | null;
}

/** providers.json 文件结构。 */
interface ProvidersConfigFile {
  providers: ReadonlyArray<{
    name: unknown;
    baseUrl: unknown;
    apiKeyEnv: unknown;
  }>;
}

/** loadProviderRegistry 的输入参数。 */
export interface ProviderRegistryInput {
  /** providers.json 的绝对路径。文件不存在时走 envFallback。 */
  configPath: string;
  /**
   * 当 providers.json 不存在时使用的回退配置。
   * 缺失时返回空 registry（调用方需自行处理"无可注册 provider"场景）。
   */
  envFallback?: {
    baseUrl?: string;
    apiKey?: string;
  };
}

class ProviderRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderRegistryError";
  }
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNonEmptyString(value: unknown): value is string {
  return isString(value) && value.trim().length > 0;
}

function validateEntry(raw: {
  name: unknown;
  baseUrl: unknown;
  apiKeyEnv: unknown;
}): ProviderRegistryEntry {
  if (!isNonEmptyString(raw.name)) {
    throw new ProviderRegistryError(
      "provider 注册失败：每个 provider 必须有非空字符串字段 name。",
    );
  }
  if (!isString(raw.baseUrl)) {
    throw new ProviderRegistryError(
      `provider 注册失败：provider "${raw.name}" 缺少字符串字段 baseUrl。`,
    );
  }
  if (!isNonEmptyString(raw.apiKeyEnv)) {
    throw new ProviderRegistryError(
      `provider 注册失败：provider "${raw.name}" 缺少非空字符串字段 apiKeyEnv。`,
    );
  }
  return {
    name: raw.name,
    baseUrl: raw.baseUrl,
    apiKeyEnv: raw.apiKeyEnv,
  };
}

/**
 * 加载 provider 注册表。
 *
 * 行为：
 * - configPath 文件存在 → 严格解析 + 校验，任何错误立即抛出（不静默回退）。
 * - configPath 文件不存在 + envFallback 提供baseUrl/apiKey → 返回单 provider 模式。
 * - configPath 文件不存在 + envFallback 缺失 → 返回空 registry（调用方自行处理）。
 *
 * 返回值：provider name → entry 的 Map。
 */
export function loadProviderRegistry(
  input: ProviderRegistryInput,
): Map<string, ProviderRegistryEntry> {
  if (!existsSync(input.configPath)) {
    return buildFallbackRegistry(input.envFallback);
  }

  let rawText: string;
  try {
    rawText = readFileSync(input.configPath, "utf8");
  } catch (error) {
    throw new ProviderRegistryError(
      `provider 注册失败：无法读取 ${input.configPath}（${error instanceof Error ? error.message : String(error)}）。`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch (error) {
    throw new ProviderRegistryError(
      `provider 注册失败：${input.configPath} 不是合法 JSON（${error instanceof Error ? error.message : String(error)}）。`,
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ProviderRegistryError(
      "provider 注册失败：providers.json 根必须是对象，且含 providers 数组字段。",
    );
  }

  const config = parsed as Partial<ProvidersConfigFile>;
  if (!Array.isArray(config.providers)) {
    throw new ProviderRegistryError(
      "provider 注册失败：providers.json 缺少 providers 数组字段。",
    );
  }
  if (config.providers.length === 0) {
    throw new ProviderRegistryError(
      "provider 注册失败：providers 数组至少需要包含一个 provider。",
    );
  }

  const registry = new Map<string, ProviderRegistryEntry>();
  for (const rawEntry of config.providers) {
    if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) {
      throw new ProviderRegistryError(
        "provider 注册失败：providers 数组中每一项必须是对象。",
      );
    }
    const entry = validateEntry({
      name: rawEntry.name,
      baseUrl: rawEntry.baseUrl,
      apiKeyEnv: rawEntry.apiKeyEnv,
    });
    if (registry.has(entry.name)) {
      throw new ProviderRegistryError(
        `provider 注册失败：发现 duplicate provider name "${entry.name}"。`,
      );
    }
    registry.set(entry.name, entry);
  }

  return registry;
}

function buildFallbackRegistry(
  envFallback: ProviderRegistryInput["envFallback"],
): Map<string, ProviderRegistryEntry> {
  if (!envFallback) {
    return new Map();
  }
  // envFallback 场景：单 provider 兼容模式，api key 直接来自 envFallback.apiKey
  // （对应 .env 中的 LLM_API_KEY），所以 apiKeyEnv 为 null。
  const entry: ProviderRegistryEntry = {
    name: DEFAULT_PROVIDER_NAME,
    baseUrl: envFallback.baseUrl ?? "",
    apiKeyEnv: null,
  };
  const registry = new Map<string, ProviderRegistryEntry>();
  registry.set(entry.name, entry);
  return registry;
}
