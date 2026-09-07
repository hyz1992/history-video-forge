import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, lstat, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { NarrationRecord, NarrationSubtitleRevision, NarrationSubtitleTimelineV1, NarrationTimingMapV1,
  NarrationSubtitleSettingsSnapshot, NarrationFileReference, canonicalStringify, hashNarrationSettings } from '../../../../shared/src/index.js';
import { resolveStagedArtifactFile, writeStagedArtifactFile, validateStagedArtifactFile } from '../../runtime/files/artifact-file-commit.js';
import { assertNarrationPathInside, resolveNarrationFilePath } from '../assets/artifact-file-resolver.js';
import { buildNarrationSubtitles } from './narration-subtitle-builder.js';
import { NativeNarrationSentence, normalizeNarrationTiming } from './narration-timing-normalizer.js';

const sha=(data:string|Buffer)=>createHash('sha256').update(data).digest('hex');
const id=z.string().regex(/^[A-Za-z0-9_-]+$/);
const date=z.string().datetime({offset:true});
const JsonEvent=z.object({kind:z.literal('json'),elapsedMs:z.number().int().nonnegative(),data:z.unknown()}).strict();
const AudioEvent=z.object({kind:z.literal('audio'),elapsedMs:z.number().int().nonnegative(),byteOffset:z.number().int().nonnegative(),byteLength:z.number().int().positive()}).strict();
const Events=z.array(z.union([JsonEvent,AudioEvent])).min(1);
const InitialInput=z.object({record:NarrationRecord,audio:z.instanceof(Buffer),timingMap:NarrationTimingMapV1,nativeEvents:Events,
  subtitleSettings:NarrationSubtitleSettingsSnapshot,subtitleRevisionId:id,createdAt:date}).strict();
