import { z } from "zod";

import {
  AssetPlan,
  type AssetPlan as AssetPlanType,
} from "../../../../shared/src/index.js";

const ManualUploadPolicyPatch = z
  .object({
    allowed: z.boolean().default(false),
    required: z.boolean().default(false),
    accepted_file_types: z.array(z.string().min(1)).default([]),
    acceptance_notes: z.array(z.string().min(1)).default([]),
  })
  .strict()
  .default({
    allowed: false,
    required: false,
    accepted_file_types: [],
    acceptance_notes: [],
  });

const ChunkTaskStructuralPatch = z
  .object({
    local_task_id: z.string().min(1),
    recommended_mode: z
      .enum(["auto", "manual_allowed", "manual_preferred", "placeholder_only"])
      .optional(),
    provider_hint: z.string().min(1).nullable().optional(),
    prompt_draft: z.string().min(1).nullable().optional(),
    parameters: z.record(z.string(), z.unknown()).optional(),
    manual_upload_policy: ManualUploadPolicyPatch.optional(),
    risk_notes: z.array(z.string().min(1)).optional(),
    cost_tier: z.enum(["free", "low", "medium", "high"]).optional(),
  })
  .strict();

const ChunkDependencyStructuralPatch = z
  .object({
    local_dependency_id: z.string().min(1),
    task_local_id: z.string().min(1),
    depends_on_local_task_id: z.string().min(1),
    dependency_type: z.enum([
      "requires_output",
      "requires_timing",
      "requires_selection",
    ]),
  })
  .strict();

export const SegmentChunkStructuralPatch = z
  .object({
    patch_type: z.literal("segment_chunk_structural_patch"),
    task_patches: z.array(ChunkTaskStructuralPatch),
    dependency_patches: z.array(ChunkDependencyStructuralPatch),
  })
  .strict();

export type SegmentChunkStructuralPatch = z.infer<
  typeof SegmentChunkStructuralPatch
>;

export type LegacyChunkResilienceAction =
  | { type: "single_wrapper_unwrapped" }
  | { type: "missing_discriminator_defaulted" }
  | {
      type: "audio_timing_rebound";
      dependency_id: string;
      before_task_id: string;
      after_task_id: string;
      reason_code: "invalid_audio_timing_source";
    };

export interface LegacyAudioTimingIssue {
  code: "audio_timing_rebind_ambiguous";
  path: Array<string | number>;
  tts_task_count: number;
}

export class LegacyChunkResilienceError extends Error {
  readonly code = "asset_legacy_audio_timing_rebind_ambiguous";

  constructor(readonly issues: LegacyAudioTimingIssue[]) {
    super("asset_legacy_audio_timing_rebind_ambiguous");
    this.name = "LegacyChunkResilienceError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function coerceLegacyChunkStructuralPatch(raw: unknown): {
  patch: SegmentChunkStructuralPatch;
  actions: LegacyChunkResilienceAction[];
} {
  const actions: LegacyChunkResilienceAction[] = [];
  let candidate = raw;

  if (
    isRecord(candidate) &&
    Object.keys(candidate).length === 1 &&
    Object.hasOwn(candidate, "patch_fields")
  ) {
    candidate = candidate.patch_fields;
    actions.push({ type: "single_wrapper_unwrapped" });
  }

  if (isRecord(candidate) && !Object.hasOwn(candidate, "patch_type")) {
    candidate = {
      ...candidate,
      patch_type: "segment_chunk_structural_patch",
    };
    actions.push({ type: "missing_discriminator_defaulted" });
  }

  return {
    patch: SegmentChunkStructuralPatch.parse(candidate),
    actions,
  };
}

const TIMING_SOURCE_ALLOWED_TASK_TYPES = new Set([
  "tts_audio",
  "subtitle_track",
  "video_clip",
  "bgm_cue",
]);

export function canonicalizeLegacyAudioTiming(plan: AssetPlanType): {
  plan: AssetPlanType;
  actions: LegacyChunkResilienceAction[];
} {
  const tasksById = new Map(plan.tasks.map((task) => [task.task_id, task]));
  const targetDependencies = plan.dependencies.flatMap((dependency, index) => {
    const downstream = tasksById.get(dependency.task_id);
    const upstream = tasksById.get(dependency.depends_on_task_id);
    const isAudioCue =
      downstream?.task_type === "sfx_cue" ||
      downstream?.task_type === "bgm_cue";
    if (
      !isAudioCue ||
      dependency.dependency_type !== "requires_timing" ||
      !upstream ||
      TIMING_SOURCE_ALLOWED_TASK_TYPES.has(upstream.task_type)
    ) {
      return [];
    }
    return [{ dependency, index }];
  });

  const ttsTasks = plan.tasks.filter((task) => task.task_type === "tts_audio");
  if (targetDependencies.length > 0 && ttsTasks.length !== 1) {
    throw new LegacyChunkResilienceError(
      targetDependencies.map(({ index }) => ({
        code: "audio_timing_rebind_ambiguous",
        path: ["dependencies", index, "depends_on_task_id"],
        tts_task_count: ttsTasks.length,
      })),
    );
  }

  const clonedPlan = structuredClone(plan);
  if (targetDependencies.length === 0) {
    return { plan: AssetPlan.parse(clonedPlan), actions: [] };
  }

  const ttsTaskId = ttsTasks[0]!.task_id;
  const targetIndexes = new Set(targetDependencies.map(({ index }) => index));
  const actions: LegacyChunkResilienceAction[] = [];
  clonedPlan.dependencies = clonedPlan.dependencies.map((dependency, index) => {
    if (!targetIndexes.has(index)) return dependency;
    actions.push({
      type: "audio_timing_rebound",
      dependency_id: dependency.dependency_id,
      before_task_id: dependency.depends_on_task_id,
      after_task_id: ttsTaskId,
      reason_code: "invalid_audio_timing_source",
    });
    return { ...dependency, depends_on_task_id: ttsTaskId };
  });

  return {
    plan: AssetPlan.parse(clonedPlan),
    actions,
  };
}
