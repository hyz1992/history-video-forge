import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../../../backend/src/app.js";
import { createProject } from "../../../backend/src/modules/projects/project.repository.js";
import {
  configureVoiceProfilePersistence,
  saveVoiceProfile,
  seedGlobalVoiceProfiles,
} from "../../../backend/src/modules/assets/voice/voice-profile.repository.js";
import type { VoiceProfile } from "../../../shared/src/index.js";
import { buildTestAuth } from "../auth/test-utils.js";

/**
 * S2-2B 任务 6：音色目录与试听 API（详细设计 §6.3/§9.2/§9.3）。
 * 可见性同源授权：公共 + 本人私有；试听端点为项目级（quote 协议 project-scoped）。
 */

function makeGenerated(overrides: Partial<VoiceProfile> = {}): VoiceProfile {
  return {
    voice_profile_id: "voice_generated_owner_1",
    kind: "generated",
    name: "本人生成音色",
    description: "测试",
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

const ownerAuth = buildTestAuth({ userId: "owner-1" });
const otherAuth = buildTestAuth({ userId: "other-1" });
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** 隔离音色库持久化（Map 态 JSON 写穿不落仓库 storage）。 */
function isolateVoiceRoot(app: ReturnType<typeof buildApp>): void {
  const rootDir = mkdtempSync(join(tmpdir(), "voice-profiles-api-"));
  tempDirs.push(rootDir);
  configureVoiceProfilePersistence(app.db, { rootDir });
}

describe("GET /api/me/voice-profiles", () => {
  it("返回公共档案与本人私有档案；其他用户私有档案不可见；无凭据字段", async () => {
    const app = buildApp();
    isolateVoiceRoot(app);
    await seedGlobalVoiceProfiles(app.db);
    await saveVoiceProfile(app.db, makeGenerated({ owner_id: "owner-1" }));
    await saveVoiceProfile(
      app.db,
      makeGenerated({ voice_profile_id: "voice_generated_other_1", owner_id: "other-1" }),
    );

    const response = await app.inject({
      method: "GET",
      url: "/api/me/voice-profiles",
      auth: ownerAuth,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { profiles: Array<Record<string, unknown>> };
    const ids = body.profiles.map((p) => p.voice_profile_id);
    expect(ids).toContain("voice_preset_cold_authority"); // 公共 seed
    expect(ids).toContain("voice_generated_owner_1"); // 本人私有
    expect(ids).not.toContain("voice_generated_other_1"); // 他人私有
    // 无凭据类字段
    const sample = body.profiles[0]!;
    expect(sample).not.toHaveProperty("provider_voice_id");
    expect(JSON.stringify(body)).not.toContain("api_key");
    expect(JSON.stringify(body)).not.toContain("secret");
  });
});

describe("POST /api/projects/:projectId/voice-profiles/:id/preview（fake 本地路径）", () => {
  it("无缓存 → 合成音频返回并回写 preview_audio_uri；二次请求直接 cached", async () => {
    const app = buildApp();
    isolateVoiceRoot(app);
    const project = await createProject(app.db, { name: "Preview", ownerId: "owner-1" });
    await seedGlobalVoiceProfiles(app.db);

    const first = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/voice-profiles/voice_preset_cold_authority/preview`,
      payload: {},
      auth: ownerAuth,
    });
    expect(first.statusCode).toBe(200);
    const firstBody = first.json() as { preview_audio_uri?: string; source?: string };
    expect(firstBody.source).toBe("generated");
    expect(firstBody.preview_audio_uri).toMatch(/^data:audio\/wav;base64,/);

    // 回写后二次请求 cached（零费用）
    const second = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/voice-profiles/voice_preset_cold_authority/preview`,
      payload: {},
      auth: ownerAuth,
    });
    expect(second.statusCode).toBe(200);
    expect((second.json() as { source?: string }).source).toBe("cached");
  });

  it("档案不存在/不可见 → 404", async () => {
    const app = buildApp();
    isolateVoiceRoot(app);
    const project = await createProject(app.db, { name: "Preview", ownerId: "owner-1" });
    await seedGlobalVoiceProfiles(app.db);
    await saveVoiceProfile(app.db, makeGenerated({ owner_id: "other-1" }));

    const missing = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/voice-profiles/voice_nope/preview`,
      payload: {},
      auth: ownerAuth,
    });
    expect(missing.statusCode).toBe(404);

    // 他人私有档案按不存在处理
    const invisible = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/voice-profiles/voice_generated_owner_1/preview`,
      payload: {},
      auth: ownerAuth,
    });
    expect(invisible.statusCode).toBe(404);
  });

  it("非 owner 访问项目级试听被拒（guardOwnedRoute 语义：不泄露存在性 → 404）", async () => {
    const app = buildApp();
    isolateVoiceRoot(app);
    const project = await createProject(app.db, { name: "Preview", ownerId: "owner-1" });
    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/voice-profiles/voice_preset_cold_authority/preview`,
      payload: {},
      auth: otherAuth,
    });
    expect(response.statusCode).toBe(404);
  });
});
