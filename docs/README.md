# history-video-forge 文档索引

本文档用于帮助新 agent 或协作者快速建立 `history-video-forge` 的上下文。

原则：

- 只记录当前已经确认的结论
- 未确认项明确标注为 `TBD`
- 旧项目仅作迁移参考，不作为新项目正式规范来源
- prompt 规则、runtime harness、执行治理优先查看 [harness/README.md](../harness/README.md)
- `docs/plans/archive/` 只保存历史设计与实施证据，不作为当前任务入口，也不能作为后续任务的续跑清单
- `docs/records/` 只保存历史运行、质量检查与恢复记录，不作为当前设计真相源

---

## 当前阶段状态

2026-09-05 新设计（尚未实现）：

任务 0 更新：独立离线验证入口、32 项测试、候选/样例摘要及 dry-run 已完成，连同 legacy TTS 最小回归共 45 项通过；[离线证据](./records/2026-09-05-narration-provider-qualification.md)见记录。官方候选预览听审尚未确认，语气试验与模型资格比较未完成；零付费调用，不进入任务 1。

- 口播前置与真实时间轴：在文案确认后、分镜前生成并确认整篇口播；原生字词时间戳统一派生字幕及镜头时间。见[设计与模型比较](./plans/2026-09-05-narration-first-timing-design.md)、[实施计划](./plans/2026-09-05-narration-first-timing-implementation-plan.md)。已完成用户限定的三轮自审修复，设计与计划文档终审通过，可开始任务 0 离线实施；证据见[有限循环记录](./records/2026-09-05-narration-first-design-review-loops.md)。CosyVoice v3 flash 与 Qwen-Audio 3.0 plus 的最终默认组合待实测，不预设赢家。尚未实现业务、未付费调用，不包含环境音效。

截至 2026-08-21：

- `S2-2A`（配置与成本基础）核心交付已完成并通过 T2 终审，外部审查整改闭环（见 [整改记录](./records/2026-08-21-s2-2a-external-review-remediation-record.md)）。
- `S2-2B`（创作偏好：音色/画风/字幕）已完成（2026-08-21）：三类偏好从用户默认复制到项目、支持单次运行覆盖并进入运行快照（`resolved_creative` 冻结 preset 版本/解析结果/最终样式与 tts 实际模型）；画风 preset 解析结果输入 `ProjectArtBible` 与正式中文 prompt（asset-planner v1.3.0），执行端只消费快照冻结参数（注册表升级不改写已冻结运行）；字幕 preset 有限安全覆盖被 renderer 消费；音色库迁入数据库（owner/visibility 同源授权、跨实例 DB 权威）；试听走 `voice.preview` quote + 提交协议（付费部署 409 闸门、幂等、usage 落账、前端弹窗报价确认）；音色执行以快照为权威，客户端 voice_profile_id 冲突先于 quote 消费拒绝（422 generation_voice_profile_conflict）。验收：后端 e2e（`tests/backend/s2-2b-e2e-acceptance.test.ts`）+ jsdom 组件测试 + 浏览器验收脚本（`npm run harness:s2-2b-browser-acceptance`，stub/fake）；真实付费试听 live 未运行（明确标注未验证）。设计/实施入口见 [Plans 状态说明](./plans/README.md)。
- `S2-2C`（Provider/Model 高级选择）已完成（2026-08-22）：配置 API 开放五槽 capabilities 固定选择（缺省保留现值、首写全 auto、旧 A/B 请求体零变化）；目录每槽多候选（LLM 候选表 + readiness 分层校验防漂移，无数据库迁移）；执行端一律按运行快照冻结的 resolved_capabilities 构造（LLM provider 工厂/媒体 adapter/dispatch gate/usage 记账同源，assets handler 补 DB 冷镜像恢复与 `dispatch_snapshot_missing` fail-closed）；前端设置页与项目设置新增 Provider/Model 高级选择区 + 失效预览扩展。验收：后端 e2e（`tests/backend/s2-2c-e2e-acceptance.test.ts` 7 用例）+ 任务 1-8 单元/组件测试 + 浏览器验收脚本（`npm run harness:s2-2c-browser-acceptance`，stub/fake，本机缺 Chromium 未实跑）；真实付费 live 未运行（明确标注未验证）。设计/实施入口见 [Plans 状态说明](./plans/README.md)。
- `S2-2D`（前端报价流程移除与费用清单）已完成（2026-08-23）：按用户反馈移除整套报价/授权体系——生成面板（topic/script/storyboard/publish/新建项目/asset/voice.preview）全部恢复直连生成（无报价弹窗、无 409 门禁、无预算与超额授权）；后端付费闸门、quote 创建/消费/重校验、预算门禁与 `pricing_overrun` 全部移除（GenerationRun/snapshot/usage 记账保留，历史表留档）；资产生成手动入口保留生成前预估费用确认；新增项目费用清单面板（工作区顶栏"费用"入口、默认收起、按阶段分组展示 LLM/图片/视频/TTS 消费明细，含图片分辨率与视频画质规格）。辅助 LLM/媒体入口（事件库/自定义选题、封面优化、标题候选、prompt 优化、视频升级、封面生成）恢复直连但不记账（登记已知限制）。验收：后端 242 文件 2144 用例、前端 29 文件 190 用例 + 构建全部通过；浏览器验收见变更记录。

