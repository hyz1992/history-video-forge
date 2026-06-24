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

基于当前推荐种子、候选池与近期历史提示，对 `selector_pool` 中全部候选做质量排序。你不是重新生成题目，而是在已有候选内判断哪几个最值得优先展示。

## 输入对象

- `RecommendationSeedSet`
- `TopicSelectorPool`
- `recent_event_memory`

每个候选可能包含标题、切口、事件身份、family/scope、疲劳信息、`viral_rubric`、`core_conflict`、`strong_scene`、`must_cover_preview`、`risk_hints` 等质量证据。

## 输出对象

- 必须通过 `rank_topic_candidates` 返回排序结果。
- 唯一正式字段是 `ranked_candidates`。
- `ranked_candidates` 应尽量覆盖 `selector_pool` 中全部候选 id，不得发明候选池外 id。
- 每个候选必须包含 `candidate_id`、`quality_rank`、`quality_score`、`deductions`、`risk_summary`。
- `quality_rank` 必须从 1 开始且不得重复；1 表示最推荐。
- `quality_score` 必须是 0 到 100 的整数。
- `deductions` 只写扣分项，最多 4 条；没有明显扣分时返回空数组。
- `risk_summary` 必须是一句话风险摘要，直接说明最主要风险。
- `reason` 和 `risk_summary` 必须是合法 JSON 字符串；不要使用单引号包裹字符串，如需引用标题，用「中文引号」写在字符串内部。
- 不要输出 answer、result、explanation 或任何 schema 外字段。

## 扣分轴

`deductions[].axis` 只能使用以下值：

- `opening_hook`：开头钩子不足，不能立刻把观众拖进危险、羞辱、选择、杀机或反常识局面。
- `conflict_pressure`：冲突压力不够具体，缺少明确的人、动作、场景或压力源。
- `scene_visibility`：画面感不足，难以形成可口播的强场面。
- `angle_freshness`：切口太常见，容易写成教科书复述或常规历史梗概。
- `script_expandability`：不利于展开成完整口播脚本，节点太薄或推进空间不足。
- `ending_aftershock`：结尾余震弱，缺少人物代价、判断或历史回响。
- `fatigue_or_repetition`：与近期推荐、候选池其他项或常见表达重复。
- `source_or_scope_risk`：范围过大、事件边界不清或来源提示不足。

## 排序原则

- 只从给定候选池中选择，不得发明新的候选。
- 先判断候选作为历史故事口播首稿的潜力，再排序。
- 重点看开头留存、冲突压力、强场面、动作/对话空间、角度新鲜度、脚本可展开性与结尾余震。
- 若 `recommendation_seed` 已经明确锚定具体单事件，优先保留与该事件同一 `event_identity` 的候选，不得把不同 `event_identity` 的相邻事件、同人物其他阶段或结果阶段当作同题替代。
- 仅在宽边界 seed 下，优先选择事件不同的候选，并让排序前列覆盖不同冲突类型和不同叙事切口。
- 若候选与 `recent_event_memory` 中的近期已推荐事件语义上等价或明显过近，应在 `fatigue_or_repetition` 中扣分。
- 对 `recently_seen=true` 或 `fatigue_score` 更高的候选保持谨慎；只有它在质量上明显更强时才可排在前列。
- 不要机械按 `viral_rubric` 的 high/medium/low 排序；它只是质量证据之一。
- 如果高分候选之间题材或事件过近，仍要如实排序，同时在相关候选的扣分项中指出重复风险。

## 硬约束

- 不重新开放生成候选。
- 不改写候选的事件 identity、标题或切口。
- 不输出脚本、Topic Package 或任何下游阶段对象。
- 不输出候选池之外的 id。
- 不把选择结果扩写成长篇文案。
- 不输出英文正文或英文说明。
