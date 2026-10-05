import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// 仅验证正式 prompt 的输入/输出合同与规则存在，不代表真实 LLM 或出图质量已通过。
describe("稳定角色身份的正式 prompt 合同", () => {
  it("全局身份只描述主叙事时点的稳定身体特征，并与神态、姿态、气质和能力分工", () => {
    const prompt = readFileSync(new URL("../../../prompts/asset-planning/asset-planner.prompt.md", import.meta.url), "utf8");
    expect(prompt).toContain("- `identity_description` 必须非空，只描述跨镜稳定的年龄区间、脸型、五官和体型");
    expect(prompt).toContain("神态、姿态、气质与能力不写入 `identity_description`，如需描述可放入 `visual_description`");
    expect(prompt).toContain("- `visual_description` 保留为整体视觉与场景造型参考");
    expect(prompt).toContain("不把它当作所有镜头的固定造型");
    expect(prompt).toContain("先依据 `script_text` 的主叙事时点确定年龄阶段");
    expect(prompt).toContain("不得套用人物其他时期的年龄");
    expect(prompt).toContain("无法可靠确认精确年龄时，只写宽年龄阶段，不猜具体数字");
    expect(prompt).toContain("version: v1.7.0");
    expect(prompt).toContain("language: zh-CN");
    expect(prompt).toContain("ProjectArtBible");
    expect(prompt).toContain("`identity_description`");
    expect(prompt).toContain("跨镜稳定的年龄区间、脸型、五官和体型");
    expect(prompt).toContain("不包含服饰、冠帽、兵器、动作或背景");
  });

  it("全局状态按实际分镜安排连续性，普通负载推断可审阅且不污染稳定身份", () => {
    const prompt = readFileSync(new URL("../../../prompts/asset-planning/asset-planner.prompt.md", import.meta.url), "utf8");
    expect(prompt).toContain("在顶层 `art_bible.consistency_notes` 中，按实际分镜 ID 或连续 ID 范围写少量状态安排");
    expect(prompt).toContain("服装使用痕迹、身体状态、携带物及其相对位置");
    expect(prompt).toContain("何时保持、何时因已确认事件变化，以及变化后仍须保留什么");
    expect(prompt).toContain("无状态变化时不强加脏污、困顿或磨损");
    expect(prompt).toContain("必要的普通场景负载可写入现有 `props`，明确形态、承载方式及与人物的持续关系");
    expect(prompt).toContain("不得新增关键道具、具体装备数量或新剧情");
    expect(prompt).toContain("史料未证的普通合理视觉推断写入 `manual_review_notes`，说明推断边界，不冒充事实");
    expect(prompt).toContain("状态以 `script_text` 和已确认分镜为准；冲突写入 `manual_review_notes` 报告，不回改上游");
    expect(prompt).toContain("动态状态不写入 `identity_description` 或覆盖全片的 `global_prompt_prefix`");
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
    expect(prompt).toContain("version: v1.6.0");
    expect(prompt).toContain("language: zh-CN");
    expect(prompt).toContain("SegmentIntentPlannerInput");
    expect(prompt).toContain("SegmentAssetIntentBatchDraft");
    expect(prompt).toContain("`identity_description`");
    expect(prompt).toContain("年龄区间、脸型、五官、体型");
    expect(prompt).toContain("当前 `StoryboardSegment`");
    expect(prompt).toContain("服饰、冠帽、兵器、动作和场景");
    expect(prompt).toContain("参考图只负责身份");
    expect(prompt).toContain("不得把定妆图服装当作跨镜制服");
    expect(prompt).toContain("逐个写明入镜角色（尤其主角）的当前场景服饰");
    expect(prompt).toContain("不得只写背景人物的衣着");
    expect(prompt).toContain("分镜未明写时，结合其叙事功能与 `visual_description` 中适用的造型补足");
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
