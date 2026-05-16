/**
 * DashScope async task client — submit, poll, download.
 *
 * Live tests must use explicit API key; defaults CI only.
 * Checked docs: https://help.aliyun.com/zh/model-studio/ (2026-05-16).
 */

export interface DashScopeSubmitOptions {
  apiKey: string;
  endpoint: string;
  payload: Record<string, unknown>;
}

export interface DashScopeSubmitResult {
  taskId: string;
  rawResponse: Record<string, unknown>;
}

export interface DashScopePollOptions {
  apiKey: string;
  taskId: string;
}

export interface DashScopePollResult {
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELED";
  outputUrl?: string;
  errorCode?: string;
  errorMessage?: string;
  rawResponse: Record<string, unknown>;
}

const TASK_API_BASE = "https://dashscope.aliyuncs.com/api/v1/tasks";

export async function submitDashscopeAsyncTask(
  options: DashScopeSubmitOptions,
): Promise<DashScopeSubmitResult> {
  const response = await fetch(options.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${options.apiKey}`,
      "X-DashScope-Async": "enable",
    },
    body: JSON.stringify(options.payload),
  });

  const rawResponse = (await response.json()) as Record<string, unknown>;

  if (!response.ok) {
    throw new Error(
      `DashScope submit failed: ${response.status} ${JSON.stringify(rawResponse)}`,
    );
  }

  const output = rawResponse.output as Record<string, unknown> | undefined;
  const taskId = (output?.task_id ?? output?.taskId ?? rawResponse.task_id) as string | undefined;

  if (!taskId) {
    throw new Error(`Missing task_id in DashScope response: ${JSON.stringify(rawResponse)}`);
  }

  return { taskId, rawResponse };
}

export async function pollDashscopeTask(
  options: DashScopePollOptions,
): Promise<DashScopePollResult> {
  const url = `${TASK_API_BASE}/${options.taskId}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
    },
  });

  const rawResponse = (await response.json()) as Record<string, unknown>;

  if (!response.ok) {
    throw new Error(
      `DashScope poll failed: ${response.status} ${JSON.stringify(rawResponse)}`,
    );
  }

  const output = (rawResponse.output ?? rawResponse) as Record<string, unknown>;
  const status = ((output.task_status ?? "") as string).toUpperCase() as DashScopePollResult["status"];

  const result: DashScopePollResult = { status, rawResponse };

  if (status === "FAILED" || status === "CANCELED") {
    result.errorCode = (output.code ?? "UNKNOWN") as string;
    result.errorMessage = (output.message ?? JSON.stringify(output)) as string;
  }

  if (status === "SUCCEEDED") {
    result.outputUrl = extractOutputUrl(output);
  }

  return result;
}

export async function downloadDashscopeOutput(url: string): Promise<Buffer> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `DashScope download failed: ${response.status} ${response.statusText}`,
    );
  }

  return Buffer.from(await response.arrayBuffer());
}

function extractOutputUrl(output: Record<string, unknown>): string | undefined {
  // Depth-first search for http URL in results
  if (Array.isArray(output.results)) {
    for (const item of output.results as Array<Record<string, unknown>>) {
      const url = item.url;
      if (typeof url === "string" && url.startsWith("http")) return url;
    }
  }

  // Check audio URL for TTS responses
  const audio = output.audio as Record<string, unknown> | undefined;
  if (audio?.url && typeof audio.url === "string" && audio.url.startsWith("http")) {
    return audio.url;
  }

  // Generic depth-first fallback
  return deepFindHttpUrl(output);
}

function deepFindHttpUrl(root: unknown): string | undefined {
  const queue: unknown[] = [root];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }
    if (typeof current !== "object") continue;
    const obj = current as Record<string, unknown>;
    for (const [, val] of Object.entries(obj)) {
      if (typeof val === "string" && val.startsWith("http")) return val;
      if (val && typeof val === "object") queue.push(val);
    }
  }
  return undefined;
}
