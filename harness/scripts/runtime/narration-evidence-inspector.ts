/** 任务 0 离线证据检查；不外呼、不写业务数据、不授予生产资格。 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildPlan, loadSampleTexts } from './narration-provider-qualification.js';
import { createHash } from 'node:crypto';
export interface NativeToken { text: string; begin_index: number; end_index: number; begin_time: number; end_time: number; }
export interface NormalizationObservation { start: number; end: number; expected: string; spoken: string; }
const hash=(x:string|Buffer)=>createHash('sha256').update(x).digest('hex');
const integer=(x:unknown):x is number=>Number.isSafeInteger(x);
function boundary(text:string,n:number) {
  return integer(n) && n>=0 && n<=text.length && !(n>0 && n<text.length && /[\uD800-\uDBFF]/.test(text[n-1]) && /[\uDC00-\uDFFF]/.test(text[n]));
}
function assertTokens(tokens:NativeToken[]) {
  if (!Array.isArray(tokens) || tokens.some(w=>!w || typeof w.text!=='string' || !w.text.length ||
      ![w.begin_index,w.end_index,w.begin_time,w.end_time].every(integer))) throw Error('tokens_invalid');
}
/** 显式观察注记不是通用发音规则。无声明的不同字符一律不猜测、不模糊匹配。 */
export function mapObservedText(source:string,tokens:NativeToken[],observations:NormalizationObservation[]=[]) {
  assertTokens(tokens);
  const units:Array<{text:string;source_start:number;source_end:number;start:number;end:number}>=[];
  const silent_source_spans:Array<{start:number;end:number}>=[];
  const graphemes=new Intl.Segmenter('zh',{granularity:'grapheme'});
  const sourceCuts=new Set([0,source.length,...Array.from(graphemes.segment(source),s=>s.index)]);
  let sourceCursor=0, spokenCursor=0;
  const append=(text:string,start:number,end:number)=>{
    for(const cp of text) {units.push({text:cp,source_start:start,source_end:end,start:spokenCursor,end:spokenCursor+cp.length});spokenCursor+=cp.length;}
  };
  const unchanged=(start:number,end:number)=>{
    for(const s of graphemes.segment(source.slice(start,end)))append(s.segment,start+s.index,start+s.index+s.segment.length);
  };
  for(const p of observations) {
    if (!p || !integer(p.start)||!integer(p.end)||p.start<sourceCursor||p.end<=p.start||
        !sourceCuts.has(p.start)||!sourceCuts.has(p.end)||typeof p.spoken!=='string'||source.slice(p.start,p.end)!==p.expected)
      throw Error('normalization_invalid');
    unchanged(sourceCursor,p.start);append(p.spoken,p.start,p.end);
    if(!p.spoken) silent_source_spans.push({start:p.start,end:p.end});sourceCursor=p.end;
  }
  unchanged(sourceCursor,source.length);
  const expected=units.map(u=>u.text).join(''),actual=tokens.map(w=>w.text).join('');
  const base={normalization_review:'unverified' as const,source_utf16:source.length,spoken_utf16:actual.length,
    source_sha256:hash(source),spoken_sha256:hash(actual),silent_source_spans};
  if(expected!==actual) {
    let first=0;while(first<expected.length&&first<actual.length&&expected[first]===actual[first])first++;
    return {...base,status:'mismatch' as const,first_mismatch_spoken_offset:first,tokens:[] as Array<NativeToken&{source_start:number;source_end:number}>,legal_source_cuts:[] as number[]};
  }
  let cursor=0,unitIndex=0;
  const mapped=tokens.map(w=>{
    const end=cursor+w.text.length;
    if(!boundary(actual,cursor)||!boundary(actual,end))throw Error('token_splits_surrogate');
    while(unitIndex<units.length&&units[unitIndex].end<=cursor)unitIndex++;
    const first=units[unitIndex];let last=unitIndex;
    while(last+1<units.length&&units[last+1].start<end)last++;
    cursor=end;return {...w,source_start:first.source_start,source_end:units[last].source_end};
  });
  const cuts=[0];
  for(let i=1;i<mapped.length;i++)if(mapped[i-1].source_end<=mapped[i].source_start&&sourceCuts.has(mapped[i].source_start))cuts.push(mapped[i].source_start);
  cuts.push(source.length);
  return {...base,status:observations.length?'declared_normalization' as const:'exact' as const,tokens:mapped,legal_source_cuts:[...new Set(cuts)]};
}
/** 数学特征诊断，不据此自动判断听感或替换供应商时间。 */
export function findEqualTimeRuns(tokens:NativeToken[]) {
  assertTokens(tokens);
  const runs:Array<{first_token:number;token_count:number;start_ms:number;end_ms:number;formula:'round_equal_partition'}>=[];
  const inspect=(start:number,end:number)=>{
    const count=end-start;if(count<32)return;
    const begin=tokens[start].begin_time,finish=tokens[end-1].end_time;
    if(finish<=begin)return;
    if(tokens.slice(start,end).every((w,i)=>w.begin_time===begin+Math.round(i*(finish-begin)/count)&&w.end_time===begin+Math.round((i+1)*(finish-begin)/count)))
      runs.push({first_token:start,token_count:count,start_ms:begin,end_ms:finish,formula:'round_equal_partition'});
  };
  let start=0,min=Infinity,max=-Infinity;
  for(let i=0;i<tokens.length;i++) {
    const duration=tokens[i].end_time-tokens[i].begin_time;
    if(i>start&&(tokens[i].begin_time!==tokens[i-1].end_time||Math.max(max,duration)-Math.min(min,duration)>1)) {
      inspect(start,i);start=i;min=Infinity;max=-Infinity;
    }
    min=Math.min(min,duration);max=Math.max(max,duration);
  }
  inspect(start,tokens.length);return runs;
}
export function inspectEvidence(input:{sourceText:string;sourceSha256:string;pcm:Buffer;audioSha256:string;capture:unknown;observations?:NormalizationObservation[]}) {
  if(hash(input.sourceText)!==input.sourceSha256||hash(input.pcm)!==input.audioSha256||!input.pcm.length||input.pcm.length%2)throw Error('evidence_hash_or_pcm_invalid');
  const raw=input.capture as any;
  if(!raw||typeof raw.task_id!=='string'||!raw.task_id||!Array.isArray(raw.events)||raw.events.length<4)throw Error('events_invalid');
  const events=raw.events;
  if(events.at(-1)?.kind!=='terminal'||events.at(-1).data!=='task-finished'||events.at(-2)?.data?.header?.event!=='task-finished')throw Error('terminal_invalid');
  let bytes=0,started=false,finished=false,open:number|null=null,sentenceStart=0;
  const words:NativeToken[]=[];
  const sentences:Array<{index:number;audio_start_byte:number;audio_bytes:number;returned_text_utf16:number;first_token:number;token_count:number}>=[];
  for(let i=0;i<events.length;i++) {
    const e=events[i];
    if(!e||!integer(e.elapsed_ms)||e.elapsed_ms<0||(i>0&&e.elapsed_ms<events[i-1].elapsed_ms))throw Error('event_order_invalid');
    if(e.kind==='terminal') {if(i!==events.length-1||!finished)throw Error('terminal_invalid');continue;}
    if(finished)throw Error('event_after_finish');
    if(e.kind==='audio') {
      if(!started||open===null||e.byte_offset!==bytes||!integer(e.byte_length)||e.byte_length<=0||bytes+e.byte_length>input.pcm.length)throw Error('frame_coverage_invalid');
      bytes+=e.byte_length;continue;
    }
    if(e.kind!=='json'||e.data?.header?.task_id!==raw.task_id)throw Error('event_invalid');
    const event=e.data.header.event,output=e.data.payload?.output;
    if(event==='task-started') {if(started)throw Error('duplicate_start');started=true;}
    else if(event==='result-generated') {
      if(!started)throw Error('event_order_invalid');
      if(output?.type==='sentence-begin') {
        if(open!==null||output.sentence?.index!==sentences.length)throw Error('sentence_order_invalid');
        open=output.sentence.index;sentenceStart=bytes;
      } else if(output?.type==='sentence-end') {
        if(open===null||output.sentence?.index!==open||typeof output.original_text!=='string')throw Error('sentence_order_invalid');
        assertTokens(output.sentence.words);
        sentences.push({index:open,audio_start_byte:sentenceStart,audio_bytes:bytes-sentenceStart,returned_text_utf16:output.original_text.length,first_token:words.length,token_count:output.sentence.words.length});
        words.push(...output.sentence.words);open=null;
      } else if(output?.type!=='sentence-synthesis'||open===null)throw Error('sentence_event_invalid');
    } else if(event==='task-finished') {
      if(!started||open!==null||!sentences.length||bytes!==input.pcm.length)throw Error('incomplete_capture');finished=true;
    } else throw Error('unsuccessful_or_unknown_event');
  }
  const duration_ms=input.pcm.length/48;
  const timing_issues:string[]=[];
  if(!words.length)timing_issues.push('native_tokens_missing');
  words.forEach((w,i)=>{
    if(w.begin_time<0||w.end_time>duration_ms)timing_issues.push('token_out_of_audio:'+i);
    if(w.end_time<=w.begin_time)timing_issues.push('token_duration_invalid:'+i);
    if(i>0&&w.begin_time<words[i-1].end_time)timing_issues.push('token_overlap:'+i);
  });
  return {integrity:'verified' as const,qualification:'unverified' as const,manual_boundary_count:0,
    pcm_layout:'assumed_s16le_mono_24000_requires_listening',duration_ms,audio_sha256:input.audioSha256,
    native_event_sha256:hash(JSON.stringify(raw)),frame_count:events.filter((e:any)=>e.kind==='audio').length,
    max_frame_bytes:Math.max(...events.filter((e:any)=>e.kind==='audio').map((e:any)=>e.byte_length)),sentences,
    native_index_observation:words.every((w,i)=>w.begin_index===i&&w.end_index===i+1)?'task_token_ordinal':'other_or_mixed',
    timing_issues,equal_time_runs:findEqualTimeRuns(words),text_mapping:mapObservedText(input.sourceText,words,input.observations)};
}


