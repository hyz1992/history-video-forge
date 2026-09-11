import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createDbClient } from "../../../backend/src/db/client.js";
import {
  configureVoiceProfilePersistence,
  listVoiceProfiles,
  loadPersistedVoiceProfiles,
  saveVoiceProfile,
  seedGlobalVoiceProfiles,
  updateVoiceProfileProviderState,
} from "../../../backend/src/modules/assets/voice/voice-profile.repository.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
  );
  tempDirs.length = 0;
});

async function makeTempRoot() {
  const root = await mkdtemp(join(tmpdir(), "voice-profile-repository-"));
  tempDirs.push(root);
  return root;
}

describe("global voice profile repository", () => {
  it("seeds four shared presets plus two system voices（含口播前置 WS 音色）", async () => {
    const db = createDbClient();
    // 隔离空根目录：避免读到开发机真实 storage 的 JSON 音色库，保证确定性
    // （此前依赖 cwd 真实库，含历史导入音色时该用例结果随环境漂移）。
    configureVoiceProfilePersistence(db, { rootDir: await makeTempRoot() });

    await seedGlobalVoiceProfiles(db);
    await seedGlobalVoiceProfiles(db);

    const profiles = await listVoiceProfiles(db);
    expect(profiles.map((item) => item.voice_profile_id)).toEqual([
      "voice_preset_cold_authority",
      "voice_preset_steady_documentary",
      "voice_preset_crisp_storyteller",
      "voice_preset_eerie_suspense",
      "voice_system_ethan",
      "voice_narration_qwen_longyimuling",
    ]);
  });

  it("S2-2B：生成的档案默认归属保存者私有（可见性同源授权）", async () => {
    const db = createDbClient();

    await seedGlobalVoiceProfiles(db);
    await saveVoiceProfile(db, {
      voice_profile_id: "voice_generated_test",
      kind: "generated",
      name: "测试音色",
      description: "测试用全局音色",
      design_prompt:
        "30 到 40 岁中性旁白声线，中音，吐字清晰，语速中等，适合测试。避免夸张表演。",
      preview_text: "这是一段测试音色的预览文本。",
      provider_name: "dashscope",
      provider_voice_id: null,
      provider_status: "missing",
      target_model: "qwen3-tts-vd-2026-01-26",
      recommended_content_families: ["test"],
      voice_traits: ["clear"],
      avoid_traits: ["overacting"],
      gender_tone: "neutral",
      age_band: "30-40",
      pitch: "mid",
      pace: "medium",
      energy: 0.5,
      authority: 0.5,
      suspense: 0.2,
      warmth: 0.4,
      preview_audio_uri: null,
      usage_count: 0,
      last_used_at: null,
      quality_score: null,
      created_at: "2026-05-19T00:00:00.000Z",
      updated_at: "2026-05-19T00:00:00.000Z",
      owner_id: "user_creator",
    });

    // 无 scope 的列表只返回公共档案（详细设计 §6.4：fail-closed）
    const publicOnly = await listVoiceProfiles(db);
    expect(
      publicOnly.some((item) => item.voice_profile_id === "voice_generated_test"),
    ).toBe(false);

    // 保存者 scope 可见
    const forCreator = await listVoiceProfiles(db, { ownerId: "user_creator" });
    expect(
      forCreator.some((item) => item.voice_profile_id === "voice_generated_test"),
    ).toBe(true);
  });

  it("does not overwrite a ready provider voice when seeding presets", async () => {
    const rootDir = await makeTempRoot();
    const db = createDbClient();
    configureVoiceProfilePersistence(db, { rootDir });

    await seedGlobalVoiceProfiles(db);
    await updateVoiceProfileProviderState(db, "voice_preset_cold_authority", {
      provider_status: "ready",
      provider_voice_id: "provider-voice-ready-001",
      preview_audio_uri: "data:audio/wav;base64,cHJldmlldw==",
    });

    const nextDb = createDbClient();
    configureVoiceProfilePersistence(nextDb, { rootDir });
    await loadPersistedVoiceProfiles(nextDb);
    await seedGlobalVoiceProfiles(nextDb);

    expect(nextDb.voiceProfiles.get("voice_preset_cold_authority")).toMatchObject({
      provider_status: "ready",
      provider_voice_id: "provider-voice-ready-001",
      preview_audio_uri: "data:audio/wav;base64,cHJldmlldw==",
    });
  });

  it("persists generated voice profiles across DbClient instances", async () => {
    const rootDir = await makeTempRoot();
    const db = createDbClient();
    configureVoiceProfilePersistence(db, { rootDir });
    await seedGlobalVoiceProfiles(db);
    await saveVoiceProfile(db, {
      voice_profile_id: "voice_generated_persistent",
      kind: "generated",
      name: "持久化测试音色",
      description: "用于测试跨 DbClient 复用",
      design_prompt:
        "30 到 40 岁中性旁白声线，中音，吐字清晰，语速中等。避免夸张表演。",
      preview_text: "这是一段测试音色的预览文本。",
      provider_name: "dashscope",
      provider_voice_id: null,
      provider_status: "missing",
      target_model: "qwen3-tts-vd-2026-01-26",
      recommended_content_families: ["test"],
      voice_traits: ["clear"],
      avoid_traits: ["overacting"],
      gender_tone: "neutral",
      age_band: "30-40",
      pitch: "mid",
      pace: "medium",
      energy: 0.5,
      authority: 0.5,
      suspense: 0.2,
      warmth: 0.4,
      preview_audio_uri: null,
      usage_count: 0,
      last_used_at: null,
      quality_score: null,
      created_at: "2026-05-19T00:00:00.000Z",
      updated_at: "2026-05-19T00:00:00.000Z",
    });

    const nextDb = createDbClient();
    configureVoiceProfilePersistence(nextDb, { rootDir });
    await loadPersistedVoiceProfiles(nextDb);

    expect(nextDb.voiceProfiles.has("voice_generated_persistent")).toBe(true);
  });
});
