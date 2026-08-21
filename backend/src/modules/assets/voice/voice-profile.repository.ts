import type {
  AppPrismaClient,
} from "../../../db/prisma-client.types.js";
import type {
  DbClient,
} from "../../../db/client.js";
import {
  VoiceProfile,
  type VoiceProfile as VoiceProfileRecord,
} from "../../../../../shared/src/index.js";
import {
  loadVoiceProfileLibrary,
  saveVoiceProfileLibrary,
} from "./voice-profile-library-store.js";
import { SHARED_VOICE_PROFILE_SEEDS } from "./voice-presets.js";

/**
 * S2-2B 音色库 repository（详细设计 §6.4，外部审查 P1-4）。
 *
 * 双模：
 * - Prisma 激活态（voiceProfilePersistence.prismaClient 非空）：数据库为
 *   跨实例权威，repository 直查数据库并同步内存镜像（与快照 P1-2 整改同模式）。
 * - Map 态：进程内 Map；历史 JSON 文件只做一次性导入（退役后不再读写）。
 *
 * 可见性（同源授权）：
 * - `listVoiceProfiles(db, scope)`：scope.ownerId 提供 → 公共 + 本人私有；
 *   否则只返回公共档案（fail-closed，API/解析调用方必须显式传用户）。
 * - `getVoiceProfileById(db, id, scope?)`：带 scope 时按可见性过滤（不可见按
 *   不存在处理）；不带 scope 仅供内部执行路径使用（档案 id 已由快照/计划授权）。
 */
export interface VoiceProfileScope {
  /** 当前用户 id；缺省 = 仅公共档案。 */
  ownerId?: string | null;
}

export interface VoiceProfilePersistenceOptions {
  rootDir?: string;
  prismaClient?: AppPrismaClient;
}

export function configureVoiceProfilePersistence(
  db: DbClient,
  options: VoiceProfilePersistenceOptions,
): void {
  db.voiceProfilePersistence = {
    rootDir: options.rootDir,
    enabled: true,
    loaded: false,
    prismaClient: options.prismaClient,
  };
}

/** 按 kind 归一化归属语义：preset/system → 公共；generated → 创建用户私有。 */
function normalizeProfile(profile: VoiceProfileRecord): VoiceProfileRecord {
  const isGenerated = profile.kind === "generated";
  return VoiceProfile.parse({
    ...profile,
    owner_id: isGenerated ? (profile.owner_id ?? null) : null,
    visibility: isGenerated
      ? (profile.visibility ?? "private")
      : (profile.visibility ?? "public"),
  });
}

/**
 * 加载路径归一化：历史 JSON（无 owner_id/visibility 字段）的生成档案归公共
 * （无归属语义，避免破坏既有匹配与引用）；带归属字段的记录保持原值。
 */
function normalizeLoadedProfile(profile: VoiceProfileRecord): VoiceProfileRecord {
  const hasOwnership = profile.owner_id !== undefined || profile.visibility !== undefined;
  if (!hasOwnership) {
    return normalizeProfile({ ...profile, owner_id: null, visibility: "public" });
  }
  return normalizeProfile(profile);
}

function isVisibleTo(profile: VoiceProfileRecord, scope?: VoiceProfileScope): boolean {
  if (profile.visibility === "public") return true;
  return scope?.ownerId != null && profile.owner_id === scope.ownerId;
}

// --- 元数据编解码（权威列 + metadataJson） ----------------------------------

const METADATA_KEYS = [
  "name",
  "description",
  "design_prompt",
  "preview_text",
  "recommended_content_families",
  "voice_traits",
  "avoid_traits",
  "gender_tone",
  "age_band",
  "pitch",
  "pace",
  "energy",
  "authority",
  "suspense",
  "warmth",
] as const;

function profileToRow(profile: VoiceProfileRecord) {
  const metadata: Record<string, unknown> = {};
  for (const key of METADATA_KEYS) {
    metadata[key] = (profile as unknown as Record<string, unknown>)[key];
  }
  return {
    id: profile.voice_profile_id,
    kind: profile.kind,
    ownerId: profile.owner_id ?? null,
    visibility: profile.visibility ?? (profile.kind === "generated" ? "private" : "public"),
    providerName: profile.provider_name,
    providerVoiceId: profile.provider_voice_id,
    providerStatus: profile.provider_status,
    targetModel: profile.target_model,
    previewAudioUri: profile.preview_audio_uri,
    usageCount: profile.usage_count,
    lastUsedAt: profile.last_used_at ? new Date(profile.last_used_at) : null,
    qualityScore: profile.quality_score,
    metadataJson: metadata as never,
    createdAt: new Date(profile.created_at),
    updatedAt: new Date(profile.updated_at),
  };
}

