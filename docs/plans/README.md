# 当前计划入口

## 用途与边界

- `docs/plans/` 根目录只放准备执行、执行中或刚完成待收口的中文设计文档与 implementation plan。
- 任务完成、被正式文档吸收或失去当前执行资格后，相关计划应移入 `docs/plans/archive/`。
- `archive/` 只保存历史设计、实施过程和验收证据，不是当前任务入口，也不能作为后续任务的续跑清单。

## 当前状态

截至 2026-09-05：

- `口播前置与真实时间轴`：已形成[设计及候选比较](./2026-09-05-narration-first-timing-design.md)和[实施计划](./2026-09-05-narration-first-timing-implementation-plan.md)，业务尚未实施。用户限定的三轮自审修复已结束，设计及计划终审通过，可开始任务 0 离线实施；共享音色/协议、三入口创建、真实持久化/偏好继承、字幕渲染直通及摘录绑定等闭环见[循环记录](../records/2026-09-05-narration-first-design-review-loops.md)。最终默认待明确预算的比较验收后选定，不把官方能力或文档通过当作项目实测结论。
- 本需求下一步以新计划任务 0 为入口；下方 S2-2 顺序为历史项目状态，不作为本次口播改造执行指令。环境音效不在本次范围。

截至 2026-08-23：

- `S2-2 报价体系移除与项目费用清单`（2026-08-23）：按用户反馈移除整套报价/授权体系（409 付费闸门、quote 全链路、预算门禁、超额授权、确认弹窗、`pricing_overrun`），生成面板全部恢复直连；资产生成手动入口保留前端预估费用确认；新增项目费用清单面板（跨阶段共用、默认收起、按阶段分组展示消费明细与规格）；辅助 LLM/媒体入口恢复直连但不记账（登记已知限制）。变更设计见 [变更设计](./2026-08-23-s2-2-quote-removal-design.md)。该变更覆盖/取代 S2-2A 的报价与预算部分与 S2-2D 的报价流程（S2-2A 详细设计仍为配置/快照/记账部分的依据）。

截至 2026-08-20：

- `S2-2A 配置与成本基础` 已全部完成并通过终审（任务 1-12；用户/项目配置、目录与报价、幂等付费运行、媒体/LLM 闸门与费用账本、设置 UI、报价确认/严格 fallback/成本明细、文档收口与 e2e/浏览器验收），外部审查整改闭环见 `docs/records/2026-08-21-s2-2a-external-review-remediation-record.md`。设计文档为 [S2-2A 详细设计](./2026-08-12-s2-2a-configuration-cost-foundation-design.md)，实施计划为 [S2-2A 实施计划](./2026-08-12-s2-2a-configuration-cost-foundation-implementation-plan.md)，任务审查记录见 `docs/records/2026-08-20-s2-2a-task*.md`。
- `S2-2B 创作偏好` 已完成（2026-08-21）：设计文档为 [S2-2B 详细设计](./archive/2026-08-21-s2-2b-creative-preferences-design.md)（含外部审查整改回改），实施计划为 [S2-2B 实施计划](./archive/2026-08-21-s2-2b-creative-preferences-implementation-plan.md)；实施共 10 个低耦合任务全部完成并独立中文提交。收口后两份计划文档按归档规则移入 `docs/plans/archive/`。
- 2026-08-13 之前的 S2-2 状态记录（总体方案批准、计划归档说明）见下方历史块。
- `S2-2C Provider/Model 高级选择` 已完成（2026-08-22）：设计文档为 [S2-2C 详细设计](./archive/2026-08-21-s2-2c-provider-model-selection-design.md)，实施计划为 [S2-2C 实施计划](./archive/2026-08-21-s2-2c-provider-model-selection-implementation-plan.md)；实施共 10 个低耦合任务全部完成并独立中文提交（配置 API 开放五槽 capabilities / 目录多候选与 readiness 分层 / LLM 与媒体执行端按运行快照冻结模型构造 / 前端高级设置区 / e2e / 浏览器验收脚本与内置浏览器等价验收记录）。收口后两份计划文档按归档规则移入 `docs/plans/archive/`。
- `S2-2D` 前端生成面板报价流程接入已完成（2026-08-22）：真实付费部署下
  topic/script/storyboard/publish 四个 LLM 生成面板（含新建项目对话框选题入口）
  接入"免 quote 优先 → 409 进报价"流程——stub/fake 部署零行为变化；真实部署
  自动创建报价 → 报价确认弹窗 → 确认后携带 quote 提交（不再把
  paid_generation_quote_required 当裸报错）。设计文档为
  [S2-2D 详细设计](./archive/2026-08-22-s2-2d-frontend-quote-flow-design.md)，
  实施计划为 [S2-2D 实施计划](./archive/2026-08-22-s2-2d-frontend-quote-flow-implementation-plan.md)。
- 下一步：按 `docs/todos/roadmap-todo.md` 与总体路线推进（S2-2 之后的下一个阶段）。

历史块（2026-08-13）：

- `S2-2` 已完成用户需求澄清与总体方案批准，设计入口为 [S2-2 总体设计](./2026-08-12-s2-2-generation-configuration-overall-design.md)。
- 2026-08-11 已完成 `docs/plans/` 根目录历史计划归档；本轮计划状态治理的[设计](./archive/2026-08-11-plan-state-governance-closeout-design.md)与[实施计划](./archive/2026-08-11-plan-state-governance-closeout-implementation-plan.md)已归入历史证据区。

## Asset Planning 验证边界

- `intent_compiler` 已通过 15 分镜 `5/5` 个有效轮次和 21 分镜 `2/2` 个轮次；默认生成模式已切换为 `intent_compiler`，并保留显式 `legacy` 回滚。完整证据见[最近一次 Asset Planning live 记录](../records/2026-08-10-asset-planning-intent-compiler-live-check.md)。
- 上述 7 个有效轮次运行的是包含 global normalization/repair 的当前代码，但都走正常路径：`global_structure_normalization_event_count=0`，`global_structural_repair_used=false`。
- 因此，现有 live 证据只证明 global 正常路径与 `intent_compiler` 兼容；global normalization 与 structural repair 的异常恢复分支只有 non-live 证据，尚未在 live 中实际触发。
- 不为补齐该异常分支证据自动重跑付费 provider；如需 live 复验，必须另行明确授权并记录成本与输出。

## 当前推荐顺序

1. `S2-2A 配置与成本基础` 已完成（2026-08-20）；下一棒为 `S2-2B 创作偏好 -> S2-2C Provider/Model 高级选择`，每一棒单独设计、实施、验证和提交。
2. B/C 的详细设计与实施计划在 S2-2A 闸门确认后按当日状态新建，不从历史草案续跑。

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
