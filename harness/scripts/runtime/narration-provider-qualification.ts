/**
 * 任务 0 独立资格采集器：缺省零网络、零业务写入。
 * 官方参数/价格来源及冻结样本索引见 narration-timing/manifest.json。
 * 只收集证据，不自动给出音质评分、资格或生产默认值。
 */
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import type manifestType from "../../samples/narration-timing/manifest.json";

type Manifest = typeof manifestType;
const manifestPath = fileURLToPath(new URL("../../samples/narration-timing/manifest.json", import.meta.url));
// 变更任何候选、正文、参数或价格必须重新冻结，并重新取得对应 live 授权。
const FROZEN_MANIFEST_HASH = "055f65442056099f7b98455c881da236e7dde7412943e3101185d02db4e65440";
const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const money = (n: number) => Math.round(n * 1e8) / 1e8;
export function loadManifest(): Manifest { return JSON.parse(readFileSync(manifestPath, "utf8")); }

export interface Options {
  live: boolean;
  confirmLive?: boolean;
  maxRequests?: number;
  maxCostCny?: number;
  samplesDir?: string;
  outputDir?: string;
}
export function parseArgs(argv: string[]): Options {
  const options: Options = { live: false };
  const seen = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (seen.has(flag)) throw new Error("duplicate_argument");
    seen.add(flag);
    if (flag === "--live") options.live = true;
    else if (flag === "--confirm-live") options.confirmLive = true;
    else if (flag === "--dry-run") { /* 缺省行为 */ }
    else if (["--max-requests", "--max-cost-cny", "--samples-dir", "--output-dir"].includes(flag)) {
      const value = argv[++i];
      if (!value || value.startsWith("--")) throw new Error("argument_value_missing");
      if (flag === "--max-requests") options.maxRequests = Number(value);
      if (flag === "--max-cost-cny") options.maxCostCny = Number(value);
      if (flag === "--samples-dir") options.samplesDir = value;
      if (flag === "--output-dir") options.outputDir = value;
    } else throw new Error("unknown_argument");
  }
  if (options.live && seen.has("--dry-run")) throw new Error("conflicting_mode");
  if (options.live) {
    if (!options.confirmLive) throw new Error("live_confirmation_required");
    assertLimits(options);
  } else if (options.confirmLive || options.maxRequests !== undefined || options.maxCostCny !== undefined) {
    throw new Error("live_limits_without_live");
  }
  return options;
}
function assertLimits(options: { maxRequests?: number; maxCostCny?: number }) {
  if (!Number.isInteger(options.maxRequests) || options.maxRequests! < 9 || options.maxRequests! > 11) throw new Error("request_limit_invalid");
  if (!Number.isFinite(options.maxCostCny) || options.maxCostCny! <= 0) throw new Error("cost_limit_invalid");
}

