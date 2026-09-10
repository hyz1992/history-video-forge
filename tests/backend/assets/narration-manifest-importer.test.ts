import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, writeFile, mkdir, readdir, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { DEFAULT_SUBTITLE_STYLE, hashNarrationSettings, type NarrationRecord } from '../../../shared/src/index.js';
import { normalizeNarrationTiming } from '../../../backend/src/modules/narration/narration-timing-normalizer.js';
import { NarrationBundleStorage } from '../../../backend/src/modules/narration/narration-bundle-storage.js';


const sha=(data:string|Buffer)=>createHash('sha256').update(data).digest('hex');
const now='2026-09-06T10:00:00.000Z';
const roots:string[]=[];
const disposers:Array<()=>Promise<void>>=[];
afterEach(async()=>{vi.restoreAllMocks();for(const close of disposers.splice(0))await close();for(const path of roots.splice(0))await rm(path,{recursive:true,force:true});});
async function fixture(){
  const path=await mkdtemp(join(tmpdir(),'narration-bundle-'));roots.push(path);
  const audio=Buffer.alloc(5616044);audio.write('RIFF');audio.writeUInt32LE(5616036,4);audio.write('WAVEfmt ',8);audio.writeUInt32LE(16,16);audio.writeUInt16LE(1,20);audio.writeUInt16LE(1,22);audio.writeUInt32LE(24000,24);audio.writeUInt32LE(48000,28);audio.writeUInt16LE(2,32);audio.writeUInt16LE(16,34);audio.write('data',36);audio.writeUInt32LE(5616000,40);
  const settings={model:'qwen-audio-3.0-tts-plus',voice:'qwen-audio-3.0-tts-plus-longyimuling',region:'cn-beijing',protocol:'dashscope_ws',parametersVersion:'neutral-pcm24k-v1',tone:'neutral',rate:1,pitch:1,volume:50,sampleRate:24000,format:'pcm',textType:'PlainText',wordTimestampEnabled:true,enableSsml:false,seed:0,inputMode:'natural_paragraphs_single_task'} as const;
  const words=[{text:'甲',begin_index:0,end_index:1,begin_time:0,end_time:6400},{text:'乙',begin_index:1,end_index:2,begin_time:6400,end_time:116000}];
  const timingMap=normalizeNarrationTiming({sourceText:'甲乙',audioHash:sha(audio),durationMs:117000,sentences:[{providerSentenceIndex:0,originalText:'甲乙',normalizedText:'甲乙',words}]});
  const event=(name:string,output?:unknown)=>({kind:'json',elapsedMs:0,data:{header:{event:name,task_id:'task'},payload:output===undefined?{}:{output}}});
  const nativeEvents=[event('task-started'),event('result-generated',{type:'sentence-begin',sentence:{index:0}}),{kind:'audio',elapsedMs:0,byteOffset:0,byteLength:5616000},event('result-generated',{type:'sentence-end',sentence:{index:0,words},original_text:'甲乙',normalized_text:'甲乙'}),event('task-finished')];
  const record:NarrationRecord={schemaVersion:'narration_record_v1',id:'n1',projectId:'p1',scriptRecordId:'s1',generationRunId:'run1',createdAt:now,updatedAt:now,sourceTextSha256:sha('甲乙'),spokenTextSha256:null,settingsSha256:await hashNarrationSettings(settings),sourceProjectTtsSettingsSha256:sha('settings'),textMappingVersion:'narration-native-spans/v1',configurationSnapshotId:'snap1',settings,timingSource:'provider_native',providerTaskId:'task',providerRequestId:null,status:'generating',errorCode:null,confirmedAt:null,confirmedBy:null,acceptedDurationBandSnapshot:null,output:null};
  const subtitleSettings={presetId:null,presetVersion:null,resolvedStyle:{...DEFAULT_SUBTITLE_STYLE},overrides:{},lineBreak:{strategy:'punctuation_and_length' as const,maxCharactersPerLine:20,version:'v1'},resolverVersion:'v1'};
  return {path,store:new NarrationBundleStorage({projectId:'p1',storageRootDir:path}),input:{record,audio,timingMap,nativeEvents,subtitleSettings,subtitleRevisionId:'sub1',createdAt:now}};
}
import { canonicalStringify, AssetManifestV2 } from "../../../shared/src/index.js";
import { projectStoryboardTiming } from "../../../backend/src/modules/storyboard/storyboard-timing-projector.js";
import { compileNarrationAssetPlan } from "../../../backend/src/modules/asset-planning/narration-reference-compiler.js";
import { importNarrationManifest } from "../../../backend/src/modules/assets/narration-manifest-importer.js";
import { createDashscopeImageToVideoProvider } from "../../../backend/src/modules/assets/providers/dashscope/dashscope-image-to-video-provider.js";

