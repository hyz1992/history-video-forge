import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

import { AssetPlan, type ResolvedSegmentVisualRoute, type ScriptDraftPackage, type StoryboardPlan } from "../../../shared/src/index.js";
import type {
  InvokeStructuredPromptOptions,
  LlmGateway,
} from "../../../backend/src/runtime/llm/llm-gateway.js";
import { LlmOutputError } from "../../../backend/src/runtime/llm/llm-output-error.js";
import { ExternalServiceError } from "../../../backend/src/runtime/llm/external-errors.js";
import type { LlmInteractionLogEntry } from "../../../backend/src/runtime/llm/interaction-log.js";
import {
  buildGlobalPlanningStructuralRepairInput,
  generateAssetPlan,
  parseSegmentIntentRepairPatch,
  type GlobalDraftStructureEvent,
  type AssetPlanningResilienceEvent,
  type IntentChunkSettledEvent,
} from "../../../backend/src/modules/asset-planning/asset-planning-generation.service.js";

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

const missingPropNotesFixture = JSON.parse(
  readFileSync(
    new URL(
      "../../fixtures/asset-planning/global-draft-props-missing-consistency-notes.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as Record<string, unknown>;

const legacyChunkRepairWrapperFixture = JSON.parse(
  readFileSync(
    new URL(
      "../../fixtures/asset-planning/legacy-chunk-repair-wrapper-drift.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as Record<string, unknown>;

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

function makeInput(
  llmGateway: LlmGateway,
  chunkSize = 2,
  storyboard: StoryboardPlan = baseStoryboardPlan,
) {
  return {
    sourceStoryboardRecordId: "storyboard_record_1",
    sourceScriptRecordId: "script_record_1",
    sourceTopicPackageId: "topic_package_1",
    storyboard,
    draft: baseScriptDraft,
    topicBoundaryContext: baseTopicBoundaryContext,
    segmentVisualRoutes: makeSegmentRoutes(storyboard),
    llmGateway,
    chunkSize,
  };
}

/** S2-2A 任务 5：从 storyboard 构造 resolver 输出的路线输入（测试辅助）。 */
function makeSegmentRoutes(
  storyboard: StoryboardPlan,
): Map<string, ResolvedSegmentVisualRoute> {
  return new Map(
    storyboard.segments.map((segment) => [
      segment.segment_id,
      {
        segment_id: segment.segment_id,
        segment_override: null,
        api_video_suitability: segment.api_video_suitability,
        resolved_route:
          segment.api_video_suitability === "api_video_beneficial" ||
          segment.api_video_suitability === "api_video_strongly_recommended"
            ? "api_video"
            : "remotion",
        reason_code: "test_route",
      },
    ]),
  );
}

function deferred<T = void>() {
  let resolvePromise!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolve) => { resolvePromise = resolve; });
  return { promise, resolve: resolvePromise };
}

function interactionEntry(attemptCount: number): LlmInteractionLogEntry {
  return {
    generatedAt: "2026-08-10T00:00:00.000Z", provider: "test", model: "test",
    operationName: "private", promptId: "private", promptStage: "asset_planning",
    promptLanguage: "zh-CN", promptFilePath: "private", systemPrompt: "RAW_SECRET",
    input: { private: true }, rawOutput: "RAW_SECRET", promptSha256: "hash", promptVersion: "1",
    attempts: Array.from({ length: attemptCount }, (_, index) => ({
      attempt: index + 1, startedAt: "a", finishedAt: "b", durationMs: 1,
      outcome: index + 1 === attemptCount ? "success" as const : "error" as const,
    })),
  };
}

type PromptSegmentLike = {
  segment_id: string;
  resolved_visual_route: "api_video" | "remotion";
};

function validIntentDraftFor(segments: PromptSegmentLike[], first: boolean) {
  return {
    planning_mode: "segment_intent_batch",
    segments: segments.map((segment, index) => ({
      source_segment_id: segment.segment_id,
      intents: [
        {
          asset_kind: "image_still",
          production_intent: `生成 ${segment.segment_id} 主视觉`,
          image_prompt: `历史写实画面，${segment.scene_description}`,
          video_prompt_reserve: `历史写实视频，${segment.scene_description}`,
          image_role: "anchor",
          support_reason: null,
          risk_notes: ["避免现代元素"],
        },
        ...(segment.resolved_visual_route === "api_video"
          ? [
              {
                asset_kind: "video_clip",
                production_intent: `为 ${segment.segment_id} 生成视频`,
                video_prompt: `历史写实视频，${segment.scene_description}`,
                why_static_insufficient: "动作连续性必须由视频表达",
                risk_notes: ["避免现代元素"],
              },
              {
                asset_kind: "render_motion_cue",
                production_intent: `为 ${segment.segment_id} 添加轻微运镜`,
                risk_notes: ["保持主体稳定"],
              },
            ]
          : [{
              asset_kind: "render_motion_cue",
              production_intent: `为 ${segment.segment_id} 添加轻微运镜`,
              risk_notes: ["保持主体稳定"],
            }]),
        ...(first && index === 0
          ? [{
              asset_kind: "bgm_cue",
              production_intent: "生成全片克制底乐",
              required_tags: ["克制"],
              mood_tags: ["紧张"],
              selection_label: "全片底乐",
              timing_basis: "tts",
              scope: "global",
              segment_ids: [],
              volume: 0.35,
              fade_in_sec: 0.5,
              fade_out_sec: 1,
              risk_notes: [],
            }]
          : []),
      ],
    })),
    budget_notes: ["intent compiler 测试预算"],
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
  it("repairs an invalid intent chunk once with a strict replace_field patch", async () => {
    const events: IntentChunkSettledEvent[] = [];
    const { gateway, calls } = makeGateway((options) => {
      if (options.promptId === "asset-planning.planner") return validGlobalPlanningDraft;
      if (options.promptId === "asset-planning.segment-intent-planner") {
        const promptInput = options.input as { segments: PromptSegmentLike[]; is_first_chunk: boolean };
        const invalid = validIntentDraftFor(promptInput.segments, promptInput.is_first_chunk);
        delete (invalid.segments[0]!.intents[0] as { production_intent?: string }).production_intent;
        return invalid;
      }
      if (options.promptId === "asset-planning.segment-intent-repair") {
        return {
          patch_type: "segment_asset_intent_repair",
          operations: [{ operation: "replace_field", path: ["segments", 0, "intents", 0, "production_intent"], value: "修复后的制作意图" }],
        };
      }
      throw new Error(`unexpected_prompt:${options.promptId}`);
    });

    const plan = await generateAssetPlan({
      ...makeInput(gateway, 3),
      generationMode: "intent_compiler",
      onIntentChunkSettled: (event) => events.push(event),
    });

    expect(AssetPlan.parse(plan)).toEqual(plan);
    expect(calls.map((call) => call.promptId)).toEqual([
      "asset-planning.planner",
      "asset-planning.segment-intent-planner",
      "asset-planning.segment-intent-repair",
    ]);
    expect(calls.slice(1).every((call) => call.options?.maxAttempts === 2)).toBe(true);
    expect(events.at(-1)).toMatchObject({
      type: "intent_chunk_settled", chunk_id: "chunk_001", outcome: "success",
      status: "compiled", stage: "repaired",
    });
  });

  it("accepts the bounded patch_fields wrapper drift and append_intent repair", async () => {
    const { gateway, calls } = makeGateway((options) => {
      if (options.promptId === "asset-planning.planner") return validGlobalPlanningDraft;
      if (options.promptId === "asset-planning.segment-intent-planner") {
        const promptInput = options.input as { segments: PromptSegmentLike[]; is_first_chunk: boolean };
        const invalid = validIntentDraftFor(promptInput.segments, promptInput.is_first_chunk);
        invalid.segments[0]!.intents = invalid.segments[0]!.intents.filter((intent) => intent.asset_kind !== "render_motion_cue");
        return invalid;
      }
      if (options.promptId === "asset-planning.segment-intent-repair") {
        return { patch_fields: { operations: [{
          operation: "append_intent", segment_id: "sb_001", expected_kind: "render_motion_cue",
          value: { asset_kind: "render_motion_cue", production_intent: "增加轻微运镜", risk_notes: ["保持主体稳定"] },
        }] } };
      }
      throw new Error(`unexpected_prompt:${options.promptId}`);
    });
    await expect(generateAssetPlan({ ...makeInput(gateway, 3), generationMode: "intent_compiler" })).resolves.toMatchObject({ plan_version: "asset_plan_v1" });
    expect(calls.filter((call) => call.promptId === "asset-planning.segment-intent-repair")).toHaveLength(1);
  });

  it("regenerates only once after repair failure and never repairs regenerated output", async () => {
    let plannerCalls = 0;
    const { gateway, calls } = makeGateway((options) => {
      if (options.promptId === "asset-planning.planner") return validGlobalPlanningDraft;
      if (options.promptId === "asset-planning.segment-intent-planner") {
        plannerCalls += 1;
        const promptInput = options.input as { segments: StoryboardPlan["segments"]; is_first_chunk: boolean; regeneration_context?: unknown };
        expect(options.options).toEqual({ maxAttempts: 2 });
        if (plannerCalls === 2) {
          expect(promptInput.regeneration_context).toEqual({ reason: "segment_intent_repair_failed", instruction: "重新生成当前 chunk 的完整 intent batch" });
          expect(JSON.stringify(promptInput.regeneration_context)).not.toContain("issues");
        }
        const invalid = validIntentDraftFor(promptInput.segments, promptInput.is_first_chunk);
        delete (invalid.segments[0]!.intents[0] as { production_intent?: string }).production_intent;
        return invalid;
      }
      if (options.promptId === "asset-planning.segment-intent-repair") return { operations: [] };
      throw new Error(`unexpected_prompt:${options.promptId}`);
    });
    const failure = await generateAssetPlan({ ...makeInput(gateway, 3), generationMode: "intent_compiler" }).catch((error) => error);
    expect(failure).toMatchObject({ code: "asset_segment_intent_invalid" });
    expect(calls.map((call) => call.promptId)).toEqual([
      "asset-planning.planner", "asset-planning.segment-intent-planner",
      "asset-planning.segment-intent-repair", "asset-planning.segment-intent-planner",
    ]);
  });

  it("accepts one regenerated chunk after a repair patch schema failure", async () => {
    let plannerCalls = 0;
    const events: IntentChunkSettledEvent[] = [];
    const { gateway, calls } = makeGateway((options) => {
      if (options.promptId === "asset-planning.planner") return validGlobalPlanningDraft;
      options.interactionLogWriter?.write(interactionEntry(1));
      if (options.promptId === "asset-planning.segment-intent-planner") {
        plannerCalls += 1;
        const promptInput = options.input as { segments: PromptSegmentLike[]; is_first_chunk: boolean };
        const draft = validIntentDraftFor(promptInput.segments, promptInput.is_first_chunk);
        if (plannerCalls === 1) {
          delete (draft.segments[0]!.intents[0] as { production_intent?: string }).production_intent;
        }
        return draft;
      }
      if (options.promptId === "asset-planning.segment-intent-repair") return { patch_fields: { operations: [], unexpected: true } };
      throw new Error(`unexpected_prompt:${options.promptId}`);
    });
    await expect(generateAssetPlan({
      ...makeInput(gateway, 3), generationMode: "intent_compiler",
      onIntentChunkSettled: (event) => events.push(event),
    })).resolves.toMatchObject({ plan_version: "asset_plan_v1" });
    expect(calls.map((call) => call.promptId)).toEqual([
      "asset-planning.planner", "asset-planning.segment-intent-planner",
      "asset-planning.segment-intent-repair", "asset-planning.segment-intent-planner",
    ]);
    expect(events.at(-1)).toMatchObject({
      type: "intent_chunk_settled",
      status: "compiled",
      stage: "regenerated",
      accounting: {
        business_slot: 3, logical_invocation: 3, safety_invocation: 0,
        provider_attempts: 3, network_request_count: 3,
      },
    });
  });

  it("isolates sync and async progress/resilience callback failures", async () => {
    const { gateway } = makeGateway((options) => {
      if (options.promptId === "asset-planning.planner") return validGlobalPlanningDraft;
      const promptInput = options.input as { segments: PromptSegmentLike[]; is_first_chunk: boolean };
      return validIntentDraftFor(promptInput.segments, promptInput.is_first_chunk);
    });
    await expect(generateAssetPlan({
      ...makeInput(gateway, 3), generationMode: "intent_compiler",
      onProgress: () => { throw new Error("sync callback"); },
      onIntentChunkSettled: async (event) => { (event as { chunk_id?: string }).chunk_id = "mutated"; throw new Error("async callback"); },
    })).resolves.toMatchObject({ plan_version: "asset_plan_v1" });
  });

  it("isolates interaction log writer failures without losing settled accounting", async () => {
    const events: IntentChunkSettledEvent[] = [];
    const writer = { write: vi.fn(() => { throw new Error("trace_writer_failed"); }) };
    const { gateway } = makeGateway((options) => {
      if (options.promptId === "asset-planning.planner") return validGlobalPlanningDraft;
      options.interactionLogWriter?.write(interactionEntry(2));
      const promptInput = options.input as { segments: PromptSegmentLike[]; is_first_chunk: boolean };
      return validIntentDraftFor(promptInput.segments, promptInput.is_first_chunk);
    });

    await expect(generateAssetPlan({
      ...makeInput(gateway, 3), generationMode: "intent_compiler",
      interactionLogWriter: writer,
      onIntentChunkSettled: (event) => events.push(event),
    })).resolves.toMatchObject({ plan_version: "asset_plan_v1" });
    expect(writer.write).toHaveBeenCalled();
    expect(events[0]).toMatchObject({
      status: "compiled",
      accounting: { provider_attempts: 2, network_request_count: 2 },
    });
  });

  it("reports actual per-chunk interaction attempts and one bounded safety invocation", async () => {
    const events: IntentChunkSettledEvent[] = [];
    let intentInvocation = 0;
    const { gateway, calls } = makeGateway(async (options) => {
      if (options.promptId === "asset-planning.planner") return validGlobalPlanningDraft;
      intentInvocation += 1;
      await options.interactionLogWriter?.write(interactionEntry(intentInvocation === 1 ? 2 : 1));
      if (intentInvocation === 1) throw { code: "content_filter", status: 400 };
      const promptInput = options.input as { segments: PromptSegmentLike[]; is_first_chunk: boolean };
      return validIntentDraftFor(promptInput.segments, promptInput.is_first_chunk);
    });
    await generateAssetPlan({
      ...makeInput(gateway, 3), generationMode: "intent_compiler",
      onIntentChunkSettled: (event) => events.push(event),
    });
    const settled = events.find((event) => event.type === "intent_chunk_settled");
    expect(settled).toEqual({
      type: "intent_chunk_settled", chunk_id: "chunk_001", chunk_index: 0,
      outcome: "success", status: "compiled", stage: "generated",
      compiler_actions: ["global_bgm_owner_bound", "visual_strategy_applied"],
      visual_route_decisions: [
        { segment_id: "sb_001", route: "remotion", reason_code: "test_route" },
        { segment_id: "sb_002", route: "remotion", reason_code: "test_route" },
        { segment_id: "sb_003", route: "remotion", reason_code: "test_route" },
      ],
      accounting: {
        chunk_id: "chunk_001", business_slot: 1, logical_invocation: 2,
        safety_invocation: 1, provider_attempts: 3, network_request_count: 3,
      },
    });
    expect(JSON.stringify(settled)).not.toContain("RAW_SECRET");
    expect(calls.slice(1).every((call) => call.options?.maxAttempts === 2)).toBe(true);
    expect(calls).toHaveLength(3);
  });

  it("does not safety-retry repair content filtering and proceeds directly to regeneration", async () => {
    const settled: IntentChunkSettledEvent[] = [];
    let plannerCalls = 0;
    const { gateway, calls } = makeGateway((options) => {
      if (options.promptId === "asset-planning.planner") return validGlobalPlanningDraft;
      options.interactionLogWriter?.write(interactionEntry(1));
      if (options.promptId === "asset-planning.segment-intent-repair") {
        throw { code: "content_filter", status: 400 };
      }
      plannerCalls += 1;
      const promptInput = options.input as { segments: PromptSegmentLike[]; is_first_chunk: boolean };
      const draft = validIntentDraftFor(promptInput.segments, promptInput.is_first_chunk);
      if (plannerCalls === 1) {
        delete (draft.segments[0]!.intents[0] as { production_intent?: string }).production_intent;
      }
      return draft;
    });
    await generateAssetPlan({
      ...makeInput(gateway, 3), generationMode: "intent_compiler",
      onIntentChunkSettled: (event) => settled.push(event),
    });
    expect(calls.map((call) => call.promptId)).toEqual([
      "asset-planning.planner",
      "asset-planning.segment-intent-planner",
      "asset-planning.segment-intent-repair",
      "asset-planning.segment-intent-planner",
    ]);
    expect(calls[3]!.input).toHaveProperty("regeneration_context");
    expect(settled[0]!.accounting).toMatchObject({
      business_slot: 3, logical_invocation: 3, safety_invocation: 0,
    });
  });

  it("rethrows an ordinary repair gateway programming error without regeneration", async () => {
    const programmingError = new Error("repair_programming_bug");
    const { gateway, calls } = makeGateway((options) => {
      if (options.promptId === "asset-planning.planner") return validGlobalPlanningDraft;
      if (options.promptId === "asset-planning.segment-intent-repair") throw programmingError;
      const promptInput = options.input as { segments: PromptSegmentLike[]; is_first_chunk: boolean };
      const draft = validIntentDraftFor(promptInput.segments, promptInput.is_first_chunk);
      delete (draft.segments[0]!.intents[0] as { production_intent?: string }).production_intent;
      return draft;
    });
    const failure = await generateAssetPlan({ ...makeInput(gateway, 3), generationMode: "intent_compiler" }).catch((error) => error);
    expect(failure).toBe(programmingError);
    expect(calls.map((call) => call.promptId)).toEqual([
      "asset-planning.planner", "asset-planning.segment-intent-planner",
      "asset-planning.segment-intent-repair",
    ]);
  });

  it("regenerates after an ExternalServiceError from repair", async () => {
    let plannerCalls = 0;
    const repairFailure = new ExternalServiceError({
      provider: "llm", operation: "repair", retryable: true,
      code: "service_unavailable", userMessage: "repair unavailable",
      debugMessage: "repair unavailable", attemptCount: 2,
    });
    const { gateway, calls } = makeGateway((options) => {
      if (options.promptId === "asset-planning.planner") return validGlobalPlanningDraft;
      if (options.promptId === "asset-planning.segment-intent-repair") throw repairFailure;
      plannerCalls += 1;
      const promptInput = options.input as { segments: PromptSegmentLike[]; is_first_chunk: boolean };
      const draft = validIntentDraftFor(promptInput.segments, promptInput.is_first_chunk);
      if (plannerCalls === 1) delete (draft.segments[0]!.intents[0] as { production_intent?: string }).production_intent;
      return draft;
    });
    await expect(generateAssetPlan({ ...makeInput(gateway, 3), generationMode: "intent_compiler" })).resolves.toMatchObject({ plan_version: "asset_plan_v1" });
    expect(calls.at(-1)!.promptId).toBe("asset-planning.segment-intent-planner");
    expect(calls.at(-1)!.input).toHaveProperty("regeneration_context");
  });

  it("preserves a regeneration ExternalServiceError and its failure metadata", async () => {
    let plannerCalls = 0;
    const regenerationFailure = new ExternalServiceError({
      provider: "llm", operation: "regeneration", retryable: false,
      code: "invalid_request", userMessage: "regen failed",
      debugMessage: "regen failed", attemptCount: 1,
    });
    const { gateway, calls } = makeGateway((options) => {
      if (options.promptId === "asset-planning.planner") return validGlobalPlanningDraft;
      if (options.promptId === "asset-planning.segment-intent-repair") return { operations: [] };
      plannerCalls += 1;
      if (plannerCalls === 2) throw regenerationFailure;
      const promptInput = options.input as { segments: PromptSegmentLike[]; is_first_chunk: boolean };
      const draft = validIntentDraftFor(promptInput.segments, promptInput.is_first_chunk);
      delete (draft.segments[0]!.intents[0] as { production_intent?: string }).production_intent;
      return draft;
    });
    const failure = await generateAssetPlan({ ...makeInput(gateway, 3), generationMode: "intent_compiler" }).catch((error) => error);
    expect(failure).toBe(regenerationFailure);
    expect(failure).toBeInstanceOf(ExternalServiceError);
    expect(failure).toMatchObject({
      code: "invalid_request",
      failureMetadata: { failure_reason: "invalid_request", attempt_count: 1 },
    });
    expect(calls).toHaveLength(4);
  });

  it("counts a logical invocation when the gateway throws before writing an interaction entry", async () => {
    const gatewayFailure = new Error("gateway_sync_failure");
    const settled: IntentChunkSettledEvent[] = [];
    const { gateway } = makeGateway((options) => {
      if (options.promptId === "asset-planning.planner") return validGlobalPlanningDraft;
      throw gatewayFailure;
    });
    const failure = await generateAssetPlan({
      ...makeInput(gateway, 3), generationMode: "intent_compiler",
      onIntentChunkSettled: (event) => settled.push(event),
    }).catch((error) => error);
    expect(failure).toBe(gatewayFailure);
    expect(settled[0]).toMatchObject({
      outcome: "failure",
      accounting: {
        business_slot: 1, logical_invocation: 1, safety_invocation: 0,
        provider_attempts: 0, network_request_count: 0,
      },
    });
  });

  it("maps an arbitrary valid-looking chunk error code to the frozen business fallback", async () => {
    const secretFailure = Object.assign(new Error("TOP_SECRET_MESSAGE"), {
      code: "secret_token_123",
    });
    const settled: IntentChunkSettledEvent[] = [];
    const { gateway } = makeGateway((options) => {
      if (options.promptId === "asset-planning.planner") return validGlobalPlanningDraft;
      throw secretFailure;
    });

    const failure = await generateAssetPlan({
      ...makeInput(gateway, 3),
      generationMode: "intent_compiler",
      onIntentChunkSettled: (event) => settled.push(event),
    }).catch((error) => error);

    expect(failure).toBe(secretFailure);
    expect(settled[0]).toMatchObject({
      status: "failed",
      error_code: "intent_chunk_business_failed",
      failure_class: "business",
    });
    expect(JSON.stringify(settled)).not.toContain("secret_token_123");
    expect(JSON.stringify(settled)).not.toContain("TOP_SECRET_MESSAGE");
  });

  it("uses fixed warning codes when callbacks expose secret error messages", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const { gateway } = makeGateway((options) => {
        if (options.promptId === "asset-planning.planner") return validGlobalPlanningDraft;
        const promptInput = options.input as { segments: PromptSegmentLike[]; is_first_chunk: boolean };
        return validIntentDraftFor(promptInput.segments, promptInput.is_first_chunk);
      });
      await generateAssetPlan({
        ...makeInput(gateway, 3),
        generationMode: "intent_compiler",
        onProgress: () => { throw new Error("TOP_SECRET_PROGRESS"); },
        onGlobalStructureEvent: () => { throw new Error("TOP_SECRET_GLOBAL"); },
        onIntentChunkSettled: () => { throw new Error("TOP_SECRET_SETTLED"); },
      });
      const serializedWarnings = JSON.stringify(warning.mock.calls);
      expect(serializedWarnings).not.toContain("TOP_SECRET");
      expect(warning.mock.calls.flat()).toEqual(expect.arrayContaining([
        "[asset-planning] progress_callback_failed",
        "[asset-planning] intent_chunk_settled_callback_failed",
      ]));
    } finally {
      warning.mockRestore();
    }
  });

  it("gives initial and regeneration independent safety quotas while capping five logical invocations at ten attempts", async () => {
    const settled: IntentChunkSettledEvent[] = [];
    let plannerCalls = 0;
    const { gateway, calls } = makeGateway((options) => {
      if (options.promptId === "asset-planning.planner") return validGlobalPlanningDraft;
      options.interactionLogWriter?.write(interactionEntry(2));
      if (options.promptId === "asset-planning.segment-intent-repair") {
        return { operations: [] };
      }
      plannerCalls += 1;
      if (plannerCalls === 1 || plannerCalls === 3) {
        throw { code: "content_filter", status: 400 };
      }
      const promptInput = options.input as { segments: PromptSegmentLike[]; is_first_chunk: boolean };
      const draft = validIntentDraftFor(promptInput.segments, promptInput.is_first_chunk);
      if (plannerCalls === 2) {
        delete (draft.segments[0]!.intents[0] as { production_intent?: string }).production_intent;
      }
      return draft;
    });
    await generateAssetPlan({
      ...makeInput(gateway, 3), generationMode: "intent_compiler",
      onIntentChunkSettled: (event) => settled.push(event),
    });
    expect(calls.map((call) => call.promptId)).toEqual([
      "asset-planning.planner",
      "asset-planning.segment-intent-planner",
      "asset-planning.segment-intent-planner",
      "asset-planning.segment-intent-repair",
      "asset-planning.segment-intent-planner",
      "asset-planning.segment-intent-planner",
    ]);
    expect(calls.slice(1).every((call) => call.options?.maxAttempts === 2)).toBe(true);
    expect(calls[2]!.input).toHaveProperty("safety_retry_context");
    expect(calls[5]!.input).toMatchObject({
      regeneration_context: expect.any(Object),
      safety_retry_context: expect.any(Object),
    });
    expect(settled[0]!.accounting).toEqual({
      chunk_id: "chunk_001", business_slot: 3, logical_invocation: 5,
      safety_invocation: 2, provider_attempts: 10, network_request_count: 10,
    });
  });

  it("routes settled accounting only to its dedicated cloned callback", async () => {
    const globalEvents: AssetPlanningResilienceEvent[] = [];
    const settledEvents: IntentChunkSettledEvent[] = [];
    const { gateway } = makeGateway((options) => {
      if (options.promptId === "asset-planning.planner") return validGlobalPlanningDraft;
      const promptInput = options.input as { segments: PromptSegmentLike[]; is_first_chunk: boolean };
      return validIntentDraftFor(promptInput.segments, promptInput.is_first_chunk);
    });
    await generateAssetPlan({
      ...makeInput(gateway, 3), generationMode: "intent_compiler",
      onGlobalStructureEvent: (event) => globalEvents.push(event),
      onIntentChunkSettled: (event) => {
        settledEvents.push(structuredClone(event));
        (event as { chunk_id: string }).chunk_id = "mutated";
      },
    });
    expect(globalEvents).toEqual([]);
    expect(settledEvents).toEqual([
      expect.objectContaining({ type: "intent_chunk_settled", chunk_id: "chunk_001" }),
    ]);
  });

  it.each(["sync", "async"] as const)(
    "isolates %s dedicated settled callback failure",
    async (mode) => {
      const { gateway } = makeGateway((options) => {
        if (options.promptId === "asset-planning.planner") return validGlobalPlanningDraft;
        const promptInput = options.input as { segments: PromptSegmentLike[]; is_first_chunk: boolean };
        return validIntentDraftFor(promptInput.segments, promptInput.is_first_chunk);
      });
      await expect(generateAssetPlan({
        ...makeInput(gateway, 3), generationMode: "intent_compiler",
        onIntentChunkSettled(event) {
          (event as { chunk_id: string }).chunk_id = "mutated";
          if (mode === "sync") throw new Error("sync settled callback");
          return Promise.reject(new Error("async settled callback"));
        },
      })).resolves.toMatchObject({ plan_version: "asset_plan_v1" });
    },
  );

  it("settles only the two started workers, leaves six chunks queued, and selects the lowest chunk failure", async () => {
    const storyboard = makeStoryboardWithSegmentCount(8);
    const chunkOne = deferred<void>();
    const chunkTwo = deferred<void>();
    const started: string[] = [];
    const settled: IntentChunkSettledEvent[] = [];
    const lowerIndexFailure = new LlmOutputError("asset_segment_intent_invalid");
    const firstCompletedFailure = new LlmOutputError("asset_chunk_plan_schema_invalid");
    const { gateway } = makeGateway(async (options) => {
      if (options.promptId === "asset-planning.planner") return validGlobalPlanningDraft;
      const promptInput = options.input as { chunk_id: string };
      started.push(promptInput.chunk_id);
      if (promptInput.chunk_id === "chunk_001") {
        await chunkOne.promise;
        throw lowerIndexFailure;
      }
      if (promptInput.chunk_id === "chunk_002") {
        await chunkTwo.promise;
        throw firstCompletedFailure;
      }
      throw new Error(`queued_chunk_was_started:${promptInput.chunk_id}`);
    });

    const running = generateAssetPlan({
      ...makeInput(gateway, 1, storyboard),
      generationMode: "intent_compiler",
      chunkConcurrency: 2,
      onIntentChunkSettled: (event) => settled.push(event),
    }).catch((error: unknown) => error);
    await waitUntil(() => started.length === 2);
    chunkTwo.resolve();
    await new Promise<void>((resolveImmediate) => setImmediate(resolveImmediate));
    expect(started).toEqual(["chunk_001", "chunk_002"]);
    chunkOne.resolve();

    const failure = await running;
    expect(failure).toBe(lowerIndexFailure);
    expect(started).toEqual(["chunk_001", "chunk_002"]);
    expect(settled).toHaveLength(8);
    expect(settled.slice(0, 2)).toEqual([
      expect.objectContaining({ chunk_id: "chunk_001", chunk_index: 0, status: "failed", stage: "generated" }),
      expect.objectContaining({ chunk_id: "chunk_002", chunk_index: 1, status: "failed", stage: "generated" }),
    ]);
    expect(settled.slice(2)).toEqual(
      Array.from({ length: 6 }, (_, index) => expect.objectContaining({
        chunk_id: `chunk_${String(index + 3).padStart(3, "0")}`,
        chunk_index: index + 2,
        status: "queued",
        stage: "queued",
        accounting: expect.objectContaining({ logical_invocation: 0, provider_attempts: 0 }),
      })),
    );
    expect((failure as { intentChunkDiagnostics?: unknown }).intentChunkDiagnostics).toMatchObject({
      started_failure_count: 2,
      attached_failures: [
        expect.objectContaining({ chunk_id: "chunk_002", error_code: "asset_chunk_plan_schema_invalid" }),
      ],
    });
  });

  it("rejects non-plain repair outers without invoking getters or proxy traps", () => {
    let getterCalls = 0;
    let proxyTraps = 0;
    const getterOuter = {} as Record<string, unknown>;
    Object.defineProperty(getterOuter, "operations", {
      enumerable: true,
      get() { getterCalls += 1; return []; },
    });
    const proxy = new Proxy({ operations: [] }, {
      get() { proxyTraps += 1; return undefined; },
      ownKeys() { proxyTraps += 1; return []; },
      getOwnPropertyDescriptor() { proxyTraps += 1; return undefined; },
      getPrototypeOf() { proxyTraps += 1; return Object.prototype; },
    });
    expect(() => parseSegmentIntentRepairPatch(getterOuter)).toThrow();
    expect(() => parseSegmentIntentRepairPatch(proxy)).toThrow();
    expect(getterCalls).toBe(0);
    expect(proxyTraps).toBe(0);
  });

  it.each([
    ["null prototype", () => Object.assign(Object.create(null), { operations: [] })],
    ["custom prototype", () => Object.assign(Object.create({ inherited: true }), { operations: [] })],
    ["non-enumerable sibling", () => {
      const value = { operations: [] } as Record<string, unknown>;
      Object.defineProperty(value, "secret", { value: "RAW_SECRET", enumerable: false });
      return value;
    }],
    ["symbol sibling", () => ({ operations: [], [Symbol("secret")]: "RAW_SECRET" })],
    ["nested wrapper", () => ({ patch_fields: { patch_fields: { operations: [] } } })],
    ["wrapper sibling", () => ({ patch_fields: { operations: [] }, secret: "RAW_SECRET" })],
  ] as const)("rejects unsafe repair outer: %s", (_label, factory) => {
    let failure: unknown;
    try { parseSegmentIntentRepairPatch(factory()); } catch (error) { failure = error; }
    expect(failure).toBeDefined();
    expect(JSON.stringify(failure)).not.toContain("RAW_SECRET");
  });

  it("keeps canonical, exact missing-discriminator, and one exact wrapper compatible", () => {
    const operation = {
      operation: "replace_field", path: ["segments", 0, "intents", 0, "production_intent"], value: "修复",
    };
    for (const candidate of [
      { patch_type: "segment_asset_intent_repair", operations: [operation] },
      { operations: [operation] },
      { patch_fields: { operations: [operation] } },
    ]) {
      expect(parseSegmentIntentRepairPatch(candidate)).toMatchObject({
        patch_type: "segment_asset_intent_repair", operations: [operation],
      });
    }
  });

  it("uses exactly one intent planner call per chunk and compiles in storyboard order", async () => {
    const storyboard = structuredClone(baseStoryboardPlan);
    storyboard.segments[0]!.api_video_suitability = "api_video_strongly_recommended";
    storyboard.segments[1]!.api_video_suitability = "remotion_sufficient";
    storyboard.segments[2]!.api_video_suitability = "remotion_sufficient";
    const settled: IntentChunkSettledEvent[] = [];
    const { gateway, calls } = makeGateway(async (options) => {
      if (options.promptId === "asset-planning.planner") return validGlobalPlanningDraft;
      if (options.promptId === "asset-planning.segment-intent-planner") {
        const promptInput = options.input as { is_first_chunk: boolean; segments: StoryboardPlan["segments"] };
        if (promptInput.is_first_chunk) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        return validIntentDraftFor(promptInput.segments, promptInput.is_first_chunk);
      }
      throw new Error(`unexpected_prompt:${options.promptId}`);
    });

    const plan = await generateAssetPlan({
      ...makeInput(gateway, 2, storyboard),
      generationMode: "intent_compiler",
      onIntentChunkSettled: (event) => settled.push(event),
    });
    // 缺口3：编译后事件必须携带每段 route 决策（segment_id/route/reason_code）
    expect(settled[0]).toMatchObject({
      type: "intent_chunk_settled",
      status: "compiled",
      visual_route_decisions: [
        { segment_id: "sb_001", route: "api_video", reason_code: "test_route" },
        { segment_id: "sb_002", route: "remotion", reason_code: "test_route" },
      ],
    });

    expect(AssetPlan.parse(plan)).toEqual(plan);
    expect(calls.filter((call) => call.promptId === "asset-planning.planner")).toHaveLength(1);
    expect(calls.filter((call) => call.promptId === "asset-planning.segment-intent-planner")).toHaveLength(2);
    expect(calls.some((call) => call.promptId.includes("repair"))).toBe(false);
    expect(plan.tasks.map((task) => task.order)).toEqual(
      plan.tasks.map((_, index) => index),
    );
    expect(plan.tasks.find((task) => task.source_segment_id === "sb_001" && task.task_type === "video_clip"))
      .toBeDefined();
    expect(plan.tasks.find((task) => task.source_segment_id === "sb_002" && task.task_type === "render_motion_cue"))
      .toBeDefined();
    expect(plan.tasks.some((task) => task.source_segment_id === "sb_002" && task.task_type === "video_clip"))
      .toBe(false);
    expect(plan.tasks.filter((task) => task.task_type === "tts_audio" || task.task_type === "subtitle_track"))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ task_id: "tts_001" }),
        expect.objectContaining({ task_id: "subtitle_001" }),
      ]));
  });

  it("mechanically strips live-style unknown intent fields before compiling without repair", async () => {
    const { gateway, calls } = makeGateway((options) => {
      if (options.promptId === "asset-planning.planner") {
        return validGlobalPlanningDraft;
      }
      if (options.promptId === "asset-planning.segment-intent-planner") {
        const promptInput = options.input as {
          is_first_chunk: boolean;
          segments: StoryboardPlan["segments"];
        };
        const draft = validIntentDraftFor(
          promptInput.segments,
          promptInput.is_first_chunk,
        ) as ReturnType<typeof validIntentDraftFor> & Record<string, unknown>;
        draft.live_batch_note = "drop-me";
        (draft.segments[0] as unknown as Record<string, unknown>).live_segment_note =
          "drop-me";
        (draft.segments[0]!.intents[0] as Record<string, unknown>).prompt_draft =
          "drop-me";
        const motion = draft.segments[0]!.intents.find(
          (intent) => intent.asset_kind === "render_motion_cue",
        );
        if (motion) {
          (motion as Record<string, unknown>).motion_prompt = "drop-me";
        }
        const bgm = draft.segments[0]!.intents.find(
          (intent) => intent.asset_kind === "bgm_cue",
        );
        if (bgm) {
          (bgm as Record<string, unknown>).music_description = "drop-me";
        }
        return draft;
      }
      throw new Error(`unexpected_prompt:${options.promptId}`);
    });

    const plan = await generateAssetPlan({
      ...makeInput(gateway, 3),
      generationMode: "intent_compiler",
    });

    expect(AssetPlan.parse(plan)).toEqual(plan);
    expect(calls.map((call) => call.promptId)).toEqual([
      "asset-planning.planner",
      "asset-planning.segment-intent-planner",
    ]);
  });

  it("fails invalid intent output after bounded repair and regeneration without leaking raw output", async () => {
    const rawSecret = `RAW_SECRET_FROM_MODEL_${"x".repeat(300)}`;
    const { gateway, calls } = makeGateway((options) => {
      if (options.promptId === "asset-planning.planner") return validGlobalPlanningDraft;
      if (options.promptId === "asset-planning.segment-intent-repair") {
        return { operations: [] };
      }
      if (options.promptId === "asset-planning.segment-intent-planner") {
        return {
          planning_mode: "segment_intent_batch",
          segments: [{
            source_segment_id: rawSecret,
            intents: [{ asset_kind: "image_still", [rawSecret]: rawSecret }],
          }],
          budget_notes: [],
          [rawSecret]: rawSecret,
        };
      }
      throw new Error(`forbidden_prompt:${options.promptId}`);
    });

    const failure = await generateAssetPlan({
      ...makeInput(gateway, 3),
      generationMode: "intent_compiler",
    }).catch((error: unknown) => error);
    expect(failure).toMatchObject({
      code: "asset_segment_intent_invalid",
      cause: { initial_issues: expect.any(Array), final_issues: expect.any(Array) },
    });
    const serializedFailure = JSON.stringify(failure);
    expect(serializedFailure).not.toContain("RAW_SECRET_FROM_MODEL");
    const safeIssues = (failure as LlmOutputError).cause as {
      initial_issues: Array<{ path: Array<string | number>; segment_id: string | null }>;
    };
    expect(safeIssues.initial_issues.every((issue) => issue.path.length <= 12)).toBe(true);
    expect(safeIssues.initial_issues.every((issue) => issue.segment_id === null || baseStoryboardPlan.segments.some(
      (segment) => segment.segment_id === issue.segment_id,
    ))).toBe(true);
    expect(calls.map((call) => call.promptId)).toEqual([
      "asset-planning.planner",
      "asset-planning.segment-intent-planner",
      "asset-planning.segment-intent-repair",
      "asset-planning.segment-intent-planner",
    ]);
  });

  it("keeps default and explicit legacy behavior identical and never calls intent planner", async () => {
    const defaultRun = makeGateway();
    const explicitRun = makeGateway();
    const defaultPlan = await generateAssetPlan(makeInput(defaultRun.gateway));
    const explicitPlan = await generateAssetPlan({
      ...makeInput(explicitRun.gateway),
      generationMode: "legacy",
    });
    expect(explicitPlan).toEqual(defaultPlan);
    expect([...defaultRun.calls, ...explicitRun.calls].some(
      (call) => call.promptId === "asset-planning.segment-intent-planner",
    )).toBe(false);
    expect([...defaultRun.calls, ...explicitRun.calls].some(
      (call) => call.promptId === "asset-planning.segment-intent-repair",
    )).toBe(false);
  });
  it("normalizes the real eight-prop missing-notes fixture without global repair", async () => {
    const events: GlobalDraftStructureEvent[] = [];
    const { gateway, calls } = makeGateway((options) => {
      if (options.promptId === "asset-planning.planner") {
        const promptInput = options.input as {
          planning_mode: string;
          chunk?: { segment_ids: string[] };
        };
        if (promptInput.planning_mode === "global") {
          return missingPropNotesFixture;
        }
        return validChunkPlanningDraftFor(promptInput.chunk?.segment_ids ?? []);
      }
      throw new Error(`unexpected_prompt:${options.promptId}`);
    });

    const plan = await generateAssetPlan({
      ...makeInput(gateway),
      onGlobalStructureEvent: (event) => events.push(event),
    });

    expect(AssetPlan.parse(plan)).toEqual(plan);
    expect(calls).toHaveLength(3);
    expect(calls.map((call) => call.promptId)).not.toContain(
      "asset-planning.global-structural-repair",
    );
    expect(events).toEqual([
      {
        type: "normalization_applied",
        actions: Array.from({ length: 8 }, (_, index) => ({
          type: "default_inserted",
          path: `art_bible.props[${index}].consistency_notes`,
        })),
      },
    ]);
  });

  it("removes exact global chunk keys while preserving passthrough fields", async () => {
    const events: GlobalDraftStructureEvent[] = [];
    const pollutedDraft = {
      ...validGlobalPlanningDraft,
      tasks: [{ ignored: true }],
      dependencies: [],
      chunk_id: "wrong-mode",
      budget_notes: [],
      future_global_field: { keep: true },
    };
    const { gateway, calls } = makeGateway((options) => {
      const promptInput = options.input as {
        planning_mode?: string;
        chunk?: { segment_ids: string[] };
      };
      if (promptInput.planning_mode === "global") return pollutedDraft;
      return validChunkPlanningDraftFor(promptInput.chunk?.segment_ids ?? []);
    });

    const plan = await generateAssetPlan({
      ...makeInput(gateway),
      onGlobalStructureEvent: (event) => events.push(event),
    });

    expect(plan.tasks.length).toBeGreaterThan(0);
    expect(calls).toHaveLength(3);
    expect(calls.map((call) => call.promptId)).not.toContain(
      "asset-planning.global-structural-repair",
    );
    expect(events).toEqual([
      {
        type: "normalization_applied",
        actions: [
          {
            type: "forbidden_chunk_key_removed",
            path: "budget_notes",
            key: "budget_notes",
          },
          {
            type: "forbidden_chunk_key_removed",
            path: "chunk_id",
            key: "chunk_id",
          },
          {
            type: "forbidden_chunk_key_removed",
            path: "dependencies",
            key: "dependencies",
          },
          {
            type: "forbidden_chunk_key_removed",
            path: "tasks",
            key: "tasks",
          },
        ],
      },
    ]);
  });

  it.each(["characters", "locations", "props"] as const)(
    "strips nested unknown keys from art_bible.%s without global repair",
    async (collectionKey) => {
      const artBible = {
        ...validGlobalPlanningDraft.art_bible,
        characters: [
          {
            character_id: "character_1",
            label: "人物一",
            role: "核心人物",
            visual_description: "古代人物形象",
            consistency_notes: [],
          },
        ],
        locations: [
          {
            location_id: "location_1",
            label: "场景一",
            role: "主要场景",
            visual_description: "古代宫殿场景",
            consistency_notes: [],
          },
        ],
        props: [
          {
            prop_id: "prop_1",
            label: "道具一",
            role: "关键道具",
            visual_description: "古代木质道具",
            consistency_notes: [],
          },
        ],
      };
      artBible[collectionKey] = artBible[collectionKey].map((entry) => ({
        ...entry,
        extra_note: "模型自发增加的未知字段",
      }));
      const rawGlobalDraft = {
        ...validGlobalPlanningDraft,
        art_bible: artBible,
      };
      const { gateway, calls } = makeGateway((options) => {
        if (options.promptId === "asset-planning.global-structural-repair") {
          throw new Error("nested unknown keys must not trigger global repair");
        }
        const promptInput = options.input as {
          planning_mode?: string;
          chunk?: { segment_ids: string[] };
        };
        if (promptInput.planning_mode === "global") return rawGlobalDraft;
        return validChunkPlanningDraftFor(promptInput.chunk?.segment_ids ?? []);
      });

      const plan = await generateAssetPlan(makeInput(gateway));

      expect(AssetPlan.parse(plan)).toEqual(plan);
      expect(calls).toHaveLength(3);
      expect(calls.map((call) => call.promptId)).not.toContain(
        "asset-planning.global-structural-repair",
      );
      expect(plan.art_bible[collectionKey][0]).not.toHaveProperty("extra_note");
    },
  );

  it("builds a compact leaf repair input and invokes global repair exactly once", async () => {
    const invalidDraft = structuredClone(missingPropNotesFixture) as {
      art_bible: { props: Array<Record<string, unknown>> };
    };
    invalidDraft.art_bible.props[0] = {
      ...invalidDraft.art_bible.props[0],
      consistency_notes: [],
    };
    delete invalidDraft.art_bible.props[0].visual_description;
    const events: GlobalDraftStructureEvent[] = [];
    const { gateway, calls } = makeGateway((options) => {
      if (options.promptId === "asset-planning.global-structural-repair") {
        return {
          patch_type: "global_planning_structural_patch",
          patches: [
            {
              path: ["art_bible", "props", 0, "visual_description"],
              value: "修复后的深色木质小型道具",
            },
          ],
        };
      }
      const promptInput = options.input as {
        planning_mode?: string;
        chunk?: { segment_ids: string[] };
      };
      if (promptInput.planning_mode === "global") return invalidDraft;
      return validChunkPlanningDraftFor(promptInput.chunk?.segment_ids ?? []);
    });

    const plan = await generateAssetPlan({
      ...makeInput(gateway),
      onGlobalStructureEvent: (event) => events.push(event),
    });

    expect(AssetPlan.parse(plan)).toEqual(plan);
    const repairCalls = calls.filter(
      (call) => call.promptId === "asset-planning.global-structural-repair",
    );
    expect(repairCalls).toHaveLength(1);
    expect(repairCalls[0]).toMatchObject({
      operationName: "asset-planning.global-structural-repair",
      options: { maxAttempts: 2 },
    });
    expect(repairCalls[0].input).toEqual({
      normalized_draft: expect.any(Object),
      schema_issues: [
        expect.objectContaining({
          path: ["art_bible", "props", 0, "visual_description"],
        }),
      ],
      allowed_repair_paths: [
        ["art_bible", "props", 0, "visual_description"],
      ],
      repair_context: {},
    });
    expect(Object.keys(repairCalls[0].input as object).sort()).toEqual([
      "allowed_repair_paths",
      "normalized_draft",
      "repair_context",
      "schema_issues",
    ]);
    for (const forbidden of [
      "raw_draft",
      "script_text",
      "tts_plan",
      "storyboard",
      "global_prompt_input",
      "safety_retry_context",
    ]) {
      expect(repairCalls[0].input).not.toHaveProperty(forbidden);
    }
    expect(events.map((event) => event.type)).toEqual([
      "normalization_applied",
      "repair_started",
      "repair_succeeded",
    ]);
  });

  it("adds compact context only for exact root, art bible, or collection issues", () => {
    const normalizedDraft = { planning_mode: "global" };
    const leaf = buildGlobalPlanningStructuralRepairInput({
      normalizedDraft,
      issues: [
        {
          code: "invalid_type",
          path: ["art_bible", "props", 0, "visual_description"],
          message: "Required",
        },
      ],
      topicBoundaryContext: baseTopicBoundaryContext,
      storyboard: baseStoryboardPlan,
    });
    expect(leaf.repair_context).toEqual({});

    for (const path of [
      [],
      ["art_bible"],
      ["art_bible", "characters"],
      ["art_bible", "locations"],
      ["art_bible", "props"],
    ] as Array<Array<string | number>>) {
      const contextual = buildGlobalPlanningStructuralRepairInput({
        normalizedDraft,
        issues: [{ code: "invalid_type", path, message: "Required" }],
        topicBoundaryContext: baseTopicBoundaryContext,
        storyboard: baseStoryboardPlan,
      });
      expect(contextual.repair_context.topic_boundary_context).toEqual(
        baseTopicBoundaryContext,
      );
      expect(contextual.repair_context.storyboard_visual_projection?.[0]).toEqual({
        segment_id: "sb_001",
        narrative_role: "opening",
        scene_description: "楚国殿前，矮门和众人的目光形成压迫。",
        visual_elements: ["楚王", "晏子", "矮门"],
      });
      expect(contextual.repair_context.storyboard_visual_projection?.[0]).not.toHaveProperty(
        "script_excerpt",
      );
    }
  });

  it.each([
    {
      name: "extra path",
      failureStage: "patch" as const,
      expectedPatchIssue: {
        code: "patch_path_not_allowed",
        path: ["manual_review_notes"],
      },
      patch: {
        patch_type: "global_planning_structural_patch",
        patches: [{ path: ["manual_review_notes"], value: [] }],
      },
    },
    {
      name: "parent overwrite",
      failureStage: "patch" as const,
      expectedPatchIssue: {
        code: "patch_path_not_allowed",
        path: ["art_bible", "props", 0],
      },
      patch: {
        patch_type: "global_planning_structural_patch",
        patches: [{ path: ["art_bible", "props", 0], value: {} }],
      },
    },
    {
      name: "duplicate path",
      failureStage: "patch" as const,
      expectedPatchIssue: {
        code: "duplicate_patch_path",
        path: ["art_bible", "props", 0, "visual_description"],
      },
      patch: {
        patch_type: "global_planning_structural_patch",
        patches: [
          {
            path: ["art_bible", "props", 0, "visual_description"],
            value: "a",
          },
          {
            path: ["art_bible", "props", 0, "visual_description"],
            value: "b",
          },
        ],
      },
    },
    {
      name: "still invalid",
      failureStage: "final" as const,
      expectedPatchIssue: null,
      patch: {
        patch_type: "global_planning_structural_patch",
        patches: [
          {
            path: ["art_bible", "props", 0, "visual_description"],
            value: "",
          },
        ],
      },
    },
  ])("fails one bounded repair with separated issue buckets: $name", async ({ patch, failureStage, expectedPatchIssue }) => {
    const invalidDraft = structuredClone(missingPropNotesFixture) as {
      art_bible: { props: Array<Record<string, unknown>> };
    };
    invalidDraft.art_bible.props[0] = {
      ...invalidDraft.art_bible.props[0],
      consistency_notes: [],
    };
    delete invalidDraft.art_bible.props[0].visual_description;
    const events: GlobalDraftStructureEvent[] = [];
    const { gateway, calls } = makeGateway((options) => {
      if (options.promptId === "asset-planning.global-structural-repair") {
        return patch;
      }
      return invalidDraft;
    });

    let caught: unknown;
    try {
      await generateAssetPlan({
        ...makeInput(gateway),
        onGlobalStructureEvent: (event) => events.push(event),
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(LlmOutputError);
    expect((caught as LlmOutputError).code).toBe(
      "asset_global_plan_structural_repair_failed",
    );
    const cause = (caught as LlmOutputError).cause as {
      initial_issues: Array<{ path?: Array<string | number> }>;
      patch_issues: unknown[];
      final_issues: Array<{ path?: Array<string | number> }>;
    };
    expect(cause.initial_issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ["art_bible", "props", 0, "visual_description"],
        }),
      ]),
    );
    if (failureStage === "patch") {
      expect(cause.patch_issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining(expectedPatchIssue ?? {}),
        ]),
      );
      expect(cause.final_issues).toEqual([]);
    } else {
      expect(cause.patch_issues).toEqual([]);
      expect(cause.final_issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ["art_bible", "props", 0, "visual_description"],
          }),
        ]),
      );
    }
    expect(
      calls.filter(
        (call) => call.promptId === "asset-planning.global-structural-repair",
      ),
    ).toHaveLength(1);
    const failed = events.find((event) => event.type === "repair_failed");
    expect(failed).toEqual({
      type: "repair_failed",
      ...cause,
    });
  });

  it("rethrows a global repair provider error and reports its code", async () => {
    const invalidDraft = { planning_mode: "global" };
    const providerError = new ExternalServiceError({
      provider: "llm",
      operation: "asset-planning.global-structural-repair",
      retryable: false,
      code: "configuration",
      userMessage: "配置错误",
      debugMessage: "bad key",
    });
    const events: GlobalDraftStructureEvent[] = [];
    const { gateway, calls } = makeGateway((options) => {
      if (options.promptId === "asset-planning.global-structural-repair") {
        throw providerError;
      }
      return invalidDraft;
    });

    await expect(
      generateAssetPlan({
        ...makeInput(gateway),
        onGlobalStructureEvent: (event) => events.push(event),
      }),
    ).rejects.toBe(providerError);
    expect(
      calls.filter(
        (call) => call.promptId === "asset-planning.global-structural-repair",
      ),
    ).toHaveLength(1);
    expect(events.at(-1)).toEqual({
      type: "repair_provider_failed",
      error_code: "configuration",
    });
  });

  it("rethrows a non-provider repair gateway error without provider failure event", async () => {
    const ordinaryError = new Error("repair gateway programming failure");
    const events: GlobalDraftStructureEvent[] = [];
    const { gateway, calls } = makeGateway((options) => {
      if (options.promptId === "asset-planning.global-structural-repair") {
        throw ordinaryError;
      }
      return { planning_mode: "global" };
    });

    await expect(
      generateAssetPlan({
        ...makeInput(gateway),
        onGlobalStructureEvent: (event) => events.push(event),
      }),
    ).rejects.toBe(ordinaryError);
    expect(
      calls.filter(
        (call) => call.promptId === "asset-planning.global-structural-repair",
      ),
    ).toHaveLength(1);
    expect(events.map((event) => event.type)).toEqual([
      "normalization_applied",
      "repair_started",
    ]);
    expect(events).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "repair_provider_failed" }),
      ]),
    );
  });

  it("isolates repair input and successful result from malicious event payload mutation", async () => {
    const invalidDraft = structuredClone(missingPropNotesFixture) as {
      art_bible: { props: Array<Record<string, unknown>> };
    };
    invalidDraft.art_bible.props[0] = {
      ...invalidDraft.art_bible.props[0],
      consistency_notes: [],
    };
    delete invalidDraft.art_bible.props[0].visual_description;

    function createRepairingGateway() {
      const repairInputs: unknown[] = [];
      const result = makeGateway((options) => {
        if (options.promptId === "asset-planning.global-structural-repair") {
          repairInputs.push(structuredClone(options.input));
          return {
            patch_type: "global_planning_structural_patch",
            patches: [
              {
                path: ["art_bible", "props", 0, "visual_description"],
                value: "修复后的深色木质小型道具",
              },
            ],
          };
        }
        const promptInput = options.input as {
          planning_mode?: string;
          chunk?: { segment_ids: string[] };
        };
        if (promptInput.planning_mode === "global") return invalidDraft;
        return validChunkPlanningDraftFor(promptInput.chunk?.segment_ids ?? []);
      });
      return { ...result, repairInputs };
    }

    const baseline = createRepairingGateway();
    const malicious = createRepairingGateway();
    const expected = await generateAssetPlan(makeInput(baseline.gateway));
    const actual = await generateAssetPlan({
      ...makeInput(malicious.gateway),
      onGlobalStructureEvent(event) {
        if (event.type === "normalization_applied") {
          event.actions.splice(0, event.actions.length);
        }
        if (event.type === "repair_started") {
          event.issues.splice(0, event.issues.length, {
            code: "tampered",
            path: ["manual_review_notes"],
            message: "恶意改写",
          });
        }
      },
    });

    expect(actual).toEqual(expected);
    expect(malicious.repairInputs).toEqual(baseline.repairInputs);
    expect(malicious.calls).toHaveLength(baseline.calls.length);
    expect(
      (malicious.repairInputs[0] as { allowed_repair_paths: unknown })
        .allowed_repair_paths,
    ).toEqual([["art_bible", "props", 0, "visual_description"]]);
  });

  it("isolates repair failure cause from malicious event payload mutation", async () => {
    const invalidDraft = structuredClone(missingPropNotesFixture) as {
      art_bible: { props: Array<Record<string, unknown>> };
    };
    invalidDraft.art_bible.props[0] = {
      ...invalidDraft.art_bible.props[0],
      consistency_notes: [],
    };
    delete invalidDraft.art_bible.props[0].visual_description;

    function createFailingGateway() {
      return makeGateway((options) => {
        if (options.promptId === "asset-planning.global-structural-repair") {
          return {
            patch_type: "global_planning_structural_patch",
            patches: [{ path: ["manual_review_notes"], value: [] }],
          };
        }
        return invalidDraft;
      });
    }

    async function captureFailure(
      onGlobalStructureEvent?: (event: GlobalDraftStructureEvent) => void,
    ) {
      const run = createFailingGateway();
      let caught: unknown;
      try {
        await generateAssetPlan({
          ...makeInput(run.gateway),
          onGlobalStructureEvent,
        });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(LlmOutputError);
      return { error: caught as LlmOutputError, calls: run.calls };
    }

    const baseline = await captureFailure();
    const malicious = await captureFailure((event) => {
      if (event.type === "normalization_applied") {
        event.actions.splice(0, event.actions.length);
      }
      if (event.type === "repair_failed") {
        event.initial_issues.splice(0, event.initial_issues.length);
        event.patch_issues.splice(0, event.patch_issues.length);
        event.final_issues.splice(0, event.final_issues.length);
      }
    });

    expect(malicious.error.cause).toEqual(baseline.error.cause);
    expect(malicious.calls).toHaveLength(baseline.calls.length);
    expect(malicious.error.cause).toMatchObject({
      initial_issues: expect.arrayContaining([
        expect.objectContaining({
          path: ["art_bible", "props", 0, "visual_description"],
        }),
      ]),
      patch_issues: expect.arrayContaining([
        expect.objectContaining({
          code: "patch_path_not_allowed",
          path: ["manual_review_notes"],
        }),
      ]),
      final_issues: [],
    });
  });

  it.each(["sync", "async"] as const)(
    "isolates %s global structure callback failures from generation",
    async (mode) => {
      const baseline = makeGateway((options) => {
        const promptInput = options.input as {
          planning_mode?: string;
          chunk?: { segment_ids: string[] };
        };
        if (promptInput.planning_mode === "global") {
          return missingPropNotesFixture;
        }
        return validChunkPlanningDraftFor(promptInput.chunk?.segment_ids ?? []);
      });
      const noisy = makeGateway((options) => {
        const promptInput = options.input as {
          planning_mode?: string;
          chunk?: { segment_ids: string[] };
        };
        if (promptInput.planning_mode === "global") {
          return missingPropNotesFixture;
        }
        return validChunkPlanningDraftFor(promptInput.chunk?.segment_ids ?? []);
      });
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

      try {
        const expected = await generateAssetPlan(makeInput(baseline.gateway));
        const actual = await generateAssetPlan({
          ...makeInput(noisy.gateway),
          onGlobalStructureEvent:
            mode === "sync"
              ? () => {
                  throw new Error("sync callback failure");
                }
              : async () => {
                  throw new Error("async callback failure");
                },
        });

        expect(actual).toEqual(expected);
        expect(noisy.calls).toHaveLength(baseline.calls.length);
        expect(warn).toHaveBeenCalledTimes(1);
      } finally {
        warn.mockRestore();
      }
    },
  );
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

  it("runs up to four segment chunk planning calls concurrently by default", async () => {
    const startedChunks: string[] = [];
    let releaseChunks!: () => void;
    const chunkGate = new Promise<void>((resolve) => {
      releaseChunks = resolve;
    });
    const storyboard = makeStoryboardWithSegmentCount(5);
    const { gateway } = makeGateway(async (options) => {
      const input = options.input as {
        planning_mode: "global" | "segment_chunk";
        chunk?: { chunk_id: string; segment_ids: string[] };
      };
      if (input.planning_mode === "global") {
        return validGlobalPlanningDraft;
      }

      startedChunks.push(input.chunk?.chunk_id ?? "missing_chunk_id");
      await chunkGate;

      return validChunkPlanningDraftFor(input.chunk?.segment_ids ?? [], storyboard);
    });

    const running = generateAssetPlan({
      ...makeInput(gateway, 1, storyboard),
    });

    let waitError: unknown = null;
    try {
      await waitUntil(() => startedChunks.length === 4);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(startedChunks).toEqual([
        "chunk_001",
        "chunk_002",
        "chunk_003",
        "chunk_004",
      ]);
    } catch (error) {
      waitError = error;
    } finally {
      releaseChunks();
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
    ).toEqual(["sb_001", "sb_002", "sb_003", "sb_004", "sb_005"]);
  });

  it("keeps chunk planning serial when chunkConcurrency is 1", async () => {
    const startedChunks: string[] = [];
    let releaseFirstChunk!: () => void;
    const firstChunkGate = new Promise<void>((resolve) => {
      releaseFirstChunk = resolve;
    });
    const storyboard = makeStoryboardWithSegmentCount(3);
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
      ...makeInput(gateway, 1, storyboard),
      chunkConcurrency: 1,
    });

    await waitUntil(() => startedChunks.includes("chunk_001"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(startedChunks).toEqual(["chunk_001"]);

    releaseFirstChunk();
    await running;
    expect(startedChunks).toEqual(["chunk_001", "chunk_002", "chunk_003"]);
  });

  it("allows four segment chunks to run concurrently when chunkConcurrency is 4", async () => {
    const startedChunks: string[] = [];
    let releaseChunks!: () => void;
    const chunkGate = new Promise<void>((resolve) => {
      releaseChunks = resolve;
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
      await chunkGate;
      return validChunkPlanningDraftFor(input.chunk?.segment_ids ?? [], storyboard);
    });

    const running = generateAssetPlan({
      ...makeInput(gateway, 1, storyboard),
      chunkConcurrency: 4,
    });

    let waitError: unknown = null;
    try {
      await waitUntil(() => startedChunks.length === 4);
    } catch (error) {
      waitError = error;
    } finally {
      releaseChunks();
    }

    const plan = await running;
    if (waitError) {
      throw waitError;
    }

    expect(startedChunks).toEqual([
      "chunk_001",
      "chunk_002",
      "chunk_003",
      "chunk_004",
    ]);
    expect(
      plan.tasks
        .filter((task) => task.task_type === "image_still")
        .map((task) => task.source_segment_id),
    ).toEqual(["sb_001", "sb_002", "sb_003", "sb_004"]);
  });

  it("rejects the asset plan when any concurrent chunk fails", async () => {
    const storyboard = makeStoryboardWithSegmentCount(3);
    const { gateway } = makeGateway((options) => {
      const input = options.input as {
        planning_mode: "global" | "segment_chunk";
        chunk?: { chunk_id: string; segment_ids: string[] };
      };
      if (input.planning_mode === "global") {
        return validGlobalPlanningDraft;
      }
      if (input.chunk?.chunk_id === "chunk_002") {
        throw new Error("chunk_002_failed");
      }

      return validChunkPlanningDraftFor(input.chunk?.segment_ids ?? [], storyboard);
    });

    await expect(
      generateAssetPlan({
        ...makeInput(gateway, 1, storyboard),
        chunkConcurrency: 2,
      }),
    ).rejects.toThrow("chunk_002_failed");
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
      storyboard: {
        ...baseStoryboardPlan,
        segments: expect.any(Array),
      },
      draft: baseScriptDraft,
      topic_boundary_context: baseTopicBoundaryContext,
      regeneration_context: {
        reason: "asset_planning_local_validation_regen_once",
      },
    });
    // 缺口2：global prompt 的分镜段是投影 DTO，不携带 api_video_suitability
    const globalStoryboard = calls[0]!.input as {
      storyboard: { segments: Array<Record<string, unknown>> };
    };
    expect(globalStoryboard.storyboard.segments[0]).not.toHaveProperty("api_video_suitability");
    expect(globalStoryboard.storyboard.segments[0]).toHaveProperty("resolved_visual_route");
    expect(calls[1]?.input).toMatchObject({
      planning_mode: "segment_chunk",
      topic_boundary_context: baseTopicBoundaryContext,
      art_bible: validGlobalPlanningDraft.art_bible,
      visual_budget: validGlobalPlanningDraft.visual_budget,
      downgrade_policy: validGlobalPlanningDraft.downgrade_policy,
      global_audio_strategy: validGlobalPlanningDraft.global_audio_strategy,
      storyboard: {
        ...baseStoryboardPlan,
        segments: expect.any(Array),
      },
      draft: baseScriptDraft,
      chunk: {
        chunk_id: "chunk_001",
        segment_ids: ["sb_001", "sb_002"],
        segments: [
          expect.objectContaining({
            segment_id: "sb_001",
            resolved_visual_route: expect.any(String),
          }),
          expect.objectContaining({
            segment_id: "sb_002",
            resolved_visual_route: expect.any(String),
          }),
        ],
      },
    });
    // 缺口2：legacy chunk prompt 的段也是投影 DTO，不携带 api_video_suitability
    const chunkSegments = (calls[1]!.input as { chunk: { segments: Array<Record<string, unknown>> } }).chunk.segments;
    expect(chunkSegments).toHaveLength(2);
    for (const projected of chunkSegments) {
      expect(projected).not.toHaveProperty("api_video_suitability");
      expect(projected).not.toHaveProperty("visual_strategy_preference");
    }
    // 整改：legacy chunk prompt 顶层 storyboard 也必须投影，整个 payload 不得泄漏 suitability
    const chunkPayload = calls[1]!.input as {
      storyboard: { segments: Array<Record<string, unknown>> };
    };
    for (const projected of chunkPayload.storyboard.segments) {
      expect(projected).not.toHaveProperty("api_video_suitability");
      expect(projected).not.toHaveProperty("visual_strategy_preference");
      expect(projected).toHaveProperty("resolved_visual_route");
    }
    for (const payload of [calls[0]!.input, calls[1]!.input]) {
      const serialized = JSON.stringify(payload);
      expect(serialized).not.toContain("api_video_suitability");
      expect(serialized).not.toContain("visual_strategy_preference");
    }
    expect(calls[1]?.input).not.toHaveProperty("storyboard_outline");
    expect(calls[1]?.input).not.toHaveProperty("script_context");
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

    await expect(generateAssetPlan(makeInput(gateway))).rejects.toMatchObject({
      code: "asset_chunk_forbidden_task_type_violated",
    });
  });

  it("normalizes null manual upload policies in chunk task drafts", async () => {
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
        tasks: draft.tasks.map((task, index) =>
          index === 0
            ? {
                ...task,
                manual_upload_policy: null,
              }
            : task,
        ),
      };
    });

    const plan = await generateAssetPlan(makeInput(gateway, 3));

    expect(
      plan.tasks.find((task) => task.task_id === "img_003")
        ?.manual_upload_policy,
    ).toEqual({
      allowed: false,
      required: false,
      accepted_file_types: [],
      acceptance_notes: [],
    });
  });

  it("normalizes missing defaultable chunk task fields without invoking structural repair", async () => {
    const promptIds: string[] = [];
    const { gateway } = makeGateway((options) => {
      promptIds.push(options.promptId);
      const input = options.input as {
        planning_mode?: "global" | "segment_chunk";
        chunk?: { segment_ids: string[] };
      };
      if (input.planning_mode === "global") {
        return validGlobalPlanningDraft;
      }

      const draft = validChunkPlanningDraftFor(input.chunk?.segment_ids ?? []);
      return {
        ...draft,
        tasks: draft.tasks.map((task, index) =>
          index === 0
            ? {
                local_task_id: task.local_task_id,
                task_type: task.task_type,
                source_segment_id: task.source_segment_id,
                source_excerpt: task.source_excerpt,
                production_intent: task.production_intent,
                recommended_mode: task.recommended_mode,
                prompt_draft: task.prompt_draft,
                risk_notes: task.risk_notes,
                cost_tier: task.cost_tier,
              }
            : task,
        ),
      };
    });

    const plan = await generateAssetPlan(makeInput(gateway, 3));

    expect(promptIds).not.toContain("asset-planning.asset-structural-repair");
    expect(plan.tasks.find((task) => task.task_id === "img_003")).toMatchObject({
      provider_hint: null,
      parameters: {},
      manual_upload_policy: {
        allowed: false,
        required: false,
        accepted_file_types: [],
        acceptance_notes: [],
      },
    });
  });

  it("repairs invalid chunk draft structure once with the structural repair prompt", async () => {
    const promptIds: string[] = [];
    const { gateway } = makeGateway((options) => {
      promptIds.push(options.promptId);
      const input = options.input as {
        planning_mode?: "global" | "segment_chunk";
        chunk?: { segment_ids: string[] };
        raw_task_summaries?: Array<Record<string, unknown>>;
      };
      if (input.planning_mode === "global") {
        return validGlobalPlanningDraft;
      }

      if (options.promptId === "asset-planning.asset-structural-repair") {
        return {
          patch_type: "segment_chunk_structural_patch",
          task_patches: (input.raw_task_summaries ?? []).map((task) => ({
            local_task_id: String(task.local_task_id),
            ...(task.task_type === "image_still" && !task.has_prompt_draft
              ? {
                  prompt_draft: `战国历史短视频，${String(task.production_intent)}`,
                }
              : {}),
            risk_notes: ["保持历史正剧质感，避免现代物件和夸张血腥表现"],
          })),
          dependency_patches: [],
        };
      }

      const draft = validChunkPlanningDraftFor(input.chunk?.segment_ids ?? []);
      return {
        ...draft,
        tasks: draft.tasks.map((task, index) =>
          index === 0
            ? {
                ...task,
                prompt_draft: "",
                risk_notes: [],
              }
            : task,
        ),
      };
    });

    const plan = await generateAssetPlan(makeInput(gateway, 3));

    expect(promptIds).toContain("asset-planning.asset-structural-repair");
    expect(plan.tasks.some((task) => task.task_type === "image_still")).toBe(true);
    expect(
      plan.tasks
        .filter((task) =>
          ["image_still", "render_motion_cue", "video_clip"].includes(
            task.task_type,
          ),
        )
        .every((task) => task.risk_notes.length > 0),
    ).toBe(true);
  });

  it("repairs invalid chunk drafts with compact structural patches", async () => {
    let repairInput: Record<string, unknown> | null = null;
    const { gateway } = makeGateway((options) => {
      const input = options.input as {
        planning_mode?: "global" | "segment_chunk";
        repair_mode?: string;
        chunk?: { segment_ids: string[] };
      };
      if (input.planning_mode === "global") {
        return validGlobalPlanningDraft;
      }

      if (options.promptId === "asset-planning.asset-structural-repair") {
        repairInput = options.input as Record<string, unknown>;
        return {
          patch_type: "segment_chunk_structural_patch",
          task_patches: [
            {
              local_task_id: "local_img_sb_001",
              recommended_mode: "manual_allowed",
              cost_tier: "low",
            },
          ],
          dependency_patches: [],
        };
      }

      const draft = validChunkPlanningDraftFor(input.chunk?.segment_ids ?? []);
      return {
        ...draft,
        tasks: draft.tasks.map((task, index) =>
          index === 0
            ? {
                ...task,
                local_task_id: "local_img_sb_001",
                recommended_mode: undefined,
                cost_tier: undefined,
              }
            : task,
        ),
      };
    });

    const plan = await generateAssetPlan(makeInput(gateway, 3));

    expect(plan.tasks.some((task) => task.task_id === "img_003")).toBe(true);
    expect(repairInput).toMatchObject({
      repair_mode: "segment_chunk_structural_patch",
    });
    expect(repairInput).not.toHaveProperty("chunk_prompt_input");
    expect(repairInput).not.toHaveProperty("raw_chunk_draft");
    expect(repairInput).toHaveProperty("raw_task_summaries");
    expect(repairInput).toHaveProperty("structural_errors");
  });

  it("accepts the observed single repair wrapper once and reports mechanical actions", async () => {
    const events: Array<{ type: string; actions?: unknown[] }> = [];
    const promptIds: string[] = [];
    const { gateway } = makeGateway((options) => {
      promptIds.push(options.promptId);
      const input = options.input as {
        planning_mode?: "global" | "segment_chunk";
        chunk?: { segment_ids: string[] };
      };
      if (input.planning_mode === "global") return validGlobalPlanningDraft;
      if (options.promptId === "asset-planning.asset-structural-repair") {
        return legacyChunkRepairWrapperFixture;
      }

      const draft = validChunkPlanningDraftFor(
        input.chunk?.segment_ids ?? [],
      );
      return {
        ...draft,
        tasks: draft.tasks.map((task, index) =>
          index === 0
            ? {
                ...task,
                local_task_id: "local_image_synthetic_001",
                recommended_mode: undefined,
                cost_tier: undefined,
              }
            : task,
        ),
        dependencies: draft.dependencies.map((dependency) => ({
          ...dependency,
          depends_on_local_task_id:
            dependency.depends_on_local_task_id === "local_img_sb_001"
              ? "local_image_synthetic_001"
              : dependency.depends_on_local_task_id,
        })),
      };
    });

    const plan = await generateAssetPlan({
      ...makeInput(gateway, 3),
      onGlobalStructureEvent: (event) => events.push(event),
    });

    expect(AssetPlan.parse(plan)).toEqual(plan);
    expect(
      promptIds.filter(
        (promptId) => promptId === "asset-planning.asset-structural-repair",
      ),
    ).toHaveLength(1);
    expect(events).toContainEqual({
      type: "legacy_chunk_patch_coerced",
      actions: [
        { type: "single_wrapper_unwrapped" },
        { type: "missing_discriminator_defaulted" },
      ],
    });
  });

  it("reports a bounded wrapper coercion failure while preserving the chunk error", async () => {
    const events: Array<Record<string, unknown>> = [];
    const { gateway } = makeGateway((options) => {
      const input = options.input as {
        planning_mode?: "global" | "segment_chunk";
        chunk?: { segment_ids: string[] };
      };
      if (input.planning_mode === "global") return validGlobalPlanningDraft;
      if (options.promptId === "asset-planning.asset-structural-repair") {
        return {
          patch_fields: legacyChunkRepairWrapperFixture.patch_fields,
          secret_sibling: "must-not-propagate",
        };
      }
      const draft = validChunkPlanningDraftFor(
        input.chunk?.segment_ids ?? [],
      );
      return {
        ...draft,
        tasks: draft.tasks.map((task, index) =>
          index === 0 ? { ...task, recommended_mode: undefined } : task,
        ),
      };
    });

    await expect(
      generateAssetPlan({
        ...makeInput(gateway, 3),
        onGlobalStructureEvent: (event) => events.push(event),
      }),
    ).rejects.toMatchObject({ code: "asset_chunk_plan_schema_invalid" });

    expect(events).toContainEqual({
      type: "legacy_chunk_patch_coercion_failed",
      error_code: "asset_legacy_chunk_patch_coercion_failed",
      issues: expect.arrayContaining([
        expect.objectContaining({
          code: expect.any(String),
          path: expect.any(Array),
        }),
      ]),
    });
    expect(JSON.stringify(events)).not.toContain("must-not-propagate");
  });

  it("rebinds invalid audio timing to the unique TTS without another generation call", async () => {
    const events: Array<{ type: string; actions?: unknown[] }> = [];
    const { gateway, calls } = makeGateway((options) => {
      const input = options.input as {
        planning_mode?: "global" | "segment_chunk";
        chunk?: { segment_ids: string[] };
      };
      if (input.planning_mode === "global") return validGlobalPlanningDraft;
      const draft = validChunkPlanningDraftFor(
        input.chunk?.segment_ids ?? [],
      );
      return {
        ...draft,
        dependencies: [
          ...draft.dependencies,
          {
            local_dependency_id: "dep_sfx_bad_timing",
            task_local_id: "local_sfx_sb_001",
            depends_on_local_task_id: "local_motion_sb_001",
            dependency_type: "requires_timing",
          },
        ],
      };
    });

    const plan = await generateAssetPlan({
      ...makeInput(gateway, 3),
      onGlobalStructureEvent: (event) => events.push(event),
    });

    const tts = plan.tasks.find((task) => task.task_type === "tts_audio")!;
    const sfx = plan.tasks.find((task) => task.task_type === "sfx_cue")!;
    expect(plan.dependencies).toContainEqual(
      expect.objectContaining({
        task_id: sfx.task_id,
        depends_on_task_id: tts.task_id,
        dependency_type: "requires_timing",
      }),
    );
    expect(calls).toHaveLength(2);
    expect(events).toContainEqual({
      type: "legacy_audio_timing_canonicalized",
      actions: [
        expect.objectContaining({
          type: "audio_timing_rebound",
          reason_code: "invalid_audio_timing_source",
        }),
      ],
    });
  });

  it.each(["sync", "async"] as const)(
    "isolates %s legacy resilience callback failures from the final plan",
    async (mode) => {
      const { gateway } = makeGateway((options) => {
        const input = options.input as {
          planning_mode?: "global" | "segment_chunk";
          chunk?: { segment_ids: string[] };
        };
        if (input.planning_mode === "global") return validGlobalPlanningDraft;
        const draft = validChunkPlanningDraftFor(
          input.chunk?.segment_ids ?? [],
        );
        return {
          ...draft,
          dependencies: [
            ...draft.dependencies,
            {
              local_dependency_id: "dep_sfx_bad_timing",
              task_local_id: "local_sfx_sb_001",
              depends_on_local_task_id: "local_motion_sb_001",
              dependency_type: "requires_timing",
            },
          ],
        };
      });
      const warning = vi
        .spyOn(console, "warn")
        .mockImplementation(() => undefined);

      try {
        const plan = await generateAssetPlan({
          ...makeInput(gateway, 3),
          onGlobalStructureEvent:
            mode === "sync"
              ? (event) => {
                  if ("actions" in event) event.actions.splice(0);
                  throw new Error("sync resilience callback failure");
                }
              : async (event) => {
                  if ("actions" in event) event.actions.splice(0);
                  throw new Error("async resilience callback failure");
                },
        });

        const timingEdge = plan.dependencies.find(
          (dependency) => dependency.dependency_type === "requires_timing" &&
            plan.tasks.find((task) => task.task_id === dependency.task_id)
              ?.task_type === "sfx_cue",
        );
        expect(
          plan.tasks.find(
            (task) => task.task_id === timingEdge?.depends_on_task_id,
          )?.task_type,
        ).toBe("tts_audio");
        expect(warning).toHaveBeenCalledTimes(1);
      } finally {
        warning.mockRestore();
      }
    },
  );

  it("retries global provider content filter errors once with safety retry context", async () => {
    const globalInputs: Array<Record<string, unknown>> = [];
    let globalAttempts = 0;
    const { gateway } = makeGateway((options) => {
      const input = options.input as {
        planning_mode?: "global" | "segment_chunk";
        chunk?: { segment_ids: string[] };
        safety_retry_context?: unknown;
      };
      if (input.planning_mode === "global") {
        globalAttempts += 1;
        globalInputs.push(input as unknown as Record<string, unknown>);
        if (globalAttempts === 1) {
          throw Object.assign(new Error("content filter blocked"), {
            status: 400,
            code: "content_filter",
          });
        }
        return validGlobalPlanningDraft;
      }

      return validChunkPlanningDraftFor(input.chunk?.segment_ids ?? []);
    });

    const plan = await generateAssetPlan(makeInput(gateway, 3));

    expect(plan.plan_version).toBe("asset_plan_v1");
    expect(globalAttempts).toBe(2);
    expect(globalInputs[0]?.safety_retry_context).toBeUndefined();
    expect(globalInputs[1]?.safety_retry_context).toMatchObject({
      reason: "provider_content_filter",
    });
  });

  it("retries provider content filter errors once with safety retry context", async () => {
    const chunkInputs: Array<Record<string, unknown>> = [];
    let chunkAttempts = 0;
    const { gateway } = makeGateway((options) => {
      const input = options.input as {
        planning_mode?: "global" | "segment_chunk";
        chunk?: { segment_ids: string[] };
        safety_retry_context?: unknown;
      };
      if (input.planning_mode === "global") {
        return validGlobalPlanningDraft;
      }

      chunkAttempts += 1;
      chunkInputs.push(input as unknown as Record<string, unknown>);
      if (chunkAttempts === 1) {
        throw Object.assign(new Error("contentFilter level 2"), {
          status: 400,
          code: "1301",
        });
      }

      return validChunkPlanningDraftFor(input.chunk?.segment_ids ?? []);
    });

    const plan = await generateAssetPlan(makeInput(gateway, 3));

    expect(plan.plan_version).toBe("asset_plan_v1");
    expect(chunkAttempts).toBe(2);
    expect(chunkInputs[0]?.safety_retry_context).toBeUndefined();
    expect(chunkInputs[1]?.safety_retry_context).toMatchObject({
      reason: "provider_content_filter",
    });
  });

  it("rewrites video static fallback local ids to global task ids", async () => {
    const { gateway } = makeGateway((options) => {
      const input = options.input as {
        planning_mode: "global" | "segment_chunk";
        chunk?: { segment_ids: string[] };
      };
      if (input.planning_mode === "global") {
        return validGlobalPlanningDraft;
      }

      const segmentId = input.chunk?.segment_ids[0] ?? "sb_001";
      const segment =
        baseStoryboardPlan.segments.find(
          (candidate) => candidate.segment_id === segmentId,
        ) ?? baseStoryboardPlan.segments[0];
      return {
        planning_mode: "segment_chunk",
        chunk_id: "chunk_video_with_fallback",
        tasks: [
          {
            ...validChunkPlanningDraftFor([segment.segment_id]).tasks[0],
            local_task_id: `local_img_${segment.segment_id}`,
          },
          {
            local_task_id: `local_video_${segment.segment_id}`,
            task_type: "video_clip",
            source_segment_id: segment.segment_id,
            source_excerpt: segment.script_excerpt,
            production_intent: "生成需要静态图兜底的视频片段",
            recommended_mode: "manual_preferred",
            provider_hint: "video_provider",
            prompt_draft: `战国历史短视频，${segment.scene_description}`,
            parameters: {
              static_fallback_task_id: `local_img_${segment.segment_id}`,
              why_static_insufficient: "连续动作是本段叙事核心",
            },
            manual_upload_policy: {
              allowed: true,
              required: false,
              accepted_file_types: ["video/mp4"],
              acceptance_notes: [],
            },
            risk_notes: [
              `若视频生成失败，降级为 local_img_${segment.segment_id} 配合音效。`,
            ],
            cost_tier: "high",
          },
        ],
        dependencies: [
          {
            local_dependency_id: "dep_video_after_img",
            task_local_id: `local_video_${segment.segment_id}`,
            depends_on_local_task_id: `local_img_${segment.segment_id}`,
            dependency_type: "requires_output",
          },
        ],
        budget_notes: [
          `local_video_${segment.segment_id} 成本高，local_img_${segment.segment_id} 是兜底。`,
        ],
      };
    });

    const plan = await generateAssetPlan(makeInput(gateway, 3));
    const videoTask = plan.tasks.find((task) => task.task_type === "video_clip");

    expect(videoTask?.parameters.static_fallback_task_id).toBe("img_003");
    expect(videoTask?.risk_notes).toContain(
      "若视频生成失败，降级为 img_003 配合音效。",
    );
    expect(plan.cost_summary.notes).toContain(
      `video_004 成本高，img_003 是兜底。`,
    );
    expect(plan.dependencies).toContainEqual(
      expect.objectContaining({
        task_id: videoTask?.task_id,
        depends_on_task_id: "img_003",
      }),
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

    await expect(generateAssetPlan(makeInput(gateway))).rejects.toMatchObject({
      code: "asset_chunk_dependency_local_id_missing_violated",
    });
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

    await expect(generateAssetPlan(makeInput(gateway, 3))).rejects.toMatchObject({
      code: "asset_chunk_support_image_reason_missing_violated",
    });
  });

  it("appends visual negative constraints to image_still prompt_draft", async () => {
    const { gateway } = makeGateway();
    const plan = await generateAssetPlan(makeInput(gateway));

    const imageTasks = plan.tasks.filter((t) => t.task_type === "image_still");
    expect(imageTasks.length).toBeGreaterThan(0);
    for (const task of imageTasks) {
      expect(task.prompt_draft).toContain("【视觉约束】");
      expect(task.prompt_draft).toContain(
        "写实历史质感，建筑、发型、服饰、器物、文字形制必须符合战国宫廷与军帐背景，无现代物品、无现代建筑、无民国/近代造型、无动漫风、无奇幻特效、无游戏质感",
      );
    }
  });

  it("keeps character-anchor enrichment limited to image visual fields after helper extraction", async () => {
    const visibleLabel = baseStoryboardPlan.segments[0]!.visual_elements[0]!;
    const { gateway } = makeGateway((options) => {
      const input = options.input as { planning_mode?: string; chunk?: { segment_ids: string[] } };
      if (input.planning_mode === "global") {
        return {
          ...validGlobalPlanningDraft,
          art_bible: {
            ...validGlobalPlanningDraft.art_bible,
            characters: [
              { character_id: "visible", label: visibleLabel, role: "画面人物", visual_description: "束发深衣，神情克制", consistency_notes: [] },
              { character_id: "offscreen", label: "仅口播提及者", role: "画外人物", visual_description: "不应进入画面提示", consistency_notes: [] },
            ],
          },
        };
      }
      return validChunkPlanningDraftFor(input.chunk?.segment_ids ?? []);
    });

    const plan = await generateAssetPlan(makeInput(gateway));
    const firstImage = plan.tasks.find(
      (task) => task.task_type === "image_still" && task.source_segment_id === "sb_001",
    )!;
    expect(firstImage.prompt_draft).toContain(`[角色锚点] ${visibleLabel}：束发深衣，神情克制`);
    expect(firstImage.prompt_draft).not.toContain("不应进入画面提示");
    expect(firstImage.prompt_draft).toContain("【视觉约束】");
  });

  it("appends visual negative constraints to video_clip prompt_draft", async () => {
    const { gateway } = makeGateway(async (options) => {
      const input = options.input as { planning_mode: string; chunk?: { segment_ids: string[] } };
      if (input.planning_mode === "global") return validGlobalPlanningDraft;
      const draft = validChunkPlanningDraftFor(input.chunk?.segment_ids ?? []);
      // Convert one image_still task to video_clip
      draft.tasks = draft.tasks.map((t, i) =>
        i === 0
          ? { ...t, task_type: "video_clip", prompt_draft: `测试视频提示词，${t.source_segment_id}` }
          : t,
      );
      return draft;
    });
    const plan = await generateAssetPlan(makeInput(gateway));

    const videoTasks = plan.tasks.filter((t) => t.task_type === "video_clip");
    expect(videoTasks.length).toBeGreaterThan(0);
    for (const task of videoTasks) {
      expect(task.prompt_draft).toContain("【视觉约束】");
      expect(task.prompt_draft).toContain(
        "写实历史质感，建筑、发型、服饰、器物、文字形制必须符合战国宫廷与军帐背景，无现代物品、无现代建筑、无民国/近代造型、无动漫风、无奇幻特效、无游戏质感",
      );
    }
  });

  it("does not append visual constraints to non-visual tasks", async () => {
    const { gateway } = makeGateway();
    const plan = await generateAssetPlan(makeInput(gateway));

    const nonVisual = plan.tasks.filter(
      (t) => t.task_type !== "image_still" && t.task_type !== "video_clip",
    );
    for (const task of nonVisual) {
      if (task.prompt_draft) {
        expect(task.prompt_draft).not.toContain("【视觉约束】");
        expect(task.prompt_draft).not.toContain("无现代物品");
      }
    }
  });

  it("does not duplicate visual constraints if already present in prompt_draft", async () => {
    const constraint = "写实历史质感，建筑、发型、服饰、器物、文字形制必须符合战国宫廷与军帐背景，无现代物品、无现代建筑、无民国/近代造型、无动漫风、无奇幻特效、无游戏质感";
    const { gateway } = makeGateway(async (options) => {
      const input = options.input as { planning_mode: string; chunk?: { segment_ids: string[] } };
      if (input.planning_mode === "global") return validGlobalPlanningDraft;
      const draft = validChunkPlanningDraftFor(input.chunk?.segment_ids ?? []);
      draft.tasks = draft.tasks.map((t) => ({
        ...t,
        prompt_draft: `已有约束的提示词\n【视觉约束】${constraint}。`,
      }));
      return draft;
    });
    const plan = await generateAssetPlan(makeInput(gateway));

    const imageTasks = plan.tasks.filter((t) => t.task_type === "image_still");
    expect(imageTasks.length).toBeGreaterThan(0);
    for (const task of imageTasks) {
      const matches = (task.prompt_draft?.match(/【视觉约束】/g) ?? []).length;
      expect(matches).toBe(1);
    }
  });

  it("wraps an unrepaired global draft in the stable structural repair error", async () => {
    const { gateway } = makeGateway((options) => {
      if (options.promptId === "asset-planning.global-structural-repair") {
        return {
          patch_type: "global_planning_structural_patch",
          patches: [{ path: ["art_bible"], value: {} }],
        };
      }
      return { planning_mode: "global" };
    });

    await expect(generateAssetPlan(makeInput(gateway))).rejects.toMatchObject({
      code: "asset_global_plan_structural_repair_failed",
      cause: {
        initial_issues: expect.any(Array),
        patch_issues: [],
        final_issues: expect.any(Array),
      },
    });
  });

  it("wraps chunk draft ZodError into asset_chunk_plan_schema_invalid when structural repair also fails", async () => {
    // chunk draft 首次 parse 抛 ZodError（prompt_draft 为空字符串）→ 触发 repair；
    // repair prompt 返回无效 patch（缺 patch_type/task_patches）→ repair 失败 →
    // 应抛 LlmOutputError(asset_chunk_plan_schema_invalid)，而非裸 ZodError。
    const { gateway } = makeGateway((options) => {
      const input = options.input as {
        planning_mode?: string;
        chunk?: { segment_ids: string[] };
      };
      if (input.planning_mode === "global") {
        return validGlobalPlanningDraft;
      }
      if (options.promptId === "asset-planning.asset-structural-repair") {
        // 无效 patch：缺 patch_type / task_patches / dependency_patches
        return { unrelated: true };
      }

      const draft = validChunkPlanningDraftFor(input.chunk?.segment_ids ?? []);
      return {
        ...draft,
        tasks: draft.tasks.map((task, index) =>
          index === 0 ? { ...task, prompt_draft: "" } : task,
        ),
      };
    });

    await expect(generateAssetPlan(makeInput(gateway, 3))).rejects.toMatchObject({
      code: "asset_chunk_plan_schema_invalid",
    });

    try {
      await generateAssetPlan(makeInput(gateway, 3));
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(LlmOutputError);
      expect((error as LlmOutputError).code).toBe(
        "asset_chunk_plan_schema_invalid",
      );
      expect(Array.isArray((error as LlmOutputError).cause)).toBe(true);
    }
  });

  it("tolerates LLM omitting manual_upload_policy subfields in chunk draft", async () => {
    // 回归用例：LLM 在多 chunk 规划时系统性漏写 manual_upload_policy 的子字段
    // （required / accepted_file_types / acceptance_notes），曾导致
    // asset_chunk_plan_schema_invalid 失败。ManualUploadPolicyDraft 加 default 后
    // 应自动补默认值，不再抛错。
    const { gateway } = makeGateway((options) => {
      const input = options.input as { planning_mode: string; chunk?: { segment_ids: string[] } };
      if (input.planning_mode === "global") {
        return validGlobalPlanningDraft;
      }
      const valid = validChunkPlanningDraftFor(input.chunk?.segment_ids ?? []);
      return {
        ...valid,
        tasks: valid.tasks.map((task) => ({
          ...task,
          manual_upload_policy: { allowed: true },
        })),
      };
    });

    const plan = await generateAssetPlan(makeInput(gateway));

    // 关键：chunk draft 的 manual_upload_policy 只含 {allowed:true}，
    // 缺 required/accepted_file_types/acceptance_notes，但 schema 的 default
    // 应自动补全，不抛 asset_chunk_plan_schema_invalid。
    expect(plan.tasks.length).toBeGreaterThan(0);
    for (const task of plan.tasks) {
      expect(task.manual_upload_policy).toEqual(
        expect.objectContaining({
          required: false,
          accepted_file_types: [],
          acceptance_notes: [],
        }),
      );
    }
  });

  it("tolerates LLM adding unexpected top-level keys to chunk draft", async () => {
    // 回归用例：LLM 会把全局规划阶段的 manual_review_notes 带到 chunk 输出里，
    // SegmentChunkPlanningDraft 用 passthrough 容忍这类未知顶层字段，
    // 不抛 asset_chunk_plan_schema_invalid。
    const { gateway } = makeGateway((options) => {
      const input = options.input as { planning_mode: string; chunk?: { segment_ids: string[] } };
      if (input.planning_mode === "global") {
        return validGlobalPlanningDraft;
      }
      const valid = validChunkPlanningDraftFor(input.chunk?.segment_ids ?? []);
      return {
        ...valid,
        manual_review_notes: ["这个 chunk 需要关注画面连贯性"],
      };
    });

    const plan = await generateAssetPlan(makeInput(gateway));
    expect(plan.tasks.length).toBeGreaterThan(0);
  });

  // 说明：AssetPlan.parse 与 GlobalPlanningDraft.parse 共用同一个 parseLlmOutput
  // 包装（asset-planning-generation.service.ts 末尾）。mergeAssetPlan 是确定性
  // 合并函数，当 chunk drafts 合法时其产物结构必然满足 AssetPlan schema，无法
  // 在不 mock 内部函数的前提下可靠构造 AssetPlan.parse 失败场景；parseLlmOutput
  // 本身的行为已由 tests/backend/runtime/llm-output-error.test.ts 覆盖。
});

