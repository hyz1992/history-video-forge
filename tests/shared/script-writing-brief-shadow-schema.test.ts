import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { ScriptWritingBriefShadow } from "../../shared/src/index.js";

const fixture = JSON.parse(
  readFileSync(
    "harness/samples/script-writing-brief-shadow/yanzi-shichu.fixture.json",
    "utf8",
  ),
);

describe("ScriptWritingBriefShadow schema", () => {
  it("accepts the minimal shadow brief fixture", () => {
    const parsed = ScriptWritingBriefShadow.parse(fixture);

    expect(parsed.stage).toBe("script_writing_brief_shadow");
    expect(parsed.topic_id).toBe("topic_yanzi_shichu");
    expect(parsed.beat_units.map((unit) => unit.beat)).toEqual([
      "鍏ユ鍙楄颈",
      "姗樻灣涔嬪柣",
    ]);
    expect(parsed.material_gaps).toEqual([]);
  });

  it("rejects downstream or invented fact fields", () => {
    expect(() =>
      ScriptWritingBriefShadow.parse({
        ...fixture,
        storyboard_shots: [],
      }),
    ).toThrow();

    expect(() =>
      ScriptWritingBriefShadow.parse({
        ...fixture,
        beat_units: [
          {
            ...fixture.beat_units[0],
            source_basis: "invented_fact",
          },
        ],
      }),
    ).toThrow();
  });
});
