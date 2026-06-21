import { describe, expect, it } from "vitest";

import {
  createReferenceMigrationSummaryMarkdown,
  summarizeReferenceMigrationChecks,
  type ReferenceMigrationCheck,
} from "../../harness/scripts/ui-acceptance/reference-migration-model";

describe("reference migration model", () => {
  it("summarizes fail over warn and pass", () => {
    const checks: ReferenceMigrationCheck[] = [
      { code: "a", status: "PASS", message: "a passed" },
      { code: "b", status: "WARN", message: "b warned" },
      { code: "c", status: "FAIL", message: "c failed" },
    ];

    expect(summarizeReferenceMigrationChecks(checks)).toMatchObject({
      status: "FAIL",
      totals: { pass: 1, warn: 1, fail: 1, skipped: 0 },
    });
  });

  it("renders markdown with automatic and manual review sections", () => {
    const markdown = createReferenceMigrationSummaryMarkdown({
      run_id: "run-1",
      status: "WARN",
      generated_at: "2026-06-21T00:00:00.000Z",
      contracts: [
        {
          contract_id: "home-preview-landing",
          title: "首页",
          status: "WARN",
          checks: [{ code: "visual-review", status: "WARN", message: "needs review" }],
          screenshots: [{ viewport: "desktop", reference: "a.png", target: "b.png" }],
          manual_review_items: ["检查桌面截图"],
        },
      ],
      totals: { pass: 0, warn: 1, fail: 0, skipped: 0 },
    });

    expect(markdown).toContain("# UI Reference Migration Report");
    expect(markdown).toContain("home-preview-landing");
    expect(markdown).toContain("检查桌面截图");
  });
});
