import { requireOwner } from "../../auth/authorization.js";
import type { DbClient, ProjectRecord } from "../../db/client.js";
import { Prisma } from "../../generated/prisma/client.js";
import { DEFAULT_GENERATION_CONFIGURATION, GenerationConfigurationV1, UpgradeNarrationModeRequest } from "../../../../shared/src/index.js";
import { NarrationModeUpgradePreviewV1, type NarrationModeUpgradePreviewV1 as Preview } from "../../../../shared/src/narration/narration-ui.schema.js";
import { findProjectConfigRecord } from "../generation-config/generation-config.repository.js";
import { narrationDownstreamReset, narrationDownstreamResetData } from "./narration-invalidation.js";
import { availableNarrationOptionsForOwner, materializeNarrationConfiguration } from "./narration-model-policy.js";

export class NarrationUpgradeError extends Error {
    constructor(readonly statusCode: number, readonly body: { error: string } & Record<string, unknown>) {
        super(body.error);
    }
}

type ServiceUser = { userId: string; role: string };
type OwnerCheckedUser = Parameters<typeof requireOwner>[0];

async function readProject(db: DbClient, projectId: string): Promise<ProjectRecord | null> {
    if (db.narrationPersistence.prismaClient) {
        const row = await db.narrationPersistence.prismaClient.project.findUnique({ where: { id: projectId } });
        if (!row) return null;
        return { ...(db.projects.get(projectId) ?? ({} as ProjectRecord)), id: row.id, ownerId: row.ownerId, narrationTimingMode: (row.narrationTimingMode ?? "legacy_estimated") as ProjectRecord["narrationTimingMode"], activeScriptRecordId: row.activeScriptRecordId, activeNarrationRecordId: row.activeNarrationRecordId ?? null, activeNarrationSubtitleRevisionId: row.activeNarrationSubtitleRevisionId ?? null, activeStoryboardRecordId: row.activeStoryboardRecordId ?? null, activeAssetPlanRecordId: row.activeAssetPlanRecordId ?? null, activeAssetManifestRecordId: row.activeAssetManifestRecordId ?? null, activeComposeRecordId: row.activeComposeRecordId ?? null, activeRenderJobRecordId: row.activeRenderJobRecordId ?? null, activePublishPackageRecordId: row.activePublishPackageRecordId ?? null };
    }
    return db.projects.get(projectId) ?? null;
}

async function readProjectConfig(db: DbClient, projectId: string) {
    if (db.narrationPersistence.prismaClient) {
        const row = await db.narrationPersistence.prismaClient.projectGenerationConfiguration.findUnique({ where: { projectId } });
        if (row) return { revision: row.revision, configurationJson: row.configurationJson as GenerationConfigurationV1 };
    }
    const record = findProjectConfigRecord(db, projectId);
    return record ? { revision: record.revision, configurationJson: record.configurationJson } : null;
}

function downgradePointers(project: ProjectRecord) {
    return {
        storyboard_record_id: project.activeStoryboardRecordId ?? null,
        asset_plan_record_id: project.activeAssetPlanRecordId ?? null,
        asset_manifest_record_id: project.activeAssetManifestRecordId ?? null,
        compose_record_id: project.activeComposeRecordId ?? null,
        render_job_record_id: project.activeRenderJobRecordId ?? null,
        publish_package_record_id: project.activePublishPackageRecordId ?? null,
    };
}

const downstreamStages = [
    { stage: "storyboard", key: "activeStoryboardRecordId" },
    { stage: "asset_plan", key: "activeAssetPlanRecordId" },
    { stage: "assets", key: "activeAssetManifestRecordId" },
    { stage: "compose", key: "activeComposeRecordId" },
    { stage: "render", key: "activeRenderJobRecordId" },
    { stage: "publish", key: "activePublishPackageRecordId" },
] as const;

async function loadLegacyProject(db: DbClient, projectId: string, user: ServiceUser): Promise<ProjectRecord> {
    const project = await readProject(db, projectId);
    if (!project) throw new NarrationUpgradeError(404, { error: "project_not_found" });
    requireOwner(user as OwnerCheckedUser, project.ownerId);
    if ((project.narrationTimingMode ?? "legacy_estimated") !== "legacy_estimated") {
        throw new NarrationUpgradeError(409, { error: "narration_upgrade_not_legacy" });
    }
    return project;
}

