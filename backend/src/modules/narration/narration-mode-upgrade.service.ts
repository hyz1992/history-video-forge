import { requireOwner } from "../../auth/authorization.js";
import type { DbClient, ProjectRecord } from "../../db/client.js";
import { Prisma } from "../../generated/prisma/client.js";
import { GenerationConfigurationV1, UpgradeNarrationModeRequest } from "../../../../shared/src/index.js";
import { NarrationModeUpgradePreviewV1, type NarrationModeUpgradePreviewV1 as Preview } from "../../../../shared/src/narration/narration-ui.schema.js";
import { findProjectConfigRecord, getProjectGenerationConfiguration } from "../generation-config/generation-config.repository.js";
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

/** 升级预览：只读；展示将失效的下游产物、当前配置与合格组合，不修改任何状态。 */
export async function previewNarrationModeUpgrade(db: DbClient, input: { projectId: string; user: ServiceUser; narrationFirstEnabled: boolean }): Promise<Preview> {
    const project = await loadLegacyProject(db, input.projectId, input.user);
    const config = await getProjectGenerationConfiguration(db, input.projectId);
    const available = await availableNarrationOptionsForOwner(db, project.ownerId);
    const recommendedOption = available.qualified_options.find(o => o.provider_model_id === available.default_provider_model_id) ?? available.qualified_options[0] ?? null;
    const tts = config.configuration.capabilities["tts.synthesize"];
    const scriptRecord = project.activeScriptRecordId ? db.scriptRecords.get(project.activeScriptRecordId) : null;
    return NarrationModeUpgradePreviewV1.parse({
        narration_timing_mode: "legacy_estimated",
        upgrade_available: input.narrationFirstEnabled,
        policy_version: available.policy_version,
        recommended: recommendedOption ? { provider_model_id: recommendedOption.provider_model_id, voice_profile_id: recommendedOption.voice_profile_id } : null,
        options: available.qualified_options,
        current_configuration: {
            revision: config.revision,
            tts_mode: tts.mode,
            provider_model_id: tts.mode === "fixed" ? tts.provider_model_id : null,
            voice_profile_id: config.configuration.creative.voice_profile_id ?? null,
        },
        script: {
            active_script_record_id: project.activeScriptRecordId ?? null,
            estimated_duration_sec: scriptRecord?.estimatedDurationSec ?? null,
        },
        affected: downstreamStages.filter(s => project[s.key]).map(s => ({ stage: s.stage, record_id: project[s.key] as string })),
    });
}

/** 旧项目显式升级：模式、固定配置、策略依据、下游失效与升级事件在同一事务；任何预期不匹配整笔不写。 */
export async function upgradeProjectToNarrationFirst(db: DbClient, input: { projectId: string; user: ServiceUser; narrationFirstEnabled: boolean; actorUserId?: string | null; request: unknown }): Promise<{ upgraded: true; configuration_revision: number }> {
    if (!input.narrationFirstEnabled) throw new NarrationUpgradeError(409, { error: "narration_mode_unavailable", reason: "口播前置模式尚未开放，不能升级" });
    const project = await loadLegacyProject(db, input.projectId, input.user);
    // 鉴权与来源核对先于请求体解析：跨 owner/来源冲突不应被 422 掩盖。
    const request = UpgradeNarrationModeRequest.parse(input.request);
    const current = await readProjectConfig(db, input.projectId);
    if (!current) throw new NarrationUpgradeError(409, { error: "project_generation_configuration_revision_conflict", current_revision: null });
    const conflicts: string[] = [];
    if (project.activeScriptRecordId !== request.expected_active_script_record_id) conflicts.push("active_script_record_id");
    const actualDownstream = downgradePointers(project);
    for (const [key, actual] of Object.entries(actualDownstream)) {
        if (actual !== request.expected_downstream[key as keyof typeof request.expected_downstream]) conflicts.push(key);
    }
    if (conflicts.length > 0) throw new NarrationUpgradeError(409, { error: "narration_upgrade_conflict", conflicts });
    if (current.revision !== request.expected_configuration_revision) {
        throw new NarrationUpgradeError(409, { error: "project_generation_configuration_revision_conflict", current_revision: current.revision });
    }
    // 任何拒绝都发生在写入之前；策略拒绝不落任何项目/配置状态。
    const materialized = await materializeNarrationConfiguration(db, project.ownerId, current.configurationJson, request.narration_selection);
    const newRevision = request.expected_configuration_revision + 1;
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
            const cfg = await tx.projectGenerationConfiguration.updateMany({
                where: { projectId: project.id, revision: request.expected_configuration_revision },
                data: { revision: newRevision, configurationJson: materialized as Prisma.InputJsonValue, updatedAt: new Date() },
            });
            if (cfg.count !== 1) throw new NarrationUpgradeError(409, { error: "project_generation_configuration_revision_conflict", current_revision: null, reason: "配置在确认前发生变化" });
            await tx.auditLog.create({ data: { actorUserId: input.actorUserId ?? null, projectId: project.id, action: "narration_mode_upgraded", targetType: "project", targetId: project.id, metadataJson: auditMetadata } });
        });
        const mirror = db.projects.get(project.id);
        if (mirror) Object.assign(mirror, { narrationTimingMode: "narration_first_v1", activeNarrationRecordId: null, activeNarrationSubtitleRevisionId: null, ...narrationDownstreamReset() });
    } else {
        Object.assign(project, { narrationTimingMode: "narration_first_v1", activeNarrationRecordId: null, activeNarrationSubtitleRevisionId: null, ...narrationDownstreamReset() });
        const record = findProjectConfigRecord(db, project.id)!;
        record.revision = newRevision;
        record.configurationJson = materialized;
        record.updatedAt = new Date();
        db.auditLogs.set(db.generateId(), { id: db.generateId(), actorUserId: input.actorUserId ?? null, projectId: project.id, action: "narration_mode_upgraded", targetType: "project", targetId: project.id, metadataJson: auditMetadata, createdAt: new Date() });
    }
    return { upgraded: true, configuration_revision: newRevision };
}