export function buildPlan(manifest = loadManifest()) {
  if (sha256(JSON.stringify(manifest)) !== FROZEN_MANIFEST_HASH) throw new Error("frozen_matrix_changed");
  const requests = manifest.samples.flatMap(sample => manifest.candidates.map(candidate => ({
    id: candidate.id + ":" + sample.id,
    candidate_id: candidate.id,
    sample_id: sample.id,
    model: candidate.model,
    voice: candidate.voice,
    region: manifest.region,
    protocol: manifest.protocol,
    text_sha256: sample.text_sha256,
    utf16_length: sample.utf16_length,
    price_cny_per_10k: candidate.price_cny_per_10k,
    parameters: { ...manifest.parameters },
    estimated_cost_cny: money(sample.utf16_length * candidate.price_cny_per_10k / 10000),
  })));
  const medium = manifest.samples.find(s => s.id === "medium")!;
  const reserved = manifest.candidates.slice(1).map(c => ({
    candidate_id: c.id, sample_id: "medium", model: c.model, voice: c.voice,
    status: c.tone_trial,
    scheduled: false,
    reason: "仅预留，不把未冻结语气能力和指令加入已执行矩阵；须先补证据并明确本轮授权范围。",
    estimated_cost_cny: money(medium.utf16_length * c.price_cny_per_10k / 10000),
  }));
  const baseCost = money(requests.reduce((n, r) => n + r.estimated_cost_cny, 0));
  return {
    matrix_hash: FROZEN_MANIFEST_HASH,
    region: manifest.region, protocol: manifest.protocol, endpoint: manifest.endpoint,
    parameters_version: manifest.parameters_version,
    pricing: manifest.pricing,
    samples: manifest.samples,
    candidates: manifest.candidates,
    requests,
    reserved_requests: reserved,
    max_matrix_requests: 11,
    estimated_cost_cny: baseCost,
    estimated_max_cost_cny: money(baseCost + reserved.reduce((n, r) => n + r.estimated_cost_cny, 0)),
    scoring: manifest.scoring,
  };
}
type Plan = ReturnType<typeof buildPlan>;
export type RequestRow = Plan["requests"][number];
export interface CallResult {
  status: "succeeded" | "failed" | "unknown";
  usage_characters?: number | null;
  request_id?: string | null;
  audio_bytes?: number;
  audio_sha256?: string;
  elapsed_ms?: number;
}
type Transport = (row: RequestRow) => Promise<CallResult>;
function emptyReport(plan: Plan, mode: "dry-run" | "live") {
  return {
    schema_version: "narration_qualification_report_v1",
    mode, plan,
    actual_requests: 0,
    actual_cost_cny: 0 as number | null,
    accounted_cost_cny: 0,
    stopped_reason: null as string | null,
    comparison_status: "incomplete" as const,
    recommended_candidate: null,
    candidates: plan.candidates.map(c => ({
      candidate_id: c.id, model: c.model, voice: c.voice,
      qualification: "unverified" as const, score: null,
      evidence_missing: ["单任务全文完整性听审", "PCM 声道/位深/端序", "跨句时间基准与字符索引单位", "原文规范化映射", "每组合至少 30 个边界实测", "同稿盲听评分"],
    })),
    calls: [] as Array<{ request: RequestRow; result: CallResult; accounted_cost_cny: number }>,
  };
}
export async function executePlan(plan: Plan, limits: { maxRequests: number; maxCostCny: number }, transport: Transport) {
  assertLimits(limits);
  // 执行函数也不能接受调用方扩大或替换后的计划。
  if (JSON.stringify(plan) !== JSON.stringify(buildPlan())) throw new Error("frozen_matrix_changed");
  if (limits.maxCostCny < plan.estimated_cost_cny) throw new Error("cost_limit_insufficient");
  const report = emptyReport(plan, "live");
  for (const row of plan.requests) {
    if (report.actual_requests >= limits.maxRequests) { report.stopped_reason = "request_limit"; break; }
    if (report.accounted_cost_cny + row.estimated_cost_cny > limits.maxCostCny) { report.stopped_reason = "cost_limit"; break; }
    // 在外呼之前计入；异常也占次数，绝不 retry。
    report.actual_requests++;
    let result: CallResult;
    try { result = await transport(row); } catch { result = { status: "unknown" }; }
    const known = result.status === "succeeded" && Number.isSafeInteger(result.usage_characters) && result.usage_characters! > 0;
    const cost = known ? money(result.usage_characters! * row.price_cny_per_10k / 10000) : money(limits.maxCostCny - report.accounted_cost_cny);
    report.accounted_cost_cny = money(report.accounted_cost_cny + cost);
    report.actual_cost_cny = known ? report.accounted_cost_cny : null;
    // 白名单输出，不把 transport 异常、正文、密钥或原始事件带入可提交报告。
    report.calls.push({ request: row, result: {
      status: result.status, usage_characters: known ? result.usage_characters : null,
      request_id: result.request_id ?? null, audio_bytes: result.audio_bytes,
      audio_sha256: result.audio_sha256, elapsed_ms: result.elapsed_ms,
    }, accounted_cost_cny: cost });
    if (!known) { report.stopped_reason = "unknown_cost"; break; }
    if (report.accounted_cost_cny >= limits.maxCostCny) { report.stopped_reason = "cost_limit"; break; }
  }
  return report;
}

