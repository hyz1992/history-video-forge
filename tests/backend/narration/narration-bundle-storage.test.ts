import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, writeFile, mkdir, readdir, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { DEFAULT_SUBTITLE_STYLE, hashNarrationSettings, type NarrationRecord } from '../../../shared/src/index.js';
import { normalizeNarrationTiming } from '../../../backend/src/modules/narration/narration-timing-normalizer.js';
import { NarrationBundleStorage } from '../../../backend/src/modules/narration/narration-bundle-storage.js';
import * as staged from '../../../backend/src/runtime/files/artifact-file-commit.js';

const sha=(data:string|Buffer)=>createHash('sha256').update(data).digest('hex');
const now='2026-09-06T10:00:00.000Z';
const roots:string[]=[];
afterEach(async()=>{vi.restoreAllMocks();for(const path of roots.splice(0))await rm(path,{recursive:true,force:true});});
async function fixture(){
  const path=await mkdtemp(join(tmpdir(),'narration-bundle-'));roots.push(path);
  const audio=Buffer.alloc(48044);audio.write('RIFF');audio.writeUInt32LE(48036,4);audio.write('WAVEfmt ',8);audio.writeUInt32LE(16,16);audio.writeUInt16LE(1,20);audio.writeUInt16LE(1,22);audio.writeUInt32LE(24000,24);audio.writeUInt32LE(48000,28);audio.writeUInt16LE(2,32);audio.writeUInt16LE(16,34);audio.write('data',36);audio.writeUInt32LE(48000,40);
  const settings={model:'qwen-audio-3.0-tts-plus',voice:'qwen-audio-3.0-tts-plus-longyimuling',region:'cn-beijing',protocol:'dashscope_ws',parametersVersion:'neutral-pcm24k-v1',tone:'neutral',rate:1,pitch:1,volume:50,sampleRate:24000,format:'pcm',textType:'PlainText',wordTimestampEnabled:true,enableSsml:false,seed:0,inputMode:'natural_paragraphs_single_task'} as const;
  const words=[{text:'甲',begin_index:0,end_index:1,begin_time:100,end_time:400},{text:'乙',begin_index:1,end_index:2,begin_time:400,end_time:700}];
  const timingMap=normalizeNarrationTiming({sourceText:'甲乙',audioHash:sha(audio),durationMs:1000,sentences:[{providerSentenceIndex:0,originalText:'甲乙',normalizedText:'甲乙',words}]});
  const event=(name:string,output?:unknown)=>({kind:'json',elapsedMs:0,data:{header:{event:name,task_id:'task'},payload:output===undefined?{}:{output}}});
  const nativeEvents=[event('task-started'),event('result-generated',{type:'sentence-begin',sentence:{index:0}}),{kind:'audio',elapsedMs:0,byteOffset:0,byteLength:48000},event('result-generated',{type:'sentence-end',sentence:{index:0,words},original_text:'甲乙',normalized_text:'甲乙'}),event('task-finished')];
  const record:NarrationRecord={schemaVersion:'narration_record_v1',id:'n1',projectId:'p1',scriptRecordId:'s1',generationRunId:'run1',createdAt:now,updatedAt:now,sourceTextSha256:sha('甲乙'),spokenTextSha256:null,settingsSha256:await hashNarrationSettings(settings),sourceProjectTtsSettingsSha256:sha('settings'),textMappingVersion:'narration-native-spans/v1',configurationSnapshotId:'snap1',settings,timingSource:'provider_native',providerTaskId:'task',providerRequestId:null,status:'generating',errorCode:null,confirmedAt:null,confirmedBy:null,acceptedDurationBandSnapshot:null,output:null};
  const subtitleSettings={presetId:null,presetVersion:null,resolvedStyle:{...DEFAULT_SUBTITLE_STYLE},overrides:{},lineBreak:{strategy:'punctuation_and_length' as const,maxCharactersPerLine:20,version:'v1'},resolverVersion:'v1'};
  return {path,store:new NarrationBundleStorage({projectId:'p1',storageRootDir:path}),input:{record,audio,timingMap,nativeEvents,subtitleSettings,subtitleRevisionId:'sub1',createdAt:now}};
}
describe('不可变口播bundle',()=>{
  it('完整落盘后DB ready前退出，恢复仍识别完整原件及完整初始字幕',async()=>{
    const f=await fixture(), saved=await f.store.commitInitial(f.input);
    expect(saved.record.status).toBe('ready');expect(f.input.record.status).toBe('generating');
    const recovered=await new NarrationBundleStorage({projectId:'p1',storageRootDir:f.path}).recoverInitial({record:f.input.record});
    expect(recovered.status).toBe('complete');expect(recovered.bundle.record).toEqual(saved.record);
    expect(await readFile(join(f.path,saved.record.output.audio.uri))).toEqual(f.input.audio);
    expect(recovered.bundle.initialSubtitleRevision.subtitleSettingsSnapshotJson).toEqual(f.input.subtitleSettings);
    expect((await f.store.recoverInitial({record:{...f.input.record,providerTaskId:null}})).status).toBe('complete');
    expect((await f.store.recoverInitial({record:{...f.input.record,providerTaskId:'wrong'}})).status).toBe('incomplete');
  });
  it('段间空白保留在原始句原文及sourceText，重读不规范化raw',async()=>{
    const f=await fixture();
    f.input.record.sourceTextSha256=sha('甲\n\n乙');
    const words=(f.input.nativeEvents[3] as any).data.payload.output.sentence.words;
    const sentences=words.map((word:any,i:number)=>({providerSentenceIndex:i,originalText:word.text+(i===0?'\n\n':''),normalizedText:word.text,words:[word]}));
    f.input.timingMap=normalizeNarrationTiming({sourceText:'甲\n\n乙',audioHash:sha(f.input.audio),durationMs:1000,sentences});
    const event=(output:any)=>({kind:'json',elapsedMs:0,data:{header:{event:'result-generated',task_id:'task'},payload:{output}}});
    f.input.nativeEvents=[f.input.nativeEvents[0],f.input.nativeEvents[2],...sentences.flatMap((s:any)=>[event({type:'sentence-begin',sentence:{index:s.providerSentenceIndex}}),event({type:'sentence-end',sentence:{index:s.providerSentenceIndex,words:s.words},original_text:s.originalText,normalized_text:s.normalizedText})]),f.input.nativeEvents[4]];
    expect((await f.store.commitInitial(f.input)).record.status).toBe('ready');
  });
  it('同成本多解（仲裁）输入在重读重放后仍逐字节一致',async()=>{
    // 仲裁要求"同一输入永远得到同一条路径"，否则 narration-bundle-storage 的 timingFromEvents
    // 重放复算会与已落盘的图不等而报 narration_bundle_events_mismatch。
    const f=await fixture();
    const source='甲。、乙', spoken='甲，乙';
    const words=Array.from(spoken).map((text,i)=>({text,begin_index:i,end_index:i+1,begin_time:i*250+100,end_time:(i+1)*250+100}));
    f.input.record.sourceTextSha256=sha(source);
    f.input.timingMap=normalizeNarrationTiming({sourceText:source,audioHash:sha(f.input.audio),durationMs:1000,
      sentences:[{providerSentenceIndex:0,originalText:source,normalizedText:spoken,words}]});
    const event=(name:string,output?:unknown)=>({kind:'json' as const,elapsedMs:0,data:{header:{event:name,task_id:'task'},payload:output===undefined?{}:{output}}});
    f.input.nativeEvents=[f.input.nativeEvents[0] as never,event('result-generated',{type:'sentence-begin',sentence:{index:0}}) as never,
      f.input.nativeEvents[2] as never,
      event('result-generated',{type:'sentence-end',sentence:{index:0,words},original_text:source,normalized_text:spoken}) as never,
      f.input.nativeEvents[4] as never];
    const saved=await f.store.commitInitial(f.input);
    expect(saved.record.status).toBe('ready');
    const recovered=await new NarrationBundleStorage({projectId:'p1',storageRootDir:f.path}).recoverInitial({record:f.input.record});
    expect(recovered.status).toBe('complete');
    expect(recovered.status==='complete'&&recovered.bundle.record.output?.timingMap).toEqual(saved.record.output?.timingMap);
  });
  it('写一半不complete，原candidate保留，重试可提交',async()=>{
    const f=await fixture();let count=0;const original=staged.writeStagedArtifactFile;
    vi.spyOn(staged,'writeStagedArtifactFile').mockImplementation(async(...args)=>{if(++count===3)throw new Error('disk_failure');return original(...args);});
    await expect(f.store.commitInitial(f.input)).rejects.toThrow('disk_failure');
    expect((await f.store.recoverInitial({record:f.input.record})).status).not.toBe('complete');
    vi.restoreAllMocks();expect((await f.store.commitInitial(f.input)).record.status).toBe('ready');
    expect((await readdir(join(f.path,'narration-runs','run1','.staging'))).length).toBeGreaterThan(0);
  });
  it('重复/并发同payload幂等，同ID异payload不能覆盖历史',async()=>{
    const f=await fixture();const results=await Promise.all([f.store.commitInitial(f.input),f.store.commitInitial(f.input)]);
    expect(results[0]).toEqual(results[1]);
    const next=structuredClone(f.input.subtitleSettings);next.resolvedStyle.font_size_px=60;
    await expect(f.store.commitInitial({...f.input,subtitleSettings:next})).rejects.toThrow('narration_bundle_conflict');
    expect((await f.store.recoverInitial({record:f.input.record})).bundle).toEqual(results[0]);
  });
  it('新style独立revision且同SRT旧音频/timing/初始字幕不覆盖',async()=>{
    const f=await fixture(),saved=await f.store.commitInitial(f.input),snapshot=structuredClone(f.input.subtitleSettings);snapshot.resolvedStyle.font_size_px=60;
    const next=await f.store.commitSubtitleRevision({record:saved.record,revisionId:'sub2',settingsSnapshot:snapshot,createdAt:now});
    expect(next.revision.id).toBe('sub2');expect(next.revision.subtitleSettingsHash).not.toBe(saved.initialSubtitleRevision.subtitleSettingsHash);
    expect(next.revision.srt.sha256).toBe(saved.initialSubtitleRevision.srt.sha256);
    snapshot.resolvedStyle.font_size_px=70;
    const reloaded=await f.store.readSubtitleRevision({record:saved.record,revision:next.revision});
    expect(reloaded.revision.subtitleSettingsSnapshotJson.resolvedStyle.font_size_px).toBe(60);
    expect((await f.store.recoverInitial({record:saved.record})).bundle).toEqual(saved);
  });
  it('旧complete文件损坏后重读拒绝且不自动覆盖修复',async()=>{
    const f=await fixture(),saved=await f.store.commitInitial(f.input);await writeFile(join(f.path,saved.record.output.timingMap.uri),'{}');
    expect((await f.store.recoverInitial({record:saved.record})).status).toBe('incomplete');
    await expect(f.store.commitInitial(f.input)).rejects.toThrow();
    expect(await readFile(join(f.path,saved.record.output.timingMap.uri),'utf8')).toBe('{}');
  });
  it.each(['project','run','source','audio','events'])('完整对象跨来源/原件污染拒绝：%s',async kind=>{
    const f=await fixture();if(kind==='project')f.input.record.projectId='p2';if(kind==='run')f.input.record.generationRunId='../run2';if(kind==='source')f.input.record.sourceTextSha256=sha('乙');if(kind==='audio')f.input.audio[44]=1;if(kind==='events')(f.input.nativeEvents[3] as any).data.payload.output.normalized_text='丙';
    await expect(f.store.commitInitial(f.input)).rejects.toThrow();
  });
  it('symlink/junction不能把run根导向项目外',async()=>{
    const f=await fixture(),outside=await mkdtemp(join(tmpdir(),'narration-outside-'));roots.push(outside);
    await mkdir(join(f.path,'narration-runs'));await symlink(outside,join(f.path,'narration-runs','run1'),'junction');
    await expect(f.store.commitInitial(f.input)).rejects.toThrow('narration_path');expect(await readdir(outside)).toEqual([]);
  });
  it.each(['record-only','raw-only','different','changes'])('request UUID来源必须与原始事件一致：%s',async kind=>{
    const f=await fixture();f.input.record.providerRequestId=kind==='raw-only'?null:'request1';
    if(kind!=='record-only')for(const e of f.input.nativeEvents)if(e.kind==='json')(e as any).data.header.attributes={request_uuid:kind==='different'?'request2':'request1'};
    if(kind==='changes')(f.input.nativeEvents.at(-1) as any).data.header.attributes.request_uuid='request2';
    await expect(f.store.commitInitial(f.input)).rejects.toThrow('narration_bundle_events_invalid');
  });
  it('可选request UUID仅部分事件提供时保留真实值，DB旧null仍可恢复',async()=>{
    const f=await fixture();f.input.record.providerRequestId='request1';
    (f.input.nativeEvents[0] as any).data.header.attributes={request_uuid:'request1'};
    const saved=await f.store.commitInitial(f.input);
    expect(saved.record.providerRequestId).toBe('request1');
    expect((await f.store.recoverInitial({record:{...f.input.record,providerTaskId:null,providerRequestId:null}})).status).toBe('complete');
  });
  it.each(['narration-runs/run1/bundle/%2e%2e/audio.wav','narration-runs\\run1\\bundle\\audio.wav','narration-runs/run1/../audio.wav','C:/outside/audio.wav','narration-runs/run2/bundle/audio.wav'])('外部完整record不允许不安全文件引用：%s',async uri=>{
    const f=await fixture(),saved=await f.store.commitInitial(f.input),record=structuredClone(saved.record);
    record.output!.audio.uri=uri;
    await expect(f.store.readFile({record,kind:'audio'})).rejects.toThrow();
  });
  it('后续revision并发同payload幂等且同ID不同设置拒绝，旧输出不变',async()=>{
    const f=await fixture(),saved=await f.store.commitInitial(f.input);
    const args={record:saved.record,revisionId:'sub2',settingsSnapshot:f.input.subtitleSettings,createdAt:now};
    const [a,b]=await Promise.all([f.store.commitSubtitleRevision(args),f.store.commitSubtitleRevision(args)]);expect(a).toEqual(b);
    const changed=structuredClone(args);changed.settingsSnapshot.resolvedStyle.font_size_px=60;
    await expect(f.store.commitSubtitleRevision(changed)).rejects.toThrow('narration_bundle_conflict');
    expect(await f.store.readSubtitleRevision({record:saved.record,revision:a.revision})).toEqual(a);
  });
  it.each(['run','path','style','timeline','raw'])('完整manifest来源和hash重验：%s',async kind=>{
    const f=await fixture(),saved=await f.store.commitInitial(f.input),path=join(f.path,'narration-runs/run1/bundle/manifest.json');
    const manifest=JSON.parse(await readFile(path,'utf8'));
    if(kind==='run')manifest.record.generationRunId='run2';
    if(kind==='path')manifest.record.output.audio.uri='narration-runs/run2/bundle/audio.wav';
    if(kind==='style')manifest.initialSubtitleRevision.subtitleSettingsSnapshotJson.resolvedStyle.font_size_px=60;
    if(kind==='timeline')manifest.timeline.cues[0].speechStartMs=50;
    if(kind==='raw'){const events=structuredClone(f.input.nativeEvents);(events[3] as any).data.payload.output.sentence.words[0].begin_time=50;const raw=JSON.stringify(events);await writeFile(join(f.path,saved.record.output!.nativeEvents.uri),raw);manifest.record.output.nativeEvents.sha256=sha(raw);}
    await writeFile(path,JSON.stringify(manifest));expect((await f.store.recoverInitial({record:f.input.record})).status).toBe('incomplete');
  });
});


