import { cp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, vi } from 'vitest';
import { runnable, persistentRunnable } from '../narration/subtitle-revision-test-context.js';
import { importNarrationManifest } from '../../../backend/src/modules/assets/narration-manifest-importer.js';
import { deriveNarrationSubtitleRevision } from '../../../backend/src/modules/narration/narration-subtitle-revision.service.js';
import { runComposeGeneration } from '../../../backend/src/modules/compose/compose-run.service.js';
import * as validator from '../../../backend/src/modules/compose/compose-local-validator.js';
import { PrismaThirdAggregateWriter } from '../../../backend/src/db/repositories/prisma-third-aggregate-writer.js';
async function fixture(persistent = false) { const f = persistent ? await persistentRunnable() : await runnable(); if (persistent) {
    const storage = join(f.path, "storage", "projects", "p1");
    await mkdir(storage, { recursive: true });
    await cp(join(f.path, "narration-runs"), join(storage, "narration-runs"), { recursive: true });
} const revision = await deriveNarrationSubtitleRevision({ db: f.db, storageBaseDir: f.path }, 'p1', f.project.ownerId); const manifest = await importNarrationManifest({ ...f, revision, storageRootDir: persistent ? join(f.path, "storage", "projects", "p1") : f.path }); const image = join(f.path, 'image.png'); await writeFile(image, 'image fixture'); manifest.artifacts.push({ artifact_id: 'image', artifact_type: 'image', origin: 'local', file_uri: image, created_at: new Date().toISOString(), metadata: { width: 1080, height: 1920 } }); manifest.segment_routes = manifest.segment_routes.map(r => ({ ...r, visual_route_type: 'image_only', primary_visual_artifact_id: 'image', fallback_visual_artifact_id: null, motion_artifact_id: null, readiness: 'ready' })); manifest.readiness = 'ready_for_compose'; const m = { id: 'm', projectId: 'p1', topicPackageId: 't1', scriptRecordId: 's1', storyboardRecordId: 'sb', assetPlanRecordId: 'ap', revision: 1, manifestJson: manifest, validationResultJson: { decision: 'pass' }, executionStateJson: null, graphTraceSummaryJson: null, runtimeDiagnosticsJson: null, createdAt: new Date() }; f.db.assetManifestRecords.set('m', m); f.project.activeAssetManifestRecordId = 'm'; if (persistent)
    f.project.storageRootDir = join(f.path, "storage", "projects", "p1"); if ('client' in f) {
    await f.db.thirdAggregateWriter!.saveAssetManifest(m, f.project.ownerId);
    await f.client.project.update({ where: { id: 'p1' }, data: { activeAssetManifestRecordId: 'm' } });
} return f; }
it('compose rechecks DB after validation and never restores stale active pointers', async () => { const f = await fixture(true); vi.spyOn(validator, 'validateComposeTimeline').mockImplementationOnce(async () => { if ('client' in f)
    await f.client.project.update({ where: { id: 'p1' }, data: { activeAssetManifestRecordId: null, activeComposeRecordId: null } }); return { stage: 'compose_local_validation', decision: 'ready_for_render', errors: [], warnings: [], metrics: {} } as any; }); const r = await runComposeGeneration(f); expect(r.statusCode).toBe(409); if ('client' in f)
    expect((await f.client.project.findUniqueOrThrow({ where: { id: 'p1' } })).activeComposeRecordId).toBeNull(); expect([...f.db.composeRecords.values()].some(c => (c.executionStateJson as any)?.activated)).toBe(false); });
it('compose rejects changed narration before dispatch despite stale Map', async () => { const f = await fixture(true); if ('client' in f)
    await f.client.narrationRecord.update({ where: { id: 'n1' }, data: { status: 'stale' } }); const r = await runComposeGeneration(f); expect(r.statusCode).toBe(409); expect(f.db.composeRecords.size).toBe(0); });
import { runRenderGeneration } from '../../../backend/src/modules/render/render-run.service.js';
import { createFakeRenderAdapter } from '../../../backend/src/modules/render/fake-render-adapter.js';
import { createPrismaClient } from '../../../backend/src/db/prisma-client.js';
it('cold SQLite compose and render read current records without Map cache', async () => { const f = await fixture(true); const c = await runComposeGeneration(f); expect(c.statusCode).toBe(200); f.project.narrationTimingMode='legacy_estimated';f.db.composeRecords.clear(); f.db.assetManifestRecords.clear(); f.db.assetPlanRecords.clear(); f.db.storyboardRecords.clear(); const r = await runRenderGeneration(f); expect(r.statusCode).toBe(200); if ('client' in f)
    expect((await f.client.project.findUniqueOrThrow({ where: { id: 'p1' } })).activeRenderJobRecordId).toBe(r.body.render_job_record_id); });
for (const changed of ['narration', 'subtitle'])
    it('late render ' + changed + ' change stays history and does not restore outputs', async () => { const f = await fixture(true); expect((await runComposeGeneration(f)).statusCode).toBe(200); const other = await createPrismaClient(join(f.path, 'test.db')); try {
        const adapter = createFakeRenderAdapter();
        const result = await runRenderGeneration({ ...f, adapter: { render: async (args) => { const output = await adapter.render(args); await other.project.update({ where: { id: 'p1' }, data: changed === 'narration' ? { activeNarrationRecordId: null, activeNarrationSubtitleRevisionId: null, activeRenderJobRecordId: null } : { activeNarrationSubtitleRevisionId: null, activeRenderJobRecordId: null } }); return output; } } });
        expect(result.statusCode).toBe(409);
        const project = await other.project.findUniqueOrThrow({ where: { id: 'p1' } });
        expect(project.activeRenderJobRecordId).toBeNull();
        const history = await other.renderJobRecord.findMany();
        expect(history).toHaveLength(1);
        expect(history[0]!.executionStateJson).toMatchObject({ activated: false });
        expect(history[0]!.validationResultJson).toMatchObject({decision:'failed'});expect(history[0]!.graphTraceSummaryJson).toMatchObject({status:'stale_source'});
        expect(history[0]!.outputArtifactJson, JSON.stringify({ result, diagnostics: history[0]!.runtimeDiagnosticsJson })).not.toBeNull();
    }
    finally {
        await other.$disconnect();
    } });
it('failed render preserves prior output then retry recovers without source changes', async () => { const f = await fixture(); expect((await runComposeGeneration(f)).statusCode).toBe(200); expect((await runRenderGeneration(f)).statusCode).toBe(200); const previous = f.project.activeRenderJobRecordId; const failed = await runRenderGeneration({ ...f, adapter: { render: async () => { throw new Error('encoder_failed'); } } }); expect(failed.statusCode).toBe(500); expect(f.project.activeRenderJobRecordId).toBe(previous); expect(f.project.status).toBe('render_failed');const failure=[...f.db.renderJobRecords.values()].find(r=>r.status==='failed')!;expect(failure.validationResultJson).toMatchObject({decision:'failed'});expect(failure.graphTraceSummaryJson).toMatchObject({status:'failed'}); expect((await runRenderGeneration(f)).statusCode).toBe(200); expect(f.project.activeRenderJobRecordId).not.toBe(previous); });
