import { describe, expect, it, vi } from "vitest";

import { StoryboardPlan, type ScriptDraftPackage } from "../../../shared/src/index.js";
import type {
  InvokeStructuredPromptOptions,
  LlmGateway,
} from "../../../backend/src/runtime/llm/llm-gateway.js";
import {
  buildStoryboardPlannerPromptInput,
  generateStoryboardPlan,
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
});
