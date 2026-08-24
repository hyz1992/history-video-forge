# S2-2 报价体系移除与费用清单：浏览器验收记录（2026-08-23）

## 验收背景

按用户反馈移除 S2-2 报价/授权体系（报价确认弹窗、409 付费闸门、预算门禁、超额授权、单次预算设置），恢复资产生成前的预估费用提示，并新增项目费用清单面板（跨阶段共用、默认收起、按阶段分组展示消费明细）。验收采用本机 Playwright（Chromium 1223）+ 真实前后端 dev 服务（`npm run dev:backend` / `npm run dev:frontend`）。

## 验收过程与结果

### 前置修复（验收中发现）

- 前端 dev 页面白屏，根因：`frontend/src/main.ts` 使用了 `generationCostStoreKey` 但缺少对应 import（早期批量改动遗漏），运行时 `ReferenceError`。已补 import 修复，页面恢复正常渲染。
- 验收期间发现 3008 端口残留旧后端进程，已清理并重启（与本次改动无关的环境问题）。

### 验收项

| 验收项 | 结果 | 证据 |
|---|---|---|
| 页面正常渲染（无 JS 运行时错误） | 通过 | Playwright pageerror/console 无错误；首页"历史短视频工坊"完整渲染 |
| 工作区顶栏"费用"按钮存在（跨阶段共用入口） | 通过 | `data-testid="open-cost-panel"` 可见 |
| 费用面板默认收起、点击展开 | 通过 | 点击前无抽屉；点击后 el-drawer 出现 |
| 费用面板内容（标题/总预计/已确认实际/空态） | 通过 | 抽屉文本："项目费用清单｜总预计费用 ¥0｜已确认实际 ¥0｜暂无消费记录…" |
| 生成页面无报价弹窗 | 通过 | topic 阶段页面无任何 el-dialog；无 paid_generation_quote_required 相关 UI |
| 项目设置页无单次预算 UI | 通过 | 设置对话框仅含视频策略四档/API 画质/音色/画风/字幕/高级设置，无预算输入 |
| 音色试听恢复直连入口 | 通过 | 设置页音色列表展示 5 个 `voice-preview-*` 试听按钮（无"试听报价确认"弹窗逻辑） |

### 未验证项（明确标注）

- 资产生成前的 ElMessageBox 预估确认：需完整上游数据（topic→script→storyboard→asset plan），且真实部署下生成会触发付费 LLM/媒体调用（成本敏感），未在浏览器实测；该交互由 jsdom 组件测试与代码审查覆盖。
- 费用面板按阶段展示真实消费明细：新项目无消费记录（空态已验证）；带数据场景由 `tests/frontend/project-cost-ui.spec.ts`（按阶段分组/规格展示/精度）覆盖。
- voice.preview 真实 TTS 合成（付费调用）未触发；cached 档案直连路径与代码审查覆盖。

## 结论

报价移除后的核心 UI（顶栏费用入口、默认收起的费用面板、无报价弹窗、无预算 UI、试听直连）在真实浏览器环境验证通过。后端 242 文件 2144 用例、前端 29 文件 190 用例与构建全部通过。

## 补记：费用面板"运行成功但无消费记录"问题（2026-08-24）

用户反馈：项目已完成选题与文案生成，费用面板显示"运行：成功 2"但"暂无消费记录"。

根因：`20260823000000_s2_2_usage_unit_detail` 迁移（UsageCostRecord 增加 unitDetailJson 列）是在两次生成 run 完成之后才部署的。生成期间 LLM 记账落库因列缺失整体失败，审计事件 `usage_recording_failed` 留痕了每次失败的 interaction_id，interaction 日志（`storage/projects/.../trace/*-runs/<runId>/llm-interactions/*.md`）保留了真实 token 用量；run 本身仍正常成功。记账失败不阻断生成主链路（既定留痕策略），因此用户看到"成功 2 / 暂无消费记录"。

