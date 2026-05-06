import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("zhuanzhu upstream material sufficiency diagnosis record", () => {
  it("records duplicated upstream tension fields and the next low-coupling recommendation", () => {
    const recordPath = join(
      process.cwd(),
      "docs/records/2026-05-06-zhuanzhu-upstream-material-sufficiency-diagnosis.md",
    );

    expect(existsSync(recordPath)).toBe(true);

    const content = readFileSync(recordPath, "utf8");
    for (const requiredText of [
      "zhuanzhu-ciwangliao",
      "2026-05-06-after-no-padding-volume-contract",
      "175",
      "script_body_too_thin",
      "selected_angle",
      "stakes",
      "mid_reveal",
      "ending_residue",
      "重复",
      "strong_scene",
      "鱼腹藏剑",
      "上游材料不足",
      "不是继续堆 writer prompt",
      "结构性防重复",
      "不接入 patch / regen 主链路",
    ]) {
      expect(content).toContain(requiredText);
    }
  });
});
