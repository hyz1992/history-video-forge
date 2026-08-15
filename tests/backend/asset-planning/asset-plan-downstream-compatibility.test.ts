import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  AssetPlan,
  ScriptDraftPackage,
  StoryboardPlan,
  type AssetPlan as AssetPlanType,
  type ScriptDraftPackage as ScriptDraftPackageType,
  type StoryboardPlan as StoryboardPlanType,
} from "../../../shared/src/index.js";
import { validateAssetPlan } from "../../../backend/src/modules/asset-planning/asset-planning-local-validator.js";
import { generateAssetPlan } from "../../../backend/src/modules/asset-planning/asset-planning-generation.service.js";
import {
  compileAssetPlanFromIntents,
  type AssetPlanCompilerInput,
} from "../../../backend/src/modules/asset-planning/asset-plan-intent-compiler.js";
import {
  readBgmCueParams,
  readSfxCueParams,
} from "../../../backend/src/modules/assets/audio-cue-params.js";
import { buildInitialAssetManifest } from "../../../backend/src/modules/assets/assets-manifest-builder.js";
import type {
  InvokeStructuredPromptOptions,
  LlmGateway,
} from "../../../backend/src/runtime/llm/llm-gateway.js";
import { LlmOutputError } from "../../../backend/src/runtime/llm/llm-output-error.js";

const LongAssetPlanningFixture = z
  .object({
    source_ids: z
      .object({
        storyboard_record_id: z.string().min(1),
        script_record_id: z.string().min(1),
        topic_package_id: z.string().min(1),
      })
      .strict(),
    script: ScriptDraftPackage,
    storyboard: StoryboardPlan,
  })
  .strict();

function readFixture(filename: string): unknown {
  return JSON.parse(
    readFileSync(
      new URL(`../../fixtures/asset-planning/${filename}`, import.meta.url),
      "utf8",
    ),
  ) as unknown;
}

/** S2-2A 任务 4：suitability 的 api_video 语义判断（任务 5 后仅用于构造 route 输入）。 */
function isApiVideoSuitability(
  suitability: "remotion_only" | "remotion_sufficient" | "api_video_beneficial" | "api_video_strongly_recommended",
): boolean {
  return suitability === "api_video_beneficial" || suitability === "api_video_strongly_recommended";
}

/** S2-2A 任务 5：从 storyboard 构造 resolver 输出的路线输入（测试辅助，非运行时逻辑）。 */
function makeRoutes(storyboard: StoryboardPlanType): Map<string, import("../../../shared/src/index.js").ResolvedSegmentVisualRoute> {
  return new Map(
    storyboard.segments.map((segment) => [
      segment.segment_id,
      {
        segment_id: segment.segment_id,
        segment_override: null,
        api_video_suitability: segment.api_video_suitability,
        resolved_route: isApiVideoSuitability(segment.api_video_suitability) ? "api_video" : "remotion",
        reason_code: "test_route",
      },
    ]),
  );
}


function parseLongFixture(filename: string) {
  const fixture = LongAssetPlanningFixture.parse(readFixture(filename));
  return {
    sourceIds: fixture.source_ids,
    script: fixture.script,
    storyboard: fixture.storyboard,
  };
}

function makeTopicBoundaryContext() {
  return {
    title: "架空的云岭盐道查仓记",
    selected_angle: "一册被雨水打湿的仓账如何揭开虚报",
    family_label: "制度查验型",
    scope_label: "合成完整事件",
    core_conflict: "巡仓使必须在封仓期限前证明盐包被调换",
    strong_scene: "众人面前重新称量盐包",
    forbidden_expansions: [],
    risk_hints: [],
    source_anchor_refs: [],
    canonical_quotes: [],
    narrative_tension_map: {
      hook_claim: "雨夜湿账留下异常盐印",
      peak_payoff: "公开复秤揭开夹层暗仓",
    },
  };
}

