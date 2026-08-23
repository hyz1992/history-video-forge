# S2-2 报价体系移除 + 项目费用清单（变更设计）

日期：2026-08-23

状态：已实施完成（本文件为变更设计与实施证据入口）。

上位变更：用户反馈 S2-2 报价确认弹窗体系严重影响体验且与产品预期不符，要求移除报价/授权体系，恢复资产生成前的预估费用提示，并新增项目级费用消耗统计面板。

## 1. 变更目标

1. **移除**报价/授权体系：409 付费闸门、quote 创建/消费/重校验/内容指纹、预算门禁、超额授权、确认弹窗、单次预算设置。
2. **恢复**资产生成前的预估费用提示（S2-2 之前的前端估算 + 确认形态）。
3. **新增**项目费用清单面板：跨阶段共用入口（工作区顶栏）、默认收起、按阶段分组展示消费明细（LLM 模型/token 输入输出/价格、图片规格/数量/模型/价格、视频画质/秒数/价格、TTS 字符数）。

## 2. 保留 / 移除 / 新增清单

**保留**（费用清单与防重复计费的地基）：

- `GenerationRun` + `RunConfigurationSnapshot`（新快照为 free 形态：quote 绑定字段置空/零）+ dispatcher/幂等/防重复计费/`needs_reconciliation`。
- `UsageCostRecord` 请求级记账（LLM + 媒体），新增 `unitDetailJson` 单位规格明细列（图片分辨率/视频画质）。
- provider/model 目录与 pricing service（记账计价与执行绑定同源）。
- `GET /costs/summary`、`GET /costs/records`、`GET /runs/:runId/configuration`（owner-scoped）。
- 前端 `pricing.ts`（资产生成前的预估提示）。

**移除**：

- `isPaidLlmDispatchPossible` / `isPaidMediaDispatchPossible` 及全部 16 个调用点的 409 封口；辅助入口（事件库/自定义选题、封面 prompt 优化、标题候选、assets prompt 优化、视频升级、封面生成）恢复直连执行——**不建 run/不记账（登记已知限制：这些操作的费用不入项目成本清单）**。
- quote 全链路：服务、repository、路由（`POST /generation-cost-quotes`）、controller、shared DTO、前端编排（`useQuoteAwareGeneration`）与 `GenerationQuoteDialog`、store 透传。
- 提交协议字段：`cost_quote_id` / `authorize_budget_override` / `run_overrides`（幂等键保留为可选；`enabled_provider_types` 保留为执行过滤）。
- 预算全链路：`max_paid_cost_micros_per_run`（shared schema、resolver、配置 API、设置 UI）、预算门禁、超额授权审计。
- `pricing_overrun` 检查与目录禁用（授权上界概念废弃；预计/实际差异由费用清单展示）。
- `voice.preview` 报价弹窗与提交协议（恢复直连试听：cached 零费用直接返回；真实 TTS 合成写审计留痕；不建 run/不记账）。

**新增**：

- `UsageCostRecord.unitDetailJson`（migration `20260823000000_s2_2_usage_unit_detail`，含冷镜像同步）；媒体记账为 image 记录执行端实际分辨率（`dashscope.imageSize`）、video 记录画质。
- 资产生成手动入口的预估费用确认（ElMessageBox；自动触发与严格失败重试不弹窗）。
- `ProjectCostPanel`（el-drawer，工作区顶栏"费用"按钮打开，默认收起；按 `operation → 阶段 key` 分组展示明细，区分预计与已确认实际 `cost_basis`）；`generation-cost` store 在应用入口全局 provide 共享。

## 3. 关键语义决策

1. **数据库表不删**：`generation_cost_quotes` 表与 snapshot/run 的 quote 列保留（历史数据留档，避免破坏性迁移），代码与 API 不再写入/暴露；shared DTO 移除。
2. **提交协议简化**：任何部署直接提交即执行（`GenerationRunService` 创建 free 形态快照 + run）；`idempotency_key` 可选（同 key 同 payload 重放返回既有 run，防重复计费语义保留）。
3. **解析失败提前**：提交解析以数据库为权威（项目配置/目录/storyboard/plan/manifest）；解析失败返回 `409 generation_run_resolution_failed`（如模型停用），不再有"报价后漂移拒绝"概念。
4. **付费执行闸门**：媒体 adapter 派发只需 run/snapshot 上下文（quote 校验移除）；本地/fake adapter 不受限。
5. **辅助入口不记账**：8 个辅助入口恢复直连但不建 run/不记账；voice.preview 同样直连不记账（与 S2-2 之前行为一致）。

## 4. 验收证据

- 后端全量：242 文件 2144 用例通过（`npx vitest run --configLoader runner --no-file-parallelism tests/backend`）。
- 前端全量：29 文件 190 用例通过 + `build:frontend` 成功。
- 浏览器验收：内置浏览器等价验证（资产生成预估提示、顶栏费用面板按阶段展示、voice preview 直连），见变更记录。
- 实施提交：5e2d7c5（协议切换）、488dd06（generation-cost 去 quote）、7f49588/ec65fc9（预算移除）、dd69a4c（DTO 收尾 + 面板直连）、5517edc（费用面板）、cc50817/60dc2e0（记账规格）。

## 5. 已知限制（登记）

- 辅助 LLM/媒体入口（事件库/自定义选题、封面 prompt 优化、标题候选、assets prompt 优化、视频升级、封面生成、voice.preview 试听）不建 run/不记账，费用不入项目成本清单。
- `generation_cost_quotes` 表与 quote 列保留但不再使用（后续如需物理清理另立迁移）。
- 图片规格（分辨率）取自执行端 env 配置 `dashscope.imageSize`，为项目级统一值（逐任务规格差异未建模）。
