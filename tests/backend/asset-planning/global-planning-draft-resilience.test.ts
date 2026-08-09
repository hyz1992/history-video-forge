import { describe, expect, it } from "vitest";

import missingPropNotesFixture from "../../fixtures/asset-planning/global-draft-props-missing-consistency-notes.json";
import { ProjectArtBible } from "../../../shared/src/index.js";
import {
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
        path: `$.art_bible.props[${index}].consistency_notes`,
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
      { type: "default_inserted", path: "$.art_bible.characters[0].consistency_notes" },
      { type: "default_inserted", path: "$.art_bible.consistency_notes" },
      { type: "default_inserted", path: "$.art_bible.global_negative_prompts" },
      { type: "default_inserted", path: "$.art_bible.locations[0].consistency_notes" },
      { type: "default_inserted", path: "$.art_bible.props[0].consistency_notes" },
      { type: "default_inserted", path: "$.manual_review_notes" },
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
        path: "$.budget_notes",
        key: "budget_notes",
      },
      {
        type: "forbidden_chunk_key_removed",
        path: "$.chunk_id",
        key: "chunk_id",
      },
      {
        type: "forbidden_chunk_key_removed",
        path: "$.dependencies",
        key: "dependencies",
      },
      {
        type: "forbidden_chunk_key_removed",
        path: "$.tasks",
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
