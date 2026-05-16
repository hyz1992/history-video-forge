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

export interface AssetProviderAdapter {
  readonly providerName: string;
  readonly providerType: AssetProviderType;
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