function makeLegacyGateway(
  plan: AssetPlanType,
  chunkDraft: Record<string, unknown>,
): { gateway: LlmGateway; calls: InvokeStructuredPromptOptions[] } {
  const calls: InvokeStructuredPromptOptions[] = [];
  const gateway: LlmGateway = {
    async invokeStructuredPrompt<T>(
      options: InvokeStructuredPromptOptions,
    ): Promise<T> {
      calls.push(options);
      const input = options.input as { planning_mode?: string };
      if (input.planning_mode === "global") {
        return {
          planning_mode: "global",
          art_bible: plan.art_bible,
          visual_budget: plan.visual_budget,
          downgrade_policy: plan.downgrade_policy,
          global_audio_strategy: plan.global_audio_strategy,
          manual_review_notes: [],
        } as T;
      }
      return chunkDraft as T;
    },
    invokeStrictStructured: vi.fn(),
  };
  return { gateway, calls };
}

function expectContinuousStoryboardReferences(
  script: ScriptDraftPackageType,
  storyboard: StoryboardPlanType,
) {
  const beatNames = new Set(script.beat_trace.map((trace) => trace.beat));
  const quoteNames = new Set(script.quote_trace.map((trace) => trace.quote));

  for (const [index, segment] of storyboard.segments.entries()) {
    expect(segment.order).toBe(index);
    expect(script.script_text).toContain(segment.script_excerpt);
    expect(segment.linked_beats.every((beat) => beatNames.has(beat))).toBe(true);
    expect(segment.linked_quotes.every((quote) => quoteNames.has(quote))).toBe(
      true,
    );
    expect(segment.start_hint_sec).toBe(
      index === 0 ? 0 : storyboard.segments[index - 1]!.end_hint_sec,
    );
  }
  expect(storyboard.segments.at(-1)!.end_hint_sec).toBe(
    storyboard.estimated_total_duration_sec,
  );
  expect(storyboard.segments.map((segment) => segment.script_excerpt).join(""))
    .toBe(script.script_text);
}

