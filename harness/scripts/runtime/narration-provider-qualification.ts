/**
 * 任务 0 独立资格采集器：缺省零网络、零业务写入。
 * 官方参数/价格来源及冻结样本索引见 narration-timing/manifest.json。
 * 只收集证据，不自动给出音质评分、资格或生产默认值。
 */
import { EventEmitter } from "node:events";
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
  reconcileFrom?: string;
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
    else if (["--max-requests", "--max-cost-cny", "--samples-dir", "--output-dir", "--reconcile-from"].includes(flag)) {
      const value = argv[++i];
      if (!value || value.startsWith("--")) throw new Error("argument_value_missing");
      if (flag === "--max-requests") options.maxRequests = Number(value);
      if (flag === "--max-cost-cny") options.maxCostCny = Number(value);
      if (flag === "--samples-dir") options.samplesDir = value;
      if (flag === "--output-dir") options.outputDir = value;
      if (flag === "--reconcile-from") options.reconcileFrom = value;
    } else throw new Error("unknown_argument");
  }
  if (options.live && seen.has("--dry-run")) throw new Error("conflicting_mode");
  if (options.live) {
    if (!options.confirmLive) throw new Error("live_confirmation_required");
    assertLimits(options);
  } else if (options.confirmLive || options.maxRequests !== undefined || options.maxCostCny !== undefined || options.reconcileFrom !== undefined) {
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
    // 实测计费字符高于 UTF-16 长度；保留历史冻结报价，调度使用独立的 2 倍预留。
    estimated_budget_reserve_cny: money(plan.estimated_cost_cny * 2),
    estimate_caveat: "初始冻结估价低于本轮真实 usage；双倍预留只用于调度，不是供应商账单保证。",
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
  if (limits.maxCostCny < money(plan.estimated_cost_cny * 2)) throw new Error("cost_limit_insufficient");
  const report = emptyReport(plan, "live");
  for (const row of plan.requests) {
    if (report.actual_requests >= limits.maxRequests) { report.stopped_reason = "request_limit"; break; }
    if (report.accounted_cost_cny + money(row.estimated_cost_cny * 2) > limits.maxCostCny) { report.stopped_reason = "cost_limit"; break; }
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
    let nextSentence = 0, openSentence: number | null = null, sentenceOrderValid = true;
    let completedUsage: number | null = null, completedBytes = -1;
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
        if (event.header.event === "result-generated") {
          const output = event.payload?.output;
          const index = output?.sentence?.index;
          if (output?.type === "sentence-begin") {
            if (openSentence !== null || index !== nextSentence) sentenceOrderValid = false;
            openSentence = index;
          } else if (output?.type === "sentence-end") {
            if (openSentence !== index || index !== nextSentence) sentenceOrderValid = false;
            openSentence = null; nextSentence++;
            completedUsage = Number.isSafeInteger(usage) && usage > 0 ? usage : null;
            completedBytes = bytes;
          }
        }
        switch (event.header.event) {
          case "task-started":
            if (!started) { started = true; send("continue-task", { input: { text } }); send("finish-task", { input: {} }); }
            break;
          case "result-generated":
            if (!started) finish("unknown", "event_order_invalid");
            break;
          case "task-finished":
            // 部署实测 task-finished 可省略 usage。成功结束且所有句已闭合时，
            // sentence-end 的最后累计计费值才是完整任务用量；失败/断流不回退。
            finish(started && bytes > 0 ? "succeeded" : "unknown", "task-finished",
              usage === undefined && sentenceOrderValid && nextSentence > 0 && openSentence === null && completedBytes === bytes
                ? completedUsage : usage); break;
          case "task-failed": finish("failed", "task-failed"); break;
          default: finish("unknown", "unexpected_event");
        }
      } catch { finish("unknown", "malformed_event_or_send_failed"); }
    });
    socket.on("error", () => finish("unknown", "socket_error"));
    socket.on("close", () => finish("unknown", "socket_closed_before_finish"));
  });
}


