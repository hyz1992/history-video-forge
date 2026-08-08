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
          exclude_terms: ["演义`\n- 伪史"],
        },
        filter_effect_summary: "时期：唐、五代十国、宋辽夏金；排除：演义`\n- 伪史",
        filter_match_status: "full",
        filter_match_shortfall: 0,
      },
    });

    expect(markdown).toContain("## Filter");
    expect(markdown).toContain("- filter_fingerprint: 0123456789abcdef");
    expect(markdown).toContain("- normalized_filter: {");
    expect(markdown).toContain("five_dynasties_ten_kingdoms");
    expect(markdown).toContain("唐、五代十国、宋辽夏金");
    expect(markdown).toContain("- filter_match_status: full");
    expect(markdown).toContain("- filter_match_shortfall: 0");
    expect(markdown).toContain("演义\\` / - 伪史");
    expect(markdown).not.toContain("\n- 伪史\n");
    expect(markdown).not.toContain("Prompt");
  });

  it("omits the Filter section when filters are not meaningful", () => {
    const markdown = renderRecommendationDiagnosticsMarkdown(baseInput);

    expect(markdown).not.toContain("## Filter");
    expect(markdown).not.toContain("filter_fingerprint");
  });
});