/** 升级预览：只读；展示将失效的下游产物、当前配置与合格组合，不修改任何状态。缺冻结配置的老项目按默认配置 revision 0 展示，不回填。 */
export async function previewNarrationModeUpgrade(db: DbClient, input: { projectId: string; user: ServiceUser; narrationFirstEnabled: boolean }): Promise<Preview> {
    const project = await loadLegacyProject(db, input.projectId, input.user);
    const stored = await readProjectConfig(db, input.projectId);
    const config = stored?.configurationJson ?? DEFAULT_GENERATION_CONFIGURATION;
    const available = await availableNarrationOptionsForOwner(db, project.ownerId);
    const recommendedOption = available.qualified_options.find(o => o.provider_model_id === available.default_provider_model_id) ?? available.qualified_options[0] ?? null;
    const tts = config.capabilities["tts.synthesize"];
    const scriptRecord = project.activeScriptRecordId ? db.scriptRecords.get(project.activeScriptRecordId) : null;
    return NarrationModeUpgradePreviewV1.parse({
        narration_timing_mode: "legacy_estimated",
        upgrade_available: input.narrationFirstEnabled,
        policy_version: available.policy_version,
        recommended: recommendedOption ? { provider_model_id: recommendedOption.provider_model_id, voice_profile_id: recommendedOption.voice_profile_id } : null,
        options: available.qualified_options,
        current_configuration: {
            revision: stored?.revision ?? 0,
            tts_mode: tts.mode,
            provider_model_id: tts.mode === "fixed" ? tts.provider_model_id : null,
            voice_profile_id: config.creative.voice_profile_id ?? null,
        },
        script: {
            active_script_record_id: project.activeScriptRecordId ?? null,
            estimated_duration_sec: scriptRecord?.estimatedDurationSec ?? null,
        },
        affected: downstreamStages.filter(s => project[s.key]).map(s => ({ stage: s.stage, record_id: project[s.key] as string })),
    });
}

/** 来源/下游预期比较；升级写前快照比较与 Map 写前同步复查共用。 */
function collectUpgradeConflicts(project: Pick<ProjectRecord, "activeScriptRecordId" | "activeStoryboardRecordId" | "activeAssetPlanRecordId" | "activeAssetManifestRecordId" | "activeComposeRecordId" | "activeRenderJobRecordId" | "activePublishPackageRecordId">, request: UpgradeNarrationModeRequest): string[] {
    const conflicts: string[] = [];
    if (project.activeScriptRecordId !== request.expected_active_script_record_id) conflicts.push("active_script_record_id");
    const actualDownstream = downgradePointers(project as ProjectRecord);
    for (const [key, actual] of Object.entries(actualDownstream)) {
        if (actual !== request.expected_downstream[key as keyof typeof request.expected_downstream]) conflicts.push(key);
    }
    return conflicts;
}

/** 旧项目显式升级：模式、固定配置、策略依据、下游失效与升级事件在同一事务；任何预期不匹配整笔不写。
 *  预览把缺冻结配置的老项目展示为 revision 0；该分支下所有拒绝判定先于任何写入，配置行在事务内以"缺失"为预期创建（并发创建唯一冲突整笔回滚）。 */
