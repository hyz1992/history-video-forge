import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// 仅验证正式 prompt 的输入/输出合同与规则存在，不代表真实 LLM 或出图质量已通过。
describe("稳定角色身份的正式 prompt 合同", () => {
  it("全局身份只描述主叙事时点的稳定身体特征，造型参考不编排镜头身体状态与动作", () => {
    const prompt = readFileSync(new URL("../../../prompts/asset-planning/asset-planner.prompt.md", import.meta.url), "utf8");
    expect(prompt).toContain("- `identity_description` 必须非空，只描述跨镜稳定的年龄区间、脸型、五官和体型");
    expect(prompt).toContain("神态、姿态、气质与能力不写入 `identity_description`");
    expect(prompt).toContain("气质可作为整体造型参考");
    expect(prompt).toContain("- `visual_description` 保留为整体视觉与场景造型参考");
    expect(prompt).toContain("可描述服饰、气质和整体造型");
    expect(prompt).toContain("不编排具体镜头的身体状态、姿态或动作");
    expect(prompt).not.toContain("如需描述可放入 `visual_description`");
    expect(prompt).toContain("不把它当作所有镜头的固定造型");
    expect(prompt).toContain("先依据 `script_text` 的主叙事时点确定年龄阶段");
    expect(prompt).toContain("不得套用人物其他时期的年龄");
    expect(prompt).toContain("无法可靠确认精确年龄时，只写宽年龄阶段，不猜具体数字");
    expect(prompt).toContain("version: v1.10.0");
    expect(prompt).toContain("language: zh-CN");
    expect(prompt).toContain("ProjectArtBible");
    expect(prompt).toContain("`identity_description`");
    expect(prompt).toContain("跨镜稳定的年龄区间、脸型、五官和体型");
    expect(prompt).toContain("不包含服饰、冠帽、兵器、动作或背景");
  });

  it("身体与动作时序直接沿用分镜，全局只延续衣物、携带关系和物件状态", () => {
    const prompt = readFileSync(new URL("../../../prompts/asset-planning/asset-planner.prompt.md", import.meta.url), "utf8");
    expect(prompt).toContain("在顶层 `art_bible.consistency_notes` 中，按实际分镜 ID 或连续 ID 范围写少量状态安排");
    expect(prompt).toContain("身体状态、姿态、动作及事件先后直接由已确认分镜提供");
    expect(prompt).toContain("全局各字段不逐镜重述或重新安排");
    expect(prompt).toContain("只说明服装使用痕迹、携带关系和物件状态");
    expect(prompt).toContain("何时保持、何时因已确认事件变化，以及变化后仍须保留什么");
    expect(prompt).toContain("恢复或休整期间，没有已确认换衣、清洗或更换事件，不得清除此前已有积尘、磨损或负载");
    expect(prompt).toContain("不重新推导身体恢复程度");
    expect(prompt).toContain("无服饰或负载变化时不强加脏污或磨损");
    expect(prompt).not.toContain("服装使用痕迹、身体状态、携带物及其相对位置");
    expect(prompt).not.toContain("恢复或休整须分别写出身体变化项");
    expect(prompt).not.toContain("好转程度以已确认事件为准");
    expect(prompt).toContain("必须按人物处境判断是否需要普通行装");
    expect(prompt).toContain("需要时写入现有 `props` 并说明形态");
    expect(prompt).toContain("对需持续携带的物件（包括原剧情已有物件），须选定唯一基准承载关系");
    expect(prompt).toContain("写清承载者和具体位置，不并列给出任选位置");
    expect(prompt).toContain("在状态安排中按分镜 ID 写明取用等已确认动作的携带变化及动作后是否归位");
    expect(prompt).toContain("物件持续存在不等于每镜可见");
    expect(prompt).toContain("局部近景只呈现合理入画部分，不为展示行装破坏构图");
    expect(prompt).toContain("不需要时在 `manual_review_notes` 说明理由");
    expect(prompt).toContain("原剧情核心道具不能代替普通行装需求判断");
    expect(prompt).toContain("不得新增关键道具、具体装备数量或新剧情");
    expect(prompt).toContain("史料未证的普通合理视觉推断写入 `manual_review_notes`，说明推断边界，不冒充事实");
    expect(prompt).toContain("衣物与物件状态以 `script_text` 和已确认分镜为准；冲突写入 `manual_review_notes` 报告，不回改上游");
    expect(prompt).toContain("动态状态不写入 `identity_description` 或覆盖全片的 `global_prompt_prefix`");
  });

  it("分段规划消费当前状态并保留可见衣冠器物、原动作瞬间、多人职责与稳定身份", () => {
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
    expect.soft(prompt).toContain("version: v1.8.0");
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
    expect.soft(prompt).toContain("身体状态、姿态、动作及事件先后来自当前分镜的 `scene_description`、`visual_intent` 和 `script_excerpt`");
    expect.soft(prompt).toContain("按当前 `segment_id` 消费顶层 `art_bible.consistency_notes`，只补充适用的服装使用痕迹、携带关系和物件状态");
    expect.soft(prompt).toContain("在 `image_prompt` 中写出本镜可见的关键状态证据，以两三项为宜，不机械凑数");
    expect.soft(prompt).toContain("局部特写只写合理入画的证据，不为展示全部道具破坏构图");
    expect.soft(prompt).toContain("镜内有已确认变化时，静态锚点取能承接该变化的起始瞬间");
    expect.soft(prompt).toContain("`video_prompt` 与 `video_prompt_reserve` 从同镜锚点按镜内已确认先后展开变化及动作路径");
    expect.soft(prompt).toContain("不从后状态倒播，不倒推补前情，不丢失已确认转折，不新增状态转折或后镜结果");
    expect.soft(prompt).toContain("延续同镜锚点的服装和负载关系，不让衣物或负载突然恢复整洁");
    expect.soft(prompt).toContain("状态安排缺省时，沿用当前分镜与适用的造型参考");
    expect.soft(prompt).toContain("与分镜当前事件冲突时，以分镜当前事件为准，在 `risk_notes` 报告，不改剧情");
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