export function loadSampleTexts(samplesDir: string, plan = buildPlan()) {
  const texts = new Map<string, string>();
  for (const sample of plan.samples) {
    let text: string;
    try { text = readFileSync(resolve(samplesDir, sample.filename), "utf8"); } catch { throw new Error("sample_missing:" + sample.id); }
    if (text.length !== sample.utf16_length || [...text].length !== sample.unicode_codepoints || sha256(text) !== sample.text_sha256) throw new Error("sample_hash_mismatch:" + sample.id);
    if (text.length > 20000) throw new Error("sample_text_too_long");
    texts.set(sample.id, text);
  }
  return texts;
}

// 结构化接口使协议采集可用本地 EventEmitter 测试，不建立真实连接。
interface QualificationSocket {
  on(event: string, listener: (...args: any[]) => void): unknown;
  send(text: string): unknown;
  close(): unknown;
  terminate(): unknown;
}
type CaptureEvent = { kind: "json" | "audio" | "terminal"; elapsed_ms: number; byte_offset?: number; byte_length?: number; data?: unknown };
export function captureTask(socket: QualificationSocket, row: RequestRow, text: string, taskId: string, timeoutMs = 180000): Promise<CallResult & {
  pcm: Buffer; events: CaptureEvent[]; protocol_observations: { pcm_layout: string; timestamp_basis: string; index_unit: string };
}> {
  return new Promise(resolveResult => {
    const startedAt = Date.now();
    const events: CaptureEvent[] = [];
    const buffers: Buffer[] = [];
    let bytes = 0, started = false, settled = false;
    let requestId: string | null = null;
    let cumulativeUsage: number | null = null;
    const finish = (status: CallResult["status"], reason: string, finalUsage?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      events.push({ kind: "terminal", elapsed_ms: Date.now() - startedAt, data: reason });
      // 不把 sentence-end 的部分 usage 当成失败任务的最终账单。
      const usage = status === "succeeded" && Number.isSafeInteger(finalUsage) && Number(finalUsage) > 0 && Number(finalUsage) >= (cumulativeUsage ?? 0) ? Number(finalUsage) : null;
      const pcm = Buffer.concat(buffers);
      if (status === "succeeded") socket.close(); else socket.terminate();
      resolveResult({ status, usage_characters: usage, request_id: requestId,
        audio_bytes: pcm.length, audio_sha256: sha256(pcm), elapsed_ms: Date.now() - startedAt, pcm, events,
        protocol_observations: { pcm_layout: "unverified", timestamp_basis: "unverified", index_unit: "unverified" },
      });
    };
    const timer = setTimeout(() => finish("unknown", "timeout"), timeoutMs);
    const send = (action: string, payload: object) => socket.send(JSON.stringify({ header: { action, task_id: taskId, streaming: "duplex" }, payload }));
    socket.on("open", () => {
      if (settled) return;
      try { send("run-task", { task_group: "audio", task: "tts", function: "SpeechSynthesizer", model: row.model, parameters: { ...row.parameters, voice: row.voice }, input: {} }); }
      catch { finish("unknown", "send_failed"); }
    });
    socket.on("message", (data: Buffer, isBinary: boolean) => {
      if (settled) return;
      if (isBinary) {
        if (!started || bytes + data.length > 64 * 1024 * 1024) { finish("unknown", "audio_limit_or_order"); return; }
        events.push({ kind: "audio", elapsed_ms: Date.now() - startedAt, byte_offset: bytes, byte_length: data.length });
        buffers.push(Buffer.from(data)); bytes += data.length; return;
      }
      try {
        const event = JSON.parse(data.toString());
        events.push({ kind: "json", elapsed_ms: Date.now() - startedAt, data: event });
        if (event.header?.task_id !== taskId) { finish("unknown", "task_id_mismatch"); return; }
        requestId = event.header?.attributes?.request_uuid ?? requestId;
        const usage = event.payload?.usage?.characters;
        if (usage !== undefined) {
          if (!Number.isSafeInteger(usage) || usage < 0 || usage < (cumulativeUsage ?? 0)) { finish("unknown", "usage_invalid"); return; }
          cumulativeUsage = usage;
        }
        switch (event.header.event) {
          case "task-started":
            if (!started) { started = true; send("continue-task", { input: { text } }); send("finish-task", { input: {} }); }
            break;
          case "result-generated":
            if (!started) finish("unknown", "event_order_invalid");
            break;
          case "task-finished":
            finish(started && bytes > 0 ? "succeeded" : "unknown", "task-finished", usage); break;
          case "task-failed": finish("failed", "task-failed"); break;
          default: finish("unknown", "unexpected_event");
        }
      } catch { finish("unknown", "malformed_event_or_send_failed"); }
    });
    socket.on("error", () => finish("unknown", "socket_error"));
    socket.on("close", () => finish("unknown", "socket_closed_before_finish"));
  });
}

