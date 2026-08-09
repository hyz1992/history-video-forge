import { describe, expect, it } from "vitest";

import { renderRecommendationDiagnosticsMarkdown } from "../../../backend/src/runtime/llm/interaction-log.js";

const baseInput = {
  generatedAt: "2026-08-08T08:00:00.000Z",
  diagnostics: [],
  candidates: [],
  annotations: [],
};

describe("recommendation diagnostics markdown", () => {
  it("renders a complete and markdown-safe Filter section", () => {
    const markdown = renderRecommendationDiagnosticsMarkdown({
      ...baseInput,
      filter: {
        filter_fingerprint: "0123456789abcdef",
        normalized_filter: {
          period_range: {
            start_id: "tang",
            end_id: "song_liao_xia_jin",
            included_period_ids: [
              "tang",
              "five_dynasties_ten_kingdoms",
              "song_liao_xia_jin",
            ],
          },
          exclude_terms: [
            "[链接](https://example.com)",
            "<details>",
            "`代码`",
          ],
        },
        filter_effect_summary:
          "时期：唐、五代十国、宋辽夏金；排除项：\\路径 *星* _线_ {花} [链接](https://example.com) <details> #标题 +加 -减 !警告 |管道| `代码`",
        filter_match_status: "full",
        filter_match_shortfall: 0,
      },
    });

    expect(markdown).toContain("## Filter");
    expect(markdown).toContain("- filter_fingerprint: 0123456789abcdef");
    expect(markdown).toContain("- normalized_filter:\n\n    {");
    expect(markdown).toContain("five_dynasties_ten_kingdoms");
    expect(markdown).toContain("唐、五代十国、宋辽夏金");
    expect(markdown).toContain("- filter_match_status: full");
    expect(markdown).toContain("- filter_match_shortfall: 0");
    const normalizedFilterBlock = markdown
      .split("- normalized_filter:\n")[1]
      ?.split("- filter_effect_summary:")[0];
    expect(normalizedFilterBlock).toBeDefined();
    expect(
      normalizedFilterBlock!
        .split("\n")
        .filter(Boolean)
        .every((line) => line.startsWith("    ")),
    ).toBe(true);
    expect(normalizedFilterBlock).toContain("    \"exclude_terms\": [");
    expect(normalizedFilterBlock).toContain("[链接](https://example.com)");
    expect(normalizedFilterBlock).toContain("<details>");
    expect(normalizedFilterBlock).toContain("`代码`");
    expect(markdown).toContain("\\\\路径");
    expect(markdown).toContain("\\*星\\*");
    expect(markdown).toContain("\\_线\\_");
    expect(markdown).toContain("\\{花\\}");
    expect(markdown).toContain("\\[链接\\]\\(https://example.com\\)");
    expect(markdown).toContain("\\<details\\>");
    expect(markdown).toContain("\\#标题");
    expect(markdown).toContain("\\+加");
    expect(markdown).toContain("\\-减");
    expect(markdown).toContain("\\!警告");
    expect(markdown).toContain("\\|管道\\|");
    expect(markdown).toContain("\\`代码\\`");
    expect(markdown).not.toContain("Prompt");
  });

  it("omits the Filter section when filters are not meaningful", () => {
    const markdown = renderRecommendationDiagnosticsMarkdown(baseInput);

    expect(markdown).not.toContain("## Filter");
    expect(markdown).not.toContain("filter_fingerprint");
  });
});
