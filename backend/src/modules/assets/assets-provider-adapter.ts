/**
 * Provider adapter contracts for the asset execution engine.
 *
 * Each adapter implements the full lifecycle of one category of asset tasks
 * (e.g. TTS generation, image generation, video rendering).
 * Adapters are registered in the provider registry and selected by the
 * execution engine based on `canHandle(taskType)` and enabled provider types.
 */

import type {
  AssetArtifact,
  AssetPlan,
  AssetManifest,
  AssetTaskExecution,
} from "../../../../shared/src/index.js";

// ─── Provider Type ─────────────────────────────────────────────────────────

export type AssetProviderType = "tts" | "image" | "video" | "sfx" | "bgm";
// Note: render_motion_cue is not included here. It currently produces inline
// artifacts via the v1 builder and does not go through the provider engine.
// If a real Remotion or motion rendering provider is added later, extend this
// union with "remotion" and register a corresponding adapter.

// ─── Adapter Inputs ────────────────────────────────────────────────────────

export interface AssetProviderCanHandleInput {
  taskType: AssetTaskExecution["task_type"];
}

export interface AssetProviderContext {
  manifest: AssetManifest;
  assetPlan: AssetPlan;
  execution: AssetTaskExecution;
  planTask: AssetPlan["tasks"][number];
  assetManifestRecordId: string;
  assetRunId: string;
  projectStorageRootDir: string;
  /** 新模式每次外部请求前复查被冻结来源。 */
  beforeDispatch?: () => Promise<void>;
  /** 真实提交已开始；拆分提交中途失效也必须保留对账依据。 */
  onDispatch?: () => void;
}

export interface AssetProviderPreparedJob {
  providerJobId: string | null;
  rawRequestJson: Record<string, unknown>;
}

export interface AssetProviderSubmittedJob {
  providerJobId: string | null;
  rawResponseJson: Record<string, unknown> | null;
}

export interface AssetProviderPollResult {
  status: "running" | "completed" | "failed";
  rawResponseJson: Record<string, unknown> | null;
  errorCode?: string;
  errorMessage?: string;
}

export interface AssetProviderNormalizeInput {
  ctx: AssetProviderContext;
  downloadedArtifacts: AssetArtifact[];
  rawResponseJson: Record<string, unknown> | null;
}

export interface AssetProviderNormalizeResult {
  artifacts: AssetArtifact[];
  notes: string[];
}

// ─── Provider Adapter Interface ────────────────────────────────────────────

/** 付费媒体 capability（与 provider-dispatch-gate 的 PaidMediaCapability 一致）。 */
export type PaidMediaAdapterCapability =
  | "image.generate"
  | "video.image_to_video"
  | "tts.synthesize";

export interface AssetProviderAdapter {
  readonly providerName: string;
  readonly providerType: AssetProviderType;
  /**
   * S2-2A 任务 9A：真实付费 adapter 必须声明计费身份。
   * 声明即受付费闸门约束：无有效 quote 绑定 run/snapshot 时引擎拒绝派发；
   * usage 记账按 (capability, providerKey, modelId) 定价。
   * 本地/fake adapter 不声明（零外部费用，不进成本账本）。
   */
  readonly billing?: {
    capability: PaidMediaAdapterCapability;
    providerKey: string;
    modelId: string;
  };
  canHandle(input: AssetProviderCanHandleInput): boolean;
  prepare(ctx: AssetProviderContext): Promise<AssetProviderPreparedJob>;
  submit(
    ctx: AssetProviderContext,
    prepared: AssetProviderPreparedJob,
  ): Promise<AssetProviderSubmittedJob>;
  poll(
    ctx: AssetProviderContext,
    submitted: AssetProviderSubmittedJob,
  ): Promise<AssetProviderPollResult>;
  download(
    ctx: AssetProviderContext,
    pollResult: AssetProviderPollResult,
  ): Promise<AssetArtifact[]>;
  normalizeResult(
    input: AssetProviderNormalizeInput,
  ): Promise<AssetProviderNormalizeResult>;
  cancel(ctx: AssetProviderContext): Promise<void>;
}
