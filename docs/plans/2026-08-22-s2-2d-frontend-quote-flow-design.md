# S2-2D 前端生成面板报价流程接入设计（2026-08-22）

> **For agentic workers:** 本设计是 S2-2D 的正式设计依据。实施按配套
> implementation plan 逐任务推进；每个任务先写红灯测试再实现，独立中文提交。
> 所有正式 prompt 不涉及；不改后端 quote/snapshot/run 合同。

## 1. 背景与目标

### 1.1 问题

真实付费部署（`LLM_PROVIDER != stub`，服务端判定 `isPaidLlmDispatchPossible`）下，
LLM 主链路生成必须携带 `cost_quote_id + idempotency_key + authorize_budget_override`
提交，否则返回 `409 paid_generation_quote_required`。前端 **topic（选题）、script
（文案）、storyboard（分镜）、publish（发布）四个生成面板未接入报价流程**：生成请求
不带 quote 字段、不创建报价、无确认弹窗，409 只作为普通报错展示——真实部署下这些
入口在 UI 上不可用（"选题生成失败：请先创建报价"），体验断点成立（用户反馈）。

### 1.2 目标

- 四个面板在**任何部署**下都能从 UI 直接发起生成：
  - stub/fake 部署（免 quote 路径）：行为与现状完全一致（直接成功，零费用）。
  - 真实付费部署：自动进入"创建报价 → 确认金额/授权 → 提交同一张 quote"流程，
    不再把 409 当裸报错。
- 复用既有组件与编排模式（`GenerationQuoteDialog` + AssetPanel 的
  `quoteAndGenerate` 语义），不新造报价 UI。
- 不改后端 quote/提交/幂等/预算合同（已冻结）。

### 1.3 非目标（边界）

- 不修改后端任何协议（quote/snapshot/run/dispatch/usage）。
- 不接入 render/compose 面板（渲染入口无 LLM 付费语义，保持现状，后续如有需要单独设计）。
- 不做媒体单任务之外的报价范围扩展（asset 面板已全量接入，不动）。
- 不改变 voice.preview 试听既有流程（已是独立闭环先例，仅作为模式参照）。
- 真实付费 live 不运行（保持"未验证"标注）。

## 2. 现状（调研结论）

| 入口 | 现状 | 409 表现 |
|---|---|---|
| asset 资产面板 | **已全量接入**：6 个生成入口走 createQuote → GenerationQuoteDialog → 提交；本地回退/过期重报/409 重报/网络失败复用幂等键，全套测试 | 业务冲突 → 关弹窗提示重新报价 |
| voice.preview 试听 | 独立闭环：先免 quote 直连 → 仅 409 paid_generation_quote_required 进报价弹窗（ProjectGenerationSettings） | 进入报价流程 |
| topic / script / storyboard / publish | **未接入**：store API 无 quote 参数，面板不创建报价 | 仅展示 ApiError message |

可复用资产：

- `frontend/src/components/asset/GenerationQuoteDialog.vue`：通用报价确认弹窗
  （预计费用/授权上界/预算/分项/unbounded+over_budget 强制授权勾选/confirm/cancel
  testid），**可直接复用**。
- `frontend/src/stores/generation-cost.ts`：`createGenerationCostStore` /
  `createQuote`（保存 quote+幂等 key）/ `isQuoteExpired` / `createIdempotencyKey` /
  `microsDecimalToCnyDisplay`。
- AssetPanel 编排语义：B1 成功反馈延迟到确认提交成功后；409 = 业务冲突必须重新报价
  （不重放旧 quote）；过期（isQuoteExpired）→ 重新报价；网络失败 → 复用同一
  quote+key 重试。
- store 层透传模式：`stores/assets.ts` 的 `generateAssets` 接受
  `quoteId/idempotencyKey/authorizeBudgetOverride` 并映射为
  `cost_quote_id/idempotency_key/authorize_budget_override`。

## 3. 方案

### 3.1 统一模式：免 quote 优先 → 409 进报价（voice.preview 先例）

每个面板的生成流程改为两段式：

1. **先按现状免 quote 直连生成**（stub/fake 部署直接成功，零行为变化）；
2. 仅当收到 `409 paid_generation_quote_required`（`isPaidQuoteRequiredError`：
   `ApiError.status === 409` 且 code 含 `paid_generation_quote_required`）时，
   进入报价流程：
   - `generationCostStore.createQuote({ operation, selection?, enabledProviderTypes?, runOverrides? })`
     （store 保存 quote + 幂等 key）；
   - 弹 `GenerationQuoteDialog`（预计费用/授权上界/requires_budget_override）；
   - 确认后提交**同一张 quote**：`cost_quote_id + idempotency_key +
     authorize_budget_override + 原请求参数`；失败（网络不确定）保留弹窗复用同一
     quote+key 重试；409/422 业务冲突 → 关弹窗、提示重新报价；quote 过期 →
     重新创建。
   - 非 409 错误保持现状（原样展示错误）。

