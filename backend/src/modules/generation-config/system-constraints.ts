import type { SystemGenerationConstraints } from "../../../../shared/src/index.js";

/**
 * S2-2A 真实系统约束的单一来源（任务 4 整改，详细设计 5.1 节）。
 *
 * 当前真实约束来源：demo/测试态（DEMO_MODE）禁用真实视频 provider——
 * demo 环境不得触发真实付费视频 API，因此 apiVideoProviderEnabled=false。
 * 任务 7 readiness 落地后，此处将叠加 catalog active 项与凭据健康度。
 * 快照投影与 PATCH 路由都必须使用本文件，禁止各自硬编码。
 */
export function resolveSystemGenerationConstraints(
  demoMode: boolean,
): SystemGenerationConstraints {
  return {
    apiVideoProviderEnabled: !demoMode,
  };
}

/**
 * 统一的 reason_code → 不可用原因映射（任务 4 第三轮整改）。
 *
 * resolver 在系统约束降级时正常返回 ok=true 且 reason_code 为
 * api_video_provider_disabled；此时 UI 必须展示降级原因，不能把
 * unavailable_reason 置空。正常策略选择（remotion 矩阵 / 用户覆盖）不产生
 * 不可用原因。
 */
export function unavailableReasonFromRoute(reasonCode: string): string | null {
  switch (reasonCode) {
    case "api_video_provider_disabled":
      return "演示/测试态已禁用真实视频 API，已自动降级为 Remotion";
    case "strategy_matrix_remotion":
    case "strategy_matrix_api_video":
    case "segment_override_remotion":
    case "segment_override_api_video":
      // 正常策略或覆盖选择，不是降级
      return null;
    default:
      // 未知 reason_code（如配置/目录解析异常路径）保留中性提示
      return "路线解析受限，暂按 Remotion 预览";
  }
}