export async function runQualification(options: Options, dependencies: { transport?: Transport } = {}) {
  const plan = buildPlan();
  if (!options.live) return emptyReport(plan, "dry-run");
  if (!options.confirmLive) throw new Error("live_confirmation_required");
  assertLimits(options);
  if (options.maxCostCny! < plan.estimated_cost_cny) throw new Error("cost_limit_insufficient");
  if (!options.samplesDir) throw new Error("sample_directory_required");
  const texts = loadSampleTexts(options.samplesDir, plan);
  // 实际 live 前必须先完成人工预览与本轮授权。离线交付不冒充这个前提已满足。
  if (plan.candidates.some(c => c.preview_review !== "confirmed")) throw new Error("candidate_preview_review_pending");
  if (!options.outputDir) throw new Error("live_output_directory_required");
  const apiKey = process.env.ALIYUN_DASHSCOPE_API_KEY;
  if (!dependencies.transport && !apiKey?.trim()) throw new Error("api_key_missing");
  // 独占目录即本轮账本。已存在就拒绝，防止重启自动补跑已扣费的请求。
  mkdirSync(dirname(resolve(options.outputDir)), { recursive: true });
  mkdirSync(resolve(options.outputDir));
  const writeJson = (name: string, value: unknown) => writeFileSync(resolve(options.outputDir!, name), JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
  writeJson("plan.json", plan);
  const require = createRequire(import.meta.url);
  const WebSocket = dependencies.transport ? null : require("ws") as new (url: string, options: object) => QualificationSocket;
  const transport: Transport = dependencies.transport ?? (async row => {
    const taskId = randomUUID();
    const socket = new WebSocket!(plan.endpoint, { headers: { Authorization: "Bearer " + apiKey }, followRedirects: false, handshakeTimeout: 15000, maxPayload: 1024 * 1024 });
    const result = await captureTask(socket, row, texts.get(row.sample_id)!, taskId);
    const name = row.id.replace(":", "-");
    writeFileSync(resolve(options.outputDir!, name + ".pcm"), result.pcm, { flag: "wx" });
    // 原始事件含原文，只进被忽略的运行目录；报告只用白名单字段。
    writeJson(name + ".events.json", { task_id: taskId, events: result.events, observations: result.protocol_observations });
    return result;
  });
  const report = await executePlan(plan, { maxRequests: options.maxRequests!, maxCostCny: options.maxCostCny! }, async row => {
    appendFileSync(resolve(options.outputDir!, "attempts.jsonl"), JSON.stringify({ request_id: row.id, status: "dispatched_cost_unknown", at: new Date().toISOString() }) + "\n");
    const result = await transport(row);
    appendFileSync(resolve(options.outputDir!, "attempts.jsonl"), JSON.stringify({ request_id: row.id, status: result.status, usage_characters: result.usage_characters ?? null }) + "\n");
    return result;
  });
  writeJson("report.json", report);
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  Promise.resolve().then(() => runQualification(parseArgs(process.argv.slice(2)))).then(report => {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    if (report.stopped_reason) process.exitCode = 1;
  }).catch(error => {
    // 自身明确错误码可输出；底层错误不展开，避免环境和鉴权信息泄漏。
    const code = error instanceof Error && /^[a-z_]+(?::[a-z]+)?$/.test(error.message) ? error.message : "qualification_preflight_or_io_failed";
    process.stderr.write(JSON.stringify({ error: code, comparison_status: "incomplete" }) + "\n");
    process.exitCode = 1;
  });
}
