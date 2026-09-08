import { resolveNarrationFilePath } from "../assets/artifact-file-resolver.js";
import { ComposeTimelineV2 } from "../../../../shared/src/compose/compose-timeline.schema.js";
import { NarrationSourceError } from "./narration-invalidation.js";
import { dirname, join, resolve } from 'node:path';
import type { DbClient, ProjectRecord } from '../../db/client.js';
import { captureNarrationDownstreamSource, withNarrationDownstreamSource, activateNarrationDownstream, updateNarrationDownstreamProgress } from './narration-downstream-source.js';
import { NarrationBundleStorage } from './narration-bundle-storage.js';
import { buildComposeTimeline } from '../compose/compose-timeline-builder.js';
import { validateComposeTimeline } from '../compose/compose-local-validator.js';
import { saveComposeRecord } from '../compose/compose-record.repository.js';
import { saveRenderJobRecord } from '../render/render-record.repository.js';
import { validateRenderSources } from '../render/render-source-validator.js';
import { createFakeRenderAdapter } from '../render/fake-render-adapter.js';
import type { RenderAdapter } from '../render/render-adapter.js';
import { resolveStagedArtifactFile, promoteStagedArtifactFile } from '../../runtime/files/artifact-file-commit.js';
const errorCode = (e: unknown) => e instanceof Error ? e.message : 'narration_downstream_failed';
const trace = (phase: string, status: string) => ({ phase, status, steps: [], run_id: crypto.randomUUID() });
async function verifyFiles(project: ProjectRecord, state: Awaited<ReturnType<typeof captureNarrationDownstreamSource>>) { await new NarrationBundleStorage({ projectId: project.id, storageRootDir: project.storageRootDir }).readSubtitleRevision({ record: state.record, revision: state.revision }); const expectedAudio = await resolveNarrationFilePath({ projectStorageRootDir: project.storageRootDir, runId: state.record.generationRunId, fileUri: state.record.output!.audio.uri }); const expectedSubtitle = await resolveNarrationFilePath({ projectStorageRootDir: project.storageRootDir, runId: state.record.generationRunId, fileUri: state.revision.srt.uri }); if (state.manifest.artifacts.find(a => a.artifact_type === 'tts_merged_audio')?.file_uri !== expectedAudio || state.manifest.artifacts.find(a => a.artifact_type === 'subtitle_track')?.file_uri !== expectedSubtitle)
    throw new NarrationSourceError('narration_downstream_file_source_mismatch'); }
