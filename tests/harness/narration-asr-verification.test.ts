import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
async function api(){expect(existsSync('harness/scripts/runtime/narration-asr-verification.ts'),'ASR自动核验入口存在').toBe(true);return import('../../harness/scripts/runtime/narration-asr-verification.js');}
const dirs:string[]=[];function output(){const d=mkdtempSync(join(tmpdir(),'narration-asr-'));dirs.push(d);return join(d,'run');}
afterEach(()=>{vi.restoreAllMocks();for(const d of dirs.splice(0)){if(dirname(resolve(d))!==resolve(tmpdir()))throw Error('fixture_path_invalid');rmSync(d,{recursive:true});}});
const success=(seconds=245)=>({status:'succeeded' as const,seconds,task_id:'task',submit_attempts:1,word_count:30});
describe('已授权ASR自动交叉核验',()=>{
 it('固定旧音频两项、北京已有ASR模型、0.20元预留，缺省不联网',async()=>{const q=await api();const p=q.asrPlan();expect(p.model).toBe('qwen3-asr-flash-filetrans');expect(p.requests.map(r=>r.id)).toEqual(['cosy-sanshu','qwen-yimuling']);expect(p.estimated_cost_cny).toBe(.130812);expect(p.reserve_cost_cny).toBe(.1309);expect(p.max_cost_cny).toBe(.2);expect(p.prior_cost_cny).toBe(2.33198);expect(q.parseAsrArgs([])).toBe('dry-run');});
 it.each([['--live'],['--confirm-live'],['--live','--confirm-live','--retry'],['--model','another'],['--output-dir','another']])('拒绝扩大调用或错误入口 %j',async(...args)=>{const q=await api();expect(()=>q.parseAsrArgs(args)).toThrow('asr_arguments_invalid');});
 it('两项串行核算usage，保存派发和任务ID，重复/并发目录不重发',async()=>{const q=await api();const d=output();let n=0;const t=vi.fn(async()=>success(++n===1?245:350));const r=await q.executeAsr(q.asrPlan(),d,t);expect(t).toHaveBeenCalledTimes(2);expect(r.actual_cost_cny).toBe(.1309);expect(r.total_usage_cost_cny).toBe(2.46288);expect(r.qualification).toBe('unverified');expect(r.calls.map(c=>c.result.task_id)).toEqual(['task','task']);await expect(q.executeAsr(q.asrPlan(),d,t)).rejects.toThrow();expect(t).toHaveBeenCalledTimes(2);});
 it.each(['unknown','failed','throw'])('首项%s停止后续并保留未知费用',async mode=>{const q=await api();const t=vi.fn(async()=>{if(mode==='throw')throw Error('private-token');return {status:mode as 'unknown'|'failed',seconds:null,submit_attempts:1};});const r=await q.executeAsr(q.asrPlan(),output(),t);expect(t).toHaveBeenCalledTimes(1);expect(r.actual_cost_cny).toBeNull();expect(r.accounted_cost_cny).toBe(.2);expect(r.stopped_reason).toBe('asr_unverified_or_failed');expect(JSON.stringify(r)).not.toContain('private-token');});
 it('后项失败不覆盖首项已知成本；上限不足不提交第二项',async()=>{const q=await api();let n=0;const r=await q.executeAsr(q.asrPlan(),output(),async()=>++n===1?success():({status:'failed',seconds:null,submit_attempts:1}));expect(r.calls[0].accounted_cost_cny).toBe(.0539);expect(r.actual_cost_cny).toBeNull();const t=vi.fn(async()=>success(700));const cap=await q.executeAsr(q.asrPlan(),output(),t);expect(t).toHaveBeenCalledTimes(1);expect(cap.stopped_reason).toBe('cost_limit');});
 it('拒绝计划变更和非数值usage，不把识别失败当免费',async()=>{const q=await api();const p=q.asrPlan();p.requests.reverse();const t=vi.fn(async()=>success());await expect(q.executeAsr(p,output(),t)).rejects.toThrow('asr_plan_changed');expect(t).not.toHaveBeenCalled();const r=await q.executeAsr(q.asrPlan(),output(),async()=>({...success(),seconds:NaN}));expect(r.actual_cost_cny).toBeNull();});
 it('捕获既有客户端响应并保留word时间，既有fetch在结束时恢复',async()=>{const q=await api();const old=globalThis.fetch;const dir=output();const f=vi.fn(async(url:any,init:any)=>{if(String(url).endsWith('/transcription')){expect(JSON.parse(init.body).parameters).toEqual({enable_words:true,enable_itn:false});return Response.json({request_id:'r1',output:{task_id:'task',task_status:'PENDING'}});}if(String(url).includes('/tasks/'))return Response.json({output:{task_id:'task',task_status:'SUCCEEDED',result:{transcription_url:'http://result.oss-cn-beijing.aliyuncs.com/t.json?Signature=private'}},usage:{seconds:245}});return Response.json({transcripts:[{sentences:[{words:[{text:'甲',begin_time:20,end_time:100}]}]}]});});
 const invoke=async()=>{await fetch('https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription',{method:'POST',headers:{Authorization:'Bearer key'},body:JSON.stringify({model:q.asrPlan().model,input:{file_url:'oss://fixture'},parameters:{enable_words:true}})});const p=await fetch('https://dashscope.aliyuncs.com/api/v1/tasks/task');const j=await p.json();await fetch(j.output.result.transcription_url);return [{text:'甲',begin_time_ms:20,end_time_ms:100,punctuation:null}];};
 const row=q.asrPlan().requests[0];const r=await q.captureAsr(row,dir,'key',f as any,invoke);expect(r).toMatchObject({status:'succeeded',seconds:245,submit_attempts:1,word_count:1,task_id:'task'});expect(globalThis.fetch).toBe(old);expect(f.mock.calls[2][0]).toBe('https://result.oss-cn-beijing.aliyuncs.com/t.json?Signature=private');expect(readFileSync(join(dir,'poll-latest.json'),'utf8')).not.toContain('Signature=private');
 expect(q.loadAsrReference(row,dir)).toHaveLength(1);
 const receipt=JSON.parse(readFileSync(join(dir,'result.json'),'utf8'));
 for(const patch of [{status:'failed'},{wav_sha256:'wrong'},{task_id:'another'}]){writeFileSync(join(dir,'result.json'),JSON.stringify({...receipt,...patch}));expect(()=>q.loadAsrReference(row,dir)).toThrow('asr_reference_invalid');}
 writeFileSync(join(dir,'result.json'),JSON.stringify(receipt));writeFileSync(join(dir,'transcription.json'),'{}');expect(()=>q.loadAsrReference(row,dir)).toThrow('asr_reference_invalid');});
 it.each(['https://evil.example/upload','https://dashscope.aliyuncs.com.evil.example/x','https://x.oss-cn-beijing.aliyuncs.com:444/x','http://dashscope.aliyuncs.com/api/v1/tasks/t'])('拒绝错误网络目的地且恢复fetch %s',async url=>{const q=await api();const before=globalThis.fetch;const f=vi.fn();const r=await q.captureAsr(q.asrPlan().requests[0],output(),'key',f as any,async()=>{await fetch(url);return [];});expect(r.status).toBe('failed');expect(f).not.toHaveBeenCalled();expect(globalThis.fetch).toBe(before);});
 it('正文比较暴露缺词，时间差只比较双侧完整同文词边界，不插值',async()=>{const q=await api();const native=[{text:'甲乙',begin_time:10,end_time:200},{text:'丙',begin_time:200,end_time:300}];const asr=[{text:'甲',begin_time_ms:30,end_time_ms:90},{text:'乙',begin_time_ms:90,end_time_ms:220},{text:'丙',begin_time_ms:220,end_time_ms:330}];const r=q.compareRecognition('甲乙丙',native,asr);expect(r.source_asr.edit_distance).toBe(0);expect(r.boundary_comparison.comparable_count).toBe(2);expect(r.boundary_comparison.p95_difference_ms).toBe(20);expect(r.qualification).toBe('unverified');const missing=q.compareRecognition('甲乙丙',native,[asr[0],asr[2]]);expect(missing.source_asr.edit_distance).toBe(1);expect(missing.source_asr.deletions).toBe(1);expect(missing.source_asr.differences).toEqual(expect.arrayContaining([expect.objectContaining({source:'乙',recognized:''})]));});
 it('数字、同音替换保留差分；零时长异常不由ASR修补',async()=>{const q=await api();const n=[{text:'了',begin_time:100,end_time:100},{text:'三',begin_time:100,end_time:200}];const a=[{text:'了',begin_time_ms:110,end_time_ms:160},{text:'3',begin_time_ms:160,end_time_ms:220}];const before=JSON.stringify(n);const r=q.compareRecognition('了三',n,a);expect(r.native_timing_issues).toContain('token_duration_invalid:0');expect(r.source_asr.substitutions).toBe(1);expect(JSON.stringify(n)).toBe(before);expect(r.reference_kind).toBe('independent_asr_not_acoustic_ground_truth');});
 it('CLI默认零网络且没有付费模式旁路',async()=>{await api();const args=['node_modules/tsx/dist/cli.mjs','harness/scripts/runtime/narration-asr-verification.ts'];expect(JSON.parse(execFileSync(process.execPath,args,{encoding:'utf8'})).actual_requests).toBe(0);expect(()=>execFileSync(process.execPath,[...args,'--live'],{stdio:'pipe'})).toThrow();});
 it('真实旧客户端经过上传和识别全链路，OSS不收到API密钥、请求无原稿提示',async()=>{
   const q=await api();let submissions=0,uploads=0;
   const fake=vi.fn(async(url:any,init:any)=>{
     if(String(url).includes('/uploads?'))return Response.json({data:{upload_dir:'fixture',upload_host:'https://upload.oss-cn-beijing.aliyuncs.com',oss_access_key_id:'upload-key',policy:'upload-policy',signature:'upload-signature',x_oss_object_acl:'private',x_oss_forbid_overwrite:'true'}});
     if(String(url).includes('upload.oss-')){uploads++;expect(new Headers(init.headers).has('Authorization')).toBe(false);expect(init.body).toBeInstanceOf(FormData);return new Response('');}
     if(String(url).endsWith('/transcription')){submissions++;expect(JSON.parse(init.body)).toEqual({model:q.asrPlan().model,input:{file_url:'oss://fixture/cosy-sanshu-long.wav'},parameters:{enable_words:true,enable_itn:false}});return Response.json({output:{task_id:'full-path',task_status:'PENDING'}});}
     if(String(url).includes('/tasks/'))return Response.json({output:{task_id:'full-path',task_status:'SUCCEEDED',result:{transcription_url:'https://result.oss-cn-beijing.aliyuncs.com/result.json'}},usage:{seconds:245}});
     expect(new Headers(init.headers).has('Authorization')).toBe(false);
     return Response.json({transcripts:[{sentences:[{words:[{text:'甲',begin_time:0,end_time:100}]}]}]});
   });
   const dir=output(),audio_file=join(dirname(dir),'cosy-sanshu-long.wav');writeFileSync(audio_file,Buffer.from('isolated-upload-fixture'));
   const r=await q.captureAsr({...q.asrPlan().requests[0],audio_file},dir,'private-key',fake as any);
   expect(r.status).toBe('succeeded');expect(submissions).toBe(1);expect(uploads).toBe(1);expect(fake).toHaveBeenCalledTimes(5);
 });
 it.each(['second-submit','wrong-task'])('生命周期失败前缀 %s不派发额外请求',async mode=>{
   const q=await api();const f=vi.fn(async()=>Response.json({output:{task_id:'one',task_status:'PENDING'}}));
   const r=await q.captureAsr(q.asrPlan().requests[0],output(),'key',f as any,async()=>{
     const url='https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription';const init={method:'POST',body:JSON.stringify({model:q.asrPlan().model,input:{file_url:'oss://fixture'}})};
     await fetch(url,init);if(mode==='second-submit')await fetch(url,init);else await fetch('https://dashscope.aliyuncs.com/api/v1/tasks/another');return [];
   });expect(r.status).toBe('failed');expect(r.submit_attempts).toBe(1);expect(f).toHaveBeenCalledTimes(1);
 });
 it.each([{begin:10,end:10},{begin:-1,end:30},{begin:NaN,end:30}])('无效ASR词时间不进入统计，仍保留全文识别差分 %j',async ({begin,end})=>{
   const q=await api();const r=q.compareRecognition('甲乙',[{text:'甲',begin_time:0,end_time:100},{text:'乙',begin_time:100,end_time:200}],[{text:'甲',begin_time_ms:begin,end_time_ms:end},{text:'乙',begin_time_ms:120,end_time_ms:220}]);
   expect(r.asr_timing_issues).toContain('token_duration_invalid:0');expect(r.boundary_comparison.comparable_count).toBe(1);expect(r.boundary_comparison.points[0].native_ordinal).toBe(1);expect(r.source_asr.edit_distance).toBe(0);
 });
 it('ASR词间倒序与覆盖不隐藏且不充作可靠锚点',async()=>{
   const q=await api();const r=q.compareRecognition('甲乙',[{text:'甲',begin_time:0,end_time:100},{text:'乙',begin_time:100,end_time:200}],[{text:'甲',begin_time_ms:100,end_time_ms:200},{text:'乙',begin_time_ms:90,end_time_ms:190}]);
   expect(r.asr_timing_issues).toContain('token_overlap:1');expect(r.boundary_comparison.comparable_count).toBe(1);
 });
 it.each([{begin:0,end:0},{begin:20,end:40}])('中间坏词不能重置已观察到的时间上界 %j',async ({begin,end})=>{
   const q=await api();const r=q.compareRecognition('甲乙丙丁',[{text:'甲',begin_time:0,end_time:100},{text:'乙',begin_time:100,end_time:200},{text:'丙',begin_time:200,end_time:300},{text:'丁',begin_time:300,end_time:400}],
   [{text:'甲',begin_time_ms:100,end_time_ms:200},{text:'乙',begin_time_ms:begin,end_time_ms:end},{text:'丙',begin_time_ms:50,end_time_ms:80},{text:'丁',begin_time_ms:300,end_time_ms:400}]);
   expect(r.asr_timing_issues).toContain('token_overlap:2');expect(r.boundary_comparison.points.map(p=>p.asr_ordinal)).toEqual([0,3]);
 });
});
