import { expect, it } from 'vitest';
import { buildApp } from '../../../backend/src/app.js';
import { runnable } from '../narration/subtitle-revision-test-context.js';
import { buildTestAuth } from '../auth/test-utils.js';
it('口播context返回权威正文和目标区间，资格能力不扩大', async()=>{
 const f=await runnable(),app=buildApp({storageBaseDir:f.path,skipSnapshotLoad:true}),auth=buildTestAuth({userId:f.project.ownerId});
 Object.assign(app.db,f.db);
 const r=await app.inject({method:'GET',url:'/api/projects/p1/script/narration/context',auth});
 expect(r.statusCode,JSON.stringify(r.json())).toBe(200);expect(r.json()).toMatchObject({source_script_record_id:'s1',source_text_sha256:f.record.sourceTextSha256,target_duration_band:{minMs:100000,maxMs:120000}});
 expect((r.json() as any).options).toHaveLength(1);
 expect((r.json() as any).options.every((o:any)=>o.supported_tones.join()==='neutral'&&o.supported_rates.join()==='1')).toBe(true);
 const denied=await app.inject({method:'GET',url:'/api/projects/p1/script/narration/context',auth:buildTestAuth({userId:'other'})});expect([403,404]).toContain(denied.statusCode);
});
it('详情返回真实完整字幕快照和cue，不能跨记录选择字幕',async()=>{
 const f=await runnable(),app=buildApp({storageBaseDir:f.path,skipSnapshotLoad:true}),auth=buildTestAuth({userId:f.project.ownerId});
 f.db.generationRuns.set(f.record.generationRunId,{id:f.record.generationRunId,idempotencyKey:'accepted-key',status:'succeeded'} as never);
 Object.assign(app.db,f.db);
 const r=await app.inject({method:'GET',url:'/api/projects/p1/script/narrations/n1',auth});expect(r.statusCode,JSON.stringify(r.json())).toBe(200);expect((r.json() as any).idempotency_key).toBe("accepted-key");expect((r.json() as any).subtitle.revision).toEqual(f.revision);expect((r.json() as any).subtitle.timeline.cues.length).toBeGreaterThan(0);
 const bad=await app.inject({method:'GET',url:'/api/projects/p1/script/narrations/n1?subtitle_revision_id=wrong',auth});expect(bad.statusCode).toBe(404);
});
