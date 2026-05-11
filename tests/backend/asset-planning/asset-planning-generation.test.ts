import { describe, expect, it, vi } from "vitest";

import { AssetPlan, type ScriptDraftPackage, type StoryboardPlan } from "../../../shared/src/index.js";
import type {
  InvokeStructuredPromptOptions,
  LlmGateway,
} from "../../../backend/src/runtime/llm/llm-gateway.js";
import { generateAssetPlan } from "../../../backend/src/modules/asset-planning/asset-planning-generation.service.js";

const scriptText =
  "楚王第一次压场时，晏子没有退。他站在殿前，看着那扇为羞辱他而开的矮门。第二次，楚王又说齐国没人，才派这样的人来。晏子没有急着争辩，只把规矩一句句摆回去。最后，楚国拿齐人盗窃来羞辱齐国。晏子用橘生淮南则为橘，把第三次压场顶回楚王脸上。";

const baseScriptDraft: ScriptDraftPackage = {
  script_text: scriptText,
  estimated_duration_sec: 70,
  beat_trace: [
    {
      beat: "狗门羞辱",
      excerpt: "那扇为羞辱他而开的矮门",
      confidence: 0.92,
    },
    {
      beat: "齐国无人",
      excerpt: "楚王又说齐国没人",
      confidence: 0.9,
    },
    {
      beat: "橘枳之喻",
      excerpt: "橘生淮南则为橘",
      confidence: 0.96,
    },
  ],
  quote_trace: [
    {
      quote: "橘生淮南则为橘",
      usage_type: "exact",
      excerpt: "橘生淮南则为橘",
    },
  ],
  opening_span: "楚王第一次压场时，晏子没有退。",
  ending_span: "把第三次压场顶回楚王脸上。",
};

const baseStoryboardPlan: StoryboardPlan = {
  plan_version: "storyboard_v1",
  source_script_record_id: "script_record_1",
  source_topic_package_id: "topic_package_1",
  estimated_total_duration_sec: 70,
  segments: [
    {
      segment_id: "sb_001",
      order: 0,
      script_excerpt:
        "楚王第一次压场时，晏子没有退。他站在殿前，看着那扇为羞辱他而开的矮门。",
      start_hint_sec: 0,
      end_hint_sec: 18,
      narrative_role: "opening",
      visual_intent: "让观众看见公开羞辱已经落到晏子身上。",
      scene_description: "楚国殿前，矮门和众人的目光形成压迫。",
      visual_elements: ["楚王", "晏子", "矮门"],
      framing_hint: "wide",
      content_type: "live_action",
      motion_hint: "push_in",
      editing_hint: "single",
      on_screen_text: ["第一次压场"],
      linked_beats: ["狗门羞辱"],
      linked_quotes: [],
      risk_notes: [],
    },
    {
      segment_id: "sb_002",
      order: 1,
      script_excerpt:
        "第二次，楚王又说齐国没人，才派这样的人来。晏子没有急着争辩，只把规矩一句句摆回去。",
      start_hint_sec: 18,
      end_hint_sec: 40,
      narrative_role: "turn",
      visual_intent: "让观众看见羞辱从个人升到齐国。",
      scene_description: "殿上对峙，晏子用礼制把话压回去。",
      visual_elements: ["楚王", "晏子", "群臣"],
      framing_hint: "medium",
      content_type: "live_action",
      motion_hint: "static",
      editing_hint: "cutaway",
      on_screen_text: [],
      linked_beats: ["齐国无人"],
      linked_quotes: [],
      risk_notes: [],
    },
    {
      segment_id: "sb_003",
      order: 2,
      script_excerpt:
        "最后，楚国拿齐人盗窃来羞辱齐国。晏子用橘生淮南则为橘，把第三次压场顶回楚王脸上。",
      start_hint_sec: 40,
      end_hint_sec: 70,
      narrative_role: "peak",
      visual_intent: "让观众看见第三次压场被原样顶回去。",
      scene_description: "橘与枳的对照压过殿上的嘲笑。",
      visual_elements: ["橘", "晏子", "楚王"],
      framing_hint: "close",
      content_type: "illustration",
      motion_hint: "pull_back",
      editing_hint: "montage",
      on_screen_text: ["橘生淮南则为橘"],
      linked_beats: ["橘枳之喻"],
      linked_quotes: ["橘生淮南则为橘"],
      risk_notes: [],
    },
  ],
  global_visual_notes: [],
};

