import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const script = resolve(root, 'harness/scripts/runtime/narration-omni35-review.ts');
const matrixFile = resolve(root, 'harness/samples/narration-timing/omni35-review-matrix.json');
const digest = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const api = () => import('../../harness/scripts/runtime/narration-omni35-review.js');
const directories: string[] = [];
function directory() { const p = mkdtempSync(resolve(tmpdir(), 'omni35-test-')); directories.push(p); return p; }
afterEach(() => {
  for (const p of directories.splice(0)) {
    const absolute = resolve(p);
    if (!absolute.startsWith(resolve(tmpdir()) + sep) || !basename(absolute).startsWith('omni35-test-')) throw Error('unsafe cleanup');
    rmSync(absolute, { recursive: true, force: true });
  }
});
const review = { audio_processed: true, first_heard: '', last_heard: '', acceptable: false,
  scores: { naturalness: 2, coherence: 2, pronunciation: 2 }, issues: [{ severity: 'major', at_seconds: 136, heard: '连续声音突然循环卡顿', reason: '语流出现重复及异常中断' }], focused_checks: [], limitations: [] };
function wire(model: string, id = 'response-k', answer = JSON.stringify(review)) {
  const chunks = [
    { id, model, choices: [{ index: 0, delta: { content: answer.slice(0, 21) }, finish_reason: null }], usage: null },
    { id, model, choices: [{ index: 0, delta: { content: answer.slice(21) }, finish_reason: 'stop' }], usage: null },
    { id, model, choices: [], usage: { prompt_tokens_details: { audio_tokens: 100, text_tokens: 200 }, completion_tokens_details: { text_tokens: 300 }, completion_tokens: 300 } },
  ];
  return chunks.map(c => 'data: ' + JSON.stringify(c) + '\n\n').join('') + 'data: [DONE]\n\n';
}
async function capture(id = 'response-k') {
  const q = await api();
  return q.captureSse((async function* () { yield wire(q.loadPlan().model, id); })());
}
function output(base: string, mode = 'probe-live') {
  return resolve(base, mode === 'probe-live' ? 'narration-omni35-probe-live-20260906' : 'narration-omni35-samples-live-20260906');
}
async function adjudicate(base: string, mutate: (v: any) => void = () => {}) {
  const q = await api(); const plan = q.loadPlan();
  const bytes = readFileSync(resolve(output(base), 'sample-k/capture.json'));
  const v = { schema_version: 'narration_omni35_control_adjudication_v1', passed: true,
    capture_sha256: digest(bytes), plan_fingerprint: plan.plan_fingerprint, response_id: 'response-k',
    input_sha256: plan.requests[0].input_sha256, reason: '完整回答已独立审查', independent_review_ref: '本地独立审查记录' };
  mutate(v);
  writeFileSync(resolve(output(base), 'control-adjudication.json'), JSON.stringify(v));
}
describe('固定Omni3.5有限核验', () => {
  it('工具入口存在且默认与显式dry-run均零调用', async () => {
    expect(existsSync(script), '新入口应存在').toBe(true);
    for (const args of [[], ['--dry-run']]) {
      const run = spawnSync(process.execPath, ['--import', 'tsx', script, ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, ALIYUN_DASHSCOPE_API_KEY: '' } });
      expect(run.status, run.stderr).toBe(0);
      const result = JSON.parse(run.stdout);
      expect(result).toMatchObject({ actual_requests: 0, qualification: 'unverified' });
      expect(result.plan.requests.map((r: any) => r.id)).toEqual(['sample-k','sample-l','sample-m','sample-n']);
    }
  });
  it.each([
    ['--live'], ['--probe-live'], ['--probe-live','--confirm-live','--max-requests','2','--max-cost-cny','0.25'],
    ['--samples-live','--confirm-live','--max-requests','3','--max-cost-cny','0.66'],
    ['--dry-run','--output-dir','x'], ['--model','other'], ['--dry-run','--dry-run'],
    ['--probe-live','--confirm-live','--max-requests','1','--max-cost-cny','0.25','--enable-thinking'],
  ].map(args => [args]))('错误CLI参数零派发: %j', async args => { const q = await api(); expect(() => q.parseArgs(args)).toThrow(); });
  it('固定模型、端点、价格和保守逐行预算，匿名数据不泄漏正文或故障标签', async () => {
    const q = await api(), p = q.loadPlan();
    expect(p.model).toBe('qwen3.5-omni-plus-2026-03-15');
    expect(p.endpoint).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions');
    expect(p.parameters).toEqual({ stream: true, stream_options: { include_usage: true }, modalities: ['text'], max_tokens: 1200, temperature: 0 });
    expect(p.pricing).toMatchObject({ audio_input_cny_per_million:53,text_input_cny_per_million:7,text_output_cny_per_million:40 });
    const old = JSON.parse(readFileSync(resolve(root,'harness/samples/narration-timing/audio-review-matrix.json'),'utf8'));
    p.requests.forEach((r, i) => {
      expect(r.mp3_sha256).toBe(old.rows[[3,0,1,2][i]].mp3_sha256);
      const body = q.buildRequestBody(p, r, readFileSync(r.mp3_file));
      const external = JSON.stringify(body.messages);
      expect(external).not.toContain('local_acoustic_negative_control');
      expect(external).not.toContain('qwen-yimuling');
      expect(external).not.toContain(readFileSync(r.source_file,'utf8'));
      const tokens = Buffer.byteLength(p.prompt_body + JSON.stringify({ sample_id:r.id,kind:r.kind,focus:r.focus }),'utf8') + 1024;
      expect(r.estimated_cost_cny).toBeCloseTo((Math.ceil(r.duration_ms/1000)*7*53+tokens*7+1200*40)/1e6,9);
    });
    expect(p.requests[0].estimated_cost_cny).toBeLessThanOrEqual(.25);
    expect(p.requests.reduce((s,r)=>s+r.estimated_cost_cny,0)).toBeLessThanOrEqual(.65);
    expect(p.budget.baseline_cny+.65).toBeLessThanOrEqual(5);
  });
  it.each(['matrix','prompt','wav','mp3','source'])('冻结输入改变零派发零目录: %s', async kind => {
    const q = await api(), p=q.loadPlan(), base=directory();
    const file = kind==='matrix'?matrixFile:kind==='prompt'?p.prompt_file:p.requests[0][(kind+'_file') as 'wav_file'];
    const dispatcher=vi.fn(async()=>capture());
    await expect(q.executeReview(p,'probe-live',dispatcher,{outputRoot:base,readFile:f=>f===file?Buffer.from('changed'):readFileSync(f)})).rejects.toThrow();
    expect(dispatcher).not.toHaveBeenCalled(); expect(existsSync(output(base))).toBe(false);
  });
  it.each(['model','endpoint','parameters','pricing','budget','fingerprint','row','added'])('计划参数改变零派发: %s', async field => {
    const q=await api(),p=q.loadPlan(),base=directory(),d=vi.fn(async()=>capture());
    if(field==='parameters') (p.parameters as any).enable_thinking=false;
    else if(field==='pricing') p.pricing.audio_input_cny_per_million=0;
    else if(field==='budget') p.budget.task_cap_cny=9;
    else if(field==='row') p.requests[0].focus='变更';
    else if(field==='fingerprint') p.plan_fingerprint='0'.repeat(64);
    else (p as any)[field]='changed';
    await expect(q.executeReview(p,'probe-live',d,{outputRoot:base})).rejects.toThrow();
    expect(d).not.toHaveBeenCalled(); expect(existsSync(output(base))).toBe(false);
  });
  it('probe只发K且先保存intent，既有目录及并发调用拒绝', async () => {
    const q=await api(),p=q.loadPlan(),base=directory();
    const d=vi.fn(async row=>{
      expect(row.id).toBe('sample-k');
      expect(JSON.parse(readFileSync(resolve(output(base),'sample-k/dispatch-intent.json'),'utf8'))).toMatchObject({ id:'sample-k',input_sha256:row.input_sha256,plan_fingerprint:p.plan_fingerprint,max_requests:1,max_cost_cny:.25 });
      return capture();
    });
    const runs=await Promise.allSettled([q.executeReview(p,'probe-live',d,{outputRoot:base}),q.executeReview(p,'probe-live',d,{outputRoot:base})]);
    expect(runs.filter(r=>r.status==='fulfilled')).toHaveLength(1); expect(d).toHaveBeenCalledTimes(1);
    await expect(q.executeReview(p,'probe-live',d,{outputRoot:base})).rejects.toThrow('omni35_output_exists');
    const result=JSON.parse(readFileSync(resolve(output(base),'result.json'),'utf8'));
    expect(result).toMatchObject({ actual_requests:1,previous_requests:0,total_requests:1,actual_cost_cny:.0187,qualification:'unverified' });
  });
  it.each(['absent','false','capture','input','id','fingerprint','reason','independent','extra','schema','forged-usage','chunk-id','text','missing-done','intent'])('无效裁决/前缀在建样本目录前拒绝: %s', async mode => {
    const q=await api(),p=q.loadPlan(),base=directory();
    await q.executeReview(p,'probe-live',()=>capture(),{outputRoot:base});
    const cf=resolve(output(base),'sample-k/capture.json');
    if(['forged-usage','chunk-id','text','missing-done'].includes(mode)) {
      const c=JSON.parse(readFileSync(cf,'utf8'));
      if(mode==='forged-usage') c.usage.audio_input_tokens=1;
      if(mode==='chunk-id') c.raw_chunks[0].id='forged';
      if(mode==='text') c.full_text='forged';
      if(mode==='missing-done') c.raw_events.pop();
      writeFileSync(cf,JSON.stringify(c));
    }
    if(mode==='intent') {
      const f=resolve(output(base),'sample-k/dispatch-intent.json');const v=JSON.parse(readFileSync(f,'utf8'));v.input_sha256='0'.repeat(64);writeFileSync(f,JSON.stringify(v));
    }
    if(mode!=='absent') await adjudicate(base,v=>{
      if(mode==='false')v.passed=false; if(mode==='capture')v.capture_sha256='0'.repeat(64);
      if(mode==='input')v.input_sha256='0'.repeat(64);if(mode==='id')v.response_id='other';
      if(mode==='fingerprint')v.plan_fingerprint='0'.repeat(64);if(mode==='reason')v.reason=' ';
      if(mode==='independent')v.independent_review_ref='';if(mode==='extra')v.cost_cny=0;if(mode==='schema')v.schema_version='other';
    });
    const d=vi.fn(async()=>capture());
    await expect(q.executeReview(p,'samples-live',d,{outputRoot:base})).rejects.toThrow();
    expect(d).not.toHaveBeenCalled();expect(existsSync(output(base,'samples-live'))).toBe(false);
  });
  it('裁决通过后仅发L/M/N，前缀费用只计算一次', async () => {
    const q=await api(),p=q.loadPlan(),base=directory();
    await q.executeReview(p,'probe-live',()=>capture(),{outputRoot:base});await adjudicate(base);
    const seen:string[]=[];
    const result=await q.executeReview(p,'samples-live',r=>{seen.push(r.id);return capture('response-'+r.id);},{outputRoot:base});
    expect(seen).toEqual(['sample-l','sample-m','sample-n']);
    expect(result).toMatchObject({ previous_requests:1,actual_requests:3,total_requests:4,previous_cost_cny:.0187,actual_cost_cny:.0748,accounted_cost_cny:.0748,total_accounted_cost_cny:3.0769288,qualification:'unverified' });
  });
  it('未知失败占整组预算且不重试、不执行后续', async () => {
    const q=await api(),p=q.loadPlan(),base=directory();
    await q.executeReview(p,'probe-live',()=>capture(),{outputRoot:base});await adjudicate(base);
    const d=vi.fn(async()=>{throw Error('secret-socket-detail');});
    const r=await q.executeReview(p,'samples-live',d,{outputRoot:base});
    expect(d).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({actual_requests:1,total_requests:2,actual_cost_cny:null,accounted_cost_cny:.65,total_accounted_cost_cny:3.6521288});
    expect(JSON.stringify(r)).not.toContain('secret-socket-detail');
  });
  it('每次派发前复核计划和所有文件，后续输入改变立即停止', async () => {
    const q=await api(),p=q.loadPlan(),base=directory();
    await q.executeReview(p,'probe-live',()=>capture(),{outputRoot:base});await adjudicate(base);
    let changed=false;
    const d=vi.fn(async(r)=>{changed=true;return capture('response-'+r.id);});
    const result=await q.executeReview(p,'samples-live',d,{outputRoot:base,readFile:f=>changed&&f===p.requests[3].source_file?Buffer.from('changed'):readFileSync(f)});
    expect(d).toHaveBeenCalledTimes(1);expect(result.stopped_reason).toBe('frozen_input_changed_before_dispatch');
  });
  it('完整有序SSE包含DONE且跨字节分块可重构，错误响应秘密被脱敏', async () => {
    const q=await api(),p=q.loadPlan();
    const b=Buffer.from(wire(p.model));
    const c=await q.captureSse((async function*(){for(let i=0;i<b.length;i+=13)yield b.subarray(i,i+13);})());
    expect(c.status).toBe('succeeded');expect(c.raw_events.at(-1)).toBe('data: [DONE]');
    expect(c.raw_chunks).toHaveLength(3);expect(c.full_text).toBe(JSON.stringify(review));
    const error='data: '+JSON.stringify({id:'failure',model:p.model,error:{api_key:'private-key',message:'Bearer private-key data:;base64,QUJDREVG'},choices:[]})+'\n\ndata: [DONE]\n\n';
    const failed=await q.captureSse((async function*(){yield error;throw Error('raw-secret');})(),'private-key');
    expect(failed.status).toBe('failed');
    expect(JSON.stringify(failed)).not.toContain('private-key');expect(JSON.stringify(failed)).not.toContain('QUJDREVG');expect(JSON.stringify(failed)).not.toContain('raw-secret');
    expect(failed.raw_events).toHaveLength(2);
  });

  it.each(['acceptable-true','no-major','outside-location','null-location'])('故障样本结构前提未满足时裁决也不能放行: %s', async mode => {
    const q=await api(),p=q.loadPlan(),base=directory();
    const wrong={...review,issues:[...review.issues]};
    if(mode==='acceptable-true')wrong.acceptable=true;
    if(mode==='no-major')wrong.issues=[];
    if(mode==='outside-location')wrong.issues=[{...review.issues[0],at_seconds:200}];
    if(mode==='null-location')wrong.issues=[{...review.issues[0],at_seconds:null as unknown as number}];
    const response=await q.captureSse((async function*(){yield wire(p.model,'response-k',JSON.stringify(wrong));})());
    await q.executeReview(p,'probe-live',async()=>response,{outputRoot:base});
    await adjudicate(base);
    const d=vi.fn(async()=>capture());
    await expect(q.executeReview(p,'samples-live',d,{outputRoot:base})).rejects.toThrow('omni35_control_evidence_invalid');
    expect(d).not.toHaveBeenCalled();expect(existsSync(output(base,'samples-live'))).toBe(false);
  });
  it('仅回答格式失败但最终usage完整时按实核销并停止后续', async () => {
    const q=await api(),p=q.loadPlan(),base=directory();
    await q.executeReview(p,'probe-live',()=>capture(),{outputRoot:base});await adjudicate(base);
    const malformed=await q.captureSse((async function*(){yield wire(p.model,'response-l','这次没有按JSON返回');})());
    expect(malformed.status).toBe('failed');
    const d=vi.fn(async()=>malformed);
    const r=await q.executeReview(p,'samples-live',d,{outputRoot:base});
    expect(d).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ actual_requests:1,actual_cost_cny:.0374,accounted_cost_cny:.0374,stopped_reason:'response_failed_with_verified_usage' });
  });
  it.each(['missing-done','duplicate-done','identity','oversize'])('不完整流不允许伪造成可核销前缀: %s', async mode => {
    const q=await api(),p=q.loadPlan();
    let text=wire(p.model);
    if(mode==='missing-done')text=text.replace('data: [DONE]','');
    if(mode==='duplicate-done')text+='data: [DONE]\n\n';
    if(mode==='identity')text=text.replace('"response-k"','"other-id"');
    if(mode==='oversize')text+='x'.repeat(5_000_001);
    const c=await q.captureSse((async function*(){yield text;})());
    expect(c.status).toBe('failed');
    expect(Buffer.byteLength(c.raw_events.join('\n\n'),'utf8')).toBeLessThanOrEqual(5_000_000);
  });


  it.each(['missing-usage','interrupted-after-done'])('缺用量或断流时保持未知并占整组预留: %s', async mode => {
    const q=await api(),p=q.loadPlan(),base=directory();
    let text=wire(p.model);
    if(mode==='missing-usage')text=text.split('\n\n').filter(e=>!e.includes('prompt_tokens_details')).join('\n\n');
    const c=await q.captureSse((async function*(){yield text;if(mode==='interrupted-after-done')throw Error('hidden-socket-error');})());
    const d=vi.fn(async()=>c);
    const r=await q.executeReview(p,'probe-live',d,{outputRoot:base});
    expect(c.status).toBe('failed');expect(d).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({actual_requests:1,actual_cost_cny:null,accounted_cost_cny:.65});
    expect(JSON.stringify(c)).not.toContain('hidden-socket-error');
  });

  it('HTTP固定POST/端点/超时/禁止重定向，仅一次请求', async () => {
    const q=await api(),p=q.loadPlan();
    const f=vi.fn(async(url,init)=>{
      expect(url).toBe(p.endpoint);expect(init.method).toBe('POST');expect(init.redirect).toBe('error');expect(init.signal).toBeInstanceOf(AbortSignal);
      const body=JSON.parse(init.body);expect(body.model).toBe(p.model);expect(body.max_tokens).toBe(1200);
      expect(body).not.toHaveProperty('enable_thinking');expect(body).not.toHaveProperty('enable_search');
      return new Response(wire(p.model));
    });
    expect((await q.dispatchReview(p,p.requests[0],'private-key',f)).status).toBe('succeeded');expect(f).toHaveBeenCalledTimes(1);
    const bad=vi.fn(async()=>new Response(JSON.stringify({api_key:'private-key',code:'BadRequest'}),{status:400}));
    const c=await q.dispatchReview(p,p.requests[0],'private-key',bad);
    expect(c.status).toBe('failed');expect(JSON.stringify(c)).toContain('BadRequest');expect(JSON.stringify(c)).not.toContain('private-key');expect(bad).toHaveBeenCalledTimes(1);
  });
  it.each(['invalid-json-interrupted','invalid-json-oversize'])('不完整流与JSON失败组合仍为未知费用: %s',async mode=>{
    const q=await api(),p=q.loadPlan(),base=directory();
    const events=[{id:'response-k',model:p.model,choices:[{delta:{content:'not-json'},finish_reason:'stop'}]},
      {id:'response-k',model:p.model,choices:[],usage:{prompt_tokens_details:{audio_tokens:100,text_tokens:200},completion_tokens:300}}];
    const text=events.map(e=>'data: '+JSON.stringify(e)+'\n\n').join('')+'data: [DONE]\n\n';
    const c=await q.captureSse((async function*(){yield text;if(mode.endsWith('oversize'))yield ' '.repeat(5_000_001);else throw Error('broken-wire');})());
    const d=vi.fn(async()=>c);const result=await q.executeReview(p,'probe-live',d,{outputRoot:base});
    expect(result).toMatchObject({actual_requests:1,actual_cost_cny:null,accounted_cost_cny:.65});expect(d).toHaveBeenCalledTimes(1);
  });
  it.each(['null','choices'])('畸形事件不丢失已收响应: %s',async mode=>{
    const q=await api(),p=q.loadPlan();
    const prefix={id:'bad-response',model:p.model,choices:[]};
    const malformed=mode==='null'?null:{...prefix,choices:'invalid'};
    const wireText=wire(p.model,'bad-response').replace('data: [DONE]\n\n','')+'data: '+JSON.stringify(malformed)+'\n\ndata: [DONE]\n\n';
    const d=vi.fn(async()=>new Response(wireText));const c=await q.dispatchReview(p,p.requests[0],'unused-key',d);
    expect(c.status).toBe('failed');expect(c.raw_events).toHaveLength(5);expect(c.raw_events[0]).toContain('bad-response');
    expect(c.raw_events[3]).toContain(mode==='null'?'null':'invalid');expect(d).toHaveBeenCalledTimes(1);
  });
  it.each(['capture.json','full-text.txt','result.json'])('付费后%s写失败仍有完整保守占额',async target=>{
    const q=await api(),p=q.loadPlan(),base=directory();let posted=0;var writeError=Object.assign(Error('disk_full'),{code:'ENOSPC'});
    const writer=(file:string,data:string,options:{flag:'wx'})=>{if(file.endsWith(target)){expect(posted).toBe(1);throw writeError;}writeFileSync(file,data,options);};
    const d=vi.fn(async()=>{posted++;return capture();});
    await expect(q.executeReview(p,'probe-live',d,{outputRoot:base,writeFile:writer} as any)).rejects.toBe(writeError);
    expect(d).toHaveBeenCalledTimes(1);
    const pending=JSON.parse(readFileSync(resolve(output(base),'pending-accounting.json'),'utf8'));
    expect(pending).toMatchObject({status:'pending_evidence',actual_cost_cny:null,accounted_cost_cny:.65,total_accounted_cost_cny:3.6521288,qualification:'unverified'});
    await expect(q.executeReview(p,'probe-live',d,{outputRoot:base})).rejects.toThrow('omni35_output_exists');expect(d).toHaveBeenCalledTimes(1);
  });

  it.each(['说明原文', ['第一条', '第二条']].map(value=>[value]))('观察解释兼容而原值不变: %j', async limitations => {
    const q=await api();const answer={...review,limitations};
    expect(q.decodeObservation(JSON.stringify(answer))).toEqual(answer);
  });
  it.each([null, 17, [17], {text:'不可推断'}, undefined].map(value=>[value]))('观察解释非法类型不兼容: %j',async limitations=>{
    const q=await api();expect(()=>q.decodeObservation(JSON.stringify({...review,limitations}))).toThrow('audio_review_output_invalid');
  });
  it.each(['score','extra','missing'])('字符串解释不放宽其余合同: %s',async kind=>{
    const q=await api();const v:any={...review,limitations:'原文'};
    if(kind==='score')v.scores={...review.scores,naturalness:99};if(kind==='extra')v.extra=true;if(kind==='missing')delete v.issues;
    expect(()=>q.decodeObservation(JSON.stringify(v))).toThrow('audio_review_output_invalid');
  });
  it('旧K结构失败原件可复核观察，正常字符串回答继续且不重发K',async()=>{
    const q=await api(),p=q.loadPlan(),base=directory();
    const k=await q.captureSse((async function*(){yield wire(p.model,'response-k',JSON.stringify({...review,limitations:'无法确定故障来源'}));})());
    expect(k.status).toBe('failed');expect(k.review).toBeNull();
    await q.executeReview(p,'probe-live',async()=>k,{outputRoot:base});
    const file=resolve(output(base),'sample-k/capture.json'),bytes=readFileSync(file);
    await adjudicate(base);const seen:string[]=[];
    const result=await q.executeReview(p,'samples-live',async r=>{seen.push(r.id);return q.captureSse((async function*(){yield wire(p.model,'response-'+r.id,JSON.stringify({...review,acceptable:true,issues:[],limitations:'语气未测'}));})());},{outputRoot:base});
    expect(seen).toEqual(['sample-l','sample-m','sample-n']);expect(readFileSync(file)).toEqual(bytes);
    expect(result).toMatchObject({actual_requests:3,previous_requests:1,actual_cost_cny:.0748});
    expect(result.calls.every(c=>c.status==='failed'&&c.observation_status==='valid')).toBe(true);
  });
  it.each(['interrupted','missing-done','http'])('字符串观察不绕过完整性或HTTP故障: %s',async mode=>{
    const q=await api(),p=q.loadPlan(),base=directory();
    var text=wire(p.model,'response-k',JSON.stringify({...review,limitations:'原文'}));if(mode==='missing-done')text=text.replace('data: [DONE]','');
    var c=await q.captureSse((async function*(){yield text;if(mode==='interrupted')throw Error('socket');})());
    if(mode==='http'){const f=vi.fn(async()=>new Response(text,{status:400}));c=await q.dispatchReview(p,p.requests[0],'fixture-key',f);expect(f).toHaveBeenCalledTimes(1);expect(c.error).toBe('response_http_error');}
    const result=await q.executeReview(p,'probe-live',async()=>c,{outputRoot:base});expect(result.calls[0].observation_status).toBe('invalid');
    await adjudicate(base);const d=vi.fn(async()=>capture());await expect(q.executeReview(p,'samples-live',d,{outputRoot:base})).rejects.toThrow();expect(d).not.toHaveBeenCalled();
  });

  it.each(['score','at_seconds'])('字符串解释不得把溢出数值改为null: %s',async field=>{
    const q=await api();let text=JSON.stringify({...review,limitations:'原文'});
    text=field==='score'?text.replace('"naturalness":2','"naturalness":1e400'):text.replace('"at_seconds":136','"at_seconds":1e400');
    expect(text).toContain('1e400');expect(()=>q.decodeObservation(text)).toThrow('audio_review_output_invalid');
  });
  it.each(['valid','invalid'])('围栏与字符串解释正交校验: %s',async mode=>{
    const q=await api();const v={...review,limitations:'说明保留'};if(mode==='invalid')v.scores={...review.scores,naturalness:99};
    const wrapped=String.fromCharCode(96).repeat(3)+'json\n'+JSON.stringify(v)+'\n'+String.fromCharCode(96).repeat(3);
    if(mode==='valid')expect(q.decodeObservation(wrapped)).toEqual(v);else expect(()=>q.decodeObservation(wrapped)).toThrow('audio_review_output_invalid');
  });

});
