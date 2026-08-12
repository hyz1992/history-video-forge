# 当前计划入口

## 用途与边界

- `docs/plans/` 根目录只放准备执行、执行中或刚完成待收口的中文设计文档与 implementation plan。
- 任务完成、被正式文档吸收或失去当前执行资格后，相关计划应移入 `docs/plans/archive/`。
- `archive/` 只保存历史设计、实施过程和验收证据，不是当前任务入口，也不能作为后续任务的续跑清单。

## 当前状态

截至 2026-08-12：

- `S2-2` 已完成用户需求澄清与总体方案批准，当前设计入口为 [S2-2 总体设计](./2026-08-12-s2-2-generation-configuration-overall-design.md)，第一棒详细设计入口为 [S2-2A 配置与成本基础详细设计](./2026-08-12-s2-2a-configuration-cost-foundation-design.md)。
- 2026-08-11 已完成 `docs/plans/` 根目录历史计划归档；根目录现在只保留本 README 与当前已获批准、准备执行的 S2-2 文档。
- 本轮计划状态治理的[设计](./archive/2026-08-11-plan-state-governance-closeout-design.md)与[实施计划](./archive/2026-08-11-plan-state-governance-closeout-implementation-plan.md)也已归入历史证据区。

## Asset Planning 验证边界

- `intent_compiler` 已通过 15 分镜 `5/5` 个有效轮次和 21 分镜 `2/2` 个轮次；默认生成模式已切换为 `intent_compiler`，并保留显式 `legacy` 回滚。完整证据见[最近一次 Asset Planning live 记录](../records/2026-08-10-asset-planning-intent-compiler-live-check.md)。
- 上述 7 个有效轮次运行的是包含 global normalization/repair 的当前代码，但都走正常路径：`global_structure_normalization_event_count=0`，`global_structural_repair_used=false`。
- 因此，现有 live 证据只证明 global 正常路径与 `intent_compiler` 兼容；global normalization 与 structural repair 的异常恢复分支只有 non-live 证据，尚未在 live 中实际触发。
- 不为补齐该异常分支证据自动重跑付费 provider；如需 live 复验，必须另行明确授权并记录成本与输出。

## 当前推荐顺序

1. 用户已基本完成前端 v1 六步工作区验收，并于 2026-08-12 批准启动 `S2-2`。
2. 当前按 `S2-2A 配置与成本基础 -> S2-2B 创作偏好 -> S2-2C Provider/Model 高级选择` 连续推进；每一棒单独设计、实施、验证和提交。
3. 当前只执行 S2-2A；B/C 的详细设计与实施计划在前一棒验收后按当日状态新建，不从历史草案续跑。

## 新任务启动规则

- `S2-2`、重要功能、重要质量优化，或用户明确要求正式设计的任务，必须以 [AGENTS.md](../../AGENTS.md)、[项目文档入口](../README.md)、正式架构、当前代码和真实验证结果为依据。
- 上述任务启动前必须按当日日期新建中文 design 与 implementation plan，完成验证后及时归档；普通低风险任务不强制新增设计文档或实施计划。
- 不得从 `archive/` 中挑选旧草案继续执行。历史计划与当前事实冲突时，以正式入口、当前代码、接口和真实验证结果为准。

## 正式入口与历史追溯

- [Agent 工作契约](../../AGENTS.md)
- [项目文档入口](../README.md)
- [正式架构入口：Pipeline IO 规范](../architecture/pipeline-io-spec.md)
- [正式架构入口：Downstream 阶段高层设计](../architecture/downstream-stage-high-level-design.md)
- [Runtime Harness 与验收入口](../../harness/README.md)
- [当前 Roadmap](../todos/roadmap-todo.md)
- [最近一次 Asset Planning live 记录](../records/2026-08-10-asset-planning-intent-compiler-live-check.md)
- [历史计划归档](./archive/)：仅用于追溯当时的设计、实施和验收证据，不代表当前优先级或执行授权。