截至 2026-08-11（历史状态）：

- V2 第一个大子项目 S1（用户系统、管理员权限与项目隔离）已完成全部 8 个子任务并通过端到端验收。
- V2 S1 覆盖：Auth 基础设施（S1-1）、Admin Bootstrap CLI（S1-2）、Controller 授权与 owner 隔离（S1-3）、File routes owner 隔离（S1-4）、Admin 只读 API（S1-5a）、Admin 写操作 API（S1-5b）、后端 login/logout/me 与前端 auth（S1-6）、管理前端（S1-7）、migration owner 转换与 S1 收口验收（S1-8）。
- migration owner（不可登录标记 `!migration-owner-no-login`）的项目可通过 admin 管理页面转移给真实 USER；转移后 USER 可正常登录并使用项目，其他用户不可访问。
- V2 S1 收口验收测试见 `tests/backend/s1-e2e-acceptance.test.ts`（19 个用例全部通过）。
- V2 S1 真实浏览器验收入口见 `npm run harness:s1-browser-acceptance`：覆盖匿名/admin 路由守卫、migration owner 不可登录、admin 项目转移、代管横幅、审计日志、转移后 USER 可见、其他 USER 隔离和 USER 访问管理后台拦截。基础登录浏览器验收入口见 `npm run harness:auth-flow-acceptance`。
- `S2-0` LLM 回复速度、质量和结构化输出优化基线与 `S2-1` 多模型、多供应商切换均已完成并收口（历史记录；S2-2A 已完成，见上）。
- V1 高风险稳定化已完成主要止血任务。
- V2 数据基础 Task 8.5 已完成收口：测试矩阵、schema 复核、迁移状态机、readiness、仓储访问边界、SQLite 备份恢复、Prisma 业务切换与 JSON 写入冻结。
- 2026-07-12 分组全量矩阵覆盖 197 个测试文件、1068 个用例并全部通过；前后端构建、SQLite 备份恢复、Prisma 重启恢复和内置浏览器深链验收通过。
- 全链路 v1 已进入端到端交付闭环：`topic -> script -> storyboard -> asset planning -> assets -> compose/render -> publish`。
- `topic + script` 第一阶段已达到当前及格标准，可以暂时冻结。
- `storyboard`、`asset planning`、`assets`、`compose/render`、`publish` 已具备 v1 后端链路和前端工作区入口。
- 当前前端工作区为 6 步：`选题 -> 文案 -> 分镜 -> 资产 -> 合成渲染 -> 发布交付`。`compose` 与 `render/export` 在当前 UI 中合并为“合成渲染”阶段；旧的独立 ComposePanel / RenderPanel 文件若仍存在，只能视为历史或兼容代码，不能作为当前入口判断。
- 合成渲染页已支持自动合成/渲染、完成态摘要、视频预览/下载和进入发布交付。发布页已支持自动生成发布包、成品视频与封面预览、封面提示词编辑、LLM 优化、AI 生成封面确认、上传封面、标题候选、描述、标签和导出发布包。
- 旧的 topic/script 计划已归档到 [plans/archive/topic-script](./plans/archive/topic-script/)。
- 进入新任务时，优先阅读正式入口文档、当前计划索引、源码现状和真实浏览器/API 状态；不要把 archive 或 records 中的历史内容直接当作当前约束。

