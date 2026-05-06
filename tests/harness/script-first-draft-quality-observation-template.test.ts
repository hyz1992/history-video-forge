import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("script first-draft quality observation template", () => {
  it("documents five-round quality observation fields without making them an automatic gate", () => {
    const templatePath = join(
      process.cwd(),
      "docs/records/2026-05-06-script-writer-viral-first-draft-quality-observation-template.md",
    );

    expect(existsSync(templatePath)).toBe(true);

    const content = readFileSync(templatePath, "utf8");
    for (const field of [
      "sample id",
      "local validation",
      "semantic shadow",
      "script chars",
      "opening",
      "是否摘要感明显",
      "核心场面是否有动作/压力/结果",
      "是否有对话或可识别转述",
      "ending 是否有余震",
      "upstream_material_sufficiency",
      "strong_scene",
      "stakes",
      "must_include_beats",
      "source_anchor_refs",
      "canonical_quotes",
      "reviewer_variance_note",
      "人工结论",
    ]) {
      expect(content).toContain(field);
    }
    expect(content).toContain("不作为自动门禁");
    expect(content).toContain("不接入 patch / regen 主链路");
  });
});
