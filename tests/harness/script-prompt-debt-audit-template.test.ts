import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const templatePath =
  "docs/records/templates/script-prompt-debt-audit-template.md";

describe("script prompt debt audit template", () => {
  it("contains the required audit sections and safety guards", () => {
    expect(existsSync(templatePath)).toBe(true);

    const template = readFileSync(templatePath, "utf8");
    const requiredSections = [
      "# Script Prompt Debt Audit Record",
      "## Prompt Metrics",
      "## Constraint Categories",
      "## Duplicate Or Competing Constraints",
      "## Keep In Writer Prompt",
      "## Move Out Candidates",
      "## Stop Conditions",
      "## Non-Changes",
      "## Conclusion",
    ];

    for (const section of requiredSections) {
      expect(template).toContain(section);
    }

    expect(template).toContain("Do not modify script.writer prompt in this audit");
    expect(template).toContain("Do not introduce ScriptWritingBrief into runtime");
    expect(template).toContain("Do not use local semantic quality scoring");
  });
});
