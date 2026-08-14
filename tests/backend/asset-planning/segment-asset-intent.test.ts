import { describe, expect, it } from "vitest";

import type { StoryboardPlan } from "../../../shared/src/index.js";
import {
  applySegmentIntentRepair,
  inspectSegmentIntentBatch,
  SegmentIntentRepairError,
} from "../../../backend/src/modules/asset-planning/segment-asset-intent.js";

const segments: StoryboardPlan["segments"] = [
  {
    segment_id: "seg_001", order: 0, script_excerpt: "城门关闭。", start_hint_sec: 0,
    end_hint_sec: 6, narrative_role: "opening", visual_intent: "城门压迫感",
    scene_description: "守军关闭城门", visual_elements: ["城门"], framing_hint: "wide",
    content_type: "live_action", motion_hint: "push_in", editing_hint: "single",
    on_screen_text: [], linked_beats: ["beat_1"], linked_quotes: [], risk_notes: ["时代准确"],
    api_video_suitability: "api_video_strongly_recommended",
  },
  {
    segment_id: "seg_002", order: 1, script_excerpt: "密信藏入烛台。", start_hint_sec: 6,
    end_hint_sec: 12, narrative_role: "pressure", visual_intent: "密信特写",
    scene_description: "密信与烛火", visual_elements: ["密信"], framing_hint: "detail",
    content_type: "illustration", motion_hint: "pan", editing_hint: "single",
    on_screen_text: [], linked_beats: ["beat_2"], linked_quotes: [], risk_notes: ["文字模糊"],
    api_video_suitability: "remotion_sufficient",
  },
  {
    segment_id: "seg_003", order: 2, script_excerpt: "决定无法撤回。", start_hint_sec: 12,
    end_hint_sec: 18, narrative_role: "ending", visual_intent: "天光背影",
    scene_description: "人物走出宫门", visual_elements: ["背影"], framing_hint: "medium",
    content_type: "illustration", motion_hint: "static", editing_hint: "single",
    on_screen_text: [], linked_beats: ["beat_3"], linked_quotes: [], risk_notes: ["服饰准确"],
    api_video_suitability: "remotion_sufficient",
  },
];

const segmentRoutes = new Map([
  ["seg_001", "api_video" as const],
  ["seg_002", "remotion" as const],
  ["seg_003", "remotion" as const],
]);
const context = { segments, isFirstChunk: true, segment_routes: segmentRoutes };

function image(image_role: "anchor" | "support" = "anchor") {
  return {
    asset_kind: "image_still",
    production_intent: "建立历史场景与人物关系",
    image_prompt: "历史写实画面，烛光与城门细节",
    video_prompt_reserve: "镜头缓慢靠近，人物动作克制",
    image_role,
    support_reason: image_role === "support" ? "补充关键道具细节" : null,
    risk_notes: ["避免现代物件"],
  };
}

function video() {
  return {
    asset_kind: "video_clip",
    production_intent: "表现不可逆的关门动作",
    video_prompt: "守军合力关闭巨大木门，尘土落下",
    why_static_insufficient: "必须呈现门扇闭合与守军发力的连续动作",
    risk_notes: ["动作不要夸张"],
  };
}

function motion() {
  return {
    asset_kind: "render_motion_cue",
    production_intent: "对静态画面做缓慢推近以制造压力",
    risk_notes: ["避免快速运镜"],
  };
}

function sfx() {
  return {
    asset_kind: "sfx_cue",
    production_intent: "强调城门关闭的重量",
    required_tags: ["wood", "impact"],
    mood_tags: ["tense"],
    selection_label: "沉重木门闭合",
    timing_basis: "tts",
    risk_notes: [],
  };
}

function bgm(scope: "global" | "segment" | "segment_span" = "global") {
  return {
    asset_kind: "bgm_cue",
    production_intent: "用低沉弦乐维持叙事压力",
    required_tags: ["strings"],
    mood_tags: ["tense"],
    selection_label: null,
    timing_basis: "tts",
    scope,
    segment_ids:
      scope === "global" ? [] : scope === "segment" ? ["seg_002"] : ["seg_002", "seg_003"],
    volume: 0.24,
    fade_in_sec: 0.5,
    fade_out_sec: 1,
    risk_notes: [],
  };
}

