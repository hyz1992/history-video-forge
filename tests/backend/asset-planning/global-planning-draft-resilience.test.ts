import { describe, expect, it } from "vitest";

import missingPropNotesFixture from "../../fixtures/asset-planning/global-draft-props-missing-consistency-notes.json";
import { ProjectArtBible } from "../../../shared/src/index.js";
import {
  GlobalPlanningStructuralPatch,
  applyGlobalPlanningStructuralPatch,
  normalizeGlobalPlanningDraftStructure,
} from "../../../backend/src/modules/asset-planning/global-planning-draft-resilience.js";

describe("normalizeGlobalPlanningDraftStructure", () => {
  it("repairs all eight missing prop consistency_notes from the sanitized failure fixture", () => {
    const original = structuredClone(missingPropNotesFixture);

    const result = normalizeGlobalPlanningDraftStructure(missingPropNotesFixture);
    const value = result.value as typeof missingPropNotesFixture & {
      art_bible: {
        props: Array<(typeof missingPropNotesFixture.art_bible.props)[number] & {
          consistency_notes: string[];
        }>;
      };
    };

    expect(value.art_bible.props).toHaveLength(8);
    expect(value.art_bible.props.map((prop) => prop.consistency_notes)).toEqual(
      Array.from({ length: 8 }, () => []),
    );
    expect(() => ProjectArtBible.parse(value.art_bible)).not.toThrow();
    expect(result.actions).toEqual(
      Array.from({ length: 8 }, (_, index) => ({
        type: "default_inserted",
        path: `art_bible.props[${index}].consistency_notes`,
      })),
    );
    expect(missingPropNotesFixture).toEqual(original);
  });

  it("defaults every allowed missing array while preserving existing non-empty arrays", () => {
    const input = {
      planning_mode: "global",
      art_bible: {
        characters: [
          { character_id: "c1" },
          { character_id: "c2", consistency_notes: ["保留人物说明"] },
        ],
        locations: [{ location_id: "l1" }, { location_id: "l2", consistency_notes: [] }],
        props: [{ prop_id: "p1" }],
      },
    };

    const result = normalizeGlobalPlanningDraftStructure(input);

    expect(result.value).toEqual({
      planning_mode: "global",
      manual_review_notes: [],
      art_bible: {
        characters: [
          { character_id: "c1", consistency_notes: [] },
          { character_id: "c2", consistency_notes: ["保留人物说明"] },
        ],
        locations: [
          { location_id: "l1", consistency_notes: [] },
          { location_id: "l2", consistency_notes: [] },
        ],
        props: [{ prop_id: "p1", consistency_notes: [] }],
        global_negative_prompts: [],
        consistency_notes: [],
      },
    });
    expect(result.actions).toEqual([
      { type: "default_inserted", path: "art_bible.characters[0].consistency_notes" },
      { type: "default_inserted", path: "art_bible.consistency_notes" },
      { type: "default_inserted", path: "art_bible.global_negative_prompts" },
      { type: "default_inserted", path: "art_bible.locations[0].consistency_notes" },
      { type: "default_inserted", path: "art_bible.props[0].consistency_notes" },
      { type: "default_inserted", path: "manual_review_notes" },
    ]);
  });

  it("does not coerce invalid array values or create missing parents", () => {
    const invalidFields = {
      manual_review_notes: "不是数组",
      art_bible: {
        global_negative_prompts: "不是数组",
        consistency_notes: null,
        characters: [null, "不是对象", { consistency_notes: "不是数组" }],
        locations: "不是数组",
        props: [42],
      },
    };
    const invalidFieldsOriginal = structuredClone(invalidFields);

    expect(() => normalizeGlobalPlanningDraftStructure(invalidFields)).not.toThrow();
    expect(normalizeGlobalPlanningDraftStructure(invalidFields).value).toEqual(
      invalidFieldsOriginal,
    );
    expect(invalidFields).toEqual(invalidFieldsOriginal);

    const missingArtBible = { planning_mode: "global" };
    expect(normalizeGlobalPlanningDraftStructure(missingArtBible).value).toEqual({
      planning_mode: "global",
      manual_review_notes: [],
    });
    expect(missingArtBible).not.toHaveProperty("art_bible");

    const invalidArtBible = { art_bible: "不是对象", manual_review_notes: [] };
    expect(() => normalizeGlobalPlanningDraftStructure(invalidArtBible)).not.toThrow();
    expect(normalizeGlobalPlanningDraftStructure(invalidArtBible).value).toEqual(
      invalidArtBible,
    );

    for (const input of [null, ["不是对象父级"]]) {
      const original = structuredClone(input);
      expect(() => normalizeGlobalPlanningDraftStructure(input)).not.toThrow();
      expect(normalizeGlobalPlanningDraftStructure(input).value).toEqual(original);
      expect(input).toEqual(original);
    }
  });

  it("removes only exact top-level chunk pollution keys and preserves unknown keys", () => {
    const input = {
      planning_mode: "global",
      chunk_id: "chunk_1",
      tasks: [],
      dependencies: [],
      budget_notes: [],
      unknown_extension: { tasks: ["嵌套未知键必须保留"] },
      art_bible: {
        characters: [],
        locations: [],
        props: [],
        global_negative_prompts: [],
        consistency_notes: [],
      },
      manual_review_notes: [],
    };

    const result = normalizeGlobalPlanningDraftStructure(input);

    expect(result.value).toEqual({
      planning_mode: "global",
      unknown_extension: { tasks: ["嵌套未知键必须保留"] },
      art_bible: input.art_bible,
      manual_review_notes: [],
    });
    expect(result.actions).toEqual([
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
    ]);
    expect(input).toHaveProperty("tasks");
  });

  it("deduplicates actions and orders them stably by type then path", () => {
    const input = {
      tasks: [],
      art_bible: {
        characters: [{}, {}],
        locations: [{}],
        props: [{}],
      },
    };

    const first = normalizeGlobalPlanningDraftStructure(input).actions;
    const second = normalizeGlobalPlanningDraftStructure(input).actions;
    const identities = first.map((action) => `${action.type}:${action.path}`);

    expect(new Set(identities).size).toBe(identities.length);
    expect(identities).toEqual([...identities].sort());
    expect(second).toEqual(first);
  });
});

