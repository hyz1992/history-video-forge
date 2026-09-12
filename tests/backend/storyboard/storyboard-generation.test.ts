import { describe, expect, it, vi } from "vitest";

import { createHash } from "node:crypto";
import { StoryboardPlan, canonicalStringify, type ScriptDraftPackage } from "../../../shared/src/index.js";
import type {
  InvokeStructuredPromptOptions,
  LlmGateway,
} from "../../../backend/src/runtime/llm/llm-gateway.js";
import { createLlmGateway } from "../../../backend/src/runtime/llm/llm-gateway.js";
import { createOpenAiCompatibleProvider } from "../../../backend/src/runtime/llm/openai-compatible-provider.js";
import { LlmOutputError } from "../../../backend/src/runtime/llm/llm-output-error.js";
import { createPromptRegistry } from "../../../backend/src/runtime/prompts/prompt-registry.js";
import { normalizeNarrationTiming } from "../../../backend/src/modules/narration/narration-timing-normalizer.js";
import {
  buildStoryboardPlannerPromptInput,
  generateStoryboardPlan,
  recalculateSegmentTimings,
  regenerateSingleSegment,
} from "../../../backend/src/modules/storyboard/storyboard-generation.service.js";
import type { GenerateStoryboardPlanInput } from "../../../backend/src/modules/storyboard/storyboard-generation.service.js";

function makeDraft(): ScriptDraftPackage {
  return {
    script_text:
      "楚王第一次压场时，晏子没有退。他站在殿前，看着那扇为羞辱他而开的矮门。第二次，楚王又说齐国没人，才派这样的人来。最后，晏子用橘生淮南则为橘，把第三次压场顶回去。",
    estimated_duration_sec: 58,
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
        confidence: 0.95,
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
    ending_span: "把第三次压场顶回去。",
  };
}

function makeInput(llmGateway?: LlmGateway) {
  return {
    sourceScriptRecordId: "scr_001",
    sourceTopicPackageId: "topic_001",
    draft: makeDraft(),
    topicBoundaryContext: {
      title: "晏子使楚",
      selected_angle: "楚王连压三次，晏子一次没退",
      core_conflict: "楚王连续压场，晏子必须顶回去",
      strong_scene: "殿前对峙",
      forbidden_expansions: [],
      risk_hints: [],
      source_anchor_refs: ["《晏子春秋》"],
      canonical_quotes: ["橘生淮南则为橘"],
      narrative_tension_map: {
        hook_claim: "连压三次",
      },
    },
    llmGateway,
  };
}