function validDraft() {
  return {
    planning_mode: "segment_intent_batch",
    segments: [
      { source_segment_id: "seg_001", intents: [image(), video(), motion(), sfx(), bgm()] },
      { source_segment_id: "seg_002", intents: [image(), motion()] },
      { source_segment_id: "seg_003", intents: [image(), motion()] },
    ],
    budget_notes: ["优先保证核心动作"],
  };
}

function inspect(raw: unknown, customContext = context) {
  return inspectSegmentIntentBatch({ raw, context: customContext });
}

function codes(raw: unknown, customContext = context) {
  return inspect(raw, customContext).issues.map((issue) => issue.code);
}

describe("semantic intent schema and context", () => {
  it("accepts the frozen batch and every discriminated intent kind without mutation", () => {
    const raw = validDraft();
    const snapshot = structuredClone(raw);
    const result = inspect(raw);
    expect(result).toMatchObject({ issues: [], parsedDraft: snapshot });
    expect(result.normalizedDraft).not.toBe(raw);
    expect(raw).toEqual(snapshot);
  });

  it("requires budget_notes and strips unknown wire fields before strict parsing", () => {
    const missingBudget = validDraft();
    delete (missingBudget as { budget_notes?: unknown }).budget_notes;
    expect(inspect(missingBudget).parsedDraft).toBeUndefined();

    const noisy = validDraft() as ReturnType<typeof validDraft> & Record<string, unknown>;
    noisy.unexpected_batch = "drop-me";
    (noisy.segments[0] as unknown as Record<string, unknown>).unexpected_segment = true;
    (noisy.segments[0]!.intents[0] as Record<string, unknown>).prompt_draft = "drop-me";
    (noisy.segments[0]!.intents[2] as Record<string, unknown>).sfx_prompt = "drop-me";
    (noisy.segments[0]!.intents[3] as Record<string, unknown>).music_description = "drop-me";
    (noisy.segments[1]!.intents[1] as Record<string, unknown>).motion_prompt = "drop-me";
    const original = structuredClone(noisy);

    const result = inspect(noisy);
    expect(result.issues).toEqual([]);
    expect(result.parsedDraft).toBeDefined();
    expect(JSON.stringify(result.normalizedDraft)).not.toContain("drop-me");
    expect(noisy).toEqual(original);
  });

  it("rejects every legacy wire alias instead of coercing it", () => {
    const legacyKind = validDraft();
    const firstIntent = legacyKind.segments[0]!.intents[0] as Record<string, unknown>;
    firstIntent.kind = firstIntent.asset_kind;
    delete firstIntent.asset_kind;
    expect(inspect(legacyKind).parsedDraft).toBeUndefined();

    const legacyBatch = validDraft();
    const batchRecord = legacyBatch as unknown as Record<string, unknown>;
    batchRecord.batch_type = "segment_asset_intent_batch";
    delete batchRecord.planning_mode;
    expect(inspect(legacyBatch).parsedDraft).toBeUndefined();

    const legacyEntry = validDraft();
    const entryRecord = legacyEntry.segments[0] as unknown as Record<string, unknown>;
    entryRecord.segment_id = entryRecord.source_segment_id;
    delete entryRecord.source_segment_id;
    expect(inspect(legacyEntry).parsedDraft).toBeUndefined();
  });

  it.each([
    ["image production_intent", 0, 0, "production_intent"],
    ["image image_prompt", 0, 0, "image_prompt"],
    ["image video_prompt_reserve", 0, 0, "video_prompt_reserve"],
    ["video production_intent", 0, 1, "production_intent"],
    ["video video_prompt", 0, 1, "video_prompt"],
    ["video why_static_insufficient", 0, 1, "why_static_insufficient"],
    ["motion production_intent", 1, 1, "production_intent"],
  ])("rejects an empty required visual field: %s", (_label, segmentIndex, intentIndex, field) => {
    const raw = validDraft();
    (raw.segments[segmentIndex]!.intents[intentIndex] as Record<string, unknown>)[field] = "";
    expect(inspect(raw).parsedDraft).toBeUndefined();
  });

  it("enforces support_reason from image_role", () => {
    const supportMissing = validDraft();
    supportMissing.segments[2]!.intents.push({ ...image("support"), support_reason: "" });
    expect(inspect(supportMissing).parsedDraft).toBeUndefined();

    const anchorReason = validDraft();
    (anchorReason.segments[2]!.intents[0] as ReturnType<typeof image>).support_reason = "不应存在";
    expect(inspect(anchorReason).parsedDraft).toBeUndefined();

    const supported = validDraft();
    supported.segments[2]!.intents.push(image("support"));
    expect(inspect(supported).issues).toEqual([]);
  });

  it("uses required_tags/mood_tags/selection_label/timing_basis for audio", () => {
    const raw = validDraft();
    const audio = raw.segments[0]!.intents[3] as Record<string, unknown>;
    audio.required_tags = [];
    expect(inspect(raw).parsedDraft).toBeUndefined();

    const wrongTiming = validDraft();
    (wrongTiming.segments[0]!.intents[3] as Record<string, unknown>).timing_basis = "segment_start";
    expect(inspect(wrongTiming).parsedDraft).toBeUndefined();
  });

  it("allows an empty intents array at schema level and reports visual context issues", () => {
    const raw = validDraft();
    raw.segments[2]!.intents = [];
    const result = inspect(raw);
    expect(result.parsedDraft).toBeDefined();
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "missing_required_intent_kind", segment_id: "seg_003", expected_kind: "image_still" }),
      expect.objectContaining({ code: "missing_required_intent_kind", segment_id: "seg_003", expected_kind: "render_motion_cue" }),
    ]));
  });

  it("normalizes segment entries but preserves semantic BGM span order for validation", () => {
    const raw = validDraft();
    raw.segments = [raw.segments[2]!, raw.segments[0]!, raw.segments[1]!];
    const local = bgm("segment_span");
    local.segment_ids = ["seg_003", "seg_002"];
    raw.segments.find((entry) => entry.source_segment_id === "seg_002")!.intents.push(local);
    const result = inspect(raw);
    expect(result.normalizedDraft).toMatchObject({
      segments: [
        { source_segment_id: "seg_001" },
        { source_segment_id: "seg_002", intents: expect.arrayContaining([expect.objectContaining({ segment_ids: ["seg_003", "seg_002"] })]) },
        { source_segment_id: "seg_003" },
      ],
    });
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "bgm_segment_ids_not_ordered" }),
    ]));
  });

  it.each([
    ["unknown", ["seg_001", "seg_002", "outside"], "unknown_segment", ["segments", 2, "source_segment_id"]],
    ["duplicate", ["seg_001", "seg_001", "seg_003"], "duplicate_segment", ["segments", 1, "source_segment_id"]],
    ["missing", ["seg_001", "seg_002"], "missing_segment", ["segments"]],
  ])("returns parsedDraft with %s context issue", (_label, ids, code, path) => {
    const raw = validDraft();
    raw.segments = ids.map((source_segment_id, index) => ({
      source_segment_id,
      intents: index === 0 ? [image(), video(), bgm()] : [image(), motion()],
    }));
    const result = inspect(raw);
    expect(result.parsedDraft).toBeDefined();
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code, path }),
    ]));
  });
});

