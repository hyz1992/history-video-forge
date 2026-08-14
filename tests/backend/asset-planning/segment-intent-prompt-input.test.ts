import { describe, expect, it } from "vitest";

import {
  buildSegmentIntentPlannerInput,
  buildSegmentIntentRepairInput,
  SegmentIntentPromptInputError,
} from "../../../backend/src/modules/asset-planning/segment-intent-prompt-input.js";
import type {
  AssetPlan,
  StoryboardPlan,
} from "../../../shared/src/index.js";
import type { SegmentIntentIssue } from "../../../backend/src/modules/asset-planning/segment-asset-intent.js";

function segment(
  segmentId: string,
  preference: "api_video" | "remotion_motion" | null = null,
): StoryboardPlan["segments"][number] {
  return {
    segment_id: segmentId,
    order: 0,
    script_excerpt: `口播-${segmentId}`,
    start_hint_sec: 0,
    end_hint_sec: 5,
    narrative_role: "opening",
    visual_intent: "建立压力",
    scene_description: "战国宫室",
    visual_elements: ["青铜灯"],
    framing_hint: "medium",
    content_type: "live_action",
    motion_hint: "push_in",
    editing_hint: "single",
    on_screen_text: [],
    linked_beats: ["beat-1"],
    linked_quotes: [],
    risk_notes: ["避免现代物件"],
    api_video_suitability: preference === "api_video" ? "api_video_strongly_recommended" : "remotion_sufficient",
  };
}

const artBible: AssetPlan["art_bible"] = {
  era_style: "战国",
  visual_tone: "低饱和",
  characters: [],
  locations: [],
  props: [],
  global_prompt_prefix: "历史正剧",
  global_negative_prompts: ["现代物件"],
  consistency_notes: ["服饰统一"],
};

const visualBudget: AssetPlan["visual_budget"] = { max_video: 1 };
const downgradePolicy: AssetPlan["downgrade_policy"] = { fallback: "still" };
const globalAudioStrategy: AssetPlan["global_audio_strategy"] = {
  bgm_cue_policy: "首段建立主题",
};

const repairContext = {
  chunk_id: "chunk-1",
  is_first_chunk: false,
  segment_ids: ["seg-1"],
  visual_strategy_preferences: [
    { segment_id: "seg-1", preference: null },
  ],
} as const;

function expectDeepFrozen(value: unknown): void {
  if (!value || typeof value !== "object") return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectDeepFrozen(child);
}

describe("segment intent planner prompt input", () => {
  it("returns only the frozen DTO keys and deep-clones nested source values", () => {
    const segments = [segment("seg-1", "api_video")];
    const result = buildSegmentIntentPlannerInput({
      chunk_id: "chunk-1",
      is_first_chunk: true,
      segments,
      art_bible: artBible,
      visual_budget: visualBudget,
      downgrade_policy: downgradePolicy,
      global_audio_strategy: globalAudioStrategy,
      storyboard: { forbidden: true },
      script: "forbidden",
      tts_plan: { forbidden: true },
      tasks: [],
      dependencies: [],
    });

    expect(Object.keys(result)).toEqual([
      "chunk_id",
      "is_first_chunk",
      "segments",
      "art_bible",
      "visual_budget",
      "downgrade_policy",
      "global_audio_strategy",
    ]);
    expect(result.segments).not.toBe(segments);
    expect(result.segments[0]).not.toBe(segments[0]);
    expect(result).not.toHaveProperty("storyboard");
    expect(result).not.toHaveProperty("script");
    expect(result).not.toHaveProperty("tts_plan");
    expect(result).not.toHaveProperty("tasks");
    expect(result).not.toHaveProperty("dependencies");
    segments[0]!.scene_description = "输入后来被修改";
    expect(result.segments[0]!.scene_description).toBe("战国宫室");
    expectDeepFrozen(result);
  });

  it("rejects chunk sizes outside 1-3 and duplicate segment ids without truncating", () => {
    const base = {
      chunk_id: "chunk-1",
      is_first_chunk: false,
      art_bible: artBible,
      visual_budget: visualBudget,
      downgrade_policy: downgradePolicy,
      global_audio_strategy: globalAudioStrategy,
    };
    expect(() => buildSegmentIntentPlannerInput({ ...base, segments: [] })).toThrow(
      /1-3/,
    );
    expect(() =>
      buildSegmentIntentPlannerInput({
        ...base,
        segments: [segment("1"), segment("2"), segment("3"), segment("4")],
      }),
    ).toThrow(/1-3/);
    expect(() =>
      buildSegmentIntentPlannerInput({
        ...base,
        segments: [segment("same"), segment("same")],
      }),
    ).toThrow(/唯一/);
  });

  it("validates the complete planner DTO as JSON-safe before cloning", () => {
    expect(() =>
      buildSegmentIntentPlannerInput({
        chunk_id: "chunk-1",
        is_first_chunk: false,
        segments: [segment("seg-1")],
        art_bible: artBible,
        visual_budget: { generated_at: new Date() } as never,
        downgrade_policy: downgradePolicy,
        global_audio_strategy: globalAudioStrategy,
      }),
    ).toThrow(SegmentIntentPromptInputError);
  });
});