async function prepared(projectSettingsHash?: string) {
  const f = await fixture();
  if (projectSettingsHash) f.input.record.sourceProjectTtsSettingsSha256 = projectSettingsHash;
  const bundle = await f.store.commitInitial(f.input);
  const record = { ...bundle.record, status: "confirmed" as const, confirmedAt: now, confirmedBy: "owner", acceptedDurationBandSnapshot: { minMs: 100000, maxMs: 120000 } };
  const timingMap = f.input.timingMap;
  const narrationReference = { narration_record_id: record.id, audio_hash: record.output!.audio.sha256, timing_map_hash: sha(canonicalStringify(timingMap)), duration_ms: 117000 };
  const visual = { narrative_role: "opening", visual_intent: "城门", scene_description: "城门", visual_elements: ["门"], framing_hint: "wide", content_type: "live_action", motion_hint: "static", editing_hint: "single", on_screen_text: [], linked_beats: [], linked_quotes: [], risk_notes: [], api_video_suitability: "api_video_beneficial" };
  const storyboard = projectStoryboardTiming({ timingMap, narrationReference, plan: { plan_version: "storyboard_v2", source_script_record_id: "s1", source_topic_package_id: "t1", global_visual_notes: [], segments: [0,1].map(i => ({ ...visual, segment_id: "s"+i, order:i, start_boundary_id:timingMap.boundaries[i]!.id,end_boundary_id:timingMap.boundaries[i+1]!.id })) } });
  const plan = compileNarrationAssetPlan({ sourceIds:{storyboardRecordId:"sb",scriptRecordId:"s1",topicPackageId:"t1"},storyboard,narrationTiming:{timingMap,narrationReference},draft:{script_text:"甲乙",estimated_duration_sec:117,opening_span:"甲",ending_span:"乙",beat_trace:[],quote_trace:[]},
    globalDraft:{art_bible:{era_style:"古代",visual_tone:"写实",characters:[],locations:[],props:[],global_prompt_prefix:"古代",global_negative_prompts:[],consistency_notes:[]},visual_budget:{},downgrade_policy:{},global_audio_strategy:{},manual_review_notes:["复核"]},
    segmentVisualRoutes:new Map(storyboard.segments.map(s=>[s.segment_id,{segment_id:s.segment_id,segment_override:null,api_video_suitability:s.api_video_suitability,resolved_route:"api_video" as const,reason_code:"test"}])),
    chunks:[{chunkIndex:0,inputSegmentIds:["s0","s1"],draft:{planning_mode:"segment_intent_batch",budget_notes:[],segments:storyboard.segments.map((s,i)=>({source_segment_id:s.segment_id,intents:[
      {asset_kind:"image_still" as const,production_intent:"门",image_prompt:"门",video_prompt_reserve:"门",image_role:"anchor" as const,support_reason:null,risk_notes:["核对"]},
      {asset_kind:"video_clip" as const,production_intent:"推门",video_prompt:"推门",why_static_insufficient:"动作",risk_notes:["核对"]},
      {asset_kind:"render_motion_cue" as const,production_intent:"推进",risk_notes:["缓慢"]},
      ...(i?[]:[{asset_kind:"bgm_cue" as const,production_intent:"配乐",required_tags:["弦乐"],mood_tags:["紧张"],selection_label:"配乐",timing_basis:"tts" as const,scope:"global" as const,segment_ids:[],volume:0.2,fade_in_sec:0,fade_out_sec:1,risk_notes:[]}])]}))}}]}).plan;
  return { ...f, record, storyboard, revision:bundle.initialSubtitleRevision, assetPlan:plan, assetPlanRecordId:"ap",storageRootDir:f.path };
}

describe("Task9B 口播manifest导入",()=>{
  it("整篇音频只登记一次、无TTS执行/分块，每镜带真实range",async()=>{
    const f=await prepared(),m=await importNarrationManifest(f);
    expect(AssetManifestV2.parse(m)).toEqual(m);
    expect(m.artifacts.filter(a=>a.artifact_type==="tts_merged_audio")).toHaveLength(1);
    expect(m.artifacts.some(a=>a.artifact_type==="tts_chunk_audio")).toBe(false);
    expect(m.executions.some(e=>e.task_type==="tts_audio"||e.task_type==="subtitle_track")).toBe(false);
    expect(m.segment_routes[0]!.narrationRange).toEqual({startMs:0,endMs:6400});
    expect(new Set(m.segment_routes.map(r=>r.tts_artifact_id)).size).toBe(1);
    expect(m.audio_summary.tts_chunk_routes).toEqual([]);
  });
  it("完整字幕样式、revision和provider原生来源映射",async()=>{
    const f=await prepared(),m=await importNarrationManifest(f),sub=m.artifacts.find(a=>a.artifact_type==="subtitle_track")!;
    expect(sub.metadata).toMatchObject({timing_source:"provider_timestamp",subtitle_style:f.revision.subtitleSettingsSnapshotJson.resolvedStyle,narration_record_id:f.record.id,audio_hash:f.record.output!.audio.sha256,timing_map_hash:f.record.output!.timingMap.sha256,subtitle_revision_id:f.revision.id,subtitle_settings_hash:f.revision.subtitleSettingsHash});
    const corrupted=structuredClone(m);delete (corrupted.artifacts.find(a=>a.artifact_type==="subtitle_track")!.metadata as any).timing_source;
    expect(AssetManifestV2.safeParse(corrupted).success).toBe(false);
  });
  it("拒绝执行样式与字幕冻结样式不一致",async()=>{
    const m=await importNarrationManifest(await prepared());
    m.execution_options.subtitle_style={...m.execution_options.subtitle_style!,font_size_px:60};
    expect(AssetManifestV2.safeParse(m).success).toBe(false);
  });
  it.each(["settings","hash","disk"])("拒绝不一致或损坏的%s",async mutation=>{
    const f=await prepared();
    if(mutation==="settings")f.revision.subtitleSettingsSnapshotJson.resolvedStyle.font_size_px=60;
    if(mutation==="hash")f.assetPlan.narration_reference.audio_hash="b".repeat(64);
    if(mutation==="disk")await writeFile(join(f.path,f.record.output!.timingMap.uri),"{}");
    await expect(importNarrationManifest(f)).rejects.toThrow();
  });
  it("117秒音频中的6.4秒镜头按7秒规格生成，不按整篇音频拆分",async()=>{
    const f=await prepared(),manifest=await importNarrationManifest(f),task=f.assetPlan.tasks.find(t=>t.task_type==="video_clip")!;
    const imagePath=join(f.path,"image.png");await writeFile(imagePath,Buffer.from([137,80,78,71]));
    manifest.artifacts.push({artifact_id:"img",artifact_type:"image",origin:"local",file_uri:imagePath,created_at:now,metadata:{width:720,height:1280}});
    manifest.segment_routes[0]!.primary_visual_artifact_id="img";
    const provider=createDashscopeImageToVideoProvider({apiKey:"test",model:"wan2.6-i2v"});
    const result=await provider.prepare({manifest,planTask:task,assetPlan:f.assetPlan,projectStorageRootDir:f.path,assetRunId:"assets",execution:manifest.executions.find(e=>e.task_id===task.task_id)} as any);
    expect(result.rawRequestJson.duration_sec).toBe(7);
    expect(result.rawRequestJson.split_plan).toBeUndefined();
  });
});