export function runOfflineInspection(argv:string[]) {
  if(!argv.length)return {actual_requests:0,usage:'--report-path <合并报告> --samples-dir <冻结正文> --capture-dir <原始目录> [--capture-dir <续采目录>] --output-dir <新目录>'};
  const args:Record<string,string>={},captureDirs:string[]=[];
  for(let i=0;i<argv.length;i+=2) {
    const key=argv[i],value=argv[i+1];
    if(!['--report-path','--samples-dir','--capture-dir','--output-dir'].includes(key)||!value||value.startsWith('--')||key!=='--capture-dir'&&args[key])throw Error('offline_arguments_invalid');
    if(key==='--capture-dir')captureDirs.push(resolve(value));else args[key]=value;
  }
  if(!args['--report-path']||!args['--samples-dir']||!args['--output-dir']||!captureDirs.length||new Set(captureDirs).size!==captureDirs.length)throw Error('offline_arguments_invalid');
  const plan=buildPlan(),texts=loadSampleTexts(args['--samples-dir'],plan);
  const report=JSON.parse(readFileSync(args['--report-path'],'utf8'));
  if(JSON.stringify(report.plan)!==JSON.stringify(plan)||!Array.isArray(report.calls)||report.calls.length!==plan.requests.length||report.actual_requests!==plan.requests.length)throw Error('round_report_invalid');
  const annotations=JSON.parse(readFileSync(fileURLToPath(new URL('../../samples/narration-timing/mapping-observations.json',import.meta.url)),'utf8'));
  const inspections=plan.requests.map((row,index)=>{
    const call=report.calls[index];
    if(JSON.stringify(call.request)!==JSON.stringify(row)||call.result?.status!=='succeeded')throw Error('round_report_invalid');
    const name=row.id.replace(':','-');
    const found=captureDirs.filter(d=>existsSync(resolve(d,name+'.events.json'))&&existsSync(resolve(d,name+'.pcm')));
    if(found.length!==1)throw Error('capture_missing_or_duplicated');
    const capture=JSON.parse(readFileSync(resolve(found[0],name+'.events.json'),'utf8'));
    const pcm=readFileSync(resolve(found[0],name+'.pcm'));
    if(pcm.length!==call.result.audio_bytes)throw Error('audio_length_mismatch');
    const observed=annotations.entries.filter((e:any)=>e.candidate_id===row.candidate_id&&e.sample_id===row.sample_id);
    if(observed.length>1||observed[0]&&observed[0].source_sha256!==row.text_sha256)throw Error('observation_binding_invalid');
    const result=inspectEvidence({sourceText:texts.get(row.sample_id)!,sourceSha256:row.text_sha256,pcm,audioSha256:call.result.audio_sha256,capture,observations:observed[0]?.observations});
    if(observed[0]&&observed[0].spoken_sha256!==result.text_mapping.spoken_sha256)throw Error('observation_binding_invalid');
    return {request_id:row.id,...result};
  });
  const outputDir=resolve(args['--output-dir']);mkdirSync(outputDir);
  writeFileSync(resolve(outputDir,'inspection.json'),JSON.stringify({actual_requests:0,source_report_sha256:hash(readFileSync(args['--report-path'])),matrix_hash:plan.matrix_hash,qualification:'unverified',recommended_candidate:null,inspections},null,2)+'\n',{flag:'wx'});
  return {actual_requests:0,inspected_calls:inspections.length,equal_time_run_calls:inspections.filter(i=>i.equal_time_runs.length).map(i=>i.request_id),mapping_statuses:inspections.map(i=>({request_id:i.request_id,status:i.text_mapping.status})),qualification:'unverified',output_dir:outputDir};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  try {process.stdout.write(JSON.stringify(runOfflineInspection(process.argv.slice(2)),null,2)+'\n');}
  catch(e) {process.stderr.write(JSON.stringify({error:e instanceof Error&&/^[a-z_]+$/.test(e.message)?e.message:'offline_inspection_failed'})+'\n');process.exitCode=1;}
}
