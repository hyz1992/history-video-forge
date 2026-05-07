import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const recordPath =
  "docs/records/2026-05-07-script-writer-prompt-debt-audit.md";

describe("script writer prompt debt audit record", () => {
  it("records current prompt metrics and explicit non-change conclusions", () => {
    expect(existsSync(recordPath)).toBe(true);

    const record = readFileSync(recordPath, "utf8");
    const required = [
      "# Script Writer Prompt Debt Audit Record",
      "prompt_chars:",
      "prompt_lines:",
      "bullet_count:",
      "schema_contract",
      "topic_boundary",
      "quality_goal",
      "opening_strategy",
      "body_density",
      "regen_only",
      "quote_usage",
      "duplicate_or_competing",
      "Current conclusion",
      "Do not modify script.writer prompt in this task",
      "Do not introduce ScriptWritingBrief into runtime",
    ];

    for (const item of required) {
      expect(record).toContain(item);
    }

    expect(record).toMatch(/prompt_chars:\s*\d+/);
    expect(record).toMatch(/prompt_lines:\s*\d+/);
    expect(record).toMatch(/bullet_count:\s*\d+/);
    for (const forbidden of ["TB" + "D", "TO" + "DO"]) {
      expect(record).not.toContain(forbidden);
    }
  });
});
