import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createDbClient, type DbClient } from "../../../backend/src/db/client.js";
import { createPrismaClient } from "../../../backend/src/db/prisma-client.js";
import { applyAllDatabaseMigrations } from "../db/migration-test-utils.js";
import Database from "better-sqlite3";
import { executeVoicePreview } from "../../../backend/src/modules/assets/voice/voice-preview.service.js";
import {
  getVoiceProfileById,
  recordVoiceProfileUsage,
  seedGlobalVoiceProfiles,
  updateVoiceProfileProviderState,
} from "../../../backend/src/modules/assets/voice/voice-profile.repository.js";
import {
  runVoicePreviewDispatch,
  appendVoicePreviewAudit,
} from "../../../backend/src/modules/assets/voice/voice-preview.service.js";
import {
  configureVoiceProfilePersistence,
  saveVoiceProfile,
  seedGlobalVoiceProfiles,
} from "../../../backend/src/modules/assets/voice/voice-profile.repository.js";
import type { VoiceProfile } from "../../../shared/src/index.js";

/**
 * S2-2B 复审整改专项测试：
 * - P1-2：试听 usage 的合成模型从运行快照恢复（报价冻结值），设计 usage
 *   归属档案 target_model（unpriced）。
 * - P2-1：业务审计经 thirdAggregateWriter.appendAuditLog 持久化。
 * - P2-2：seed 并发安全（upsert，不因并发 create 唯一键冲突）。
 */

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function mapDb(): DbClient {
  const rootDir = mkdtempSync(join(tmpdir(), "voice-review-"));
  tempDirs.push(rootDir);
  const db = createDbClient();
  configureVoiceProfilePersistence(db, { rootDir });
  return db;
}

function generatedProfile(id: string): VoiceProfile {
  return {
    voice_profile_id: id,
    kind: "generated",
    owner_id: null,
    name: "测试音色",
    description: "测试",
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
    created_at: "2026-08-21T00:00:00.000Z",
    updated_at: "2026-08-21T00:00:00.000Z",
  };
}