import { createDbClient } from "../../../backend/src/db/client.js";
import { executeAssetManifest } from "../../../backend/src/modules/assets/assets-execution-engine.js";
import { NarrationSourceError } from "../../../backend/src/modules/narration/narration-invalidation.js";
describe("Task9B 执行派发来源闸门",()=>{
  it.each(["prepare", "submit", "poll"])("%s期间来源变化不继续派发或接受迟到结果",async change=>{
    const f=await prepared(), manifest=await importNarrationManifest(f), db=createDbClient();
    let stale=false;
    const adapter={providerName:"test",providerType:"image" as const,canHandle:()=>true,
      prepare:vi.fn(async()=>{if(change==="prepare")stale=true;return{providerJobId:null,rawRequestJson:{}};}),
      submit:vi.fn(async()=>{if(change==="submit")stale=true;return{providerJobId:"job",rawResponseJson:{}};}),
      poll:vi.fn(async()=>{if(change==="poll")stale=true;return{status:"completed" as const,rawResponseJson:{}};}),
      download:vi.fn(async()=>[]),normalizeResult:vi.fn(async()=>({artifacts:[],notes:[]})),cancel:vi.fn(async()=>{})};
    await expect(executeAssetManifest({db,manifest,assetPlan:f.assetPlan,assetManifestRecordId:"m",assetRunId:"run",projectStorageRootDir:f.path,registry:{findAdapter:()=>adapter},beforeDispatch:async()=>{if(stale)throw new NarrationSourceError("narration_assets_source_stale");}})).rejects.toThrow("narration_assets_source_stale");
    expect(adapter.download).not.toHaveBeenCalled();
    if(change==="prepare")expect(adapter.submit).not.toHaveBeenCalled();
    if(change==="submit")expect(adapter.poll).not.toHaveBeenCalled();
    expect(sha(await readFile(join(f.path,f.record.output!.audio.uri)))).toBe(f.record.output!.audio.sha256);
  });
});

import { createLegacyProject as createProject } from "../projects/legacy-project.fixture.js";
import { runAssetsGeneration } from "../../../backend/src/modules/assets/assets-run.service.js";
import { projectTtsHash } from "../../../backend/src/modules/narration/narration-invalidation.js";
import { buildPricingCatalogSeed } from "../../../backend/src/modules/generation-cost/pricing-catalog.seed.js";
import { seedGlobalVoiceProfiles } from "../../../backend/src/modules/assets/voice/voice-profile.repository.js";
import * as chunking from "../../../backend/src/modules/assets/tts-chunking.service.js";
import * as voices from "../../../backend/src/modules/assets/voice/voice-resolution.service.js";
async function runnable(){
  const db=createDbClient(), generate=db.generateId;db.generateId=vi.fn().mockReturnValueOnce("p1").mockImplementation(generate);
  const project=await createProject(db,{name:"Task9B"});
  const config=[...db.projectGenerationConfigurations.values()][0]!;
  const f=await prepared(projectTtsHash(config.configurationJson));
  Object.assign(project,{narrationTimingMode:"narration_first_v1",storageRootDir:f.path,activeTopicPackageId:"t1",activeScriptRecordId:"s1",activeNarrationRecordId:"n1",activeNarrationSubtitleRevisionId:"sub1",activeStoryboardRecordId:"sb",activeAssetPlanRecordId:"ap"});
  db.narrationRecords.set("n1",f.record);db.narrationSubtitleRevisions.set("sub1",f.revision);
  db.scriptRecords.set("s1",{id:"s1",projectId:"p1",topicPackageId:"t1",scriptText:"甲乙",validationResultJson:{stage:"script_local_validation",decision:"pass",errors:[],warnings:[],metrics:{}}} as any);
  db.scriptConfirmations.set("s1",{scriptRecordId:"s1",projectId:"p1",sourceTextSha256:sha("甲乙"),confirmedAt:new Date(),confirmedBy:project.ownerId});
  db.topicPackages.set("t1",{id:"t1",projectId:"p1",durationBandJson:{min_sec:100,max_sec:120}} as any);
  db.storyboardRecords.set("sb",{id:"sb",projectId:"p1",scriptRecordId:"s1",topicPackageId:"t1",planJson:f.storyboard} as any);
  db.assetPlanRecords.set("ap",{id:"ap",projectId:"p1",scriptRecordId:"s1",topicPackageId:"t1",storyboardRecordId:"sb",planJson:f.assetPlan} as any);
  for(const row of buildPricingCatalogSeed({llm:{mode:"stub"},media:{deploymentScope:"cn-beijing"}}))db.providerModelCatalog.set(row.id,row);
  await seedGlobalVoiceProfiles(db);
  return{...f,db,project};
}
describe("Task9B 完整资产入口",()=>{
  it("生成全部与失败重试复用同一音频字幕，不执行旧TTS分块或音色选择",async()=>{
    const f=await runnable(),normalize=vi.spyOn(chunking,"normalizeAssetPlanTtsForExecution"),resolve=vi.spyOn(voices,"resolveVoiceProfile");
    const run=()=>runAssetsGeneration({db:f.db,project:f.project,voiceProfileId:"unused",executionMode:"auto_available",enabledProviderTypes:["image","bgm","sfx"]});
    const first=await run();expect(first.statusCode,JSON.stringify(first.body)).toBe(200);
    const second=await runAssetsGeneration({db:f.db,project:f.project,voiceProfileId:"unused",executionMode:"auto_available",missingOnly:true,enabledProviderTypes:["image","bgm","sfx"]});
    expect(second.statusCode,JSON.stringify(second.body)).toBe(200);
    expect(normalize).not.toHaveBeenCalled();expect(resolve).not.toHaveBeenCalled();
    const m=(second.body as any).manifest;expect(AssetManifestV2.safeParse(m).success).toBe(true);
    expect(m.artifacts.filter((a:any)=>a.artifact_type==="tts_merged_audio")).toHaveLength(1);
    expect(sha(await readFile(join(f.path,f.record.output!.audio.uri)))).toBe(f.record.output!.audio.sha256);
  });
});