describe("S2-2B 画风 preset 冻结消费（generateAssetPlan 输入级）", () => {
  const frozenV1Preset = {
    preset_id: "art_style_classical_ink",
    preset_version: "v1",
    resolved_params: {
      visual_tone_hint: "水墨工笔 v1",
      global_prompt_prefix: "水墨风格 v1",
      global_negative_prompts: ["油画质感 v1", "3D渲染 v1"],
      style_keywords: [],
      era_style_hint: null,
    },
  };

  it("global prompt 输入携带冻结的 v1 参数，且 art_bible 合并 preset 负面清单", async () => {
    const { gateway, calls } = makeGateway();
    const plan = await generateAssetPlan({
      ...makeInput(gateway),
      artStylePreset: frozenV1Preset,
    });

    const globalCall = calls.find(
      (call) =>
        (call.input as { planning_mode?: string }).planning_mode === "global",
    );
    expect(globalCall).toBeDefined();
    const promptInput = globalCall!.input as {
      art_style_preset?: {
        preset_id?: string;
        preset_version?: string;
        resolved_params?: { global_prompt_prefix?: string };
      };
    };
    expect(promptInput.art_style_preset?.preset_id).toBe("art_style_classical_ink");
    expect(promptInput.art_style_preset?.preset_version).toBe("v1");
    expect(promptInput.art_style_preset?.resolved_params?.global_prompt_prefix).toBe(
      "水墨风格 v1",
    );

    // 合并后的 art_bible：preset 负面清单必达（并集），LLM 额外项保留
    const negatives = plan.art_bible.global_negative_prompts;
    expect(negatives).toEqual(
      expect.arrayContaining(["油画质感 v1", "3D渲染 v1", "现代建筑", "现代服饰"]),
    );
  });

  it("artStylePreset=null（none）→ prompt 不携带 art_style_preset 块，art_bible 不被改写", async () => {
    const { gateway, calls } = makeGateway();
    const plan = await generateAssetPlan({
      ...makeInput(gateway),
      artStylePreset: null,
    });

    const globalCall = calls.find(
      (call) =>
        (call.input as { planning_mode?: string }).planning_mode === "global",
    );
    const promptInput = globalCall!.input as { art_style_preset?: unknown };
    expect(promptInput.art_style_preset).toBeUndefined();
    expect(plan.art_bible.global_negative_prompts).toEqual(["现代建筑", "现代服饰"]);
  });
});
