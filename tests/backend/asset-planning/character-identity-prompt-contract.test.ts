import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// 仅验证正式 prompt 的输入/输出合同与规则存在，不代表真实 LLM 或出图质量已通过。
describe("稳定角色身份的正式 prompt 合同", () => {
  it("全局身份按脚本主叙事时点确定年龄阶段，无法可靠确认时不猜具体年龄", () => {
    const prompt = readFileSync(new URL("../../../prompts/asset-planning/asset-planner.prompt.md", import.meta.url), "utf8");
    expect(prompt).toContain("先依据 `script_text` 的主叙事时点确定年龄阶段");
    expect(prompt).toContain("不得套用人物其他时期的年龄");
    expect(prompt).toContain("无法可靠确认精确年龄时，只写宽年龄阶段，不猜具体数字");
    expect(prompt).toContain("version: v1.5.0");
    expect(prompt).toContain("language: zh-CN");
    expect(prompt).toContain("ProjectArtBible");
    expect(prompt).toContain("`identity_description`");
    expect(prompt).toContain("跨镜稳定的年龄区间、脸型、五官和体型");
    expect(prompt).toContain("不包含服饰、冠帽、兵器、动作或背景");
  });

  it("分段规划展开可见衣冠器物并保留原动作瞬间、多人职责与稳定身份", () => {
    const prompt = readFileSync(new URL("../../../prompts/asset-planning/segment-intent-planner.prompt.md", import.meta.url), "utf8");
    expect(prompt).toContain("在 `image_prompt` 中展开关键衣冠器物能画出的外形、结构和颜色");
    expect(prompt).toContain("不能只写名称、术语或数字");
    expect(prompt).toContain("将其定格为正在发生的可见瞬间");
    expect(prompt).toContain("保留原动作、动作主体及其与核心物件的相对关系");
    expect(prompt).toContain("不得把动作替换为泛化站姿");
    expect(prompt).toContain("多人镜中各角色的位置、动作和职责忠于原分镜");
    expect(prompt).toContain("明确各角色与核心物件的关系");
    expect(prompt).toContain("不因空位补出新的关键人物");
    expect(prompt).toContain("不得改写分镜或新增史实");
    expect(prompt).toContain("version: v1.5.0");
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
