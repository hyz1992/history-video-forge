import type {
  DbClient,
  ProjectGenerationConfigurationRecord,
  UserGenerationPreferenceRecord,
} from "../../db/client.js";
import {
  DEFAULT_GENERATION_CONFIGURATION,
  assertS22AScopeConstraints,
  type CapabilitySlot,
  type GenerationConfigurationV1,
} from "../../../../shared/src/index.js";

/**
 * S2-2A 生成配置 repository。
 *
 * 内存态读写 DbClient 的 Map；Prisma 激活态调用 firstAggregateWriter。
 * P1 整改：所有变更改为 async，Prisma 走 CAS（条件 updateMany WHERE revision=expected）
 * + 同事务审计；只有数据库提交成功后才更新内存 Map 并返回。
 */

// --- 用户默认偏好 ----------------------------------------------------------

export interface UserPreferenceResult {
  userId: string;
  revision: number;
  configuration: GenerationConfigurationV1;
  schemaVersion: string;
  updatedAt: Date;
}

export type UserPreferenceUpsertResult =
  | { ok: true; value: UserPreferenceResult }
  | { ok: false; error: { code: "generation_preference_revision_conflict"; current_revision: number } }
  | { ok: false; error: { code: "configuration_invalid_s2_2a_scope"; reason: string } };

export function getUserGenerationPreference(db: DbClient, userId: string): UserPreferenceResult | null {
  for (const record of db.userGenerationPreferences.values()) {
    if (record.userId === userId) {
      return {
        userId: record.userId,
        revision: record.revision,
        configuration: record.configurationJson,
        schemaVersion: record.schemaVersion,
        updatedAt: record.updatedAt,
      };
    }
  }
  return null;
}

export async function upsertUserGenerationPreference(
  db: DbClient,
  userId: string,
  input: { expected_revision: number | null; configuration: GenerationConfigurationV1 },
  actorUserId: string,
): Promise<UserPreferenceUpsertResult> {
  // P1-3：S2-2A 只允许 video/budget（creative 全 null + capabilities 全 auto）
  const scopeCheck = assertS22AScopeConstraints(input.configuration);
  if (!scopeCheck.ok) {
    return { ok: false, error: { code: "configuration_invalid_s2_2a_scope", reason: scopeCheck.reason } };
  }

  const existing = getUserGenerationPreference(db, userId);

  // 乐观锁：expected_revision 不匹配 → 冲突
  if (existing) {
    if (input.expected_revision !== existing.revision) {
      return {
        ok: false,
        error: {
          code: "generation_preference_revision_conflict",
          current_revision: existing.revision,
        },
      };
    }
  } else {
    if (input.expected_revision !== null) {
      return {
        ok: false,
        error: {
          code: "generation_preference_revision_conflict",
          current_revision: 0,
        },
      };
    }
  }

  const now = new Date();
  const newRevision = existing ? existing.revision + 1 : 1;
  const oldRecord = existing
    ? [...db.userGenerationPreferences.values()].find((r) => r.userId === userId)!
    : null;
  const record: UserGenerationPreferenceRecord = {
    id: oldRecord?.id ?? db.generateId(),
    userId,
    schemaVersion: "generation_configuration_v1",
    revision: newRevision,
    configurationJson: input.configuration,
    createdAt: oldRecord?.createdAt ?? now,
    updatedAt: now,
  };

  const diff = computeConfigDiff(existing?.configuration, input.configuration);

  // P1-1：Prisma 激活态走 CAS（条件更新 + 审计同事务），await 完成再更新内存
  if (db.firstAggregateWriter?.casUpdateUserGenerationPreference) {
    const success = await db.firstAggregateWriter.casUpdateUserGenerationPreference(
      record,
      existing ? existing.revision : 0,
      { actorUserId, oldRevision: existing ? existing.revision : 0, newRevision, diff },
    );
    if (!success) {
      return {
        ok: false,
        error: { code: "generation_preference_revision_conflict", current_revision: existing ? existing.revision : 0 },
      };
    }
  } else {
    // 内存态或旧 writer：fire-and-forget（无 CAS，但内存无并发）
    void db.firstAggregateWriter?.saveUserGenerationPreference(record);
  }

  // 数据库成功后才更新内存 Map
  db.userGenerationPreferences.set(record.id, record);

  return {
    ok: true,
    value: {
      userId,
      revision: newRevision,
      configuration: input.configuration,
      schemaVersion: record.schemaVersion,
      updatedAt: now,
    },
  };
}

