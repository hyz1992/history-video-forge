import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("script writer quality check after validator floor tightening record", () => {
  it("records the rerun result, validator trigger, and remaining quality risks", () => {
    const recordPath = join(
      process.cwd(),
      "docs/records/2026-05-06-script-writer-quality-check-after-validator-floor-tightening.md",
    );

    expect(existsSync(recordPath)).toBe(true);

    const content = readFileSync(recordPath, "utf8");
    for (const requiredText of [
      "2026-05-06-after-validator-floor-tightening",
      "script_body_too_thin",
      "hongmenyan",
      "regen_once",
      "semantic skipped",
      "67",
      "5 / 5 sample-ready",
      "4 / 5 local validation pass",
      "passed_samples 不是 local validation pass",
      "仍未达到爆款首稿线",
      "不接入 patch / regen 主链路",
    ]) {
      expect(content).toContain(requiredText);
    }
  });
});
