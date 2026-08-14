import type { SystemGenerationConstraints } from "../../../../shared/src/index.js";

/**
 * S2-2A 真实系统约束的单一来源（任务 4 整改，详细设计 5.1 节）。
 *
 * 当前真实约束来源：demo/测试态（DEMO_MODE）禁用真实视频 provider——
 * demo 环境不得触发真实付费视频 API，因此 apiVideoProviderEnabled=false。
 * 任务 7 readiness 落地后，此处将叠加 catalog active 项与凭据健康度。
 * 快照投影与 PATCH 路由都必须使用本函数，禁止各自硬编码。
 */
export function resolveSystemGenerationConstraints(
  demoMode: boolean,
): SystemGenerationConstraints {
  return {
    apiVideoProviderEnabled: !demoMode,
  };
}
