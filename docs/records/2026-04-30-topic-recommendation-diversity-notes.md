# 2026-04-30 Topic Recommendation Diversity Notes

## 目的

记录 `builder 候选池 + selector 最终选择 + 单次 repair + event_identity + recent_event_memory` 链路在仓库内的最小可观测性落点，方便后续人工巡检和 UI acceptance 对照。

## 关注点

- builder 是否先产出 `8` 个原始候选池
- builder 产出的每个候选是否显式带有 `event_identity`
- builder 在遇到近期已出现过的同一事件时，是否复用了已有 `event_identity`
- selector 是否只从 `selector_pool` 中选择最终 `3` 个候选
- selector 输入里是否显式带有 `recent_event_memory`
- selector repair 是否最多只触发一次
- 运行日志是否能同时定位 builder / selector / diagnostics

## 定位步骤

1. 先运行：

```bash
npm run harness:ui-acceptance:smoke
```

2. 从 `summary.json` 取出：
   - `run_id`
   - `project.project_id`

3. 按 `harness/README.md` 中的 `project_id -> short_id -> storage/projects 递归搜索` 规则找到 topic run 目录。

4. 在 `<project-root>/trace/topic-runs/<topic_run_id>/` 重点检查：
   - `llm-interactions/01-topic.candidate-builder.md`
   - `llm-interactions/02-topic.selector.md`
   - `recommendation-diagnostics.md`

## 当前预期

- `01-topic.candidate-builder.md` 中能看到 recommendation seed、`recent_event_memory`、原始候选池，以及每个候选的 `event_identity`
- 抽查 `01-topic.candidate-builder.md` 时，要检查 builder 是否复用了近期 identity，而不是把同一事件重新发明成新 key
- `02-topic.selector.md` 中能看到 `selector_pool` 和 `recent_event_memory`
- 若触发 repair，`02-topic.selector.md` 中还能看到 `repair_context`
- `recommendation-diagnostics.md` 中应能看到：
  - `selector_pool`
  - 最终 `candidates`
  - 每项候选对应的 `event_identity`
  - 若发生补位，则出现 `topic_selector_repair_triggered`

## UI Acceptance 钩子

- `topic-recommendation-diagnostics`
- `topic-selector-diagnostics`

两者都应保持可审查；前者强调候选、事件标识与下游 trace 可追踪，后者强调 selector 阶段的输入上下文没有丢失。