// 只核销已有完整成功响应。回放完全离线，旧报告不覆盖，失败/缺帧不可恢复调度。
export async function reconcileCompletedCalls(directory: string, plan: Plan, maxCostCny: number) {
  const prior = JSON.parse(readFileSync(resolve(directory, "report.json"), "utf8")) as ReturnType<typeof emptyReport>;
  const journal = readFileSync(resolve(directory, "attempts.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line));
  if (JSON.stringify(prior.plan) !== JSON.stringify(plan) || prior.stopped_reason !== "unknown_cost" ||
      !Number.isSafeInteger(prior.actual_requests) || !Number.isFinite(prior.accounted_cost_cny) || prior.accounted_cost_cny <= 0 ||
      prior.actual_requests < 1 || prior.actual_requests >= plan.requests.length || prior.calls.length !== prior.actual_requests ||
      journal.length !== prior.calls.length * 2 || maxCostCny > prior.accounted_cost_cny) throw new Error("reconciliation_ledger_invalid");
  const results = new Map<string, CallResult>();
  for (const [i, call] of prior.calls.entries()) {
    const row = plan.requests[i];
    if (JSON.stringify(call.request) !== JSON.stringify(row) || call.result.status !== "succeeded" ||
        journal[i*2].request_id !== row.id || journal[i*2].status !== "dispatched_cost_unknown" ||
        journal[i*2+1].request_id !== row.id || journal[i*2+1].status !== "succeeded") throw new Error("reconciliation_ledger_invalid");
    const name = row.id.replace(":", "-");
    const pcm = readFileSync(resolve(directory, name + ".pcm"));
    const raw = JSON.parse(readFileSync(resolve(directory, name + ".events.json"), "utf8"));
    if (!pcm.length || pcm.length !== call.result.audio_bytes || sha256(pcm) !== call.result.audio_sha256 ||
        !Array.isArray(raw.events) || !raw.task_id) throw new Error("reconciliation_evidence_invalid");
    const recorded = raw.events as CaptureEvent[];
    const last = recorded.at(-1), beforeLast = recorded.at(-2);
    if (last?.kind !== "terminal" || last.data !== "task-finished" || beforeLast?.kind !== "json" ||
        (beforeLast.data as any)?.header?.event !== "task-finished" || recorded.some((e, index) =>
          !["json", "audio", "terminal"].includes(e.kind) || (e.kind === "terminal" && index !== recorded.length - 1) ||
          (e.kind === "json" && ((e.data as any)?.header?.task_id !== raw.task_id ||
            (["task-finished", "task-failed"].includes((e.data as any)?.header?.event) && index !== recorded.length - 2))))) throw new Error("reconciliation_evidence_invalid");
    const socket = Object.assign(new EventEmitter(), { send() {}, close() {}, terminate() {} });
    const pending = captureTask(socket, row, "", raw.task_id, 1000);
    let offset = 0;
    for (const event of raw.events as CaptureEvent[]) {
      if (event.kind === "json") socket.emit("message", Buffer.from(JSON.stringify(event.data)), false);
      else if (event.kind === "audio") {
        if (event.byte_offset !== offset || !Number.isSafeInteger(event.byte_length) || event.byte_length! <= 0 || offset + event.byte_length! > pcm.length) {
          socket.emit("error"); await pending; throw new Error("reconciliation_evidence_invalid");
        }
        socket.emit("message", pcm.subarray(offset, offset + event.byte_length!), true); offset += event.byte_length!;
      }
    }
    socket.emit("close");
    const replay = await pending;
    if (offset !== pcm.length || replay.status !== "succeeded" || !replay.usage_characters || replay.audio_sha256 !== call.result.audio_sha256 ||
        (call.result.usage_characters != null && call.result.usage_characters !== replay.usage_characters)) throw new Error("reconciliation_cost_still_unknown");
    results.set(row.id, { ...call.result, usage_characters: replay.usage_characters });
  }
  return results;
}

export async function runQualification(options: Options, dependencies: { transport?: Transport; loadTexts?: typeof loadSampleTexts } = {}) {
  const plan = buildPlan();
  if (!options.live) return emptyReport(plan, "dry-run");
  if (!options.confirmLive) throw new Error("live_confirmation_required");
  assertLimits(options);
  if (options.maxCostCny! < money(plan.estimated_cost_cny * 2)) throw new Error("cost_limit_insufficient");
  if (!options.samplesDir) throw new Error("sample_directory_required");
  const texts = (dependencies.loadTexts ?? loadSampleTexts)(options.samplesDir, plan);
  // 显式授权允许采集待听审候选；采集不改变 preview_review 或资格状态。
  if (!options.outputDir) throw new Error("live_output_directory_required");
  const apiKey = process.env.ALIYUN_DASHSCOPE_API_KEY;
  if (!dependencies.transport && !apiKey?.trim()) throw new Error("api_key_missing");
  const reconciled = options.reconcileFrom ? await reconcileCompletedCalls(options.reconcileFrom, plan, options.maxCostCny!) : new Map<string, CallResult>();
  // 独占目录即本轮账本。已存在就拒绝，防止重启自动补跑已扣费的请求。
  mkdirSync(dirname(resolve(options.outputDir)), { recursive: true });
  mkdirSync(resolve(options.outputDir));
  const writeJson = (name: string, value: unknown) => writeFileSync(resolve(options.outputDir!, name), JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
  writeJson("plan.json", plan);
  if (options.reconcileFrom) {
    // 永久独占领取，崩溃也不能自动再领或重发；上限沿用原轮，绝不重置预算。
    writeFileSync(resolve(options.reconcileFrom, "reconciliation.claim.json"), JSON.stringify({ output_dir: resolve(options.outputDir), at: new Date().toISOString() }), { flag: "wx" });
    writeJson("reconciliation.json", { source_dir: resolve(options.reconcileFrom), calls: [...reconciled.entries()], max_cost_cny: options.maxCostCny });
  }
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
    if (reconciled.has(row.id)) return reconciled.get(row.id)!;
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
