import type { ProjectRecord } from "../db/client.js";

const STATUS_STAGE_ORDER = [
  "topic",
  "script",
  "storyboard",
  "asset_plan",
  "asset",
  "compose",
  "render",
] as const;

type StageKey = (typeof STATUS_STAGE_ORDER)[number];

const STAGE_GATE_MAP: Array<{ stageMax: StageKey; gateLabel: string }> = [
  { stageMax: "topic", gateLabel: "选题" },
  { stageMax: "script", gateLabel: "文案" },
  { stageMax: "storyboard", gateLabel: "分镜" },
  { stageMax: "asset_plan", gateLabel: "资产规划" },
  { stageMax: "asset", gateLabel: "资产生成" },
  { stageMax: "compose", gateLabel: "合成" },
  { stageMax: "render", gateLabel: "渲染" },
];

function getStatusStageIndex(status: string): number {
  const idx = STATUS_STAGE_ORDER.findIndex((s) => status.startsWith(s));
  return idx >= 0 ? idx : 0;
}

/**
 * In demo mode, if the project has already progressed beyond the gate stage,
 * return an error response. Otherwise return null.
 */
export function checkDemoStageRollback(project: ProjectRecord, gateLabel: string): { statusCode: number; body: Record<string, unknown> } | null {
  const status = project.status;
  const currentIdx = getStatusStageIndex(status);

  const gateIdx = STAGE_GATE_MAP.findIndex((g) => g.gateLabel === gateLabel);

  if (gateIdx >= 0 && currentIdx > gateIdx) {
    return {
      statusCode: 409,
      body: {
        error: "demo_stage_locked",
        message: `比赛演示模式下，该项目的${gateLabel}阶段已完成，不允许回滚操作。`,
        current_status: status,
      },
    };
  }

  return null;
}

/**
 * Convenience: wraps the demo mode + stage rollback check for a controller.
 * Returns the error response if blocked, or null if allowed.
 */
export function demoStageGuard(project: ProjectRecord, demoMode: boolean, gateLabel: string): { statusCode: number; body: Record<string, unknown> } | null {
  if (!demoMode) return null;
  return checkDemoStageRollback(project, gateLabel);
}
