export interface LlmInteractionLogEntry {
  generatedAt: string;
  provider: string;
  model: string;
  operationName: string;
  promptId: string;
  promptStage: string;
  promptLanguage: string;
  promptFilePath: string;
  systemPrompt: string;
  input: unknown;
  rawOutput: string;
  parsedOutput?: unknown;
  errorMessage?: string | null;
}

export interface LlmInteractionLogWriter {
  write(entry: LlmInteractionLogEntry): Promise<void> | void;
}

export function renderLlmInteractionMarkdown(
  entry: LlmInteractionLogEntry & { sequence: number },
) {
  const lines = [
    `# LLM 交互日志 ${String(entry.sequence).padStart(2, "0")}`,
    "",
    "## 元数据",
    "",
    `- generated_at: ${entry.generatedAt}`,
    `- provider: ${entry.provider}`,
    `- model: ${entry.model}`,
    `- operation_name: ${entry.operationName}`,
    `- prompt_id: ${entry.promptId}`,
    `- prompt_stage: ${entry.promptStage}`,
    `- prompt_language: ${entry.promptLanguage}`,
    `- prompt_file: ${entry.promptFilePath.replace(/\\/g, "/")}`,
    "",
    "## 输入对象",
    "",
    "```json",
    stableStringify(entry.input),
    "```",
    "",
    "## System Prompt",
    "",
    "```md",
    entry.systemPrompt.trim(),
    "```",
    "",
    "## 原始模型响应",
    "",
    "```text",
    entry.rawOutput.trim(),
    "```",
  ];

  if (entry.parsedOutput !== undefined) {
    lines.push(
      "",
      "## 归一化结果",
      "",
      "```json",
      stableStringify(entry.parsedOutput),
      "```",
    );
  }

  if (entry.errorMessage) {
    lines.push(
      "",
      "## 错误信息",
      "",
      "```text",
      entry.errorMessage,
      "```",
    );
  }

  lines.push("");
  return lines.join("\n");
}

function stableStringify(value: unknown) {
  return JSON.stringify(
    value,
    (_key, nestedValue) => {
      if (
        nestedValue &&
        typeof nestedValue === "object" &&
        !Array.isArray(nestedValue)
      ) {
        return Object.fromEntries(
          Object.entries(nestedValue as Record<string, unknown>).sort(([left], [right]) =>
            left.localeCompare(right),
          ),
        );
      }

      return nestedValue;
    },
    2,
  );
}
