import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  AssetPlan,
  type AssetPlan as AssetPlanType,
} from "../../../shared/src/index.js";
import {
  canonicalizeLegacyAudioTiming,
  coerceLegacyChunkStructuralPatch,
  LegacyChunkResilienceError,
  SegmentChunkStructuralPatch,
} from "../../../backend/src/modules/asset-planning/legacy-chunk-resilience.js";

function readFixture(name: string): unknown {
  return JSON.parse(
    readFileSync(
      resolve(process.cwd(), "tests", "fixtures", "asset-planning", name),
      "utf8",
    ),
  );
}

function readInvalidTimingPlan(): AssetPlanType {
  return AssetPlan.parse(
    readFixture("legacy-plan-invalid-audio-timing.json"),
  );
}

describe("coerceLegacyChunkStructuralPatch", () => {
  const patchFields = {
    task_patches: [],
    dependency_patches: [],
  };

  it("defaults the only missing fixed discriminator without mutating input", () => {
    const raw = structuredClone(patchFields);
    const snapshot = structuredClone(raw);

    const result = coerceLegacyChunkStructuralPatch(raw);

    expect(result.patch).toEqual({
      patch_type: "segment_chunk_structural_patch",
      ...patchFields,
    });
    expect(SegmentChunkStructuralPatch.parse(result.patch)).toEqual(
      result.patch,
    );
    expect(result.actions).toEqual([
      { type: "missing_discriminator_defaulted" },
    ]);
    expect(raw).toEqual(snapshot);
  });

  it("unwraps only the observed single patch_fields wrapper in stable action order", () => {
    const raw = readFixture("legacy-chunk-repair-wrapper-drift.json");
    const snapshot = structuredClone(raw);

    const result = coerceLegacyChunkStructuralPatch(raw);

    expect(result.patch).toEqual({
      patch_type: "segment_chunk_structural_patch",
      ...(raw as { patch_fields: Record<string, unknown> }).patch_fields,
    });
    expect(result.actions).toEqual([
      { type: "single_wrapper_unwrapped" },
      { type: "missing_discriminator_defaulted" },
    ]);
    expect(raw).toEqual(snapshot);
  });

  it.each([
    [
      "wrapper and top-level fields coexist",
      { patch_fields: patchFields, ...patchFields },
    ],
    ["wrapper has a sibling", { patch_fields: patchFields, note: "no" }],
    [
      "nested wrapper",
      { patch_fields: { patch_fields: patchFields } },
    ],
    [
      "unknown patch key",
      { ...patchFields, unexpected: true },
    ],
    ["task patches are missing", { dependency_patches: [] }],
    [
      "task patch item is invalid",
      { ...patchFields, task_patches: [{ local_task_id: "" }] },
    ],
    [
      "literal is wrong",
      { patch_type: "other", ...patchFields },
    ],
  ])("rejects %s", (_label, raw) => {
    expect(() => coerceLegacyChunkStructuralPatch(raw)).toThrow();
  });
});

describe("canonicalizeLegacyAudioTiming", () => {
  it("atomically rebinds the observed invalid SFX timing edge to the unique TTS", () => {
    const plan = readInvalidTimingPlan();
    const snapshot = structuredClone(plan);

    const result = canonicalizeLegacyAudioTiming(plan);

    expect(result.actions).toEqual([
      {
        type: "audio_timing_rebound",
        dependency_id: "dep_sfx_invalid_timing",
        before_task_id: "motion_seg_002",
        after_task_id: "tts_full_story",
        reason_code: "invalid_audio_timing_source",
      },
    ]);
    expect(
      result.plan.dependencies.find(
        (dependency) => dependency.dependency_id === "dep_sfx_invalid_timing",
      ),
    ).toMatchObject({ depends_on_task_id: "tts_full_story" });
    expect(AssetPlan.parse(result.plan)).toEqual(result.plan);
    expect(plan).toEqual(snapshot);
  });

  it("preserves legal and unrelated dependencies in a mixed plan", () => {
    const plan = readInvalidTimingPlan();
    plan.dependencies.push(
      {
        dependency_id: "dep_sfx_selection",
        task_id: "sfx_seg_005",
        depends_on_task_id: "motion_seg_002",
        dependency_type: "requires_selection",
      },
      {
        dependency_id: "dep_image_output",
        task_id: "image_seg_001_anchor",
        depends_on_task_id: "motion_seg_002",
        dependency_type: "requires_output",
      },
      {
        dependency_id: "dep_bgm_legal_timing",
        task_id: "bgm_global",
        depends_on_task_id: "subtitle_full_story",
        dependency_type: "requires_timing",
      },
    );
    const untouched = plan.dependencies.filter(
      (dependency) => dependency.dependency_id !== "dep_sfx_invalid_timing",
    );

    const result = canonicalizeLegacyAudioTiming(plan);

    expect(
      result.plan.dependencies.filter(
        (dependency) => dependency.dependency_id !== "dep_sfx_invalid_timing",
      ),
    ).toEqual(untouched);
  });

  it.each([
    ["no TTS", 0],
    ["multiple TTS tasks", 2],
  ])("fails with a typed bounded issue when there is %s", (_label, ttsCount) => {
    const plan = readInvalidTimingPlan();
    const tts = plan.tasks.find((task) => task.task_type === "tts_audio")!;
    plan.tasks = plan.tasks.filter((task) => task.task_type !== "tts_audio");
    if (ttsCount === 2) {
      plan.tasks.unshift(
        tts,
        { ...structuredClone(tts), task_id: "tts_second", order: 99 },
      );
    }
    const snapshot = structuredClone(plan);

    let caught: unknown;
    try {
      canonicalizeLegacyAudioTiming(plan);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(LegacyChunkResilienceError);
    expect(caught).toMatchObject({
      code: "asset_legacy_audio_timing_rebind_ambiguous",
      issues: [
        {
          code: "audio_timing_rebind_ambiguous",
          path: ["dependencies", expect.any(Number), "depends_on_task_id"],
          tts_task_count: ttsCount,
        },
      ],
    });
    expect(plan).toEqual(snapshot);
  });

  it("returns a deep-equivalent valid legacy plan when no target edge exists", () => {
    const plan = AssetPlan.parse(readFixture("legacy-plan-valid.json"));

    const result = canonicalizeLegacyAudioTiming(plan);

    expect(result).toEqual({ plan, actions: [] });
    expect(result.plan).not.toBe(plan);
  });
});