import * as manifests from "../../../backend/src/modules/assets/asset-manifest-record.repository.js";
describe("Task9B 最后激活窗口",()=>{
  it.each(["narration", "subtitle"])("候选保存期间%s切换不能恢复旧active manifest",async change=>{
    const f=await runnable(),save=manifests.saveAssetManifestRecord;
    let reached=false;
    vi.spyOn(manifests,"saveAssetManifestRecord").mockImplementation(async(db,input)=>{
      const record=await save(db,input);
      if(input.id && !(input.executionStateJson as any)?.generating){
        reached=true;
        if(change==="narration")Object.assign(f.project,{activeNarrationRecordId:null,activeNarrationSubtitleRevisionId:null});
        else {f.db.narrationSubtitleRevisions.set("sub2",{...f.revision,id:"sub2"});f.project.activeNarrationSubtitleRevisionId="sub2";}
        f.project.activeAssetManifestRecordId=null;
      }
      return record;
    });
    await expect(runAssetsGeneration({db:f.db,project:f.project,voiceProfileId:"unused",executionMode:"dry_run"})).rejects.toThrow();
    expect(reached).toBe(true);expect(f.project.activeAssetManifestRecordId).toBeNull();
    expect([...f.db.assetManifestRecords.values()].every(r=>(r.executionStateJson as any)?.activated!==true)).toBe(true);
  });
});

import Database from "better-sqlite3";
import { applyAllDatabaseMigrations } from "../db/migration-test-utils.js";
import { createPrismaClient } from "../../../backend/src/db/prisma-client.js";
import { PrismaFirstAggregateWriter } from "../../../backend/src/db/repositories/prisma-first-aggregate-writer.js";
import { PrismaSecondAggregateWriter } from "../../../backend/src/db/repositories/prisma-second-aggregate-writer.js";
import { PrismaThirdAggregateWriter } from "../../../backend/src/db/repositories/prisma-third-aggregate-writer.js";
import { NarrationRepository } from "../../../backend/src/modules/narration/narration.repository.js";
async function persistentRunnable(){
  const f=await runnable(),file=join(f.path,"test.db"),sql=new Database(file);applyAllDatabaseMigrations(sql);sql.close();
  const client=await createPrismaClient(file);disposers.push(()=>client.$disconnect());
  await client.user.create({data:{id:f.project.ownerId,username:"owner",displayName:"owner",passwordHash:"hash"}});
  await client.project.create({data:{id:"p1",ownerId:f.project.ownerId,createdById:f.project.ownerId,name:"Task9B",storageKey:"p1",storageDisplayName:"Task9B",status:"asset_plan_ready",narrationTimingMode:"narration_first_v1"}});
  await client.topicPackage.create({data:{id:"t1",projectId:"p1",title:"城门",selectedAngle:"选择",familyLabel:"f",scopeLabel:"s",coreConflict:"守城",strongScene:"门",packagingSeed:"选择",canonicalQuotesJson:[],canonicalQuoteIntentsJson:[],durationBandJson:{min_sec:100,max_sec:120},narrativeTensionMapJson:{},mustIncludeBeatsJson:[],forbiddenExpansionsJson:[],riskHintsJson:[],sourceAnchorRefsJson:[],ambiguityNotesJson:[]}});
  await client.scriptRecord.create({data:{id:"s1",projectId:"p1",topicPackageId:"t1",scriptText:"甲乙",openingSpan:"甲",endingSpan:"乙",estimatedDurationSec:117,beatTraceJson:[],quoteTraceJson:[],reviewStatus:"pass",validationResultJson:{stage:"script_local_validation",decision:"pass",errors:[],warnings:[],metrics:{}}}});
  await client.storyboardRecord.create({data:{id:"sb",projectId:"p1",topicPackageId:"t1",scriptRecordId:"s1",planJson:f.storyboard,validationResultJson:{decision:"pass"}}});
  await client.assetPlanRecord.create({data:{id:"ap",projectId:"p1",topicPackageId:"t1",scriptRecordId:"s1",storyboardRecordId:"sb",planJson:f.assetPlan,validationResultJson:{decision:"pass"},executionStateJson:{}}});
  const config=[...f.db.projectGenerationConfigurations.values()][0]!;
  await client.projectGenerationConfiguration.create({data:config as any});
  await client.scriptConfirmation.create({data:f.db.scriptConfirmations.get("s1")!});
  await client.project.update({where:{id:"p1"},data:{activeTopicPackageId:"t1",activeScriptRecordId:"s1",activeStoryboardRecordId:"sb",activeAssetPlanRecordId:"ap"}});
  await client.runConfigurationSnapshot.create({data:{id:"snap1",projectId:"p1",stage:"script",operation:"script.narration.generate",runId:"run1",projectConfigurationRevision:1,schemaVersion:"run_configuration_snapshot_v1",configurationHash:"a".repeat(64),resolvedConfigurationJson:{},resolutionTraceJson:[],pricingVersionSetJson:[]}});
  await client.generationRun.create({data:{id:"run1",projectId:"p1",operation:"script.narration.generate",idempotencyKey:"run1",payloadFingerprint:"a".repeat(64),runConfigurationSnapshotId:"snap1",dispatchPayloadJson:{},status:"succeeded"}});
  f.db.firstAggregateWriter=await PrismaFirstAggregateWriter.create(client,f.project.ownerId);
  f.db.secondAggregateWriter=new PrismaSecondAggregateWriter(client,f.project.ownerId);
  f.db.thirdAggregateWriter=new PrismaThirdAggregateWriter(client);
  f.db.narrationPersistence.prismaClient=client;
  const repo=new NarrationRepository(f.db);
  await repo.createCandidate(f.project.ownerId,{...f.record,status:"generating",output:null,spokenTextSha256:null,confirmedAt:null,confirmedBy:null,acceptedDurationBandSnapshot:null});
  await repo.saveReadyBundle(f.project.ownerId,{...f.record,status:"ready",confirmedAt:null,confirmedBy:null,acceptedDurationBandSnapshot:null},f.revision);
  await client.narrationRecord.update({where:{id:"n1"},data:{status:"confirmed",confirmedAt:new Date(now),confirmedBy:f.project.ownerId,acceptedDurationBandSnapshotJson:f.record.acceptedDurationBandSnapshot!}});
  await client.project.update({where:{id:"p1"},data:{activeNarrationRecordId:"n1",activeNarrationSubtitleRevisionId:"sub1"}});
  f.db.narrationRecords.set("n1",f.record);
  return{...f,client};
}
describe("Task9B R1 数据库重试基线",()=>{
  it.each(["same", "cold"])("%s实例重试读取DB当前manifest而不重复完成图片",async mode=>{
    const f=await persistentRunnable();
    const args={db:f.db,project:f.project,voiceProfileId:"unused",executionMode:"auto_available",enabledProviderTypes:["image","bgm","sfx"]};
    const first=await runAssetsGeneration(args);expect(first.statusCode,JSON.stringify(first.body)).toBe(200);
    const imageJobs=()=>[...f.db.assetProviderJobRecords.values()].filter(j=>j.providerType==="image").length;
    const count=imageJobs();expect(count).toBe(2);
    if(mode==="cold"){f.db.assetManifestRecords.clear();f.project.activeAssetManifestRecordId=null;}
    const second=await runAssetsGeneration({...args,missingOnly:true});expect(second.statusCode,JSON.stringify(second.body)).toBe(200);
    expect(imageJobs()).toBe(count);
    expect(AssetManifestV2.safeParse((second.body as any).manifest).success).toBe(true);
  });
});

