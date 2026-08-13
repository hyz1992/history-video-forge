import type {
  DbClient,
  ProjectGenerationConfigurationRecord,
  ProviderModelCatalogRecord,
  UserGenerationPreferenceRecord,
} from "../../db/client.js";
import {
  DEFAULT_GENERATION_CONFIGURATION,
  type CapabilitySlot,
  type GenerationConfigurationV1,
} from "../../../../shared/src/index.js";

/**
 * S2-2A 生成配置 repository。
 *
 * 内存态读写 DbClient 的 Map；Prisma 激活态调用 firstAggregateWriter。
 * 复刻 createProject 的双写模式：内存 Map + 可选 writer 持久化。
 */

// --- 用户默认偏好 ----------------------------------------------------------

export interface UserPreferenceResult {
  userId: string;
  revision: number;
  configuration: GenerationConfigurationV1;
  schemaVersion: string;
}

export type UserPreferenceUpsertResult =
  | { ok: true; value: UserPreferenceResult }
  | { ok: false; error: { code: "generation_preference_revision_conflict"; current_revision: number } };

export function getUserGenerationPreference(db: DbClient, userId: string): UserPreferenceResult | null {
  for (const record of db.userGenerationPreferences.values()) {
    if (record.userId === userId) {
      return {
        userId: record.userId,
        revision: record.revision,
        configuration: record.configurationJson,
        schemaVersion: record.schemaVersion,
      };
    }
  }
  return null;
}

export function upsertUserGenerationPreference(
  db: DbClient,
  userId: string,
  input: { expected_revision: number | null; configuration: GenerationConfigurationV1 },
): UserPreferenceUpsertResult {
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
    // 新建：expected_revision 必须为 null
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
  const record: UserGenerationPreferenceRecord = {
    id: existing
      ? [...db.userGenerationPreferences.values()].find((r) => r.userId === userId)!.id
      : db.generateId(),
    userId,
    schemaVersion: "generation_configuration_v1",
    revision: newRevision,
    configurationJson: input.configuration,
    createdAt: existing ? [...db.userGenerationPreferences.values()].find((r) => r.userId === userId)!.createdAt : now,
    updatedAt: now,
  };

  // 内存态写入
  db.userGenerationPreferences.set(record.id, record);
  // Prisma 双写（异步但 fire-and-forget 与 createProject 一致模式）
  void db.firstAggregateWriter?.saveUserGenerationPreference(record);

  return {
    ok: true,
    value: {
      userId,
      revision: newRevision,
      configuration: input.configuration,
      schemaVersion: record.schemaVersion,
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
}

export type ProjectConfigUpsertResult =
  | { ok: true; value: ProjectConfigResult & { invalidation_preview: InvalidationPreview } }
  | { ok: false; error: { code: "project_generation_configuration_revision_conflict"; current_revision: number } };

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

export function getProjectGenerationConfiguration(db: DbClient, projectId: string): ProjectConfigResult {
  const record = findProjectConfigRecord(db, projectId);
  if (record) {
    return {
      projectId,
      revision: record.revision,
      configuration: record.configurationJson,
      schemaVersion: record.schemaVersion,
      source: "stored",
      sourceUserPreferenceRevision: record.sourceUserPreferenceRevision,
    };
  }
  // 旧项目无配置 → backfill 默认
  const backfilled = backfillProjectGenerationConfiguration(db, projectId, null);
  return backfilled;
}

export function backfillProjectGenerationConfiguration(
  db: DbClient,
  projectId: string,
  sourceUserPreferenceRevision: number | null,
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
  return {
    projectId,
    revision: 1,
    configuration: record.configurationJson,
    schemaVersion: record.schemaVersion,
    source: "backfilled_default",
    sourceUserPreferenceRevision,
  };
}

export function upsertProjectGenerationConfiguration(
  db: DbClient,
  projectId: string,
  input: { expected_revision: number; configuration: GenerationConfigurationV1 },
): ProjectConfigUpsertResult {
  // 确保配置存在（首次读取可能未 backfill）
  const current = getProjectGenerationConfiguration(db, projectId);

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
  db.projectGenerationConfigurations.set(updated.id, updated);
  void db.firstAggregateWriter?.saveProjectGenerationConfiguration(updated);

  return {
    ok: true,
    value: {
      projectId,
      revision: newRevision,
      configuration: input.configuration,
      schemaVersion: updated.schemaVersion,
      source: "stored",
      sourceUserPreferenceRevision: updated.sourceUserPreferenceRevision,
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
  if (JSON.stringify(oldConfig.budget) !== JSON.stringify(newConfig.budget)) {
    // 预算变化不使现有阶段产物失效
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
  display_name: string;
  quality_tier: string | null;
  speed_tier: string | null;
  pricing_version: string;
  pricing: Record<string, unknown>;
  is_default: boolean;
}

export function listPublicGenerationCapabilities(db: DbClient): PublicCapabilityEntry[] {
  const entries: PublicCapabilityEntry[] = [];
  for (const record of db.providerModelCatalog.values()) {
    if (record.status !== "active") continue;
    entries.push({
      id: record.id,
      capability: record.capability,
      display_name: record.displayName,
      quality_tier: record.qualityTier,
      speed_tier: record.speedTier,
      pricing_version: record.pricingVersion,
      pricing: record.pricingJson,
      is_default: record.isDefault,
    });
  }
  return entries;
}

// --- 辅助 ------------------------------------------------------------------
