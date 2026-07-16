import { describe, expect, it } from "vitest";

import { createPromptRegistry } from "../../../backend/src/runtime/prompts/prompt-registry.js";

describe("topic prompt contract", () => {
  it("registers a zh-CN topic.selector prompt dedicated to final diversity selection", () => {
    const prompt = createPromptRegistry().getPrompt("topic.selector");

    expect(prompt.metadata.language).toBe("zh-CN");
    expect(prompt.body).toContain("只从给定候选池中选择");
  });

  it("keeps selector responsibilities separate from builder responsibilities", () => {
    const prompt = createPromptRegistry().getPrompt("topic.selector");

    expect(prompt.body).toContain("不得发明新的候选");
    expect(prompt.body).toContain("优先选择事件不同的候选");
  });

  it("requires candidate-builder to generate a larger raw candidate pool", () => {
    const prompt = createPromptRegistry().getPrompt("topic.candidate-builder");

    expect(prompt.body).toContain("输出 8 个候选");
  });

  it("requires candidate-builder to define stable event_identity naming rules", () => {
    const prompt = createPromptRegistry().getPrompt("topic.candidate-builder");

    expect(prompt.body).toContain("必须使用中文");
    expect(prompt.body).toContain("非必要不带年份");
    expect(prompt.body).toContain(
      "不得把包装文案、角度句式或脚本化表达写进 `event_identity`",
    );
  });

  it("requires candidate-builder to consume recent_event_memory", () => {
    const prompt = createPromptRegistry().getPrompt("topic.candidate-builder");

    expect(prompt.body).toContain("recent_event_memory");
  });

  it("requires candidate-builder to define a strict structured output contract", () => {
    const prompt = createPromptRegistry().getPrompt("topic.candidate-builder");

    expect(prompt.body).toContain("不得包 `TopicCandidateCard` 外层对象");
    expect(prompt.body).toContain("`viral_rubric` 只有五个正式字段");
    expect(prompt.body).toContain("`viral_rubric` 不得自定义额外评分键");
  });

  it("requires candidate-builder must_cover_preview to carry auditable narrative nodes", () => {
    const prompt = createPromptRegistry().getPrompt("topic.candidate-builder");

    expect(prompt.metadata.language).toBe("zh-CN");
    expect(prompt.body).toContain(
      "`must_cover_preview` 必须给出 3 条可交给脚本审计的叙事节点",
    );
    expect(prompt.body).toContain("进入局面、关键动作、压力/代价");
    expect(prompt.body).toContain("不得把同一句角度摘要改写三遍");
    expect(prompt.body).not.toContain("可写入脚本的具体 beat");
  });

  it("requires candidate-builder must_cover_preview to be beat nodes instead of prose sentences", () => {
    const prompt = createPromptRegistry().getPrompt("topic.candidate-builder");

    expect(prompt.metadata.language).toBe("zh-CN");
    expect(prompt.body).toContain("`must_cover_preview` 是叙事节点，不是正文句");
    expect(prompt.body).toContain("优先写成场景、动作或转折短语");
    expect(prompt.body).toContain("不写解释性评价或完整总结句");
    expect(prompt.body).toContain("名句可以作为节点锚点，但不要附带完整解释");
  });

  it("requires candidate-builder angles to be closed by preview beats", () => {
    const prompt = createPromptRegistry().getPrompt("topic.candidate-builder");

    expect(prompt.metadata.language).toBe("zh-CN");
    expect(prompt.body).toContain("`one_line_angle` 必须被三条 `must_cover_preview` 共同支撑");
    expect(prompt.body).toContain("不得为了锋利感新增 preview 无法兑现的压力点");
    expect(prompt.body).toContain("三条 preview 不得只是同一句角度摘要的改写");
  });

  it("requires candidate-builder to prioritize first-pass field completeness ahead of diversity tactics", () => {
    const prompt = createPromptRegistry().getPrompt("topic.candidate-builder");

    expect(prompt.body).toContain("首轮输出的第一优先级");
    expect(prompt.body).toContain("先完整交付字段");
  });

  it("requires candidate-builder to include a short pre-output field checklist", () => {
    const prompt = createPromptRegistry().getPrompt("topic.candidate-builder");

    expect(prompt.body).toContain("## 输出前自检");
    expect(prompt.body).toContain("title");
    expect(prompt.body).toContain("one_line_angle");
    expect(prompt.body).toContain("family_label");
    expect(prompt.body).toContain("scope_label");
  });

  it("gives candidate-builder concise soft budgets without creating local hard gates", () => {
    const prompt = createPromptRegistry().getPrompt("topic.candidate-builder");

    expect(prompt.metadata.language).toBe("zh-CN");
    expect(prompt.body).toContain("以下长度是生成偏好，不是硬性校验");
    expect(prompt.body).toContain("`title`：18–32 个汉字");
    expect(prompt.body).toContain("`core_conflict`：35–65 个汉字");
    expect(prompt.body).toContain("`strong_scene`：35–65 个汉字");
    expect(prompt.body).toContain("每条 22–42 个汉字");
    expect(prompt.body).toContain("为准确表达历史关系可以合理超出");
  });

  it("requires builder to self-check actor action cause and outcome consistency", () => {
    const prompt = createPromptRegistry().getPrompt("topic.candidate-builder");

    expect(prompt.body).toContain("事件身份、行为主体、关键动作、因果和结果");
    expect(prompt.body).toContain("决策者、执行者、受害者和最终受益者");
    expect(prompt.body).toContain("没有把握时使用准确的中性表达");
    expect(prompt.body).toContain("不得为了标题张力发明确定性动作");
  });

  it("requires candidate-builder to avoid letting recent high-frequency events dominate the raw pool", () => {
    const prompt = createPromptRegistry().getPrompt("topic.candidate-builder");

    expect(prompt.body).toContain("不要继续让这些近期高频事件占据原始 8 候选的大多数槽位");
    expect(prompt.body).toContain("朝代分布");
    expect(prompt.body).toContain("冲突类型");
    expect(prompt.body).toContain("叙事结构");
  });

  it("keeps concrete single-event seeds anchored to the same event instead of drifting to adjacent events", () => {
    const prompt = createPromptRegistry().getPrompt("topic.candidate-builder");

    expect(prompt.body).toContain("若 `RecommendationSeedSet` 已经明确锚定具体单事件");
    expect(prompt.body).toContain("原始 8 候选必须全部围绕同一 `event_identity` 展开");
    expect(prompt.body).toContain("不得改写成相邻事件、同人物其他阶段、制度时期标签或结果阶段标签");
  });

  it("demands concrete single-event recommendation topics instead of abstract buckets", () => {
    const prompt = createPromptRegistry().getPrompt("topic.candidate-builder");

    expect(prompt.metadata.language).toBe("zh-CN");
    expect(prompt.body).toContain("具体历史事件");
    expect(prompt.body).toContain("泛主题");
  });

  it("treats the selected era as a hard boundary instead of a soft hint", () => {
    const prompt = createPromptRegistry().getPrompt("topic.candidate-builder");

    expect(prompt.body).toContain("严格服从推荐种子给定的时代范围");
    expect(prompt.body).toContain("不得超出该时段");
    expect(prompt.body).toContain("先秦至两汉");
    expect(prompt.body).toContain("魏晋至唐宋");
    expect(prompt.body).toContain("元明清");
  });

  it("requires topic.selector prompt to consume recent_event_memory", () => {
    const prompt = createPromptRegistry().getPrompt("topic.selector");

    expect(prompt.body).toContain("recent_event_memory");
  });

  it("requires topic.selector to return a complete ranked candidate scorecard", () => {
    const prompt = createPromptRegistry().getPrompt("topic.selector");

    expect(prompt.body).toContain("`ranked_candidates` 应尽量覆盖 `selector_pool` 中全部候选 id");
    expect(prompt.body).toContain("`quality_rank` 必须从 1 开始且尽量不重复");
    expect(prompt.body).toContain("`quality_score` 必须是 0 到 100 的整数");
    expect(prompt.body).toContain("`deductions` 只写扣分项");
    expect(prompt.body).toContain("`risk_summary` 必须是一句话风险摘要");
  });

  it("makes internal semantic consistency the selector first pass", () => {
    const prompt = createPromptRegistry().getPrompt("topic.selector");

    expect(prompt.body).toContain("先按事件身份、行为主体、关键动作、因果结果完成一致性检查");
    expect(prompt.body).toContain("决策者、执行者、受害者和结果承担者");
    expect(prompt.body).toContain("至少有 4 个无明显冲突候选");
    expect(prompt.body).toContain("原则上不得进入前 4");
    expect(prompt.body).toContain("不能替代正式史实核查");
  });

  it("requires a compact semantic consistency verdict for every selector scorecard", () => {
    const prompt = createPromptRegistry().getPrompt("topic.selector");

    expect(prompt.body).toContain("`consistency_status` 只能是 `pass` 或 `risk`");
    expect(prompt.body).toContain("`primary_consistency_issue`");
    expect(prompt.body).toContain("actor_role_mismatch");
    expect(prompt.body).toContain("action_event_mismatch");
    expect(prompt.body).toContain("cause_outcome_mismatch");
    expect(prompt.body).toContain("scope_boundary_mismatch");
    expect(prompt.body).toContain("language_contamination");
    expect(prompt.body).toContain("overclaim_or_ambiguity");
    expect(prompt.body).toContain("`pass` 不代表完成史实核查");
    expect(prompt.body).toContain("不得使用 `risk` 表达一般史源争议");
    expect(prompt.body).toContain("`consistency_note` 只写一句简短中文依据");
  });

  it("keeps all-candidate ranking while making selector explanations concise", () => {
    const prompt = createPromptRegistry().getPrompt("topic.selector");

    expect(prompt.body).toContain("必须覆盖并排序全部候选");
    expect(prompt.body).toContain("通常只保留最重要的 0–2 条");
    expect(prompt.body).toContain("不复述候选全文");
    expect(prompt.body).toContain("只总结首要风险");
  });

  it("keeps topic.selector prompt aligned with tool-call structured output", () => {
    const prompt = createPromptRegistry().getPrompt("topic.selector");

    expect(prompt.metadata.language).toBe("zh-CN");
    expect(prompt.body).toContain("rank_topic_candidates");
    expect(prompt.body).toContain("ranked_candidates");
    expect(prompt.body).toContain(
      "不要输出 answer、result、explanation 或任何 schema 外字段",
    );
  });

  it("keeps topic.selector scorecard text JSON-safe for strict tool-call arguments", () => {
    const prompt = createPromptRegistry().getPrompt("topic.selector");

    expect(prompt.body).toContain("`reason` 和 `risk_summary` 必须是合法 JSON 字符串");
    expect(prompt.body).toContain("不要使用单引号包裹字符串");
  });

  it("does not invite topic.selector to attach explanations outside the schema", () => {
    const prompt = createPromptRegistry().getPrompt("topic.selector");

    expect(prompt.body).not.toContain("可附带极简选择说明");
    expect(prompt.body).not.toContain("解释选择理由");
  });

  it("keeps selector anchored when recommendation_seed already points to a concrete single event", () => {
    const prompt = createPromptRegistry().getPrompt("topic.selector");

    expect(prompt.body).toContain("若 `recommendation_seed` 已经明确锚定具体单事件");
    expect(prompt.body).toContain("优先保留与该事件同一 `event_identity` 的候选");
    expect(prompt.body).toContain("不得把不同 `event_identity` 的相邻事件、同人物其他阶段或结果阶段当作同题替代");
  });

  it("registers a zh-CN topic.candidate-builder-repair prompt dedicated to filling missing fields", () => {
    const prompt = createPromptRegistry().getPrompt("topic.candidate-builder-repair");

    expect(prompt.metadata.language).toBe("zh-CN");
    expect(prompt.body).toContain("只补齐缺失字段");
  });

  it("requires builder-repair to fill missing must_cover_preview as auditable narrative nodes", () => {
    const prompt = createPromptRegistry().getPrompt("topic.candidate-builder-repair");

    expect(prompt.metadata.language).toBe("zh-CN");
    expect(prompt.body).toContain("如果补齐 `must_cover_preview`");
    expect(prompt.body).toContain("可交给脚本审计的叙事节点");
    expect(prompt.body).toContain("不是正文句");
    expect(prompt.body).toContain("不写解释性评价或完整总结句");
  });

  it("keeps builder-repair from reopening candidate discovery or rewriting event_identity", () => {
    const prompt = createPromptRegistry().getPrompt("topic.candidate-builder-repair");

    expect(prompt.body).toContain("不得新增候选");
    expect(prompt.body).toContain("不得改写已有 `event_identity`");
    expect(prompt.body).toContain("不重开候选发现");
  });
});