const Bundle=z.object({record:NarrationRecord,initialSubtitleRevision:NarrationSubtitleRevision,timeline:NarrationSubtitleTimelineV1}).strict();
const RevisionBundle=z.object({revision:NarrationSubtitleRevision,timeline:NarrationSubtitleTimelineV1}).strict();
type Bundle=z.infer<typeof Bundle>;
type RevisionBundle=z.infer<typeof RevisionBundle>;
type Recovery={status:'complete';bundle:Bundle}|{status:'missing'|'incomplete';reason:string};
const FactIdentity=z.string().min(1).max(256).refine(s=>s.trim()===s);
export const NarrationProviderFact=z.object({schemaVersion:z.literal('narration_provider_fact_v1'),projectId:id,generationRunId:id,configurationSnapshotId:id,
  providerRequestKey:z.string().min(1).max(512).regex(/^[A-Za-z0-9_.:-]+$/),sourceTextSha256:z.string().regex(/^[a-f0-9]{64}$/),settingsSha256:z.string().regex(/^[a-f0-9]{64}$/),
  providerTaskId:FactIdentity.nullable(),providerRequestId:FactIdentity.nullable(),characters:z.number().int().safe().nonnegative().nullable(),receiptKind:z.enum(['none','partial','final']),
  remoteOutcome:z.enum(['not_started','unknown','failed','completed']),errorCode:z.string().regex(/^narration_[a-z_]+$/).max(100).nullable(),durationMs:z.number().int().safe().positive().nullable(),canceled:z.boolean(),observedAt:date
}).strict().refine(f=>f.characters===null?f.receiptKind==='none':f.receiptKind!=='none'&&f.providerTaskId!==null);
export type NarrationProviderFact=z.infer<typeof NarrationProviderFact>;
const immutableKeys=['schemaVersion','id','projectId','scriptRecordId','generationRunId','createdAt','sourceTextSha256','settingsSha256','sourceProjectTtsSettingsSha256','textMappingVersion','configurationSnapshotId','settings','timingSource'] as const;
const same=(a:unknown,b:unknown)=>canonicalStringify(a)===canonicalStringify(b);
function sourceMatch(expected:NarrationRecord,actual:NarrationRecord){
  if(immutableKeys.some(key=>!same(expected[key],actual[key]))||
    (expected.providerTaskId!==null&&expected.providerTaskId!==actual.providerTaskId)||
    (expected.providerRequestId!==null&&expected.providerRequestId!==actual.providerRequestId)||
    (expected.spokenTextSha256!==null&&expected.spokenTextSha256!==actual.spokenTextSha256)||
    (expected.output!==null&&!same(expected.output,actual.output)))throw new Error('narration_bundle_source_mismatch');
}
function probeWav(audio:Buffer){
  if(audio.length<=44||audio.length>64*1024*1024+44||audio.toString('ascii',0,4)!=='RIFF'||audio.readUInt32LE(4)!==audio.length-8||
    audio.toString('ascii',8,16)!=='WAVEfmt '||audio.readUInt32LE(16)!==16||audio.readUInt16LE(20)!==1||audio.readUInt16LE(22)!==1||
    audio.readUInt32LE(24)!==24000||audio.readUInt32LE(28)!==48000||audio.readUInt16LE(32)!==2||audio.readUInt16LE(34)!==16||
    audio.toString('ascii',36,40)!=='data'||audio.readUInt32LE(40)!==audio.length-44||(audio.length-44)%2!==0)throw new Error('narration_bundle_audio_invalid');
  const sampleCount=(audio.length-44)/2;
  return {sampleCount,durationMs:Math.round(sampleCount*1000/24000)};
}
/** 重读原始事件重建时间图；完整结束事件、连续PCM帧及task来源缺一不可。 */
function timingFromEvents(events:z.infer<typeof Events>,record:NarrationRecord,audio:Buffer):NarrationTimingMapV1{
  const invalid=():never=>{throw new Error('narration_bundle_events_invalid');};
  let started=false,finished=false,open:number|null=null,bytes=0,elapsed=-1,requestId:string|null=null;
  const sentences:z.infer<typeof NativeNarrationSentence>[]=[];
  for(const event of events){
    if(finished||event.elapsedMs<elapsed)invalid();elapsed=event.elapsedMs;
    if(event.kind==='audio'){if(!started||event.byteOffset!==bytes)invalid();bytes+=event.byteLength;if(bytes>audio.length-44)invalid();continue;}
    const data=event.data as {header?:{event?:string;task_id?:string;attributes?:{request_uuid?:unknown}};payload?:{output?:{type?:string;sentence?:{index?:number;words?:unknown};original_text?:unknown;normalized_text?:unknown}}}|null;
    if(!record.providerTaskId||data?.header?.task_id!==record.providerTaskId)invalid();
    const uuid=data?.header?.attributes?.request_uuid;
    if(uuid!==undefined){
      if(typeof uuid!=='string'||!uuid||uuid.trim()!==uuid||(requestId!==null&&requestId!==uuid))invalid();
      requestId=uuid as string;
    }
    const kind=data?.header?.event,output=data?.payload?.output;
    if(kind==='task-started'){if(started)invalid();started=true;}
    else if(kind==='result-generated'){
      if(!started)invalid();
      if(output?.type==='sentence-begin'){if(open!==null||output.sentence?.index!==sentences.length)invalid();open=sentences.length;}
      else if(output?.type==='sentence-end'){
        if(open===null||output.sentence?.index!==open)invalid();
        const parsed=NativeNarrationSentence.safeParse({providerSentenceIndex:open,originalText:output.original_text,normalizedText:output.normalized_text,words:output.sentence?.words});
        if(!parsed.success)return invalid();sentences.push(parsed.data);open=null;
      }else if(output?.type!=='sentence-synthesis'||open===null||output.sentence?.index!==open)invalid();
    }else if(kind==='task-finished'){if(!started||open!==null||!sentences.length||bytes!==audio.length-44)invalid();finished=true;}
    else invalid();
  }
  if(!finished||requestId!==record.providerRequestId)invalid();
  // 原文段之间的空白由已冻结sourceText处理，调用者在下方再整体比较图。
  return normalizeNarrationTiming({sourceText:sentences.map(s=>s.originalText).join(''),audioHash:sha(audio),durationMs:probeWav(audio).durationMs,sentences});
}

