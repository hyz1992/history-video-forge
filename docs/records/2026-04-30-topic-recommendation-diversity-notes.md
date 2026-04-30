# 2026-04-30 Topic Recommendation Diversity Notes

## 目的

记录 `builder 候选池 + selector 最终选择 + 单次 repair` 链路在仓库内的最小可观测性落点，方便后续人工巡检和 UI acceptance 对照。

## 关注点

- builder 是否先产出 `8` 个原始候选
- selector 是否从 `selector_pool` 中选择最终 `3` 个
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

- `01-topic.candidate-builder.md` 中能看到 recommendation seed 和原始候选池。
- `02-topic.selector.md` 中能看到 `selector_pool`，若触发 repair，还应看到 `repair_context`。
- `recommendation-diagnostics.md` 中若发生补位，应能看到 `topic_selector_repair_triggered`。

## UI Acceptance 钩子

- `topic-recommendation-diagnostics`
- `topic-selector-diagnostics`

两者都应保持可审查；前者强调候选与下游 trace 可追踪，后者强调 selector 阶段本身的诊断入口没有丢失。