// --- 项目冻结配置 ----------------------------------------------------------

export interface ProjectConfigResult {
  projectId: string;
  revision: number;
  configuration: GenerationConfigurationV1;
  schemaVersion: string;
  source: "stored" | "backfilled_default";
  sourceUserPreferenceRevision: number | null;
  updatedAt: Date;
  /** 与当前用户默认的差异（公开 diff，无敏感信息）。 */
  diff_from_user_default: Record<string, unknown> | null;
}

export type ProjectConfigUpsertResult =
  | { ok: true; value: ProjectConfigResult & { invalidation_preview: InvalidationPreview } }
  | { ok: false; error: { code: "project_generation_configuration_revision_conflict"; current_revision: number } }
  | { ok: false; error: { code: "configuration_invalid_s2_2a_scope"; reason: string } };

export interface InvalidationPreview {
  affected_stages: string[];
  note: string;
}

export function findProjectConfigRecord(db: DbClient, projectId: string): ProjectGenerationConfigurationRecord | null {
  for (const record of db.projectGenerationConfigurations.values()) {
    if (record.projectId === projectId) return record;
  }
  return null;
}

export function getProjectGenerationConfiguration(
  db: DbClient,
  projectId: string,
  actorUserId?: string,
): ProjectConfigResult {
  const record = findProjectConfigRecord(db, projectId);
  if (!record) {
    // 旧项目无配置 → backfill 默认
    return backfillProjectGenerationConfiguration(db, projectId, null, actorUserId);
  }
  // 计算与当前用户默认的差异
  const userPref = actorUserId ? getUserGenerationPreference(db, actorUserId) : null;
  const diff = userPref ? computeConfigDiff(userPref.configuration, record.configurationJson) : null;
  return {
    projectId,
    revision: record.revision,
    configuration: record.configurationJson,
    schemaVersion: record.schemaVersion,
    source: "stored",
    sourceUserPreferenceRevision: record.sourceUserPreferenceRevision,
    updatedAt: record.updatedAt,
    diff_from_user_default: diff,
  };
}

export function backfillProjectGenerationConfiguration(
  db: DbClient,
  projectId: string,
  sourceUserPreferenceRevision: number | null,
  actorUserId?: string,
): ProjectConfigResult {
  const now = new Date();
  const record: ProjectGenerationConfigurationRecord = {
    id: db.generateId(),
    projectId,
    schemaVersion: "generation_configuration_v1",
    revision: 1,
    sourceUserPreferenceRevision,
    configurationJson: { ...DEFAULT_GENERATION_CONFIGURATION },
    createdAt: now,
    updatedAt: now,
  };
  db.projectGenerationConfigurations.set(record.id, record);
  void db.firstAggregateWriter?.saveProjectGenerationConfiguration(record);
  const userPref = actorUserId ? getUserGenerationPreference(db, actorUserId) : null;
  const diff = userPref ? computeConfigDiff(userPref.configuration, record.configurationJson) : null;
  return {
    projectId,
    revision: 1,
    configuration: record.configurationJson,
    schemaVersion: record.schemaVersion,
    source: "backfilled_default",
    sourceUserPreferenceRevision,
    updatedAt: now,
    diff_from_user_default: diff,
  };
}