const baseTopicBoundaryContext = {
  title: "晏子使楚",
  selected_angle: "楚王连压三次，晏子一次没退",
  family_label: "外交压场型",
  scope_label: "完整事件",
  core_conflict: "楚王连续压场，晏子必须顶回去",
  strong_scene: "殿前对峙",
  forbidden_expansions: [],
  risk_hints: [],
  source_anchor_refs: ["《晏子春秋》"],
  canonical_quotes: ["橘生淮南则为橘"],
  narrative_tension_map: {
    hook_claim: "楚王连压三次",
    peak_payoff: "橘枳之喻顶回去",
  },
};

const validGlobalPlanningDraft = {
  planning_mode: "global",
  art_bible: {
    era_style: "战国宫廷与军帐",
    visual_tone: "冷色压迫，转折处用暖光突出人物反应",
    characters: [],
    locations: [],
    props: [],
    global_prompt_prefix: "古代中国历史短视频画面，战国质感",
    global_negative_prompts: ["现代建筑", "现代服饰"],
    consistency_notes: ["视觉任务复用统一时代质感"],
  },
  visual_budget: {
    default_path: "image_still_plus_render_motion_cue",
    average_images_per_segment_limit: 1.5,
    video_clip_policy: "仅 peak 段落保留候选",
    manual_upload_policy: "视觉类任务允许手动上传",
  },
  downgrade_policy: {
    video_to_still_fallback: true,
    notes: ["所有 video_clip 必须有静态图降级"],
  },
  global_audio_strategy: {
    sfx_intensity_by_role: {
      opening: "low_hit",
      turn: "rising_hit",
      peak: "strong_hit",
    },
    bgm_cue_policy: "全片一个低频紧张底乐占位",
    notes: [],
  },
  manual_review_notes: [],
};

function validChunkPlanningDraftFor(
  segmentIds: string[],
  storyboard: StoryboardPlan = baseStoryboardPlan,
) {
  const tasks = segmentIds.flatMap((segmentId, index) => {
    const segment = storyboard.segments.find(
      (candidate) => candidate.segment_id === segmentId,
    );
    if (!segment) {
      return [];
    }

    const localImageId = `local_img_${segmentId}`;
    const taskDrafts: Array<Record<string, unknown>> = [
      {
        local_task_id: localImageId,
        task_type: "image_still",
        source_segment_id: segmentId,
        source_excerpt: segment.script_excerpt,
        production_intent: `生成 ${segmentId} 主视觉`,
        recommended_mode: "manual_allowed",
        provider_hint: "wanx",
        prompt_draft: `战国历史短视频，${segment.scene_description}`,
        parameters: {
          aspect_ratio: "9:16",
          image_role: "anchor",
        },
        manual_upload_policy: {
          allowed: true,
          required: false,
          accepted_file_types: ["image/png", "image/jpeg"],
          acceptance_notes: [],
        },
        risk_notes: [],
        cost_tier: "low",
      },
      {
        local_task_id: `local_motion_${segmentId}`,
        task_type: "render_motion_cue",
        source_segment_id: segmentId,
        source_excerpt: segment.script_excerpt,
        production_intent: `给 ${segmentId} 主视觉增加轻微运动`,
        recommended_mode: "auto",
        provider_hint: null,
        prompt_draft: null,
        parameters: {
          motion: segment.motion_hint,
        },
        manual_upload_policy: {
          allowed: false,
          required: false,
          accepted_file_types: [],
          acceptance_notes: [],
        },
        risk_notes: [],
        cost_tier: "free",
      },
    ];

    if (index === 0) {
      taskDrafts.push({
        local_task_id: `local_sfx_${segmentId}`,
        task_type: "sfx_cue",
        source_segment_id: segmentId,
        source_excerpt: segment.script_excerpt,
        production_intent: `根据 ${segment.narrative_role} 加入情绪音效`,
        recommended_mode: "placeholder_only",
        provider_hint: null,
        prompt_draft: null,
        parameters: {
          sfx_tag: "low_hit",
        },
        manual_upload_policy: {
          allowed: false,
          required: false,
          accepted_file_types: [],
          acceptance_notes: [],
        },
        risk_notes: [],
        cost_tier: "free",
      });
    }

    return taskDrafts;
  });

  return {
    planning_mode: "segment_chunk",
    chunk_id: `chunk_${segmentIds.join("_")}`,
    tasks,
    dependencies: tasks
      .filter((task) => task.task_type === "render_motion_cue")
      .map((task) => {
        const localTaskId = String(task.local_task_id);
        return {
          local_dependency_id: `dep_${localTaskId}`,
          task_local_id: localTaskId,
          depends_on_local_task_id: localTaskId.replace(
            "local_motion",
            "local_img",
          ),
          dependency_type: "requires_output",
        };
      }),
    budget_notes: [],
  };
}

