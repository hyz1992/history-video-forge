import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("script writer quality check after regen context record", () => {
  it("records the rerun result, regen context evidence, and remaining writer risk", () => {
    const recordPath = join(
      process.cwd(),
      "docs/records/2026-05-06-script-writer-quality-check-after-regen-context.md",
    );

    expect(existsSync(recordPath)).toBe(true);

    const content = readFileSync(recordPath, "utf8");
    for (const requiredText of [
      "2026-05-06-after-regen-context",
      "5 / 5 sample-ready",
      "3 / 5 local validation pass",
      "2 / 5 local validation failed",
      "zhuanzhu-ciwangliao",
      "hongmenyan",
      "script_body_too_thin",
      "203",
      "192",
      "regeneration_context",
      "min_script_chars_for_band",
      "信号已经传到 writer",
      "仍未达到爆款首稿线",
      "不接入 patch / regen 主链路",
    ]) {
      expect(content).toContain(requiredText);
    }
  });
});
