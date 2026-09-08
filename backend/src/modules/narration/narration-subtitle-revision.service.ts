import { mapSubtitleTarget, readSubtitleTarget, mapSubtitleTargetHistory, readSubtitleTargetHistory, appendSubtitleTarget, subtitleConfigurationHash, assertSubtitleTargetVersion, type NarrationSubtitleTarget } from "./narration-subtitle-target.js";
import { canonicalStringify, DeriveNarrationSubtitlesRequest, NarrationRecord, NarrationSubtitleRevision, AssetManifestV2 } from "../../../../shared/src/index.js";
import type { AppInstance } from "../../app.js";
import type { DbClient } from "../../db/client.js";
import type { AppPrismaTransactionClient } from "../../db/prisma-client.types.js";
import { Prisma } from "../../generated/prisma/client.js";
import { readNarrationSource, readMapNarrationSource, decodeNarrationRow, decodeSubtitle } from "./narration.repository.js";
import { narrationTextHash } from "./narration-readiness.js";
import { narrationStorage } from "./narration-run.service.js";
import { resolveNarrationSubtitleSettings, narrationSubtitleSettingsHash, resolveNarrationSubtitleReadiness } from "./narration-subtitle-settings.js";
import { NARRATION_SUBTITLE_BUILDER_VERSION } from "./narration-subtitle-builder.js";
import { resolveNarrationFilePath } from "../assets/artifact-file-resolver.js";
import { resolveProjectStorageRoot } from "../../db/repositories/prisma-first-aggregate-hydrator.js";
type Source = Awaited<ReturnType<typeof readNarrationSource>>;
function persistence(db: DbClient) {
    const client = db.narrationPersistence.prismaClient ?? db.firstAggregateWriter?.narrationPrismaClient;
    if (!client && (db.firstAggregateWriter || db.secondAggregateWriter || db.thirdAggregateWriter))
        throw new Error("narration_persistence_client_missing");
    return client;
}
function mapContext(db: DbClient, projectId: string, ownerId: string) {
    const source = readMapNarrationSource(db, projectId, ownerId);
    const record = source.project.activeNarrationRecordId ? NarrationRecord.parse(db.narrationRecords.get(source.project.activeNarrationRecordId)) : null;
    const revisions = [...db.narrationSubtitleRevisions.values()].filter(r => r.projectId === projectId && r.narrationRecordId === record?.id).map(r => NarrationSubtitleRevision.parse(r));
    const manifest = source.project.activeAssetManifestRecordId ? db.assetManifestRecords.get(source.project.activeAssetManifestRecordId) ?? null : null;
    const settings = resolveNarrationSubtitleSettings(source.configuration?.configurationJson);
    return { source, record, revisions, manifest, settings, settingsHash: narrationSubtitleSettingsHash(settings), target: record ? mapSubtitleTarget(db, record.generationRunId) : null, targets: record ? mapSubtitleTargetHistory(db, record.generationRunId) : [] };
}
async function context(db: DbClient, projectId: string, ownerId: string, tx?: AppPrismaTransactionClient) {
    if (!tx)
        return mapContext(db, projectId, ownerId);
    const source = await readNarrationSource(db, projectId, ownerId, tx);
    const rows = await tx.narrationSubtitleRevision.findMany({ where: { projectId, narrationRecordId: source.project.activeNarrationRecordId ?? "" } });
    const narrationRow = source.project.activeNarrationRecordId ? await tx.narrationRecord.findUnique({ where: { id: source.project.activeNarrationRecordId } }) : null;
    const manifest = source.project.activeAssetManifestRecordId ? await tx.assetManifestRecord.findUnique({ where: { id: source.project.activeAssetManifestRecordId } }) : null;
    const record = narrationRow ? decodeNarrationRow(narrationRow) : null, revisions = rows.map(decodeSubtitle);
    const settings = resolveNarrationSubtitleSettings(source.configuration?.configurationJson);
    return { source, record, revisions, manifest, settings, settingsHash: narrationSubtitleSettingsHash(settings), target: record ? await readSubtitleTarget(db, record.generationRunId, tx) : null, targets: record ? await readSubtitleTargetHistory(db, record.generationRunId, tx) : [] };
}
type Context = Awaited<ReturnType<typeof context>>;
function seal(c: Context, includeReferences = true) {
    return canonicalStringify({ owner: c.source.project.ownerId, mode: c.source.project.narrationTimingMode,
        script: c.source.script, activeScript: c.source.project.activeScriptRecordId, record: c.record, settings: c.settings,
        activeSubtitle: includeReferences ? c.source.project.activeNarrationSubtitleRevisionId : null, activeManifest: includeReferences ? c.source.project.activeAssetManifestRecordId : null,
        storyboard: c.source.project.activeStoryboardRecordId, assetPlan: c.source.project.activeAssetPlanRecordId, manifest: includeReferences ? c.manifest : null });
}
function assertActive(c: Context) {
    if (c.source.project.narrationTimingMode !== "narration_first_v1")
        throw new Error("narration_mode_unavailable");
    if (!c.record?.output || c.record.status !== "confirmed" || c.record.projectId !== c.source.project.id || c.record.scriptRecordId !== c.source.project.activeScriptRecordId || c.source.script?.id !== c.record.scriptRecordId || narrationTextHash(c.source.script.scriptText) !== c.record.sourceTextSha256)
        throw new Error("narration_stale");
}
function matching(c: Context) {
    return c.revisions.find(r => r.narrationRecordId === c.record?.id && r.subtitleSettingsHash === c.settingsHash && r.builderVersion === NARRATION_SUBTITLE_BUILDER_VERSION);
}
function rootFor(app: Pick<AppInstance, "storageBaseDir">, project: Source["project"]) {
    return "storageRootDir" in project ? project.storageRootDir : resolveProjectStorageRoot({ storageRoot: app.storageBaseDir, createdAt: project.createdAt, displayName: project.storageDisplayName, shortId: "p_" + project.id.replace(/[^a-zA-Z0-9]/g, "").toLowerCase().slice(0, 8).padEnd(8, "0"), storageKey: project.storageKey });
}
/** 只派生本地字幕；文件提交后才以数据库事务切换引用。 */
export async function deriveNarrationSubtitleRevision(app: Pick<AppInstance, "db" | "storageBaseDir">, projectId: string, ownerId: string, request?: DeriveNarrationSubtitlesRequest, recordId?: string) {
    const client = persistence(app.db);
    let initial = structuredClone(client ? await client.$transaction(tx => context(app.db, projectId, ownerId, tx)) : mapContext(app.db, projectId, ownerId));
    assertActive(initial);
    if (initial.source.project.activeAssetManifestRecordId && !initial.manifest)
        throw new Error("narration_subtitle_manifest_stale");
    if (request && (request.expected_narration_record_id !== initial.record!.id || recordId !== initial.record!.id || request.expected_audio_hash !== initial.record!.output!.audio.sha256 || request.subtitle_settings_hash !== initial.settingsHash))
        throw new Error("narration_subtitle_context_changed");
    const reserve = async (tx?: AppPrismaTransactionClient) => {
        const current = tx ? await context(app.db, projectId, ownerId, tx) : mapContext(app.db, projectId, ownerId);
        if (seal(current) !== seal(initial))
            throw new Error('narration_subtitle_context_changed');
        const target: NarrationSubtitleTarget = { schemaVersion: 'narration_subtitle_target_v1', targetId: app.db.generateId(), narrationRecordId: current.record!.id, settingsSnapshot: current.settings, settingsHash: current.settingsHash, configurationHash: subtitleConfigurationHash(current.source.configuration?.configurationJson), builderVersion: NARRATION_SUBTITLE_BUILDER_VERSION, state: 'pending', revisionId: null, manifestId: null };
        for (const previous of current.targets)
            assertSubtitleTargetVersion(previous, target);
        const reserved = current.target?.state === 'pending' && current.target.settingsHash === target.settingsHash && current.target.configurationHash === target.configurationHash ? current.target : await appendSubtitleTarget(app.db, current.record!.generationRunId, target, tx);
        return structuredClone({ ...current, target: reserved });
    };
    initial = client ? await client.$transaction(tx => reserve(tx)) : await reserve();
    try {
        const frozen = seal(initial), store = narrationStorage(app, initial.source.project), existing = matching(initial);
        const built = existing ? await store.readSubtitleRevision({ record: initial.record, revision: existing }) : await store.commitSubtitleRevision({ record: initial.record, revisionId: app.db.generateId(), settingsSnapshot: initial.settings, createdAt: new Date().toISOString() });
        const revision = built.revision;
        let nextManifest: AssetManifestV2 | null = null;
        if (initial.manifest) {
            const old = AssetManifestV2.parse(initial.manifest.manifestJson), record = initial.record!;
            if (initial.manifest.projectId !== projectId || initial.manifest.assetPlanRecordId !== initial.source.project.activeAssetPlanRecordId || initial.manifest.storyboardRecordId !== initial.source.project.activeStoryboardRecordId || old.source_asset_plan_id !== initial.manifest.assetPlanRecordId || old.source_script_record_id !== record.scriptRecordId || old.narration_reference.narration_record_id !== record.id || old.narration_reference.audio_hash !== revision.audioHash || old.narration_reference.timing_map_hash !== revision.timingHash)
                throw new Error("narration_subtitle_manifest_stale");
            const oldId = old.audio_summary.subtitle_artifact_id, sub = old.artifacts.find(a => a.artifact_id === oldId);
            if (!sub)
                throw new Error("narration_subtitle_manifest_stale");
            const newId = "narration_subtitle_" + revision.id;
            const path = await resolveNarrationFilePath({ projectStorageRootDir: rootFor(app, initial.source.project), runId: record.generationRunId, fileUri: revision.srt.uri });
            nextManifest = AssetManifestV2.parse({ ...old, subtitle_revision_id: revision.id, subtitle_settings_hash: revision.subtitleSettingsHash,
                execution_options: { ...old.execution_options, subtitle_style: revision.subtitleSettingsSnapshotJson.resolvedStyle },
                artifacts: old.artifacts.map(a => a.artifact_id === oldId ? { ...a, artifact_id: newId, file_uri: path, created_at: revision.createdAt, metadata: { ...a.metadata, subtitle_revision_id: revision.id, subtitle_settings_hash: revision.subtitleSettingsHash, subtitle_style: revision.subtitleSettingsSnapshotJson.resolvedStyle, caption_count: built.timeline.cues.length } } : a),
                audio_summary: { ...old.audio_summary, subtitle_artifact_id: newId }, segment_routes: old.segment_routes.map(r => ({ ...r, subtitle_artifact_id: newId })) });
        }
        const activate = async (tx?: AppPrismaTransactionClient) => {
            const current = tx ? await context(app.db, projectId, ownerId, tx) : mapContext(app.db, projectId, ownerId);
            assertActive(current);
            const winner = matching(current);
            if (current.target?.targetId === initial.target!.targetId && current.target.state === "ready" && winner && current.target.revisionId === winner.id && current.source.project.activeNarrationSubtitleRevisionId === winner.id && current.target.manifestId === current.source.project.activeAssetManifestRecordId && seal(current, false) === seal(initial, false))
                return winner;
            if (current.target?.targetId !== initial.target!.targetId || current.target.settingsHash !== initial.settingsHash || seal(current) !== frozen)
                throw new Error("narration_subtitle_context_changed");
            if (current.source.project.activeNarrationSubtitleRevisionId === revision.id && (!nextManifest || AssetManifestV2.parse(current.manifest!.manifestJson).subtitle_revision_id === revision.id)) {
                await appendSubtitleTarget(app.db, initial.record!.generationRunId, { ...initial.target!, state: "ready", revisionId: revision.id, manifestId: current.source.project.activeAssetManifestRecordId }, tx);
                return revision;
            }
            const found = matching(current);
            if (found && canonicalStringify(found) !== canonicalStringify(revision))
                throw new Error("narration_subtitle_context_changed");
            const now = new Date(), manifestId = nextManifest ? app.db.generateId() : null;
            const patch = { activeNarrationSubtitleRevisionId: revision.id, ...(manifestId ? { activeAssetManifestRecordId: manifestId } : {}), activeComposeRecordId: null, activeRenderJobRecordId: null, activePublishPackageRecordId: null, latestComposeRunTraceJson: null, latestRenderRunTraceJson: null, updatedAt: now };
            if (tx) {
                if (!found) {
                    const { srt, vtt, createdAt, ...data } = revision;
                    await tx.narrationSubtitleRevision.create({ data: { ...data, subtitleSettingsSnapshotJson: revision.subtitleSettingsSnapshotJson as Prisma.InputJsonValue, srtJson: srt, vttJson: vtt, createdAt: new Date(createdAt) } });
                }
                if (nextManifest && initial.manifest && manifestId) {
                    const m = initial.manifest;
                    await tx.assetManifestRecord.create({ data: { id: manifestId, projectId, topicPackageId: m.topicPackageId, scriptRecordId: m.scriptRecordId, storyboardRecordId: m.storyboardRecordId, assetPlanRecordId: m.assetPlanRecordId, revision: 1, manifestJson: nextManifest as Prisma.InputJsonValue, validationResultJson: m.validationResultJson as Prisma.InputJsonValue, executionStateJson: m.executionStateJson === null ? Prisma.DbNull : m.executionStateJson as Prisma.InputJsonValue, graphTraceSummaryJson: m.graphTraceSummaryJson === null ? Prisma.DbNull : m.graphTraceSummaryJson as Prisma.InputJsonValue, runtimeDiagnosticsJson: m.runtimeDiagnosticsJson === null ? Prisma.DbNull : m.runtimeDiagnosticsJson as Prisma.InputJsonValue, createdAt: now } });
                }
                await tx.project.update({ where: { id: projectId }, data: { ...patch, latestComposeRunTraceJson: Prisma.DbNull, latestRenderRunTraceJson: Prisma.DbNull } });
            }
            else {
                // 最后读取完成后无 await；所有运行时解析都已在写入前完成。
                if (!found)
                    app.db.narrationSubtitleRevisions.set(revision.id, structuredClone(revision));
                if (nextManifest && initial.manifest && manifestId)
                    app.db.assetManifestRecords.set(manifestId, { ...initial.manifest, id: manifestId, revision: 1, manifestJson: nextManifest, createdAt: now } as import("../../db/client.js").AssetManifestRecord);
                Object.assign(current.source.project, patch);
            }
            await appendSubtitleTarget(app.db, initial.record!.generationRunId, { ...initial.target!, state: "ready", revisionId: revision.id, manifestId: manifestId ?? current.source.project.activeAssetManifestRecordId }, tx);
            return revision;
        };
        const result = await (client ? client.$transaction(tx => activate(tx)) : activate());
        if (client) {
            const committed = await client.$transaction(tx => context(app.db, projectId, ownerId, tx));
            publishSubtitleContext(app.db, committed);
        }
        return result;
    }
    catch (error) {
        const failed = async (tx?: AppPrismaTransactionClient) => {
            await readNarrationSource(app.db, projectId, ownerId, tx);
            const latest = tx ? await readSubtitleTarget(app.db, initial.record!.generationRunId, tx) : mapSubtitleTarget(app.db, initial.record!.generationRunId);
            if (latest?.targetId === initial.target!.targetId && latest.state !== "ready")
                await appendSubtitleTarget(app.db, initial.record!.generationRunId, { ...latest, state: "failed" }, tx);
        };
        try {
            if (client)
                await client.$transaction(tx => failed(tx));
            else
                await failed();
        }
        catch { /* 已提交pending保持阻塞；不覆盖原错误。 */ }
        throw error;
    }
}
export async function refreshSavedNarrationSubtitles(app: Pick<AppInstance, "db" | "storageBaseDir">, projectId: string, ownerId: string, onlyIfStale = false) {
    const source = await readNarrationSource(app.db, projectId, ownerId, persistence(app.db));
    if (source.project.narrationTimingMode !== "narration_first_v1" || !source.project.activeNarrationRecordId)
        return;
    if (onlyIfStale && await currentNarrationSubtitleError(app.db, projectId, ownerId) === null)
        return;
    return deriveNarrationSubtitleRevision(app, projectId, ownerId);
}
function publishSubtitleContext(db: DbClient, c: Context, provided?: import('../../db/client.js').ProjectRecord) {
    const keys = ['narrationTimingMode', 'activeNarrationRecordId', 'activeNarrationSubtitleRevisionId', 'activeStoryboardRecordId', 'activeAssetPlanRecordId', 'activeAssetManifestRecordId', 'activeComposeRecordId', 'activeRenderJobRecordId', 'activePublishPackageRecordId', 'latestComposeRunTraceJson', 'latestRenderRunTraceJson', 'status', 'updatedAt'] as const;
    const patch = Object.fromEntries(keys.map(key => [key, c.source.project[key] ?? null]));
    for (const project of [provided, db.projects.get(c.source.project.id)])
        if (project && project.id === c.source.project.id && project.ownerId === c.source.project.ownerId)
            Object.assign(project, patch);
    if (c.record)
        db.narrationRecords.set(c.record.id, structuredClone(c.record));
    for (const revision of c.revisions)
        db.narrationSubtitleRevisions.set(revision.id, structuredClone(revision));
    if (c.manifest)
        db.assetManifestRecords.set(c.manifest.id, structuredClone(c.manifest) as import('../../db/client.js').AssetManifestRecord);
}
export async function currentNarrationSubtitleError(db: DbClient, projectId: string, ownerId: string, provided?: import('../../db/client.js').ProjectRecord): Promise<string | null> {
    const client = persistence(db);
    const project = client ? await client.project.findFirst({ where: { id: projectId, ownerId, archivedAt: null } }) : db.projects.get(projectId);
    if (!project || project.ownerId !== ownerId)
        return 'project_scope_denied';
    if (project.narrationTimingMode !== 'narration_first_v1')
        return null;
    try {
        const c = client ? await client.$transaction(tx => context(db, projectId, ownerId, tx)) : mapContext(db, projectId, ownerId);
        if (client)
            publishSubtitleContext(db, c, provided);
        const revision = c.revisions.find(r => r.id === c.source.project.activeNarrationSubtitleRevisionId) ?? null;
        return resolveNarrationSubtitleReadiness({ mode: c.source.project.narrationTimingMode ?? 'legacy_estimated', configuration: c.source.configuration?.configurationJson, record: c.record, revision, target: c.target }).reason;
    }
    catch {
        return 'narration_subtitle_update_required';
    }
}
