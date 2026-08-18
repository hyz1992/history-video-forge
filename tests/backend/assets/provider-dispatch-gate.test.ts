import { afterEach, describe, expect, it, vi } from "vitest";

import { createDbClient } from "../../../backend/src/db/client.js";
import type { DbClient } from "../../../backend/src/db/client.js";
import { buildProviderRegistry, readDashscopeConfig } from "../../../backend/src/modules/assets/assets-run.service.js";
import { checkProviderDispatchGate } from "../../../backend/src/modules/generation-cost/provider-dispatch-gate.js";
import { resolveDashscopeDeploymentScope } from "../../../backend/src/modules/generation-cost/pricing-catalog.seed.js";
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

  it("allows the current active scope row even when an old-scope disabled row exists", () => {
    // codex 三审 I-1 复现：北京行 disabled + 新加坡行 active（切区后旧行保留），
    // 请求新加坡必须放行，不能被先遇到的 disabled 行抢先拒绝。
    const db = createDbClient();
    const seed = buildPricingCatalogSeed({
      llm: { mode: "stub" },
      media: { deploymentScope: "cn-beijing" },
    });
    const video = seed.find((e) => e.capability === "video.image_to_video")!;
    const beijingRow = { ...video, status: "disabled" as const, isDefault: false };
    const singaporeRow = {
      ...video,
      id: "video.image_to_video.dashscope.singapore.wan2.7-i2v-2026-04-25",
      parameterCapabilitiesJson: { ...video.parameterCapabilitiesJson, deployment_scope: "singapore" },
    };
    // 故意让 disabled 北京行先插入（Map 顺序反排），验证扫描全候选而非首个匹配。
    db.providerModelCatalog.set(beijingRow.id, beijingRow);
    db.providerModelCatalog.set(singaporeRow.id, singaporeRow);

    const decision = checkProviderDispatchGate(db, {
      capability: "video.image_to_video",
      providerKey: "dashscope",
      modelId: "wan2.7-i2v-2026-04-25",
      deploymentScope: "singapore",
    });
    expect(decision.allowed).toBe(true);
  });

  it("still denies when only an old-scope disabled row exists", () => {
    const db = createDbClient();
    const seed = buildPricingCatalogSeed({
      llm: { mode: "stub" },
      media: { deploymentScope: "cn-beijing" },
    });
    const video = seed.find((e) => e.capability === "video.image_to_video")!;
    db.providerModelCatalog.set(video.id, { ...video, status: "disabled", isDefault: false });

    const decision = checkProviderDispatchGate(db, {
      capability: "video.image_to_video",
      providerKey: "dashscope",
      modelId: "wan2.7-i2v-2026-04-25",
      deploymentScope: "singapore",
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason_code).toBe("catalog_entry_disabled");
    }
  });

  it("blocks dispatch when the catalog row declares a different deployment scope", () => {
    injectDashscopeEnv();
    const db = createDbClient();
    seedDashscopeCatalog(db);
    // 目录行声明 cn-beijing，gate 被注入 singapore 运行区域 → 拒绝。
    const decision = checkProviderDispatchGate(db, {
      capability: "video.image_to_video",
      providerKey: "dashscope",
      modelId: "wan2.7-i2v-2026-04-25",
      deploymentScope: "singapore",
    });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason_code).toBe("catalog_entry_scope_mismatch");
    }
  });

  it("resolves deployment scope from exact https hostnames only and fails closed otherwise", () => {
    expect(resolveDashscopeDeploymentScope(undefined)).toBe("cn-beijing");
    expect(resolveDashscopeDeploymentScope("https://dashscope.aliyuncs.com/api/v1")).toBe("cn-beijing");
    expect(resolveDashscopeDeploymentScope("https://dashscope-intl.aliyuncs.com")).toBe("singapore");
    // 含 aliyuncs 子串的私有代理域名不得误判为已知区域（精确主机匹配）。
    expect(resolveDashscopeDeploymentScope("https://dashscope.aliyuncs.com.evil.example")).toBe("unknown");
    expect(resolveDashscopeDeploymentScope("https://private.example.com")).toBe("unknown");
    expect(resolveDashscopeDeploymentScope("not-a-url")).toBe("unknown");
    // codex 三审 I-2：非 https / 非标准端口必须 fail-closed（防 Bearer key 明文传输）。
    expect(resolveDashscopeDeploymentScope("http://dashscope.aliyuncs.com")).toBe("unknown");
    expect(resolveDashscopeDeploymentScope("ftp://dashscope-intl.aliyuncs.com")).toBe("unknown");
    expect(resolveDashscopeDeploymentScope("https://dashscope.aliyuncs.com:8443")).toBe("unknown");
    expect(resolveDashscopeDeploymentScope("https://dashscope-intl.aliyuncs.com:8080")).toBe("unknown");
    // 显式 443 端口仍是合法 https。
    expect(resolveDashscopeDeploymentScope("https://dashscope.aliyuncs.com:443")).toBe("cn-beijing");
    // codex 四审 I-1：显式空字符串是畸形 endpoint（adapter 会保留并拼相对路径），
    // 必须 unknown fail-closed，而不是当成"未配置"的北京默认。
    expect(resolveDashscopeDeploymentScope("")).toBe("unknown");
    expect(resolveDashscopeDeploymentScope("   ")).toBe("unknown");
  });

  it("normalizes an empty base url to undefined so adapter, catalog and gate share the default beijing endpoint", () => {
    // codex 四审 I-1 反例转正：ALIYUN_DASHSCOPE_BASE_URL="" 时，
    // readDashscopeConfig 归一化为 undefined → adapter 用默认 https 北京地址，
    // 目录（北京 active）与真实 adapter 配置一致 → 正常注册，不再拼相对路径。
    vi.stubEnv("ALIYUN_DASHSCOPE_API_KEY", "test-key");
    vi.stubEnv("ALIYUN_DASHSCOPE_BASE_URL", "");
    const config = readDashscopeConfig(undefined);
    expect(config.baseUrl).toBeUndefined();
    expect(resolveDashscopeDeploymentScope(config.baseUrl)).toBe("cn-beijing");

    const db = createDbClient();
    seedDashscopeCatalog(db);
    const registry = buildProviderRegistry({ db });
    expect(
      registry.findAdapter({ taskType: "video_clip", enabledProviderTypes: ["video"] }),
    ).not.toBeNull();
    expect(
      registry.findAdapter({ taskType: "image_still", enabledProviderTypes: ["image"] }),
    ).not.toBeNull();
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
