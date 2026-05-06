import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("script writer quality check after no-padding volume contract record", () => {
  it("records the rerun result, partial improvement, and no-padding risk", () => {
    const recordPath = join(
      process.cwd(),
      "docs/records/2026-05-06-script-writer-quality-check-after-no-padding-volume-contract.md",
    );

    expect(existsSync(recordPath)).toBe(true);

    const content = readFileSync(recordPath, "utf8");
    for (const requiredText of [
      "2026-05-06-after-no-padding-volume-contract",
      "5 / 5 sample-ready",
      "4 / 5 local validation pass",
      "1 / 5 local validation failed",
      "hongmenyan",
      "273",
      "zhuanzhu-ciwangliao",
      "175",
      "script_body_too_thin",
      "yanzi-shichu repeat",
      "patch_once",
      "不能为了凑字数说废话",
      "局部有效",
      "仍未达到爆款首稿线",
      "不接入 patch / regen 主链路",
    ]) {
      expect(content).toContain(requiredText);
    }
  });
});