describe("visual strategy invariants", () => {
  it("requires exactly one anchor image even when video exists", () => {
    const raw = validDraft();
    raw.segments[0]!.intents = [video(), bgm()];
    expect(codes(raw)).toContain("missing_required_intent_kind");

    const two = validDraft();
    two.segments[0]!.intents.unshift(image());
    expect(codes(two)).toContain("visual_anchor_count_invalid");
  });

  it("requires video and motion to share their segment with the unique anchor image", () => {
    const videoOnly = validDraft();
    videoOnly.segments[2]!.intents = [video()];
    expect(codes(videoOnly)).toContain("visual_anchor_count_invalid");

    const motionOnly = validDraft();
    motionOnly.segments[2]!.intents = [motion()];
    expect(codes(motionOnly)).toContain("visual_anchor_count_invalid");
  });

  it("api_video requires anchor image plus video and render_motion_cue", () => {
    const noVideo = validDraft();
    noVideo.segments[0]!.intents = [image(), bgm()];
    expect(codes(noVideo)).toContain("missing_required_intent_kind");

    const noMotion = validDraft();
    noMotion.segments[0]!.intents = noMotion.segments[0]!.intents.filter(
      (intent) => intent.asset_kind !== "render_motion_cue",
    );
    expect(codes(noMotion)).toContain("missing_required_intent_kind");

    expect(inspect(validDraft()).issues).toEqual([]);
  });

  it("remotion_motion requires image+motion and forbids every video", () => {
    const noMotion = validDraft();
    noMotion.segments[1]!.intents = [image()];
    expect(codes(noMotion)).toContain("missing_required_intent_kind");

    const withVideo = validDraft();
    withVideo.segments[1]!.intents.push(video());
    expect(codes(withVideo)).toContain("visual_strategy_mismatch");
  });

  it("default (remotion_sufficient) requires image+motion and forbids video", () => {
    const imageOnly = validDraft();
    imageOnly.segments[2]!.intents = [image()];
    expect(codes(imageOnly)).toContain("missing_required_intent_kind");

    // S2-2A 任务 4：null 默认映射为 remotion_sufficient → remotion 语义，多余 video 触发 mismatch
    const withVideo = validDraft();
    withVideo.segments[2]!.intents.push(video());
    expect(codes(withVideo)).toContain("visual_strategy_mismatch");
  });
});

