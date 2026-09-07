import { Prisma } from '../../../backend/src/generated/prisma/client.js';
import { NarrationBundleStorage } from '../../../backend/src/modules/narration/narration-bundle-storage.js';
import { prepareNarrationRun } from '../../../backend/src/modules/narration/narration-run.service.js';
import { EventEmitter } from 'node:events';
import { DashScopeSpeechWsClient } from '../../../backend/src/modules/narration/providers/dashscope-speech-ws-client.js';
import { NarrationRepository } from '../../../backend/src/modules/narration/narration.repository.js';
import { narrationStorage } from '../../../backend/src/modules/narration/narration-run.service.js';
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { DashScopeNarrationProvider } from "../../../backend/src/modules/narration/providers/dashscope-narration-provider.js";
import { describe, expect, it, afterEach, vi } from "vitest";
import { buildApp } from "../../../backend/src/app.js";
import { prepareQuoteProject, seedQuotableCatalog } from "../cost/quote-test-context.js";
import { buildTestAuth } from "../auth/test-utils.js";
import { narrationTextHash } from "../../../backend/src/modules/narration/narration-readiness.js";
import { DEFAULT_GENERATION_CONFIGURATION } from "../../../shared/src/index.js";
import { seedGlobalVoiceProfiles } from "../../../backend/src/modules/assets/voice/voice-profile.repository.js";
import { NARRATION_FIRST_MODEL_POLICY_V1 as policy } from "../../../backend/src/modules/narration/narration-model-policy.js";
const auth = buildTestAuth({ userId: "u" });
const dirs: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); for (const p of dirs.splice(0)) {
    if (!resolve(p).startsWith(resolve(tmpdir()) + sep) || !p.includes("narration-task5-test-"))
        throw Error("unsafe_cleanup");
    rmSync(p, { recursive: true, force: true });
} });
async function fixture(provider?: Pick<DashScopeNarrationProvider, "generate">) {
    const dir = mkdtempSync(join(tmpdir(), "narration-task5-test-"));
    dirs.push(dir);
    const app = buildApp({ skipSnapshotLoad: true, narrationProvider: provider });
    await seedQuotableCatalog(app);
    await seedGlobalVoiceProfiles(app.db);
    const project = await prepareQuoteProject(app.db, "u");
    project.narrationTimingMode = "narration_first_v1";
    project.activeScriptRecordId = "s";
    project.activeTopicPackageId = "t";
    project.storageRootDir = dir;
    const config = structuredClone(DEFAULT_GENERATION_CONFIGURATION);
    config.capabilities["tts.synthesize"] = { mode: "fixed", provider_model_id: policy.default_provider_model_id };
    config.creative.voice_profile_id = policy.default_voice_profile_id;
    app.db.projectGenerationConfigurations.clear();
    app.db.projectGenerationConfigurations.set(project.id, { id: "c", projectId: project.id, revision: 1, schemaVersion: "generation_configuration_v1", configurationJson: config, sourceUserPreferenceRevision: null, createdAt: new Date(), updatedAt: new Date() });
    app.db.scriptRecords.set("s", { id: "s", projectId: project.id, topicPackageId: "t", scriptText: "你好", validationResultJson: { stage: "script_local_validation", decision: "pass", errors: [], warnings: [], metrics: {} }, reviewStatus: "skipped", createdAt: new Date() } as never);
    app.db.topicPackages.set("t", { id: "t", projectId: project.id, durationBandJson: { min_sec: 1, max_sec: 5 } } as never);
    return { app, project, url: "/api/projects/" + project.id, hash: narrationTextHash("你好") };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
async function confirmScript(f: Awaited<ReturnType<typeof fixture>>) { expect((await f.app.inject({ method: "POST", url: f.url + "/script/s/confirm", auth, payload: { source_text_sha256: f.hash } })).statusCode).toBe(200); }
function generateRequest(f: Awaited<ReturnType<typeof fixture>>, key = "k") { return { method: "POST", url: f.url + "/script/narration/generate", auth, payload: { source_script_record_id: "s", expected_configuration_revision: 1, idempotency_key: key } }; }
function syntheticProvider(invalidTiming=false) {
    const words = [{ text: "你", begin_index: 0, end_index: 1, begin_time: 100, end_time: 400 }, { text: "好", begin_index: 1, end_index: 2, begin_time: 400, end_time: 700 }];
    if(invalidTiming)words[1].end_time=1500;
    const event = (name: string, output?: unknown) => ({ kind: "json" as const, elapsedMs: 0, data: { header: { event: name, task_id: "task" }, payload: output === undefined ? {} : { output } } });
    return new DashScopeNarrationProvider({ client: { async synthesize() { return { pcm: Buffer.alloc(48000), providerTaskId: "task", providerRequestId: null, usageCharacters: 9, sentences: [{ providerSentenceIndex: 0, originalText: "你好", normalizedText: "你好", words }], rawEvents: [event("task-started"), event("result-generated", { type: "sentence-begin", sentence: { index: 0 } }), { kind: "audio", elapsedMs: 0, byteOffset: 0, byteLength: 48000 }, event("result-generated", { type: "sentence-end", sentence: { index: 0, words }, original_text: "你好", normalized_text: "你好" }), event("task-finished")] }; } } });
}
async function untilDone(f: Awaited<ReturnType<typeof fixture>>, runId: string) { for (let i = 0; i < 100; i++) {
    const run = await f.app.generationRunRepository.getRunById(runId);
    if (run && run.status !== "pending_dispatch" && run.status !== "running")
        return run;
    await new Promise(r => setTimeout(r, 5));
} throw Error("test_dispatch_timeout"); }

class ReceiptSocket extends EventEmitter {
 send(_text:string){} close(){} terminate(){}
 json(event:string,payload:unknown={}){this.emit('message',Buffer.from(JSON.stringify({header:{event,task_id:'real-task'},payload})),false);}
}
function failedWs(mode:'close'|'cancel'|'task-failed'|'timeout',known:boolean,entered=deferred<void>()){
 const socket=new ReceiptSocket();const provider=new DashScopeNarrationProvider({client:new DashScopeSpeechWsClient({apiKey:'offline',timeoutMs:mode==='timeout'?20:1000,taskIdFactory:()=> 'real-task',socketFactory:()=>socket})});
 return {entered,provider:{async generate(input:unknown,options:any){const pending=provider.generate(input,options);socket.emit('open');socket.json('task-started');if(known)socket.json('result-generated',{output:{type:'sentence-begin',sentence:{index:0},original_text:'你好',normalized_text:'你好'},usage:{characters:308}});entered.resolve();if(mode==='close')socket.emit('close');if(mode==='task-failed')socket.json('task-failed');return pending;}}};
}
describe('错误路径保全累计receipt',()=>{
 it.each(['close','cancel'] as const)('实际WS %s在有/无receipt时如实记账',async mode=>{
  for(const known of [true,false]){const stub=failedWs(mode,known);const f=await fixture(stub.provider);await confirmScript(f);const response=await f.app.inject(generateRequest(f));expect(response.statusCode).toBe(202);await stub.entered.promise;
   if(mode==='cancel')expect((await f.app.inject({method:'POST',url:f.url+'/script/narrations/'+response.json().narration_record_id+'/cancel',auth,payload:{}})).statusCode).toBe(200);
   await untilDone(f,response.json().generation_run_id);await vi.waitFor(()=>expect(f.app.db.generationRunEvents.get(response.json().generation_run_id)?.some(e=>e.eventType==="narration_provider_fact_applied")).toBe(true));
   const cost=[...f.app.db.usageCostRecords.values()][0];expect(cost.outputUnits).toBe(known?308:null);expect(cost.actualCostMicros).toBe(known?'43120':null);expect(cost.unitDetailJson?.provider_receipt_kind).toBe(known?'partial':'none');expect(cost.assetProviderJobRecordId).toBeNull();
   expect([...f.app.db.narrationRecords.values()][0].status).toBe(mode==='cancel'?'cancelled':'unknown');expect(f.project.activeNarrationRecordId??null).toBeNull();
  }
 });
});


describe('确定远端结果与未知结果分开',()=>{
 it.each([true,false])('真实task-failed，receipt存在=%s，终态failed保留原错误码',async known=>{
  const stub=failedWs('task-failed',known);const f=await fixture(stub.provider);await confirmScript(f);const r=await f.app.inject(generateRequest(f));const run=await untilDone(f,r.json().generation_run_id);
  expect(run.status).toBe('failed');const record=[...f.app.db.narrationRecords.values()][0];expect(record.status).toBe('failed');expect(record.errorCode).toBe('narration_task_failed');expect([...f.app.db.usageCostRecords.values()][0].outputUnits).toBe(known?308:null);
 });
 it('完整capture后normalize失败：failed/timing_invalid，保留final receipt',async()=>{
  const f=await fixture(syntheticProvider(true));await confirmScript(f);const r=await f.app.inject(generateRequest(f));expect((await untilDone(f,r.json().generation_run_id)).status).toBe('failed');
  expect([...f.app.db.narrationRecords.values()][0]).toMatchObject({status:'failed',errorCode:'narration_timing_invalid'});expect([...f.app.db.usageCostRecords.values()][0]).toMatchObject({outputUnits:9,unitDetailJson:{provider_receipt_kind:'final'}});
 });
 it('任意Error即使仿冒task-failed文案也不冒充确定失败',async()=>{
  const f=await fixture({async generate(){throw Error('narration_task_failed');}});await confirmScript(f);const r=await f.app.inject(generateRequest(f));expect((await untilDone(f,r.json().generation_run_id)).status).toBe('needs_reconciliation');expect([...f.app.db.narrationRecords.values()][0].errorCode).toBe('narration_provider_unknown');
 });
});

const temporaryDbError=()=>new Prisma.PrismaClientKnownRequestError('isolated transaction conflict',{code:'P2034',clientVersion:'test'});
async function prepared(f:Awaited<ReturnType<typeof fixture>>){await confirmScript(f);return prepareNarrationRun(f.app,f.project.id,'u','u',{source_script_record_id:'s',expected_configuration_revision:1,idempotency_key:'direct'});}
describe('完整bundle后的本地恢复',()=>{
 it.each(['recover','cancel','takeover'] as const)('saveReadyBundle暂错后%s：无供应商重发且状态fenced',async mode=>{
  let calls=0;const f=await fixture({async generate(input,options){calls++;return syntheticProvider().generate(input,options);}});const submission=await prepared(f);
  const spy=vi.spyOn(NarrationRepository.prototype,'saveReadyBundle').mockImplementationOnce(async function(...args){
   if(mode==='takeover'){const run=f.app.db.generationRuns.get(submission.run.id)!;run.dispatchLeaseOwner='new-worker';run.dispatchClaimCount++;run.dispatchLeaseExpiresAt=new Date(Date.now()+60000);}
   throw temporaryDbError();
  });
  const first=await f.app.generationRunDispatcher.dispatch(submission.run.id);expect(spy).toHaveBeenCalledTimes(1);spy.mockRestore();
  const record=f.app.db.narrationRecords.get(submission.record.id)!;expect((await narrationStorage(f.app,f.project).recoverInitial({record})).status).toBe('complete');
  expect(first).toMatchObject({dispatched:true,outcome:{status:mode==='takeover'?'failed':'deferred'}});
  expect(record.status).toBe('generating');expect(f.app.db.generationRuns.get(submission.run.id)!.status).toBe('running');
  if(mode==='cancel')expect((await f.app.inject({method:'POST',url:f.url+'/script/narrations/'+record.id+'/cancel',auth,payload:{}})).statusCode).toBe(200);
  if(mode==='takeover'){expect(f.app.db.generationRuns.get(submission.run.id)!.dispatchLeaseOwner).toBe('new-worker');expect(await f.app.generationRunDispatcher.scanAndDispatch()).toEqual({claimed:0});}
  else {const run=f.app.db.generationRuns.get(submission.run.id)!;if(run.status==='running')run.dispatchLeaseExpiresAt=new Date(Date.now()-1000);await f.app.generationRunDispatcher.scanAndDispatch();}
  expect(calls).toBe(1);expect(f.app.db.narrationRecords.get(record.id)!.status).toBe(mode==='recover'?'ready':mode==='cancel'?'cancelled':'generating');expect(f.project.activeNarrationRecordId??null).toBeNull();expect([...f.app.db.usageCostRecords.values()][0].outputUnits).toBe(9);
 });
 it.each(['permanent','contract'] as const)('完整bundle后%s错误不能defer或暴露任意错误文本',async fault=>{
  const f=await fixture(syntheticProvider());const submission=await prepared(f);const spy=vi.spyOn(NarrationRepository.prototype,'saveReadyBundle').mockRejectedValueOnce(Error(fault==='contract'?'narration_state_conflict':'private database secret'));
  const result=await f.app.generationRunDispatcher.dispatch(submission.run.id);expect(spy).toHaveBeenCalledOnce();expect(result).toMatchObject({outcome:{status:'failed'}});expect(f.app.db.narrationRecords.get(submission.record.id)!.errorCode).toBe('narration_ready_persistence_failed');
 });
 it('完整capture后实际目标commitInitial写盘失败保留本地失败和receipt',async()=>{
  const f=await fixture(syntheticProvider());const submission=await prepared(f);const spy=vi.spyOn(NarrationBundleStorage.prototype,'commitInitial').mockRejectedValueOnce(Object.assign(Error('private disk path'),{code:'ENOSPC'}));const result=await f.app.generationRunDispatcher.dispatch(submission.run.id);
  expect(spy).toHaveBeenCalledOnce();expect(result).toMatchObject({outcome:{status:'failed',reason_code:'narration_bundle_write_failed'}});expect([...f.app.db.usageCostRecords.values()][0]).toMatchObject({outputUnits:9,actualCostMicros:'1260'});expect(f.app.db.narrationRecords.get(submission.record.id)!.status).toBe('failed');
 });
});


it('receiptKind运行时校验且partial→final→迟到partial不回退',async()=>{
 const {recordNarrationUsage}=await import('../../../backend/src/modules/generation-cost/usage-cost-recorder.js');const f=await fixture();const s=await prepared(f);const snapshot=[...f.app.db.runConfigurationSnapshots.values()][0];const common={db:f.app.db,snapshot,runId:s.run.id,providerRequestKey:'receipt-boundary',providerModelId:policy.default_provider_model_id,pricingVersion:'v',priceMicrosPer10k:'1400000',sourceCharacters:2};
 await expect(recordNarrationUsage({...common,usageCharacters:308,status:'failed',receiptKind:'invoice' as never})).rejects.toThrow('narration_usage_invalid');expect(f.app.db.usageCostRecords.size).toBe(0);
 await recordNarrationUsage({...common,usageCharacters:100,status:'failed',receiptKind:'partial'});await recordNarrationUsage({...common,usageCharacters:308,status:'succeeded',receiptKind:'final'});await recordNarrationUsage({...common,usageCharacters:200,status:'failed',receiptKind:'partial'});
 expect([...f.app.db.usageCostRecords.values()][0]).toMatchObject({outputUnits:308,actualCostMicros:'43120',status:'succeeded',unitDetailJson:{provider_receipt_kind:'final'}});
});
it('旧operation handler返回deferred被明确拒绝',async()=>{
 const {createGenerationRunDispatcher}=await import('../../../backend/src/modules/generation-run/generation-run-dispatcher.js');const f=await fixture();const s=await prepared(f);f.app.db.generationRuns.get(s.run.id)!.operation='topic.generate';const d=createGenerationRunDispatcher({db:f.app.db,repository:f.app.generationRunRepository,workerId:'old-op',leaseDurationMs:1000,handlers:{'topic.generate':async()=>({status:'deferred',reason_code:'narration_ready_persistence_retry',message:'invalid'})}});
 expect(await d.dispatch(s.run.id)).toMatchObject({outcome:{status:'failed',reason_code:'dispatch_outcome_invalid'}});expect(f.app.db.generationRuns.get(s.run.id)!.status).toBe('failed');
});


it('恢复阶段第二次暂错仍可延期，第三次读取原bundle完成且只调用一次provider',async()=>{
 let calls=0;const f=await fixture({async generate(input,options){calls++;return syntheticProvider().generate(input,options);}});const s=await prepared(f);
 const spy=vi.spyOn(NarrationRepository.prototype,'saveReadyBundle').mockRejectedValueOnce(temporaryDbError()).mockRejectedValueOnce(temporaryDbError());
 for(let i=0;i<2;i++){expect(await f.app.generationRunDispatcher.dispatch(s.run.id)).toMatchObject({outcome:{status:'deferred'}});expect(f.app.db.narrationRecords.get(s.record.id)!.status).toBe('generating');f.app.db.generationRuns.get(s.run.id)!.dispatchLeaseExpiresAt=new Date(Date.now()-1000);}
 spy.mockRestore();expect(await f.app.generationRunDispatcher.dispatch(s.run.id)).toMatchObject({outcome:{status:'succeeded'}});expect(calls).toBe(1);expect(f.app.db.generationRuns.get(s.run.id)!.dispatchClaimCount).toBe(3);
});


it.each([9,null])('取消后迟到完整结果的receipt完整性独立于status：%s',async characters=>{
 const entered=deferred<void>(),release=deferred<void>();const f=await fixture({async generate(input){entered.resolve();await release.promise;return {...await syntheticProvider().generate(input),usageCharacters:characters};}});await confirmScript(f);const r=await f.app.inject(generateRequest(f));await entered.promise;await f.app.inject({method:'POST',url:f.url+'/script/narrations/'+r.json().narration_record_id+'/cancel',auth,payload:{}});release.resolve();await vi.waitFor(()=>expect(f.app.db.generationRunEvents.get(r.json().generation_run_id)?.some(e=>e.eventType==='narration_provider_fact_applied')).toBe(true));
 expect([...f.app.db.usageCostRecords.values()][0]).toMatchObject({status:'canceled',outputUnits:characters,unitDetailJson:{provider_receipt_kind:characters===null?'none':'final'}});expect(f.app.db.narrationRecords.get(r.json().narration_record_id)!.status).toBe('cancelled');
});


it.each(['success','failed','cancel'] as const)('账本连续暂错%s，事实独立保存并供冷dispatcher只补账',async mode=>{
 let returned=false,calls=0;const entered=deferred<void>();const ws=failedWs(mode==='cancel'?'cancel':'close',true,entered);
 const f=await fixture({async generate(input,options){calls++;returned=true;return mode==='success'?syntheticProvider().generate(input,options):ws.provider.generate(input,options);}});const s=await prepared(f);
 const original=f.app.db.usageCostRecords.set.bind(f.app.db.usageCostRecords);let failed=0;f.app.db.usageCostRecords.set=((key:any,value:any)=>{if(returned&&failed++<2)throw temporaryDbError();return original(key,value);}) as never;
 const pending=f.app.generationRunDispatcher.dispatch(s.run.id);if(mode==='cancel'){await entered.promise;await f.app.inject({method:'POST',url:f.url+'/script/narrations/'+s.record.id+'/cancel',auth,payload:{}});}await pending;
 expect((await narrationStorage(f.app,f.project).readProviderFacts({record:s.record})).length).toBeGreaterThan(0);
 f.app.db.usageCostRecords.set=original;const run=f.app.db.generationRuns.get(s.run.id)!;if(run.status==='running')run.dispatchLeaseExpiresAt=new Date(Date.now()-1000);
 await f.app.generationRunDispatcher.scanAndDispatch();await f.app.generationRunDispatcher.scanAndDispatch();
 expect(calls).toBe(1);expect([...f.app.db.usageCostRecords.values()][0].outputUnits).toBe(mode==='success'?9:308);expect(f.app.db.narrationRecords.get(s.record.id)!.status).toBe(mode==='success'?'ready':mode==='cancel'?'cancelled':'unknown');
});


async function sqliteFixture(provider:Pick<DashScopeNarrationProvider,'generate'>){
 const {default:Database}=await import('better-sqlite3');const {applyAllDatabaseMigrations}=await import('../db/migration-test-utils.js');const {createPrismaClient}=await import('../../../backend/src/db/prisma-client.js');const {PrismaFirstAggregateWriter}=await import('../../../backend/src/db/repositories/prisma-first-aggregate-writer.js');const {buildPricingCatalogSeed}=await import('../../../backend/src/modules/generation-cost/pricing-catalog.seed.js');
 const dir=mkdtempSync(join(tmpdir(),'narration-task5-test-'));dirs.push(dir);const path=join(dir,'receipt.db'),sqlite=new Database(path);applyAllDatabaseMigrations(sqlite);sqlite.close();
 const client=await createPrismaClient(path);await client.user.create({data:{id:'u',username:'u',displayName:'u',passwordHash:'test',role:'USER'}});const writer=await PrismaFirstAggregateWriter.create(client,'u');const app=buildApp({prismaClient:client,firstAggregateWriter:writer,storageBaseDir:dir,skipSnapshotLoad:true,narrationFirstEnabled:true,narrationProvider:provider});
 await client.providerModelCatalog.updateMany({data:{status:'disabled',isDefault:false}});for(const entry of buildPricingCatalogSeed({llm:{mode:'stub'},media:{deploymentScope:'cn-beijing'}})){app.db.providerModelCatalog.set(entry.id,entry);await client.providerModelCatalog.upsert({where:{id:entry.id},create:entry,update:entry});}await seedGlobalVoiceProfiles(app.db);
 const created=await app.inject({method:'POST',url:'/api/projects',auth,payload:{name:'receipt',narration_selection:{provider_model_id:policy.default_provider_model_id,voice_profile_id:policy.default_voice_profile_id,policy_version:policy.policy_version}}});expect(created.statusCode,JSON.stringify(created.json())).toBe(201);const id=created.json().project_id;
 await client.topicPackage.create({data:{id:'t',projectId:id,title:'历史',selectedAngle:'压力',familyLabel:'人物',scopeLabel:'事件',coreConflict:'冲突',strongScene:'场景',packagingSeed:'故事',canonicalQuotesJson:[],canonicalQuoteIntentsJson:[],durationBandJson:{min_sec:1,max_sec:5},narrativeTensionMapJson:{},mustIncludeBeatsJson:[],forbiddenExpansionsJson:[],riskHintsJson:[],sourceAnchorRefsJson:[],ambiguityNotesJson:[]}});
 await client.scriptRecord.create({data:{id:'s',projectId:id,topicPackageId:'t',scriptText:'你好',openingSpan:'你好',endingSpan:'你好',estimatedDurationSec:1,beatTraceJson:[],quoteTraceJson:[],reviewStatus:'skipped',validationResultJson:{stage:'script_local_validation',decision:'pass',errors:[],warnings:[],metrics:{}},executionStateJson:{}}});await client.project.update({where:{id},data:{activeScriptRecordId:'s',activeTopicPackageId:'t'}});
 const f={app,project:{id},url:'/api/projects/'+id,hash:narrationTextHash('你好')};await confirmScript(f as never);const submission=await prepareNarrationRun(app,id,'u','u',{source_script_record_id:'s',expected_configuration_revision:1,idempotency_key:'cold'});
 return {client,submission,app,dir,path,cold:async()=>{const c=await createPrismaClient(path);return {client:c,app:buildApp({prismaClient:c,firstAggregateWriter:await PrismaFirstAggregateWriter.create(c,'u'),skipSnapshotLoad:true,storageBaseDir:dir,narrationProvider:{async generate(){throw Error('forbidden_replay');}}})};}};
}
it.each(['event','ledger'] as const)('真实SQLite %s连续暂错后断开client，新实例只读journal补账',async target=>{
 const f=await sqliteFixture(syntheticProvider());let injected=0,readBeforeFailure=0;const original=f.client.$transaction.bind(f.client);
 if(target==='ledger')(f.client as any).$transaction=(fn:any,...args:any[])=>typeof fn!=='function'?(original as any)(fn,...args):(original as any)(async(tx:any)=>fn(new Proxy(tx,{get(t,key){if(key!=='usageCostRecord')return Reflect.get(t,key);return new Proxy(t.usageCostRecord,{get(model,method){if(method==='findUnique')return async(...a:any[])=>{readBeforeFailure++;return model.findUnique(...a)};if(method==='upsert')return async(...a:any[])=>{if(a[0].create.outputUnits!==null&&injected++<2)throw temporaryDbError();return model.upsert(...a)};return Reflect.get(model,method);}});}})),...args);
 const eventSpy=target==='event'?vi.spyOn(f.app.generationRunRepository,'appendRunEvent').mockImplementation(async e=>{if(e.eventType==='narration_provider_fact'&&injected++<2)throw temporaryDbError();await f.client.generationRunEvent.create({data:e as never});}):null;
 let cold:Awaited<ReturnType<typeof f.cold>>|undefined;
 try{expect(await f.app.generationRunDispatcher.dispatch(f.submission.run.id)).toMatchObject({outcome:{status:'deferred'}});await f.app.generationRunDispatcher.scanAndDispatch();expect(injected).toBe(2);if(target==='ledger')expect(readBeforeFailure).toBeGreaterThan(0);expect(await f.client.generationRunEvent.count({where:{eventType:'narration_provider_fact_applied'}})).toBe(0);
 await f.client.generationRun.update({where:{id:f.submission.run.id},data:{dispatchLeaseExpiresAt:new Date(Date.now()-1000)}});eventSpy?.mockRestore();await f.client.$disconnect();cold=await f.cold();expect(cold.app.db.projects.size).toBe(0);await cold.app.generationRunDispatcher.scanAndDispatch();await cold.app.generationRunDispatcher.scanAndDispatch();
 expect(await cold.client.usageCostRecord.count()).toBe(1);expect(await cold.client.usageCostRecord.findFirst()).toMatchObject({outputUnits:9,actualCostMicros:'1260'});expect(await cold.client.narrationRecord.findUnique({where:{id:f.submission.record.id}})).toMatchObject({status:'ready'});expect(await cold.client.generationRunEvent.count({where:{eventType:'narration_provider_fact_applied'}})).toBe(1);
 }finally{eventSpy?.mockRestore();await cold?.client.$disconnect();await f.client.$disconnect();}
});


it('provider错误后DB读取暂错之前已保存fact，恢复仍保持已知远端失败',async()=>{
 const stub=failedWs('task-failed',true);const f=await fixture(stub.provider),s=await prepared(f);const original=f.app.generationRunRepository.getRunById;let afterProvider=false;const generate=stub.provider.generate;stub.provider.generate=async(...args)=>{try{return await generate(...args)}finally{afterProvider=true}};
 const spy=vi.spyOn(f.app.generationRunRepository,'getRunById').mockImplementation(async id=>{if(afterProvider){afterProvider=false;throw temporaryDbError();}return original(id)});await f.app.generationRunDispatcher.dispatch(s.run.id);spy.mockRestore();expect(await narrationStorage(f.app,f.project).readProviderFacts({record:s.record})).toHaveLength(1);
 const run=f.app.db.generationRuns.get(s.run.id)!;if(run.status==='running')run.dispatchLeaseExpiresAt=new Date(Date.now()-1000);await f.app.generationRunDispatcher.scanAndDispatch();expect([...f.app.db.usageCostRecords.values()][0].outputUnits).toBe(308);expect(f.app.db.narrationRecords.get(s.record.id)!.status).toBe('failed');
});


it.each(['failed','completed'] as const)('无bundle的已知%s不能被时间较晚unknown覆盖，receipt按max合并',async outcome=>{
 const f=await fixture(),s=await prepared(f),payload=s.run.dispatchPayloadJson as any,store=narrationStorage(f.app,f.project);
 const common={schemaVersion:'narration_provider_fact_v1',projectId:f.project.id,generationRunId:s.run.id,configurationSnapshotId:s.run.runConfigurationSnapshotId,providerRequestKey:payload.provider_request_key,sourceTextSha256:payload.source_text_sha256,settingsSha256:payload.settings_sha256,providerTaskId:'task',providerRequestId:null,durationMs:null,canceled:false};
 await store.commitProviderFact({record:s.record,fact:{...common,characters:100,receiptKind:'final',remoteOutcome:outcome,errorCode:outcome==='failed'?'narration_task_failed':null,observedAt:'2026-09-01T00:00:00.000Z'}});await store.commitProviderFact({record:s.record,fact:{...common,characters:308,receiptKind:'partial',remoteOutcome:'unknown',errorCode:'narration_provider_unknown',observedAt:'2026-09-09T00:00:00.000Z'}});
 expect(await f.app.generationRunDispatcher.dispatch(s.run.id)).toMatchObject({outcome:{status:'failed'}});expect(f.app.db.narrationRecords.get(s.record.id)!.errorCode).toBe(outcome==='failed'?'narration_task_failed':'narration_bundle_incomplete');expect([...f.app.db.usageCostRecords.values()][0]).toMatchObject({outputUnits:308,unitDetailJson:{provider_receipt_kind:'final'}});
});
it.each(['run','type','hash','schema'])('applied标记%s损坏不能冒充已应用',async field=>{
 const {reconcileNarrationProviderFacts}=await import('../../../backend/src/modules/generation-run/narration-dispatch-handler.js');const f=await fixture(syntheticProvider()),s=await prepared(f);await f.app.generationRunDispatcher.dispatch(s.run.id);const applied=f.app.db.generationRunEvents.get(s.run.id)!.find(e=>e.eventType==='narration_provider_fact_applied')!;
 if(field==='run')applied.generationRunId='other';if(field==='type')applied.eventType='other';if(field==='hash')(applied.eventJson as any).fact_sha256='b'.repeat(64);if(field==='schema')(applied.eventJson as any).schema_version='unknown';f.app.db.usageCostRecords.clear();
 const result=await reconcileNarrationProviderFacts({db:f.app.db,repository:f.app.generationRunRepository,storageBaseDir:f.app.storageBaseDir});expect(result.errors).toHaveLength(1);expect(f.app.db.usageCostRecords.size).toBe(0);
});


it.each([['success',false],['provider-failed',false],['success',true],['provider-failed',true]] as const)('fact磁盘不可写%s/DB故障%s：尽力保全账本，双失败明确报错',async (mode,dbFailed)=>{
 const f=await fixture(mode==='success'?syntheticProvider():failedWs('task-failed',true).provider),s=await prepared(f);const spy=vi.spyOn(NarrationBundleStorage.prototype,'commitProviderFact').mockRejectedValueOnce(Object.assign(Error('isolated disk full'),{code:'ENOSPC'}));
 const original=f.app.db.usageCostRecords.set.bind(f.app.db.usageCostRecords);if(dbFailed)f.app.db.usageCostRecords.set=((key:any,value:any)=>{if(value.outputUnits!==null)throw temporaryDbError();return original(key,value)}) as never;
 const localCode=dbFailed?'narration_fact_and_usage_persistence_failed':'narration_fact_persistence_failed';const code=mode==='provider-failed'?'narration_task_failed':localCode;expect(await f.app.generationRunDispatcher.dispatch(s.run.id)).toMatchObject({outcome:{status:'failed',reason_code:code}});expect(spy).toHaveBeenCalledOnce();expect(f.app.db.narrationRecords.get(s.record.id)!).toMatchObject({status:'failed',errorCode:code});expect([...f.app.db.usageCostRecords.values()][0].outputUnits).toBe(dbFailed?null:mode==='success'?9:308);expect(f.app.db.generationRunEvents.get(s.run.id)!.some(e=>e.eventType==='narration_provider_fact_applied')).toBe(false);expect(await f.app.generationRunDispatcher.scanAndDispatch()).toEqual({claimed:0});
});


describe('R3 本地故障不改远端事实',()=>{
 it.each(['close','timeout'] as const)('实际 WS %s 的 receipt/磁盘/账本组合保持 unknown',async mode=>{
  for(const known of [true,false])for(const dbFailed of [false,true]){
   const stub=failedWs(mode,known),generate=vi.spyOn(stub.provider,'generate'),f=await fixture(stub.provider),s=await prepared(f);
   const disk=vi.spyOn(NarrationBundleStorage.prototype,'commitProviderFact').mockRejectedValueOnce(Object.assign(Error('isolated disk full'),{code:'ENOSPC'}));
   const set=f.app.db.usageCostRecords.set.bind(f.app.db.usageCostRecords);let calls=0;if(dbFailed)f.app.db.usageCostRecords.set=((k:any,v:any)=>{if(++calls>1)throw temporaryDbError();return set(k,v)}) as never;
   expect(await f.app.generationRunDispatcher.dispatch(s.run.id)).toMatchObject({outcome:{status:'needs_reconciliation',reason_code:'narration_provider_unknown'}});
   expect(f.app.db.narrationRecords.get(s.record.id)).toMatchObject({status:'unknown',errorCode:'narration_provider_unknown'});
   expect([...f.app.db.usageCostRecords.values()][0].outputUnits).toBe(known&&!dbFailed?308:null);
   expect(f.app.db.generationRunEvents.get(s.run.id)!.find(e=>e.eventType==='narration_local_persistence_failed')?.eventJson).toMatchObject({remote_outcome:'unknown',local_phase:'fact',local_error_code:dbFailed?'narration_fact_and_usage_persistence_failed':'narration_fact_persistence_failed'});
   expect(await narrationStorage(f.app,f.project).readProviderFacts({record:s.record})).toHaveLength(0);expect(f.app.db.generationRunEvents.get(s.run.id)!.some(e=>e.eventType==='narration_provider_fact_applied')).toBe(false);
   await f.app.generationRunDispatcher.scanAndDispatch();await f.app.generationRunDispatcher.scanAndDispatch();expect(generate).toHaveBeenCalledOnce();disk.mockRestore();
  }
 });
 it.each(['transient','permanent'] as const)('完整 fact 后首次 state_read %s 如实诊断且不重发',async mode=>{
  const provider=syntheticProvider(),originalGenerate=provider.generate.bind(provider),generate=vi.spyOn(provider,'generate'),f=await fixture(provider),s=await prepared(f);let after=false;generate.mockImplementation(async(...args)=>{const result=await originalGenerate(...args);after=true;return result});
  const original=f.app.generationRunRepository.getRunById;const read=vi.spyOn(f.app.generationRunRepository,'getRunById').mockImplementation(async id=>{if(after){after=false;throw mode==='transient'?new Prisma.PrismaClientKnownRequestError('isolated read unavailable',{code:'P1001',clientVersion:'test'}):Error('permanent read failure');}return original(id)});
  const result=await f.app.generationRunDispatcher.dispatch(s.run.id);read.mockRestore();expect(result).toMatchObject({outcome:mode==='transient'?{status:'deferred'}:{status:'failed',reason_code:'narration_state_read_failed'}});
  expect(await narrationStorage(f.app,f.project).readProviderFacts({record:s.record})).toHaveLength(1);expect((await narrationStorage(f.app,f.project).recoverInitial({record:s.record})).status).toBe('complete');
  expect([...f.app.db.usageCostRecords.values()][0]).toMatchObject({outputUnits:9,unitDetailJson:{provider_receipt_kind:'final'}});
  expect(f.app.db.generationRunEvents.get(s.run.id)!.find(e=>e.eventType==='narration_local_persistence_failed')?.eventJson).toMatchObject({remote_outcome:'completed',local_phase:'state_read',local_error_code:'narration_state_read_failed'});
  const run=f.app.db.generationRuns.get(s.run.id)!;if(mode==='transient')run.dispatchLeaseExpiresAt=new Date(Date.now()-1000);await f.app.generationRunDispatcher.scanAndDispatch();await f.app.generationRunDispatcher.scanAndDispatch();expect(generate).toHaveBeenCalledOnce();expect(f.app.db.narrationRecords.get(s.record.id)?.status).toBe(mode==='transient'?'ready':'failed');expect(f.project.activeNarrationRecordId??null).toBeNull();
 });
 it.each(['cancel','lease','audit'] as const)('journal 故障仍尊重 %s 边界',async mode=>{
  const stub=failedWs(mode==='cancel'?'cancel':'close',true),f=await fixture(stub.provider),s=await prepared(f);const generate=vi.spyOn(stub.provider,'generate');
  vi.spyOn(NarrationBundleStorage.prototype,'commitProviderFact').mockImplementationOnce(async()=>{if(mode==='lease')f.app.db.generationRuns.get(s.run.id)!.dispatchClaimCount++;throw Object.assign(Error('disk full'),{code:'ENOSPC'})});
  const append=f.app.generationRunRepository.appendRunEvent;if(mode==='audit')vi.spyOn(f.app.generationRunRepository,'appendRunEvent').mockImplementation(e=>{if(e.eventType==='narration_local_persistence_failed')throw temporaryDbError();return append(e)});
  const dispatch=f.app.generationRunDispatcher.dispatch(s.run.id);await stub.entered.promise;if(mode==='cancel')expect((await f.app.inject({method:'POST',url:f.url+'/script/narrations/'+s.record.id+'/cancel',auth,payload:{}})).statusCode).toBe(200);await dispatch;
  expect(f.app.db.narrationRecords.get(s.record.id)?.status).toBe(mode==='cancel'?'cancelled':mode==='lease'?'generating':'unknown');if(mode==='lease')expect(f.app.db.generationRuns.get(s.run.id)).toMatchObject({status:'running',dispatchClaimCount:2,dispatchLeaseOwner:expect.any(String),dispatchLeaseExpiresAt:expect.any(Date)});expect([...f.app.db.usageCostRecords.values()][0].outputUnits).toBe(308);expect(f.project.activeNarrationRecordId??null).toBeNull();expect(generate).toHaveBeenCalledOnce();
 });
});


it('同一 dispatcher 的 claim2 在旧完整结果迟到退出后仍可正常完成',async()=>{
 const provider=syntheticProvider(),generate=vi.spyOn(provider,'generate'),f=await fixture(provider),s=await prepared(f);const firstEntered=deferred<void>(),secondEntered=deferred<void>(),releaseFirst=deferred<void>(),releaseSecond=deferred<void>();const original=NarrationRepository.prototype.saveReadyBundle;let saves=0;
 vi.spyOn(NarrationRepository.prototype,'saveReadyBundle').mockImplementation(async function(...args){const n=++saves;if(n===1){firstEntered.resolve();await releaseFirst.promise}else if(n===2){secondEntered.resolve();await releaseSecond.promise}return original.apply(this,args)});
 const old=f.app.generationRunDispatcher.dispatch(s.run.id);await firstEntered.promise;const originalRun=f.app.db.generationRuns.get(s.run.id)!;originalRun.dispatchLeaseExpiresAt=new Date(Date.now()-1000);const current=f.app.generationRunDispatcher.dispatch(s.run.id);await secondEntered.promise;const expected=structuredClone(f.app.db.generationRuns.get(s.run.id)!);expect(expected.dispatchClaimCount).toBe(2);releaseFirst.resolve();expect(await old).toMatchObject({dispatched:true,fencedOut:true});expect(f.app.db.generationRuns.get(s.run.id)).toEqual(expected);expect(f.app.db.narrationRecords.get(s.record.id)?.status).toBe('generating');
 releaseSecond.resolve();expect(await current).toMatchObject({dispatched:true,outcome:{status:'succeeded'}});expect(f.app.db.generationRuns.get(s.run.id)).toMatchObject({status:'succeeded',dispatchClaimCount:2,dispatchLeaseOwner:null,dispatchLeaseExpiresAt:null});expect(f.app.db.narrationRecords.get(s.record.id)?.status).toBe('ready');expect(generate).toHaveBeenCalledOnce();expect([...f.app.db.usageCostRecords.values()]).toHaveLength(1);expect([...f.app.db.usageCostRecords.values()][0].outputUnits).toBe(9);expect(f.project.activeNarrationRecordId??null).toBeNull();
});
