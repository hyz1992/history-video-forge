import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../../../backend/src/app.js";
import { createLegacyProject as createProject } from "../projects/legacy-project.fixture.js";
import {
  configureVoiceProfilePersistence,
  seedGlobalVoiceProfiles,
} from "../../../backend/src/modules/assets/voice/voice-profile.repository.js";
import { buildTestAuth } from "../auth/test-utils.js";

/**
 * 2026-08-23（报价体系移除）：voice.preview 恢复免 quote 直连执行——
 * cached 零费用直接返回；本地合成回写音频并写审计；不建 run/不记账
 * （登记已知限制：试听费用不入项目成本清单）。
 */

const ownerAuth = buildTestAuth({ userId: "owner-1" });
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** 隔离音色库持久化（不落仓库 storage）。 */
function isolateVoiceRoot(app: ReturnType<typeof buildApp>): void {
  const rootDir = mkdtempSync(join(tmpdir(), "voice-preview-quote-"));
  tempDirs.push(rootDir);
  configureVoiceProfilePersistence(app.db, { rootDir });
}

describe("voice.preview 直连执行（2026-08-23）", () => {
  it("直连 preview：本地合成回写音频并写审计；不建 run/不记账", async () => {
    const app = buildApp();
    const project = await createProject(app.db, { name: "Preview Direct", ownerId: "owner-1" });
    isolateVoiceRoot(app);
    await seedGlobalVoiceProfiles(app.db);

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/voice-profiles/voice_preset_cold_authority/preview`,
      payload: {},
      auth: ownerAuth,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { preview_audio_uri?: string; source?: string };
    expect(body.preview_audio_uri).toMatch(/^data:audio\/wav;base64,/);
    expect(body.source).toBe("generated");

    // 业务审计留痕（与 quote 时代同 action）
    const previewAudits = [...app.db.auditLogs.values()].filter(
      (log) => log.action === "voice.profile_previewed",
    );
    expect(previewAudits.length).toBeGreaterThanOrEqual(1);
    expect(previewAudits[0]?.targetId).toBe("voice_preset_cold_authority");

    // 回写
    const profile = app.db.voiceProfiles.get("voice_preset_cold_authority");
    expect(profile?.preview_audio_uri).toMatch(/^data:audio\/wav;base64,/);

    // 直连执行不建 run/快照/usage（无计费上下文）
    expect(app.db.generationRuns.size).toBe(0);
    expect(app.db.runConfigurationSnapshots.size).toBe(0);
    expect(app.db.usageCostRecords.size).toBe(0);
  });
});