describe("Task9B R1 已派发费用留痕",()=>{
  it.each(["submit","poll","partial","prepare"])("%s期间来源失效只保留已派发费用且不下载",async change=>{
    const f=await prepared(),manifest=await importNarrationManifest(f),db=createDbClient();let stale=false;
    db.generationRuns.set("assets",{id:"assets",projectId:"p1",runConfigurationSnapshotId:"snapshot"} as any);
    db.runConfigurationSnapshots.set("snapshot",{id:"snapshot",projectId:"p1",resolvedConfigurationJson:{},pricingVersionSetJson:[]} as any);
    const adapter={providerName:"test",providerType:"image" as const,billing:{capability:"image.generate" as const,providerKey:"dashscope",modelId:"test-model"},canHandle:()=>true,
      prepare:async()=>{if(change==="prepare")stale=true;return{providerJobId:null,rawRequestJson:{}};},
      submit:async(ctx:any)=>{ctx.onDispatch?.();if(change==="partial")throw new NarrationSourceError("narration_assets_source_stale");if(change==="submit")stale=true;return{providerJobId:"paid-job",rawResponseJson:{}};},
      poll:async()=>{if(change==="poll")stale=true;return{status:"completed" as const,rawResponseJson:{}};},
      download:vi.fn(async()=>[]),normalizeResult:async()=>({artifacts:[],notes:[]}),cancel:async()=>{}};
    await expect(executeAssetManifest({db,manifest,assetPlan:f.assetPlan,assetManifestRecordId:"m",assetRunId:"assets",projectStorageRootDir:f.path,registry:{findAdapter:()=>adapter},beforeDispatch:async()=>{if(stale)throw new NarrationSourceError("narration_assets_source_stale");}})).rejects.toThrow("narration_assets_source_stale");
    expect(adapter.download).not.toHaveBeenCalled();expect(db.usageCostRecords.size).toBe(change==="prepare"?0:1);
    if(change==="prepare")return;
    const usage=[...db.usageCostRecords.values()][0]!;expect(usage.capability).toBe("image.generate");expect(usage.providerRequestKey).toContain("assets:");
  });
});

async function readyVisuals(f:Awaited<ReturnType<typeof prepared>>){
  const manifest=await importNarrationManifest(f),imagePath=join(f.path,"anchor.png");await writeFile(imagePath,Buffer.from([137,80,78,71]));
  for(const task of f.assetPlan.tasks.filter(t=>t.task_type==="image_still")){
    const id="anchor_"+task.task_id,execution=manifest.executions.find(e=>e.task_id===task.task_id)!;
    manifest.artifacts.push({artifact_id:id,artifact_type:"image",origin:"local",file_uri:imagePath,created_at:now,metadata:{width:720,height:1280}});
    execution.status="completed";execution.output_artifact_ids=[id];
    const route=manifest.segment_routes.find(r=>r.segment_id===task.source_segment_id)!;
    route.primary_visual_artifact_id=id;route.fallback_visual_artifact_id=id;route.video_strategy="prefer_api_video";
  }
  return manifest;
}
describe("Task9B R1 视频范围对抗",()=>{
  it("110.6秒镜头沿用8段14秒拆分而不改变口播",async()=>{
    const f=await prepared(),manifest=await readyVisuals(f),task=f.assetPlan.tasks.find(t=>t.task_type==="video_clip"&&t.source_segment_id==="s1")!;
    const provider=createDashscopeImageToVideoProvider({apiKey:"test",model:"wan2.6-i2v"});
    const request=await provider.prepare({manifest,assetPlan:f.assetPlan,planTask:task,execution:manifest.executions.find(e=>e.task_id===task.task_id)!,assetManifestRecordId:"m",assetRunId:"assets",projectStorageRootDir:f.path});
    expect(request.rawRequestJson.split_total).toBe(8);expect(request.rawRequestJson.duration_sec).toBe(14);
    expect(manifest.segment_routes[1]!.narrationRange).toEqual({startMs:6400,endMs:117000});
    expect(sha(await readFile(join(f.path,f.record.output!.audio.uri)))).toBe(f.record.output!.audio.sha256);
  });
  it.each(["short","failed"])("%s视频显式fallback且音频与镜头范围不变",async kind=>{
    const f=await prepared(),manifest=await readyVisuals(f),ranges=manifest.segment_routes.map(r=>r.narrationRange);
    const adapter={providerName:"test",providerType:"video" as const,canHandle:()=>true,
      prepare:async()=>({providerJobId:null,rawRequestJson:{}}),submit:async()=>({providerJobId:"job",rawResponseJson:{}}),
      poll:async()=>({status:kind==="failed"?"failed" as const:"completed" as const,rawResponseJson:{},errorCode:"test_video_failed"}),
      download:async(ctx:any)=>[{artifact_id:"clip_"+ctx.planTask.task_id,artifact_type:"video" as const,origin:"provider" as const,file_uri:join(f.path,"short.mp4"),created_at:now,metadata:{duration_sec:1,width:720,height:1280,fps:24}}],
      normalizeResult:async({downloadedArtifacts}:any)=>({artifacts:downloadedArtifacts,notes:[]}),cancel:async()=>{}};
    const result=await executeAssetManifest({db:createDbClient(),manifest,assetPlan:f.assetPlan,assetManifestRecordId:"m",assetRunId:"assets",projectStorageRootDir:f.path,registry:{findAdapter:({taskType})=>taskType==="video_clip"?adapter:null},beforeDispatch:async()=>{}});
    expect(result.manifest.segment_routes[0]!.fallback_decision).toBe("automatic");
    expect(result.manifest.segment_routes[0]!.route_events.some(e=>e.event_type==="automatic_fallback")).toBe(true);
    expect(result.manifest.segment_routes.map(r=>(r as any).narrationRange)).toEqual(ranges);
    expect(sha(await readFile(join(f.path,f.record.output!.audio.uri)))).toBe(f.record.output!.audio.sha256);
  });
});

