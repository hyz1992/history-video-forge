---
id: topic.selector
stage: topic
language: zh-CN
consumes:
  - RecommendationSeedSet
  - TopicSelectorPool
  - RecentEventMemory
produces:
  - TopicSelectorDecision
status: active
---

# 任务

基于推荐种子、`selector_pool` 与 `recent_event_memory`，对已有候选做质量排序。只从给定候选池中选择，不得发明新的候选、改写候选或生成下游对象。

每个候选提供事件身份、标题、切口、family/scope、`core_conflict`、`strong_scene`、`must_cover_preview`、`risk_hints` 与 `fatigue_score` 等判断证据。

## 输出合同

- 必须通过 `rank_topic_candidates` 返回 `ranked_candidates` 与 `consistency_risk_notes`，不得返回其他顶层字段。
- `ranked_candidates` 必须且只能覆盖 `selector_pool` 中全部候选 id，不得遗漏、重复或发明候选池外 id。
- 每项必须包含 `candidate_id`、`quality_rank`、`quality_score`、`deductions`、`risk_summary`、`consistency_issue`。
- `quality_rank` 必须形成完整且不重复的 1..N；`quality_score` 必须是 0 到 100 的整数。
- `deductions` 只写扣分项，schema 仍兼容最多 4 条，但通常只保留最重要的 0–2 条；无明显扣分时返回空数组。`reason` 直接指出扣分点，不复述候选全文。
- `risk_summary` 必须是一句话风险摘要，只总结首要风险，不重复全部 deductions；无明显风险时使用简短说明。
- `reason`、`risk_summary` 和 note 必须是合法 JSON 字符串。不要使用单引号包裹字符串。
- 不要输出 answer、result、explanation 或任何 schema 外字段。

## 一致性结论

- 每项只用 `consistency_issue` 表示一致性结论，只能是 `none`、`actor_role_mismatch`、`action_event_mismatch`、`cause_outcome_mismatch`、`scope_boundary_mismatch`、`language_contamination`、`overclaim_or_ambiguity`。
- 顶层 `consistency_risk_notes` 只收录非 `none` 候选的 `{candidate_id, note}`；全部为 `none` 时返回空数组。
- `consistency_issue=none` 的候选不得写 note；每个非 `none` 候选必须且只能写一条 note，简短指出内部冲突依据，不复述全文。
- 非 `none` 只用于候选内部的角色/动作/因果错配、时代或事件边界越界、正式中文内容的外语污染，或足以误导“谁做了什么、谁承担结果”的歧义与过度断言。
- 不得使用非 `none` 结论表达一般史源争议；候选内部一致但史料存在争议时，继续写入 `deductions` 或 `risk_summary`。
- `none` 不代表完成史实核查或达到发布线。

## 扣分轴

`deductions[].axis` 只能使用：

- `opening_hook`：开头不能立刻把观众拖进危险、羞辱、选择或反常识局面。
- `conflict_pressure`：缺少明确人物、动作、场景、压力源或赌注。
- `scene_visibility`：画面感不足，难以形成可口播的强场面。
- `angle_freshness`：切口常见，容易写成教科书复述。
- `script_expandability`：节点太薄，难以展开完整口播脚本。
- `ending_aftershock`：缺少人物代价、判断或历史回响。
- `fatigue_or_repetition`：与近期推荐、候选池其他项或常见表达重复。
- `source_or_scope_risk`：事件边界、主体、动作、因果、结果或来源可信度存在风险。

## 判断顺序

1. 先按事件身份、行为主体、关键动作、因果结果完成一致性检查，横向核对 `title`、`one_line_angle`、`core_conflict`、`strong_scene` 与 `must_cover_preview`，并区分决策者、执行者、受害者和结果承担者。特别核对断言强度：标题或切口不得把内部证据只支持的失败、受创或格局逆转，升级为更强的确定性终局；明显超出证据时标记 `overclaim_or_ambiguity` 或 `cause_outcome_mismatch`。
2. 再判断开头留存、冲突压力、场景可视性、切口新鲜度、脚本可展开性、结尾余震与疲劳重复。
3. 主体、动作、因果关系或结果明确冲突时，必须使用 `source_or_scope_risk` 扣分并说明；当候选池至少有 4 个无明显冲突候选时，冲突候选原则上不得进入前 4。
4. 这里只检查候选内部是否互相支持，不能替代正式史实核查；只做排序与风险说明，不得改写候选。

## 边界与多样性

- 若 `recommendation_seed` 已经明确锚定具体单事件，优先保留与该事件同一 `event_identity` 的候选，不得把不同 `event_identity` 的相邻事件、同人物其他阶段或结果阶段当作同题替代。
- 仅在宽边界 seed 下，优先选择事件不同的候选，并让排序前列覆盖不同冲突类型与叙事切口。
- 若候选与 `recent_event_memory` 中的近期已推荐事件语义上等价或明显过近，使用 `fatigue_or_repetition` 扣分；`fatigue_score` 越高越应谨慎。
- 高分候选彼此过近时仍要如实排序，同时指出重复风险。

## 硬约束

- 不重新开放生成，不输出候选池外 id。
- 不改写事件 identity、标题或切口，不输出脚本、Topic Package 或其他下游对象。
- 不把排序扩写成长篇文案，不输出英文正文或说明。
