import { describe, expect, it, vi } from "vitest";

import { repairAssetPlanStructure } from "../../../backend/src/modules/asset-planning/asset-planning-structural-repair.service.js";
import type {
  AssetPlan,
  AssetPlanningValidationResult,
  StoryboardPlan,
} from "../../../shared/src/index.js";
import type {
  InvokeStructuredPromptOptions,
  LlmGateway,
} from "../../../backend/src/runtime/llm/llm-gateway.js";

const scriptText =
  "The envoy stands before the public hall. The pressure turns into a visible answer.";

const storyboard: StoryboardPlan = {
  plan_version: "storyboard_v1",
  source_script_record_id: "script_record_1",
  source_topic_package_id: "topic_package_1",
  estimated_total_duration_sec: 60,
  segments: [
    {
      segment_id: "sb_001",
      order: 0,
      script_excerpt: scriptText,
      start_hint_sec: 0,
      end_hint_sec: 60,
      narrative_role: "peak",
      visual_intent: "Show the public pressure turning back on the hall.",
      scene_description: "Ancient public hall under visible pressure.",
      visual_elements: ["envoy", "hall"],
      framing_hint: "medium",
      content_type: "live_action",
      motion_hint: "push_in",
      editing_hint: "single",
      on_screen_text: [],
      linked_beats: ["public answer"],
      linked_quotes: [],
      risk_notes: [],
    },
  ],
  global_visual_notes: [],
};

function makePlan(): AssetPlan {
  return {
    plan_version: "asset_plan_v1",
    source_storyboard_record_id: "storyboard_record_1",
    source_script_record_id: "script_record_1",
    source_topic_package_id: "topic_package_1",
    art_bible: {
      era_style: "ancient court",
      visual_tone: "cold pressure",
      characters: [],
      locations: [],
      props: [],
      global_prompt_prefix: "ancient Chinese historical short video",
      global_negative_prompts: ["modern building"],
      consistency_notes: [],
    },
    tts_plan: {
      voice_profile_id: "voice_default_male_storyteller",
      estimated_total_duration_sec: 60,
      chunking_strategy: "segment_boundary",
      chunks: [
        {
          chunk_id: "tts_001",
          order: 0,
          script_excerpt: scriptText,
          estimated_duration_sec: 60,
        },
      ],
    },
    tasks: [
      {
        task_id: "tts_001",
        order: 0,
        task_type: "tts_audio",
        source_segment_id: null,
        source_excerpt: scriptText,
        production_intent: "Generate narration audio.",
        recommended_mode: "auto",
        provider_hint: "default_tts",
        prompt_draft: null,
        parameters: {},
        manual_upload_policy: {
          allowed: false,
          required: false,
          accepted_file_types: [],
          acceptance_notes: [],
        },
        risk_notes: [],
        cost_tier: "low",
        initial_status: "planned",
      },
      {
        task_id: "subtitle_001",
        order: 1,
        task_type: "subtitle_track",
        source_segment_id: null,
        source_excerpt: scriptText,
        production_intent: "Generate subtitle timing from TTS.",
        recommended_mode: "auto",
        provider_hint: null,
        prompt_draft: null,
        parameters: {
          source_tts_task_id: "tts_001",
        },
        manual_upload_policy: {
          allowed: false,
          required: false,
          accepted_file_types: [],
          acceptance_notes: [],
        },
        risk_notes: [],
        cost_tier: "free",
        initial_status: "planned",
      },
      {
        task_id: "img_001",
        order: 2,
        task_type: "image_still",
        source_segment_id: "sb_001",
        source_excerpt: scriptText,
        production_intent: "Create the anchor visual.",
        recommended_mode: "manual_allowed",
        provider_hint: "wanx",
        prompt_draft: null,
        parameters: {
          aspect_ratio: "9:16",
        },
        manual_upload_policy: {
          allowed: true,
          required: false,
          accepted_file_types: ["image/png"],
          acceptance_notes: [],
        },
        risk_notes: ["Avoid modern elements."],
        cost_tier: "low",
        initial_status: "planned",
      },
      {
        task_id: "motion_001",
        order: 3,
        task_type: "render_motion_cue",
        source_segment_id: "sb_001",
        source_excerpt: scriptText,
        production_intent: "Push in on the anchor still.",
        recommended_mode: "auto",
        provider_hint: null,
        prompt_draft: null,
        parameters: {
          motion: "push_in",
        },
        manual_upload_policy: {
          allowed: false,
          required: false,
          accepted_file_types: [],
          acceptance_notes: [],
        },
        risk_notes: [],
        cost_tier: "free",
        initial_status: "planned",
      },
      {
        task_id: "video_001",
        order: 4,
        task_type: "video_clip",
        source_segment_id: "sb_001",
        source_excerpt: scriptText,
        production_intent: "Create the key physical action clip.",
        recommended_mode: "manual_preferred",
        provider_hint: "video_provider",
        prompt_draft: "Ancient public hall, pressure turns into action.",
        parameters: {},
        manual_upload_policy: {
          allowed: true,
          required: false,
          accepted_file_types: ["video/mp4"],
          acceptance_notes: [],
        },
        risk_notes: ["Avoid graphic content."],
        cost_tier: "high",
        initial_status: "planned",
      },
    ],
    dependencies: [
      {
        dependency_id: "dep_subtitle_after_tts",
        task_id: "subtitle_001",
        depends_on_task_id: "tts_001",
        dependency_type: "requires_timing",
      },
      {
        dependency_id: "dep_motion_after_img",
        task_id: "motion_001",
        depends_on_task_id: "img_001",
        dependency_type: "requires_output",
      },
    ],
    cost_summary: {
      total_tasks: 5,
      by_type: {
        tts_audio: 1,
        subtitle_track: 1,
        image_still: 1,
        render_motion_cue: 1,
        video_clip: 1,
      },
      by_cost_tier: {
        free: 2,
        low: 2,
        medium: 0,
        high: 1,
      },
      estimated_provider_calls: 3,
      notes: [],
    },
    global_production_notes: ["No physical assets are generated."],
  };
}

