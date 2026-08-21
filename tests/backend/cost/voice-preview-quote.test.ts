import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApp } from "../../../backend/src/app.js";
import { createProject } from "../../../backend/src/modules/projects/project.repository.js";
import {
  configureVoiceProfilePersistence,
  seedGlobalVoiceProfiles,
} from "../../../backend/src/modules/assets/voice/voice-profile.repository.js";
import { buildTestAuth } from "../auth/test-utils.js";
import { buildQuotableReadinessInput, seedQuotableCatalog } from "./quote-test-context.js";

/**
 * S2-2B 任务 6：voice.preview 报价 + 提交协议（详细设计 §6.3/§9.3）。
 * - 报价：operation=voice.preview，目标音色经 run_overrides.creative.voice_profile_id
 *   表达；计价含 tts_character（preview_text）与设计请求（missing 档案）。
 * - 付费部署无 quote 提交 → 409 paid_generation_quote_required。
 * - 提交执行：quote 消费、snapshot/run 创建、usage 落账、preview_audio_uri 回写；
 *   同幂等键重放返回同结果不重复计费。
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

describe("voice.preview 报价与提交", () => {
  it("报价成功：items 含 tts_character；提交执行后回写音频并落账；幂等重放同结果", async () => {
    const app = buildApp({ generationQuoteReadinessInput: buildQuotableReadinessInput() });
    const project = await createProject(app.db, { name: "Preview Quote", ownerId: "owner-1" });
    isolateVoiceRoot(app);
    await seedGlobalVoiceProfiles(app.db);
    await seedQuotableCatalog(app);

    const quoteRes = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/generation-cost-quotes`,
      payload: {
        operation: "voice.preview",
        run_overrides: {
          creative: { voice_profile_id: "voice_preset_cold_authority" },
        },
      },
      auth: ownerAuth,
    });
    expect(quoteRes.statusCode).toBe(200);
    const quote = quoteRes.json() as {
      quote_id: string;
      items: Array<{ capability: string; unit_type: string }>;
      estimated_cost_cny: string;
    };
    expect(quote.items.some((item) => item.unit_type === "tts_character")).toBe(true);
    // missing 档案含设计请求项（目录无 request 单价 → unbounded 标记）
    const designItem = quote.items.find((item) => item.unit_type === "request");
    if (designItem) {
      expect(designItem.capability).toBe("tts.synthesize");
    }

    const submit = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/voice-profiles/voice_preset_cold_authority/preview`,
      payload: {
        cost_quote_id: quote.quote_id,
        idempotency_key: "voice-preview-quote-1",
        authorize_budget_override: true,
        // 提交重放 quote 创建时的 run_overrides（既有协议：逐字段一致）
        run_overrides: {
          creative: { voice_profile_id: "voice_preset_cold_authority" },
        },
      },
      auth: ownerAuth,
    });
    expect(submit.statusCode).toBe(200);
    const body = submit.json() as { preview_audio_uri?: string; source?: string };
    expect(body.preview_audio_uri).toMatch(/^data:audio\/wav;base64,/);
    expect(body.source).toBe("generated");

    // quote 已消费；snapshot/run 已创建；usage 已落账
    const quoteRecord = [...app.db.generationCostQuotes.values()].find(
      (q) => q.id === quote.quote_id,
    );
    expect(quoteRecord?.consumedAt).not.toBeNull();
    expect(app.db.runConfigurationSnapshots.size).toBe(1);
    expect(app.db.generationRuns.size).toBe(1);
    expect(app.db.usageCostRecords.size).toBeGreaterThanOrEqual(1);

    // P1-1（外部审查）：usage 合成记录与报价/执行同源——默认 TTS 模型
    // （instruct-flash），目录可计价（estimated > 0），不因 target_model
    // 查不到目录而记 0 费用。
    const usageRecords = [...app.db.usageCostRecords.values()];
    const synthesisRecord = usageRecords.find((r) => r.unitType === "tts_character");
    expect(synthesisRecord).toBeDefined();
    expect(synthesisRecord?.modelId).toContain("qwen3-tts-instruct-flash");
    expect(BigInt(synthesisRecord?.estimatedCostMicros ?? "0")).toBeGreaterThan(0n);
    expect(synthesisRecord?.providerRequestKey).toContain("voice-preview:");

    // P2-2（外部审查）：付费试听成功写业务审计（与 fake 路径同 action）
    const previewAudits = [...app.db.auditLogs.values()].filter(
      (log) => log.action === "voice.profile_previewed",
    );
    expect(previewAudits.length).toBeGreaterThanOrEqual(1);
    expect(previewAudits[0]?.targetId).toBe("voice_preset_cold_authority");
    // 回写
    const profile = app.db.voiceProfiles.get("voice_preset_cold_authority");
    expect(profile?.preview_audio_uri).toMatch(/^data:audio\/wav;base64,/);

    // 幂等重放：同 key 同 payload → 返回同结果，不新增 usage
    const usageCount = app.db.usageCostRecords.size;
    const replay = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/voice-profiles/voice_preset_cold_authority/preview`,
      payload: {
        cost_quote_id: quote.quote_id,
        idempotency_key: "voice-preview-quote-1",
        authorize_budget_override: true,
        // 提交重放 quote 创建时的 run_overrides（既有协议：逐字段一致）
        run_overrides: {
          creative: { voice_profile_id: "voice_preset_cold_authority" },
        },
      },
      auth: ownerAuth,
    });
    expect(replay.statusCode).toBe(200);
    expect(app.db.usageCostRecords.size).toBe(usageCount);
  });

  it("付费部署下无 quote 提交 → 409 paid_generation_quote_required", async () => {
    for (const [key, value] of Object.entries({
      ALIYUN_DASHSCOPE_API_KEY: "test-key",
      ALIYUN_DASHSCOPE_BASE_URL: "https://dashscope.aliyuncs.com",
      ALIYUN_DASHSCOPE_TTS_MODEL: "qwen3-tts-instruct-flash",
    })) {
      vi.stubEnv(key, value);
    }
    const app = buildApp({ generationQuoteReadinessInput: buildQuotableReadinessInput() });
    const project = await createProject(app.db, { name: "Preview Gate", ownerId: "owner-1" });
    isolateVoiceRoot(app);
    await seedGlobalVoiceProfiles(app.db);
    await seedQuotableCatalog(app);

    const response = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/voice-profiles/voice_preset_cold_authority/preview`,
      payload: {},
      auth: ownerAuth,
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: "paid_generation_quote_required" });
  });

  it("run_overrides 未指定音色（auto）→ 报价解析失败（试听必须显式指定档案）", async () => {
    const app = buildApp({ generationQuoteReadinessInput: buildQuotableReadinessInput() });
    const project = await createProject(app.db, { name: "Preview Auto", ownerId: "owner-1" });
    isolateVoiceRoot(app);
    await seedGlobalVoiceProfiles(app.db);
    await seedQuotableCatalog(app);

    const quoteRes = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/generation-cost-quotes`,
      payload: { operation: "voice.preview" },
      auth: ownerAuth,
    });
    // auto 模式下试听无目标档案 → 报价被拒（不静默猜测试听对象）
    expect(quoteRes.statusCode).toBeGreaterThanOrEqual(400);
  });
});
