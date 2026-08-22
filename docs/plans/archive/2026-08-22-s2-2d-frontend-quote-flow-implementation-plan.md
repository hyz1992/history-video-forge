# S2-2D 前端生成面板报价流程接入实施计划（2026-08-22）

> **For agentic workers:** 逐项执行本计划。每个任务严格按复选框推进；上一个任务的
> 最小验证未通过，不得进入下一个任务。每任务先写红灯测试再实现，独立中文提交，
> 提交前 `git diff --check`。设计依据：[S2-2D 详细设计](./2026-08-22-s2-2d-frontend-quote-flow-design.md)。

**目标：** topic/script/storyboard/publish 四个 LLM 生成面板接入报价流程——stub/fake
部署零行为变化（免 quote 直连），真实付费部署自动进入"创建报价 → GenerationQuoteDialog
确认 → 提交同一张 quote"（409 paid_generation_quote_required 不再作为裸报错）。

**架构：** 共享编排 helper（免 quote 优先 → 409 进报价）+ 复用 `GenerationQuoteDialog` +
`generationCostStore.createQuote` + 四 store 的 quote 字段透传（照 `stores/assets.ts`
模式）。不改后端任何协议。

**范围边界：** 不接 render/compose；不改 asset 面板与 voice.preview 既有流程；
真实付费 live 不运行（"未验证"标注）。

**测试命令：** `npx vitest run --configLoader runner tests/frontend`；构建验证
`npm run build:frontend`；类型检查 `npx tsc -p frontend/tsconfig.json --noEmit`（如存在）
或按项目既有前端类型检查入口。

---

## 任务 1：共享编排 helper + store 透传基座

**文件：**

- 新建：`frontend/src/composables/useQuoteAwareGeneration.ts`（或按项目既有 composables
  目录惯例；helper 承担：免 quote 直连 → 409 判定 → createQuote → 弹窗状态 → 确认提交 →
  过期/网络失败/业务冲突语义，输出给面板用的状态与动作）
- 修改：`frontend/src/stores/topic.ts` / `script.ts` / `storyboard.ts` / `publish.ts`
  （生成函数增加可选 `quoteId/idempotencyKey/authorizeBudgetOverride` 透传，
  映射 cost_quote_id/idempotency_key/authorize_budget_override；缺省不携带）
- 修改：`frontend/src/stores/script.ts` 等四个 store 的既有测试
- 新建：`tests/frontend/stores/quote-aware-generation-store.test.ts`（四 store 透传）

- [x] **步骤 1：先写失败测试**

覆盖（详细设计 §5 store 部分）：

- 四 store 的生成函数携带 quote 字段 → 请求体含 cost_quote_id/idempotency_key/
  authorize_budget_override（照 `stores/assets.test.ts` L231-273 模式）；
- 缺省不携带（免 quote 路径请求体与现状一致）。

运行：

```powershell
npx vitest run --configLoader runner tests/frontend/stores/quote-aware-generation-store.test.ts
```

预期：失败，四 store 尚无 quote 参数。

- [x] **步骤 2：实现 store 透传与共享 helper**

按详细设计 §3.2/§3.3。helper 的编排语义严格对照 AssetPanel `quoteAndGenerate`
（B1 成功反馈时机、409 业务冲突不重放、过期重报、网络失败复用、LOCAL_QUOTE_UNAVAILABLE
回退），差异点：先免 quote 直连、仅 409 paid_generation_quote_required 进报价。

- [x] **步骤 3：运行最小验证并提交**

```powershell
npx vitest run --configLoader runner tests/frontend/stores/quote-aware-generation-store.test.ts
npx vitest run --configLoader runner tests/frontend/stores/topic-store.spec.ts tests/frontend/stores/script-store.spec.ts tests/frontend/stores/storyboard-store.spec.ts tests/frontend/stores/publish-store.spec.ts
git diff --check
git commit -m "生成 store 透传报价字段并新增免报价优先编排 helper"
```

---

## 任务 2：topic 面板接入报价流程

**文件：**

- 修改：`frontend/src/components/topic/TopicPanel.vue` + `frontend/src/stores/topic.ts`
- 新建：`tests/frontend/topic-panel-quote-flow.spec.ts`

- [x] **步骤 1：先写失败测试**

覆盖（详细设计 §4/§5）：

- stub 直连成功：不调 createQuote、不弹窗（现状回归锚点）。
- 首次请求 409 paid_generation_quote_required → createQuote 被调用（operation:
  topic.generate + 原参数透传）→ GenerationQuoteDialog 渲染 → 确认 → 提交请求体
  含 cost_quote_id/idempotency_key/authorize_budget_override。
