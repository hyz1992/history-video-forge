import { afterEach, describe, expect, it, vi } from "vitest";

import { createDbClient } from "../../../backend/src/db/client.js";
import type { DbClient } from "../../../backend/src/db/client.js";
import { buildProviderRegistry } from "../../../backend/src/modules/assets/assets-run.service.js";
import { checkProviderDispatchGate } from "../../../backend/src/modules/generation-cost/provider-dispatch-gate.js";
import { buildPricingCatalogSeed } from "../../../backend/src/modules/generation-cost/pricing-catalog.seed.js";

/**
 * S2-2A 任务 7 二次重开（codex P1-A）：真实付费 provider 派发闸门测试。
 *
 * codex 反例：测试环境（凭据已注入）+ 空 catalog 下，旧实现仍会注册真实视频
 * adapter 并调用 provider。整改后：目录为空/条目 disabled/模型失配一律 fail-closed，
 * 不注册 adapter（执行引擎 no-adapter 路径 → 不创建外部调用、不 fetch）。
 */

const DASHSCOPE_ENV: Record<string, string> = {
  ALIYUN_DASHSCOPE_API_KEY: "test-key",
  ALIYUN_DASHSCOPE_BASE_URL: "https://dashscope.aliyuncs.com",
  ALIYUN_DASHSCOPE_TEXT_TO_IMAGE_MODEL: "wan2.6-t2i",
  ALIYUN_DASHSCOPE_TTS_MODEL: "qwen3-tts-instruct-flash",
  ALIYUN_DASHSCOPE_IMAGE_TO_VIDEO_MODEL: "wan2.7-i2v-2026-04-25",
};

function injectDashscopeEnv() {
  for (const [key, value] of Object.entries(DASHSCOPE_ENV)) {
    vi.stubEnv(key, value);
  }
}

/** 与 DASHSCOPE_ENV 一致的北京 catalog（真实 bootstrap 会产出同等行）。 */
function seedDashscopeCatalog(db: DbClient, options?: { disableVideo?: boolean; overrideVideoModel?: string }) {
  const seed = buildPricingCatalogSeed({
    llm: { mode: "stub" },
    media: { deploymentScope: "cn-beijing" },
  });
  for (let entry of seed) {
    if (entry.capability === "video.image_to_video") {
      if (options?.disableVideo) entry = { ...entry, status: "disabled" };
      if (options?.overrideVideoModel) entry = { ...entry, modelId: options.overrideVideoModel };
    }
    db.providerModelCatalog.set(entry.id, entry);
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("provider dispatch gate", () => {
  it("blocks real dashscope adapters when the catalog is empty (codex counter-example)", () => {
    injectDashscopeEnv();
    const db = createDbClient();
    // 空 catalog（bootstrap 未运行）：三个真实付费 capability 全部 fail-closed。
    const registry = buildProviderRegistry({ db });
    expect(
      registry.findAdapter({ taskType: "video_clip", enabledProviderTypes: ["video"] }),
    ).toBeNull();
    expect(
      registry.findAdapter({ taskType: "image_still", enabledProviderTypes: ["image"] }),
    ).toBeNull();
    expect(
      registry.findAdapter({ taskType: "tts_audio", enabledProviderTypes: ["tts"] }),
    ).toBeNull();
  });

  it("registers real dashscope adapters when the catalog rows are active and matching", () => {
    injectDashscopeEnv();
    const db = createDbClient();
    seedDashscopeCatalog(db);
    const registry = buildProviderRegistry({ db });
    expect(
      registry.findAdapter({ taskType: "video_clip", enabledProviderTypes: ["video"] }),
    ).not.toBeNull();
    expect(
      registry.findAdapter({ taskType: "image_still", enabledProviderTypes: ["image"] }),
    ).not.toBeNull();
    expect(
      registry.findAdapter({ taskType: "tts_audio", enabledProviderTypes: ["tts"] }),
    ).not.toBeNull();
  });

  it("blocks only the gated capability when a catalog row is disabled", () => {
    injectDashscopeEnv();
    const db = createDbClient();
    seedDashscopeCatalog(db, { disableVideo: true });
    const registry = buildProviderRegistry({ db });
    expect(
      registry.findAdapter({ taskType: "video_clip", enabledProviderTypes: ["video"] }),
    ).toBeNull();
    expect(
      registry.findAdapter({ taskType: "image_still", enabledProviderTypes: ["image"] }),
    ).not.toBeNull();
  });

  it("blocks dispatch when the catalog row no longer matches the actual model", () => {
    injectDashscopeEnv();
    const db = createDbClient();
    // 目录视频行被换成另一个模型：实际执行模型（wan2.7-i2v-2026-04-25）失配 → 拒绝。
    seedDashscopeCatalog(db, { overrideVideoModel: "wan2.7-i2v-someone-else" });
    const registry = buildProviderRegistry({ db });
    expect(
      registry.findAdapter({ taskType: "video_clip", enabledProviderTypes: ["video"] }),
    ).toBeNull();
  });

  it("reports structured gate decisions without secrets or env var names", () => {
    const db = createDbClient();
    const decision = checkProviderDispatchGate(db, {
      capability: "video.image_to_video",
      providerKey: "dashscope",
      modelId: "wan2.7-i2v-2026-04-25",
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason_code).toBe("catalog_entry_missing");
      const serialized = JSON.stringify(decision);
      expect(serialized).not.toContain("ALIYUN_DASHSCOPE_API_KEY");
      expect(serialized).not.toContain("apiKeyEnv");
    }
  });
});
