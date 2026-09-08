import { canonicalStringify, StoryboardPlanV2, AssetManifestV2, AssetPlanV2, NarrationRecord, NarrationSubtitleRevision } from '../../../../shared/src/index.js';
import { ComposeTimelineV2 } from '../../../../shared/src/compose/compose-timeline.schema.js';
import { NarrationSourceError, withStoryboardNarrationSource, type StoryboardNarrationSource } from './narration-invalidation.js';
import { decodeNarrationRow, decodeSubtitle } from './narration.repository.js';
import { mapSubtitleTarget, readSubtitleTarget } from './narration-subtitle-target.js';
import { resolveNarrationSubtitleReadiness } from './narration-subtitle-settings.js';
import type { DbClient, ProjectRecord, AssetPlanRecord, AssetManifestRecord, ComposeRecord } from '../../db/client.js';
import type { AppPrismaTransactionClient } from '../../db/prisma-client.types.js';
import { Prisma } from '../../generated/prisma/client.js';
interface DownstreamState {
    source: Awaited<ReturnType<typeof import('./narration.repository.js').readNarrationSource>>;
    identity: StoryboardNarrationSource;
    plan: AssetPlanRecord;
    manifestRecord: AssetManifestRecord;
    manifest: AssetManifestV2;
    record: NarrationRecord;
    revision: NarrationSubtitleRevision;
    compose: ComposeRecord | null;
    seal: string;
}
export async function withNarrationDownstreamSource<T>(db: DbClient, project: ProjectRecord, stage: 'compose' | 'render', expected: string | undefined, action: (state: DownstreamState, tx?: AppPrismaTransactionClient) => T | Promise<T>): Promise<T> {
    return withStoryboardNarrationSource(db, project.id, project.ownerId, undefined, async ({ source, identity, storyboard }, tx) => {
        if (!identity)
            throw new NarrationSourceError('narration_stale');
        const p = source.project;
        const plan = tx ? await tx.assetPlanRecord.findUnique({ where: { id: p.activeAssetPlanRecordId ?? '' } }) : db.assetPlanRecords.get(p.activeAssetPlanRecordId ?? '');
        const manifestRecord = tx ? await tx.assetManifestRecord.findUnique({ where: { id: p.activeAssetManifestRecordId ?? '' } }) : db.assetManifestRecords.get(p.activeAssetManifestRecordId ?? '');
        const row = tx ? await tx.narrationRecord.findUnique({ where: { id: identity.narrationRecordId } }) : null;
        const record = tx ? row ? decodeNarrationRow(row) : null : NarrationRecord.parse(db.narrationRecords.get(identity.narrationRecordId));
        const sub = tx ? await tx.narrationSubtitleRevision.findUnique({ where: { id: p.activeNarrationSubtitleRevisionId ?? '' } }) : null;
        const rawRevision = p.activeNarrationSubtitleRevisionId ? db.narrationSubtitleRevisions.get(p.activeNarrationSubtitleRevisionId) : null;
        const revision = tx ? sub ? decodeSubtitle(sub) : null : rawRevision ? NarrationSubtitleRevision.parse(rawRevision) : null;
        const target = tx ? await readSubtitleTarget(db, record!.generationRunId, tx) : mapSubtitleTarget(db, record!.generationRunId);
        if (!resolveNarrationSubtitleReadiness({ mode: p.narrationTimingMode ?? "legacy_estimated", configuration: source.configuration?.configurationJson, record, revision, target }).ready)
            throw new NarrationSourceError('narration_subtitle_update_required');
        if (!plan || !manifestRecord || !storyboard || plan.projectId !== p.id || manifestRecord.projectId !== p.id || plan.storyboardRecordId !== storyboard.id || plan.scriptRecordId !== identity.scriptRecordId || manifestRecord.assetPlanRecordId !== plan.id || manifestRecord.storyboardRecordId !== storyboard.id || manifestRecord.scriptRecordId !== identity.scriptRecordId)
            throw new NarrationSourceError('narration_downstream_source_invalid');
        const manifest = AssetManifestV2.parse(manifestRecord.manifestJson), ap = AssetPlanV2.parse(plan.planJson), sb = StoryboardPlanV2.parse(storyboard.planJson);
        if (ap.source_storyboard_record_id !== storyboard.id || ap.source_script_record_id !== identity.scriptRecordId || canonicalStringify(sb.narration_reference) !== canonicalStringify(manifest.narration_reference) || sb.segments.length !== manifest.segment_routes.length || sb.segments.some((s, i) => { const r = manifest.segment_routes[i]!; return s.segment_id !== r.segment_id || s.visual_start_ms !== r.narrationRange.startMs || s.visual_end_ms !== r.narrationRange.endMs; }))
            throw new NarrationSourceError("narration_downstream_storyboard_mismatch");
        if (manifest.source_asset_plan_id !== plan.id || manifest.source_storyboard_record_id !== storyboard.id || manifest.source_script_record_id !== identity.scriptRecordId || manifest.narration_reference.narration_record_id !== identity.narrationRecordId || manifest.narration_reference.audio_hash !== identity.audioHash || manifest.narration_reference.timing_map_hash !== identity.timingHash || manifest.subtitle_revision_id !== revision!.id || manifest.subtitle_settings_hash !== revision!.subtitleSettingsHash || canonicalStringify(ap.narration_reference) !== canonicalStringify(manifest.narration_reference))
            throw new NarrationSourceError('narration_downstream_source_invalid');
        if (manifest.segment_routes.length !== ap.narration_intervals.length || manifest.segment_routes.some((r, i) => { const a = ap.narration_intervals[i]; return !a || r.segment_id !== a.segment_id || r.narrationRange.startMs !== a.range.visual_start_ms || r.narrationRange.endMs !== a.range.visual_end_ms; }))
            throw new NarrationSourceError('narration_downstream_intervals_invalid');
        const subtitleArtifact = manifest.artifacts.find(a => a.artifact_type === 'subtitle_track')!;
        if (canonicalStringify(subtitleArtifact.metadata.subtitle_style) !== canonicalStringify(revision!.subtitleSettingsSnapshotJson.resolvedStyle))
            throw new NarrationSourceError('narration_subtitle_style_mismatch');
        const compose = stage === 'render' ? (tx ? await tx.composeRecord.findUnique({ where: { id: p.activeComposeRecordId ?? '' } }) : db.composeRecords.get(p.activeComposeRecordId ?? '')) : null;
        if (stage === 'render') {
            if (!compose || compose.projectId !== p.id || compose.assetManifestRecordId !== manifestRecord.id)
                throw new NarrationSourceError('active_compose_missing');
            const t = ComposeTimelineV2.parse(compose.timelineJson);
            if (t.source_asset_manifest_record_id !== manifestRecord.id || t.source_asset_plan_record_id !== plan.id || t.source_storyboard_record_id !== storyboard.id || t.source_script_record_id !== identity.scriptRecordId || canonicalStringify(t.narration_reference) !== canonicalStringify(manifest.narration_reference) || t.subtitle_revision_id !== revision!.id || t.subtitle_settings_hash !== revision!.subtitleSettingsHash)
                throw new NarrationSourceError('narration_downstream_source_invalid');
        }
        const seal = canonicalStringify({ identity, plan, manifestRecord, revision, target, compose });
        if (expected !== undefined && seal !== expected)
            throw new NarrationSourceError('narration_downstream_source_changed');
        return action({ source, identity, plan: plan as AssetPlanRecord, manifestRecord: manifestRecord as AssetManifestRecord, manifest, record: record!, revision: revision!, compose: compose as ComposeRecord | null, seal }, tx);
    });
}
export function captureNarrationDownstreamSource(db: DbClient, project: ProjectRecord, stage: 'compose' | 'render') {
    return withNarrationDownstreamSource(db, project, stage, undefined, state => structuredClone(state));
}
export async function activateNarrationDownstream(db: DbClient, project: ProjectRecord, stage: 'compose' | 'render', seal: string, id: string, trace: unknown, status: string) {
    const patch = { ...(stage === 'compose' ? { activeComposeRecordId: id, activeRenderJobRecordId: null, latestComposeRunTraceJson: trace, latestRenderRunTraceJson: null } : { activeRenderJobRecordId: id, latestRenderRunTraceJson: trace }), activePublishPackageRecordId: null, status, updatedAt: new Date() };
    await withNarrationDownstreamSource(db, project, stage, seal, async ({ source }, tx) => {
        if (tx) {
            if (stage === 'compose')
                await tx.composeRecord.update({ where: { id }, data: { executionStateJson: { activated: true } } });
            else
                await tx.renderJobRecord.update({ where: { id }, data: { executionStateJson: { activated: true } } });
            await tx.project.update({ where: { id: project.id }, data: { activePublishPackageRecordId: null, status, updatedAt: patch.updatedAt, ...(stage === 'compose' ? { activeComposeRecordId: id, activeRenderJobRecordId: null } : { activeRenderJobRecordId: id }), ...(stage === 'compose' ? { latestComposeRunTraceJson: trace as Prisma.InputJsonValue, latestRenderRunTraceJson: Prisma.DbNull } : { latestRenderRunTraceJson: trace as Prisma.InputJsonValue }) } });
        }
        else {
            const record = stage === 'compose' ? db.composeRecords.get(id) : db.renderJobRecords.get(id);
            if (!record)
                throw new NarrationSourceError('narration_output_missing');
            record.executionStateJson = { activated: true };
            Object.assign(source.project, patch);
        }
    });
    Object.assign(project, patch);
    const mirror = db.projects.get(project.id);
    if (mirror)
        Object.assign(mirror, patch);
    const output = stage === 'compose' ? db.composeRecords.get(id) : db.renderJobRecords.get(id);
    if (output)
        output.executionStateJson = { activated: true };
}
export async function updateNarrationDownstreamProgress(db: DbClient, project: ProjectRecord, stage: 'compose' | 'render', seal: string, status: string) {
    await withNarrationDownstreamSource(db, project, stage, seal, async ({ source }, tx) => {
        if (tx)
            await tx.project.update({ where: { id: project.id }, data: { status, updatedAt: new Date() } });
        else
            Object.assign(source.project, { status, updatedAt: new Date() });
    });
    project.status = status;
    const mirror = db.projects.get(project.id);
    if (mirror)
        mirror.status = status;
}
