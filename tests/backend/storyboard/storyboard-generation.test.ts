import { describe, expect, it, vi } from "vitest";

import { StoryboardPlan, type ScriptDraftPackage } from "../../../shared/src/index.js";
import type {
  InvokeStructuredPromptOptions,
  LlmGateway,
} from "../../../backend/src/runtime/llm/llm-gateway.js";
import { createLlmGateway } from "../../../backend/src/runtime/llm/llm-gateway.js";
import { createOpenAiCompatibleProvider } from "../../../backend/src/runtime/llm/openai-compatible-provider.js";
import { LlmOutputError } from "../../../backend/src/runtime/llm/llm-output-error.js";
import { createPromptRegistry } from "../../../backend/src/runtime/prompts/prompt-registry.js";
import {
  buildStoryboardPlannerPromptInput,
  generateStoryboardPlan,
  regenerateSingleSegment,
} from "../../../backend/src/modules/storyboard/storyboard-generation.service.js";

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