export async function runNarrationCompose(input: {
    db: DbClient;
    project: ProjectRecord;
}) {
    const { db, project } = input;
    let saved: Awaited<ReturnType<typeof saveComposeRecord>> | undefined;
    try {
        const state = await captureNarrationDownstreamSource(db, project, 'compose');
        await verifyFiles(project, state);
        await withNarrationDownstreamSource(db, project, 'compose', state.seal, () => undefined);
        const timeline = buildComposeTimeline({ manifest: state.manifest, assetManifestRecordId: state.manifestRecord.id, assetPlanRecordId: state.plan.id, storyboardRecordId: state.identity.activeStoryboardRecordId!, scriptRecordId: state.identity.scriptRecordId, projectStorageRootDir: project.storageRootDir });
        const validation = await validateComposeTimeline({ manifest: state.manifest, timeline, projectStorageRootDir: project.storageRootDir });
        const finalized = { ...timeline, readiness: validation.decision }, graph = trace('compose', validation.decision);
        saved = await saveComposeRecord(db, { projectId: project.id, assetManifestRecordId: state.manifestRecord.id, timelineJson: finalized, validationResultJson: validation, executionStateJson: { activated: false }, graphTraceSummaryJson: graph, runtimeDiagnosticsJson: null });
        await activateNarrationDownstream(db, project, 'compose', state.seal, saved.id, graph, validation.decision === 'blocked' ? 'compose_blocked' : 'compose_ready');
        return { statusCode: 200, body: { project_id: project.id, compose_record_id: saved.id, source_asset_manifest_record_id: state.manifestRecord.id, timeline: finalized, local_validation: validation, execution_state: saved.executionStateJson, graph_trace_summary: graph, runtime_diagnostics: null } };
    }
    catch (e) {
        return { statusCode: 409, body: { error: 'stale_compose_source', reason: errorCode(e), ...(saved ? { compose_record_id: saved.id } : {}) } };
    }
}
export async function runNarrationRender(input: {
    db: DbClient;
    project: ProjectRecord;
    adapter?: RenderAdapter;
}) {
    const { db, project } = input;
    let job: Awaited<ReturnType<typeof saveRenderJobRecord>> | undefined;
    let seal: string | undefined;
    let output: Awaited<ReturnType<RenderAdapter["render"]>>["outputArtifact"] | null = null;
    try {
        const state = await captureNarrationDownstreamSource(db, project, 'render');
        seal = state.seal;
        await verifyFiles(project, state);
        const validation = await validateRenderSources({ activeComposeRecordId: state.compose!.id, composeRecord: state.compose!, assetManifestRecord: state.manifestRecord, projectStorageRootDir: project.storageRootDir });
        if (validation.decision !== 'ready_to_render')
            return { statusCode: 409, body: { error: validation.errors[0] ?? 'render_blocked', local_validation: validation } };
        const timeline = ComposeTimelineV2.parse(state.compose!.timelineJson), profile = timeline.output_profile, graph = trace('render', 'rendering');
        job = await saveRenderJobRecord(db, { projectId: project.id, composeRecordId: state.compose!.id, assetManifestRecordId: state.manifestRecord.id, status: 'rendering', profileJson: profile, outputArtifactJson: null, validationResultJson: validation, executionStateJson: { activated: false }, graphTraceSummaryJson: graph, runtimeDiagnosticsJson: null });
        const staged = resolveStagedArtifactFile({ rootDir: resolve(project.storageRootDir), operationId: job.id, relativeFinalPath: join('renders', job.id, 'output.mp4') });
        await updateNarrationDownstreamProgress(db, project, 'render', state.seal, 'render_rendering');
        const result = await (input.adapter ?? createFakeRenderAdapter()).render({ projectId: project.id, composeRecord: state.compose!, assetManifestRecord: state.manifestRecord, outputDir: dirname(staged.stagingPath), profile, projectStorageRootDir: project.storageRootDir });
        await promoteStagedArtifactFile(staged);
        output = { ...result.outputArtifact, file_uri: join('renders', job.id, 'output.mp4') };
        const rendered = { ...validation, decision: 'rendered' as const, metrics: { ...validation.metrics, ...result.probe } }, finished = trace('render', 'succeeded');
        job = await saveRenderJobRecord(db, { ...job, status: 'completed', outputArtifactJson: output, validationResultJson: rendered, executionStateJson: { activated: false }, graphTraceSummaryJson: finished, runtimeDiagnosticsJson: result.diagnostics });
        await activateNarrationDownstream(db, project, 'render', state.seal, job.id, finished, 'render_ready');
        return { statusCode: 200, body: { project_id: project.id, render_job_record_id: job.id, source_compose_record_id: state.compose!.id, source_asset_manifest_record_id: state.manifestRecord.id, render_job: { status: job.status }, output_artifact: output, local_validation: rendered, execution_state: job.executionStateJson, graph_trace_summary: finished, runtime_diagnostics: result.diagnostics } };
    }
    catch (e) {
        const stale = e instanceof NarrationSourceError;
        if (seal && !stale) {
            try {
                await updateNarrationDownstreamProgress(db, project, 'render', seal, 'render_failed');
            }
            catch { /* 新来源保持原状态。 */ }
        }
        if (job)
            job = await saveRenderJobRecord(db, { ...job, status: stale ? 'stale_source' : 'failed', outputArtifactJson: output, validationResultJson:{stage:'render_local_validation',decision:'failed',errors:[stale?'render_stale_source':'render_export_failed'],warnings:[],metrics:job.validationResultJson.metrics},graphTraceSummaryJson:trace('render',stale?'stale_source':'failed'), executionStateJson: { activated: false, stale_source: stale }, runtimeDiagnosticsJson: { error_message: errorCode(e) } });
        return { statusCode: stale || !job ? 409 : 500, body: { error: stale ? 'stale_render_source' : 'render_failed', reason: errorCode(e), ...(job ? { render_job_record_id: job.id, render_job: { status: job.status } } : {}) } };
    }
}
