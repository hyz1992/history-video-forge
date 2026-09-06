import { ZodError } from "zod";
import { mkdtempSync, rmSync, readFileSync, readdirSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import { applyAllDatabaseMigrations } from "../db/migration-test-utils.js";
import { createDbClient } from "../../../backend/src/db/client.js";
import { createProject } from "../../../backend/src/modules/projects/project.repository.js";
import { getProjectSnapshot } from "../../../backend/src/modules/projects/project-snapshot.service.js";

describe("narration persistence", () => {
  it("upgraded: migration adds legacy default and nullable active references", () => {
    const root = mkdtempSync(join(tmpdir(), "narration-migration-"));
    const sqlite = new Database(join(root, "test.db"));
    try {
      applyAllDatabaseMigrations(sqlite);
      const columns = sqlite.prepare('PRAGMA table_info("Project")').all() as Array<{name: string; dflt_value: string | null; notnull: number}>;
      expect(columns.find(c => c.name === "narrationTimingMode")?.dflt_value).toBe("'legacy_estimated'");
      expect(columns.find(c => c.name === "activeNarrationRecordId")?.notnull).toBe(0);
      expect(columns.find(c => c.name === "activeNarrationSubtitleRevisionId")?.notnull).toBe(0);
    } finally { sqlite.close(); rmSync(root, {recursive:true, force:true}); }
  });
  it("new legacy projects expose an empty narration summary", async () => {
    const db = createDbClient();
    const project = await createProject(db, { name: "旧流程" });
    expect(await getProjectSnapshot(db, project.id)).toMatchObject({narration_timing_mode:"legacy_estimated", active_narration:null, latest_narration_candidate:null, active_narration_subtitle_revision:null});
  });
});

import { createPrismaClient } from "../../../backend/src/db/prisma-client.js";
import { PrismaFirstAggregateWriter } from "../../../backend/src/db/repositories/prisma-first-aggregate-writer.js";
import { hydrateFirstAggregates } from "../../../backend/src/db/repositories/prisma-first-aggregate-hydrator.js";
import { PrismaProjectStore } from "../../../backend/src/db/repositories/prisma-project-store.js";
import { NarrationRepository } from "../../../backend/src/modules/narration/narration.repository.js";
import { deleteProject } from "../../../backend/src/modules/projects/project.repository.js";
import { buildApp } from "../../../backend/src/app.js";
import { DEFAULT_SUBTITLE_STYLE, DEFAULT_GENERATION_CONFIGURATION, type NarrationRecord, type NarrationSubtitleRevision } from "../../../shared/src/index.js";
const hash = "a".repeat(64), now = "2026-09-06T10:00:00.000Z";
function candidate(projectId: string, id = "n1", scriptRecordId = "s1"): NarrationRecord {
  return {schemaVersion:"narration_record_v1",id,projectId,scriptRecordId,generationRunId:"run-"+id,configurationSnapshotId:"snap-"+id,
    createdAt:now,updatedAt:now, sourceTextSha256:hash,spokenTextSha256:null,settingsSha256:hash,sourceProjectTtsSettingsSha256:hash,
    textMappingVersion:"narration-native-spans/v1",timingSource:"provider_native",providerTaskId:null,providerRequestId:null,status:"generating",errorCode:null,confirmedAt:null,confirmedBy:null,acceptedDurationBandSnapshot:null,output:null,
    settings:{model:"qwen-audio-3.0-tts-plus",voice:"qwen-audio-3.0-tts-plus-longyimuling",region:"cn-beijing",protocol:"dashscope_ws",parametersVersion:"neutral-pcm24k-v1",tone:"neutral",rate:1,pitch:1,volume:50,sampleRate:24000,format:"pcm",textType:"PlainText",wordTimestampEnabled:true,enableSsml:false,seed:0,inputMode:"natural_paragraphs_single_task"}};
}
function bundle(record: NarrationRecord) {
  const ref = (file:string) => ({uri:"narration-runs/"+record.generationRunId+"/"+file,sha256:hash});
  const subtitle: NarrationSubtitleRevision = {id:"sub-"+record.id,projectId:record.projectId,narrationRecordId:record.id,audioHash:hash,timingHash:hash,
    subtitleSettingsSnapshotJson:{presetId:null,presetVersion:null,resolvedStyle:DEFAULT_SUBTITLE_STYLE,overrides:{},lineBreak:{strategy:"punctuation_and_length",maxCharactersPerLine:20,version:"v1"},resolverVersion:"v1"},subtitleSettingsHash:hash,builderVersion:"v1",srt:ref("captions.srt"),vtt:ref("captions.vtt"),createdAt:now};
  const ready: NarrationRecord = {...record,status:"ready",spokenTextSha256:hash,providerTaskId:"task",providerRequestId:"request",
    output:{audio:{...ref("audio.wav"),sampleRate:24000,channels:1,bitDepth:16,sampleCount:24000},durationMs:1000,nativeEvents:ref("native.json"),timingMap:ref("timing.json"),initialSubtitleRevisionId:subtitle.id,validationReport:{status:"pass",validatorVersion:"v1",checkedAt:now,nativeTextCoverageComplete:true,nativeTimingValid:true,audioProbeValid:true,issues:[]}}};
  return {ready,subtitle};
}
async function fixture() {
  const root=mkdtempSync(join(tmpdir(),"narration-repository-")), path=join(root,"test.db"), sqlite=new Database(path);
  applyAllDatabaseMigrations(sqlite); sqlite.pragma("foreign_keys = ON");
  const client=await createPrismaClient(path), db=createDbClient();
  await client.user.create({data:{id:"owner",username:"owner",displayName:"owner",passwordHash:"hash"}});
  await client.user.create({data:{id:"other",username:"other",displayName:"other",passwordHash:"hash"}});
  db.firstAggregateWriter=await PrismaFirstAggregateWriter.create(client,"owner");
  const p=await createProject(db,{name:"test"}), q=await createProject(db,{name:"other",ownerId:"other"});
  const topic=async(projectId:string,id:string)=>client.topicPackage.create({data:{id,projectId,title:"t",selectedAngle:"a",familyLabel:"f",scopeLabel:"s",coreConflict:"c",strongScene:"s",packagingSeed:"s",canonicalQuotesJson:[],canonicalQuoteIntentsJson:[],durationBandJson:{},narrativeTensionMapJson:{},mustIncludeBeatsJson:[],forbiddenExpansionsJson:[],riskHintsJson:[],sourceAnchorRefsJson:[],ambiguityNotesJson:[]}});
  await topic(p.id,"t1"); await topic(q.id,"t2");
  for (const [id,projectId,topicPackageId] of [["s1",p.id,"t1"],["s2",p.id,"t1"],["sq",q.id,"t2"]]) await client.scriptRecord.create({data:{id,projectId,topicPackageId,scriptText:"正文",openingSpan:"正文",endingSpan:"正文",estimatedDurationSec:1,beatTraceJson:[],quoteTraceJson:[],reviewStatus:"pass"}});
  await client.project.update({where:{id:p.id},data:{activeScriptRecordId:"s1"}});
  const repo=new NarrationRepository(db), store=new PrismaProjectStore(client);
  const source=async(record:NarrationRecord)=>{
    await client.runConfigurationSnapshot.create({data:{id:record.configurationSnapshotId,projectId:record.projectId,stage:"script",operation:"script.narration.generate",runId:record.generationRunId,projectConfigurationRevision:1,schemaVersion:"run_configuration_snapshot_v1",configurationHash:hash,resolvedConfigurationJson:{},resolutionTraceJson:[],pricingVersionSetJson:[]}});
    await client.generationRun.create({data:{id:record.generationRunId,projectId:record.projectId,operation:"script.narration.generate",idempotencyKey:record.id,payloadFingerprint:hash,runConfigurationSnapshotId:record.configurationSnapshotId,dispatchPayloadJson:{},status:"running"}});
  };
  const save=async(id="n1", projectId=p.id, script="s1")=>{const c=candidate(projectId,id,script);await source(c);await repo.createCandidate(projectId===p.id?"owner":"other",c);const b=bundle(c);await repo.saveReadyBundle(projectId===p.id?"owner":"other",b.ready,b.subtitle);return b;};
  const confirm=async(id:string)=>{await client.narrationRecord.update({where:{id},data:{status:"confirmed",confirmedAt:new Date(now),confirmedBy:"owner",acceptedDurationBandSnapshotJson:{minMs:500,maxMs:1500}}});};
  return {root,path,sqlite,client,db,p,q,repo,store,source,save,confirm,close:async()=>{await client.$disconnect();sqlite.close();rmSync(root,{recursive:true,force:true});}};
}

describe("narration database authority and transitions",()=>{
  it("recovered: ready bundle survives cold hydration and never fills active implicitly",async()=>{
    const f=await fixture();try {
      const b=await f.save();
      const fresh=createDbClient(); await hydrateFirstAggregates(fresh,new Map(),f.client,{storageRoot:f.root});
      expect(fresh.narrationRecords.size).toBe(0);
      expect(await new NarrationRepository(fresh).findForRunForOwner(f.p.id,"owner","s1","run-n1")).toEqual(b.ready);
      const snap=await getProjectSnapshot(fresh,f.p.id);
      expect(snap).toMatchObject({active_narration:null,latest_narration_candidate:{narration_record_id:"n1",status:"ready"}});
      expect(JSON.stringify(snap)).not.toMatch(/tokens|boundaries|settingsJson|timingMap/);
      await f.save("n2");
      fresh.narrationRecords.set("fake",{...b.ready,id:"fake",createdAt:"2099-01-01T00:00:00Z"});
      expect((await getProjectSnapshot(fresh,f.p.id))?.latest_narration_candidate?.narration_record_id).toBe("n2");
      await expect(new NarrationRepository(fresh).findByIdForOwner(f.p.id,"other","n1")).rejects.toThrow("project_scope_denied");
      expect(await new NarrationRepository(fresh).findForRunForOwner(f.p.id,"owner","s2","run-n1")).toBeNull();
    }finally{await f.close();}
  });
  it("buildApp with Prisma reads authoritative rows without the hydrator",async()=>{
    const f=await fixture();try{const b=await f.save();const app=buildApp({prismaClient:f.client,skipSnapshotLoad:true,storageBaseDir:f.root});expect(await new NarrationRepository(app.db).findByIdForOwner(f.p.id,"owner","n1")).toEqual(b.ready);}finally{await f.close();}
  });
  it("duplicated: generation run is unique at the SQLite boundary",async()=>{
    const f=await fixture();try{const c=candidate(f.p.id);await f.source(c);await f.repo.createCandidate("owner",c);const row=f.sqlite.prepare('SELECT * FROM NarrationRecord WHERE id=?').get(c.id) as Record<string,unknown>;row.id="duplicate";const keys=Object.keys(row);expect(()=>f.sqlite.prepare('INSERT INTO NarrationRecord ('+keys.map(k=>'"'+k+'"').join(',')+') VALUES ('+keys.map(()=>'?').join(',')+')').run(...Object.values(row))).toThrow(/UNIQUE constraint failed: NarrationRecord.generationRunId/);}finally{await f.close();}
  });
  it("rejects foreign script and mismatched run snapshot before persistence",async()=>{
    const f=await fixture();try{const c=candidate(f.p.id);await f.source(c);await expect(f.repo.createCandidate("owner",{...c,scriptRecordId:"sq"})).rejects.toThrow("narration_source_project_mismatch");const other=candidate(f.p.id,"n2");await f.source(other);await expect(f.repo.createCandidate("owner",{...c,configurationSnapshotId:other.configurationSnapshotId})).rejects.toThrow("narration_source_project_mismatch");expect(await f.client.narrationRecord.count()).toBe(0);}finally{await f.close();}
  });
  it("SQLite rejects same-project run with another snapshot and a foreign script",async()=>{
    const f=await fixture();try{const c=candidate(f.p.id);await f.source(c);await f.repo.createCandidate("owner",c);await f.source(candidate(f.p.id,"n2"));expect(()=>f.sqlite.prepare('UPDATE NarrationRecord SET scriptRecordId=? WHERE id=?').run("sq","n1")).toThrow(/narration_source/);expect(()=>f.sqlite.prepare('UPDATE NarrationRecord SET configurationSnapshotId=? WHERE id=?').run("snap-n2","n1")).toThrow(/narration_source/);}finally{await f.close();}
  });
  it("partially_failed: failed initial revision insertion rolls back ready and preserves old active",async()=>{
    const f=await fixture();try{const old=await f.save();await f.confirm("n1");await f.store.updateActiveRecordsForOwner(f.p.id,"owner",{activeNarrationRecordId:"n1",activeNarrationSubtitleRevisionId:old.subtitle.id});const c=candidate(f.p.id,"n2");await f.source(c);await f.repo.createCandidate("owner",c);const b=bundle(c);b.subtitle.id=old.subtitle.id;b.ready.output!.initialSubtitleRevisionId=old.subtitle.id;await expect(f.repo.saveReadyBundle("owner",b.ready,b.subtitle)).rejects.toMatchObject({code:"P2002"});expect((await f.repo.findByIdForOwner(f.p.id,"owner","n2"))?.status).toBe("generating");expect((await f.store.findByIdForOwner(f.p.id,"owner"))?.activeNarrationRecordId).toBe("n1");expect(await f.client.narrationSubtitleRevision.count()).toBe(1);}finally{await f.close();}
  });
  it("ready output and subtitle revisions are immutable but confirmation metadata remains writable",async()=>{
    const f=await fixture();try{await f.save();expect(()=>f.sqlite.prepare('UPDATE NarrationRecord SET outputJson=? WHERE id=?').run('{}','n1')).toThrow(/narration_output_immutable/);expect(()=>f.sqlite.prepare('UPDATE NarrationSubtitleRevision SET audioHash=? WHERE id=?').run('b'.repeat(64),'sub-n1')).toThrow(/narration_subtitle_immutable/);await f.confirm("n1");expect((await f.repo.findByIdForOwner(f.p.id,"owner","n1"))?.status).toBe("confirmed");}finally{await f.close();}
  });
  it("switched: complete active combination is checked in both directions and owner scoped",async()=>{
    const f=await fixture();try{await f.save();await f.save("n2");await f.save("nq",f.q.id,"sq");await f.confirm("n1");await f.confirm("n2");await f.confirm("nq");await f.store.updateActiveRecordsForOwner(f.p.id,"owner",{narrationTimingMode:"narration_first_v1",activeNarrationRecordId:"n1",activeNarrationSubtitleRevisionId:"sub-n1"});
      await expect(f.store.updateActiveRecordsForOwner(f.p.id,"other",{activeNarrationRecordId:"n2"})).rejects.toThrow("project_scope_denied");
      for(const patch of [{activeNarrationRecordId:"nq"},{activeNarrationSubtitleRevisionId:"sub-nq"},{activeNarrationRecordId:"n2"},{activeNarrationSubtitleRevisionId:"sub-n2"},{activeNarrationRecordId:null}]) await expect(f.store.updateActiveRecordsForOwner(f.p.id,"owner",patch)).rejects.toThrow(/project_active_narration/);
      await f.store.updateActiveRecordsForOwner(f.p.id,"owner",{activeNarrationRecordId:"n2",activeNarrationSubtitleRevisionId:"sub-n2"});
      const fresh=createDbClient();await hydrateFirstAggregates(fresh,new Map(),f.client,{storageRoot:f.root});
      expect(fresh.projects.get(f.p.id)).toMatchObject({narrationTimingMode:"narration_first_v1",activeNarrationRecordId:"n2",activeNarrationSubtitleRevisionId:"sub-n2"});
      expect(await getProjectSnapshot(fresh,f.p.id)).toMatchObject({narration_timing_mode:"narration_first_v1",active_narration:{narration_record_id:"n2"},active_narration_subtitle_revision:{id:"sub-n2"}});
      // 陈旧metadata sync不得回写已经切换的active。
      await f.db.firstAggregateWriter!.syncProject(f.p);
      expect((await f.store.findByIdForOwner(f.p.id,"owner"))?.activeNarrationRecordId).toBe("n2");
    }finally{await f.close();}
  });
  it("SQLite enforces final active pairing, mode CHECK, and FK deletion order",async()=>{
    const f=await fixture();try{await f.save();await f.save("n2");await f.confirm("n1");await f.confirm("n2");await f.store.updateActiveRecordsForOwner(f.p.id,"owner",{activeNarrationRecordId:"n1",activeNarrationSubtitleRevisionId:"sub-n1"});expect(()=>f.sqlite.prepare('UPDATE Project SET activeNarrationRecordId=? WHERE id=?').run('n2',f.p.id)).toThrow(/project_active_narration/);expect(()=>f.sqlite.prepare('UPDATE Project SET narrationTimingMode=? WHERE id=?').run('bad',f.p.id)).toThrow(/CHECK constraint failed/);expect(()=>f.sqlite.prepare('DELETE FROM NarrationRecord WHERE id=?').run('n1')).toThrow(/FOREIGN KEY constraint failed/);expect(()=>f.sqlite.prepare('DELETE FROM NarrationSubtitleRevision WHERE id=?').run('sub-n1')).toThrow(/FOREIGN KEY constraint failed/);expect(f.sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);}finally{await f.close();}
  });
  it("archives only the target project and clears its narration mirrors",async()=>{
    const f=await fixture();try{const a=await f.save(),b=await f.save("nq",f.q.id,"sq");f.db.narrationRecords.set(a.ready.id,a.ready);f.db.narrationRecords.set(b.ready.id,b.ready);f.db.narrationSubtitleRevisions.set(a.subtitle.id,a.subtitle);f.db.narrationSubtitleRevisions.set(b.subtitle.id,b.subtitle);expect(await deleteProject(f.db,f.p.id)).toEqual({deleted:true});expect((await f.client.project.findUniqueOrThrow({where:{id:f.p.id}})).archivedAt).not.toBeNull();expect(await f.client.narrationRecord.count()).toBe(2);expect([...f.db.narrationRecords.keys()]).toEqual(["nq"]);expect([...f.db.narrationSubtitleRevisions.keys()]).toEqual(["sub-nq"]);await expect(f.repo.findByIdForOwner(f.p.id,"owner","n1")).rejects.toThrow("project_scope_denied");}finally{await f.close();}
  });
});


describe("narration upgrade, recovery and complete boundary objects",()=>{
  it("upgraded: pre-migration project row retains content and defaults to legacy",async()=>{
    const root=mkdtempSync(join(tmpdir(),"narration-old-row-")),path=join(root,"test.db"),sqlite=new Database(path);
    try {
      const migrations=join(process.cwd(),"backend/prisma/migrations"),entries=readdirSync(migrations,{withFileTypes:true}).filter(e=>e.isDirectory()).sort((a,b)=>a.name.localeCompare(b.name));
      for(const e of entries.filter(e=>e.name!=="20260906193000_narration_records")) sqlite.exec(readFileSync(join(migrations,e.name,"migration.sql"),"utf8"));
      sqlite.prepare('INSERT INTO User (id,username,displayName,passwordHash,updatedAt) VALUES (?,?,?,?,?)').run('old-owner','old-owner','旧用户','hash',now);
      sqlite.prepare('INSERT INTO Project (id,ownerId,createdById,name,storageKey,storageDisplayName,updatedAt) VALUES (?,?,?,?,?,?,?)').run('old-project','old-owner','old-owner','旧项目','old-project','旧项目',now);
      sqlite.exec(readFileSync(join(migrations,"20260906193000_narration_records/migration.sql"),"utf8"));
      expect(sqlite.prepare('SELECT name,narrationTimingMode,activeNarrationRecordId,activeNarrationSubtitleRevisionId FROM Project WHERE id=?').get('old-project')).toEqual({name:'旧项目',narrationTimingMode:'legacy_estimated',activeNarrationRecordId:null,activeNarrationSubtitleRevisionId:null});
      const client=await createPrismaClient(path);try{expect(await new PrismaProjectStore(client).findByIdForOwner('old-project','old-owner')).toMatchObject({narrationTimingMode:'legacy_estimated'});}finally{await client.$disconnect();}
    } finally {sqlite.close();rmSync(root,{recursive:true,force:true});}
  });
  it("both writer creation paths persist explicit mode and Store reads it",async()=>{
    const f=await fixture();try{
      const project={...f.p,id:'explicit-mode',narrationTimingMode:'narration_first_v1' as const};
      await f.db.firstAggregateWriter!.createProject(project);
      const withConfig={...project,id:'explicit-config'};
      await f.db.firstAggregateWriter!.createProjectWithGenerationConfiguration(withConfig,{id:'config-explicit',projectId:withConfig.id,schemaVersion:'generation_configuration_v1',revision:1,sourceUserPreferenceRevision:null,configurationJson:DEFAULT_GENERATION_CONFIGURATION,createdAt:new Date(now),updatedAt:new Date(now)});
      for(const id of [project.id,withConfig.id]) expect(await f.store.findByIdForOwner(id,'owner')).toMatchObject({narrationTimingMode:'narration_first_v1',activeNarrationRecordId:null,activeNarrationSubtitleRevisionId:null});
    }finally{await f.close();}
  });
  it("recovered: finds narration-only UUID storage despite a stale date-layout shell",async()=>{
    const f=await fixture();try{
      const fresh=createDbClient();await hydrateFirstAggregates(fresh,new Map(),f.client,{storageRoot:f.root});
      const shell=fresh.projects.get(f.p.id)!.storageRootDir;mkdirSync(shell,{recursive:true});writeFileSync(join(shell,'project.json'),'{}');
      const real=join(f.root,'storage/projects',f.p.id);mkdirSync(join(real,'narration-runs/run-n1'),{recursive:true});writeFileSync(join(real,'narration-runs/run-n1/audio.wav'),'fixture');
      await hydrateFirstAggregates(fresh,new Map(),f.client,{storageRoot:f.root});
      expect(fresh.projects.get(f.p.id)?.storageRootDir).toBe(real);
    }finally{await f.close();}
  });
  it("deleting a project removes only its new narration directory and archives its DB rows",async()=>{
    const f=await fixture();try{
      await f.save();await f.save('nq',f.q.id,'sq');
      const target=join(f.root,'storage/projects',f.p.id),other=join(f.root,'storage/projects',f.q.id);
      for(const dir of [target,other]) {mkdirSync(join(dir,'narration-runs/run'),{recursive:true});writeFileSync(join(dir,'narration-runs/run/audio.wav'),'fixture');}
      f.p.storageRootDir=target;f.q.storageRootDir=other;
      vi.resetModules();const cwdSpy=vi.spyOn(process,'cwd').mockReturnValue(f.root);
      const isolated=await import('../../../backend/src/modules/projects/project.repository.js');cwdSpy.mockRestore();
      const originalVitest=process.env.VITEST;delete process.env.VITEST;
      try {expect(await isolated.deleteProject(f.db,f.p.id)).toEqual({deleted:true});}finally{process.env.VITEST=originalVitest;}
      expect(existsSync(target)).toBe(false);expect(readFileSync(join(other,'narration-runs/run/audio.wav'),'utf8')).toBe('fixture');
      expect(await f.client.narrationRecord.count()).toBe(2);
    }finally{vi.restoreAllMocks();await f.close();}
  });
  it("immutable subtitle append retains full historical style and rejects hash/source mismatch",async()=>{
    const f=await fixture();try{const b=await f.save();const revised={...b.subtitle,id:'sub-second',subtitleSettingsHash:'b'.repeat(64),subtitleSettingsSnapshotJson:{...b.subtitle.subtitleSettingsSnapshotJson,resolvedStyle:{...b.subtitle.subtitleSettingsSnapshotJson.resolvedStyle,font_size_px:50}}};
      await f.repo.appendSubtitleRevision('owner',revised);
      expect(await f.repo.findSubtitleForOwner(f.p.id,'owner',b.subtitle.id)).toEqual(b.subtitle);
      expect(await f.repo.findSubtitleForOwner(f.p.id,'owner',revised.id)).toEqual(revised);
      await expect(f.repo.appendSubtitleRevision('owner',{...revised,id:'duplicate'})).rejects.toMatchObject({code:'P2002'});
      await expect(f.repo.appendSubtitleRevision('owner',{...revised,id:'wrong-audio',audioHash:'c'.repeat(64)})).rejects.toThrow('narration_subtitle_source_mismatch');
      await expect(f.repo.saveReadyBundle('owner',b.ready,b.subtitle)).rejects.toThrow('narration_state_conflict');
    }finally{await f.close();}
  });
  it("SQLite forbids ready INSERT with another narration's derived initial subtitle",async()=>{
    const f=await fixture();try{const b=await f.save();await f.repo.appendSubtitleRevision('owner',{...b.subtitle,id:'derived',subtitleSettingsHash:'b'.repeat(64)});const c=candidate(f.p.id,'n2');await f.source(c);
      const row=f.sqlite.prepare('SELECT * FROM NarrationRecord WHERE id=?').get('n1') as Record<string,unknown>;
      Object.assign(row,{id:'n2',generationRunId:c.generationRunId,configurationSnapshotId:c.configurationSnapshotId,initialSubtitleRevisionId:'derived',outputJson:JSON.stringify({...b.ready.output,initialSubtitleRevisionId:'derived'})});
      const keys=Object.keys(row);expect(()=>f.sqlite.prepare('INSERT INTO NarrationRecord ('+keys.map(k=>'"'+k+'"').join(',')+') VALUES ('+keys.map(()=>'?').join(',')+')').run(...Object.values(row))).toThrow(/narration_initial_subtitle/);
      await f.repo.createCandidate('owner',c);
      expect(()=>f.sqlite.prepare('UPDATE NarrationRecord SET status=?,spokenTextSha256=?,providerTaskId=?,providerRequestId=?,initialSubtitleRevisionId=?,outputJson=? WHERE id=?').run('ready',hash,'task','request','derived',row.outputJson,'n2')).toThrow(/narration_initial_subtitle/);
    }finally{await f.close();}
  });
  it("partially_failed: SQLite failure after subtitle insertion rolls back the whole bundle",async()=>{
    const f=await fixture();try{const c=candidate(f.p.id);await f.source(c);await f.repo.createCandidate('owner',c);const b=bundle(c);
      f.sqlite.exec(`CREATE TABLE fixture_failure (fixtureCheckpoint INTEGER CHECK (fixtureCheckpoint = 0)); CREATE TRIGGER test_fail_ready BEFORE UPDATE ON NarrationRecord WHEN NEW.status='ready' AND EXISTS(SELECT 1 FROM NarrationSubtitleRevision WHERE id='sub-n1') BEGIN INSERT INTO fixture_failure VALUES (1); END;`);
      await expect(f.repo.saveReadyBundle('owner',b.ready,b.subtitle)).rejects.toThrow(/CHECK constraint failed: fixtureCheckpoint/);
      expect(await f.client.narrationSubtitleRevision.count()).toBe(0);expect((await f.repo.findByIdForOwner(f.p.id,'owner','n1'))?.status).toBe('generating');
      f.sqlite.exec('DROP TRIGGER test_fail_ready');
      await f.client.$disconnect();const recoveredClient=await createPrismaClient(f.path);
      try{const fresh=createDbClient();await hydrateFirstAggregates(fresh,new Map(),recoveredClient,{storageRoot:f.root});const recovered=new NarrationRepository(fresh);expect((await recovered.findByIdForOwner(f.p.id,'owner','n1'))?.status).toBe('generating');await recovered.saveReadyBundle('owner',b.ready,b.subtitle);expect((await recovered.findByIdForOwner(f.p.id,'owner','n1'))?.status).toBe('ready');}finally{await recoveredClient.$disconnect();}
    }finally{await f.close();}
  });
});


describe("narration structural rejection paths",()=>{
  it("SQLite CHECK rejects invalid status and incomplete ready before activation",async()=>{
    const f=await fixture();try{const c=candidate(f.p.id);await f.source(c);await f.repo.createCandidate('owner',c);
      for(const status of ['invented','ready','failed','unknown']) expect(()=>f.sqlite.prepare('UPDATE NarrationRecord SET status=? WHERE id=?').run(status,c.id)).toThrow(/CHECK constraint failed/);
      await expect(f.store.updateActiveRecordsForOwner(f.p.id,'owner',{activeNarrationRecordId:c.id})).rejects.toThrow('project_active_narration_mismatch');
      expect(()=>f.sqlite.prepare('DELETE FROM GenerationRun WHERE id=?').run(c.generationRunId)).toThrow(/FOREIGN KEY constraint failed/);
      expect(()=>f.sqlite.prepare('DELETE FROM ScriptRecord WHERE id=?').run(c.scriptRecordId)).toThrow(/FOREIGN KEY constraint failed/);
    }finally{await f.close();}
  });
  it("cross-project sources are rejected for run and snapshot as well as script",async()=>{
    const f=await fixture();try{const c=candidate(f.p.id),foreign=candidate(f.q.id,'nq','sq');await f.source(c);await f.source(foreign);
      for(const input of [{...c,generationRunId:foreign.generationRunId},{...c,configurationSnapshotId:foreign.configurationSnapshotId},{...c,scriptRecordId:foreign.scriptRecordId}]) await expect(f.repo.createCandidate('owner',input)).rejects.toThrow('narration_source_project_mismatch');
      await f.repo.createCandidate('owner',c);
      const base=f.sqlite.prepare('SELECT * FROM NarrationRecord WHERE id=?').get(c.id) as Record<string,unknown>;
      for(const patch of [{id:'bad-run',generationRunId:foreign.generationRunId},{id:'bad-script',scriptRecordId:foreign.scriptRecordId},{id:'bad-snapshot',configurationSnapshotId:foreign.configurationSnapshotId}]) {
        const row={...base,...patch},keys=Object.keys(row);
        expect(()=>f.sqlite.prepare('INSERT INTO NarrationRecord ('+keys.map(k=>'"'+k+'"').join(',')+') VALUES ('+keys.map(()=>'?').join(',')+')').run(...Object.values(row))).toThrow(/narration_source_project_mismatch/);
      }
      expect(await f.client.narrationRecord.count()).toBe(1);
    }finally{await f.close();}
  });
});


function insertSubtitleFixture(sqlite: Database.Database, revision: NarrationSubtitleRevision): void {
  sqlite.prepare('INSERT INTO NarrationSubtitleRevision (id,projectId,narrationRecordId,audioHash,timingHash,subtitleSettingsSnapshotJson,subtitleSettingsHash,builderVersion,srtJson,vttJson,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(
    revision.id, revision.projectId, revision.narrationRecordId, revision.audioHash, revision.timingHash,
    JSON.stringify(revision.subtitleSettingsSnapshotJson), revision.subtitleSettingsHash, revision.builderVersion,
    JSON.stringify(revision.srt), JSON.stringify(revision.vtt), revision.createdAt,
  );
}
function commitReadyFixture(sqlite: Database.Database, ready: NarrationRecord): void {
  sqlite.prepare('UPDATE NarrationRecord SET status=?,spokenTextSha256=?,providerTaskId=?,providerRequestId=?,initialSubtitleRevisionId=?,outputJson=? WHERE id=?').run(
    ready.status, ready.spokenTextSha256, ready.providerTaskId, ready.providerRequestId,
    ready.output!.initialSubtitleRevisionId, JSON.stringify(ready.output), ready.id,
  );
}

describe("round 1 F1: all readable and active subtitles match frozen media", () => {
  it.each(['audioHash', 'timingHash'] as const)("staged %s mismatch blocks the complete ready transaction at repository and SQLite boundaries", async (field) => {
    const f = await fixture();
    try {
      const c = candidate(f.p.id); await f.source(c); await f.repo.createCandidate('owner', c);
      const b = bundle(c), staged = { ...b.subtitle, id: 'staged', subtitleSettingsHash: 'b'.repeat(64), [field]: 'c'.repeat(64) };
      insertSubtitleFixture(f.sqlite, staged);
      expect(f.sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      await expect(f.repo.saveReadyBundle('owner', b.ready, b.subtitle)).rejects.toThrow('narration_subtitle_source_mismatch');
      expect((await f.repo.findByIdForOwner(f.p.id, 'owner', c.id))?.status).toBe('generating');
      expect(await f.client.narrationSubtitleRevision.count()).toBe(1);
      expect(() => f.sqlite.transaction(() => { insertSubtitleFixture(f.sqlite, b.subtitle); commitReadyFixture(f.sqlite, b.ready); })()).toThrow(/narration_subtitle_source_mismatch/);
      expect(await f.client.narrationSubtitleRevision.count()).toBe(1);
    } finally { await f.close(); }
  });

  it("staged revisions remain unavailable until output is frozen; multiple same-source revisions remain readable", async () => {
    const f = await fixture();
    try {
      const c = candidate(f.p.id); await f.source(c); await f.repo.createCandidate('owner', c);
      const b = bundle(c), staged = { ...b.subtitle, id: 'staged', subtitleSettingsHash: 'b'.repeat(64) };
      insertSubtitleFixture(f.sqlite, staged);
      expect(await f.repo.findSubtitleForOwner(f.p.id, 'owner', staged.id)).toBeNull();
      await f.repo.saveReadyBundle('owner', b.ready, b.subtitle);
      const later = { ...b.subtitle, id: 'later', subtitleSettingsHash: 'c'.repeat(64) };
      await f.repo.appendSubtitleRevision('owner', later);
      for (const revision of [staged, b.subtitle, later]) expect(await f.repo.findSubtitleForOwner(f.p.id, 'owner', revision.id)).toEqual(revision);
      await f.confirm(c.id);
      for (const revision of [later, staged]) await f.store.updateActiveRecordsForOwner(f.p.id, 'owner', { activeNarrationRecordId: c.id, activeNarrationSubtitleRevisionId: revision.id });
      expect((await f.store.findByIdForOwner(f.p.id, 'owner'))?.activeNarrationSubtitleRevisionId).toBe(staged.id);
    } finally { await f.close(); }
  });

  it.each(['audioHash', 'timingHash'] as const)("historical %s mismatch is rejected by read, append, Store, SQLite activation and snapshot", async (field) => {
    const f = await fixture();
    try {
      const b = await f.save(), derived = { ...b.subtitle, id: 'derived', subtitleSettingsHash: 'b'.repeat(64) };
      await f.repo.appendSubtitleRevision('owner', derived); await f.confirm(b.ready.id);
      await f.store.updateActiveRecordsForOwner(f.p.id, 'owner', { activeNarrationRecordId: b.ready.id, activeNarrationSubtitleRevisionId: b.subtitle.id });
      // 只在隔离fixture解除不可变保护，模拟升级前遗留的合法形状、错误来源行。
      f.sqlite.exec('DROP TRIGGER narration_subtitle_immutable');
      f.sqlite.prepare('UPDATE NarrationSubtitleRevision SET "' + field + '"=? WHERE id=?').run('c'.repeat(64), derived.id);
      expect((f.sqlite.prepare('SELECT * FROM NarrationSubtitleRevision WHERE id=?').get(derived.id) as Record<string, unknown>)[field]).toBe('c'.repeat(64));
      expect(f.sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      await expect(f.repo.findSubtitleForOwner(f.p.id, 'owner', derived.id)).rejects.toThrow('narration_subtitle_source_mismatch');
      await expect(f.repo.appendSubtitleRevision('owner', { ...derived, id: 'bad-append', [field]: 'c'.repeat(64) })).rejects.toThrow('narration_subtitle_source_mismatch');
      await expect(f.store.updateActiveRecordsForOwner(f.p.id, 'owner', { activeNarrationSubtitleRevisionId: derived.id })).rejects.toThrow('project_active_narration_subtitle_mismatch');
      expect(() => f.sqlite.prepare('UPDATE Project SET activeNarrationSubtitleRevisionId=? WHERE id=?').run(derived.id, f.p.id)).toThrow(/project_active_narration_subtitle_mismatch/);
      // 模拟遗留坏active，正式read与snapshot必须仍然拒绝，不能依赖新写入门禁。
      f.sqlite.exec('DROP TRIGGER project_active_narration_update');
      f.sqlite.prepare('UPDATE Project SET activeNarrationSubtitleRevisionId=? WHERE id=?').run(derived.id, f.p.id);
      await expect(f.store.updateActiveRecordsForOwner(f.p.id, 'owner', { narrationTimingMode: 'narration_first_v1' })).rejects.toThrow('project_active_narration_subtitle_mismatch');
      const fresh = createDbClient(); await hydrateFirstAggregates(fresh, new Map(), f.client, { storageRoot: f.root });
      expect(fresh.projects.get(f.p.id)?.activeNarrationSubtitleRevisionId).toBe(derived.id);
      await expect(getProjectSnapshot(fresh, f.p.id)).rejects.toThrow('narration_subtitle_source_mismatch');
    } finally { await f.close(); }
  });
});


async function expectStoredZodFailure(readOperation: () => Promise<unknown>, path: string): Promise<void> {
  const error = await readOperation().then(() => null, error => error);
  expect(error).toBeInstanceOf(ZodError);
  expect((error as ZodError).issues.some(issue => issue.path.join('.') === path)).toBe(true);
}

describe("round 1 F2: untrusted persisted JSON passes through full schema validation", () => {
  const outputCorruptions: Array<{ name: string; path: string; mutate: (output: NonNullable<NarrationRecord['output']>) => unknown }> = [
    { name: 'missing audio', path: 'output.audio', mutate: output => ({ ...output, audio: undefined }) },
    { name: 'array instead of object', path: 'output', mutate: () => [] },
    { name: 'fractional 15.5 milliseconds', path: 'output.durationMs', mutate: output => ({ ...output, durationMs: 15.5 }) },
    { name: 'unsafe sample count', path: 'output.audio.sampleCount', mutate: output => ({ ...output, audio: { ...output.audio, sampleCount: Number.MAX_SAFE_INTEGER + 1 } }) },
    { name: 'empty URI', path: 'output.audio.uri', mutate: output => ({ ...output, audio: { ...output.audio, uri: '' } }) },
    { name: 'path traversal URI', path: 'output.timingMap.uri', mutate: output => ({ ...output, timingMap: { ...output.timingMap, uri: 'narration-runs/run-n1/../outside.json' } }) },
  ];
  it.each(outputCorruptions)("record $name is rejected by repository and an actual active snapshot with ZodError", async ({ path, mutate }) => {
    const f = await fixture();
    try {
      const b = await f.save(); await f.confirm(b.ready.id);
      await f.store.updateActiveRecordsForOwner(f.p.id, 'owner', { activeNarrationRecordId: b.ready.id, activeNarrationSubtitleRevisionId: b.subtitle.id });
      const fresh = createDbClient(); await hydrateFirstAggregates(fresh, new Map(), f.client, { storageRoot: f.root });
      expect(fresh.projects.get(f.p.id)?.activeNarrationRecordId).toBe(b.ready.id);
      expect(await getProjectSnapshot(fresh, f.p.id)).toMatchObject({ active_narration: { narration_record_id: b.ready.id } });
      const corrupt = mutate(b.ready.output!);
      // 只向临时数据库注入历史坏JSON；现行不可变约束仍保留在生产迁移中。
      f.sqlite.exec('DROP TRIGGER narration_output_immutable');
      f.sqlite.prepare('UPDATE NarrationRecord SET outputJson=? WHERE id=?').run(JSON.stringify(corrupt), b.ready.id);
      const stored = f.sqlite.prepare('SELECT outputJson FROM NarrationRecord WHERE id=?').get(b.ready.id) as { outputJson: string };
      expect(JSON.parse(stored.outputJson)).toEqual(JSON.parse(JSON.stringify(corrupt)));
      expect(f.sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      await expectStoredZodFailure(() => new NarrationRepository(fresh).findByIdForOwner(f.p.id, 'owner', b.ready.id), path);
      await expectStoredZodFailure(() => getProjectSnapshot(fresh, f.p.id), path);
    } finally { await f.close(); }
  });

  const subtitleCorruptions: Array<{ name: string; column: string; path: string; mutate: (subtitle: NarrationSubtitleRevision) => unknown }> = [
    { name: 'missing full style', column: 'subtitleSettingsSnapshotJson', path: 'subtitleSettingsSnapshotJson.resolvedStyle', mutate: subtitle => ({ ...subtitle.subtitleSettingsSnapshotJson, resolvedStyle: undefined }) },
    { name: 'array instead of settings object', column: 'subtitleSettingsSnapshotJson', path: 'subtitleSettingsSnapshotJson', mutate: () => [] },
    { name: 'fractional 15.5 line length', column: 'subtitleSettingsSnapshotJson', path: 'subtitleSettingsSnapshotJson.lineBreak.maxCharactersPerLine', mutate: subtitle => ({ ...subtitle.subtitleSettingsSnapshotJson, lineBreak: { ...subtitle.subtitleSettingsSnapshotJson.lineBreak, maxCharactersPerLine: 15.5 } }) },
    { name: 'unsafe line length', column: 'subtitleSettingsSnapshotJson', path: 'subtitleSettingsSnapshotJson.lineBreak.maxCharactersPerLine', mutate: subtitle => ({ ...subtitle.subtitleSettingsSnapshotJson, lineBreak: { ...subtitle.subtitleSettingsSnapshotJson.lineBreak, maxCharactersPerLine: Number.MAX_SAFE_INTEGER + 1 } }) },
    { name: 'empty resolver version', column: 'subtitleSettingsSnapshotJson', path: 'subtitleSettingsSnapshotJson.resolverVersion', mutate: subtitle => ({ ...subtitle.subtitleSettingsSnapshotJson, resolverVersion: '' }) },
    { name: 'illegal absolute URI', column: 'srtJson', path: 'srt.uri', mutate: subtitle => ({ ...subtitle.srt, uri: 'https://example.invalid/captions.srt' }) },
  ];
  it.each(subtitleCorruptions)("subtitle $name is rejected by repository and actual active snapshot with ZodError", async ({ column, path, mutate }) => {
    const f = await fixture();
    try {
      const b = await f.save(); await f.confirm(b.ready.id);
      await f.store.updateActiveRecordsForOwner(f.p.id, 'owner', { activeNarrationRecordId: b.ready.id, activeNarrationSubtitleRevisionId: b.subtitle.id });
      const fresh = createDbClient(); await hydrateFirstAggregates(fresh, new Map(), f.client, { storageRoot: f.root });
      expect(fresh.projects.get(f.p.id)?.activeNarrationSubtitleRevisionId).toBe(b.subtitle.id);
      expect(await new NarrationRepository(fresh).findSubtitleForOwner(f.p.id, 'owner', b.subtitle.id)).toEqual(b.subtitle);
      const corrupt = mutate(b.subtitle);
      f.sqlite.exec('DROP TRIGGER narration_subtitle_immutable');
      f.sqlite.prepare('UPDATE NarrationSubtitleRevision SET "' + column + '"=? WHERE id=?').run(JSON.stringify(corrupt), b.subtitle.id);
      const stored = f.sqlite.prepare('SELECT "' + column + '" AS payload FROM NarrationSubtitleRevision WHERE id=?').get(b.subtitle.id) as { payload: string };
      expect(JSON.parse(stored.payload)).toEqual(JSON.parse(JSON.stringify(corrupt)));
      expect(f.sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      // 父口播仍能完整读取，证明失败来自目标字幕解码而非owner/父记录/fixture错误。
      expect((await new NarrationRepository(fresh).findByIdForOwner(f.p.id, 'owner', b.ready.id))?.id).toBe(b.ready.id);
      await expectStoredZodFailure(() => new NarrationRepository(fresh).findSubtitleForOwner(f.p.id, 'owner', b.subtitle.id), path);
      await expectStoredZodFailure(() => getProjectSnapshot(fresh, f.p.id), path);
    } finally { await f.close(); }
  });
});