import * as videoProbe from "../../../backend/src/http/video-probe.js";
describe("Task9B R1 视频文件长度探测",()=>{
  it.each(["short","unavailable"])("%s不把请求时长冒充实际长度",async kind=>{
    const f=await prepared(),manifest=await readyVisuals(f),task=f.assetPlan.tasks.find(t=>t.task_type==="video_clip")!;
    vi.spyOn(globalThis,"fetch").mockResolvedValue(new Response("offline-video"));
    const probe=vi.spyOn(videoProbe,"probeVideoMetadata");
    if(kind==="short")probe.mockResolvedValue({duration_sec:1,width:720,height:1280,fps:24});else probe.mockRejectedValue(new Error("ffprobe_not_available"));
    const provider=createDashscopeImageToVideoProvider({apiKey:"test",model:"wan2.6-i2v"});
    const work=provider.download({manifest,assetPlan:f.assetPlan,planTask:task,execution:manifest.executions.find(e=>e.task_id===task.task_id)!,assetManifestRecordId:"m",assetRunId:"assets",projectStorageRootDir:f.path},{status:"completed",rawResponseJson:{output:{video_url:"https://example.test/video.mp4"},duration_sec:7,split_total:2,split_index:0}});
    if(kind==="short")expect((await work)[0]!.metadata).toMatchObject({duration_sec:1,video_split_group_id:`assets:${manifest.executions.find(e=>e.task_id===task.task_id)!.execution_id}:0`});else await expect(work).rejects.toThrow("ffprobe_not_available");
    expect(probe).toHaveBeenCalledTimes(1);expect(sha(await readFile(join(f.path,f.record.output!.audio.uri)))).toBe(f.record.output!.audio.sha256);
  });
});

describe("Task9B R1 数据库最后激活窗口",()=>{
  it.each(["narration","subtitle"])("候选保存后DB%s切换禁止激活",async change=>{
    const f=await persistentRunnable(),save=manifests.saveAssetManifestRecord;let reached=false;
    vi.spyOn(manifests,"saveAssetManifestRecord").mockImplementation(async(db,input)=>{
      const record=await save(db,input);
      if(input.id && !(input.executionStateJson as any)?.generating){
        reached=true;
        if(change==="narration")await f.client.project.update({where:{id:"p1"},data:{activeNarrationRecordId:null,activeNarrationSubtitleRevisionId:null}});
        else {const old=await f.client.narrationSubtitleRevision.findUniqueOrThrow({where:{id:"sub1"}});await f.client.narrationSubtitleRevision.create({data:{...old,id:"sub2",subtitleSettingsHash:"b".repeat(64)}});await f.client.project.update({where:{id:"p1"},data:{activeNarrationSubtitleRevisionId:"sub2"}});}
      }
      return record;
    });
    await expect(runAssetsGeneration({db:f.db,project:f.project,voiceProfileId:"unused",executionMode:"dry_run"})).rejects.toThrow();
    expect(reached).toBe(true);expect((await f.client.project.findUniqueOrThrow({where:{id:"p1"}})).activeAssetManifestRecordId).toBeNull();
    expect((await f.client.assetManifestRecord.findMany()).every(r=>(r.executionStateJson as any)?.activated!==true)).toBe(true);
  });
  it("激活第二项写入失败回滚标记，解除故障后可恢复",async()=>{
    const f=await persistentRunnable();
    await f.client.$executeRawUnsafe("CREATE TRIGGER test_block_asset_activation BEFORE UPDATE OF activeAssetManifestRecordId ON Project WHEN NEW.activeAssetManifestRecordId IS NOT NULL BEGIN SELECT RAISE(ABORT, 'test_activation_blocked'); END");
    const args={db:f.db,project:f.project,voiceProfileId:"unused",executionMode:"dry_run"};
    const failure = await runAssetsGeneration(args).catch(error => error);
    expect(failure).toMatchObject({ name: "PrismaClientKnownRequestError", code: "P2003" });
    expect(failure.message).toContain("tx.project.update()");
    expect((await f.client.project.findUniqueOrThrow({where:{id:"p1"}})).activeAssetManifestRecordId).toBeNull();
    expect((await f.client.assetManifestRecord.findMany()).every(r=>(r.executionStateJson as any)?.activated!==true)).toBe(true);
    await f.client.$executeRawUnsafe("DROP TRIGGER test_block_asset_activation");
    expect((await runAssetsGeneration(args)).statusCode).toBe(200);
    const current=await f.client.project.findUniqueOrThrow({where:{id:"p1"}});
    expect((await f.client.assetManifestRecord.findUniqueOrThrow({where:{id:current.activeAssetManifestRecordId!}})).executionStateJson).toMatchObject({activated:true});
  });
});