function makeValidation(): AssetPlanningValidationResult {
  return {
    stage: "asset_planning_local_validation",
    decision: "regen_once",
    errors: [
      "asset_visual_prompt_missing",
      "asset_visual_risk_notes_missing",
      "asset_video_missing_static_fallback",
    ],
    warnings: [],
    metrics: {
      repair_hints: [
        {
          task_id: "img_001",
          task_type: "image_still",
          source_segment_id: "sb_001",
          missing_fields: ["prompt_draft"],
        },
        {
          task_id: "motion_001",
          task_type: "render_motion_cue",
          source_segment_id: "sb_001",
          missing_fields: ["risk_notes"],
        },
        {
          task_id: "video_001",
          task_type: "video_clip",
          source_segment_id: "sb_001",
          missing_fields: ["static_fallback_task_id"],
        },
      ],
    },
  };
}

function makeGateway(): { gateway: LlmGateway; calls: InvokeStructuredPromptOptions[] } {
  const calls: InvokeStructuredPromptOptions[] = [];
  return {
    calls,
    gateway: {
      async invokeStructuredPrompt<T>(
        options: InvokeStructuredPromptOptions,
      ): Promise<T> {
        calls.push(options);
        return {
          patch_type: "asset_plan_structural_patch",
          task_patches: [
            {
              task_id: "img_001",
              prompt_draft:
                "战国历史短视频，古代宫门前的紧张场面，竖屏电影感构图",
            },
            {
              task_id: "motion_001",
              risk_notes: ["保持低成本运镜，不加入现代元素或血腥表现"],
            },
            {
              task_id: "video_001",
              parameters: {
                static_fallback_task_id: "img_001",
              },
            },
          ],
          dependency_patches: [
            {
              task_id: "video_001",
              depends_on_task_id: "img_001",
              dependency_type: "requires_output",
            },
          ],
        } as T;
      },
      invokeStrictStructured: vi.fn(),
    },
  };
}

function makeGatewayWithReply(reply: unknown): LlmGateway {
  return {
    async invokeStructuredPrompt<T>(): Promise<T> {
      return reply as T;
    },
    invokeStrictStructured: vi.fn(),
  };
}