function fact(record:NarrationRecord,characters:number|null=308){return {schemaVersion:'narration_provider_fact_v1',projectId:record.projectId,generationRunId:record.generationRunId,configurationSnapshotId:record.configurationSnapshotId,providerRequestKey:'key',sourceTextSha256:record.sourceTextSha256,settingsSha256:record.settingsSha256,providerTaskId:'task',providerRequestId:null,characters,receiptKind:characters===null?'none':'final',remoteOutcome:'completed',errorCode:null,durationMs:1000,canceled:false,observedAt:now};}
it('供应商事实原子发布且跨实例按hash重复读取，多份合法累计不覆盖',async()=>{
 const f=await fixture();const a=await f.store.commitProviderFact({record:f.input.record,fact:fact(f.input.record,100)});const b=await f.store.commitProviderFact({record:f.input.record,fact:fact(f.input.record,308)});expect(a.sha256).not.toBe(b.sha256);expect(await f.store.commitProviderFact({record:f.input.record,fact:fact(f.input.record,308)})).toEqual(b);const cold=new NarrationBundleStorage({projectId:'p1',storageRootDir:f.path});expect((await cold.readProviderFacts({record:f.input.record})).map(x=>x.fact.characters).sort()).toEqual([100,308]);
});
it('供应商事实拒绝跨run/source及损坏内容，不接受路径或秘密字段',async()=>{
 const f=await fixture();for(const patch of [{generationRunId:'other'},{sourceTextSha256:'a'.repeat(64)},{providerRequestKey:'../bad'},{secret:'key'}])await expect(f.store.commitProviderFact({record:f.input.record,fact:{...fact(f.input.record),...patch}})).rejects.toThrow();const saved=await f.store.commitProviderFact({record:f.input.record,fact:fact(f.input.record)});await writeFile(join(f.path,'narration-runs/run1/provider-facts',saved.sha256,'manifest.json'),'{}');await expect(f.store.readProviderFacts({record:f.input.record})).rejects.toThrow('narration_fact_invalid');
});


it('早期无身份unknown不阻塞最终ready事实，但不同provider任务不可混账',async()=>{
 const f=await fixture(),unknown={...fact(f.input.record,null),remoteOutcome:'unknown',providerTaskId:null};await f.store.commitProviderFact({record:{...f.input.record,providerTaskId:null},fact:unknown});await f.store.commitProviderFact({record:f.input.record,fact:fact(f.input.record)});const ready=await f.store.commitInitial(f.input);expect(await f.store.readProviderFacts({record:ready.record})).toHaveLength(2);
 await expect(f.store.commitProviderFact({record:{...f.input.record,providerTaskId:null},fact:{...fact(f.input.record),providerTaskId:'different-task'}})).rejects.toThrow('narration_fact_source_mismatch');
});
