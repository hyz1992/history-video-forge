/**
 * 启动时 prompt 注册诊断（S2-3 Task 4）。
 *
 * 设计约束（见 docs/plans/archive/2026-07-18-s2-3-prompt-governance-design.md §3.2）：
 *
 * - 仅输出 id + version + status 三字段。
 * - 不做 SHA drift 检测（drift 由 Task 8 check-prompt-drift 离线脚本完成）。
 * - 不做跨进程 SHA 比较（不读 previousSnapshot）。
 * - 失败安全：诊断失败不阻塞 server 启动，降级为 console.warn。
 *
 * 职责拆分：
 * - formatPromptRegistryDiagnostics：纯函数，便于单测。
 * - logPromptRegistryDiagnostics：side-effect，由 server.ts 启动序列调用一次。
 */

import type { LoadedPrompt } from "../prompts/prompt-loader.js";

const TAG = "[prompt-registry]";

/**
 * 格式化 prompt 注册摘要（纯函数，便于测试）。
 *
 * 只输出 id + version + status，不输出 SHA、不输出 body。
 */
export function formatPromptRegistryDiagnostics(input: {
  prompts: ReadonlyArray<{ id: string; version: string; status: string }>;
}): string {
  const lines: string[] = [];
  lines.push(`${TAG} 已注册 prompt 摘要：`);

  const statusCount = { active: 0, deprecated: 0, draft: 0, other: 0 };
  const sortedPrompts = [...input.prompts].sort((a, b) => a.id.localeCompare(b.id));

  for (const p of sortedPrompts) {
    lines.push(`${TAG}   - ${p.id} ${p.version} (${p.status})`);
    if (p.status === "active") statusCount.active++;
    else if (p.status === "deprecated") statusCount.deprecated++;
    else if (p.status === "draft") statusCount.draft++;
    else statusCount.other++;
  }

  const total = sortedPrompts.length;
  const parts: string[] = [];
  if (statusCount.active > 0) parts.push(`${statusCount.active} active`);
  if (statusCount.deprecated > 0) parts.push(`${statusCount.deprecated} deprecated`);
  if (statusCount.draft > 0) parts.push(`${statusCount.draft} draft`);
  if (statusCount.other > 0) parts.push(`${statusCount.other} other`);
  lines.push(`${TAG} 校验：${total}/${total} 已注册，${parts.join("，") || "无分类"}`);

  return lines.join("\n");
}

/**
 * 打印 prompt 注册诊断到 console.info（side-effect）。
 *
 * 失败安全：内部 try/catch，任何异常都降级为 console.warn，不抛错。
 */
export function logPromptRegistryDiagnostics(input: {
  prompts: ReadonlyArray<LoadedPrompt>;
}): void {
  try {
    const summary = input.prompts.map((p) => ({
      id: p.metadata.id,
      version: p.metadata.version,
      status: p.metadata.status,
    }));
    const output = formatPromptRegistryDiagnostics({ prompts: summary });
    // eslint-disable-next-line no-console
    console.info(output);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(
      `${TAG} 诊断生成失败：${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