describe("repairAssetPlanStructure", () => {
  it("applies structural task patches without changing task count", async () => {
    const plan = makePlan();
    const { gateway, calls } = makeGateway();

    const result = await repairAssetPlanStructure({
      plan,
      validation: makeValidation(),
      storyboard,
      llmGateway: gateway,
    });

    expect(result.repairUsed).toBe(true);
    expect(calls[0].promptId).toBe("asset-planning.asset-structural-repair");
    expect(result.plan.tasks).toHaveLength(plan.tasks.length);
    expect(
      result.plan.tasks.find((task) => task.task_id === "img_001")?.prompt_draft,
    ).toBe("战国历史短视频，古代宫门前的紧张场面，竖屏电影感构图");
    expect(
      result.plan.tasks.find((task) => task.task_id === "motion_001")
        ?.risk_notes,
    ).toEqual(["保持低成本运镜，不加入现代元素或血腥表现"]);
    expect(
      result.plan.tasks.find((task) => task.task_id === "video_001")?.parameters
        .static_fallback_task_id,
    ).toBe("img_001");
    expect(result.plan.dependencies).toContainEqual(
      expect.objectContaining({
        task_id: "video_001",
        depends_on_task_id: "img_001",
        dependency_type: "requires_output",
      }),
    );
  });

  it("tolerates missing patch_type field (LLM frequently omits declarative metadata)", async () => {
    const plan = makePlan();
    const gateway = makeGatewayWithReply({
      task_patches: [
        {
          task_id: "img_001",
          prompt_draft: "古代宫门前的紧张场面",
        },
      ],
      // 缺 patch_type 和 dependency_patches（真实场景中 LLM 经常这样）
    });

    const result = await repairAssetPlanStructure({
      plan,
      validation: makeValidation(),
      storyboard,
      llmGateway: gateway,
    });

    expect(result.repairUsed).toBe(true);
    expect(
      result.plan.tasks.find((task) => task.task_id === "img_001")?.prompt_draft,
    ).toBe("古代宫门前的紧张场面");
  });

  it("returns repairUsed=false instead of throwing when LLM output is unparseable", async () => {
    const plan = makePlan();
    const gateway = makeGatewayWithReply({
      // 缺 task_patches —— 完全无法挽救
      random_field: "noise",
    });

    const result = await repairAssetPlanStructure({
      plan,
      validation: makeValidation(),
      storyboard,
      llmGateway: gateway,
    });

    expect(result.repairUsed).toBe(false);
    expect(result.plan).toBe(plan);
  });

  it("returns repairUsed=false when LLM returns malformed task_patches entries", async () => {
    const plan = makePlan();
    const gateway = makeGatewayWithReply({
      task_patches: [
        { task_id: "img_001", prompt_draft: 12345 }, // 类型错误
      ],
    });

    const result = await repairAssetPlanStructure({
      plan,
      validation: makeValidation(),
      storyboard,
      llmGateway: gateway,
    });

    expect(result.repairUsed).toBe(false);
  });

  it("returns repairUsed=false when patch only fills irrelevant fields (no effective fix)", async () => {
    // 模拟 trace 里观察到的真实场景：LLM 返回的 patch 没有修复任何
    // validator 标记缺失的字段（img_001.prompt_draft 等）。
    // 这里 patch 引用了一个不存在的 task_id，会被忽略（不改变 plan）。
    const plan = makePlan();
    const gateway = makeGatewayWithReply({
      patch_type: "asset_plan_structural_patch",
      task_patches: [
        {
          // 引用一个根本不在 plan 里的 task_id
          // 注意：coerceStructuralPatch 接受这种 patch，但 applyStructuralPatch
          // 后 effectiveChangeCount=0（因为找不到对应 task 不会修改任何字段）
          task_id: "non_existent_task",
          prompt_draft: "无效修复内容",
        },
      ],
      dependency_patches: [],
    });

    const result = await repairAssetPlanStructure({
      plan,
      validation: makeValidation(),
      storyboard,
      llmGateway: gateway,
    });

    // patch 引用的 task 不存在 → applyStructuralPatch 会抛 asset_plan_structural_patch_task_missing
    // 这个抛错会被外层视为修复失败，repairUsed=false
    expect(result.repairUsed).toBe(false);
  });
});