describe("Task9B R2 历史视频长度闸门",()=>{
  it.each(["missing","other-task"])("%s重试不能把历史短视频作为可用路线",async mode=>{
    const f=await runnable(),manifest=await readyVisuals(f),videoPath=join(f.path,"old.mp4");await writeFile(videoPath,"offline-history");
    for(const task of f.assetPlan.tasks.filter(t=>t.task_type==="video_clip")){
      const id="old_"+task.task_id,execution=manifest.executions.find(e=>e.task_id===task.task_id)!;
      execution.status="completed";execution.output_artifact_ids=[id];
      manifest.artifacts.push({artifact_id:id,artifact_type:"video",origin:"provider",file_uri:videoPath,created_at:now,metadata:{duration_sec:1,width:720,height:1280,fps:24}});
      const route=manifest.segment_routes.find(r=>r.segment_id===task.source_segment_id)!;route.primary_visual_artifact_id=id;route.visual_route_type="video_clip";
    }
    expect(AssetManifestV2.safeParse(manifest).success).toBe(true);
    const old=await manifests.saveAssetManifestRecord(f.db,{projectId:"p1",topicPackageId:"t1",scriptRecordId:"s1",storyboardRecordId:"sb",assetPlanRecordId:"ap",manifestJson:manifest,validationResultJson:{},executionStateJson:{activated:true},graphTraceSummaryJson:null,runtimeDiagnosticsJson:null});f.project.activeAssetManifestRecordId=old.id;
    const result=await runAssetsGeneration({db:f.db,project:f.project,voiceProfileId:"unused",executionMode:"auto_available",...(mode==="missing"?{missingOnly:true}:{taskIds:[f.assetPlan.tasks.find(t=>t.task_type==="bgm_cue")!.task_id]})});
    expect(result.statusCode).toBe(200);
    expect((result.body as any).local_validation.errors).toContain("assets_narration_video_duration_insufficient");
    expect((result.body as any).local_validation.decision).toBe("blocked");
  });
});

import { validateAssetsManifest } from "../../../backend/src/modules/assets/assets-local-validator.js";
it("Task9B R2 足长拆分视频仍满足镜头范围",async()=>{
  const f=await prepared(),manifest=await readyVisuals(f),videoPath=join(f.path,"split.mp4");await writeFile(videoPath,"offline-split");
  for(const task of f.assetPlan.tasks.filter(t=>t.task_type==="video_clip")){
    const total=task.source_segment_id==="s0"?2:8,duration=total===2?3.2:14,ids:string[]=[];
    for(let i=0;i<total;i++){const id=task.task_id+"_part_"+i;ids.push(id);manifest.artifacts.push({artifact_id:id,artifact_type:"video",origin:"provider",file_uri:videoPath,created_at:now,metadata:{duration_sec:duration,width:720,height:1280,fps:24,video_split_of_task:task.task_id,video_split_index:i,video_split_total:total,video_split_group_id:"group_"+task.task_id}});}
    const execution=manifest.executions.find(e=>e.task_id===task.task_id)!;execution.status="completed";execution.output_artifact_ids=ids;
    const route=manifest.segment_routes.find(r=>r.segment_id===task.source_segment_id)!;route.primary_visual_artifact_id=ids[0]!;route.visual_route_type="video_clip";
  }
  const result=await validateAssetsManifest({assetPlanRecordId:"ap",storyboardRecordId:"sb",scriptRecordId:"s1",topicPackageId:"t1",assetPlan:f.assetPlan,manifest,projectStorageRootDir:f.path});
  expect(result.errors).not.toContain("assets_narration_video_duration_insufficient");expect(result.decision).not.toBe("blocked");
});

describe("Task9B R3 选中视频集合",()=>{
  it.each(["short-primary","long-primary","mixed-split","duplicate-split","missing-split"])("%s不能按未选中历史产物拼长",async kind=>{
    const f=await prepared(),manifest=await readyVisuals(f),videoPath=join(f.path,"history.mp4");await writeFile(videoPath,"offline-history");
    for(const task of f.assetPlan.tasks.filter(t=>t.task_type==="video_clip")){
      const route=manifest.segment_routes.find(r=>r.segment_id===task.source_segment_id)!,required=(route.narrationRange.endMs-route.narrationRange.startMs)/1000,ids=[task.task_id+"_current",task.task_id+"_old"];
      ids.forEach((id,i)=>manifest.artifacts.push({artifact_id:id,artifact_type:"video",origin:"provider",file_uri:videoPath,created_at:now,metadata:{duration_sec:kind==="long-primary"?(i?1:required):(i?required:1),width:720,height:1280,fps:24,...(kind.endsWith("split")?{video_split_of_task:task.task_id,video_split_total:2,video_split_index:kind==="duplicate-split"?0:i,video_split_group_id:kind==="missing-split"?undefined:kind==="mixed-split"&&i?"old-run":"current-run"}:{})}}));
      const execution=manifest.executions.find(e=>e.task_id===task.task_id)!;execution.status="completed";execution.output_artifact_ids=ids;route.primary_visual_artifact_id=ids[0]!;route.visual_route_type="video_clip";
    }
    const result=await validateAssetsManifest({assetPlanRecordId:"ap",storyboardRecordId:"sb",scriptRecordId:"s1",topicPackageId:"t1",assetPlan:f.assetPlan,manifest,projectStorageRootDir:f.path});
    if(kind==="long-primary")expect(result.decision).not.toBe("blocked");else expect(result.errors).toContain("assets_narration_video_duration_insufficient");
  });
});

