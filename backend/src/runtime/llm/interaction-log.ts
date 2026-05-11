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
  timing?: {
    startedAt: string;
    finishedAt: string;
    durationMs: number;
  };
  annotations?: string[];
  errorMessage?: string | null;
}

export interface LlmInteractionLogWriter {
  write(entry: LlmInteractionLogEntry): Promise<void> | void;
}

export interface RecommendationDiagnosticsMarkdownInput {
  generatedAt: string;
  diagnostics: Array<{
    code: string;
    level: "info" | "warning" | "error";
    reason?: string;
  }>;
  candidates: Array<{
    event_identity?: string;
    title: string;
    one_line_angle: string;
  }>;
  annotations: string[];
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

  if (entry.annotations?.length) {
    lines.push("", "## 归因注记", "");
    for (const annotation of entry.annotations) {
      lines.push(`- ${normalizeMarkdownAnnotation(annotation)}`);
    }
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

export function renderRecommendationDiagnosticsMarkdown(
  input: RecommendationDiagnosticsMarkdownInput,
) {
  const lines = [
    "# Recommendation Diagnostics",
    "",
    `- generated_at: ${input.generatedAt}`,
    `- candidate_count: ${input.candidates.length}`,
    "",
    "## Diagnostics",
    "",
  ];

  for (const check of input.diagnostics) {
    const reasonSuffix = check.reason
      ? ` - ${normalizeMarkdownAnnotation(check.reason)}`
      : "";
    lines.push(`- [${check.level}] ${check.code}${reasonSuffix}`);
  }

  lines.push("", "## Candidates", "");
  for (const candidate of input.candidates) {
    const eventIdentityPrefix = candidate.event_identity
      ? `event_identity=${normalizeMarkdownAnnotation(candidate.event_identity)} | `
      : "";
    lines.push(
      `- ${eventIdentityPrefix}${normalizeMarkdownAnnotation(candidate.title)} | ${normalizeMarkdownAnnotation(candidate.one_line_angle)}`,
    );
  }

  if (input.annotations.length > 0) {
    lines.push("", "## Notes", "");
    for (const annotation of input.annotations) {
      lines.push(`- ${normalizeMarkdownAnnotation(annotation)}`);
    }
  }

  lines.push("");
  return lines.join("\n");
}

export function normalizeMarkdownAnnotation(annotation: string) {
  return annotation
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" / ")
    .replace(/`/g, "\\`")
    .replace(/^[-+*]\s+/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
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
