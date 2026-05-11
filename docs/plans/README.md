# Plans 状态说明

`docs/plans/` 根目录只用于放置当前仍准备执行、正在执行或刚完成等待收口的设计文档与 implementation plan。

已完成、已被正式架构文档吸收，或只具备历史追溯价值的计划，应移动到 `docs/plans/archive/`。

## 当前状态

截至 2026-05-10：

- `topic + script` 第一阶段已暂时冻结。
- `storyboard` 第一版已达到当前可用线，可作为 asset planning 的上游暂时冻结。
- 当前未归档计划：
  - [Storyboard Stage Design](./2026-05-09-storyboard-stage-design.md)
  - [Storyboard Stage Implementation Plan](./2026-05-09-storyboard-stage-implementation-plan.md)
  - [Asset Planning Stage Design](./2026-05-10-asset-planning-stage-design.md)
  - [Asset Planning Stage Implementation Plan](./2026-05-10-asset-planning-stage-implementation-plan.md)
  - [Asset Planning Design Guidelines](./2026-05-10-asset-planning-design-guidelines.md)（参考资料，不是 implementation plan）
  - [Asset Planning 质量护栏实施计划](./2026-05-11-asset-planning-quality-guardrails-plan.md)
  - [Asset Planning Chunk Concurrency Design](./2026-05-11-asset-planning-chunk-concurrency-design.md)
  - [Asset Planning Chunk Concurrency Implementation Plan](./2026-05-11-asset-planning-chunk-concurrency-implementation-plan.md)
- 既有 topic/script/harness/UI acceptance 计划已归档到 [archive/topic-script](./archive/topic-script/)。
- archive 中的计划只作为历史证据和追溯材料，不是当前任务入口。
- 新 agent 不应从 archive 中挑选旧 implementation plan 继续执行。

## 使用规则

- 当前任务入口优先看 `AGENTS.md`、[docs/README.md](../README.md)、正式架构文档和最新未归档计划。
- 如果 archive 计划与正式架构文档冲突，以正式架构文档为准。
- 如果需要重启 archive 中的某个方向，应先重新写当前日期的 design + implementation plan，而不是直接续跑旧计划。
- 新的视频流水线阶段计划应先放在 `docs/plans/` 根目录；完成并被正式文档吸收后再归档。

## 2026-05-11 Asset Planning v1 状态

- `asset planning` 第一版 design 与 implementation plan 已执行到后端最小实现完成，并已被正式架构、数据和 API 文档吸收。
- 当前仍保留未归档的 asset planning 计划文件，直到最终最小验证完成并确认是否归档。
- `assets` 与 `compose` 仍未进入可实施设计，不得从 asset planning 计划中顺手实现。
