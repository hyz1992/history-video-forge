import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
async function api() {
  expect(existsSync('harness/scripts/runtime/narration-boundary-review.ts'), '离线人工边界核验入口存在').toBe(true);
  return import('../../harness/scripts/runtime/narration-boundary-review.js');
}
function input() {
 const sourceText=Array.from({length:80},(_,i)=>String.fromCodePoint(0x4e00+i)).join('');
 const words=Array.from(sourceText,(text,i)=>({text,begin_index:i,end_index:i+1,begin_time:1000+i*1000,end_time:1500+i*1000}));
 words[12].end_time=words[12].begin_time;
 const pcm=Buffer.alloc(82000*48);
 const json=(event:string,payload={})=>({kind:'json',elapsed_ms:1,data:{header:{task_id:'fixture',event},payload}});
 return {identity:{candidate_id:'fixture',model:'fixture-model',voice:'fixture-voice',region:'fixture',protocol:'fixture',input_mode:'fixture',parameters_version:'fixture',parameters:{}},sourceText,pcm,capture:{task_id:'fixture',events:[json('task-started'),json('result-generated',{output:{type:'sentence-begin',sentence:{index:0}}}),{kind:'audio',elapsed_ms:1,byte_offset:0,byte_length:pcm.length},json('result-generated',{output:{type:'sentence-end',sentence:{index:0,words},original_text:sourceText}}),json('task-finished'),{kind:'terminal',elapsed_ms:1,data:'task-finished'}]}};
}
async function setup() {const q=await api();const c=q.makeBoundaryCase(input());const form=q.createReviewForm([c]);return {q,c,form};}
function measured(c:any,form:any,errors:number[]=[]) {
 for(const [i,row] of form.cases[0].rows.entries()) {row.status='measured';row.measured_ms=c.rows.find((r:any)=>r.id===row.id).native_ms+(errors[i]??0);row.reviewer='测试夹具';}
 return form;
}
describe('离线人工发声起点核验',()=>{
 it('固定覆盖首尾与正文异常，空表无预填答案且不宣称完成',async()=>{
  const {q,c,form}=await setup();expect(c.rows).toHaveLength(30);expect(new Set(c.rows.map(r=>r.id)).size).toBe(30);
  expect(c.rows.map(r=>r.token_ordinal)).toEqual(expect.arrayContaining([0,12,79]));
  expect(form.cases[0].rows.every(r=>r.measured_ms===null&&!('native_ms' in r))).toBe(true);
  expect(q.evaluateReview([c],form).cases[0]).toMatchObject({manual_onset_count:0,status:'pending',p95_ms:null,max_ms:null});
 });
 it('完整实测采用nearest-rank并保留结构问题，不授予模型资格',async()=>{
  const {q,c,form}=await setup();const errors=Array.from({length:30},(_,i)=>i<28?100:i===28?200:500);
  const result=q.evaluateReview([c],measured(c,form,errors));expect(result).toMatchObject({actual_requests:0,qualification:'unverified'});
  expect(result.cases[0]).toMatchObject({status:'within_target',manual_onset_count:30,p95_ms:200,max_ms:500});
  expect(result.cases[0].structural_issues).toContain('token_duration_invalid:12');
 });
 it.each(['p95','maximum'])('超标 %s 不通过',async kind=>{
  const {q,c,form}=await setup();const errors=Array(30).fill(0);if(kind==='p95'){errors[28]=201;errors[29]=201;}else errors[29]=501;
  expect(q.evaluateReview([c],measured(c,form,errors)).cases[0].status).toBe('outside_target');
 });
 it.each(['missing','duplicate','extra','changed-text','changed-id','changed-audio-binding','unknown-field'])('拒绝变更固定抽样或证据 %s',async kind=>{
  const {q,c,form}=await setup();const f:any=measured(c,form);const rows=f.cases[0].rows;
  if(kind==='missing')rows.pop();if(kind==='duplicate')rows[1]=rows[0];if(kind==='extra')rows.push(rows[0]);
  if(kind==='changed-text')rows[0].token_text='替换';if(kind==='changed-id')rows[0].id='替换';
  if(kind==='changed-audio-binding')f.cases[0].evidence_id='0'.repeat(64);if(kind==='unknown-field')rows[0].absolute_error_ms=0;
  expect(()=>q.evaluateReview([c],f)).toThrow('review_form_invalid');
 });
 it.each([null,'0',-1,1.5,Number.NaN,Number.POSITIVE_INFINITY,Number.MAX_SAFE_INTEGER,83000])('拒绝非法人工时间 %s',async value=>{
  const {q,c,form}=await setup();const f:any=measured(c,form);f.cases[0].rows[0].measured_ms=value;
  expect(()=>q.evaluateReview([c],f)).toThrow('review_measurement_invalid');
 });
 it.each(['blank-reviewer','duplicate-time','reverse-time','unreviewed-with-time','unknown-status'])('拒绝矛盾或伪计数测量 %s',async kind=>{
  const {q,c,form}=await setup();const f:any=measured(c,form);const rows=f.cases[0].rows;
  if(kind==='blank-reviewer')rows[0].reviewer=' ';if(kind==='duplicate-time')rows[1].measured_ms=rows[0].measured_ms;
  if(kind==='reverse-time')rows[1].measured_ms=rows[0].measured_ms-1;if(kind==='unreviewed-with-time')rows[0].status='unreviewed';
  if(kind==='unknown-status')rows[0].status='passed';expect(()=>q.evaluateReview([c],f)).toThrow('review_measurement_invalid');
 });
 it.each(['inaudible','uncertain'])('不可测 %s 保留缺口且不计算达标统计',async status=>{
  const {q,c,form}=await setup();const f:any=measured(c,form);Object.assign(f.cases[0].rows[1],{status,measured_ms:null,note:'夹具：此词无法可靠定位'});
  expect(q.evaluateReview([c],f).cases[0]).toMatchObject({status:status==='inaudible'?'audio_issue':'pending',manual_onset_count:29,p95_ms:null,max_ms:null});
 });
 it('不改变原件、原生值或输入表；候选重排仍各自绑定证据',async()=>{
  const {q,c,form}=await setup();const x=input();x.identity.candidate_id='fixture-2';const c2=q.makeBoundaryCase(x);
  const before=JSON.stringify([c,c2]);const f=q.createReviewForm([c,c2]);f.cases.reverse();q.evaluateReview([c,c2],f);expect(JSON.stringify([c,c2])).toBe(before);
  const filled=measured(c,form);const prior=JSON.stringify(filled);q.evaluateReview([c],filled);expect(JSON.stringify(filled)).toBe(prior);
 });
 it('缺少不同发声点时不重复填满30个',async()=>{
  const q=await api();const x=input();const end:any=x.capture.events[3];end.data.payload.output.sentence.words=end.data.payload.output.sentence.words.slice(0,29);
  expect(()=>q.makeBoundaryCase(x)).toThrow('review_sample_insufficient');
 });
 it('写入可填写材料并拒绝覆盖已有人工作业',async()=>{
  const {q,c}=await setup();const parent=mkdtempSync(join(tmpdir(),'narration-boundary-'));
  try {
   const out=join(parent,'review');q.writeReviewPack(out,[c]);
   const path=join(out,'review.json');const f=JSON.parse(readFileSync(path,'utf8'));measured(c,f);writeFileSync(path,JSON.stringify(f));
   expect(()=>q.writeReviewPack(out,[c])).toThrow();expect(q.evaluateReview([c],JSON.parse(readFileSync(path,'utf8'))).cases[0].manual_onset_count).toBe(30);
   expect(readFileSync(join(out,'README.md'),'utf8')).toContain('相对完整音频的整数毫秒');
  } finally {if(dirname(resolve(parent))!==resolve(tmpdir()))throw Error('fixture_path_invalid');rmSync(parent,{recursive:true});}
 });
 it('原件损坏在准备/评估前拒绝，不读成新的基准',async()=>{
  const q=await api();expect(()=>q.loadReviewCases(()=>Buffer.from('changed'))).toThrow('review_evidence_changed');
 });
 it('原件或组合变化使旧人工表失效；提前的边界也按绝对误差统计',async()=>{
  const {q,c,form}=await setup();const f=measured(c,form,Array(30).fill(-201));
  expect(q.evaluateReview([c],f).cases[0]).toMatchObject({status:'outside_target',p95_ms:201,max_ms:201});
  const x=input();x.identity.voice='another-voice';expect(()=>q.evaluateReview([q.makeBoundaryCase(x)],f)).toThrow('review_form_invalid');
  const y=input();y.pcm[0]=1;expect(()=>q.evaluateReview([q.makeBoundaryCase(y)],f)).toThrow('review_form_invalid');
 });
 it('少一个候选、重复候选或剩一个未测均不产生完整统计',async()=>{
  const {q,c,form}=await setup();const f=measured(c,form);Object.assign(f.cases[0].rows[0],{status:'unreviewed',measured_ms:null});
  expect(q.evaluateReview([c],f).cases[0]).toMatchObject({manual_onset_count:29,status:'pending',p95_ms:null,max_ms:null});
  expect(()=>q.evaluateReview([c],{schema_version:f.schema_version,cases:[]})).toThrow('review_form_invalid');
  expect(()=>q.evaluateReview([c],{schema_version:f.schema_version,cases:[f.cases[0],f.cases[0]]})).toThrow('review_form_invalid');
 });
 it('CLI默认零请求，拒绝live',async()=>{
  await api();const cli=['node_modules/tsx/dist/cli.mjs','harness/scripts/runtime/narration-boundary-review.ts'];
  expect(JSON.parse(execFileSync(process.execPath,cli,{encoding:'utf8'})).actual_requests).toBe(0);
  expect(()=>execFileSync(process.execPath,[...cli,'--live'],{stdio:'pipe'})).toThrow();
  // 原始付费媒体是本机可选证据，不纳入默认测试依赖；真实prepare/evaluate另显式记录。
 });
});