/** 只管理磁盘候选；DB ready/active、租约及重试决策由调用方负责。 */
export class NarrationBundleStorage {
  constructor(private readonly options:{projectId:string;storageRootDir:string}){}
  private record(value:unknown):NarrationRecord{
    const record=NarrationRecord.parse(value);
    if(record.projectId!==this.options.projectId)throw new Error('narration_bundle_project_mismatch');
    if(!id.safeParse(record.generationRunId).success)throw new Error('narration_path_invalid');
    return record;
  }
  private run(record:NarrationRecord){return `narration-runs/${record.generationRunId}`;}
  private async path(record:NarrationRecord,uri:string){return resolveNarrationFilePath({projectStorageRootDir:this.options.storageRootDir,runId:record.generationRunId,fileUri:uri});}
  private async bytes(record:NarrationRecord,reference:NarrationFileReference){
    const ref=NarrationFileReference.parse({uri:reference.uri,sha256:reference.sha256}),path=await this.path(record,ref.uri);
    const data=await readFile(path);if(sha(data)!==ref.sha256)throw new Error('narration_bundle_hash_mismatch');return data;
  }
  /** 保留所有失败staging；不覆盖或自动清理已有目录。目录rename使manifest最后一次性可见。 */
  private async publish(record:NarrationRecord,directory:string,files:Record<string,string|Buffer>,manifest:unknown){
    const run=this.run(record),root=await assertNarrationPathInside(this.options.storageRootDir,run);
    await mkdir(root,{recursive:true});
    const operationId=randomUUID(),relativeDir=`.staging/${operationId}/payload`;
    const staging=await assertNarrationPathInside(this.options.storageRootDir,`${run}/${relativeDir}`);
    const final=await assertNarrationPathInside(this.options.storageRootDir,directory);
    for(const [name,data] of Object.entries({...files,'manifest.json':canonicalStringify(manifest)})){
      const file=resolveStagedArtifactFile({rootDir:root,operationId,relativeFinalPath:`payload/${name}`});
      await assertNarrationPathInside(this.options.storageRootDir,`${run}/${relativeDir}/${name}`);
      await writeStagedArtifactFile(file,data);await validateStagedArtifactFile(file);
      if(sha(await readFile(file.stagingPath))!==sha(data))throw new Error('narration_bundle_staging_hash_mismatch');
    }
    await assertNarrationPathInside(this.options.storageRootDir,directory);
    await mkdir(dirname(final),{recursive:true});
    // 最终目录存在即拒绝rename，不能以空目录/损坏manifest作为可覆盖状态。
    try{await lstat(final);return false;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    try{await rename(staging,final);return true;}
    catch(error){
      // 并发获胜者目录是非空完整bundle；重新完整读取后才能幂等返回。
      try{await lstat(final);return false;}catch{throw error;}
    }
  }
  private providerFact(record:NarrationRecord,value:unknown):NarrationProviderFact {
    const parsed=NarrationProviderFact.safeParse(value);
    if(!parsed.success)throw new Error('narration_fact_invalid');
    const fact=parsed.data;
    if(fact.projectId!==record.projectId||fact.generationRunId!==record.generationRunId||fact.configurationSnapshotId!==record.configurationSnapshotId||fact.sourceTextSha256!==record.sourceTextSha256||fact.settingsSha256!==record.settingsSha256||record.providerTaskId!==null&&fact.providerTaskId!==null&&record.providerTaskId!==fact.providerTaskId||record.providerRequestId!==null&&fact.providerRequestId!==null&&record.providerRequestId!==fact.providerRequestId)throw new Error('narration_fact_source_mismatch');
    return fact;
  }
  async commitProviderFact(value:unknown){
    const input=z.object({record:NarrationRecord,fact:z.unknown()}).strict().parse(value),record=this.record(input.record),fact=this.providerFact(record,input.fact);
    const existing=await this.readProviderFacts({record});
    this.assertFactIdentities([...existing.map(x=>x.fact),fact]);
    const hash=sha(canonicalStringify(fact));
    await this.publish(record,this.run(record)+'/provider-facts/'+hash,{},fact);
    const found=(await this.readProviderFacts({record})).find(f=>f.sha256===hash);
    if(!found)throw new Error('narration_fact_invalid');
    return found;
  }
  async readProviderFacts(value:unknown):Promise<Array<{sha256:string;fact:NarrationProviderFact}>>{
    const {record:input}=z.object({record:NarrationRecord}).strict().parse(value),record=this.record(input);
    const directory=this.run(record)+'/provider-facts',root=await assertNarrationPathInside(this.options.storageRootDir,directory);
    let names:string[];try{names=await readdir(root);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw error;}
    const facts:Array<{sha256:string;fact:NarrationProviderFact}>=[];
    for(const name of names.sort()){
      if(!/^[a-f0-9]{64}$/.test(name))throw new Error('narration_fact_invalid');
      const path=await assertNarrationPathInside(this.options.storageRootDir,directory+'/'+name+'/manifest.json');
      if((await lstat(path)).size>16384)throw new Error('narration_fact_invalid');
      let fact:NarrationProviderFact;try{fact=this.providerFact(record,JSON.parse(await readFile(path,'utf8')));}catch{throw new Error('narration_fact_invalid');}
      if(sha(canonicalStringify(fact))!==name)throw new Error('narration_fact_invalid');
      facts.push({sha256:name,fact});
    }
    this.assertFactIdentities(facts.map(x=>x.fact));
    return facts;
  }
  private assertFactIdentities(facts:NarrationProviderFact[]) {
    for(const key of ['providerRequestKey','providerTaskId','providerRequestId'] as const)if(new Set(facts.map(f=>f[key]).filter(v=>v!==null)).size>1)throw new Error('narration_fact_source_mismatch');
  }
  private async validateOriginals(record:NarrationRecord,audio:Buffer,timingMap:NarrationTimingMapV1,events:z.infer<typeof Events>){
    const probe=probeWav(audio);
    if(sha(audio)!==timingMap.audioHash||probe.durationMs!==timingMap.durationMs||sha(timingMap.sourceText)!==record.sourceTextSha256||
      await hashNarrationSettings(record.settings)!==record.settingsSha256)throw new Error('narration_bundle_source_mismatch');
    const derived=timingFromEvents(events,record,audio);
    if(!same(derived,timingMap))throw new Error('narration_bundle_events_mismatch');
    return probe;
  }
  async commitInitial(value:unknown):Promise<Bundle>{
    const parsed=InitialInput.safeParse(value);if(!parsed.success)throw new Error('narration_bundle_input_invalid');
    const input=parsed.data,record=this.record(input.record);
    if(record.status!=='generating'||record.output!==null||!record.providerTaskId)throw new Error('narration_bundle_candidate_required');
    const audio=Buffer.from(input.audio),probe=await this.validateOriginals(record,audio,input.timingMap,input.nativeEvents);
    const built=await buildNarrationSubtitles({timingMap:input.timingMap,settingsSnapshot:input.subtitleSettings});
    const directory=`${this.run(record)}/bundle`,timing=canonicalStringify(input.timingMap),events=canonicalStringify(input.nativeEvents);
    const ref=(name:string,data:string|Buffer)=>({uri:`${directory}/${name}`,sha256:sha(data)});
    const revision=NarrationSubtitleRevision.parse({id:input.subtitleRevisionId,projectId:record.projectId,narrationRecordId:record.id,audioHash:sha(audio),timingHash:sha(timing),
      subtitleSettingsSnapshotJson:built.settingsSnapshot,subtitleSettingsHash:built.settingsHash,builderVersion:built.builderVersion,srt:ref('captions.srt',built.srt),vtt:ref('captions.vtt',built.vtt),createdAt:input.createdAt});
    const ready=NarrationRecord.parse({...record,status:'ready',updatedAt:input.createdAt,spokenTextSha256:sha(input.timingMap.spokenText),
      output:{audio:{...ref('audio.wav',audio),sampleRate:24000,channels:1,bitDepth:16,sampleCount:probe.sampleCount},durationMs:probe.durationMs,nativeEvents:ref('events.json',events),
        timingMap:ref('timing.json',timing),initialSubtitleRevisionId:revision.id,validationReport:{status:'pass',validatorVersion:'narration-bundle/v1',checkedAt:input.createdAt,nativeTextCoverageComplete:true,nativeTimingValid:true,audioProbeValid:true,issues:[]}}});
    const bundle=Bundle.parse({record:ready,initialSubtitleRevision:revision,timeline:built.timeline});
    await this.publish(record,directory,{'audio.wav':audio,'events.json':events,'timing.json':timing,'captions.srt':built.srt,'captions.vtt':built.vtt},bundle);
    const recovered=await this.recoverInitial({record});
    if(recovered.status!=='complete')throw new Error(`narration_bundle_incomplete: ${recovered.reason}`);
    if(!same(recovered.bundle,bundle))throw new Error('narration_bundle_conflict');
    return recovered.bundle;
  }
  async recoverInitial(value:unknown):Promise<Recovery>{
    const {record:input}=z.object({record:NarrationRecord}).strict().parse(value),record=this.record(input);
    const manifestUri=`${this.run(record)}/bundle/manifest.json`;
    const path=await this.path(record,manifestUri);
    let text:string;
    try{text=await readFile(path,'utf8');}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return {status:'missing',reason:'narration_bundle_manifest_missing'};throw error;}
    try{
      const bundle=Bundle.parse(JSON.parse(text)),stored=this.record(bundle.record),output=stored.output;
      if(stored.status!=='ready'||!output)throw new Error('narration_bundle_ready_required');
      sourceMatch(record,stored);
      const directory=`${this.run(record)}/bundle`;
      if(output.audio.uri!==`${directory}/audio.wav`||output.timingMap.uri!==`${directory}/timing.json`||output.nativeEvents.uri!==`${directory}/events.json`)throw new Error('narration_bundle_reference_mismatch');
      const audio=await this.bytes(stored,output.audio),timingMap=NarrationTimingMapV1.parse(JSON.parse((await this.bytes(stored,output.timingMap)).toString('utf8'))),events=Events.parse(JSON.parse((await this.bytes(stored,output.nativeEvents)).toString('utf8')));
      const probe=await this.validateOriginals(stored,audio,timingMap,events);
      if(probe.sampleCount!==output.audio.sampleCount||probe.durationMs!==output.durationMs||sha(timingMap.spokenText)!==stored.spokenTextSha256)throw new Error('narration_bundle_source_mismatch');
      if(bundle.initialSubtitleRevision.id!==output.initialSubtitleRevisionId)throw new Error('narration_bundle_reference_mismatch');
      await this.validateSubtitle(stored,bundle.initialSubtitleRevision,bundle.timeline,timingMap,directory);
      return {status:'complete',bundle};
    }catch(error){return {status:'incomplete',reason:error instanceof Error?error.message:'narration_bundle_invalid'};}
  }
  private async complete(record:NarrationRecord){
    const result=await this.recoverInitial({record});if(result.status!=='complete')throw new Error('narration_bundle_incomplete');return result.bundle;
  }
  private async validateSubtitle(record:NarrationRecord,revision:NarrationSubtitleRevision,timeline:NarrationSubtitleTimelineV1,timingMap:NarrationTimingMapV1,directory:string){
    const output=record.output;
    if(!output||revision.projectId!==record.projectId||revision.narrationRecordId!==record.id||revision.audioHash!==output.audio.sha256||revision.timingHash!==output.timingMap.sha256||
      revision.srt.uri!==`${directory}/captions.srt`||revision.vtt.uri!==`${directory}/captions.vtt`)throw new Error('narration_subtitle_source_mismatch');
    const built=await buildNarrationSubtitles({timingMap,settingsSnapshot:revision.subtitleSettingsSnapshotJson});
    if(revision.subtitleSettingsHash!==built.settingsHash||revision.builderVersion!==built.builderVersion||!same(timeline,built.timeline)||
      (await this.bytes(record,revision.srt)).toString('utf8')!==built.srt||(await this.bytes(record,revision.vtt)).toString('utf8')!==built.vtt)throw new Error('narration_subtitle_content_mismatch');
  }
  async commitSubtitleRevision(value:unknown):Promise<RevisionBundle>{
    const input=z.object({record:NarrationRecord,revisionId:id,settingsSnapshot:NarrationSubtitleSettingsSnapshot,createdAt:date}).strict().parse(value),record=this.record(input.record);
    if(!record.output)throw new Error('narration_bundle_ready_required');
    await this.complete(record);
    if(input.revisionId===record.output.initialSubtitleRevisionId)throw new Error('narration_bundle_conflict');
    const timingMap=NarrationTimingMapV1.parse(JSON.parse((await this.bytes(record,record.output.timingMap)).toString('utf8')));
    const built=await buildNarrationSubtitles({timingMap,settingsSnapshot:input.settingsSnapshot}),directory=`${this.run(record)}/subtitles/${input.revisionId}`;
    const revision=NarrationSubtitleRevision.parse({id:input.revisionId,projectId:record.projectId,narrationRecordId:record.id,audioHash:record.output.audio.sha256,timingHash:record.output.timingMap.sha256,
      subtitleSettingsSnapshotJson:built.settingsSnapshot,subtitleSettingsHash:built.settingsHash,builderVersion:built.builderVersion,
      srt:{uri:`${directory}/captions.srt`,sha256:sha(built.srt)},vtt:{uri:`${directory}/captions.vtt`,sha256:sha(built.vtt)},createdAt:input.createdAt});
    const result={revision,timeline:built.timeline};
    await this.publish(record,directory,{'captions.srt':built.srt,'captions.vtt':built.vtt},result);
    const read=await this.readSubtitleRevision({record,revision});
    if(!same(read,result))throw new Error('narration_bundle_conflict');return read;
  }
  async readSubtitleRevision(value:unknown):Promise<RevisionBundle>{
    const input=z.object({record:NarrationRecord,revision:NarrationSubtitleRevision}).strict().parse(value),record=this.record(input.record),revision=input.revision;
    if(!record.output)throw new Error('narration_bundle_ready_required');
    const initial=await this.complete(record);
    if(revision.id===record.output.initialSubtitleRevisionId){if(!same(initial.initialSubtitleRevision,revision))throw new Error('narration_bundle_conflict');return {revision:initial.initialSubtitleRevision,timeline:initial.timeline};}
    id.parse(revision.id);
    const directory=`${this.run(record)}/subtitles/${revision.id}`,path=await this.path(record,`${directory}/manifest.json`);
    const result=RevisionBundle.parse(JSON.parse(await readFile(path,'utf8')));
    if(!same(result.revision,revision))throw new Error('narration_bundle_conflict');
    const timingMap=NarrationTimingMapV1.parse(JSON.parse((await this.bytes(record,record.output.timingMap)).toString('utf8')));
    await this.validateSubtitle(record,revision,result.timeline,timingMap,directory);return result;
  }
  /** 授权由路由/仓储先完成；返回已验hash的字节，避免路由再次无校验打开路径。 */
  async readFile(value:unknown):Promise<Buffer>{
    const input=z.object({record:NarrationRecord,kind:z.enum(['audio','timing','events','srt','vtt']),revision:NarrationSubtitleRevision.optional()}).strict().parse(value),record=this.record(input.record);
    if(!record.output)throw new Error('narration_bundle_ready_required');
    if(input.kind==='srt'||input.kind==='vtt'){
      if(!input.revision)throw new Error('narration_subtitle_required');
      await this.readSubtitleRevision({record,revision:input.revision});return this.bytes(record,input.revision[input.kind]);
    }
    if(input.revision)throw new Error('narration_subtitle_kind_invalid');
    await this.complete(record);return this.bytes(record,input.kind==='audio'?record.output.audio:input.kind==='timing'?record.output.timingMap:record.output.nativeEvents);
  }
}