- 取消：无提交。
- requires_budget_override：强制勾选授权才能确认。
- 提交 409 业务冲突：关弹窗、提示重新报价。
- 报价创建失败（resolution_failed/unquotable）：提示报价服务暂不可用 + 回退免 quote
  本地路径。

运行：

```powershell
npx vitest run --configLoader runner tests/frontend/topic-panel-quote-flow.spec.ts
```

预期：失败，TopicPanel 未接入。

- [x] **步骤 2：实现接入**

按详细设计 §3.3 接入 helper；`topic.ts` 生成函数已具备透传参数（任务 1）。

- [x] **步骤 3：运行最小验证并提交**

```powershell
npx vitest run --configLoader runner tests/frontend/topic-panel-quote-flow.spec.ts tests/frontend/topic-panel-filter-draft.spec.ts
git diff --check
git commit -m "选题面板接入报价确认流程"
```

---

## 任务 3：script 面板接入报价流程

**文件：**

- 修改：`frontend/src/components/script/ScriptPanel.vue` + `frontend/src/stores/script.ts`
- 新建：`tests/frontend/script-panel-quote-flow.spec.ts`

- [x] **步骤 1：先写失败测试**

同任务 2 覆盖集（operation: script.generate；首稿与 regenerate 两个入口）。

- [x] **步骤 2：实现接入**

- [x] **步骤 3：运行最小验证并提交**

```powershell
npx vitest run --configLoader runner tests/frontend/script-panel-quote-flow.spec.ts
git diff --check
git commit -m "文案面板接入报价确认流程"
```

---

## 任务 4：storyboard 面板接入报价流程

**文件：**

- 修改：`frontend/src/components/storyboard/StoryboardPanel.vue` + `frontend/src/stores/storyboard.ts`
- 新建：`tests/frontend/storyboard-panel-quote-flow.spec.ts`

- [x] **步骤 1：先写失败测试**

同任务 2 覆盖集（operation: storyboard.generate；生成/分段重生入口）。

- [x] **步骤 2：实现接入**

- [x] **步骤 3：运行最小验证并提交**

```powershell
npx vitest run --configLoader runner tests/frontend/storyboard-panel-quote-flow.spec.ts
git diff --check
git commit -m "分镜面板接入报价确认流程"
```

---

## 任务 5：publish 面板接入报价流程

**文件：**

- 修改：`frontend/src/components/publish/PublishPanel.vue` + `frontend/src/stores/publish.ts`
- 新建：`tests/frontend/publish-panel-quote-flow.spec.ts`

- [x] **步骤 1：先写失败测试**

同任务 2 覆盖集（operation: publish.generate；发布包/封面两个入口）。

- [x] **步骤 2：实现接入**

- [x] **步骤 3：运行最小验证并提交**

```powershell
npx vitest run --configLoader runner tests/frontend/publish-panel-quote-flow.spec.ts
git diff --check
git commit -m "发布面板接入报价确认流程"
```

---

## 任务 6：收口（全量回归 + 文档 + 浏览器验收）

- [ ] **步骤 1：全量回归**

```powershell
npx vitest run --configLoader runner tests/frontend          # 前端全量
npx vitest run --configLoader runner tests/backend           # 后端全量（确认无回归）
npm run build:frontend
npx tsc -p backend/tsconfig.json --noEmit
npx tsc -p shared/tsconfig.json --noEmit
git diff --check
```

预期：全绿（既有基线失败登记除外）。

- [x] **步骤 2：文档同步**

`docs/architecture/api-design.md`（S2-2D 前端报价接入章节）、`docs/README.md`
（S2-2D 完成登记）、`docs/todos/roadmap-todo.md`（S2-2D 完成登记）。

- [ ] **步骤 3：浏览器验收**

真实部署（本机 .env 真实 LLM）内置浏览器验证四入口从"报错"变为"报价弹窗 → 确认 →
生成"；注册 Playwright 入口 `harness:s2-2d-browser-acceptance`（沿用 s2-2c 模式，
本机缺 Chromium 不实跑，标注"未验证"）；写
`docs/records/2026-08-22-s2-2d-inapp-browser-acceptance-record.md`；真实付费 live
不运行（标注未验证）。

- [x] **步骤 4：收口提交 + 计划归档**

```powershell
git commit -m "S2-2D 收口：全量回归、文档同步与浏览器验收记录"
```

设计 + 实施计划移入 `docs/plans/archive/`，`docs/plans/README.md` 状态更新。

---

## 阶段闸门提醒

- 任务 1→2：store 透传测试 + 四 store 既有测试全绿；任务 2→5：各自面板测试全绿；
  任务 5→6：publish 面板测试全绿。
- 涉及既有 store API 签名变化后必须回跑相关既有测试（topic/script/storyboard/publish
  面板既有 spec 不得有新增失败）。