describe("BGM ownership and scope", () => {
  it("requires one global BGM on the first chunk first segment", () => {
    const missing = validDraft();
    missing.segments[0]!.intents = missing.segments[0]!.intents.filter((intent) => intent.asset_kind !== "bgm_cue");
    expect(inspect(missing).issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "missing_required_intent_kind", segment_id: "seg_001", expected_kind: "bgm_cue" }),
    ]));

    const wrongOwner = validDraft();
    const global = wrongOwner.segments[0]!.intents.pop()!;
    wrongOwner.segments[1]!.intents.push(global);
    expect(codes(wrongOwner)).toEqual(expect.arrayContaining(["global_bgm_owner_invalid"]));

    const duplicate = validDraft();
    duplicate.segments[0]!.intents.push(bgm());
    expect(codes(duplicate)).toContain("global_bgm_owner_invalid");
    expect(codes(duplicate)).not.toContain("missing_required_intent_kind");
  });

  it("forbids global BGM in later chunks but permits local scopes", () => {
    expect(codes(validDraft(), { segments, isFirstChunk: false, segment_routes: segmentRoutes })).toContain("global_bgm_owner_invalid");
    const later = validDraft();
    later.segments[0]!.intents = later.segments[0]!.intents.filter((intent) => intent.asset_kind !== "bgm_cue");
    later.segments[1]!.intents.push(bgm("segment"));
    expect(inspect(later, { segments, isFirstChunk: false, segment_routes: segmentRoutes }).issues).toEqual([]);
  });

  it("does not mistake a local BGM for the required global owner", () => {
    const raw = validDraft();
    raw.segments[0]!.intents = raw.segments[0]!.intents.filter((intent) => intent.asset_kind !== "bgm_cue");
    raw.segments[0]!.intents.push({ ...bgm("segment"), segment_ids: ["seg_001"] });
    expect(inspect(raw).issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "missing_required_intent_kind", expected_kind: "bgm_cue" }),
    ]));
  });

  it.each([
    ["empty", [], "bgm_segment_ids_empty"],
    ["duplicate", ["seg_002", "seg_002"], "bgm_segment_ids_duplicate"],
    ["outside", ["seg_002", "outside"], "bgm_segment_ids_outside_chunk"],
    ["unordered", ["seg_003", "seg_002"], "bgm_segment_ids_not_ordered"],
  ])("validates local BGM segment ids: %s", (_label, segment_ids, code) => {
    const raw = validDraft();
    raw.segments[1]!.intents.push({ ...bgm("segment_span"), segment_ids });
    expect(codes(raw)).toContain(code);
  });

  it("requires global segment_ids to be empty", () => {
    const raw = validDraft();
    (raw.segments[0]!.intents.at(-1) as ReturnType<typeof bgm>).segment_ids = ["seg_001"];
    expect(codes(raw)).toContain("global_bgm_segment_ids_invalid");
  });
});

