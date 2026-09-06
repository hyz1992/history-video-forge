/** 获明确授权的任务0输入方式对照：固定两次、单任务流、不接业务。 */
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import { buildPlan, captureTask, loadSampleTexts, type RequestRow, type CallResult } from './narration-provider-qualification.js';
import type manifestType from '../../samples/narration-timing/paragraph-diagnostic.json';
const hash=(x:string|Buffer)=>createHash('sha256').update(x).digest('hex');
const money=(n:number)=>Math.round(n*1e8)/1e8;
const FROZEN_HASH='5422f1365038411bc0db87e150fb13bb7f34142e1088a20f40b2539f54ce8b59';
const local=(p:string)=>fileURLToPath(new URL(p,import.meta.url));
const OUTPUT=local('./output/narration-paragraph-live-20260906');
export function loadDiagnosticManifest():typeof manifestType {return JSON.parse(readFileSync(local('../../samples/narration-timing/paragraph-diagnostic.json'),'utf8'));}
export function buildDiagnosticPlan(m=loadDiagnosticManifest()) {
  if(hash(JSON.stringify(m))!==FROZEN_HASH)throw Error('diagnostic_matrix_changed');
  const base=buildPlan();
  if(base.matrix_hash!==m.source_matrix_hash)throw Error('diagnostic_matrix_changed');
  return {...m,matrix_hash:FROZEN_HASH,endpoint:base.endpoint,parameters_version:base.parameters_version,
    requests:m.request_ids.map(id=>base.requests.find(r=>r.id===id)!)};
}
type Plan=ReturnType<typeof buildDiagnosticPlan>;
export function splitParagraphs(text:string) {
  if(!text.length)throw Error('text_empty');
  return text.match(/[^\n]*\n|[^\n]+$/g)!;
}
export function verifyFrozenText(text:string) {
  const p=buildDiagnosticPlan(),parts=splitParagraphs(text);let offset=0;
  const chunks=parts.map(s=>{const start=offset;offset+=s.length;return {start,end:offset,utf16_length:s.length,sha256:hash(s)};});
  if(hash(text)!==p.text_sha256||JSON.stringify(chunks)!==JSON.stringify(p.continue_messages))throw Error('diagnostic_text_changed');
  return parts;
}
export function verifyBaseline(bytes:Buffer) {
  const plan=buildDiagnosticPlan();
  if(hash(bytes)!==plan.baseline_report_sha256)throw Error('baseline_evidence_changed');
  const prior=JSON.parse(bytes.toString());
  const cost=money(prior.calls.reduce((s:number,c:any)=>s+c.result.usage_characters*c.request.price_cny_per_10k/10000,0));
  if(prior.actual_requests!==9||cost!==plan.baseline_usage_cost_cny)throw Error('baseline_evidence_changed');
  return cost;
}
function assertCap(cap:number) {
  const p=buildDiagnosticPlan();
  if(!Number.isFinite(cap)||cap<p.scheduling_reserve_cny||cap>p.max_cost_cny||money(cap+p.baseline_usage_cost_cny)>p.total_cap_cny)throw Error('diagnostic_limit_invalid');
}
interface Options {live:boolean;confirmLive?:boolean;maxRequests?:number;maxCostCny?:number;}
export function parseDiagnosticArgs(argv:string[]):Options {
  const o:Options={live:false},seen=new Set<string>();
  for(let i=0;i<argv.length;i++) {
    const f=argv[i];if(seen.has(f))throw Error('diagnostic_arguments_invalid');seen.add(f);
    if(f==='--live')o.live=true;
    else if(f==='--confirm-live')o.confirmLive=true;
    else if(f==='--dry-run'){}
    else if(f==='--max-requests'||f==='--max-cost-cny') {const v=argv[++i];if(!v||v.startsWith('--'))throw Error('diagnostic_arguments_invalid');if(f==='--max-requests')o.maxRequests=Number(v);else o.maxCostCny=Number(v);}
    else throw Error('diagnostic_arguments_invalid');
  }
  if(o.live) {if(!o.confirmLive||seen.has('--dry-run')||o.maxRequests!==2)throw Error('diagnostic_authorization_invalid');assertCap(o.maxCostCny!);}
  else if(o.confirmLive||o.maxRequests!==undefined||o.maxCostCny!==undefined)throw Error('diagnostic_authorization_invalid');
  return o;
}
interface Socket {on(event:string,listener:(...args:any[])=>void):unknown;send(text:string):unknown;close():unknown;terminate():unknown;}
export async function captureParagraphTask(socket:Socket,row:RequestRow,text:string,taskId:string,timeoutMs=180000) {
  const parts=splitParagraphs(text),startedAt=Date.now();
  const outbound:Array<{action:string;task_id:string;text_sha256?:string;utf16_length?:number;sent:boolean;elapsed_ms:number}>=[];
  const send=(message:any)=>{
    const text=message.payload.input?.text;
    const observation={action:message.header.action,task_id:message.header.task_id,...(typeof text==='string'?{text_sha256:hash(text),utf16_length:text.length}:{}),sent:false,elapsed_ms:Date.now()-startedAt};
    outbound.push(observation);socket.send(JSON.stringify(message));observation.sent=true;
  };
  // 仅替换本次诊断的出站正文；接收状态、PCM收集和累计usage沿用既有实现。
  const wrapper:Socket={on:(e,l)=>socket.on(e,l),close:()=>socket.close(),terminate:()=>socket.terminate(),send:(s)=>{
    const m=JSON.parse(s);
    if(m.header.action==='continue-task')for(const part of parts)send({...m,payload:{input:{text:part}}});
    else send(m);
  }};
  return {...await captureTask(wrapper,row,text,taskId,timeoutMs),outbound};
}
function emptyReport(plan:Plan) {
  return {schema_version:'narration_paragraph_diagnostic_report_v1',plan,actual_requests:0,
    actual_cost_cny:0 as number|null,accounted_cost_cny:0,total_usage_cost_cny:plan.baseline_usage_cost_cny as number|null,
    total_accounted_cost_cny:plan.baseline_usage_cost_cny,stopped_reason:null as string|null,
    qualification:'unverified' as const,comparison_status:'incomplete' as const,recommended_candidate:null,
    calls:[] as Array<{request:RequestRow;result:CallResult;accounted_cost_cny:number}>};
}
export async function executeDiagnostic(plan:Plan,cap:number,outputDir:string,transport:(row:RequestRow)=>Promise<CallResult>) {
  if(JSON.stringify(plan)!==JSON.stringify(buildDiagnosticPlan()))throw Error('diagnostic_matrix_changed');assertCap(cap);
  // CLI输出目录固定；独占创建失败即停止，重启与并发不会重新发出任何已记账调用。
  mkdirSync(outputDir);
  const report=emptyReport(plan);
  const save=()=>writeFileSync(resolve(outputDir,'report.json'),JSON.stringify(report,null,2)+'\n');
  const journal=(value:object)=>appendFileSync(resolve(outputDir,'attempts.jsonl'),JSON.stringify(value)+'\n');
  writeFileSync(resolve(outputDir,'plan.json'),JSON.stringify(plan,null,2)+'\n',{flag:'wx'});save();
  for(const row of plan.requests) {
    if(money(report.accounted_cost_cny+row.estimated_cost_cny*2)>cap){report.stopped_reason='cost_limit';break;}
    report.actual_requests++;journal({request_id:row.id,status:'dispatched_cost_unknown',at:new Date().toISOString()});
    let result:CallResult;
    try {result=await transport(row);}catch{result={status:'unknown'};}
    if(!result||!['succeeded','failed','unknown'].includes(result.status))result={status:'unknown'};
    const known=result.status==='succeeded'&&Number.isSafeInteger(result.usage_characters)&&result.usage_characters!>0;
    const cost=known?money(result.usage_characters!*row.price_cny_per_10k/10000):money(cap-report.accounted_cost_cny);
    report.accounted_cost_cny=money(report.accounted_cost_cny+cost);
    report.actual_cost_cny=known?report.accounted_cost_cny:null;
    report.total_usage_cost_cny=known?money(plan.baseline_usage_cost_cny+report.accounted_cost_cny):null;
    report.total_accounted_cost_cny=money(plan.baseline_usage_cost_cny+report.accounted_cost_cny);
    const safe:CallResult={status:result.status,usage_characters:known?result.usage_characters:null,request_id:result.request_id??null,audio_bytes:result.audio_bytes,audio_sha256:result.audio_sha256,elapsed_ms:result.elapsed_ms};
    report.calls.push({request:row,result:safe,accounted_cost_cny:cost});journal({...safe,provider_request_id:safe.request_id,request_id:row.id});
    if(!known)report.stopped_reason='unknown_cost';else if(report.accounted_cost_cny>=cap)report.stopped_reason=report.accounted_cost_cny>cap?'reported_cost_over_cap':'cost_limit';
    save();if(report.stopped_reason)break;
  }
  save();return report;
}
export async function runDiagnostic(options:Options) {
  const plan=buildDiagnosticPlan();if(!options.live)return emptyReport(plan);
  if(!options.confirmLive||options.maxRequests!==2)throw Error('diagnostic_authorization_invalid');assertCap(options.maxCostCny!);
  verifyBaseline(readFileSync(local('./output/narration-qualification-live-20260905-r1-continued/report.json')));
  const text=loadSampleTexts(local('./output/narration-qualification-offline-20260905/samples')).get('long')!;verifyFrozenText(text);
  const apiKey=process.env.ALIYUN_DASHSCOPE_API_KEY;if(!apiKey?.trim())throw Error('api_key_missing');
  const WebSocket=createRequire(import.meta.url)('ws') as new(url:string,options:object)=>Socket;
  return executeDiagnostic(plan,options.maxCostCny!,OUTPUT,async row=>{
    const taskId=randomUUID();
    const socket=new WebSocket(plan.endpoint,{headers:{Authorization:'Bearer '+apiKey},followRedirects:false,handshakeTimeout:15000,maxPayload:1024*1024});
    const result=await captureParagraphTask(socket,row,text,taskId);
    const name=row.id.replace(':','-');
    writeFileSync(resolve(OUTPUT,name+'.pcm'),result.pcm,{flag:'wx'});
    writeFileSync(resolve(OUTPUT,name+'.events.json'),JSON.stringify({task_id:taskId,events:result.events,observations:result.protocol_observations},null,2)+'\n',{flag:'wx'});
    writeFileSync(resolve(OUTPUT,name+'.outbound.json'),JSON.stringify(result.outbound,null,2)+'\n',{flag:'wx'});
    return result;
  });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  Promise.resolve().then(()=>runDiagnostic(parseDiagnosticArgs(process.argv.slice(2)))).then(r=>{process.stdout.write(JSON.stringify(r,null,2)+'\n');if(r.stopped_reason)process.exitCode=1;}).catch(e=>{process.stderr.write(JSON.stringify({error:e instanceof Error&&/^[a-z_]+$/.test(e.message)?e.message:'diagnostic_preflight_or_io_failed'})+'\n');process.exitCode=1;});
}
