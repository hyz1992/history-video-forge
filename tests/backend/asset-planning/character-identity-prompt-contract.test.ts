import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// 仅验证正式 prompt 的输入/输出合同与规则存在，不代表真实 LLM 或出图质量已通过。
describe("稳定角色身份的正式 prompt 合同", () => {
  it("分段规划明确衣冠器物和多人关系，并保留稳定身份与当前分镜的造型职责", () => {
    const prompt = readFileSync(new URL("../../../prompts/asset-planning/segment-intent-planner.prompt.md", import.meta.url), "utf8");
    expect(prompt).toContain("关键衣冠器物除名称外，写出可辨识的形状、结构和颜色");
    expect(prompt).toContain("多人镜明确各角色的位置、动作及其与核心物件的关系");
    expect(prompt).toContain("不因空位补出新的关键人物");
    expect(prompt).toContain("不得改写分镜或新增史实");
    expect(prompt).toContain("version: v1.4.0");
    expect(prompt).toContain("language: zh-CN");
    expect(prompt).toContain("SegmentIntentPlannerInput");
    expect(prompt).toContain("SegmentAssetIntentBatchDraft");
    expect(prompt).toContain("`identity_description`");
    expect(prompt).toContain("年龄区间、脸型、五官、体型");
    expect(prompt).toContain("当前 `StoryboardSegment`");
    expect(prompt).toContain("服饰、冠帽、兵器、动作和场景");
    expect(prompt).toContain("参考图只负责身份");
    expect(prompt).toContain("不得把定妆图服装当作跨镜制服");
  });

  it("优化器保留角色名和稳定身份，允许按当前分镜语义修正旧锚点造型", () => {
    const prompt = readFileSync(new URL("../../../prompts/asset/prompt-optimizer.prompt.md", import.meta.url), "utf8");
    expect(prompt).toContain("version: v1.1.0");
    expect(prompt).toContain("language: zh-CN");
    expect(prompt).toContain("StoryboardSegment");
    expect(prompt).toContain("ArtBible");
    expect(prompt).toContain('"optimized_prompt"');
    expect(prompt).toContain("保留角色名和稳定身份特征");
    expect(prompt).toContain("优先使用 `identity_description`");
    expect(prompt).toContain("缺少该字段时");
    expect(prompt).toContain("语义区分稳定身份与场景造型");
    expect(prompt).toContain("修正旧锚点中与当前分镜冲突的服饰、冠帽或兵器");
    expect(prompt).toContain("不得把定妆图服装当作跨镜制服");
    expect(prompt).not.toContain("必须保留其内容和角色名");
  });
});
