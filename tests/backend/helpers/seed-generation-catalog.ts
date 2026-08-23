import type { AppInstance } from "../../../backend/src/app.js";

/**
 * 2026-08-23（报价体系移除）：生成 API 统一走 run 提交协议，提交解析要求
 * providerModelCatalog 存在每 capability 恰好一个 active 默认项。
 * 测试环境不运行启动 bootstrap，调用生成 API 的测试必须先 seed 本目录，
 * 否则提交解析返回 generation_run_resolution_failed。
 * 与 storyboard 快照同源：resolver 需要每 capability 一个 active 默认项才能成功解析。
 */
export function seedGenerationCatalog(app: AppInstance): void {
  const now = new Date();
  const catalogSeed: Array<[string, string]> = [
    ["llm.smart", "dashscope.qwen-max"],
    ["llm.flash", "dashscope.qwen-flash"],
    ["image.generate", "dashscope.wanx-v1"],
    ["video.image_to_video", "dashscope.video-v1"],
    ["tts.synthesize", "dashscope.tts"],
  ];
  for (const [capability, id] of catalogSeed) {
    app.db.providerModelCatalog.set(id, {
      id,
      capability: capability as never,
      providerKey: "dashscope",
      modelId: id,
      modelVersion: null,
      displayName: id,
      qualityTier: null,
      speedTier: null,
      parameterCapabilitiesJson: {},
      pricingVersion: "v1",
      pricingJson: { bounded: true },
      status: "active",
      isDefault: true,
      createdAt: now,
      updatedAt: now,
    });
  }
}
