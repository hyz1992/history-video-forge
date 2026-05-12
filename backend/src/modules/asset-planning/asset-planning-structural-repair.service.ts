import { z } from "zod";

import {
  AssetPlan,
  type AssetPlanningValidationResult,
  type AssetTask,
  type StoryboardPlan,
} from "../../../../shared/src/index.js";
import { env, getValidatedRuntimeEnv } from "../../config/env.js";
import { createLlmGateway, type LlmGateway } from "../../runtime/llm/llm-gateway.js";
import type { LlmInteractionLogWriter } from "../../runtime/llm/interaction-log.js";
import { createOpenAiCompatibleProvider } from "../../runtime/llm/openai-compatible-provider.js";
import type {
  StructuredPromptInvocation,
  StructuredPromptProvider,
} from "../../runtime/llm/provider-contract.js";
import { createPromptRegistry } from "../../runtime/prompts/prompt-registry.js";

const STRUCTURAL_REPAIR_PROMPT_ID = "asset-planning.asset-structural-repair";

const REPAIRABLE_ERRORS = new Set([
  "asset_visual_prompt_missing",
  "asset_visual_risk_notes_missing",
  "asset_video_missing_static_fallback",
]);

const TaskPatch = z
  .object({
    task_id: z.string().min(1),
    prompt_draft: z.string().min(1).optional(),
    risk_notes: z.array(z.string().min(1)).optional(),
    parameters: z
      .object({
        static_fallback_task_id: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const DependencyPatch = z
  .object({
    task_id: z.string().min(1),
    depends_on_task_id: z.string().min(1),
    dependency_type: z.literal("requires_output"),
  })
  .strict();

const AssetPlanStructuralPatch = z
  .object({
    patch_type: z.literal("asset_plan_structural_patch"),
    task_patches: z.array(TaskPatch),
    dependency_patches: z.array(DependencyPatch),
  })
  .strict();

type AssetPlanStructuralPatch = z.infer<typeof AssetPlanStructuralPatch>;

export async function repairAssetPlanStructure(input: {
  plan: AssetPlan;
  validation: AssetPlanningValidationResult;
  storyboard: StoryboardPlan;
  llmGateway?: LlmGateway;
  interactionLogWriter?: LlmInteractionLogWriter;
}): Promise<{ plan: AssetPlan; repairUsed: boolean }> {
  if (!isRepairableValidation(input.validation)) {
    return {
      plan: input.plan,
      repairUsed: false,
    };
  }

  const gateway = input.llmGateway ?? createAssetPlanRepairGateway();
  const rawPatch = await gateway.invokeStructuredPrompt<unknown>({
    promptId: STRUCTURAL_REPAIR_PROMPT_ID,
    input: {
      repair_mode: "asset_plan_structural_patch",
      plan: input.plan,
      local_validation: input.validation,
      repair_hints: input.validation.metrics.repair_hints ?? [],
      storyboard_segments: input.storyboard.segments,
      art_bible: input.plan.art_bible,
    },
    interactionLogWriter: input.interactionLogWriter,
  });
  const patch = AssetPlanStructuralPatch.parse(rawPatch);

  return {
    plan: applyStructuralPatch(input.plan, patch),
    repairUsed: true,
  };
}

function isRepairableValidation(validation: AssetPlanningValidationResult) {
  if (validation.decision !== "regen_once") {
    return false;
  }

  if (validation.errors.length === 0) {
    return false;
  }

  return validation.errors.every((error) => REPAIRABLE_ERRORS.has(error));
}

function applyStructuralPatch(
  plan: AssetPlan,
  patch: AssetPlanStructuralPatch,
): AssetPlan {
  const tasksById = new Map(plan.tasks.map((task) => [task.task_id, task]));
  const patchedTasks = plan.tasks.map((task) => {
    const taskPatch = patch.task_patches.find(
      (candidate) => candidate.task_id === task.task_id,
    );
    if (!taskPatch) {
      return task;
    }

    assertPatchAllowedForTask(task, taskPatch);
    return {
      ...task,
      prompt_draft: taskPatch.prompt_draft ?? task.prompt_draft,
      risk_notes: taskPatch.risk_notes ?? task.risk_notes,
      parameters: {
        ...task.parameters,
        ...(taskPatch.parameters ?? {}),
      },
    };
  });

  for (const taskPatch of patch.task_patches) {
    if (!tasksById.has(taskPatch.task_id)) {
      throw new Error("asset_plan_structural_patch_task_missing");
    }
  }

  const dependencies = [...plan.dependencies];
  for (const dependencyPatch of patch.dependency_patches) {
    assertDependencyPatchAllowed(tasksById, dependencyPatch);
    if (
      dependencies.some(
        (dependency) =>
          dependency.task_id === dependencyPatch.task_id &&
          dependency.depends_on_task_id === dependencyPatch.depends_on_task_id &&
          dependency.dependency_type === dependencyPatch.dependency_type,
      )
    ) {
      continue;
    }

    dependencies.push({
      dependency_id: `dep_structural_repair_${dependencies.length + 1}`,
      task_id: dependencyPatch.task_id,
      depends_on_task_id: dependencyPatch.depends_on_task_id,
      dependency_type: dependencyPatch.dependency_type,
    });
  }

  return AssetPlan.parse({
    ...plan,
    tasks: patchedTasks,
    dependencies,
  });
}

function assertPatchAllowedForTask(
  task: AssetTask,
  taskPatch: z.infer<typeof TaskPatch>,
) {
  if (
    taskPatch.prompt_draft !== undefined &&
    task.task_type !== "image_still" &&
    task.task_type !== "video_clip"
  ) {
    throw new Error("asset_plan_structural_patch_prompt_task_type_invalid");
  }

  if (
    taskPatch.risk_notes !== undefined &&
    task.task_type !== "image_still" &&
    task.task_type !== "render_motion_cue" &&
    task.task_type !== "video_clip"
  ) {
    throw new Error("asset_plan_structural_patch_risk_task_type_invalid");
  }

  if (
    taskPatch.parameters?.static_fallback_task_id !== undefined &&
    task.task_type !== "video_clip"
  ) {
    throw new Error("asset_plan_structural_patch_fallback_task_type_invalid");
  }
}

function assertDependencyPatchAllowed(
  tasksById: Map<string, AssetTask>,
  dependencyPatch: z.infer<typeof DependencyPatch>,
) {
  const task = tasksById.get(dependencyPatch.task_id);
  const upstream = tasksById.get(dependencyPatch.depends_on_task_id);
  if (!task || !upstream) {
    throw new Error("asset_plan_structural_patch_dependency_task_missing");
  }

  if (task.task_type !== "video_clip" || upstream.task_type !== "image_still") {
    throw new Error("asset_plan_structural_patch_dependency_type_invalid");
  }

  if (
    task.source_segment_id !== null &&
    upstream.source_segment_id !== null &&
    task.source_segment_id !== upstream.source_segment_id
  ) {
    throw new Error("asset_plan_structural_patch_dependency_segment_mismatch");
  }
}

function createAssetPlanRepairGateway(): LlmGateway {
  const provider =
    env.llm.provider === "stub"
      ? createStubAssetPlanRepairProvider()
      : createValidatedAssetPlanRepairProvider();

  return createLlmGateway({
    registry: createPromptRegistry(),
    provider,
  });
}

function createValidatedAssetPlanRepairProvider(): StructuredPromptProvider {
  getValidatedRuntimeEnv();

  return createOpenAiCompatibleProvider({
    profile: "main",
  });
}

function createStubAssetPlanRepairProvider(): StructuredPromptProvider {
  return {
    async invokeStructuredPrompt<T>(
      request: StructuredPromptInvocation,
    ): Promise<T> {
      throw new Error(
        `asset_planning_repair_stub_provider_requires_test_gateway:${request.operationName}`,
      );
    },
  };
}