function makeCompilerInput(
  fixture: ReturnType<typeof parseLongFixture>,
): AssetPlanCompilerInput {
  const legacy = AssetPlan.parse(readFixture("legacy-plan-valid.json"));
  const scriptText = fixture.script.script_text;
  const ttsTask: AssetPlanType["tasks"][number] = {
    task_id: "tts_001", order: 0, task_type: "tts_audio", source_segment_id: null,
    source_excerpt: scriptText, production_intent: "生成全片口播音频", recommended_mode: "auto",
    provider_hint: "default_tts", prompt_draft: null, parameters: { voice_profile_id: "voice_default_male_storyteller", chunk_ids: fixture.storyboard.segments.map((_, index) => `tts_${String(index + 1).padStart(3, "0")}`) },
    manual_upload_policy: { allowed: false, required: false, accepted_file_types: [], acceptance_notes: [] },
    risk_notes: [], cost_tier: "low", initial_status: "planned",
  };
  const subtitleTask: AssetPlanType["tasks"][number] = {
    task_id: "subtitle_001", order: 1, task_type: "subtitle_track", source_segment_id: null,
    source_excerpt: scriptText, production_intent: "根据 TTS 时间戳生成字幕轨", recommended_mode: "auto",
    provider_hint: null, prompt_draft: null, parameters: { format: "srt", source_tts_task_id: "tts_001" },
    manual_upload_policy: { allowed: false, required: false, accepted_file_types: [], acceptance_notes: [] },
    risk_notes: [], cost_tier: "free", initial_status: "planned",
  };
  return {
    sourceIds: {
      storyboardRecordId: fixture.sourceIds.storyboard_record_id,
      scriptRecordId: fixture.sourceIds.script_record_id,
      topicPackageId: fixture.sourceIds.topic_package_id,
    },
    storyboard: fixture.storyboard,
    draft: fixture.script,
    globalDraft: {
      art_bible: legacy.art_bible,
      visual_budget: legacy.visual_budget,
      downgrade_policy: legacy.downgrade_policy,
      global_audio_strategy: legacy.global_audio_strategy,
      manual_review_notes: ["人工复核长稿资产一致性"],
    },
    audioSkeleton: {
      tts_plan: {
        voice_profile_id: "voice_default_male_storyteller",
        estimated_total_duration_sec: fixture.storyboard.estimated_total_duration_sec,
        chunking_strategy: "segment_boundary",
        chunks: fixture.storyboard.segments.map((segment, index) => ({
          chunk_id: `tts_${String(index + 1).padStart(3, "0")}`, order: index,
          script_excerpt: segment.script_excerpt,
          estimated_duration_sec: segment.end_hint_sec - segment.start_hint_sec,
        })),
      },
      tasks: [ttsTask, subtitleTask],
      dependencies: [{ dependency_id: "dep_subtitle_001_after_tts_001", task_id: "subtitle_001", depends_on_task_id: "tts_001", dependency_type: "requires_timing" }],
    },
    segmentVisualRoutes: makeRoutes(fixture.storyboard),
    chunks: fixture.storyboard.segments.map((segment, index) => ({
      chunkIndex: index,
      inputSegmentIds: [segment.segment_id],
      draft: {
        planning_mode: "segment_intent_batch",
        segments: [{
          source_segment_id: segment.segment_id,
          intents: [
            {
              asset_kind: "image_still", production_intent: "建立本段主视觉", image_prompt: segment.scene_description,
              video_prompt_reserve: `镜头延展：${segment.visual_intent}`, image_role: "anchor", support_reason: null,
              risk_notes: ["复核史实与人物一致性"],
            },
            ...(isApiVideoSuitability(segment.api_video_suitability)
              ? [
                  { asset_kind: "video_clip" as const, production_intent: "表现连续动作", video_prompt: segment.scene_description, why_static_insufficient: "连续动作推动叙事", risk_notes: ["复核动作连续性"] },
                  { asset_kind: "render_motion_cue" as const, production_intent: "以本地运镜增强节奏", risk_notes: ["复核运镜幅度"] },
                ]
              : [{ asset_kind: "render_motion_cue" as const, production_intent: "以本地运镜增强节奏", risk_notes: ["复核运镜幅度"] }]),
            ...(index === 0 ? [{
              asset_kind: "sfx_cue" as const, production_intent: "强调段落动作节点",
              required_tags: ["木槌", "回响"], mood_tags: ["克制"], selection_label: "长稿段落音效",
              timing_basis: "tts" as const, risk_notes: [],
            }] : []),
            ...(index === 0 ? [{
              asset_kind: "bgm_cue" as const, production_intent: "建立全片底乐", required_tags: ["历史", "克制"], mood_tags: ["悬疑"], selection_label: "长稿底乐",
              timing_basis: "tts" as const, scope: "global" as const, segment_ids: [], volume: 0.28, fade_in_sec: 1, fade_out_sec: 2, risk_notes: [],
            }] : []),
          ],
        }],
        budget_notes: [`segment:${segment.segment_id}`],
      },
    })),
  };
}

