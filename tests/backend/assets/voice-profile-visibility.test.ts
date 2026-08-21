import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { createDbClient, type DbClient } from "../../../backend/src/db/client.js";
import { createPrismaClient } from "../../../backend/src/db/prisma-client.js";
import { applyAllDatabaseMigrations } from "../db/migration-test-utils.js";
import {
  configureVoiceProfilePersistence,
  getVoiceProfileById,
  listVoiceProfiles,
  recordVoiceProfileUsage,
  saveVoiceProfile,
  seedGlobalVoiceProfiles,
  updateVoiceProfileProviderState,
} from "../../../backend/src/modules/assets/voice/voice-profile.repository.js";
import { SHARED_VOICE_PROFILE_SEEDS } from "../../../backend/src/modules/assets/voice/voice-presets.js";
import type { VoiceProfile } from "../../../shared/src/index.js";

/**
 * S2-2B 任务 3：音色库可见性与数据库权威（详细设计 §6.4，外部审查 P1-4）。
 *
 * - 公共（preset/system）与用户私有（generated）档案分离。
 * - 列表/读取按"公共 + 本人私有"过滤。
 * - Prisma 态跨实例：实例 B 冷镜像能读到实例 A 写入的最新档案。
 * - 历史 JSON 一次性导入为 public（幂等）；JSON 不再被写入。
 */

function makeGeneratedProfile(overrides: Partial<VoiceProfile> = {}): VoiceProfile {
  return {
    voice_profile_id: "voice_generated_test_user",
    kind: "generated",
    name: "用户生成音色",
    description: "测试生成档案",
    design_prompt: "设计提示",
    preview_text: "试听文本",
    provider_name: "dashscope",
    provider_voice_id: null,
    provider_status: "missing",
    target_model: "qwen3-tts-vd-2026-01-26",
    recommended_content_families: ["historical-story"],
    voice_traits: ["cold"],
    avoid_traits: [],
    gender_tone: null,
    age_band: null,
    pitch: null,
    pace: null,
    energy: 0.5,
    authority: 0.5,
    suspense: 0.3,
    warmth: 0.4,
    preview_audio_uri: null,
    usage_count: 0,
    last_used_at: null,
    quality_score: null,
    created_at: "2026-08-21T00:00:00.000Z",
    updated_at: "2026-08-21T00:00:00.000Z",
    ...overrides,
  };
}

const tempDirectories: string[] = [];

function createMigratedDatabasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), "story-forge-voice-"));
  tempDirectories.push(directory);
  const databasePath = join(directory, "test.db");
  const database = new Database(databasePath);
  try {
    applyAllDatabaseMigrations(database);
  } finally {
    database.close();
  }
  return databasePath;
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("Map 态：可见性规则", () => {
  function mapDb(): DbClient {
    const rootDir = mkdtempSync(join(tmpdir(), "story-forge-voice-map-"));
    tempDirectories.push(rootDir);
    const db = createDbClient();
    configureVoiceProfilePersistence(db, { rootDir });
    return db;
  }

  it("seed 的 preset/system 档案为公共（visibility=public, owner_id=null）", async () => {
    const db = mapDb();
    await seedGlobalVoiceProfiles(db);
    const profiles = await listVoiceProfiles(db, {});
    expect(profiles.length).toBeGreaterThanOrEqual(SHARED_VOICE_PROFILE_SEEDS.length);
    for (const profile of profiles) {
      expect(profile.visibility).toBe("public");
      expect(profile.owner_id).toBeNull();
    }
  });

  it("保存 generated 档案 → 私有；无 scope 列表不可见，本人 scope 可见", async () => {
    const db = mapDb();
    await seedGlobalVoiceProfiles(db);
    await saveVoiceProfile(db, makeGeneratedProfile({ owner_id: "user_a" }));

    const publicOnly = await listVoiceProfiles(db, {});
    expect(publicOnly.find((p) => p.voice_profile_id === "voice_generated_test_user")).toBeUndefined();

    const forA = await listVoiceProfiles(db, { ownerId: "user_a" });
    expect(forA.find((p) => p.voice_profile_id === "voice_generated_test_user")).toBeDefined();

    const forB = await listVoiceProfiles(db, { ownerId: "user_b" });
    expect(forB.find((p) => p.voice_profile_id === "voice_generated_test_user")).toBeUndefined();
  });

  it("getVoiceProfileById 带 scope：非可见档案按不存在处理", async () => {
    const db = mapDb();
    await seedGlobalVoiceProfiles(db);
    await saveVoiceProfile(db, makeGeneratedProfile({ owner_id: "user_a" }));

    expect(await getVoiceProfileById(db, "voice_generated_test_user", { ownerId: "user_a" })).not.toBeNull();
    expect(await getVoiceProfileById(db, "voice_generated_test_user", { ownerId: "user_b" })).toBeNull();
    // 公共 seed 档案对任意 scope 可见
    expect(
      await getVoiceProfileById(db, SHARED_VOICE_PROFILE_SEEDS[0]!.voice_profile_id, { ownerId: "user_b" }),
    ).not.toBeNull();
  });

  it("updateVoiceProfileProviderState / recordVoiceProfileUsage 保持归属字段", async () => {
    const db = mapDb();
    await seedGlobalVoiceProfiles(db);
    await saveVoiceProfile(db, makeGeneratedProfile({ owner_id: "user_a" }));

    const updated = await updateVoiceProfileProviderState(db, "voice_generated_test_user", {
      provider_status: "ready",
      provider_voice_id: "pv-1",
    });
    expect(updated?.owner_id).toBe("user_a");
    expect(updated?.visibility).toBe("private");

    const used = await recordVoiceProfileUsage(db, "voice_generated_test_user", "2026-08-21T10:00:00.000Z");
    expect(used?.usage_count).toBe(1);
    expect(used?.owner_id).toBe("user_a");
  });
});

