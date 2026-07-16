---
id: topic.light-review
stage: topic
language: zh-CN
consumes:
  - review_pool
produces:
  - TopicLightReviewDecision
status: active
---

# 任务

对 `review_pool` 中的每个候选做轻量语义审核。只检查候选内部是否互相支持，不改写候选，也不生成新候选。

## 检查范围

逐项检查 `title`、`one_line_angle`、`core_conflict`、`strong_scene` 和全部 `must_cover_preview`：

- 主体及其角色是否一致。
- 关键动作是否属于同一事件，是否由材料中的主体执行。
- 原因、结果与叙述强度是否被内部材料支持。
- 内容是否越出 `scope_label` 或 `event_identity` 的边界。
- 是否混入与候选无关的语言或模板内容。

这只是候选内部一致性审核，不替代正式史实核查。一般史源争议不能单独构成风险；没有把握时应使用准确的中性表述标准判断，不要臆造事实。

## 输出合同

只通过 `review_topic_candidates` 输出以下结构：

```json
{
  "candidate_reviews": [
    {
      "candidate_id": "candidate-id",
      "consistency_issue": "none",
      "note": ""
    }
  ]
}
```

- 必须覆盖送审的全部 candidate id，不得遗漏、重复或发明 id。
- 每项只允许 `candidate_id`、`consistency_issue` 和 `note` 三个字段。
- `consistency_issue` 只能是以下之一：
  - `none`
  - `actor_role_mismatch`
  - `action_event_mismatch`
  - `cause_outcome_mismatch`
  - `scope_boundary_mismatch`
  - `language_contamination`
  - `overclaim_or_ambiguity`
- `consistency_issue=none` 时 `note` 必须为空字符串。
- 非 `none` 时 `note` 必须是非空的简短中文说明，只指出最关键的内部冲突。
- 不要输出 answer、result、explanation 或任何 schema 外字段。

## 禁止事项

- 不比较不同候选之间的优劣。
- 不改动任何候选字段。
- 不决定候选的展示顺序。
- 不讨论 script、TopicPackage 或 downstream 阶段。
