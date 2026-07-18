import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const executableEntries = [
  "shared/src/script/script-writing-brief-shadow.schema.ts",
  "prompts/script/script-writing-brief-shadow.prompt.md",
  "harness/scripts/runtime/script-writing-brief-shadow.ts",
  "harness/scripts/runtime/script-brief-shadow-five-round-check.ts",
  "harness/samples/script-writing-brief-shadow/yanzi-shichu.fixture.json",
  "tests/shared/script-writing-brief-shadow-schema.test.ts",
  "tests/harness/script-writing-brief-shadow.test.ts",
  "tests/harness/script-brief-shadow-five-round-check.test.ts",
];

const runtimeSurfaceEntries = [
  "package.json",
  "shared/src/index.ts",
  "backend/src/modules/script/script-generation.service.ts",
  "prompts/script/script-writer.prompt.md",
];

describe("script brief shadow stopped state", () => {
  it("removes executable ScriptWritingBrief shadow entry points", () => {
    for (const entry of executableEntries) {
      expect(existsSync(entry), entry).toBe(false);
    }

    const packageJson = readFileSync("package.json", "utf8");
    expect(packageJson).not.toContain("script-brief-shadow-five-round-check");

    const sharedIndex = readFileSync("shared/src/index.ts", "utf8");
    expect(sharedIndex).not.toContain("ScriptWritingBriefShadow");
  });

  it("keeps the stop conclusion visible in planning and observation records", () => {
    const design = readFileSync(
      "docs/plans/archive/topic-script/2026-05-07-script-prompt-debt-audit-and-brief-shadow-design.md",
      "utf8",
    );
    const implementationPlan = readFileSync(
      "docs/plans/archive/topic-script/2026-05-07-script-prompt-debt-audit-and-brief-shadow-implementation-plan.md",
      "utf8",
    );
    const observation = readFileSync(
      "docs/records/2026-05-07-script-writing-brief-shadow-observation.md",
      "utf8",
    );

    expect(design).toContain("ScriptWritingBrief path stopped");
    expect(implementationPlan).toContain("ScriptWritingBrief path stopped");
    expect(observation).toContain("continue_to_ab_design: no");
  });

  it("does not reintroduce Brief-like runtime surfaces under another name", () => {
    for (const entry of runtimeSurfaceEntries) {
      const content = readFileSync(entry, "utf8");

      expect(content, entry).not.toContain("ScriptWritingBrief");
      expect(content, entry).not.toContain("materialization_brief");
      expect(content, entry).not.toContain("script_brief");
      expect(content, entry).not.toContain("ScriptBrief");
    }
  });
});