describe("typed atomic repair", () => {
  it("rejects legacy append.intent and accepts only append.value", () => {
    const raw = validDraft();
    raw.segments[1]!.intents = [image()];
    const inspection = inspect(raw);
    expect(() => applySegmentIntentRepair({
      draft: inspection.normalizedDraft,
      initialIssues: inspection.issues,
      context,
      patch: {
        patch_type: "segment_asset_intent_repair",
        operations: [{
          operation: "append_intent",
          segment_id: "seg_002",
          expected_kind: "render_motion_cue",
          intent: motion(),
        }],
      } as never,
    })).toThrowError(expect.objectContaining({
      issues: [expect.objectContaining({ code: "repair_patch_schema_invalid" })],
    }));

    const invalidLeaf = validDraft();
    delete (invalidLeaf.segments[0]!.intents[0] as { image_prompt?: unknown }).image_prompt;
    const leafInspection = inspect(invalidLeaf);
    expect(() => applySegmentIntentRepair({
      draft: leafInspection.normalizedDraft,
      initialIssues: leafInspection.issues,
      context,
      patch: {
        patch_type: "segment_asset_intent_repair",
        operations: [{
          operation: "replace_field",
          path: ["segments", 0, "intents", 0, "image_prompt"],
          value: "合法值",
          expected_kind: "image_still",
        }],
      } as never,
    })).toThrowError(expect.objectContaining({
      issues: [expect.objectContaining({ code: "repair_patch_schema_invalid" })],
    }));
  });

  it("repairs a real schema leaf issue and preserves the caller", () => {
    const raw = validDraft();
    delete (raw.segments[0]!.intents[0] as { image_prompt?: unknown }).image_prompt;
    const inspection = inspect(raw);
    const snapshot = structuredClone(inspection.normalizedDraft);
    const repaired = applySegmentIntentRepair({
      draft: inspection.normalizedDraft,
      initialIssues: inspection.issues,
      context,
      patch: {
        patch_type: "segment_asset_intent_repair",
        operations: [{
          operation: "replace_field",
          path: ["segments", 0, "intents", 0, "image_prompt"],
          value: "修复后的历史写实城门画面",
        }],
      },
    });
    expect(repaired.segments[0]!.intents[0]).toMatchObject({ image_prompt: "修复后的历史写实城门画面" });
    expect(inspection.normalizedDraft).toEqual(snapshot);
  });

  it("repairs an explicitly issued safe array element", () => {
    const raw = validDraft();
    (raw.segments[0]!.intents[1] as ReturnType<typeof video>).risk_notes = [""];
    const inspection = inspect(raw);
    const issue = inspection.issues[0]!;
    const repaired = applySegmentIntentRepair({
      draft: inspection.normalizedDraft,
      initialIssues: inspection.issues,
      context,
      patch: {
        patch_type: "segment_asset_intent_repair",
        operations: [{ operation: "replace_field", path: issue.path, value: "动作克制" }],
      },
    });
    expect(repaired.segments[0]!.intents[1].risk_notes).toEqual(["动作克制"]);
  });

  it("rejects a forged issue set against an already valid draft", () => {
    const raw = validDraft();
    expect(() => applySegmentIntentRepair({
      draft: raw,
      initialIssues: [{
        code: "invalid_type", path: ["segments", 0, "intents", 0, "image_prompt"],
        segment_id: "seg_001", expected_kind: "image_still",
      }],
      context,
      patch: {
        patch_type: "segment_asset_intent_repair",
        operations: [{
          operation: "replace_field", path: ["segments", 0, "intents", 0, "image_prompt"],
          value: "伪造覆盖",
        }],
      },
    })).toThrowError(expect.objectContaining({
      issues: [expect.objectContaining({ code: "repair_initial_issues_mismatch" })],
    }));
  });

  it("rejects stale issues when the same path now belongs to another segment", () => {
    const raw = validDraft();
    delete (raw.segments[0]!.intents[0] as { image_prompt?: unknown }).image_prompt;
    const inspection = inspect(raw);
    const changed = structuredClone(inspection.normalizedDraft) as ReturnType<typeof validDraft>;
    changed.segments[0]!.source_segment_id = "seg_003";
    expect(() => applySegmentIntentRepair({
      draft: changed, initialIssues: inspection.issues, context,
      patch: { patch_type: "segment_asset_intent_repair", operations: [{
        operation: "replace_field", path: ["segments", 0, "intents", 0, "image_prompt"],
        value: "不得应用",
      }] },
    })).toThrowError(expect.objectContaining({
      issues: [expect.objectContaining({ code: "repair_initial_issues_mismatch" })],
    }));
  });

  it("appends the missing global BGM even when a local BGM already exists", () => {
    const raw = validDraft();
    raw.segments[0]!.intents = raw.segments[0]!.intents.filter((intent) => intent.asset_kind !== "bgm_cue");
    raw.segments[0]!.intents.push({ ...bgm("segment"), segment_ids: ["seg_001"] });
    const inspection = inspect(raw);
    const repaired = applySegmentIntentRepair({
      draft: inspection.normalizedDraft, initialIssues: inspection.issues, context,
      patch: { patch_type: "segment_asset_intent_repair", operations: [{
        operation: "append_intent", segment_id: "seg_001", expected_kind: "bgm_cue", value: bgm(),
      }] },
    });
    expect(repaired.segments[0]!.intents.filter((intent) => intent.asset_kind === "bgm_cue")).toHaveLength(2);
  });

  it("repairs global BGM segment_ids through its exact context leaf issue", () => {
    const raw = validDraft();
    (raw.segments[0]!.intents.at(-1) as ReturnType<typeof bgm>).segment_ids = ["seg_001"];
    const inspection = inspect(raw);
    expect(inspection.issues).toEqual([
      expect.objectContaining({
        code: "global_bgm_segment_ids_invalid",
        path: ["segments", 0, "intents", 4, "segment_ids"],
        segment_id: "seg_001",
        expected_kind: "bgm_cue",
      }),
    ]);
    const repaired = applySegmentIntentRepair({
      draft: inspection.normalizedDraft, initialIssues: inspection.issues, context,
      patch: { patch_type: "segment_asset_intent_repair", operations: [{
        operation: "replace_field", path: inspection.issues[0]!.path, value: [],
      }] },
    });
    expect(inspect(repaired).issues).toEqual([]);
  });

  it.each([
    ["unordered", ["seg_003", "seg_002"]],
    ["duplicate", ["seg_002", "seg_002"]],
    ["outside", ["seg_002", "outside"]],
  ])("repairs %s local BGM ids with one exact field replacement", (_label, invalidIds) => {
    const raw = validDraft();
    raw.segments[1]!.intents.push({ ...bgm("segment_span"), segment_ids: invalidIds });
    const inspection = inspect(raw);
    expect(inspection.issues.length).toBeGreaterThan(0);
    expect(inspection.issues.every((item) =>
      JSON.stringify(item.path) === JSON.stringify(["segments", 1, "intents", 2, "segment_ids"]),
    )).toBe(true);
    const repaired = applySegmentIntentRepair({
      draft: inspection.normalizedDraft, initialIssues: inspection.issues, context,
      patch: { patch_type: "segment_asset_intent_repair", operations: [{
        operation: "replace_field",
        path: ["segments", 1, "intents", 2, "segment_ids"],
        value: ["seg_002", "seg_003"],
      }] },
    });
    expect(inspect(repaired).issues).toEqual([]);
  });

  it("allows local BGM replace plus global BGM append in either operation order", () => {
    const raw = validDraft();
    raw.segments[0]!.intents = raw.segments[0]!.intents.filter((item) => item.asset_kind !== "bgm_cue");
    raw.segments[0]!.intents.push({ ...bgm("segment"), segment_ids: ["outside"] });
    const inspection = inspect(raw);
    const replace = {
      operation: "replace_field" as const,
      path: ["segments", 0, "intents", 4, "segment_ids"],
      value: ["seg_001"],
    };
    const append = {
      operation: "append_intent" as const,
      segment_id: "seg_001",
      expected_kind: "bgm_cue" as const,
      value: bgm(),
    };
    const run = (operations: [typeof replace, typeof append] | [typeof append, typeof replace]) =>
      applySegmentIntentRepair({
        draft: inspection.normalizedDraft, initialIssues: inspection.issues, context,
        patch: { patch_type: "segment_asset_intent_repair", operations },
      });
    expect(run([replace, append])).toEqual(run([append, replace]));
  });

  it.each([
    ["duplicate replace", [
      { operation: "replace_field", path: ["segments", 0, "intents", 0, "image_prompt"], value: "a" },
      { operation: "replace_field", path: ["segments", 0, "intents", 0, "image_prompt"], value: "b" },
    ]],
    ["parent-child replace", [
      { operation: "replace_field", path: ["segments", 0, "intents", 1, "risk_notes"], value: ["a"] },
      { operation: "replace_field", path: ["segments", 0, "intents", 1, "risk_notes", 0], value: "b" },
    ]],
  ])("preflights and rejects %s", (_label, operations) => {
    const raw = validDraft();
    delete (raw.segments[0]!.intents[0] as { image_prompt?: unknown }).image_prompt;
    (raw.segments[0]!.intents[1] as ReturnType<typeof video>).risk_notes = [""];
    const inspection = inspect(raw);
    expect(() => applySegmentIntentRepair({
      draft: inspection.normalizedDraft, initialIssues: inspection.issues, context,
      patch: { patch_type: "segment_asset_intent_repair", operations } as never,
    })).toThrowError(expect.objectContaining({
      issues: [expect.objectContaining({ code: "repair_operations_conflict" })],
    }));
  });

  it("preflights duplicate append operations before applying either", () => {
    const raw = validDraft();
    raw.segments[1]!.intents = [image()];
    const inspection = inspect(raw);
    const operation = {
      operation: "append_intent" as const, segment_id: "seg_002",
      expected_kind: "render_motion_cue" as const, value: motion(),
    };
    expect(() => applySegmentIntentRepair({
      draft: inspection.normalizedDraft, initialIssues: inspection.issues, context,
      patch: { patch_type: "segment_asset_intent_repair", operations: [operation, operation] },
    })).toThrowError(expect.objectContaining({
      issues: [expect.objectContaining({ code: "repair_operations_conflict" })],
    }));
  });

  it("rejects replace+append order dependence and leaves the source unchanged", () => {
    const raw = validDraft();
    raw.segments[1]!.intents = [image()];
    const inspection = inspect(raw);
    const snapshot = structuredClone(inspection.normalizedDraft);
    expect(() => applySegmentIntentRepair({
      draft: inspection.normalizedDraft, initialIssues: inspection.issues, context,
      patch: { patch_type: "segment_asset_intent_repair", operations: [
        { operation: "append_intent", segment_id: "seg_002", expected_kind: "render_motion_cue", value: motion() },
        { operation: "replace_field", path: ["segments", 1, "intents", 1, "production_intent"], value: "顺序依赖" },
      ] },
    })).toThrow(SegmentIntentRepairError);
    expect(inspection.normalizedDraft).toEqual(snapshot);
  });

  it("rejects wrappers, parent replacement, and partial final context validity", () => {
    const validInspection = inspect(validDraft());
    expect(() => applySegmentIntentRepair({
      draft: validInspection.normalizedDraft, initialIssues: validInspection.issues, context,
      patch: { patch_fields: { patch_type: "segment_asset_intent_repair", operations: [] } } as never,
    })).toThrow(SegmentIntentRepairError);

    const raw = validDraft();
    delete (raw.segments[0]!.intents[0] as { image_prompt?: unknown }).image_prompt;
    raw.segments[2]!.source_segment_id = "outside";
    const inspection = inspect(raw);
    expect(() => applySegmentIntentRepair({
      draft: inspection.normalizedDraft, initialIssues: inspection.issues, context,
      patch: { patch_type: "segment_asset_intent_repair", operations: [{
        operation: "replace_field", path: ["segments", 0, "intents", 0, "image_prompt"],
        value: "修复叶子",
      }] },
    })).toThrow(SegmentIntentRepairError);
  });
});