function rowToProfile(row: {
  id: string;
  kind: string;
  ownerId: string | null;
  visibility: string;
  providerName: string;
  providerVoiceId: string | null;
  providerStatus: string;
  targetModel: string;
  previewAudioUri: string | null;
  usageCount: number;
  lastUsedAt: Date | null;
  qualityScore: number | null;
  metadataJson: unknown;
  createdAt: Date;
  updatedAt: Date;
}): VoiceProfileRecord {
  const metadata = (row.metadataJson ?? {}) as Record<string, unknown>;
  return VoiceProfile.parse({
    voice_profile_id: row.id,
    kind: row.kind,
    owner_id: row.ownerId,
    visibility: row.visibility === "private" ? "private" : "public",
    provider_name: row.providerName,
    provider_voice_id: row.providerVoiceId,
    provider_status: row.providerStatus,
    target_model: row.targetModel,
    preview_audio_uri: row.previewAudioUri,
    usage_count: row.usageCount,
    last_used_at: row.lastUsedAt?.toISOString() ?? null,
    quality_score: row.qualityScore,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    ...metadata,
  });
}

// --- 加载与 seed ------------------------------------------------------------

function prismaOf(db: DbClient): AppPrismaClient | null {
  return db.voiceProfilePersistence.prismaClient ?? null;
}

/** Map 态：加载 JSON（历史/legacy 存储）+ seed。 */
async function ensureMapLibrary(db: DbClient): Promise<void> {
  if (db.voiceProfilePersistence.loaded) return;
  if (db.voiceProfilePersistence.enabled) {
    const document = await loadVoiceProfileLibrary({
      rootDir: db.voiceProfilePersistence.rootDir,
    });
    for (const profile of document.profiles) {
      db.voiceProfiles.set(profile.voice_profile_id, normalizeLoadedProfile(profile));
    }
  }
  db.voiceProfilePersistence.loaded = true;
}

/**
 * 兼容导出：把持久化音色库加载进内存 Map（不含 seed）。
 * S2-2B 后 JSON 仅作为 Map 态 legacy 存储；Prisma 态以数据库为权威。
 */
export async function loadPersistedVoiceProfiles(db: DbClient): Promise<void> {
  await ensureMapLibrary(db);
}

/** Map 态：JSON 写穿持久化（legacy 存储；Prisma 态不使用）。 */
async function persistMapProfiles(db: DbClient): Promise<void> {
  if (!db.voiceProfilePersistence.enabled) return;
  await saveVoiceProfileLibrary({
    rootDir: db.voiceProfilePersistence.rootDir,
    profiles: [...db.voiceProfiles.values()],
  });
}

async function seedMapProfiles(db: DbClient): Promise<void> {
  await ensureMapLibrary(db);
  let changed = false;
  for (const seed of SHARED_VOICE_PROFILE_SEEDS) {
    if (!db.voiceProfiles.has(seed.voice_profile_id)) {
      db.voiceProfiles.set(seed.voice_profile_id, normalizeProfile(seed));
      changed = true;
    }
  }
  if (changed) {
    await persistMapProfiles(db);
  }
}

async function seedPrismaProfiles(db: DbClient): Promise<void> {
  const prisma = prismaOf(db);
  if (!prisma) return;
  // seed/导入幂等：已存在的 id 跳过；本函数内新插入的 id 也计入 known（历史
  // JSON 可能包含 seed 档案本身，必须先记 seed 再判重）。
  const existing = await prisma.voiceProfile.findMany({ select: { id: true } });
  const knownIds = new Set(existing.map((row) => row.id));
  for (const seed of SHARED_VOICE_PROFILE_SEEDS) {
    if (knownIds.has(seed.voice_profile_id)) continue;
    const normalized = normalizeProfile(seed);
    await prisma.voiceProfile.create({ data: profileToRow(normalized) });
    knownIds.add(normalized.voice_profile_id);
    db.voiceProfiles.set(normalized.voice_profile_id, normalized);
  }
  // 历史 JSON 一次性导入（幂等：按 id 跳过）
  const document = await loadVoiceProfileLibrary({ rootDir: db.voiceProfilePersistence.rootDir });
  for (const profile of document.profiles) {
    if (knownIds.has(profile.voice_profile_id)) continue;
    const imported = normalizeLoadedProfile(profile);
    await prisma.voiceProfile.create({ data: profileToRow(imported) });
    knownIds.add(imported.voice_profile_id);
    db.voiceProfiles.set(imported.voice_profile_id, imported);
  }
}

