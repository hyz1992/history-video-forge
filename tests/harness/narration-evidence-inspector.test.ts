import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

async function api() {
  expect(existsSync('harness/scripts/runtime/narration-evidence-inspector.ts'), '独立离线证据检查入口必须存在').toBe(true);
  return import('../../harness/scripts/runtime/narration-evidence-inspector.js');
}
const hash=(x:string|Buffer)=>createHash('sha256').update(x).digest('hex');
const token=(text:string,index:number,start:number,end:number)=>({text,begin_index:index,end_index:index+1,begin_time:start,end_time:end});
function fixture(words:any[], source='甲乙', pcm=Buffer.alloc(48000)) {
  const json=(event:string,payload={})=>({kind:'json',elapsed_ms:1,data:{header:{task_id:'t',event},payload}});
  return {sourceText:source,pcm,sourceSha256:hash(source),audioSha256:hash(pcm),capture:{task_id:'t',events:[json('task-started'),json('result-generated',{output:{type:'sentence-begin',sentence:{index:0}}}),{kind:'audio',elapsed_ms:1,byte_offset:0,byte_length:pcm.length},json('result-generated',{output:{type:'sentence-end',sentence:{index:0,words},original_text:source},usage:{characters:4}}),json('task-finished'),{kind:'terminal',elapsed_ms:1,data:'task-finished'}]}};
}
describe('口播原始证据离线诊断',()=>{
 it('CLI 无参数只显示离线用法，拒绝 live 标志',async()=>{
  await api();const args=['node_modules/tsx/dist/cli.mjs','harness/scripts/runtime/narration-evidence-inspector.ts'];
  expect(JSON.parse(execFileSync(process.execPath,args,{encoding:'utf8'})).actual_requests).toBe(0);
  let failed=false;try{execFileSync(process.execPath,[...args,'--live'],{encoding:'utf8',stdio:'pipe'});}catch(e){failed=true;expect(JSON.parse(String((e as any).stderr)).error).toBe('offline_arguments_invalid');}
  expect(failed).toBe(true);
 });
 it('检查媒体帧与源摘要，结构有效仍不能宣布人工资格通过',async()=>{
  const q=await api();const r=q.inspectEvidence(fixture([token('甲',0,0,100),token('乙',1,200,400)]));
  expect(r.integrity).toBe('verified');expect(r.text_mapping.status).toBe('exact');
  expect(r.qualification).toBe('unverified');expect(r.manual_boundary_count).toBe(0);
  expect(r.sentences[0].audio_bytes).toBe(48000);expect(r.duration_ms).toBe(1000);
 });
 it('声明式规范化把十二的两个 token 绑定同一正文范围',async()=>{
  const q=await api();const words=[token('第',0,0,100),token('十',1,100,200),token('二',2,200,300),token('次',3,300,400)];
  const r=q.mapObservedText('第12次',words,[{start:1,end:3,expected:'12',spoken:'十二'}]);
  expect(r.status).toBe('declared_normalization');expect(r.tokens.map(t=>[t.source_start,t.source_end])).toEqual([[0,1],[1,3],[1,3],[3,4]]);
  expect(r.legal_source_cuts).toEqual([0,1,3,4]);expect(r.normalization_review).toBe('unverified');
 });
 it('重复句严格顺序消费，代理对与组合字符内部不产生合法切点',async()=>{
  const q=await api();const words=[token('𠮷',0,0,100),token('e',1,100,200),token('́',2,200,300),token('。',3,300,400),token('𠮷',4,400,500)];
  const r=q.mapObservedText('𠮷é。𠮷',words,[]);
  expect(r.tokens.map(t=>[t.source_start,t.source_end])).toEqual([[0,2],[2,4],[2,4],[4,5],[5,7]]);
  expect(r.legal_source_cuts).toEqual([0,2,4,5,7]);
 });
 it('只有显式登记的换行删除允许完整映射，不自动吞正文和标点',async()=>{
  const q=await api();const w=[token('甲',0,0,100),token('乙',1,200,300)];
  expect(q.mapObservedText('甲\n乙',w,[]).status).toBe('mismatch');
  const r=q.mapObservedText('甲\n乙',w,[{start:1,end:2,expected:'\n',spoken:''}]);
  expect(r.status).toBe('declared_normalization');expect(r.silent_source_spans).toEqual([{start:1,end:2}]);
  expect(q.mapObservedText('甲丙乙',w,[]).status).toBe('mismatch');
 });
 it.each(['overlap','wrong-source','surrogate-split'])('拒绝错误规范化声明 %s',async scenario=>{
  const q=await api();const patches=scenario==='overlap'?[{start:0,end:2,expected:'𠮷',spoken:'吉'},{start:1,end:2,expected:'x',spoken:'x'}]:scenario==='wrong-source'?[{start:0,end:2,expected:'其他',spoken:'吉'}]:[{start:0,end:1,expected:'\ud842',spoken:'吉'}];
  expect(()=>q.mapObservedText('𠮷',[],patches)).toThrow('normalization_invalid');
 });
 it('检测原始边界的整段等分公式，但不篡改时间或自动判音质',async()=>{
  const q=await api();const w=Array.from({length:40},(_,i)=>token('甲',i,100+Math.round(i*3970/40),100+Math.round((i+1)*3970/40)));
  const before=JSON.stringify(w);const runs=q.findEqualTimeRuns(w);
  expect(runs).toEqual([{first_token:0,token_count:40,start_ms:100,end_ms:4070,formula:'round_equal_partition'}]);expect(JSON.stringify(w)).toBe(before);
 });
 it('停顿与非等分时长不会被归为长等分序列',async()=>{
  const q=await api();const w=Array.from({length:40},(_,i)=>token('甲',i,i*200,i*200+100));expect(q.findEqualTimeRuns(w)).toEqual([]);
 });
 it.each(['bad-hash','frame-gap','failed-terminal','trailing-event'])('损坏原始证据拒绝而非给通过摘要 %s',async scenario=>{
  const q=await api();const input=fixture([token('甲乙',0,0,100)]);
  if(scenario==='bad-hash')input.audioSha256='0'.repeat(64);
  if(scenario==='frame-gap')(input.capture.events[2] as any).byte_offset=2;
  if(scenario==='failed-terminal')input.capture.events.at(-1)!.data='timeout' as any;
  if(scenario==='trailing-event')input.capture.events.push(input.capture.events[0]);
  expect(()=>q.inspectEvidence(input)).toThrow();
 });
 it('越界、重叠及倒序 token 明确列出，不以完整文字覆盖掩盖',async()=>{
  const q=await api();const r=q.inspectEvidence(fixture([token('甲',0,0,300),token('乙',1,200,1100)]));
  expect(r.timing_issues).toContain('token_overlap:1');expect(r.timing_issues).toContain('token_out_of_audio:1');expect(r.qualification).toBe('unverified');
 });
});