export async function upsertProjectGenerationConfiguration(
  db: DbClient,
  projectId: string,
  input: { expected_revision: number; configuration: GenerationConfigurationV1 },
  actorUserId: string,
): Promise<ProjectConfigUpsertResult> {
  // P1-3：S2-2A scope 校验
  const scopeCheck = assertS22AScopeConstraints(input.configuration);
  if (!scopeCheck.ok) {
    return { ok: false, error: { code: "configuration_invalid_s2_2a_scope", reason: scopeCheck.reason } };
  }

  const current = getProjectGenerationConfiguration(db, projectId, actorUserId);

  if (input.expected_revision !== current.revision) {
    return {
      ok: false,
      error: {
        code: "project_generation_configuration_revision_conflict",
        current_revision: current.revision,
      },
    };
  }

  const now = new Date();
  const newRevision = current.revision + 1;
  const existingRecord = findProjectConfigRecord(db, projectId);
  if (!existingRecord) throw new Error("project_config_not_found_after_backfill");

  const updated: ProjectGenerationConfigurationRecord = {
    ...existingRecord,
    revision: newRevision,
    configurationJson: input.configuration,
    updatedAt: now,
  };
  const diff = computeConfigDiff(current.configuration, input.configuration);

  // P1-1：Prisma CAS + 审计同事务
  if (db.firstAggregateWriter?.casUpdateProjectGenerationConfiguration) {
    const success = await db.firstAggregateWriter.casUpdateProjectGenerationConfiguration(
      updated,
      current.revision,
      { actorUserId, projectId, oldRevision: current.revision, newRevision, diff },
    );
    if (!success) {
      return {
        ok: false,
        error: { code: "project_generation_configuration_revision_conflict", current_revision: current.revision },
      };
    }
  } else {
    void db.firstAggregateWriter?.saveProjectGenerationConfiguration(updated);
  }

  db.projectGenerationConfigurations.set(updated.id, updated);

  return {
    ok: true,
    value: {
      projectId,
      revision: newRevision,
      configuration: input.configuration,
      schemaVersion: updated.schemaVersion,
      source: "stored",
      sourceUserPreferenceRevision: updated.sourceUserPreferenceRevision,
      updatedAt: now,
      diff_from_user_default: null,
      invalidation_preview: computeInvalidationPreview(current.configuration, input.configuration),
    },
  };
}

function computeInvalidationPreview(
  oldConfig: GenerationConfigurationV1,
  newConfig: GenerationConfigurationV1,
): InvalidationPreview {
  const stages: string[] = [];
  if (oldConfig.video.strategy !== newConfig.video.strategy) {
    stages.push("storyboard_route_resolution", "asset_planning");
  }
  if (oldConfig.video.api_quality !== newConfig.video.api_quality) {
    stages.push("asset_planning", "assets");
  }
  return {
    affected_stages: stages.length > 0 ? stages : ["none"],
    note: "配置变更仅保存，不自动触发下游生成；用户需显式重新规划/生成受影响阶段。",
  };
}

// --- 目录只读 API ----------------------------------------------------------

export interface PublicCapabilityEntry {
  id: string;
  capability: CapabilitySlot;
  provider_key: string;
  model_id: string;
  model_version: string | null;
  display_name: string;
  quality_tier: string | null;
  speed_tier: string | null;
  parameter_capabilities: Record<string, unknown>;
  pricing_version: string;
  pricing: Record<string, unknown>;
  status: "active" | "disabled";
  is_default: boolean;
  availability: "enabled" | "disabled";
}

export function listPublicGenerationCapabilities(db: DbClient): PublicCapabilityEntry[] {
  const entries: PublicCapabilityEntry[] = [];
  for (const record of db.providerModelCatalog.values()) {
    if (record.status !== "active") continue;
    entries.push({
      id: record.id,
      capability: record.capability,
      provider_key: record.providerKey,
      model_id: record.modelId,
      model_version: record.modelVersion,
      display_name: record.displayName,
      quality_tier: record.qualityTier,
      speed_tier: record.speedTier,
      parameter_capabilities: record.parameterCapabilitiesJson,
      pricing_version: record.pricingVersion,
      pricing: record.pricingJson,
      status: record.status,
      is_default: record.isDefault,
      availability: record.status === "active" ? "enabled" : "disabled",
    });
  }
  return entries;
}

// --- 辅助 ------------------------------------------------------------------

/**
 * 计算两个配置的公开 diff（只含 video/budget 差异，不含凭据）。
 */
function computeConfigDiff(
  oldConfig: GenerationConfigurationV1 | undefined,
  newConfig: GenerationConfigurationV1,
): Record<string, unknown> {
  if (!oldConfig) return { created: true };
  const diff: Record<string, unknown> = {};
  if (JSON.stringify(oldConfig.video) !== JSON.stringify(newConfig.video)) {
    diff.video = { from: oldConfig.video, to: newConfig.video };
  }
  if (JSON.stringify(oldConfig.budget) !== JSON.stringify(newConfig.budget)) {
    diff.budget = { from: oldConfig.budget, to: newConfig.budget };
  }
  return diff;
}