import * as assetEngine from "../../../backend/src/modules/assets/assets-execution-engine.js";
it("Task9B R3 重试拆分视频只保留当前批次，其他镜头及历史记录保持",async()=>{
  const f=await runnable(),manifest=await readyVisuals(f),file=join(f.path,"split.mp4");await writeFile(file,"offline-split");
  for(const task of f.assetPlan.tasks.filter(t=>t.task_type==="video_clip")){
    const route=manifest.segment_routes.find(r=>r.segment_id===task.source_segment_id)!,ids:string[]=[];
    for(let i=0;i<2;i++){const id="old_"+task.task_id+"_"+i;ids.push(id);manifest.artifacts.push({artifact_id:id,artifact_type:"video",origin:"provider",file_uri:file,created_at:now,metadata:{duration_sec:60,width:720,height:1280,fps:24,video_split_of_task:task.task_id,video_split_index:i,video_split_total:2,video_split_group_id:"old_"+task.task_id}});}
    const execution=manifest.executions.find(e=>e.task_id===task.task_id)!;execution.status="completed";execution.output_artifact_ids=ids;route.primary_visual_artifact_id=ids[0]!;route.visual_route_type="video_clip";
  }
  const old=await manifests.saveAssetManifestRecord(f.db,{projectId:"p1",topicPackageId:"t1",scriptRecordId:"s1",storyboardRecordId:"sb",assetPlanRecordId:"ap",manifestJson:manifest,validationResultJson:{},executionStateJson:{activated:true},graphTraceSummaryJson:null,runtimeDiagnosticsJson:null});f.project.activeAssetManifestRecordId=old.id;
  const task=f.assetPlan.tasks.find(t=>t.task_type==="video_clip")!,real=assetEngine.executeAssetManifest;
  const adapter={providerName:"test",providerType:"video" as const,canHandle:()=>true,prepare:async()=>({providerJobId:null,rawRequestJson:{}}),submit:async()=>({providerJobId:"job",rawResponseJson:{}}),poll:async()=>({status:"completed" as const,rawResponseJson:{}}),download:async()=>[0,1].map(i=>({artifact_id:"new_"+i,artifact_type:"video" as const,origin:"provider" as const,file_uri:file,created_at:now,metadata:{duration_sec:3.2,width:720,height:1280,fps:24,video_split_of_task:task.task_id,video_split_index:i,video_split_total:2,video_split_group_id:"new"}})),normalizeResult:async({downloadedArtifacts}:any)=>({artifacts:downloadedArtifacts,notes:[]}),cancel:async()=>{}};
  vi.spyOn(assetEngine,"executeAssetManifest").mockImplementation(input=>real({...input,registry:{findAdapter:({taskType})=>taskType==="video_clip"?adapter:null}}));
  const result=await runAssetsGeneration({db:f.db,project:f.project,voiceProfileId:"unused",executionMode:"auto_available",taskIds:[task.task_id]});
  expect((result.body as any).local_validation.decision).not.toBe("blocked");
  const updated=(result.body as any).manifest;
  expect(updated.artifacts.some((a:any)=>a.artifact_id.startsWith("old_"+task.task_id))).toBe(false);
  expect((old.manifestJson as any).artifacts.some((a:any)=>a.artifact_id.startsWith("old_"+task.task_id))).toBe(true);
  expect(updated.segment_routes[1].primary_visual_artifact_id).toBe(manifest.segment_routes[1]!.primary_visual_artifact_id);
});

describe("Task9B R4 短拆分失败恢复",()=>{
  it.each([false,true])("已有成功组=%s，短split失败后足长重试恢复",async existingSuccess=>{
    const f=await runnable(),file=join(f.path,"recovery.mp4");await writeFile(file,"offline-recovery");
    let short=false,batch=0;const real=assetEngine.executeAssetManifest;
    const adapter={providerName:"test",providerType:"video" as const,canHandle:()=>true,prepare:async()=>({providerJobId:null,rawRequestJson:{}}),submit:async()=>({providerJobId:"job",rawResponseJson:{}}),poll:async()=>({status:"completed" as const,rawResponseJson:{}}),
      download:async(ctx:any)=>[0,1].map(i=>({artifact_id:batch+"_"+ctx.planTask.task_id+"_"+i,artifact_type:"video" as const,origin:"provider" as const,file_uri:file,created_at:now,metadata:{duration_sec:short?1:60,width:720,height:1280,fps:24,video_split_of_task:ctx.planTask.task_id,video_split_index:i,video_split_total:2,video_split_group_id:"batch_"+batch}})),normalizeResult:async({downloadedArtifacts}:any)=>({artifacts:downloadedArtifacts,notes:[]}),cancel:async()=>{}};
    vi.spyOn(assetEngine,"executeAssetManifest").mockImplementation(input=>real({...input,registry:{findAdapter:q=>q.taskType==="video_clip"?adapter:input.registry.findAdapter(q)}}));
    const task=f.assetPlan.tasks.find(t=>t.task_type==="video_clip")!;
    const run=(taskIds?:string[])=>{batch++;return runAssetsGeneration({db:f.db,project:f.project,voiceProfileId:"unused",executionMode:"auto_available",taskIds});};
    if(existingSuccess)expect(((await run()).body as any).local_validation.decision).not.toBe("blocked");
    short=true;const failed=await run(existingSuccess?[task.task_id]:undefined),failedBatch="batch_"+batch;
    expect((failed.body as any).manifest.segment_routes[0].fallback_decision).toBe("automatic");
    short=false;const recovered=await run([task.task_id]);
    expect((recovered.body as any).local_validation.decision).not.toBe("blocked");
    expect((recovered.body as any).manifest.segment_routes[0].visual_route_type).toBe("video_clip");
    expect((recovered.body as any).manifest.artifacts.some((a:any)=>a.metadata.video_split_group_id===failedBatch)).toBe(false);
    expect((failed.body as any).manifest.artifacts.some((a:any)=>a.metadata.video_split_group_id===failedBatch)).toBe(false);
    expect(sha(await readFile(join(f.path,f.record.output!.audio.uri)))).toBe(f.record.output!.audio.sha256);
  });
});