function makeGateway(
  handler?: (options: InvokeStructuredPromptOptions) => unknown,
) {
  const calls: InvokeStructuredPromptOptions[] = [];
  const gateway: LlmGateway = {
    async invokeStructuredPrompt<T>(options: InvokeStructuredPromptOptions): Promise<T> {
      calls.push(options);
      if (handler) {
        return handler(options) as T;
      }

      const promptInput = options.input as {
        planning_mode: "global" | "segment_chunk";
        chunk?: { segment_ids: string[] };
      };
      if (promptInput.planning_mode === "global") {
        return validGlobalPlanningDraft as T;
      }

      return validChunkPlanningDraftFor(promptInput.chunk?.segment_ids ?? []) as T;
    },
    invokeStrictStructured: vi.fn(),
  };

  return { gateway, calls };
}

function makeInput(llmGateway: LlmGateway, chunkSize = 2) {
  return {
    sourceStoryboardRecordId: "storyboard_record_1",
    sourceScriptRecordId: "script_record_1",
    sourceTopicPackageId: "topic_package_1",
    storyboard: baseStoryboardPlan,
    draft: baseScriptDraft,
    topicBoundaryContext: baseTopicBoundaryContext,
    llmGateway,
    chunkSize,
  };
}

function makeStoryboardWithSegmentCount(count: number): StoryboardPlan {
  return {
    ...baseStoryboardPlan,
    segments: Array.from({ length: count }, (_, index) => {
      const baseSegment =
        baseStoryboardPlan.segments[index % baseStoryboardPlan.segments.length];
      const order = index;
      return {
        ...baseSegment,
        segment_id: `sb_${String(index + 1).padStart(3, "0")}`,
        order,
        script_excerpt: `${baseSegment.script_excerpt}（并发测试段落 ${index + 1}）`,
        start_hint_sec: order * 10,
        end_hint_sec: order * 10 + 10,
      };
    }),
  };
}

async function waitUntil(predicate: () => boolean) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("condition_not_met");
}

