import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const templatePath =
  "docs/records/templates/script-writing-brief-shadow-observation-template.md";

describe("script writing brief shadow observation template", () => {
  it("contains required human review fields and stop criteria", () => {
    expect(existsSync(templatePath)).toBe(true);

    const template = readFileSync(templatePath, "utf8");
    const required = [
      "# Script Writing Brief Shadow Observation",
      "## Run Metadata",
      "## Sample Table",
      "## Incremental Value Review",
      "## Fact Risk Review",
      "## Template Risk Review",
      "## Main-Chain Safety Review",
      "## Decision",
      "Stop if Brief is only a longer summary",
      "Stop if Brief adds unsupported facts",
      "Stop if Brief requires writer prompt to become heavier",
    ];

    for (const item of required) {
      expect(template).toContain(item);
    }
  });
});
