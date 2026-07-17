/**
 * 启动时 tier 路由配置诊断（S2-1 Task 7）。
 *
 * 设计约束（见 docs/plans/2026-07-17-s2-1-multi-provider-model-routing-design.md §8 R4 / §10.9）：
 *
 * - backend 启动时打印实际生效的 tier→provider:model 与 provider 注册情况（脱敏）。
 * - 兼容期半切换状态明确：标识 "兼容模式"（provider=default 或 flashReusesSmart=true）。
 * - api key 不出现在任何输出（design §8 R3 凭据不泄漏）。
 * - stub 模式 short-circuit：只打印 stub 提示，不解析 snapshot（避免无真实配置时崩溃）。
 * - 失败安全：诊断失败不阻塞 server 启动，降级为 console.warn。
 *
 * 职责拆分：
 * - redactApiKey / formatTierConfigDiagnostics：纯函数，便于单测。
 * - logTierConfigDiagnostics：side-effect，由 server.ts 启动序列调用一次。
 * - collectTierDiagnosticsInput：组合 snapshot + registry 加载，吞掉所有异常返回兜底。
 */

import path from "node:path";

import { env } from "../../config/env.js";
import { loadProviderRegistry } from "./provider-registry.js";
import { resolveTierProviderSnapshot } from "./tier-aware-provider-factory.js";
import type { ProviderRegistryEntry } from "./provider-registry.js";
import type { ResolvedModel } from "./tier-resolver.js";

/** 诊断输入。stub 模式只需 provider 字段；非 stub 模式需要 snapshot + registryEntries。 */
export interface TierDiagnosticsInput {
  /** env.llm.provider，"stub" 或 "openai"。 */
  provider: string;
  /** resolveTierProviderSnapshot 的结果，stub 模式可省略。 */
  snapshot?: {
    smart: ResolvedModel;
    flashReusesSmart: boolean;
    flash?: ResolvedModel;
  };
  /** loadProviderRegistry 的 entries，stub 模式可省略。 */
  registryEntries?: ReadonlyArray<ProviderRegistryEntry>;
}

const TAG = "[tier-config]";

/** 把 api key 脱敏为安全可打印的形式。 */
export function redactApiKey(key: string | undefined): string {
  if (key === undefined || key === null) return "<unset>";
  if (key.length === 0) return "<unset>";
  if (key.length <= 8) return `<set:${key.length}>`;
  // 显示前 4 + *** + 后 2，保证即使短到 9 字符也不会完整泄漏
  return `${key.slice(0, 4)}***${key.slice(-2)}`;
}

function formatResolvedModel(resolved: ResolvedModel): string {
  const maskedKey = redactApiKey(resolved.apiKey);
  const baseUrlDisplay = resolved.baseUrl || "<missing>";
  return `${resolved.provider}:${resolved.model} (baseUrl=${baseUrlDisplay}, apiKey=${maskedKey})`;
}

/**
 * 格式化诊断信息为多行字符串（纯函数，便于测试）。
 */
export function formatTierConfigDiagnostics(input: TierDiagnosticsInput): string {
  const lines: string[] = [];
  lines.push(`${TAG} provider: ${input.provider}`);

  if (input.provider === "stub") {
    lines.push(`${TAG} tier 路由未启用（stub 模式不走 createTierAwareProviderFromEnv）`);
    return lines.join("\n");
  }

  if (!input.snapshot) {
    lines.push(`${TAG} snapshot 缺失（可能 resolveTierProviderSnapshot 失败，详见 warn 日志）`);
    return lines.join("\n");
  }

  const { smart, flashReusesSmart, flash } = input.snapshot;
  const isLegacyMode = smart.provider === "default";
  if (isLegacyMode) {
    lines.push(`${TAG} 模式：兼容模式（LLM_SMART_MODEL 未配置，smart tier 回退到旧 LLM_MODEL）`);
  } else {
    lines.push(`${TAG} 模式：tier 路由（LLM_SMART_MODEL 已配置）`);
  }

  lines.push(`${TAG} smart: ${formatResolvedModel(smart)}`);

  if (flashReusesSmart || !flash) {
    lines.push(`${TAG} flash: <reuses smart>（LLM_FLASH_MODEL 未配置，flash tier 复用 smart provider）`);
  } else {
    lines.push(`${TAG} flash: ${formatResolvedModel(flash)}`);
  }

  if (input.registryEntries && input.registryEntries.length > 0) {
    lines.push(`${TAG} providers.json 注册条目：`);
    for (const entry of input.registryEntries) {
      lines.push(
        `${TAG}   - ${entry.name}: baseUrl=${entry.baseUrl || "<missing>"}, apiKeyEnv=${entry.apiKeyEnv ?? "<null>"}`,
      );
    }
  } else if (!isLegacyMode) {
    // tier 路由模式但 registry 为空，可能是配置异常
    lines.push(`${TAG} providers.json 注册条目：<空，可能 providers.json 不存在或解析失败>`);
  }

  return lines.join("\n");
}

/**
 * 打印 tier 配置诊断到 console.info（side-effect）。
 *
 * 失败安全：内部 try/catch，任何异常都降级为 console.warn，不抛错。
 * 调用方应在 server.listen 之前调用一次。
 */
export function logTierConfigDiagnostics(input: TierDiagnosticsInput): void {
  try {
    const output = formatTierConfigDiagnostics(input);
    // eslint-disable-next-line no-console
    console.info(output);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(
      `${TAG} 诊断生成失败：${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * 启动时收集 tier 配置快照（封装 snapshot + registry 加载，失败时返回兜底）。
 *
 * 给 server.ts 用：调用此函数拿到 TierDiagnosticsInput 后传给 logTierConfigDiagnostics。
 * 任何异常都被吞掉（返回 unknown 模式），保证不阻塞启动。
 */
export function collectTierDiagnosticsInput(): TierDiagnosticsInput {
  try {
    if (env.llm.provider === "stub") {
      return { provider: "stub" };
    }

    const snapshot = resolveTierProviderSnapshot();
    const configPath =
      env.llm.providersConfigPath ?? path.resolve(process.cwd(), "backend/providers.json");
    const registry = loadProviderRegistry({ configPath });
    return {
      provider: env.llm.provider,
      snapshot,
      registryEntries: [...registry.values()],
    };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(
      `${TAG} collectTierDiagnosticsInput 失败，降级为最小诊断：${error instanceof Error ? error.message : String(error)}`,
    );
    return { provider: env.llm.provider ?? "unknown" };
  }
}