/** 幂等 seed 公共预设/系统档案（Map 与 Prisma 双模）。 */
export async function seedGlobalVoiceProfiles(db: DbClient): Promise<void> {
  if (prismaOf(db)) {
    await seedPrismaProfiles(db);
    return;
  }
  await seedMapProfiles(db);
}

// --- 查询 -------------------------------------------------------------------

export async function listVoiceProfiles(
  db: DbClient,
  scope?: VoiceProfileScope,
): Promise<VoiceProfileRecord[]> {
  const prisma = prismaOf(db);
  if (prisma) {
    const rows = await prisma.voiceProfile.findMany({
      where: scope?.ownerId
        ? { OR: [{ visibility: "public" }, { ownerId: scope.ownerId }], providerStatus: { not: "deleted" } }
        : { visibility: "public", providerStatus: { not: "deleted" } },
      orderBy: { id: "asc" },
    });
    const profiles = rows.map(rowToProfile);
    for (const profile of profiles) db.voiceProfiles.set(profile.voice_profile_id, profile);
    return profiles;
  }

  await ensureMapLibrary(db);
  return [...db.voiceProfiles.values()].filter(
    (profile) => profile.provider_status !== "deleted" && isVisibleTo(profile, scope),
  );
}

export async function getVoiceProfileById(
  db: DbClient,
  id: string,
  scope?: VoiceProfileScope,
): Promise<VoiceProfileRecord | null> {
  const prisma = prismaOf(db);
  if (prisma) {
    const row = await prisma.voiceProfile.findUnique({ where: { id } });
    if (!row) return null;
    const profile = rowToProfile(row);
    db.voiceProfiles.set(profile.voice_profile_id, profile);
    // 带 scope 时按可见性过滤；不带 scope 仅供内部执行路径（id 已由快照/计划授权）
    return scope ? (isVisibleTo(profile, scope) ? profile : null) : profile;
  }

  await ensureMapLibrary(db);
  const profile = db.voiceProfiles.get(id) ?? null;
  if (!profile) return null;
  return scope ? (isVisibleTo(profile, scope) ? profile : null) : profile;
}

// --- 写入（内部执行路径：id 已由快照/计划授权，不做 scope 过滤） --------------

export async function saveVoiceProfile(
  db: DbClient,
  profile: VoiceProfileRecord,
): Promise<VoiceProfileRecord> {
  const normalized = normalizeProfile(profile);
  const prisma = prismaOf(db);
  if (prisma) {
    await prisma.voiceProfile.upsert({
      where: { id: normalized.voice_profile_id },
      create: profileToRow(normalized),
      update: profileToRow(normalized),
    });
  } else {
    db.voiceProfiles.set(normalized.voice_profile_id, normalized);
    await persistMapProfiles(db);
  }
  return normalized;
}

export async function updateVoiceProfileProviderState(
  db: DbClient,
  id: string,
  patch: Pick<VoiceProfileRecord, "provider_status"> &
    Partial<Pick<VoiceProfileRecord, "provider_voice_id" | "preview_audio_uri">>,
): Promise<VoiceProfileRecord | null> {
  const existing = await getVoiceProfileById(db, id);
  if (!existing) return null;

  const updated = VoiceProfile.parse({
    ...existing,
    provider_status: patch.provider_status,
    provider_voice_id:
      patch.provider_voice_id === undefined
        ? existing.provider_voice_id
        : patch.provider_voice_id,
    preview_audio_uri:
      patch.preview_audio_uri === undefined
        ? existing.preview_audio_uri
        : patch.preview_audio_uri,
    updated_at: new Date().toISOString(),
  });

  const prisma = prismaOf(db);
  if (prisma) {
    await prisma.voiceProfile.update({
      where: { id },
      data: profileToRow(updated),
    });
  } else {
    db.voiceProfiles.set(id, updated);
    await persistMapProfiles(db);
  }
  return updated;
}

export async function recordVoiceProfileUsage(
  db: DbClient,
  id: string,
  nowIso: string = new Date().toISOString(),
): Promise<VoiceProfileRecord | null> {
  const existing = await getVoiceProfileById(db, id);
  if (!existing || existing.provider_status === "deleted") {
    return null;
  }

  const updated = VoiceProfile.parse({
    ...existing,
    usage_count: existing.usage_count + 1,
    last_used_at: nowIso,
    updated_at: nowIso,
  });

  const prisma = prismaOf(db);
  if (prisma) {
    await prisma.voiceProfile.update({
      where: { id },
      data: profileToRow(updated),
    });
  } else {
    db.voiceProfiles.set(id, updated);
    await persistMapProfiles(db);
  }
  return updated;
}
