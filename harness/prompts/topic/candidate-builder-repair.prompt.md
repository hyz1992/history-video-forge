---
id: topic.candidate-builder-repair
stage: topic
language: zh-CN
consumes:
  - RecommendationSeedSet
  - recent_event_memory
  - raw_builder_candidates
  - missing_fields_by_candidate
produces:
  - TopicCandidateCard[]
status: active
---

# 任务

你只负责补齐 builder 首轮候选里缺失的正式字段，使其满足 `TopicCandidateCard` 最小合同。

## 输入对象

- `RecommendationSeedSet`
- `recent_event_memory`
- `raw_builder_candidates`
- `missing_fields_by_candidate`

## 输出对象

- 输出补齐后的 `TopicCandidateCard[]`
- 只补齐缺失字段
- 不得新增候选
- 不得删除候选
- 不得改写已有 `event_identity`
- 不得重写已经完整的字段

## 处理原则

- 只根据当前推荐种子、近期事件记忆与原始候选上下文补齐缺失字段
- 每个候选都必须完整给出 `TopicCandidateCard` 最小字段
- 如果补齐 `must_cover_preview`，必须写成 3 条可交给脚本审计的叙事节点，不是正文句；优先写成场景、动作或转折短语，不写解释性评价或完整总结句。
- `core_conflict` 补齐时写具体人物+对抗力量+明确赌注，不能写成朝代级抽象概括
- `strong_scene` 补齐时写可视觉化的具体画面
- `risk_hints` 补齐时至少给出 1 条具体风险，若无显式风险填 `["暂无显式风险提醒"]`
- `source_hint` 补齐时优先写具体信源，事件来源不明时填 `"基于历史共识推定"`
- `recent_usage_hint` 补齐时如实反映 `recent_event_memory` 中的使用密度，无记录填 `"近期未使用"`
- `estimated_duration_band` 补齐时使用 short/medium/long
- 若多个候选原本属于不同事件，必须保持这种区分，不得补齐后合并成同一事件
- 若原始候选已给出 `viral_rubric`，仅在字段缺失或类型不合法时补齐，不要重写已有合法值

## 硬约束

- 不重开候选发现
- 不重新挑选原始 8 候选
- 不发明新的事件
- 不输出候选池之外的对象
- 不输出脚本、Topic Package 或任何下游阶段对象

## 禁止事项

- 不得新增候选
- 不得改写已有 `event_identity`
- 不得把本任务偷换成重新推荐题目
- 不输出英文正文或英文说明