describe("generateAssetPlan", () => {
  it("builds local audio skeleton and invokes chunked planning prompts", async () => {
    const { gateway, calls } = makeGateway();

    const plan = await generateAssetPlan(makeInput(gateway));

    const parsed = AssetPlan.parse(plan);
    expect(calls.map((call) => call.promptId)).toEqual([
      "asset-planning.planner",
      "asset-planning.planner",
      "asset-planning.planner",
    ]);
    expect(calls[0]?.input).toMatchObject({ planning_mode: "global" });
    expect(calls[1]?.input).toMatchObject({
      planning_mode: "segment_chunk",
      chunk: { segment_ids: ["sb_001", "sb_002"] },
    });
    expect(calls[2]?.input).toMatchObject({
      planning_mode: "segment_chunk",
      chunk: { segment_ids: ["sb_003"] },
    });
    expect(parsed.plan_version).toBe("asset_plan_v1");
    expect(parsed.source_storyboard_record_id).toBe("storyboard_record_1");
    expect(parsed.source_script_record_id).toBe("script_record_1");
    expect(parsed.source_topic_package_id).toBe("topic_package_1");
    expect(parsed.tts_plan.chunks.length).toBeGreaterThan(0);
    expect(parsed.tasks.some((task) => task.task_type === "tts_audio")).toBe(true);
    expect(parsed.tasks.some((task) => task.task_type === "subtitle_track")).toBe(true);
    expect(parsed.dependencies).toContainEqual(
      expect.objectContaining({
        task_id: "subtitle_001",
        depends_on_task_id: "tts_001",
        dependency_type: "requires_timing",
      }),
    );
  });

  it("runs segment chunk planning with bounded concurrency by default", async () => {
    const startedChunks: string[] = [];
    let releaseFirstChunk!: () => void;
    const firstChunkGate = new Promise<void>((resolve) => {
      releaseFirstChunk = resolve;
    });
    const storyboard = makeStoryboardWithSegmentCount(4);
    const { gateway } = makeGateway(async (options) => {
      const input = options.input as {
        planning_mode: "global" | "segment_chunk";
        chunk?: { chunk_id: string; segment_ids: string[] };
      };
      if (input.planning_mode === "global") {
        return validGlobalPlanningDraft;
      }

      startedChunks.push(input.chunk?.chunk_id ?? "missing_chunk_id");
      if (input.chunk?.chunk_id === "chunk_001") {
        await firstChunkGate;
      }

      return validChunkPlanningDraftFor(input.chunk?.segment_ids ?? [], storyboard);
    });

    const running = generateAssetPlan({
      ...makeInput(gateway, 1),
      storyboard,
    });

    let waitError: unknown = null;
    try {
      await waitUntil(() => startedChunks.includes("chunk_002"));
    } catch (error) {
      waitError = error;
    } finally {
      releaseFirstChunk();
    }

    const plan = await running;
    if (waitError) {
      throw waitError;
    }

    expect(startedChunks.slice(0, 2)).toEqual(["chunk_001", "chunk_002"]);
    expect(
      plan.tasks
        .filter((task) => task.task_type === "image_still")
        .map((task) => task.source_segment_id),
    ).toEqual(["sb_001", "sb_002", "sb_003", "sb_004"]);
  });

  it("sends structured source inputs, art bible, budget constraints, and regeneration context", async () => {
    const { gateway, calls } = makeGateway();

    await generateAssetPlan({
      ...makeInput(gateway),
      regenerationContext: {
        reason: "asset_planning_local_validation_regen_once",
        errors: ["asset_visual_prompt_missing"],
        metrics: { task_count: 3 },
      },
    });

    expect(calls[0]?.input).toMatchObject({
      planning_mode: "global",
      source_storyboard_record_id: "storyboard_record_1",
      source_script_record_id: "script_record_1",
      source_topic_package_id: "topic_package_1",
      storyboard: baseStoryboardPlan,
      draft: baseScriptDraft,
      topic_boundary_context: baseTopicBoundaryContext,
      regeneration_context: {
        reason: "asset_planning_local_validation_regen_once",
      },
    });
    expect(calls[1]?.input).toMatchObject({
      art_bible: validGlobalPlanningDraft.art_bible,
      visual_budget: validGlobalPlanningDraft.visual_budget,
      global_audio_strategy: validGlobalPlanningDraft.global_audio_strategy,
      chunk: {
        segments: baseStoryboardPlan.segments.slice(0, 2),
      },
    });
  });

  it("rejects global drafts that include asset tasks", async () => {
    const { gateway } = makeGateway((options) => {
      const input = options.input as { planning_mode: string };
      if (input.planning_mode === "global") {
        return {
          ...validGlobalPlanningDraft,
          tasks: [],
        };
      }
      return validChunkPlanningDraftFor(["sb_001"]);
    });

    await expect(generateAssetPlan(makeInput(gateway))).rejects.toThrow(
      /asset_planning_global_draft_must_not_include_tasks/u,
    );
  });

  it("rejects chunk drafts that include tts or subtitle tasks", async () => {
    const { gateway } = makeGateway((options) => {
      const input = options.input as {
        planning_mode: "global" | "segment_chunk";
        chunk?: { segment_ids: string[] };
      };
      if (input.planning_mode === "global") {
        return validGlobalPlanningDraft;
      }

      return {
        ...validChunkPlanningDraftFor(input.chunk?.segment_ids ?? []),
        tasks: [
          {
            ...validChunkPlanningDraftFor(["sb_001"]).tasks[0],
            local_task_id: "local_tts",
            task_type: "tts_audio",
          },
        ],
      };
    });

    await expect(generateAssetPlan(makeInput(gateway))).rejects.toThrow(
      /asset_planning_chunk_draft_forbidden_task_type/u,
    );
  });

  it("rejects chunk-local dependencies that reference missing local ids", async () => {
    const { gateway } = makeGateway((options) => {
      const input = options.input as {
        planning_mode: "global" | "segment_chunk";
        chunk?: { segment_ids: string[] };
      };
      if (input.planning_mode === "global") {
        return validGlobalPlanningDraft;
      }
      const draft = validChunkPlanningDraftFor(input.chunk?.segment_ids ?? []);
      return {
        ...draft,
        dependencies: [
          {
            local_dependency_id: "dep_bad",
            task_local_id: "local_img_sb_001",
            depends_on_local_task_id: "local_from_other_chunk",
            dependency_type: "requires_output",
          },
        ],
      };
    });

    await expect(generateAssetPlan(makeInput(gateway))).rejects.toThrow(
      /asset_planning_chunk_dependency_local_id_missing/u,
    );
  });

  it("returns a plan that validation can flag when video lacks static fallback", async () => {
    const { gateway } = makeGateway((options) => {
      const input = options.input as {
        planning_mode: "global" | "segment_chunk";
        chunk?: { segment_ids: string[] };
      };
      if (input.planning_mode === "global") {
        return validGlobalPlanningDraft;
      }
      const segmentId = input.chunk?.segment_ids[0] ?? "sb_001";
      const segment = baseStoryboardPlan.segments.find(
        (candidate) => candidate.segment_id === segmentId,
      ) ?? baseStoryboardPlan.segments[0];
      return {
        planning_mode: "segment_chunk",
        chunk_id: "chunk_video_only",
        tasks: [
          {
            local_task_id: `local_video_${segment.segment_id}`,
            task_type: "video_clip",
            source_segment_id: segment.segment_id,
            source_excerpt: segment.script_excerpt,
            production_intent: "生成真视频候选",
            recommended_mode: "manual_preferred",
            provider_hint: "video_provider",
            prompt_draft: `战国历史短视频，${segment.scene_description}`,
            parameters: {},
            manual_upload_policy: {
              allowed: true,
              required: false,
              accepted_file_types: ["video/mp4"],
              acceptance_notes: [],
            },
            risk_notes: [],
            cost_tier: "high",
          },
        ],
        dependencies: [],
        budget_notes: [],
      };
    });

    const plan = await generateAssetPlan(makeInput(gateway, 3));

    expect(plan.tasks.some((task) => task.task_type === "video_clip")).toBe(true);
    expect(plan.tasks.every((task) => task.task_type !== "image_still")).toBe(true);
  });

  it("enforces image budget unless support images include an explicit reason", async () => {
    const { gateway } = makeGateway((options) => {
      const input = options.input as {
        planning_mode: "global" | "segment_chunk";
        chunk?: { segment_ids: string[] };
      };
      if (input.planning_mode === "global") {
        return validGlobalPlanningDraft;
      }
      const draft = validChunkPlanningDraftFor(input.chunk?.segment_ids ?? []);
      return {
        ...draft,
        tasks: [
          ...draft.tasks,
          {
            ...draft.tasks[0],
            local_task_id: "local_support_without_reason",
            parameters: {
              image_role: "support",
            },
          },
        ],
      };
    });

    await expect(generateAssetPlan(makeInput(gateway, 3))).rejects.toThrow(
      /asset_planning_support_image_reason_missing/u,
    );
  });
});