describe("asset plan downstream compatibility fixtures", () => {
  it("keeps the 15- and 21-segment synthetic inputs on shared schemas", () => {
    const long15 = parseLongFixture("long-15-segment-input.json");
    const long21 = parseLongFixture("long-21-segment-input.json");

    expect(long15.storyboard.segments).toHaveLength(15);
    expect(long15.storyboard.source_script_record_id).toBe(
      long15.sourceIds.script_record_id,
    );
    expect(long15.storyboard.source_topic_package_id).toBe(
      long15.sourceIds.topic_package_id,
    );
    expect(long15.storyboard.estimated_total_duration_sec).toBe(90);
    expect(long15.script.estimated_duration_sec).toBe(90);
    expect(long15.script.script_text.match(/[\u3400-\u9fff]/g)?.length ?? 0).toBeGreaterThanOrEqual(
      800,
    );
    expect(
      new Set(
        long15.storyboard.segments.map(
          (segment) => segment.api_video_suitability,
        ),
      ),
    ).toEqual(new Set(["api_video_strongly_recommended", "remotion_sufficient"]));
    expectContinuousStoryboardReferences(long15.script, long15.storyboard);

    expect(long21.sourceIds.topic_package_id).toBe(
      long15.sourceIds.topic_package_id,
    );
    expect(long21.storyboard.source_script_record_id).toBe(
      long21.sourceIds.script_record_id,
    );
    expect(long21.storyboard.source_topic_package_id).toBe(
      long21.sourceIds.topic_package_id,
    );
    expect(long21.storyboard.segments).toHaveLength(21);
    expect(long21.storyboard.segments.map((segment) => segment.order)).toEqual(
      Array.from({ length: 21 }, (_, index) => index),
    );
    expect(
      new Set(long21.storyboard.segments.map((segment) => segment.segment_id))
        .size,
    ).toBe(21);
    expectContinuousStoryboardReferences(long21.script, long21.storyboard);
  });

  it("accepts the legacy chunk fixture through the current generation parser", async () => {
    const long15 = parseLongFixture("long-15-segment-input.json");
    const plan = AssetPlan.parse(readFixture("legacy-plan-valid.json"));
    const chunkDraft = z.record(z.string(), z.unknown()).parse(
      readFixture("legacy-chunk-valid.json"),
    );
    const firstStoryboard: StoryboardPlanType = {
      ...long15.storyboard,
      estimated_total_duration_sec: 6,
      segments: [long15.storyboard.segments[0]!],
    };

    const { gateway, calls } = makeLegacyGateway(plan, chunkDraft);
    const generated = await generateAssetPlan({
      sourceStoryboardRecordId: long15.sourceIds.storyboard_record_id,
      sourceScriptRecordId: long15.sourceIds.script_record_id,
      sourceTopicPackageId: long15.sourceIds.topic_package_id,
      storyboard: firstStoryboard,
      draft: long15.script,
      topicBoundaryContext: makeTopicBoundaryContext(),
      segmentVisualRoutes: makeRoutes(firstStoryboard),
      llmGateway: gateway,
      chunkSize: 1,
    });

    expect(generated).toMatchObject({
      plan_version: "asset_plan_v1",
      source_storyboard_record_id: long15.sourceIds.storyboard_record_id,
      source_script_record_id: long15.sourceIds.script_record_id,
      source_topic_package_id: long15.sourceIds.topic_package_id,
    });
    const generatedImage = generated.tasks.find(
      (task) => task.task_id === "img_003",
    );
    const generatedMotion = generated.tasks.find(
      (task) => task.task_id === "motion_004",
    );
    expect(generatedImage).toMatchObject({
      task_type: "image_still",
      source_segment_id: "seg_001",
      source_excerpt: firstStoryboard.segments[0]!.script_excerpt,
    });
    expect(generatedMotion).toMatchObject({
      task_type: "render_motion_cue",
      source_segment_id: "seg_001",
      source_excerpt: firstStoryboard.segments[0]!.script_excerpt,
    });
    expect(generated.dependencies).toContainEqual({
      dependency_id: "dep_2_dep_local_motion_after_image",
      task_id: "motion_004",
      depends_on_task_id: "img_003",
      dependency_type: "requires_output",
    });
    expect(generated.cost_summary).toMatchObject({
      total_tasks: 4,
      by_type: {
        tts_audio: 1,
        subtitle_track: 1,
        image_still: 1,
        render_motion_cue: 1,
      },
      by_cost_tier: { free: 2, low: 2, medium: 0, high: 0 },
      estimated_provider_calls: 2,
    });
    expect(calls).toHaveLength(2);
    expect(
      calls.map(
        (call) => (call.input as { planning_mode?: string }).planning_mode,
      ),
    ).toEqual(["global", "segment_chunk"]);
  });

  it("characterizes wrapper drift as a current repair-boundary failure", async () => {
    const long15 = parseLongFixture("long-15-segment-input.json");
    const plan = AssetPlan.parse(readFixture("legacy-plan-valid.json"));
    const validChunk = z.record(z.string(), z.unknown()).parse(
      readFixture("legacy-chunk-valid.json"),
    );
    const wrapperDrift = readFixture(
      "legacy-chunk-repair-wrapper-drift.json",
    );
    const tasks = z.array(z.record(z.string(), z.unknown())).parse(
      validChunk.tasks,
    );
    const { recommended_mode: _recommendedMode, ...invalidFirstTask } =
      tasks[0]!;
    const invalidChunk = {
      ...validChunk,
      tasks: [invalidFirstTask, ...tasks.slice(1)],
    };
    const calls: InvokeStructuredPromptOptions[] = [];
    const gateway: LlmGateway = {
      async invokeStructuredPrompt<T>(
        options: InvokeStructuredPromptOptions,
      ): Promise<T> {
        calls.push(options);
        if (options.promptId === "asset-planning.asset-structural-repair") {
          return wrapperDrift as T;
        }
        const input = options.input as { planning_mode?: string };
        if (input.planning_mode === "global") {
          return {
            planning_mode: "global",
            art_bible: plan.art_bible,
            visual_budget: plan.visual_budget,
            downgrade_policy: plan.downgrade_policy,
            global_audio_strategy: plan.global_audio_strategy,
            manual_review_notes: [],
          } as T;
        }
        return invalidChunk as T;
      },
      invokeStrictStructured: vi.fn(),
    };
    const firstStoryboard: StoryboardPlanType = {
      ...long15.storyboard,
      estimated_total_duration_sec: 6,
      segments: [long15.storyboard.segments[0]!],
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    // Task 1 固定当前 strict repair 边界：真实 wrapper drift 会进入 repair Prompt，
    // 随后稳定失败。Task 2 接入窄 coercion 后，应把该 characterization 迁移为成功回归。
    let caught: unknown;
    try {
      await generateAssetPlan({
        sourceStoryboardRecordId: long15.sourceIds.storyboard_record_id,
        sourceScriptRecordId: long15.sourceIds.script_record_id,
        sourceTopicPackageId: long15.sourceIds.topic_package_id,
        storyboard: firstStoryboard,
        draft: long15.script,
        topicBoundaryContext: makeTopicBoundaryContext(),
        segmentVisualRoutes: makeRoutes(firstStoryboard),
        llmGateway: gateway,
        chunkSize: 1,
      });
    } catch (error) {
      caught = error;
    } finally {
      warn.mockRestore();
    }

    expect(caught).toBeInstanceOf(LlmOutputError);
    expect((caught as LlmOutputError).code).toBe(
      "asset_chunk_plan_schema_invalid",
    );
    expect(
      calls.filter(
        (call) => call.promptId === "asset-planning.asset-structural-repair",
      ),
    ).toHaveLength(1);
    expect(calls.map((call) => call.promptId)).toEqual([
      "asset-planning.planner",
      "asset-planning.planner",
      "asset-planning.asset-structural-repair",
    ]);
  });

  it("keeps a complete legacy AssetPlan valid for the local validator and downstream readers", () => {
    const long15 = parseLongFixture("long-15-segment-input.json");
    const plan = AssetPlan.parse(readFixture("legacy-plan-valid.json"));

    const validation = validateAssetPlan({
      plan,
      storyboard: long15.storyboard,
      scriptText: long15.script.script_text,
      storyboardRecordId: long15.sourceIds.storyboard_record_id,
      scriptRecordId: long15.sourceIds.script_record_id,
      topicPackageId: long15.sourceIds.topic_package_id,
    });
    expect(validation.decision).toBe("pass");
    expect(validation.errors).toEqual([]);

    const anchorImage = plan.tasks.find(
      (task) => task.task_id === "image_seg_001_anchor",
    )!;
    expect(anchorImage.parameters).toMatchObject({
      image_role: "anchor",
      video_prompt_reserve: expect.any(String),
    });

    const video = plan.tasks.find(
      (task) => task.task_id === "video_seg_001",
    )!;
    expect(video.parameters).toMatchObject({
      static_fallback_task_id: anchorImage.task_id,
      why_static_insufficient: expect.any(String),
    });

    const motion = plan.tasks.find(
      (task) => task.task_id === "motion_seg_002",
    )!;
    expect(motion.parameters).toMatchObject({ recipe_type: "push_in" });

    const sfx = plan.tasks.find((task) => task.task_type === "sfx_cue")!;
    expect(readSfxCueParams(sfx.parameters)).toEqual({
      requiredTags: ["木槌落案", "盐包摩擦"],
      moodTags: ["克制", "紧张"],
      libraryItemId: null,
      selectionLabel: "公开复秤揭示音",
    });

    const bgm = plan.tasks.find((task) => task.task_type === "bgm_cue")!;
    expect(readBgmCueParams(bgm.parameters)).toEqual({
      requiredTags: ["低频弦乐", "缓慢鼓点"],
      moodTags: ["悬疑", "坚决"],
      volume: 0.28,
      fadeInSec: 1.5,
      fadeOutSec: 2,
      scope: "global",
      segmentIds: [],
      libraryItemId: null,
      selectionLabel: "盐道查仓底乐",
    });

    expect(anchorImage.manual_upload_policy.accepted_file_types).toEqual([
      "image/png",
      "image/jpeg",
    ]);
    expect(video.manual_upload_policy.accepted_file_types).toEqual([
      "video/mp4",
      "video/quicktime",
    ]);
    const acceptedAudioTypes = [
      "audio/mpeg",
      "audio/wav",
      "audio/x-wav",
      "audio/mp4",
      "audio/aac",
      "audio/ogg",
    ];
    expect(sfx.manual_upload_policy.accepted_file_types).toEqual(
      acceptedAudioTypes,
    );
    expect(bgm.manual_upload_policy.accepted_file_types).toEqual(
      acceptedAudioTypes,
    );
    expect(motion.manual_upload_policy).toMatchObject({
      allowed: false,
      required: false,
      accepted_file_types: [],
    });
    for (const taskType of ["tts_audio", "subtitle_track"] as const) {
      expect(
        plan.tasks.find((task) => task.task_type === taskType)!
          .manual_upload_policy,
      ).toMatchObject({
        allowed: false,
        required: false,
        accepted_file_types: [],
      });
    }

    const manifest = buildInitialAssetManifest({
      assetPlanRecordId: "asset_plan_record_synthetic_long_15",
      assetPlan: plan,
      segmentIds: long15.storyboard.segments.map(
        (segment) => segment.segment_id,
      ),
    });
    expect(manifest.notes).not.toContain(
      "tts_chunk_segment_count_mismatch: TTS chunks and storyboard segments differ in count",
    );
    expect(manifest.audio_summary.tts_chunk_routes).toHaveLength(
      long15.storyboard.segments.length,
    );
    expect(
      manifest.segment_routes.every(
        (route) => route.tts_artifact_id !== null,
      ),
    ).toBe(true);
    for (const [index, segment] of long15.storyboard.segments.entries()) {
      expect(manifest.audio_summary.tts_chunk_routes[index]).toMatchObject({
        segment_ids: [segment.segment_id],
        script_excerpt: segment.script_excerpt,
      });
    }
    expect(manifest.segment_routes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          segment_id: "seg_001",
          visual_route_type: "video_clip",
        }),
        expect.objectContaining({
          segment_id: "seg_002",
          visual_route_type: "image_with_motion",
          motion_artifact_id: "artifact_motion_motion_seg_002",
        }),
      ]),
    );
    expect(manifest.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          artifact_id: "artifact_motion_motion_seg_002",
          artifact_type: "motion_recipe",
          origin: "inline",
          file_uri: "inline://motion-recipe/motion_seg_002",
          metadata: expect.objectContaining({ recipe_type: "push_in" }),
        }),
      ]),
    );

    expect(plan.cost_summary).toEqual({
      total_tasks: plan.tasks.length,
      by_type: {
        tts_audio: 1,
        subtitle_track: 1,
        image_still: 2,
        video_clip: 1,
        render_motion_cue: 1,
        sfx_cue: 1,
        bgm_cue: 1,
      },
      by_cost_tier: { free: 2, low: 5, medium: 0, high: 1 },
      estimated_provider_calls: 4,
      notes: ["高成本视频仅用于开场雨夜奔跑，静态主图始终保留。"],
    });
  });

  it.each(["long-15-segment-input.json", "long-21-segment-input.json"])(
    "keeps compiler output for %s valid across schema, validator and downstream manifest contracts",
    (filename) => {
      const fixture = parseLongFixture(filename);
      const compiled = compileAssetPlanFromIntents(makeCompilerInput(fixture));
      const plan = AssetPlan.parse(compiled.plan);
      const validation = validateAssetPlan({
        plan,
        storyboard: fixture.storyboard,
        scriptText: fixture.script.script_text,
        storyboardRecordId: fixture.sourceIds.storyboard_record_id,
        scriptRecordId: fixture.sourceIds.script_record_id,
        topicPackageId: fixture.sourceIds.topic_package_id,
      });
      expect(validation.errors).toEqual([]);
      expect(validation.decision).toBe("pass");

      expect(compiled.actions).toEqual([
        ...fixture.storyboard.segments.map((segment) => ({
          code: "visual_strategy_applied",
          segment_id: segment.segment_id,
          route: isApiVideoSuitability(segment.api_video_suitability) ? "api_video" : "remotion",
          reason_code: "test_route",
        })),
        {
          code: "global_bgm_owner_bound",
          segment_id: fixture.storyboard.segments[0]!.segment_id,
        },
      ]);

      const acceptedAudioTypes = [
        "audio/mpeg",
        "audio/wav",
        "audio/x-wav",
        "audio/mp4",
        "audio/aac",
        "audio/ogg",
      ];
      for (const segment of fixture.storyboard.segments) {
        const segmentTasks = plan.tasks.filter(
          (task) => task.source_segment_id === segment.segment_id,
        );
        const anchor = segmentTasks.find(
          (task) =>
            task.task_type === "image_still" &&
            task.parameters.image_role === "anchor",
        )!;
        expect(anchor).toMatchObject({
          source_excerpt: segment.script_excerpt,
          recommended_mode: "manual_allowed",
          manual_upload_policy: {
            allowed: true,
            required: false,
            accepted_file_types: ["image/png", "image/jpeg"],
          },
        });
        expect(anchor.parameters.video_prompt_reserve).toEqual(
          expect.any(String),
        );

        if (isApiVideoSuitability(segment.api_video_suitability)) {
          const video = segmentTasks.find(
            (task) => task.task_type === "video_clip",
          )!;
          expect(video.parameters).toMatchObject({
            static_fallback_task_id: anchor.task_id,
            why_static_insufficient: expect.any(String),
          });
          expect(video.manual_upload_policy.accepted_file_types).toEqual([
            "video/mp4",
            "video/quicktime",
          ]);
          expect(plan.dependencies).toContainEqual({
            dependency_id: `dep_${video.task_id}_after_${anchor.task_id}_requires_output`,
            task_id: video.task_id,
            depends_on_task_id: anchor.task_id,
            dependency_type: "requires_output",
          });
        } else {
          const motion = segmentTasks.find(
            (task) => task.task_type === "render_motion_cue",
          )!;
          expect(motion.parameters).toEqual({
            recipe_type: segment.motion_hint,
            source_image_task_id: anchor.task_id,
          });
          expect(motion.manual_upload_policy).toMatchObject({
            allowed: false,
            required: false,
            accepted_file_types: [],
          });
          expect(plan.dependencies).toContainEqual({
            dependency_id: `dep_${motion.task_id}_after_${anchor.task_id}_requires_output`,
            task_id: motion.task_id,
            depends_on_task_id: anchor.task_id,
            dependency_type: "requires_output",
          });
        }
      }

      const bgmTask = plan.tasks.find((task) => task.task_type === "bgm_cue")!;
      expect(readBgmCueParams(bgmTask.parameters)).toMatchObject({
        requiredTags: ["历史", "克制"], scope: "global", segmentIds: [],
      });
      expect(bgmTask.source_segment_id).toBe(
        fixture.storyboard.segments[0]!.segment_id,
      );
      expect(bgmTask.manual_upload_policy.accepted_file_types).toEqual(
        acceptedAudioTypes,
      );
      const sfxTask = plan.tasks.find((task) => task.task_type === "sfx_cue")!;
      expect(readSfxCueParams(sfxTask.parameters)).toEqual({
        requiredTags: ["木槌", "回响"], moodTags: ["克制"],
        libraryItemId: null, selectionLabel: "长稿段落音效",
      });
      expect(sfxTask.parameters.timing_basis).toBe("tts");
      expect(sfxTask.manual_upload_policy.accepted_file_types).toEqual(
        acceptedAudioTypes,
      );
      for (const audioTask of [sfxTask, bgmTask]) {
        expect(plan.dependencies).toContainEqual({
          dependency_id: `dep_${audioTask.task_id}_after_tts_001_requires_timing`,
          task_id: audioTask.task_id,
          depends_on_task_id: "tts_001",
          dependency_type: "requires_timing",
        });
      }

      const manifest = buildInitialAssetManifest({
        assetPlanRecordId: `compiled_${fixture.storyboard.segments.length}`,
        assetPlan: plan,
        segmentIds: fixture.storyboard.segments.map((segment) => segment.segment_id),
      });
      expect(manifest.audio_summary.tts_chunk_routes).toHaveLength(fixture.storyboard.segments.length);
      expect(manifest.segment_routes).toHaveLength(fixture.storyboard.segments.length);
      expect(manifest.notes).not.toContain(
        "tts_chunk_segment_count_mismatch: TTS chunks and storyboard segments differ in count",
      );
      expect(manifest.audio_summary.bgm_placements).toEqual([
        expect.objectContaining({
          source_task_id: bgmTask.task_id,
          scope: "global",
          start_policy: "timeline_start",
          end_policy: "timeline_end",
          segment_ids: [],
          volume: 0.28,
          fade_in_sec: 1,
          fade_out_sec: 2,
        }),
      ]);

      for (const segment of fixture.storyboard.segments) {
        const route = manifest.segment_routes.find(
          (candidate) => candidate.segment_id === segment.segment_id,
        )!;
        expect(route.tts_artifact_id).not.toBeNull();
        if (isApiVideoSuitability(segment.api_video_suitability)) {
          // API route 同时保留同段 motion artifact（Remotion 降级路径）
          expect(route).toMatchObject({
            visual_route_type: "video_clip",
            motion_artifact_id: expect.any(String),
          });
        } else {
          const motionTask = plan.tasks.find(
            (task) =>
              task.source_segment_id === segment.segment_id &&
              task.task_type === "render_motion_cue",
          )!;
          expect(route).toMatchObject({
            visual_route_type: "image_with_motion",
            motion_artifact_id: `artifact_motion_${motionTask.task_id}`,
          });
          expect(manifest.artifacts).toContainEqual(
            expect.objectContaining({
              artifact_id: `artifact_motion_${motionTask.task_id}`,
              artifact_type: "motion_recipe",
              origin: "inline",
              metadata: expect.objectContaining({
                recipe_type: segment.motion_hint,
              }),
            }),
          );
        }
      }

      expect(manifest.executions).toHaveLength(plan.tasks.length);
      expect(
        manifest.executions.filter(
          (execution) => execution.task_type === "render_motion_cue",
        ).every(
          (execution) =>
            execution.status === "completed" &&
            execution.origin === "local" &&
            execution.output_artifact_ids.length === 1,
        ),
      ).toBe(true);
    },
  );

  it("freezes the observed repair wrapper drift and isolated legacy timing error", () => {
    const wrapper = z.record(z.string(), z.unknown()).parse(
      readFixture("legacy-chunk-repair-wrapper-drift.json"),
    );
    expect(Object.keys(wrapper)).toEqual(["patch_fields"]);
    expect(wrapper).not.toHaveProperty("patch_type");
    expect(wrapper.patch_fields).toEqual(
      expect.objectContaining({
        task_patches: expect.any(Array),
        dependency_patches: expect.any(Array),
      }),
    );

    const long15 = parseLongFixture("long-15-segment-input.json");
    const invalidPlan = AssetPlan.parse(
      readFixture("legacy-plan-invalid-audio-timing.json"),
    );
    expect(
      invalidPlan.tasks.filter((task) => task.task_type === "tts_audio"),
    ).toHaveLength(1);
    const invalidTimingEdges = invalidPlan.dependencies.filter(
      (dependency) =>
        dependency.task_id === "sfx_seg_005" &&
        dependency.depends_on_task_id === "motion_seg_002" &&
        dependency.dependency_type === "requires_timing",
    );
    expect(invalidTimingEdges).toHaveLength(1);

    const validation = validateAssetPlan({
      plan: invalidPlan,
      storyboard: long15.storyboard,
      scriptText: long15.script.script_text,
      storyboardRecordId: long15.sourceIds.storyboard_record_id,
      scriptRecordId: long15.sourceIds.script_record_id,
      topicPackageId: long15.sourceIds.topic_package_id,
    });
    expect(validation.decision).toBe("regen_once");
    expect(validation.errors).toEqual(["asset_dependency_timing_source_invalid"]);
    expect(validation.warnings).toEqual([]);
  });
});
