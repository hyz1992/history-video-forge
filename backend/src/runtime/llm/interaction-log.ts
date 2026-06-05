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

/** Pipeline phase → Chinese stage label for unified trace.md rendering. */
const STAGE_LABELS: Record<string, string> = {
  topic: "选题",
  script: "口播文案",
  storyboard: "分镜规划",
  asset_planning: "资产规划",
  assets: "素材生成",
  compose: "合成",
  render: "渲染导出",
};

/**
 * Render a single trace section in the old-project unified trace.md format.
 * Uses table-based metadata, blockquote prompts, JSON output blocks,
 * and a timing footer — matching the `story-video-forge` convention.
 */
export function renderTraceSectionMarkdown(
  entry: LlmInteractionLogEntry,
  phaseIndex?: number,
): string {
  const traceId = `trace-${Date.parse(entry.generatedAt) || 0}-${Math.floor(Math.random() * 1000)}`;
  const status = entry.errorMessage ? "error" : "success";
  const requestedAt = formatTraceDate(entry.generatedAt);
  const stageLabel = STAGE_LABELS[entry.promptStage] ?? entry.promptStage;
  const progressSuffix = phaseIndex !== undefined ? ` #${phaseIndex}` : "";
  const stageFull = `${stageLabel}${progressSuffix}`;

  const lines: string[] = [
    `## [Trace] ${entry.operationName} - ${entry.promptStage}（阶段：${stageFull}）`,
    "",
    "| Field | Value |",
    "|---|---|",
    `| Trace ID | \`${traceId}\` |`,
    `| Model | \`${entry.model}\` |`,
    `| Requested At | \`${requestedAt}\` |`,
    `| Status | \`${status}\` |`,
    "",
    "",
    `### Prompt——输入提示词（阶段：${stageFull}）`,
    "",
    "**User:**",
    "",
    indentBlockquote(stableStringify(entry.input)),
  ];

  if (entry.systemPrompt) {
    lines.push(
      "",
      "**System:**",
      "",
      indentBlockquote(entry.systemPrompt.trim()),
    );
  }

  lines.push("", `### Output——大模型返回（阶段：${stageFull}）`, "");

  if (entry.errorMessage) {
    lines.push("```text", entry.errorMessage, "```");
  } else if (entry.parsedOutput !== undefined) {
    lines.push("```json", stableStringify(entry.parsedOutput), "```");
  } else {
    lines.push("```text", entry.rawOutput.trim(), "```");
  }

  lines.push("");

  if (entry.timing) {
    const finishedAt = formatTraceDate(entry.timing.finishedAt);
    const durationSec = (entry.timing.durationMs / 1000).toFixed(2);
    lines.push(
      "| Field | Value |",
      "|---|---|",
      `| Responded At | \`${finishedAt}\` |`,
      `| Duration | \`${durationSec}s\`（阶段：${stageFull}） |`,
      "",
    );
  }

  lines.push("---", "");
  return lines.join("\n");
}

function formatTraceDate(isoString: string): string {
  try {
    const d = new Date(isoString);
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
  } catch {
    return isoString;
  }
}

function indentBlockquote(text: string): string {
  return text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
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
