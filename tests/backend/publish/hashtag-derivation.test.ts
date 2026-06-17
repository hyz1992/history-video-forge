import { describe, expect, it } from "vitest";
import { deriveHashtags } from "../../../backend/src/modules/publish/hashtag-derivation.service.js";

describe("hashtag derivation service", () => {
  it("derives base tags from family_label and scope_label", () => {
    const result = deriveHashtags({
      familyLabel: "文化镇压",
      scopeLabel: "清朝初期",
      topicTitle: "庄廷鑨明史案",
    });

    expect(result).toContain("历史");
    expect(result).toContain("清朝");
    expect(result).toContain("文化镇压");
    expect(result).toContain("庄廷鑨明史案");
    expect(result).toContain("历史故事");
  });

  it("trim era suffixes from scope_label", () => {
    const cases = [
      { input: "清朝初期", expected: "清朝" },
      { input: "明朝中期", expected: "明朝" },
      { input: "战国末期", expected: "战国" },
      { input: "唐朝时期", expected: "唐朝" },
      { input: "三国时代", expected: "三国" },
    ];

    for (const { input, expected } of cases) {
      const result = deriveHashtags({
        familyLabel: "军事冲突",
        scopeLabel: input,
        topicTitle: "测试",
      });
      expect(result).toContain(expected);
    }
  });

  it("limits to max 10 tags", () => {
    const result = deriveHashtags({
      familyLabel: "文化镇压",
      scopeLabel: "清朝初期",
      topicTitle: "庄廷鑨明史案",
    });

    expect(result.length).toBeLessThanOrEqual(10);
  });

  it("deduplicates tags", () => {
    const result = deriveHashtags({
      familyLabel: "清朝",
      scopeLabel: "清朝初期",
      topicTitle: "清朝",
    });

    const qingCount = result.filter((t) => t === "清朝").length;
    expect(qingCount).toBe(1);
  });

  it("handles minimal input gracefully", () => {
    const result = deriveHashtags({
      familyLabel: "",
      scopeLabel: "",
      topicTitle: "",
    });

    expect(result).toContain("历史");
    expect(result).toContain("历史故事");
  });
});