---

## 推荐阅读顺序

对于没有上下文的新 agent，建议按以下顺序建立认知：

1. [AGENTS.md](../AGENTS.md)
2. [产品需求文档](./requirements/product-requirements.md)
3. [技术栈规范](./standards/tech-stack-spec.md)
4. [项目生命周期设计](./architecture/project-lifecycle.md)
5. [Pipeline IO 规范](./architecture/pipeline-io-spec.md)
6. [Downstream 高层设计留档](./architecture/downstream-stage-high-level-design.md)
7. [Topic 阶段设计](./architecture/topic-stage-design.md)
8. [Script 阶段设计](./architecture/script-stage-design.md)
9. [Script 校验规范](./architecture/script-validation-spec.md)
10. [字段设计](./data/field-design.md)
11. [Schema 设计](./data/schema-design.md)
12. [API 设计](./architecture/api-design.md)
13. [视频流水线工程经验笔记](./records/2026-05-09-video-pipeline-engineering-notes.md)
14. [Plans 状态说明](./plans/README.md)
15. [Records 状态说明](./records/README.md)
16. 若进入 `S2-2`、重要 V2 产品功能、重要质量优化，或用户明确要求正式设计的任务，必须结合 [AGENTS.md](../AGENTS.md)、本索引所列正式架构、当前代码和实际验证结果，并按启动当日新建中文 design 与 implementation plan；普通低风险任务不强制新增设计文档，`archive/` 中的 V2 文档只作历史设计输入，不能续跑。

---

## 文档结构

### 需求与范围

- [产品需求文档](./requirements/product-requirements.md)

### 架构与阶段设计

- [项目生命周期设计](./architecture/project-lifecycle.md)
- [Topic 阶段设计](./architecture/topic-stage-design.md)
- [Recent Memory 设计](./architecture/recent-memory-design.md)
- [Script 阶段设计](./architecture/script-stage-design.md)
- [Script 校验规范](./architecture/script-validation-spec.md)
- [Pipeline IO 规范](./architecture/pipeline-io-spec.md)
- [Downstream 高层设计留档](./architecture/downstream-stage-high-level-design.md)
- [API 设计](./architecture/api-design.md)
- [Runtime Orchestration 设计](./architecture/runtime-orchestration-design.md)

### 数据与字段

- [字段设计](./data/field-design.md)
- [Schema 设计](./data/schema-design.md)

### UI

- [Topic 页面设计](./ui/topic-page-design.md)

### 流程

- [Code Agent 驱动创意项目开发方法论](./process/agent-driven-creative-development-methodology.md)
- [UI Design-to-Code Playbook](./process/ui-design-to-code-playbook.md)
- [UI 页面实施包模板](./ui/_template/README.md)

### 标准与规范

- [技术栈规范](./standards/tech-stack-spec.md)

### 迁移与工程经验参考

- [旧项目可复用资产清单](./migration/reusable-assets-inventory.md)
- [视频流水线工程经验笔记](./records/2026-05-09-video-pipeline-engineering-notes.md)

### 阶段留档

说明：以下文件是历史证据，不是当前设计入口。若与正式架构文档或 `AGENTS.md` 冲突，以正式入口文档为准。

- [Harness 架构评估](./records/2026-04-17-harness-architecture-assessment.md)
- [Topic 阶段结论](./records/2026-04-17-topic-stage-conclusions.md)
- [Script 阶段结论](./records/2026-04-17-script-stage-conclusions.md)
- [爆款优化结论](./records/2026-04-17-viral-optimization-conclusions.md)
- [Phase 2 结论](./records/2026-04-18-topic-script-phase-2-conclusions.md)
- [Runtime Hardening Notes](./records/2026-04-19-runtime-hardening-notes.md)
- [Topic + Script Live Checklist](./records/2026-04-19-topic-script-live-checklist.md)
- [Phase 3 结论](./records/2026-04-19-topic-script-phase-3-conclusions.md)
- [Phase 4 结论](./records/2026-04-21-topic-script-phase-4-conclusions.md)
- [UI Acceptance 结论](./records/2026-04-21-ui-acceptance-conclusions.md)

