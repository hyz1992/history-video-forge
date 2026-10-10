# history-video-forge 文档索引

核对日期：**2026-10-10**。安装与启动见 [项目 README](../README.md)，任务与风险见 [路线图](./todos/roadmap-todo.md)，具体验收证据见 [计划入口](./plans/README.md) 与相关 records。

## 当前状态

| 领域 | 当前实现与验证边界 |
| --- | --- |
| 主工作区 | 六步：选题 → 文案（含口播）→ 分镜 → 资产（含规划）→ 合成渲染 → 发布交付 |
| 口播前置 | 2026-09-10 起新项目统一 `narration_first_v1`；确认正文后生成并确认整篇口播，原生词级时间轴直通字幕与下游。发布/演示开关已移除，legacy 保留读取、导出和显式升级 |
| 口播资格与对齐 | 当前合格组合为 Qwen Audio 3.0 TTS Plus / 龙翼暮凌；已实现静音跳过、受控替换、同成本仲裁与数字读法映射。A1–A7/A9/A10 有分层证据，A8 整片级仍未验证 |
| 分镜 | 新项目用 `storyboard_v2`，按真实口播候选切点投影；已修句末标点粗筛、精简输入并展示原文区间。结构通过仍需核对事件和画面时序 |
| 资产规划与角色参考 | 默认 `intent_compiler`，全局美术、分段意图、本地编译分工；定妆图默认开启（出场阈值默认 3），支持当前选中参考注入、上传替换和单任务重跑。身份/场景服饰与供应商 job 生命周期已有修复和有限真实验证 |
| 配置、模型与费用 | 用户默认、项目配置和运行快照已接入；smart/flash 表示任务用途，两槽可选 DeepSeek V4 Flash 和 GLM-5.3-Flash，示例均为 DeepSeek V4 Flash。已有显式项目选择保留。报价/预算授权/付费 409 闸门已移除，保留快照、幂等、usage 和费用清单；资产手动生成保留预估费用确认 |
| 存储与用户 | Prisma 7 / SQLite 为主存储；登录、管理员、owner 隔离、迁移/备份/readiness 已实现。JSON 快照用于历史导入，媒体和 trace 存文件系统 |
| 合成、渲染与发布 | 已具备时间轴、Remotion MP4、预览下载、发布包编辑/封面/标题/描述/标签/导出；AutoDL H3 可配置。发布包生成不等于真实平台发布 |

最近一轮（2026-10-08）的全局美术/分镜状态职责改动通过离线回归与 prompt 治理，但单次 global 实测仍有水囊载位并列与竞争动作链，**整体质量未通过**；后续 chunk、图片和成片取消，原项目未激活。见 [状态职责验收](./records/2026-10-08-visual-state-ownership-acceptance.md)。角色参考/换装小批通过只覆盖指定目标，不能外推为全片或统计稳定性通过。

## 推荐阅读顺序

1. [Agent 工作契约](../AGENTS.md)
2. [产品需求](./requirements/product-requirements.md) 与 [技术栈](./standards/tech-stack-spec.md)
3. [Pipeline IO](./architecture/pipeline-io-spec.md) 与 [项目生命周期](./architecture/project-lifecycle.md)
4. [Topic 设计](./architecture/topic-stage-design.md)、[Script 设计](./architecture/script-stage-design.md)、[Script 校验](./architecture/script-validation-spec.md)
5. [字段设计](./data/field-design.md)、[Schema 设计](./data/schema-design.md)、[V2 数据映射](./data/v2-domain-model-mapping.md)、[API 设计](./architecture/api-design.md)
6. [口播前置设计](./plans/2026-09-05-narration-first-timing-design.md) 与 [A1–A10 验收矩阵](./records/2026-09-10-narration-task12c-acceptance-matrix.md)
7. [Harness README](../harness/README.md)
8. [当前计划与证据](./plans/README.md)、[路线图](./todos/roadmap-todo.md)、[Records 使用规则](./records/README.md)

进入 asset planning / assets / compose 相关设计前，另读 [视频流水线工程经验](./records/2026-05-09-video-pipeline-engineering-notes.md)。它提供约束和问题清单，历史状态需与当前实现核对。

## 文档导航

| 类别 | 入口 |
| --- | --- |
| 下游边界 | [Downstream 高层留档](./architecture/downstream-stage-high-level-design.md)、[Compose](./architecture/compose-stage-design.md)、[Renderer](./architecture/renderer-stage-design.md) |
| 推荐记忆与编排 | [Recent Memory](./architecture/recent-memory-design.md)、[Runtime 历史参考](./architecture/runtime-orchestration-design.md) |
| UI 与流程 | [Topic 页面](./ui/topic-page-design.md)、[UI Design-to-Code](./process/ui-design-to-code-playbook.md)、[页面实施包模板](./ui/_template/README.md)、[Agent 开发方法论](./process/agent-driven-creative-development-methodology.md) |
| Prompt 治理 | [管理规范](../harness/docs/prompt-management.md)、[Registry](../harness/docs/prompt-registry-spec.md)；正式正文只存 prompts/ |
| 验证与审查 | [完成定义](../harness/docs/definition-of-done.md)、[回归清单](../harness/docs/regression-checklist.md)、[评审清单](../harness/docs/review-checklist.md)、[独立审查协议](../harness/docs/independent-review-protocol.md) |
| 部署 | [Windows Server](../DEPLOY_WINDOWS_SERVER.md) |
| 历史材料 | [旧项目可复用资产](./migration/reusable-assets-inventory.md)、[Topic/Script 归档](./plans/archive/topic-script/)、[其他计划归档](./plans/archive/) |

## 当前缺口

- 口播 A8 整片音视频 probe、字幕误差人工验收，以及跨模型盲听、账户结算核对等证据仍不齐。
- 分镜事实忠实、行旅负载、状态连续性与镜内动作衔接仍有真实失败样例；最新有限实验已关闭，不能自动续跑。
- 部分旧 prompt/runtime 测试断言滞后于正式版本，前端仍无独立 TS 类型检查闸门。
- 费用清单未覆盖所有辅助入口；真实付费 BGM/SFX、授权包装、响度/ducking、人工审稿与平台发布待设计。
- 浏览器状态矩阵、媒体生命周期、候选缓存与事件匹配阈值仍需补强。

逐项状态与证据见 [路线图](./todos/roadmap-todo.md)。历史测试数和小批验收结果不能表述为当前全量通过。 本次文档核对的检查结果见 [更新记录](./records/2026-10-10-documentation-refresh.md)。

## 更新与归档规则

- 对象和阶段合同更新正式架构/数据文档；治理与验证规则更新 harness；运行事实写 records。
- plans/ 根目录保存仍需引用的设计与待收口计划；文件存在不等于仍可执行，以 [计划状态](./plans/README.md) 为准。
- archive/ 与历史 records 用于追溯，不是新任务执行授权。重要功能或质量优化按当日状态新建中文 design + implementation plan。
- 已完成或失去执行资格的计划按状态归档；历史记录不重写为当前规范。普通低风险文档维护不强制新增设计计划。
