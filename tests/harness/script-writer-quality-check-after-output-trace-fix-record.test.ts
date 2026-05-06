import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("script writer quality check after output trace fix record", () => {
  it("records the rerun output directory, repeat traceability, and quality conclusion", () => {
    const recordPath = join(
      process.cwd(),
      "docs/records/2026-05-06-script-writer-quality-check-after-output-trace-fix.md",
    );

    expect(existsSync(recordPath)).toBe(true);

    const content = readFileSync(recordPath, "utf8");
    for (const requiredText of [
      "2026-05-06-after-output-trace-fix",
      "yanzi-shichu-repeat-2",
      "5 / 5 sample-ready",
      "5 / 5 local validation pass",
      "显式 output_dir 已生效",
      "repeat 样本已独立落盘",
      "仍未达到爆款首稿线",
      "topic.candidate-builder timed out",
      "不接入 patch / regen 主链路",
    ]) {
      expect(content).toContain(requiredText);
    }
  });
});