describe("applyGlobalPlanningStructuralPatch", () => {
  it("requires an explicit value key and rejects malformed patch shapes", () => {
    const invalidPatches = [
      {
        patch_type: "global_planning_structural_patch",
        patches: [{ path: ["manual_review_notes"] }],
      },
      {
        patch_type: "global_planning_structural_patch",
        patches: [],
        extra: true,
      },
      {
        patch_type: "global_planning_structural_patch",
        patches: [{ path: ["manual_review_notes"], value: [], extra: true }],
      },
      {
        patch_type: "wrong_patch_type",
        patches: [],
      },
      {
        patch_type: "global_planning_structural_patch",
        patches: [{ path: ["items", -1], value: null }],
      },
      {
        patch_type: "global_planning_structural_patch",
        patches: [{ path: ["items", 0.5], value: null }],
      },
      {
        patch_type: "global_planning_structural_patch",
        patches: [{ path: ["items", true], value: null }],
      },
      {
        patch_type: "global_planning_structural_patch",
        patches: [{ path: ["items", { index: 0 }], value: null }],
      },
    ];

    for (const patch of invalidPatches) {
      expect(GlobalPlanningStructuralPatch.safeParse(patch).success).toBe(false);
    }
  });

  it.each([null, { nested: "值" }, ["数组值"], "字符串值"])(
    "accepts explicit JSON patch value %#",
    (value) => {
      expect(
        GlobalPlanningStructuralPatch.safeParse({
          patch_type: "global_planning_structural_patch",
          patches: [{ path: ["manual_review_notes"], value }],
        }).success,
      ).toBe(true);
    },
  );

  it("applies only authorized exact paths without mutating the draft", () => {
    const draft = {
      art_bible: {
        props: [
          { prop_id: "p1", consistency_notes: [] },
          { prop_id: "p2", consistency_notes: [] },
        ],
      },
      manual_review_notes: [],
    };
    const original = structuredClone(draft);
    const patch = GlobalPlanningStructuralPatch.parse({
      patch_type: "global_planning_structural_patch",
      patches: [
        {
          path: ["art_bible", "props", 1, "consistency_notes"],
          value: ["保持第二件道具的材质与形制一致"],
        },
        {
          path: ["manual_review_notes"],
          value: ["需要人工确认道具年代"],
        },
      ],
    });

    const result = applyGlobalPlanningStructuralPatch({
      draft,
      patch,
      allowedRepairPaths: [
        ["art_bible", "props", 1, "consistency_notes"],
        ["manual_review_notes"],
      ],
    });

    expect(result).toEqual({
      art_bible: {
        props: [
          { prop_id: "p1", consistency_notes: [] },
          {
            prop_id: "p2",
            consistency_notes: ["保持第二件道具的材质与形制一致"],
          },
        ],
      },
      manual_review_notes: ["需要人工确认道具年代"],
    });
    expect(draft).toEqual(original);
  });

  it.each([
    {
      name: "extra path",
      allowedRepairPaths: [["art_bible", "props", 0, "consistency_notes"]],
      patchPath: ["manual_review_notes"],
    },
    {
      name: "parent overwrite",
      allowedRepairPaths: [["art_bible", "props", 0, "consistency_notes"]],
      patchPath: ["art_bible", "props", 0],
    },
  ])("rejects $name instead of using path prefixes", ({ allowedRepairPaths, patchPath }) => {
    const patch = GlobalPlanningStructuralPatch.parse({
      patch_type: "global_planning_structural_patch",
      patches: [{ path: patchPath, value: [] }],
    });

    expect(() =>
      applyGlobalPlanningStructuralPatch({
        draft: { art_bible: { props: [{ consistency_notes: [] }] } },
        patch,
        allowedRepairPaths,
      }),
    ).toThrow(/allowed/i);
  });

  it("rejects duplicate structural paths", () => {
    const path = ["manual_review_notes"] as const;
    const patch = GlobalPlanningStructuralPatch.parse({
      patch_type: "global_planning_structural_patch",
      patches: [
        { path, value: ["一"] },
        { path, value: ["二"] },
      ],
    });

    expect(() =>
      applyGlobalPlanningStructuralPatch({
        draft: { manual_review_notes: [] },
        patch,
        allowedRepairPaths: [[...path]],
      }),
    ).toThrow(/duplicate/i);
  });

  it.each([
    { name: "negative array index", path: ["items", -1] },
    { name: "out-of-bounds array index", path: ["items", 1] },
    { name: "string key on array", path: ["items", "0"] },
    { name: "numeric key on object", path: ["nested", 0] },
    { name: "missing parent", path: ["missing", "value"] },
  ])("rejects $name", ({ path }) => {
    const rawPatch = {
      patch_type: "global_planning_structural_patch",
      patches: [{ path, value: "替换值" }],
    };

    expect(() => {
      const patch = GlobalPlanningStructuralPatch.parse(rawPatch);
      applyGlobalPlanningStructuralPatch({
        draft: { items: ["原值"], nested: {} },
        patch,
        allowedRepairPaths: [path],
      });
    }).toThrow();
  });

  it("allows root replacement only when the empty root path is explicitly allowed", () => {
    const patch = GlobalPlanningStructuralPatch.parse({
      patch_type: "global_planning_structural_patch",
      patches: [{ path: [], value: { replacement: true } }],
    });

    expect(
      applyGlobalPlanningStructuralPatch({
        draft: { replacement: false },
        patch,
        allowedRepairPaths: [[]],
      }),
    ).toEqual({ replacement: true });
    expect(() =>
      applyGlobalPlanningStructuralPatch({
        draft: { replacement: false },
        patch,
        allowedRepairPaths: [["replacement"]],
      }),
    ).toThrow(/allowed/i);
  });

  it("validates every patch before applying any of them", () => {
    const draft = { first: "原始值", items: ["原始项"] };
    const original = structuredClone(draft);
    const patch = GlobalPlanningStructuralPatch.parse({
      patch_type: "global_planning_structural_patch",
      patches: [
        { path: ["first"], value: "本不应提交" },
        { path: ["items", 9], value: "越界" },
      ],
    });

    expect(() =>
      applyGlobalPlanningStructuralPatch({
        draft,
        patch,
        allowedRepairPaths: [["first"], ["items", 9]],
      }),
    ).toThrow();
    expect(draft).toEqual(original);
  });
});