describe("segment intent repair prompt input", () => {
  it("mechanically derives exact allowed leaf replacements and appends", () => {
    const issues: SegmentIntentIssue[] = [
      {
        code: "missing_required_field",
        path: ["segments", 0, "intents", 0, "image_prompt"],
        segment_id: "seg-1",
        expected_kind: "image_still",
      },
      {
        code: "missing_required_intent_kind",
        path: ["segments", 0, "intents"],
        segment_id: "seg-1",
        expected_kind: "video_clip",
      },
      {
        code: "missing_segment",
        path: ["segments"],
        segment_id: "seg-2",
        expected_kind: null,
      },
      {
        code: "missing_required_field",
        path: ["planning_mode"],
        segment_id: null,
        expected_kind: null,
      },
    ];
    const normalizedDraft = {
      planning_mode: "segment_intent_batch",
      segments: [
        {
          source_segment_id: "seg-1",
          intents: [{ asset_kind: "image_still" }],
        },
      ],
    };
    const result = buildSegmentIntentRepairInput({
      normalized_draft: normalizedDraft,
      issues,
      context: {
        chunk_id: "chunk-1",
        is_first_chunk: true,
        segment_ids: ["seg-1"],
        visual_strategy_preferences: [
          { segment_id: "seg-1", preference: "api_video" },
        ],
      },
      message: "不得被解析为授权",
      storyboard: { forbidden: true },
      final_plan: { forbidden: true },
      legacy_tasks: [],
      dependencies: [],
    });

    expect(Object.keys(result)).toEqual([
      "normalized_draft",
      "issues",
      "allowed_operations",
      "context",
    ]);
    expect(result.allowed_operations).toEqual([
      {
        operation: "replace_field",
        path: ["segments", 0, "intents", 0, "image_prompt"],
      },
      {
        operation: "append_intent",
        segment_id: "seg-1",
        expected_kind: "video_clip",
      },
    ]);
    expect(result).not.toHaveProperty("message");
    expect(result).not.toHaveProperty("storyboard");
    expect(result).not.toHaveProperty("final_plan");
    expect(result).not.toHaveProperty("legacy_tasks");
    expect(result).not.toHaveProperty("dependencies");
    expect(result.normalized_draft).not.toBe(normalizedDraft);
    expect(result.issues).not.toBe(issues);
    normalizedDraft.segments.push({ leaked: true } as never);
    expect(result.normalized_draft).toEqual({
      planning_mode: "segment_intent_batch",
      segments: [
        {
          source_segment_id: "seg-1",
          intents: [{ asset_kind: "image_still" }],
        },
      ],
    });
    expectDeepFrozen(result);
  });

  it("allows only validator-supported replace_field leaves", () => {
    const result = buildSegmentIntentRepairInput({
      normalized_draft: {
        segments: [
          {
            source_segment_id: "seg-1",
            intents: [{ asset_kind: "image_still" }],
          },
        ],
      },
      issues: [
        {
          code: "missing_required_field",
          path: ["segments", 0, "intents", 0, "risk_notes", 0],
          segment_id: "seg-1",
          expected_kind: "image_still",
        },
        {
          code: "missing_required_field",
          path: ["segments", 0, "intents", 0, "asset_kind"],
          segment_id: "seg-1",
          expected_kind: "image_still",
        },
        {
          code: "unknown_segment",
          path: ["segments", 0, "source_segment_id"],
          segment_id: "seg-x",
          expected_kind: null,
        },
      ],
      context: {
        chunk_id: "chunk-1",
        is_first_chunk: false,
        segment_ids: ["seg-1"],
        visual_strategy_preferences: [
          { segment_id: "seg-1", preference: null },
        ],
      },
    });

    expect(result.allowed_operations).toEqual([
      {
        operation: "replace_field",
        path: ["segments", 0, "intents", 0, "risk_notes", 0],
      },
    ]);
  });

  it("rejects non-JSON-safe repair DTO values with a stable secret-free error", () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    const sparse = new Array(2);
    sparse[1] = "present";
    const accessor = Object.defineProperty({}, "secret", {
      enumerable: true,
      get: () => {
        throw new Error("getter must not run: TOP_SECRET");
      },
    });
    const symbolKeyed = { safe: true } as Record<PropertyKey, unknown>;
    symbolKeyed[Symbol("secret")] = "TOP_SECRET";
    const customPrototype = Object.create({ inherited: true }) as Record<
      string,
      unknown
    >;
    customPrototype.safe = true;

    const invalidValues: unknown[] = [
      cycle,
      new Date(),
      new Map(),
      new Set(),
      /pattern/u,
      customPrototype,
      { missing: undefined },
      { bigint: 1n },
      { symbol: Symbol("secret") },
      { fn: () => "TOP_SECRET" },
      { nan: Number.NaN },
      { positive_infinity: Number.POSITIVE_INFINITY },
      { negative_infinity: Number.NEGATIVE_INFINITY },
      sparse,
      symbolKeyed,
      accessor,
    ];

    for (const normalized_draft of invalidValues) {
      try {
        buildSegmentIntentRepairInput({
          normalized_draft,
          issues: [],
          context: repairContext as never,
        });
        throw new Error("expected JSON-safe validation to reject input");
      } catch (error) {
        expect(error).toBeInstanceOf(SegmentIntentPromptInputError);
        expect(error).toMatchObject({
          code: "segment_intent_prompt_input_not_json_safe",
          message: "segment_intent_prompt_input_not_json_safe",
        });
        expect(String(error)).not.toContain("TOP_SECRET");
      }
    }
  });

  it("keeps legal nested plain JSON values frozen and roundtrip-equivalent", () => {
    const shared = { enabled: true, count: 3.5, labels: ["甲", "乙"] };
    const normalizedDraft = {
      planning_mode: "segment_intent_batch",
      segments: [
        {
          source_segment_id: "seg-1",
          intents: [],
          optional: null,
          nested: shared,
          repeated: shared,
        },
      ],
    };
    const result = buildSegmentIntentRepairInput({
      normalized_draft: normalizedDraft,
      issues: [],
      context: repairContext as never,
    });

    expectDeepFrozen(result);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    const clonedEntry = (
      result.normalized_draft as typeof normalizedDraft
    ).segments[0]!;
    expect(clonedEntry.nested).toBe(clonedEntry.repeated);
    expect(clonedEntry.nested).not.toBe(shared);
  });

  it("does not authorize malformed numeric paths, kinds, or segment ids", () => {
    const malformedIssues = [
      {
        code: "missing_required_field",
        path: ["segments", -1, "intents", 0, "image_prompt"],
        segment_id: "seg-1",
        expected_kind: "image_still",
      },
      {
        code: "missing_required_field",
        path: ["segments", 0.5, "intents", 0, "image_prompt"],
        segment_id: "seg-1",
        expected_kind: "image_still",
      },
      {
        code: "missing_required_field",
        path: [
          "segments",
          Number.MAX_SAFE_INTEGER + 1,
          "intents",
          0,
          "image_prompt",
        ],
        segment_id: "seg-1",
        expected_kind: "image_still",
      },
      {
        code: "missing_required_intent_kind",
        path: ["segments", 0, "intents"],
        segment_id: "seg-1",
        expected_kind: "not_a_kind",
      },
      {
        code: "missing_required_intent_kind",
        path: ["segments", 0, "intents"],
        segment_id: "",
        expected_kind: "video_clip",
      },
      {
        code: "missing_required_intent_kind",
        path: ["unrelated"],
        segment_id: "seg-1",
        expected_kind: "video_clip",
      },
    ] as unknown as SegmentIntentIssue[];
    const result = buildSegmentIntentRepairInput({
      normalized_draft: {},
      issues: malformedIssues,
      context: repairContext as never,
    });

    expect(result.allowed_operations).toEqual([]);
  });

  it("rejects NaN inside an issue path before deriving permissions", () => {
    const issues = [
      {
        code: "missing_required_field",
        path: ["segments", Number.NaN, "intents", 0, "image_prompt"],
        segment_id: "seg-1",
        expected_kind: "image_still",
      },
    ] as SegmentIntentIssue[];

    expect(() =>
      buildSegmentIntentRepairInput({
        normalized_draft: {},
        issues,
        context: repairContext as never,
      }),
    ).toThrow(SegmentIntentPromptInputError);
  });

  it("rejects a Proxy normalized draft without invoking any Proxy trap", () => {
    const traps = {
      getPrototypeOf: 0,
      getOwnPropertyDescriptor: 0,
      ownKeys: 0,
    };
    const normalizedDraft = new Proxy(
      {},
      {
        getPrototypeOf() {
          traps.getPrototypeOf += 1;
          throw new Error("TOP_SECRET getPrototypeOf");
        },
        getOwnPropertyDescriptor() {
          traps.getOwnPropertyDescriptor += 1;
          throw new Error("TOP_SECRET getOwnPropertyDescriptor");
        },
        ownKeys() {
          traps.ownKeys += 1;
          throw new Error("TOP_SECRET ownKeys");
        },
      },
    );

    try {
      buildSegmentIntentRepairInput({
        normalized_draft: normalizedDraft,
        issues: [],
        context: repairContext as never,
      });
      throw new Error("expected Proxy rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(SegmentIntentPromptInputError);
      expect(error).toMatchObject({
        code: "segment_intent_prompt_input_not_json_safe",
        message: "segment_intent_prompt_input_not_json_safe",
      });
      expect(JSON.stringify(error)).not.toContain("TOP_SECRET");
    }
    expect(traps).toEqual({
      getPrototypeOf: 0,
      getOwnPropertyDescriptor: 0,
      ownKeys: 0,
    });
  });

  it("rejects an accessor on the builder source without invoking its getter", () => {
    let getterCalls = 0;
    const source = {
      issues: [],
      context: repairContext,
    } as Record<string, unknown>;
    Object.defineProperty(source, "normalized_draft", {
      enumerable: true,
      get() {
        getterCalls += 1;
        throw new Error("TOP_SECRET source getter");
      },
    });

    expect(() =>
      buildSegmentIntentRepairInput(source as never),
    ).toThrow(SegmentIntentPromptInputError);
    expect(getterCalls).toBe(0);
  });

  it("binds allowed operations to context, segment entry, and actual intent kind", () => {
    const result = buildSegmentIntentRepairInput({
      normalized_draft: {
        segments: [
          {
            source_segment_id: "seg-1",
            intents: [{ asset_kind: "image_still" }],
          },
          {
            source_segment_id: "seg-2",
            intents: [{ asset_kind: "video_clip" }],
          },
        ],
      },
      issues: [
        {
          code: "missing_required_field",
          path: ["segments", 0, "intents", 0, "image_prompt"],
          segment_id: "outside",
          expected_kind: "image_still",
        },
        {
          code: "missing_required_intent_kind",
          path: ["segments", 0, "intents"],
          segment_id: "outside",
          expected_kind: "video_clip",
        },
        {
          code: "missing_required_intent_kind",
          path: ["segments", 0, "intents"],
          segment_id: "seg-2",
          expected_kind: "image_still",
        },
        {
          code: "missing_required_field",
          path: ["segments", 1, "intents", 0, "video_prompt"],
          segment_id: "seg-1",
          expected_kind: "video_clip",
        },
        {
          code: "missing_required_field",
          path: ["segments", 0, "intents", 0, "video_prompt"],
          segment_id: "seg-1",
          expected_kind: "video_clip",
        },
        {
          code: "missing_required_field",
          path: ["segments", 0, "intents", 0, "image_prompt"],
          segment_id: "seg-1",
          expected_kind: "image_still",
        },
      ],
      context: {
        chunk_id: "chunk-1",
        is_first_chunk: false,
        segment_ids: ["seg-1", "seg-2"],
        visual_strategy_preferences: [
          { segment_id: "seg-1", preference: null },
          { segment_id: "seg-2", preference: "api_video" },
        ],
      },
    });

    expect(result.allowed_operations).toEqual([
      {
        operation: "replace_field",
        path: ["segments", 0, "intents", 0, "image_prompt"],
      },
    ]);
  });
});