describe("Prisma 态：数据库权威与跨实例一致性", () => {
  function prismaDb(prismaClient: import("../../../backend/src/db/prisma-client.types.js").AppPrismaClient): DbClient {
    const rootDir = mkdtempSync(join(tmpdir(), "story-forge-voice-prisma-"));
    tempDirectories.push(rootDir);
    const db = createDbClient();
    configureVoiceProfilePersistence(db, { rootDir, prismaClient });
    return db;
  }

  it("实例 B（冷镜像，无内存数据）能读到实例 A 写入的档案", async () => {
    const databasePath = createMigratedDatabasePath();

    // 实例 A：seed + 保存用户档案（经 repository 写库）
    const clientA = await createPrismaClient(databasePath);
    const dbA = prismaDb(clientA);
    try {
      // 私有档案归属的用户必须存在（FK 约束是可见性同源授权的 SQL 层防线）
      await clientA.user.create({
        data: { id: "user_a", username: "user-a", displayName: "A", passwordHash: "h", role: "USER" },
      });
      await clientA.user.create({
        data: { id: "user_b", username: "user-b", displayName: "B", passwordHash: "h", role: "USER" },
      });
      await seedGlobalVoiceProfiles(dbA);
      await saveVoiceProfile(dbA, makeGeneratedProfile({ owner_id: "user_a" }));
      await updateVoiceProfileProviderState(dbA, "voice_generated_test_user", {
        provider_status: "ready",
        provider_voice_id: "pv-cross-instance",
      });
    } finally {
      await clientA.$disconnect();
    }

    // 实例 B：全新 DbClient + 新 prisma client，无任何内存镜像
    const clientB = await createPrismaClient(databasePath);
    const dbB = prismaDb(clientB);
    try {
      const forA = await listVoiceProfiles(dbB, { ownerId: "user_a" });
      const generated = forA.find((p) => p.voice_profile_id === "voice_generated_test_user");
      expect(generated).toBeDefined();
      expect(generated?.provider_status).toBe("ready");
      expect(generated?.provider_voice_id).toBe("pv-cross-instance");
      expect(generated?.visibility).toBe("private");
      expect(generated?.owner_id).toBe("user_a");

      // 其他用户看不到私有档案
      const forB = await listVoiceProfiles(dbB, { ownerId: "user_b" });
      expect(forB.find((p) => p.voice_profile_id === "voice_generated_test_user")).toBeUndefined();

      // 公共 seed 可见
      const publicOnly = await listVoiceProfiles(dbB, {});
      expect(publicOnly.length).toBeGreaterThanOrEqual(SHARED_VOICE_PROFILE_SEEDS.length);
    } finally {
      await clientB.$disconnect();
    }
  });

  it("Prisma 态 seed 幂等：重复 seed 不产生重复档案", async () => {
    const databasePath = createMigratedDatabasePath();
    const clientA = await createPrismaClient(databasePath);
    const dbA = prismaDb(clientA);
    const clientB = await createPrismaClient(databasePath);
    const dbB = prismaDb(clientB);
    try {
      await seedGlobalVoiceProfiles(dbA);
      await seedGlobalVoiceProfiles(dbB);
      const all = await listVoiceProfiles(dbA, {});
      const ids = all.map((p) => p.voice_profile_id);
      expect(new Set(ids).size).toBe(ids.length);
    } finally {
      await clientA.$disconnect();
      await clientB.$disconnect();
    }
  });
});