describe("generateStoryboardPlan", () => {
  it("returns a parseable StoryboardPlan from the deterministic stub path", async () => {
    const plan = await generateStoryboardPlan(makeInput());

    const parsed = StoryboardPlan.parse(plan);
    expect(parsed.source_script_record_id).toBe("scr_001");
    expect(parsed.source_topic_package_id).toBe("topic_001");
    expect(parsed.segments.length).toBeGreaterThanOrEqual(3);
    for (const segment of parsed.segments) {
      expect(makeDraft().script_text).toContain(segment.script_excerpt);
    }
  });

  it("keeps deterministic excerpts contiguous when the script contains line breaks", async () => {
    const input = makeInput();
    input.draft = {
      ...input.draft,
      script_text: [
        "第一句把观众带进现场。",
        "第二句继续施加压力。第三句给出转折。",
        "第四句收住结尾。",
      ].join("\n"),
      beat_trace: [],
      quote_trace: [],
    };

    const plan = await generateStoryboardPlan(input);

    for (const segment of plan.segments) {
      expect(input.draft.script_text).toContain(segment.script_excerpt);
    }
  });

  it("invokes the LLM gateway with storyboard.planner", async () => {
    const invokeStructuredPromptSpy = vi.fn();
    const gateway: LlmGateway = {
      async invokeStructuredPrompt<T>(
        options: InvokeStructuredPromptOptions,
      ): Promise<T> {
        invokeStructuredPromptSpy(options);
        const promptInput = options.input as ReturnType<
          typeof buildStoryboardPlannerPromptInput
        >;

        return {
          plan_version: "storyboard_v1",
          source_script_record_id: promptInput.source_script_record_id,
          source_topic_package_id: promptInput.source_topic_package_id,
          estimated_total_duration_sec: promptInput.draft.estimated_duration_sec,
          segments: [
            {
              segment_id: "sb_001",
              order: 0,
              script_excerpt: promptInput.draft.script_text,
              start_hint_sec: 0,
              end_hint_sec: promptInput.draft.estimated_duration_sec,
              narrative_role: "opening",
              visual_intent: "让观众看清整段压力推进。",
              scene_description: "按口播顺序呈现主要场面。",
              visual_elements: ["晏子", "楚王"],
              framing_hint: "medium",
              content_type: "live_action",
              motion_hint: "static",
              editing_hint: "single",
              on_screen_text: [],
              linked_beats: promptInput.draft.beat_trace.map((trace) => trace.beat),
              linked_quotes: promptInput.draft.quote_trace.map((trace) => trace.quote),
              risk_notes: [],
            api_video_suitability: "remotion_sufficient",
            },
          ],
          global_visual_notes: [],
        } as T;
      },
      invokeStrictStructured: vi.fn(),
    };

    await generateStoryboardPlan(makeInput(gateway));

    expect(invokeStructuredPromptSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        promptId: "storyboard.planner",
      }),
    );
  });

  it("applies Task 10 approved thinking=disabled to the storyboard.planner production call without explicit options", async () => {
    // 生产 generateStoryboardPlan 不传 options；operation policy 必须让 invokeApi 收到 thinking=disabled。
    const draft = makeDraft();
    const planPayload = {
      plan_version: "storyboard_v1",
      source_script_record_id: "scr_001",
      source_topic_package_id: "topic_001",
      estimated_total_duration_sec: draft.estimated_duration_sec,
      segments: [
        {
          segment_id: "sb_001",
          order: 0,
          script_excerpt: draft.script_text,
          start_hint_sec: 0,
          end_hint_sec: draft.estimated_duration_sec,
          narrative_role: "opening",
          visual_intent: "让观众看清整段压力推进。",
          scene_description: "按口播顺序呈现主要场面。",
          visual_elements: ["晏子", "楚王"],
          framing_hint: "medium",
          content_type: "live_action",
          motion_hint: "static",
          editing_hint: "single",
          on_screen_text: [],
          linked_beats: draft.beat_trace.map((trace) => trace.beat),
          linked_quotes: draft.quote_trace.map((trace) => trace.quote),
          risk_notes: [],
        api_video_suitability: "remotion_sufficient",
        },
      ],
      global_visual_notes: [],
    };
    const invokeApi = vi.fn(async () => ({
      rawOutput: JSON.stringify(planPayload),
      content: JSON.stringify(planPayload),
      metadata: {},
    }));
    const gateway = createLlmGateway({
      registry: createPromptRegistry(),
      provider: createOpenAiCompatibleProvider({
        model: "glm-5.2",
        invokeApi,
      }),
    });

    await generateStoryboardPlan(makeInput(gateway));

    expect(invokeApi).toHaveBeenCalledTimes(1);
    expect(invokeApi).toHaveBeenCalledWith(
      expect.objectContaining({
        operationName: "storyboard.planner",
        thinking: "disabled",
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("includes regeneration context as structured prompt input", () => {
    const promptInput = buildStoryboardPlannerPromptInput({
      ...makeInput(),
      regenerationContext: {
        reason: "storyboard_local_validation_regen_once",
        errors: ["storyboard_script_coverage_too_low"],
        metrics: { coverage_ratio: 0.5 },
      },
    });

    expect(
      "regeneration_context" in promptInput
        ? promptInput.regeneration_context
        : null,
    ).toEqual({
      reason: "storyboard_local_validation_regen_once",
      errors: ["storyboard_script_coverage_too_low"],
      metrics: { coverage_ratio: 0.5 },
    });
  });

  it("unwraps StoryboardPlan envelope returned by real structured providers", async () => {
    const gateway: LlmGateway = {
      async invokeStructuredPrompt<T>(
        options: InvokeStructuredPromptOptions,
      ): Promise<T> {
        const promptInput = options.input as ReturnType<
          typeof buildStoryboardPlannerPromptInput
        >;

        return {
          StoryboardPlan: {
            plan_version: "storyboard_v1",
            source_script_record_id: promptInput.source_script_record_id,
            source_topic_package_id: promptInput.source_topic_package_id,
            estimated_total_duration_sec: promptInput.draft.estimated_duration_sec,
            segments: [
              {
                segment_id: "sb_001",
                order: 0,
                script_excerpt: promptInput.draft.script_text,
                start_hint_sec: 0,
                end_hint_sec: promptInput.draft.estimated_duration_sec,
                narrative_role: "opening",
                visual_intent: "让观众看清整段压力推进。",
                scene_description: "按口播顺序呈现主要场面。",
                visual_elements: ["晏子", "楚王"],
                framing_hint: "medium",
                content_type: "live_action",
                motion_hint: "static",
                editing_hint: "single",
                on_screen_text: [],
                linked_beats: promptInput.draft.beat_trace.map((trace) => trace.beat),
                linked_quotes: promptInput.draft.quote_trace.map((trace) => trace.quote),
                risk_notes: [],
              api_video_suitability: "remotion_sufficient",
              },
            ],
            global_visual_notes: [],
          },
        } as T;
      },
      invokeStrictStructured: vi.fn(),
    };

    const plan = await generateStoryboardPlan(makeInput(gateway));

    expect(plan.plan_version).toBe("storyboard_v1");
    expect(plan.source_script_record_id).toBe("scr_001");
  });

  it("normalizes camelCase riskNotes on returned segments", async () => {
    const gateway: LlmGateway = {
      async invokeStructuredPrompt<T>(
        options: InvokeStructuredPromptOptions,
      ): Promise<T> {
        const promptInput = options.input as ReturnType<
          typeof buildStoryboardPlannerPromptInput
        >;

        return {
          plan_version: "storyboard_v1",
          source_script_record_id: promptInput.source_script_record_id,
          source_topic_package_id: promptInput.source_topic_package_id,
          estimated_total_duration_sec: promptInput.draft.estimated_duration_sec,
          segments: [
            {
              segment_id: "sb_001",
              order: 0,
              script_excerpt: promptInput.draft.script_text,
              start_hint_sec: 0,
              end_hint_sec: promptInput.draft.estimated_duration_sec,
              narrative_role: "opening",
              visual_intent: "让观众看清整段压力推进。",
              scene_description: "按口播顺序呈现主要场面。",
              visual_elements: ["晏子", "楚王"],
              framing_hint: "medium",
              content_type: "live_action",
              motion_hint: "static",
              editing_hint: "single",
              on_screen_text: [],
              linked_beats: promptInput.draft.beat_trace.map((trace) => trace.beat),
              linked_quotes: promptInput.draft.quote_trace.map((trace) => trace.quote),
              riskNotes: ["注意不要补写素材生成任务"],
              api_video_suitability: "remotion_sufficient",
            },
          ],
          global_visual_notes: [],
        } as T;
      },
      invokeStrictStructured: vi.fn(),
    };

    const plan = await generateStoryboardPlan(makeInput(gateway));

    expect(plan.segments[0]?.risk_notes).toEqual(["注意不要补写素材生成任务"]);
  });

  it("flattens linked_beats/linked_quotes object arrays to string arrays (debeecaa regression)", async () => {
    // 真实事故项目 debeecaa：LLM 把 linked_beats 写成对象数组（模仿 draft.beat_trace
    // 结构），导致 StoryboardPlan.parse 抛 ZodError → internal_server_error。
    // normalizeStoryboardSegment 必须把对象数组扁平化为字符串数组（取 beat 字段）。
    let capturedFirstBeat = "";
    let capturedFirstQuote = "";
    const gateway: LlmGateway = {
      async invokeStructuredPrompt<T>(
        options: InvokeStructuredPromptOptions,
      ): Promise<T> {
        const promptInput = options.input as ReturnType<
          typeof buildStoryboardPlannerPromptInput
        >;
        const firstBeat = promptInput.draft.beat_trace[0]!;
        const firstQuote = (promptInput.draft.quote_trace[0] ?? {
          quote: "测试 quote",
          excerpt: "测试 excerpt",
        }) as { quote: string; excerpt: string };
        capturedFirstBeat = firstBeat.beat;
        capturedFirstQuote = firstQuote.quote;

        return {
          plan_version: "storyboard_v1",
          source_script_record_id: promptInput.source_script_record_id,
          source_topic_package_id: promptInput.source_topic_package_id,
          estimated_total_duration_sec: promptInput.draft.estimated_duration_sec,
          segments: [
            {
              segment_id: "sb_001",
              order: 0,
              script_excerpt: promptInput.draft.script_text,
              start_hint_sec: 0,
              end_hint_sec: promptInput.draft.estimated_duration_sec,
              narrative_role: "opening",
              visual_intent: "让观众看清整段压力推进。",
              scene_description: "按口播顺序呈现主要场面。",
              visual_elements: ["晏子", "楚王"],
              framing_hint: "medium",
              content_type: "live_action",
              motion_hint: "static",
              editing_hint: "single",
              on_screen_text: [],
              // LLM 漂移：对象数组而非字符串数组
              linked_beats: [
                {
                  beat: firstBeat.beat,
                  excerpt: firstBeat.excerpt,
                  confidence: 0.95,
                },
                // 混入字符串（部分 LLM 会混用）
                "另一个 beat 名字",
                // 混入空字符串（应被过滤）
                "",
                // 混入只含 excerpt 的对象（beat 字段缺失的兜底）
                { excerpt: "只用 excerpt 的 beat" },
                // 混入无效对象（应被跳过）
                { foo: 123 },
                // 混入 null / number（应被跳过）
                null,
                42,
              ],
              linked_quotes: [
                {
                  quote: firstQuote.quote,
                  excerpt: firstQuote.excerpt,
                },
              ],
              risk_notes: [],
            api_video_suitability: "remotion_sufficient",
            },
          ],
          global_visual_notes: [],
        } as T;
      },
      invokeStrictStructured: vi.fn(),
    };

    const plan = await generateStoryboardPlan(makeInput(gateway));

    expect(plan.segments[0]?.linked_beats).toEqual([
      capturedFirstBeat,
      "另一个 beat 名字",
      "只用 excerpt 的 beat",
    ]);
    expect(plan.segments[0]?.linked_quotes).toEqual([capturedFirstQuote]);
  });

  it("keeps already-correct string array linked_beats unchanged", async () => {
    // 回归保护：当 LLM 输出正确的字符串数组时，规范化不应改变它。
    const gateway: LlmGateway = {
      async invokeStructuredPrompt<T>(
        options: InvokeStructuredPromptOptions,
      ): Promise<T> {
        const promptInput = options.input as ReturnType<
          typeof buildStoryboardPlannerPromptInput
        >;

        return {
          plan_version: "storyboard_v1",
          source_script_record_id: promptInput.source_script_record_id,
          source_topic_package_id: promptInput.source_topic_package_id,
          estimated_total_duration_sec: promptInput.draft.estimated_duration_sec,
          segments: [
            {
              segment_id: "sb_001",
              order: 0,
              script_excerpt: promptInput.draft.script_text,
              start_hint_sec: 0,
              end_hint_sec: promptInput.draft.estimated_duration_sec,
              narrative_role: "opening",
              visual_intent: "x",
              scene_description: "x",
              visual_elements: ["a"],
              framing_hint: "medium",
              content_type: "live_action",
              motion_hint: "static",
              editing_hint: "single",
              on_screen_text: [],
              linked_beats: promptInput.draft.beat_trace.map((t) => t.beat),
              linked_quotes: [],
              risk_notes: [],
            api_video_suitability: "remotion_sufficient",
            },
          ],
          global_visual_notes: [],
        } as T;
      },
      invokeStrictStructured: vi.fn(),
    };

    const plan = await generateStoryboardPlan(makeInput(gateway));

    expect(plan.segments[0]?.linked_beats).toEqual(
      plan.segments[0]?.linked_beats,
    );
    // 必须能通过 StoryboardPlan.parse（不抛异常已经验证），且字段为字符串数组
    for (const beat of plan.segments[0]?.linked_beats ?? []) {
      expect(typeof beat).toBe("string");
      expect(beat.length).toBeGreaterThan(0);
    }
  });

  it("wraps ZodError from StoryboardPlan.parse into LlmOutputError with storyboard_plan_schema_invalid", async () => {
    // LLM 输出无法被 normalize 修复的结构错误（例如 segments 缺失），
    // 必须被包装成 LlmOutputError(code=storyboard_plan_schema_invalid)，
    // 而不是裸 ZodError 冒泡到 run service 被折叠成 internal_server_error。
    const gateway: LlmGateway = {
      async invokeStructuredPrompt<T>(): Promise<T> {
        // segments 缺失——schema 必报错，normalize 无法补
        return { plan_version: "storyboard_v1" } as T;
      },
      invokeStrictStructured: vi.fn(),
    };

    await expect(generateStoryboardPlan(makeInput(gateway))).rejects.toMatchObject({
      code: "storyboard_plan_schema_invalid",
    });

    try {
      await generateStoryboardPlan(makeInput(gateway));
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(LlmOutputError);
      expect((error as LlmOutputError).code).toBe(
        "storyboard_plan_schema_invalid",
      );
      expect(Array.isArray((error as LlmOutputError).cause)).toBe(true);
    }
  });
});

describe("regenerateSingleSegment", () => {
  it("wraps ZodError from StoryboardSegment.parse into LlmOutputError with storyboard_segment_schema_invalid", async () => {
    // 构造一个合法 plan 作为基线
    const basePlan = await generateStoryboardPlan(makeInput());
    const targetSegmentId = basePlan.segments[0]!.segment_id;

    // 让 segment-regen 返回一个非锁定字段类型错误（on_screen_text 应为数组），
    // mergeSegmentWithLocks 会用 incoming 覆盖 original，导致 merged 无法通过 schema。
    const gateway: LlmGateway = {
      async invokeStructuredPrompt<T>(): Promise<T> {
        return { on_screen_text: "not-an-array" } as T;
      },
      invokeStrictStructured: vi.fn(),
    };

    await expect(
      regenerateSingleSegment({
        plan: basePlan,
        targetSegmentId,
        userFeedback: "换一个画面",
        llmGateway: gateway,
      }),
    ).rejects.toMatchObject({
      code: "storyboard_segment_schema_invalid",
    });

    try {
      await regenerateSingleSegment({
        plan: basePlan,
        targetSegmentId,
        userFeedback: "换一个画面",
        llmGateway: gateway,
      });
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(LlmOutputError);
      expect((error as LlmOutputError).code).toBe(
        "storyboard_segment_schema_invalid",
      );
    }
  });
});

describe("recalculateSegmentTimings", () => {
  const draft = makeDraft();

  function segment(id: string, excerpt: string, start: number, end: number) {
    return {
      segment_id: id,
      order: 0,
      script_excerpt: excerpt,
      start_hint_sec: start,
      end_hint_sec: end,
      narrative_role: "pressure",
      visual_intent: "x",
      scene_description: "x",
      visual_elements: [],
      framing_hint: "medium",
      content_type: "live_action",
      motion_hint: "static",
      editing_hint: "single",
      on_screen_text: [],
      linked_beats: [],
      linked_quotes: [],
      risk_notes: [],
      api_video_suitability: "remotion_sufficient",
    };
  }

  it("重算后时间窗总和恒等于 draft.estimated_duration_sec（不复信 LLM 膨胀值）", () => {
    // 真实事故场景：LLM 按人类朗读语速把 82s 脚本排成 118s
    const segments = [
      segment("sb_001", "aaaa", 0, 40),
      segment("sb_002", "bbbbbbbb", 40, 90),
      segment("sb_003", "cc", 90, 118),
    ];
    const plan = recalculateSegmentTimings(
      { estimated_total_duration_sec: 118, segments } as never,
      draft.estimated_duration_sec,
    ) as { estimated_total_duration_sec: number; segments: Array<{ start_hint_sec: number; end_hint_sec: number }> };

    expect(plan.estimated_total_duration_sec).toBe(draft.estimated_duration_sec);
    const total = plan.segments.reduce((sum, s) => sum + (s.end_hint_sec - s.start_hint_sec), 0);
    expect(total).toBe(draft.estimated_duration_sec);
    // 比例：8 字段最长、2 字段最短
    const d0 = plan.segments[0]!.end_hint_sec - plan.segments[0]!.start_hint_sec;
    const d1 = plan.segments[1]!.end_hint_sec - plan.segments[1]!.start_hint_sec;
    const d2 = plan.segments[2]!.end_hint_sec - plan.segments[2]!.start_hint_sec;
    expect(d1).toBeGreaterThan(d0);
    expect(d0).toBeGreaterThanOrEqual(d2);
    // 单调衔接
    expect(plan.segments[1]!.start_hint_sec).toBe(plan.segments[0]!.end_hint_sec);
    expect(plan.segments[2]!.start_hint_sec).toBe(plan.segments[1]!.end_hint_sec);
  });

  it("segments 缺失或为空时原样返回（交由 schema 校验报错）", () => {
    const empty = { segments: [] };
    expect(recalculateSegmentTimings(empty as never, 82)).toBe(empty);
    const noSegments = { foo: 1 };
    expect(recalculateSegmentTimings(noSegments as never, 82)).toBe(noSegments);
    expect(recalculateSegmentTimings(null as never, 82)).toBeNull();
  });

  it("高偏斜分布守恒：为剩余段预留最小 1s，末段吸收余数", () => {
    // 审查反例：total=82、字符占比 810/5/5。旧实现每段独立 round + 最少 1s
    // 得 [81,1,1]=83 溢出预算；预留后非末段 clamp 到剩余预算，总和恒为 82。
    const segments = [
      segment("sb_001", "a".repeat(810), 0, 81),
      segment("sb_002", "b".repeat(5), 81, 82),
      segment("sb_003", "c".repeat(5), 82, 83),
    ];
    const plan = recalculateSegmentTimings(
      { estimated_total_duration_sec: 118, segments } as never,
      82,
    ) as { estimated_total_duration_sec: number; segments: Array<{ start_hint_sec: number; end_hint_sec: number }> };

    expect(plan.estimated_total_duration_sec).toBe(82);
    const durations = plan.segments.map((s) => s.end_hint_sec - s.start_hint_sec);
    expect(durations.reduce((sum, d) => sum + d, 0)).toBe(82);
    expect(durations.every((d) => d >= 1)).toBe(true);
    // 单调衔接不变
    expect(plan.segments[1]!.start_hint_sec).toBe(plan.segments[0]!.end_hint_sec);
    expect(plan.segments[2]!.start_hint_sec).toBe(plan.segments[1]!.end_hint_sec);
  });

  it("generateStoryboardPlan 对 LLM 输出的膨胀时间窗执行本地重算", async () => {
    const gateway: LlmGateway = {
      async invokeStructuredPrompt<T>(options: InvokeStructuredPromptOptions): Promise<T> {
        const promptInput = options.input as ReturnType<typeof buildStoryboardPlannerPromptInput>;
        return {
          plan_version: "storyboard_v1",
          source_script_record_id: promptInput.source_script_record_id,
          source_topic_package_id: promptInput.source_topic_package_id,
          // LLM 声明的总量（人类语速常识），约为 draft 的两倍
          estimated_total_duration_sec: promptInput.draft.estimated_duration_sec * 2,
          segments: [
            { segment_id: "sb_001", order: 0, script_excerpt: promptInput.draft.script_text.slice(0, 40), start_hint_sec: 0, end_hint_sec: 60, narrative_role: "pressure", visual_intent: "x", scene_description: "x", visual_elements: ["楚王"], framing_hint: "medium", content_type: "live_action", motion_hint: "static", editing_hint: "single", on_screen_text: [], linked_beats: [], linked_quotes: [], risk_notes: [], api_video_suitability: "remotion_sufficient" },
            { segment_id: "sb_002", order: 1, script_excerpt: promptInput.draft.script_text.slice(40), start_hint_sec: 60, end_hint_sec: 116, narrative_role: "ending", visual_intent: "x", scene_description: "x", visual_elements: ["晏子"], framing_hint: "close", content_type: "live_action", motion_hint: "static", editing_hint: "single", on_screen_text: [], linked_beats: [], linked_quotes: [], risk_notes: [], api_video_suitability: "remotion_sufficient" },
          ],
          global_visual_notes: [],
        } as T;
      },
      invokeStrictStructured: vi.fn(),
    };

    const plan = await generateStoryboardPlan(makeInput(gateway));
    expect(plan.estimated_total_duration_sec).toBe(draft.estimated_duration_sec);
    const total = plan.segments.reduce((sum, s) => sum + (s.end_hint_sec - s.start_hint_sec), 0);
    expect(total).toBe(draft.estimated_duration_sec);
  });
});

describe("边界合同违反一次性重生", () => {
  function narrationFixture() {
    const text = "汉".repeat(18);
    const audioHash = "a".repeat(64);
    const timingMap = normalizeNarrationTiming({
      sourceText: text, audioHash, durationMs: 4500,
      sentences: [{ providerSentenceIndex: 0, originalText: text, normalizedText: text,
        words: Array.from(text, (c, i) => ({ text: c, begin_index: i, end_index: i + 1, begin_time: i * 250, end_time: (i + 1) * 250 })) }],
    });
    const narrationReference = { narration_record_id: "n1", audio_hash: audioHash, timing_map_hash: createHash("sha256").update(canonicalStringify(timingMap)).digest("hex"), duration_ms: 4500 };
    return { timingMap, narrationReference };
  }
  const visual = { narrative_role: "opening", visual_intent: "宫门", scene_description: "宫门", visual_elements: ["门"],
    framing_hint: "wide", content_type: "live_action", motion_hint: "static", editing_hint: "single",
    on_screen_text: [], linked_beats: [], linked_quotes: [], risk_notes: [], api_video_suitability: "remotion_sufficient" };
  function makeNarrationInput(overrides: Partial<GenerateStoryboardPlanInput> = {}) {
    const base = makeInput();
    const { timingMap, narrationReference } = narrationFixture();
    return { ...base, draft: { ...base.draft, script_text: timingMap.sourceText },
      narrationTiming: { timingMap, narrationReference }, ...overrides };
  }
  function segmentsOf(f: { timingMap: { boundaries: Array<{ id: string }> } }, pairs: Array<[number, number]>) {
    return pairs.map(([start, end], i) => ({ ...visual, segment_id: "s" + i, order: i,
      start_boundary_id: f.timingMap.boundaries[start]!.id, end_boundary_id: f.timingMap.boundaries[end]!.id }));
  }
  function rawPlan(f: { timingMap: { boundaries: Array<{ id: string }> } }, pairs: Array<[number, number]>) {
    return { plan_version: "storyboard_v2", source_script_record_id: "scr_001", source_topic_package_id: "topic_001",
      global_visual_notes: [], segments: segmentsOf(f, pairs) };
  }

  it("首稿时间倒流时带具体错误反馈重生一次，二次成功", async () => {
    const input = makeNarrationInput();
    const f = { timingMap: input.narrationTiming.timingMap };
    const calls: Array<{ regeneration_context?: { reason: string; errors: string[] } }> = [];
    let attempt = 0;
    const gateway: LlmGateway = {
      async invokeStructuredPrompt<T>(options: InvokeStructuredPromptOptions): Promise<T> {
        calls.push(options.input as never);
        attempt++;
        if (attempt === 1) return rawPlan(f, [[0, 6], [6, 3], [3, 18]]) as T; // 第二镜 1500→750 倒流
        return rawPlan(f, [[0, 6], [6, 18]]) as T;
      },
      invokeStrictStructured: vi.fn(),
    };
    const plan = await generateStoryboardPlan({ ...input, llmGateway: gateway });
    expect(attempt).toBe(2);
    expect(calls[1]!.regeneration_context?.reason).toBe("storyboard_narration_plan_invalid");
    expect(calls[1]!.regeneration_context!.errors.join("")).toContain("时间倒流");
    expect(plan.segments).toHaveLength(2);
  });

  it("两次均违反则拒绝且恰好调用两次", async () => {
    const input = makeNarrationInput();
    const f = { timingMap: input.narrationTiming.timingMap };
    let attempt = 0;
    const gateway: LlmGateway = {
      async invokeStructuredPrompt<T>(_options: InvokeStructuredPromptOptions): Promise<T> {
        attempt++;
        return rawPlan(f, [[0, 6], [6, 3], [3, 18]]) as T;
      },
      invokeStrictStructured: vi.fn(),
    };
    await expect(generateStoryboardPlan({ ...input, llmGateway: gateway })).rejects.toMatchObject({ code: "storyboard_narration_plan_invalid" });
    expect(attempt).toBe(2);
  });

  it("非边界错误（来源不一致）不重生，仅调用一次", async () => {
    const input = makeNarrationInput();
    const f = { timingMap: input.narrationTiming.timingMap };
    let attempt = 0;
    const gateway: LlmGateway = {
      async invokeStructuredPrompt<T>(_options: InvokeStructuredPromptOptions): Promise<T> {
        attempt++;
        return { ...rawPlan(f, [[0, 6], [6, 18]]), source_script_record_id: "other" } as T;
      },
      invokeStrictStructured: vi.fn(),
    };
    await expect(generateStoryboardPlan({ ...input, llmGateway: gateway })).rejects.toMatchObject({ code: "storyboard_narration_plan_invalid" });
    expect(attempt).toBe(1);
  });

  it("schema 失败（不可解析计划）不重生，仅调用一次", async () => {
    const input = makeNarrationInput();
    let attempt = 0;
    const gateway: LlmGateway = {
      async invokeStructuredPrompt<T>(_options: InvokeStructuredPromptOptions): Promise<T> {
        attempt++;
        return { foo: "bar" } as T;
      },
      invokeStrictStructured: vi.fn(),
    };
    await expect(generateStoryboardPlan({ ...input, llmGateway: gateway })).rejects.toMatchObject({ code: "storyboard_narration_plan_invalid" });
    expect(attempt).toBe(1);
  });

  it("order 错位同样触发带反馈重生", async () => {
    const input = makeNarrationInput();
    const f = { timingMap: input.narrationTiming.timingMap };
    const calls: Array<{ regeneration_context?: { errors: string[] } }> = [];
    let attempt = 0;
    const gateway: LlmGateway = {
      async invokeStructuredPrompt<T>(options: InvokeStructuredPromptOptions): Promise<T> {
        calls.push(options.input as never);
        attempt++;
        if (attempt === 1) {
          const bad = rawPlan(f, [[0, 6], [6, 18]]);
          bad.segments[0]!.order = 1;
          return bad as T;
        }
        return rawPlan(f, [[0, 6], [6, 18]]) as T;
      },
      invokeStrictStructured: vi.fn(),
    };
    const plan = await generateStoryboardPlan({ ...input, llmGateway: gateway });
    expect(attempt).toBe(2);
    expect(calls[1]!.regeneration_context!.errors.join("")).toContain("order");
    expect(plan.segments).toHaveLength(2);
  });

  it("内层重生合并外层本地校验上下文与用户反馈", async () => {
    const input = makeNarrationInput({
      regenerationContext: {
        reason: "storyboard_local_validation_regen_once",
        errors: ["本地校验：segment 过短"],
        metrics: { segment_count: 3 },
        user_feedback: "节奏更紧张一些",
      },
    });
    const f = { timingMap: input.narrationTiming.timingMap };
    const calls: Array<{ regeneration_context?: { reason: string; errors: string[]; user_feedback?: string } }> = [];
    let attempt = 0;
    const gateway: LlmGateway = {
      async invokeStructuredPrompt<T>(options: InvokeStructuredPromptOptions): Promise<T> {
        calls.push(options.input as never);
        attempt++;
        if (attempt === 1) return rawPlan(f, [[0, 6], [6, 3], [3, 18]]) as T;
        return rawPlan(f, [[0, 6], [6, 18]]) as T;
      },
      invokeStrictStructured: vi.fn(),
    };
    await generateStoryboardPlan({ ...input, llmGateway: gateway });
    expect(attempt).toBe(2);
    const ctx = calls[1]!.regeneration_context!;
    expect(ctx.reason).toBe("storyboard_narration_plan_invalid");
    expect(ctx.errors).toContain("本地校验：segment 过短");
    expect(ctx.errors.join("")).toContain("时间倒流");
    expect(ctx.user_feedback).toBe("节奏更紧张一些");
  });
});