理由：与 voice.preview 同一交互模式（用户已熟悉"试听"的报价确认）；stub 部署
零回归；真实部署自动可用且**必须显式确认金额**（防误付费语义不变）。

### 3.2 store 层改动（每面板一个）

- `topic.ts` / `script.ts` / `storyboard.ts` / `publish.ts` 的生成 API 函数增加
  可选参数 `{ quoteId?: string; idempotencyKey?: string; authorizeBudgetOverride?: boolean }`，
  映射为请求体的 `cost_quote_id / idempotency_key / authorize_budget_override`
  （照 `stores/assets.ts` L157-160 模式）。缺省不携带（免 quote 路径与现状一致）。

### 3.3 面板层改动（每面板一个）

- 生成 handler 包一层"免 quote → 409 进报价"编排（可抽一个共享 helper
  `frontend/src/composables/useQuoteAwareGeneration.ts`，四个面板复用；
  或按面板内联——**优先共享 helper**，四个面板的编排完全同构，避免四份复制；
  若共享导致组件耦合过高则在设计评审时退回内联，禁止两套并存）。
- 弹窗复用 `GenerationQuoteDialog`；确认提交沿用 AssetPanel 的成功反馈时机
  （B1：成功反馈只在确认提交成功后触发）。

### 3.4 幂等键

`createIdempotencyKey()`（generation-cost store 已有）——每次报价创建时生成并随
quote 保存；提交失败重试复用同一 key；用户取消/重新报价 → 新 key + 新 quote。
（与 voice.preview 的 `voice-preview-{uuid}-{profileId}` 模式一致，key 前缀用
operation 名，如 `topic-{uuid}`。）

## 4. 交互与错误语义（沿用 AssetPanel，逐项明确）

| 场景 | 行为 |
|---|---|
| stub/fake 部署直连成功 | 不弹报价，与现状一致 |
| 409 paid_generation_quote_required | 进入报价流程（创建报价 → 弹窗） |
| 报价创建失败（generation_quote_resolution_failed / unquotable） | 提示"报价服务暂不可用"，**回退免 quote 本地路径**（与 AssetPanel LOCAL_QUOTE_UNAVAILABLE_CODES 同语义）；其余错误码不回退，提示重试 |
| 弹窗确认 | 提交同一 quote + key + authorize_budget_override（requires_budget_override 时强制勾选授权） |
| 提交 409/422（业务冲突/漂移） | 关弹窗、清 pending、提示"生成被拒绝（…），请重新报价后再试" |
| 提交网络失败 | 保留弹窗，复用同一 quote + key 重试 |
| quote 过期（isQuoteExpired） | 重新创建报价（新 quote 新 key） |
| 用户取消 | 不提交，不创建 run（报价未消费，自然过期） |

## 5. 测试策略

每个面板一个 jsdom spec（`tests/frontend/`）：

- stub 直连成功：不调 createQuote、不弹窗、生成成功反馈（现状回归锚点）。
- 409 触发报价：mock 首次请求 409 paid_generation_quote_required → 断言
  createQuote 被调用（正确 operation + selection/enabledProviderTypes 透传）→
  弹窗渲染金额 → 确认 → 提交请求体含 cost_quote_id/idempotency_key/
  authorize_budget_override。
- 弹窗取消：无提交、无 run 状态变化。
- requires_budget_override（unbounded）：强制授权勾选才能确认。
- 提交 409 业务冲突：弹窗关闭、提示重新报价、旧 quote 不复用。
- 过期：确认时 isQuoteExpired → 重新创建报价。
- 网络失败重试：同一 quote+key 重放。
- store 透传：四 store 的生成函数携带 quote 字段映射（照 assets.test.ts 模式）。

## 6. 文档与收口

- 实施完成后同步 `docs/architecture/api-design.md`（前端报价流程接入章节）、
  `docs/README.md`（S2-2D 完成登记）、roadmap。
- 全量回归（后端不受影响，跑前端全量 + build:frontend + 相关后端套件确认无回归）。
- 浏览器验收：真实部署（本机 .env 已有真实 LLM）内置浏览器验证
  topic/script/storyboard/publish 四入口从"报错"变为"报价弹窗 → 确认 → 生成"；
  Playwright 入口注册（沿用 s2-2b/2c 模式，本机缺 Chromium 标注未验证）；
  真实付费 live 不运行（标注未验证）。