### 计划与执行

- [Plans 状态说明](./plans/README.md)（含当前计划状态、历史归档边界与新任务启动规则）
- 2026-07-13 V2 文档已归档，只是历史设计输入，不是当前设计草案、后续任务审查入口或执行授权；需要正式设计的尚未启动 V2 工作按上方“推荐阅读顺序”第 16 项执行，不从 `archive/` 续跑。
- [Topic + Script 历史计划归档](./plans/archive/topic-script/)
- [当前 Todo](./todos/roadmap-todo.md)

---

## 当前已确认范围

当前文档已经较完整覆盖：

- 新项目的产品目标与非目标
- Topic 阶段的三入口设计
- `Event Registry / Topic Candidate Card / Topic Package`
- Topic 到 Script 阶段的输入边界
- `Project Style Pack / Family Bias Pack / Topic Delivery Pack`
- Script 阶段的最小闭环规则
- Script 阶段的实现级阈值与返回 schema
- 旧项目可复用与不可复用部分
- 分阶段讨论留档
- 第一阶段历史计划与任务清单归档
- 后端 v1 到发布交付包的主链路边界
- 前端工作区 6 步主流程和当前合成渲染/发布交付入口

---

## 当前仍为 TBD / 待正式设计的区域

- 更系统的人工审稿流、发布前验收流和真实平台发布流
- 真实付费 BGM/SFX provider、素材授权包装、响度归一化、ducking 和真实音频素材运营
- DashScope 图生视频真实小样本验证与成本/失败模式记录（默认仍不自动执行）
- 原生时间戳与字幕精对齐的实施及真实验收（设计已见上述 2026-09-05 口播前置方案，尚未实现）
- 更完整的生产化媒体库：hash 索引、去重、复用、生命周期、失败重试和人工替换记录
- 更完整的 UI 组件级规范
- 推荐轻评审阈值
- `event_family` 命中算法与 `family_confidence` 计算方式

---

## 更新策略

- 原则性结论：更新对应正式规范文档
- 连续讨论形成阶段性结论：同步更新 `records/`
- 过程性推导：不直接写入正式规范，除非已经收敛
- 重大收口：同步更新路线图与 todo
- 已执行完毕的 design / implementation plan：移动到 `docs/plans/archive/`，不要继续留在 `docs/plans/` 根目录误导新任务

## 2026-05-20 全链路 v1 阶段文档收口状态

截至 2026-05-20，所有 7 个流水线阶段均已完成第一版设计、实施与后端实现。该表是后端 v1 收口记录；截至 2026-07-08，前端主工作区已进一步收敛为 6 步，其中 `compose` 与 `render/export` 合并为“合成渲染”：

| 阶段 | 设计日期 | 实施状态 |
|---|---|---|
| topic | 2026-04 | v1 完成，已冻结 |
| script | 2026-04 | v1 完成，已冻结 |
| storyboard | 2026-05-09 | v1 后端完成 |
| asset planning | 2026-05-10 | v1 后端完成 |
| assets | 2026-05-15 | v1 后端完成（fake/local + DashScope TTS/文生图/图生视频） |
| compose | 2026-05-17 | v1 后端完成（timeline contract） |
| render/export | 2026-05-18 | v1 后端完成（Remotion MP4） |
| publish | 2026-06-17 | v1 后端完成（封面/标题/描述/标签/导出） |

详细历史记录见 [Plans 状态说明](./plans/README.md)。

当前下一步方向：围绕现有前端 v1 主流程做真实浏览器验收、生产化补强、失败恢复、质量门禁和文档治理；真实平台发布、人工审稿、质量评分、真实付费 provider 等高影响扩展仍需正式 design + implementation plan。
