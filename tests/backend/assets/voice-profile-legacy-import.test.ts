import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { createDbClient, type DbClient } from "../../../backend/src/db/client.js";
import { createPrismaClient } from "../../../backend/src/db/prisma-client.js";
import { applyAllDatabaseMigrations } from "../db/migration-test-utils.js";
import {
  configureVoiceProfilePersistence,
  seedGlobalVoiceProfiles,
  listVoiceProfiles,
} from "../../../backend/src/modules/assets/voice/voice-profile.repository.js";
import { saveVoiceProfileLibrary } from "../../../backend/src/modules/assets/voice/voice-profile-library-store.js";
import type { VoiceProfile } from "../../../shared/src/index.js";

/**
 * S2-2B 任务 3 整改（外部审查 P2-3）：历史 JSON 一次性导入后归档。
 *
 * - Prisma 态：导入（无归属字段的历史档案 → public）→ JSON 归档为
 *   `voice-profiles.json.imported` → 后续启动不再读取历史 JSON；
 * - 二次 seed 幂等：不重复导入、不报错；
 * - Map 态保留 JSON 写穿（legacy 存储，无 Prisma 演示/测试依赖）。
 */

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function legacyProfile(id: string, overrides: Partial<VoiceProfile> = {}): VoiceProfile {
  return {
    voice_profile_id: id,
    kind: "generated",
    name: `历史生成音色 ${id}`,
    description: "历史数据",
    design_prompt: "设计提示",
    preview_text: "试听文本",
    provider_name: "dashscope",
    provider_voice_id: null,
    provider_status: "missing",
    target_model: "qwen3-tts-vd-2026-01-26",
    recommended_content_families: ["historical-story"],
    voice_traits: ["clear"],
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
    created_at: "2026-05-19T00:00:00.000Z",
    updated_at: "2026-05-19T00:00:00.000Z",
    ...overrides,
  };
}

describe("历史 JSON 一次性导入与归档（P2-3）", () => {
  it("Prisma 态：导入为 public 后归档 .imported；二次 seed 幂等且不再读 JSON", async () => {
    const root = mkdtempSync(join(tmpdir(), "voice-legacy-import-"));
    tempDirs.push(root);
    const dbPath = join(root, "test.db");
    const sqlite = new Database(dbPath);
    applyAllDatabaseMigrations(sqlite);
    sqlite.close();

    // 预写历史 JSON：仅含无归属字段的生成档案（legacy 形状）
    await saveVoiceProfileLibrary({
      rootDir: root,
      profiles: [legacyProfile("voice_generated_legacy_1")],
    });
    const jsonPath = join(root, "storage", "voice-profiles", "voice-profiles.json");
    expect(existsSync(jsonPath)).toBe(true);

    const client = await createPrismaClient(dbPath);
    const db: DbClient = createDbClient();
    configureVoiceProfilePersistence(db, { rootDir: root, prismaClient: client });
    try {
      await seedGlobalVoiceProfiles(db);

      // 历史档案导入为 public（无归属字段）
      const profiles = await listVoiceProfiles(db, {});
      const legacy = profiles.find((p) => p.voice_profile_id === "voice_generated_legacy_1");
      expect(legacy).toBeDefined();
      expect(legacy?.visibility).toBe("public");
      expect(legacy?.owner_id).toBeNull();
      // seed 档案同样就绪
      expect(profiles.some((p) => p.voice_profile_id === "voice_preset_cold_authority")).toBe(true);

      // 导入完成后 JSON 归档（.imported 保留原始数据；原文件不再存在）
      expect(existsSync(jsonPath)).toBe(false);
      expect(existsSync(`${jsonPath}.imported`)).toBe(true);

      // 二次 seed：幂等，不重复、不报错（此时已无 JSON 可读）
      await seedGlobalVoiceProfiles(db);
      const after = await listVoiceProfiles(db, {});
      const ids = after.map((p) => p.voice_profile_id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.filter((id) => id === "voice_generated_legacy_1")).toHaveLength(1);
    } finally {
      await client.$disconnect();
    }
  });
});