修复：
1. 迁移部署（commit a4ab4fa）后，后续 run 的记账路径已恢复（同一 writer/同一列集合，无其他遗留断点）。
2. 新增维护脚本 `harness/scripts/maintenance/backfill-missing-usage-records.ts`：按 `usage_recording_failed` 审计反查 interaction 日志，复用生产 `recordLlmUsage` 以同一语义补写 UsageCostRecord（幂等，已存在的记账键跳过）。本次为 2 个 run 补记 4 条 token 记账（topic 3569+2968 / 4699+1219；script 3271+753 / 3019+1175）。
3. 浏览器实测：费用面板按"选题/文案"阶段展示 4 条明细（模型 deepseek-v4-pro、输入/输出 token、succeeded）。

金额显示 ¥0 的原因：目录中 deepseek-v4-pro 未登记已核实公开单价（unpriced 诚实原则），按 0 计不伪造价格；运营核实价格写入 ProviderModelCatalog 后，新记账将按目录价计价。

边界：脚本只处理 status=succeeded 的单 attempt interaction；failed run 与多 attempt 汇总日志不补记（防伪造）。

## 补记：LLM 消费不展示金额的产品决策（2026-08-24）

用户确认：LLM provider 交互只返回 token 用量（prompt/completion tokens），不返回价格；价格只能来自服务端目录，而目录价格未经核实且官网价格持续变动。据此决策：

- 费用面板中 LLM（llm.smart/llm.flash）记录只展示模型与 token 用量，金额一律显示 "—"，不展示 ¥0/估算价/目录价（避免"免费"或"过时价格"误导）。
- 顶部"总预计费用/已确认实际"与阶段小计只聚合有目录价的媒体消费（图片/视频/TTS），与明细同源；纯 LLM 阶段显示 "—"。
- 面板新增说明文字："LLM 消费按 token 用量展示，价格以供应商官网为准，不在此计入金额。"
- 账本（UsageCostRecord 金额字段）与后端 costs API 不变：token 用量是事实，金额字段保留按目录价的历史估算值，仅展示层不呈现 LLM 金额。

## 补记：资产页卡死与本地资产生成失败（2026-08-24）

用户反馈：资产页停留在"正在生成基础资源"全屏 loading（已等待 500+ 秒）且项目资产状态异常。排查出两个独立缺陷：

1. **前端渲染崩溃（页面卡死根因）**：`AssetPanel.vue` 引用了 `segmentRouteBySegmentId`（模板 props 与严格失败原因共 3 处），但其 computed 定义在报价移除提交 dd69a4c 中被误删。快照加载完成、phase 从 loading/plan_generating 切向资产预览页时，渲染抛出 `TypeError: Cannot read properties of undefined (reading 'get')`——Vue 中止本次渲染，页面冻结在上一次成功渲染的界面（所以呈现为"正在生成基础资源"且计时器一直累计）。已补回定义（segment_routes → Map）。同提交遗留的 `GenerationQuoteDialog` 死模板块一并删除。

2. **后端本地 provider 落库失败（资产状态异常根因）**：字幕/音效/配乐本地 adapter（无 billing）创建 job 时无条件写 `generationRunId`/`attemptIndex`，但 `providerRequestKey` 为 null，违反数据库 CHECK 约束 `AssetProviderJobRecord_call_intent_consistency`（三元组必须全空或全非空）→ 18 个任务全部落库失败。已改为仅计费 adapter 携带三元组（本地 adapter 全空）。此前该约束（20260813090000_s2_2a_review_fixes 引入）之后无本地 provider 落库场景，报价移除后首次暴露。

3. **UX 流程约束（按用户要求）**：基础资产生成不再出现全屏阻塞 loading。`useAssetTabPhase` 改为资产生成态（basic_assets_generating）优先于规划生成态；阻塞式 StageGenerating 仅限"资产规划"阶段（`generatingView.kind === 'asset_plan'`）。资产规划完成后立即切换资产预览页，口播等基础资产在页面内生成（顶部横幅提示）。

修复验证：后端 engine 测试新增三元组断言（本地全空/计费全非空）39 通过；前端 phase 优先级测试 29 通过；backend typecheck 与 frontend build 通过；浏览器实测资产页正常渲染资产预览（12/43、口播音频、分镜卡片、批量生成剩余）。当前项目的 18 个失败任务（字幕/音效/配乐，本地零费用）可通过"批量生成剩余"补生成；分镜图/视频按需付费生成或手动上传。