export async function upgradeProjectToNarrationFirst(db: DbClient, input: { projectId: string; user: ServiceUser; narrationFirstEnabled: boolean; actorUserId?: string | null; request: unknown }): Promise<{ upgraded: true; configuration_revision: number }> {
    if (!input.narrationFirstEnabled) throw new NarrationUpgradeError(409, { error: "narration_mode_unavailable", reason: "口播前置模式尚未开放，不能升级" });
    const project = await loadLegacyProject(db, input.projectId, input.user);
    // 鉴权与来源核对先于请求体解析：跨 owner/来源冲突不应被 422 掩盖。
    const request = UpgradeNarrationModeRequest.parse(input.request);
    const stored = await readProjectConfig(db, input.projectId);
    const expectMissing = request.expected_configuration_revision === 0;
    if (expectMissing && stored) throw new NarrationUpgradeError(409, { error: "project_generation_configuration_revision_conflict", current_revision: stored.revision });
    if (!expectMissing) {
        if (!stored) throw new NarrationUpgradeError(409, { error: "project_generation_configuration_revision_conflict", current_revision: null });
        if (stored.revision !== request.expected_configuration_revision) {
            throw new NarrationUpgradeError(409, { error: "project_generation_configuration_revision_conflict", current_revision: stored.revision });
        }
    }
    const conflicts = collectUpgradeConflicts(project, request);
    if (conflicts.length > 0) throw new NarrationUpgradeError(409, { error: "narration_upgrade_conflict", conflicts });
    // 所有确定性拒绝（来源/下游/revision/策略）都先于任何写入；rev-0 分支以默认配置为物化基底。
    const materialized = await materializeNarrationConfiguration(db, project.ownerId, stored?.configurationJson ?? DEFAULT_GENERATION_CONFIGURATION, request.narration_selection);
    const newRevision = expectMissing ? 1 : request.expected_configuration_revision + 1;
    const auditMetadata = {
        from_mode: "legacy_estimated",
        to_mode: "narration_first_v1",
        policy_version: request.narration_selection.policy_version,
        narration_selection: request.narration_selection,
        invalidated_downstream: downstreamStages.filter(s => project[s.key]).map(s => ({ stage: s.stage, record_id: project[s.key] as string })),
        expected_configuration_revision: request.expected_configuration_revision,
        new_configuration_revision: newRevision,
    };
    const prisma = db.narrationPersistence.prismaClient;
    if (prisma) {
        try {
            await prisma.$transaction(async tx => {
                const changed = await tx.project.updateMany({
                    where: {
                        id: project.id, ownerId: project.ownerId, narrationTimingMode: "legacy_estimated",
                        activeScriptRecordId: request.expected_active_script_record_id,
                        activeStoryboardRecordId: request.expected_downstream.storyboard_record_id,
                        activeAssetPlanRecordId: request.expected_downstream.asset_plan_record_id,
                        activeAssetManifestRecordId: request.expected_downstream.asset_manifest_record_id,
                        activeComposeRecordId: request.expected_downstream.compose_record_id,
                        activeRenderJobRecordId: request.expected_downstream.render_job_record_id,
                        activePublishPackageRecordId: request.expected_downstream.publish_package_record_id,
                    },
                    data: {
                        narrationTimingMode: "narration_first_v1",
                        activeNarrationRecordId: null, activeNarrationSubtitleRevisionId: null,
                        ...narrationDownstreamResetData(),
                    },
                });
                if (changed.count !== 1) throw new NarrationUpgradeError(409, { error: "narration_upgrade_conflict", reason: "项目来源或下游在确认前发生变化" });
                if (expectMissing) {
                    // 以"配置缺失"为预期状态在事务内创建；并发补建触发唯一冲突时整笔回滚。
                    await tx.projectGenerationConfiguration.create({ data: { id: db.generateId(), projectId: project.id, schemaVersion: "generation_configuration_v1", revision: newRevision, sourceUserPreferenceRevision: null, configurationJson: materialized as Prisma.InputJsonValue, createdAt: new Date(), updatedAt: new Date() } });
                } else {
                    const cfg = await tx.projectGenerationConfiguration.updateMany({
                        where: { projectId: project.id, revision: request.expected_configuration_revision },
                        data: { revision: newRevision, configurationJson: materialized as Prisma.InputJsonValue, updatedAt: new Date() },
                    });
                    if (cfg.count !== 1) throw new NarrationUpgradeError(409, { error: "project_generation_configuration_revision_conflict", current_revision: null, reason: "配置在确认前发生变化" });
                }
                await tx.auditLog.create({ data: { actorUserId: input.actorUserId ?? null, projectId: project.id, action: "narration_mode_upgraded", targetType: "project", targetId: project.id, metadataJson: auditMetadata } });
            });
        } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
                throw new NarrationUpgradeError(409, { error: "project_generation_configuration_revision_conflict", reason: "配置在确认前被并发创建" });
            }
            throw error;
        }
        const mirror = db.projects.get(project.id);
        if (mirror) Object.assign(mirror, { narrationTimingMode: "narration_first_v1", activeNarrationRecordId: null, activeNarrationSubtitleRevisionId: null, ...narrationDownstreamReset() });
    } else {
        // Map 分支：写前同步复查（复查与写入之间无 await，消除 TOCTOU 窗口），语义对齐 Prisma 分支 CAS。
        const latestProject = db.projects.get(project.id);
        const latestRecord = findProjectConfigRecord(db, project.id);
        if (!latestProject) throw new NarrationUpgradeError(409, { error: "narration_upgrade_conflict", reason: "项目在确认前发生变化" });
        if (expectMissing) {
            if (latestRecord) throw new NarrationUpgradeError(409, { error: "project_generation_configuration_revision_conflict", current_revision: latestRecord.revision });
        } else {
            if (!latestRecord) throw new NarrationUpgradeError(409, { error: "project_generation_configuration_revision_conflict", current_revision: null });
            if (latestRecord.revision !== request.expected_configuration_revision) throw new NarrationUpgradeError(409, { error: "project_generation_configuration_revision_conflict", current_revision: latestRecord.revision });
        }
        if ((latestProject.narrationTimingMode ?? "legacy_estimated") !== "legacy_estimated" || collectUpgradeConflicts(latestProject, request).length > 0) {
            throw new NarrationUpgradeError(409, { error: "narration_upgrade_conflict", reason: "项目来源或下游在确认前发生变化" });
        }
        Object.assign(latestProject, { narrationTimingMode: "narration_first_v1", activeNarrationRecordId: null, activeNarrationSubtitleRevisionId: null, ...narrationDownstreamReset() });
        if (expectMissing) {
            const recordId = db.generateId();
            db.projectGenerationConfigurations.set(recordId, { id: recordId, projectId: project.id, schemaVersion: "generation_configuration_v1", revision: newRevision, sourceUserPreferenceRevision: null, configurationJson: materialized, createdAt: new Date(), updatedAt: new Date() });
        } else if (latestRecord) {
            latestRecord.revision = newRevision;
            latestRecord.configurationJson = materialized;
            latestRecord.updatedAt = new Date();
        }
        const auditId = db.generateId();
        db.auditLogs.set(auditId, { id: auditId, actorUserId: input.actorUserId ?? null, projectId: project.id, action: "narration_mode_upgraded", targetType: "project", targetId: project.id, metadataJson: auditMetadata, createdAt: new Date() });
    }
    return { upgraded: true, configuration_revision: newRevision };
}
