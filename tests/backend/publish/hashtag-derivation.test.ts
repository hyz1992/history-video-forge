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

  it("includes era_style keywords", () => {
    const result = deriveHashtags({
      familyLabel: "军事冲突",
      scopeLabel: "战国中期",
      topicTitle: "长平之战",
      eraStyle: "战国末年秦赵对峙历史正剧",
    });

    expect(result).toContain("战国");
    expect(result).toContain("长平之战");
  });

  it("extracts dynasty keywords from era_style covering all major periods", () => {
    const cases = [
      { era: "西周青铜器时期", expected: "西周" },
      { era: "春秋争霸历史正剧", expected: "春秋" },
      { era: "战国末年秦赵对峙", expected: "战国" },
      { era: "三国赤壁之战", expected: "三国" },
      { era: "南北朝对峙时期", expected: "南北朝" },
      { era: "唐初玄武门之变", expected: "唐" },
      { era: "南宋偏安江南", expected: "南宋" },
    ];

    for (const { era, expected } of cases) {
      const result = deriveHashtags({
        familyLabel: "军事冲突",
        scopeLabel: "古代",
        topicTitle: "测试",
        eraStyle: era,
      });
      expect(result).toContain(expected);
    }
  });

  it("limits to max 10 tags", () => {
    const result = deriveHashtags({
      familyLabel: "文化镇压",
      scopeLabel: "清朝初期",
      topicTitle: "庄廷鑨明史案",
      eraStyle: "明末清初江南历史正剧",
      narrativeRoles: ["opening", "setup", "twist", "climax", "resolution", "ending"],
    });

    expect(result.length).toBeLessThanOrEqual(10);
  });

  it("deduplicates tags", () => {
    const result = deriveHashtags({
      familyLabel: "清朝",
      scopeLabel: "清朝初期",
      topicTitle: "清朝",
    });

    // "清朝" should only appear once
    const qingCount = result.filter((t) => t === "清朝").length;
    expect(qingCount).toBe(1);
  });

  it("handles minimal input gracefully", () => {
    const result = deriveHashtags({
      familyLabel: "",
      scopeLabel: "",
      topicTitle: "",
    });

    // Should at least have "历史" and "历史故事"
    expect(result).toContain("历史");
    expect(result).toContain("历史故事");
  });

  it("includes narrative role hints", () => {
    const result = deriveHashtags({
      familyLabel: "军事冲突",
      scopeLabel: "战国中期",
      topicTitle: "长平之战",
      narrativeRoles: ["climax", "twist"],
    });

    expect(result).toContain("高潮");
    expect(result).toContain("转折");
  });
});
