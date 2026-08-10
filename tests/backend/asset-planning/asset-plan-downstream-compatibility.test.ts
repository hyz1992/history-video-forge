import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

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
  readBgmCueParams,
  readSfxCueParams,
} from "../../../backend/src/modules/assets/audio-cue-params.js";
import { buildInitialAssetManifest } from "../../../backend/src/modules/assets/assets-manifest-builder.js";
import type {
  InvokeStructuredPromptOptions,
  LlmGateway,
} from "../../../backend/src/runtime/llm/llm-gateway.js";

interface LongAssetPlanningFixture {
  source_ids: {
    storyboard_record_id: string;
    script_record_id: string;
    topic_package_id: string;
  };
  script: unknown;
  storyboard: unknown;
}

function readFixture<T>(filename: string): T {
  return JSON.parse(
    readFileSync(
      new URL(`../../fixtures/asset-planning/${filename}`, import.meta.url),
      "utf8",
    ),
  ) as T;
}

function parseLongFixture(filename: string) {
  const fixture = readFixture<LongAssetPlanningFixture>(filename);
  return {
    sourceIds: fixture.source_ids,
    script: ScriptDraftPackage.parse(fixture.script),
    storyboard: StoryboardPlan.parse(fixture.storyboard),
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
): LlmGateway {
  return {
    async invokeStructuredPrompt<T>(
      options: InvokeStructuredPromptOptions,
    ): Promise<T> {
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
    if (index > 0) {
      expect(segment.start_hint_sec).toBeGreaterThanOrEqual(
        storyboard.segments[index - 1]!.end_hint_sec,
      );
    }
  }
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
          (segment) => segment.visual_strategy_preference,
        ),
      ),
    ).toEqual(new Set(["api_video", "remotion_motion", null, undefined]));
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
    const plan = AssetPlan.parse(
      readFixture("legacy-plan-valid.json"),
    );
    const chunkDraft = readFixture<Record<string, unknown>>(
      "legacy-chunk-valid.json",
    );
    const firstStoryboard: StoryboardPlanType = {
      ...long15.storyboard,
      estimated_total_duration_sec: 6,
      segments: [long15.storyboard.segments[0]!],
    };

    await expect(
      generateAssetPlan({
        sourceStoryboardRecordId: long15.sourceIds.storyboard_record_id,
        sourceScriptRecordId: long15.sourceIds.script_record_id,
        sourceTopicPackageId: long15.sourceIds.topic_package_id,
        storyboard: firstStoryboard,
        draft: long15.script,
        topicBoundaryContext: makeTopicBoundaryContext(),
        llmGateway: makeLegacyGateway(plan, chunkDraft),
        chunkSize: 1,
      }),
    ).resolves.toMatchObject({ plan_version: "asset_plan_v1" });
  });

  it("keeps a complete legacy AssetPlan valid for the local validator and downstream readers", () => {
    const long15 = parseLongFixture("long-15-segment-input.json");
    const plan = AssetPlan.parse(
      readFixture("legacy-plan-valid.json"),
    );

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

  it("freezes the observed repair wrapper drift and isolated legacy timing error", () => {
    const wrapper = readFixture<Record<string, unknown>>(
      "legacy-chunk-repair-wrapper-drift.json",
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