describe("P1-2：试听模型从快照恢复", () => {
  it("usage 合成记录使用快照冻结的 tts.synthesize 模型；设计记录归属 target_model", async () => {
    const db = mapDb();
    await seedGlobalVoiceProfiles(db);
    await saveVoiceProfile(db, generatedProfile("voice_generated_snapshot_1"));

    const now = new Date();
    const snapshot = {
      id: "snapshot-1",
      projectId: "proj-1",
      userId: "user-1",
      stage: "assets",
      operation: "voice.preview",
      runId: "run-1",
      projectConfigurationRevision: 1,
      schemaVersion: "resolved_generation_configuration_v1",
      configurationHash: "fnv1a64:0000000000000000",
      resolvedConfigurationJson: {
        resolved_capabilities: {
          "tts.synthesize": {
            mode: "auto",
            provider_model_id: "tts.synthesize.dashscope.cn-beijing.frozen-model",
            provider_key: "dashscope",
            model_id: "frozen-tts-model-x",
          },
        },
      },
      resolutionTraceJson: [],
      quoteId: "quote-1",
      quoteFingerprint: "sha256:" + "a".repeat(64),
      estimatedCostMicros: "1000",
      authorizationCostMicros: "2000",
      containsUnboundedItem: false,
      budgetLimitMicros: null,
      budgetOverrideAuthorized: true,
      pricingVersionSetJson: ["v-test"],
      pricingHash: "sha256:" + "b".repeat(64),
      createdAt: now,
      updatedAt: now,
    };
    const run = {
      id: "run-1",
      projectId: "proj-1",
      userId: "user-1",
      operation: "voice.preview",
      idempotencyKey: "key-1",
      payloadFingerprint: "fp",
      quoteId: "quote-1",
      runConfigurationSnapshotId: "snapshot-1",
      dispatchPayloadJson: { voice_profile_id: "voice_generated_snapshot_1" },
      status: "pending_dispatch" as const,
      dispatchLeaseOwner: null,
      dispatchLeaseExpiresAt: null,
      dispatchClaimCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    db.runConfigurationSnapshots.set("snapshot-1", snapshot as never);
    db.generationRuns.set("run-1", run as never);

    // fake 本地路径（无凭据）：usage 归因仍用快照冻结模型
    const outcome = await runVoicePreviewDispatch({
      db,
      run: run as never,
      snapshot: snapshot as never,
      voiceProfileId: "voice_generated_snapshot_1",
    });
    expect(outcome.status).toBe("succeeded");

    const usageRecords = [...db.usageCostRecords.values()];
    // 合成记录：快照冻结模型
    const synthesis = usageRecords.find((r) => r.unitType === "tts_character");
    expect(synthesis?.modelId).toBe("frozen-tts-model-x");
    // 设计记录（missing 档案）：实际设计模型 target_model，unpriced（estimated 0）
    const design = usageRecords.find((r) => r.unitType === "request");
    expect(design?.modelId).toBe("qwen3-tts-vd-2026-01-26");
    expect(design?.estimatedCostMicros).toBe("0");
  });
});

describe("P2-1：试听审计持久化", () => {
  it("appendAuditLog writer 被调用（Prisma 态写 AuditLog 表）且内存镜像同步", async () => {
    const db = mapDb();
    const persisted: Array<Record<string, unknown>> = [];
    db.thirdAggregateWriter = {
      saveUsageCostRecord: async () => undefined,
      appendAuditLog: async (input) => {
        persisted.push({ ...input });
      },
    } as never;

    await appendVoicePreviewAudit(db, {
      actorUserId: "user-1",
      projectId: "proj-1",
      voiceProfileId: "voice_preset_cold_authority",
      metadata: { source: "generated", used_real_provider: false },
    });

    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({
      action: "voice.profile_previewed",
      targetType: "voice_profile",
      targetId: "voice_preset_cold_authority",
    });
    // 内存镜像同步（Map 态测试可见）
    const mirror = [...db.auditLogs.values()].find(
      (log) => log.action === "voice.profile_previewed",
    );
    expect(mirror?.targetId).toBe("voice_preset_cold_authority");
  });
});

describe("P2-2：seed 并发安全（Map 态并发不抛错、结果唯一）", () => {
  it("并发 seedGlobalVoiceProfiles 不产生重复/错误", async () => {
    const db = mapDb();
    await Promise.all([
      seedGlobalVoiceProfiles(db),
      seedGlobalVoiceProfiles(db),
      seedGlobalVoiceProfiles(db),
    ]);
    const ids = [...db.voiceProfiles.keys()];
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("voice_preset_cold_authority");
  });
});

describe("三审 P1：Prisma 态 seed 不覆盖运行态 + 连续试听 generated → cached", () => {
  function createPrismaDb(): { db: DbClient; disconnect: () => Promise<void> } {
    const root = mkdtempSync(join(tmpdir(), "voice-seed-regression-"));
    tempDirs.push(root);
    const dbPath = join(root, "test.db");
    const sqlite = new Database(dbPath);
    applyAllDatabaseMigrations(sqlite);
    sqlite.close();
    // 异步初始化在测试内完成
    let client: Awaited<ReturnType<typeof createPrismaClient>> | null = null;
    const db = createDbClient();
    configureVoiceProfilePersistence(db, { rootDir: root });
    return {
      db,
      disconnect: async () => {
        await client?.$disconnect();
      },
      // 延迟绑定 prisma client（需 await createPrismaClient）
      bind: async () => {
        client = await createPrismaClient(dbPath);
        configureVoiceProfilePersistence(db, { rootDir: root, prismaClient: client });
      },
    } as { db: DbClient; disconnect: () => Promise<void>; bind: () => Promise<void> };
  }

  it("重复 seed 不覆盖 ready/provider voice/preview 缓存/usage", async () => {
    const harness = createPrismaDb();
    try {
      await harness.bind();
      const db = harness.db;
      await seedGlobalVoiceProfiles(db);

      // 模拟运行态演进：设计完成（ready + provider voice）+ 试听缓存 + 使用计数
      await updateVoiceProfileProviderState(db, "voice_preset_cold_authority", {
        provider_status: "ready",
        provider_voice_id: "provider-ready-review",
        preview_audio_uri: "data:audio/wav;base64,Y2FjaGVk",
      });
      await recordVoiceProfileUsage(db, "voice_preset_cold_authority", "2026-08-21T10:00:00.000Z");

      // 重复 seed（route 级幂等 seed 会随每次列表/试听请求执行）
      await seedGlobalVoiceProfiles(db);
      await seedGlobalVoiceProfiles(db);

      const profile = await getVoiceProfileById(db, "voice_preset_cold_authority");
      expect(profile?.provider_status).toBe("ready");
      expect(profile?.provider_voice_id).toBe("provider-ready-review");
      expect(profile?.preview_audio_uri).toBe("data:audio/wav;base64,Y2FjaGVk");
      expect(profile?.usage_count).toBe(1);
    } finally {
      await harness.disconnect();
    }
  });

  it("Prisma 态连续试听 generated → cached（中间重复 seed 不重置缓存）", async () => {
    const harness = createPrismaDb();
    try {
      await harness.bind();
      const db = harness.db;
      await seedGlobalVoiceProfiles(db);

      const first = await executeVoicePreview({
        db,
        voiceProfileId: "voice_preset_cold_authority",
      });
      expect(first.source).toBe("generated");
      expect(first.preview_audio_uri).toMatch(/^data:audio\/wav;base64,/);

      // 中间再次 seed（模拟列表请求触发的幂等 seed）——不得清掉试听缓存
      await seedGlobalVoiceProfiles(db);

      const second = await executeVoicePreview({
        db,
        voiceProfileId: "voice_preset_cold_authority",
      });
      expect(second.source).toBe("cached");
      expect(second.preview_audio_uri).toBe(first.preview_audio_uri);
    } finally {
      await harness.disconnect();
    }
  });
});
