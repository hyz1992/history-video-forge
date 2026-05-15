/**
 * Type-only contracts for asset provider adapters.
 *
 * Real provider adapters are NOT implemented in this task — these types define
 * the interface that future adapters (TTS, image, video, SFX, BGM) must satisfy.
 */

import type {
  AssetArtifact,
  AssetTaskExecution,
} from "../../../../shared/src/index.js";

// ─── Adapter Context ──────────────────────────────────────────────────────────

/**
 * Contextual information passed to every adapter invocation.
 * Populated by the manifest builder / execution engine.
 */
export interface AssetProviderContext {
  /** The task execution record to process. */
  execution: AssetTaskExecution;
  /** IDs of artifacts produced by upstream dependencies (already completed). */
  inputArtifactIds: string[];
  /** Arbitrary parameters from the task's `parameters` field. */
  taskParameters: Record<string, unknown>;
}

// ─── Adapter Run Result ───────────────────────────────────────────────────────

/**
 * The outcome of a single provider adapter run.
 */
export interface AssetProviderRunResult {
  /** Updated execution status. */
  status: AssetTaskExecution["status"];
  /** Artifacts produced by this run (may be empty if still pending). */
  artifacts: AssetArtifact[];
  /** Optional provider-specific notes to append to the execution. */
  notes?: string[];
}

// ─── Provider Adapter Interface ───────────────────────────────────────────────

/**
 * A provider adapter handles the lifecycle of one category of asset tasks
 * (e.g. TTS generation, image generation, video rendering).
 *
 * Implementations will be registered in a provider registry and selected
 * by the execution engine based on `canHandle(taskType)`.
 */
export interface AssetProviderAdapter {
  /** Unique identifier for this provider (e.g. "wanx_image", "default_tts"). */
  readonly providerId: string;

  /** The task types this adapter can handle. */
  canHandle(taskType: string): boolean;

  /** Start (or queue) an asset generation job. */
  run(ctx: AssetProviderContext): Promise<AssetProviderRunResult>;

  /** Poll a running job for completion. */
  poll(ctx: AssetProviderContext): Promise<AssetProviderRunResult>;

  /** Cancel a running job. */
  cancel(ctx: AssetProviderContext): Promise<void>;

  /** Normalize provider-specific output into a standard AssetArtifact. */
  normalizeResult(
    rawOutput: unknown,
    ctx: AssetProviderContext,
  ): AssetArtifact;
}
