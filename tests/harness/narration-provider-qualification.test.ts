import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

const entry = resolve("harness/scripts/runtime/narration-provider-qualification.ts");
async function api() {
  expect(existsSync(entry), "任务 0 独立验证入口必须存在").toBe(true);
  return import("../../harness/scripts/runtime/narration-provider-qualification.js");
}
const live = ["--live", "--confirm-live", "--max-requests", "11", "--max-cost-cny", "2"];
const dirs: string[] = [];
afterEach(() => { vi.restoreAllMocks(); dirs.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })); });

class Socket extends EventEmitter {
  sent: any[] = [];
  closed = false;
  send(text: string) { this.sent.push(JSON.parse(text)); }
  close() { this.closed = true; }
  terminate() { this.closed = true; }
}

describe("口播候选离线资格入口", () => {
  it("缺省以及 dry-run 均零请求，报告不伪造资格和评分", async () => {
    const q = await api();
    for (const args of [[], ["--dry-run"]]) {
      const transport = vi.fn();
      const report = await q.runQualification(q.parseArgs(args), { transport });
      expect(transport).not.toHaveBeenCalled();
      expect(report.actual_requests).toBe(0);
      expect(report.comparison_status).toBe("incomplete");
      expect(report.recommended_candidate).toBeNull();
      expect(report.candidates).toHaveLength(3);
      expect(report.candidates.every(c => c.qualification === "unverified" && c.score === null)).toBe(true);
    }
  });
  it.each([
    ["--live"], ["--confirm-live"],
    ["--live", "--confirm-live", "--max-requests", "11"],
    ["--live", "--confirm-live", "--max-cost-cny", "2"],
    [...live, "--dry-run"], [...live, "--model", "another"],
    ["--live", "--confirm-live", "--max-requests", "12", "--max-cost-cny", "2"],
    ["--live", "--confirm-live", "--max-requests", "1.5", "--max-cost-cny", "2"],
    ["--live", "--confirm-live", "--max-requests", "9", "--max-cost-cny", "NaN"],
    [...live, "--max-cost-cny", "0"],
  ])("拒绝不完整、冲突、非有限上限及未知参数 %j", async (...args) => {
    const q = await api(); expect(() => q.parseArgs(args)).toThrow();
  });
  it("冻结三组同稿九请求，语气只有两个预留槽，无默认赢家", async () => {
    const q = await api(); const plan = q.buildPlan();
    expect(plan.requests).toHaveLength(9);
    expect(plan.reserved_requests).toHaveLength(2);
    expect(plan.max_matrix_requests).toBe(11);
    for (const sample of plan.samples) {
      const rows = plan.requests.filter(r => r.sample_id === sample.id);
      expect(rows).toHaveLength(3);
      expect(new Set(rows.map(r => r.text_sha256)).size).toBe(1);
      expect(rows.every(r => r.parameters.format === "pcm" && r.parameters.sample_rate === 24000 && !("instruction" in r.parameters))).toBe(true);
    }
    expect(plan.requests.filter(r => r.model === "qwen-audio-3.0-tts-plus")).toHaveLength(3);
    expect(plan.estimated_cost_cny).toBeGreaterThan(0);
    expect(plan.estimated_max_cost_cny).toBeGreaterThan(plan.estimated_cost_cny);
  });
  it.each(["", "TBD", "qwen-audio-3.0-tts-flash-longyimuling", "longyimuling"])("拒绝 Qwen 占位符或错误模型音色 %s", async voice => {
    const q = await api(); const m = q.loadManifest(); m.candidates[2].voice = voice;
    expect(() => q.buildPlan(m)).toThrow("frozen_matrix_changed");
  });
  it("拒绝额外候选、样例和改写价格的矩阵", async () => {
    const q = await api();
    for (const mutate of [(m: ReturnType<typeof q.loadManifest>) => m.candidates.push(m.candidates[0]), (m: ReturnType<typeof q.loadManifest>) => m.samples.push(m.samples[0]), (m: ReturnType<typeof q.loadManifest>) => m.candidates[0].price_cny_per_10k = 0]) {
      const m = q.loadManifest(); mutate(m); expect(() => q.buildPlan(m)).toThrow("frozen_matrix_changed");
    }
  });
  it("正文 hash 和 UTF-16 长度在任何调用之前校验", async () => {
    const q = await api(); const dir = mkdtempSync(join(tmpdir(), "narration-samples-")); dirs.push(dir);
    writeFileSync(join(dir, "short.txt"), "替换后的正文");
    const transport = vi.fn();
    await expect(q.runQualification({ ...q.parseArgs(live), samplesDir: dir }, { transport })).rejects.toThrow("sample_");
    expect(transport).not.toHaveBeenCalled();
  });
  it("显式授权可采集 pending 候选，听审状态仍未验证，重复目录不补跑", async () => {
    const q = await api();
    const dir = mkdtempSync(join(tmpdir(), "narration-authorized-")); dirs.push(dir);
    const outputDir = join(dir, "round");
    const transport = vi.fn(async () => ({ status: "succeeded" as const, usage_characters: 100 }));
    const options = { ...q.parseArgs(["--live", "--confirm-live", "--max-requests", "9", "--max-cost-cny", "5"]), samplesDir: dir, outputDir };
    const dependencies = { transport, loadTexts: () => new Map([["short", "测试"], ["medium", "测试"], ["long", "测试"]]) };
    const report = await q.runQualification(options, dependencies);
    expect(report.actual_requests).toBe(9);
    expect(report.comparison_status).toBe("incomplete");
    expect(report.plan.candidates.every(c => c.preview_review === "pending")).toBe(true);
    expect(readFileSync(join(outputDir, "attempts.jsonl"), "utf8").trim().split("\n")).toHaveLength(18);
    await expect(q.runQualification(options, dependencies)).rejects.toThrow();
    expect(transport).toHaveBeenCalledTimes(9);
  });

  it.each(['valid', 'corrupt-audio', 'failed', 'missing-terminal', 'after-finished', 'invalid-cost', 'duplicate-journal'])('离线核销已结束任务后只采集未发出行 %s', async scenario => {
    const q = await api(); const dir = mkdtempSync(join(tmpdir(), 'narration-reconcile-')); dirs.push(dir);
    const outputDir = join(dir, 'first'); const row = q.buildPlan().requests[0];
    const pcm = Buffer.from([1,2]); const hash = createHash('sha256').update(pcm).digest('hex');
    const json = (event: string, payload = {}) => ({ kind: 'json', elapsed_ms: 1, data: { header: { event, task_id: 'task-1' }, payload } });
    const events = [json('task-started'), json('result-generated', {output:{type:'sentence-begin',sentence:{index:0}}}), {kind:'audio',elapsed_ms:2,byte_offset:0,byte_length:2}, json('result-generated',{output:{type:'sentence-end',sentence:{index:0}},usage:{characters:306}}), json(scenario === 'failed' ? 'task-failed':'task-finished'), {kind:'terminal',elapsed_ms:3,data:scenario === 'failed' ? 'task-failed':'task-finished'}];
    const loadTexts = () => new Map([['short','测试'],['medium','测试'],['long','测试']]);
    const options = {...q.parseArgs(['--live','--confirm-live','--max-requests','9','--max-cost-cny','5']), samplesDir:dir, outputDir};
    // 旧采集器成功收到音频，但只认结束事件 usage，因而停机。
    await q.runQualification(options,{loadTexts,transport:async()=>{
      writeFileSync(join(outputDir,'cosy-sanshu-short.pcm'),pcm);
      writeFileSync(join(outputDir,'cosy-sanshu-short.events.json'),JSON.stringify({task_id:'task-1',events}));
      return {status:'succeeded',usage_characters:null,audio_bytes:2,audio_sha256:hash,elapsed_ms:3};
    }});
    if (scenario==='missing-terminal') events.pop();
    if (scenario==='after-finished') events.splice(events.length-1,0,json('task-failed'));
    if (scenario==='missing-terminal' || scenario==='after-finished') writeFileSync(join(outputDir,'cosy-sanshu-short.events.json'),JSON.stringify({task_id:'task-1',events}));
    if (scenario==='invalid-cost') { const prior=JSON.parse(readFileSync(join(outputDir,'report.json'),'utf8')); prior.accounted_cost_cny='unknown'; writeFileSync(join(outputDir,'report.json'),JSON.stringify(prior)); }
    if (scenario==='duplicate-journal') writeFileSync(join(outputDir,'attempts.jsonl'),readFileSync(join(outputDir,'attempts.jsonl'),'utf8').repeat(2));
    if(scenario==='corrupt-audio')writeFileSync(join(outputDir,'cosy-sanshu-short.pcm'),Buffer.from([3,4]));
    const transport=vi.fn(async()=>({status:'succeeded' as const,usage_characters:100}));
    const resume={...options,outputDir:join(dir,'remaining'),reconcileFrom:outputDir};
    if(scenario!=='valid') {
      await expect(q.runQualification(resume,{loadTexts,transport})).rejects.toThrow();
      expect(transport).not.toHaveBeenCalled(); return;
    }
    const report=await q.runQualification(resume,{loadTexts,transport});
    expect(report.actual_requests).toBe(9); expect(transport).toHaveBeenCalledTimes(8);
    expect(report.calls[0].result.usage_characters).toBe(306);
    expect(report.actual_cost_cny).toBeCloseTo(0.1226);
    expect(readFileSync(join(resume.outputDir,'attempts.jsonl'),'utf8')).not.toContain(row.id);
    await expect(q.runQualification({...resume,outputDir:join(dir,'again')},{loadTexts,transport})).rejects.toThrow();
    expect(transport).toHaveBeenCalledTimes(8);
  });
  it("调度按双倍正文长度预留，冻结的初始估价不是预算保证", async () => {
    const q=await api(); const transport=vi.fn();
    await expect(q.executePlan(q.buildPlan(), {maxRequests:9,maxCostCny:1},transport)).rejects.toThrow('cost_limit_insufficient');
    expect(transport).not.toHaveBeenCalled();
    expect((await q.runQualification({live:false})).estimated_budget_reserve_cny).toBe(1.66328);
  });
  it("预算不足在读取密钥和外呼前拒绝", async () => {
    const q = await api(); const transport = vi.fn();
    await expect(q.runQualification({ ...q.parseArgs(live), maxCostCny: 0.00001 }, { transport })).rejects.toThrow("cost_limit_insufficient");
    expect(transport).not.toHaveBeenCalled();
  });
  it("错误和未知响应占一次额度并按剩余费用上限占用，立即停机不重试", async () => {
    const q = await api(); const plan = q.buildPlan();
    for (const transport of [vi.fn().mockRejectedValue(new Error("secret-provider-detail")), vi.fn().mockResolvedValue({ status: "unknown" })]) {
      const report = await q.executePlan(plan, { maxRequests: 11, maxCostCny: 2 }, transport);
      expect(transport).toHaveBeenCalledTimes(1);
      expect(report.actual_requests).toBe(1);
      expect(report.accounted_cost_cny).toBe(2);
      expect(report.actual_cost_cny).toBeNull();
      expect(report.stopped_reason).toBe("unknown_cost");
      expect(JSON.stringify(report)).not.toContain("secret-provider-detail");
    }
  });
  it("成功调用按累计 usage 计费，固定顺序执行，不把传输成功当比较完成", async () => {
    const q = await api(); const plan = q.buildPlan();
    const transport = vi.fn(async (_row: import("../../harness/scripts/runtime/narration-provider-qualification.js").RequestRow) => ({ status: "succeeded" as const, usage_characters: 100, request_id: "request", audio_bytes: 48000, audio_sha256: "a".repeat(64), elapsed_ms: 10 }));
    const report = await q.executePlan(plan, { maxRequests: 9, maxCostCny: 2 }, transport);
    expect(transport.mock.calls.map(c => c[0].id)).toEqual(plan.requests.map(r => r.id));
    expect(report.actual_requests).toBe(9);
    expect(report.accounted_cost_cny).toBeCloseTo(0.102);
    expect(report.comparison_status).toBe("incomplete");
    expect(report.recommended_candidate).toBeNull();
  });
  it("超过已批准费用或请求数停止，未知 usage 不算零", async () => {
    const q = await api(); const plan = q.buildPlan();
    const high = vi.fn(async () => ({ status: "succeeded" as const, usage_characters: 100000 }));
    const r = await q.executePlan(plan, { maxRequests: 9, maxCostCny: 2 }, high);
    expect(high).toHaveBeenCalledTimes(1); expect(r.stopped_reason).toBe("cost_limit");
    const none = vi.fn(async () => ({ status: "succeeded" as const }));
    expect((await q.executePlan(plan, { maxRequests: 9, maxCostCny: 2 }, none)).actual_cost_cny).toBeNull();
  });
  it("WebSocket 等 started 后只发送一次全文，保留句事件和二进制顺序，usage 取累计值", async () => {
    const q = await api(); const socket = new Socket(); const row = q.buildPlan().requests[0];
    const pending = q.captureTask(socket, row, "一整篇正文。第二句。", "task-1", 1000);
    socket.emit("open"); expect(socket.sent.map(s => s.header.action)).toEqual(["run-task"]);
    const emit = (event: string, payload = {}) => socket.emit("message", Buffer.from(JSON.stringify({ header: { event, task_id: "task-1" }, payload })), false);
    emit("task-started"); emit("task-started");
    expect(socket.sent.map(s => s.header.action)).toEqual(["run-task", "continue-task", "finish-task"]);
    expect(socket.sent[1].payload.input.text).toBe("一整篇正文。第二句。");
    emit("result-generated", { output: { type: "sentence-end", sentence: { index: 0, words: [{ text: "一", begin_index: 0, end_index: 1, begin_time: 0, end_time: 100 }] } }, usage: { characters: 5 } });
    socket.emit("message", Buffer.from([1, 2, 3, 4]), true);
    emit("result-generated", { usage: { characters: 8 } });
    emit("task-finished", { usage: { characters: 8 } });
    const result = await pending;
    expect(result.status).toBe("succeeded"); expect(result.usage_characters).toBe(8);
    expect(result.pcm).toEqual(Buffer.from([1, 2, 3, 4]));
    expect(result.events.some(e => e.kind === "audio" && e.byte_offset === 0)).toBe(true);
    expect(socket.closed).toBe(true);
  });
  it.each(["task-failed", "close", "error", "malformed", "wrong-task"])("WS %s 返回未知费用且保留证据，不重试", async scenario => {
    const q = await api(); const socket = new Socket();
    const pending = q.captureTask(socket, q.buildPlan().requests[0], "正文", "task-1", 1000);
    socket.emit("open");
    if (scenario === "close" || scenario === "error") socket.emit(scenario, new Error("sensitive"));
    else socket.emit("message", Buffer.from(scenario === "malformed" ? "{" : JSON.stringify({ header: { event: scenario === "wrong-task" ? "task-started" : scenario, task_id: scenario === "wrong-task" ? "wrong" : "task-1" } })), false);
    const result = await pending; expect(result.status).toBe(scenario === "task-failed" ? "failed" : "unknown"); expect(result.usage_characters).toBeNull(); expect(socket.closed).toBe(true);
  });

  it.each([['success', 306], ['failed', null], ['unfinished-sentence', null], ['audio-after-end', null]])("句末累计用量仅在完整成功结束后结算 %s", async (scenario, expected) => {
    const q = await api(); const socket = new Socket();
    const pending = q.captureTask(socket, q.buildPlan().requests[0], '正文', 'task-1', 1000);
    const emit = (event: string, payload = {}) => socket.emit('message', Buffer.from(JSON.stringify({ header: { event, task_id: 'task-1' }, payload })), false);
    emit('task-started');
    emit('result-generated', { output: { type: 'sentence-begin', sentence: { index: 0 } } });
    socket.emit('message', Buffer.from([1, 2]), true);
    emit('result-generated', { output: { type: 'sentence-end', sentence: { index: 0 } }, usage: { characters: 306 } });
    if (scenario === 'unfinished-sentence') emit('result-generated', { output: { type: 'sentence-begin', sentence: { index: 1 } } });
    if (scenario === 'audio-after-end') socket.emit('message', Buffer.from([3, 4]), true);
    emit(scenario === 'failed' ? 'task-failed' : 'task-finished', { output: {} });
    expect((await pending).usage_characters).toBe(expected);
  });
  it("WS 超时关闭连接，未推断位深、声道和时间戳基准", async () => {
    const q = await api(); const socket = new Socket();
    const r = await q.captureTask(socket, q.buildPlan().requests[0], "正文", "task-1", 5);
    expect(r.status).toBe("unknown"); expect(r.protocol_observations.pcm_layout).toBe("unverified");
    expect(socket.closed).toBe(true);
  });
  it.each([["--live"], ["--unexpected"]])("CLI 非法参数统一输出 JSON 错误 %j", async (...args) => {
    await api();
    let stderr = "";
    try { execFileSync(process.execPath, [resolve("node_modules/tsx/dist/cli.mjs"), entry, ...args], { encoding: "utf8", stdio: "pipe" }); }
    catch (error) { stderr = String((error as { stderr: string }).stderr); }
    expect(() => JSON.parse(stderr)).not.toThrow();
    expect(JSON.parse(stderr)).toMatchObject({ comparison_status: "incomplete" });
    expect(stderr).not.toContain("at parseArgs");
  });
  it("真实 CLI 默认 dry-run，与宿主付费环境变量无关", async () => {
    await api();
    const raw = execFileSync(process.execPath, [resolve("node_modules/tsx/dist/cli.mjs"), entry, "--dry-run"], { encoding: "utf8", env: { ...process.env, RUN_DASHSCOPE_TTS_LIVE_CHECK: "1", ALIYUN_DASHSCOPE_API_KEY: "must-not-be-read" } });
    const report = JSON.parse(raw); expect(report.actual_requests).toBe(0); expect(raw).not.toContain("must-not-be-read"); expect(raw).not.toContain("scriptText");
  });
});
