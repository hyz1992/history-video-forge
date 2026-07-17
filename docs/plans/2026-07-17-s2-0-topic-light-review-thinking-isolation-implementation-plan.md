# S2-0 Topic 轻审核 Thinking 隔离诊断实施计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 2 次固定输入真实请求隔离 `topic.light-review` 的 provider-default thinking 成本，并且只在语义与性能双门禁通过后为该精确 operation 关闭 thinking。

**Architecture:** 新增一个默认零请求的 Light-review-only harness，把既有人工复核的 2 个风险正例和 2 个 `none` 对照固化为唯一 id 的单一 4 候选 fixture。同一进程、同一 provider/gateway、共享两请求硬预算，串行运行 provider default 与 disabled；记录脱敏 attempt/token/耗时/verdict 后再决定是否修改 operation policy。

**Tech Stack:** TypeScript、Vitest、现有 Prompt Registry / LLM Gateway / OpenAI-compatible provider、Zod parser、JSON fixture、Markdown/JSON 脱敏报告。

---

## 文件结构

- Create: `harness/samples/topic-light-review-thinking-replay/task17-controls.fixture.json` — 固定 4 候选和人工静态 annotation。
- Create: `harness/scripts/runtime/topic-light-review-thinking-replay.ts` — dry-run guard、共享预算 A/B runner、比较器和脱敏报告。
- Create: `tests/harness/topic-light-review-thinking-replay.test.ts` — fixture、零请求、live guard、生产 schema/gateway、门禁和脱敏测试。
- Modify: `package.json` — 增加非默认 harness 命令。
- Modify if live gate passes: `tests/backend/runtime/llm-operation-policy.test.ts` — 先写精确 disabled 策略 RED。
- Modify if live gate passes: `backend/src/runtime/llm/operation-policy.ts` — 只增加 `topic.light-review=disabled`。
- Create: `docs/records/2026-07-17-topic-light-review-thinking-isolation-live-check.md` — 记录两轮真实证据和生产决策。
- Modify: `docs/plans/README.md`
- Modify: `docs/todos/roadmap-todo.md`

## Chunk 1: 固定 fixture 与零请求 harness

### Task 1: 固化唯一 id 的四项审核 fixture

**Files:**
- Create: `harness/samples/topic-light-review-thinking-replay/task17-controls.fixture.json`
- Create: `harness/scripts/runtime/topic-light-review-thinking-replay.ts`
- Test: `tests/harness/topic-light-review-thinking-replay.test.ts`

- [x] **Step 1: 写 fixture 加载失败测试**

断言加载后 candidate id 依次为 `high_tension_risk_jingkang`、`high_tension_none_xuanwumen`、`balanced_risk_hongmenyan`、`balanced_none_wugu`，全部唯一；人工期望为风险 2 项、`none` 2 项，并且每项有 rationale。

- [x] **Step 2: 运行测试确认 RED**

```powershell
npx vitest run --configLoader runner tests/harness/topic-light-review-thinking-replay.test.ts -t "loads four unique audited controls"
```

Expected: FAIL，fixture/loader 尚不存在。

- [x] **Step 3: 写最小 fixture 与 loader**

候选正文逐字段复制自 Task 17 两份源 fixture 的四项 annotation 对象，只替换 candidate id；不得改写候选内容或期望 enum。

- [x] **Step 4: 运行测试确认 GREEN**

使用 Step 2 同一命令，Expected: PASS。

### Task 2: 实现默认零请求 plan 与 live guard

**Files:**
- Modify: `harness/scripts/runtime/topic-light-review-thinking-replay.ts`
- Modify: `tests/harness/topic-light-review-thinking-replay.test.ts`
- Modify: `package.json`

- [x] **Step 1: 写 dry-run 与 guard 失败测试**

覆盖：默认不创建 live runner；plan 固定 `required_requests=2`；缺少 `--confirm-live`、模型不是 `glm-5.2`、预算不是 2、缺少正数成本声明时均在创建 provider 前失败。

- [x] **Step 2: 运行测试确认 RED**

```powershell
npx vitest run --configLoader runner tests/harness/topic-light-review-thinking-replay.test.ts -t "request guard"
```

Expected: FAIL，plan/guard 尚不存在。

- [x] **Step 3: 实现 plan、CLI parser、guard 和非默认 npm script**

命令名固定为：

```json
"harness:topic-light-review-thinking-replay": "tsx harness/scripts/runtime/topic-light-review-thinking-replay.ts"
```

默认运行只写 `replay-plan.json`，`actual_requests=0`。

- [x] **Step 4: 运行测试确认 GREEN**

运行本测试文件全部用例，Expected: PASS，未触发任何网络调用。

- [x] **Step 5: 提交 Chunk 1**

```powershell
git add -- harness/samples/topic-light-review-thinking-replay/task17-controls.fixture.json harness/scripts/runtime/topic-light-review-thinking-replay.ts tests/harness/topic-light-review-thinking-replay.test.ts package.json
git commit -m "新增选题轻审核推理隔离回放"
```

## Chunk 2: 严格 A/B runner 与脱敏门禁

### Task 3: 用生产 schema 和共享硬预算执行两轮

**Files:**
- Modify: `harness/scripts/runtime/topic-light-review-thinking-replay.ts`
- Modify: `tests/harness/topic-light-review-thinking-replay.test.ts`

- [x] **Step 1: 写生产路径失败测试**

通过真实 `createOpenAiCompatibleProvider` 加 mock `invokeStrictApi`，断言：

- 只创建一个 provider/gateway；
- 两次调用共享 `RequestBudget(maxRequests=2)`；
- 两轮均使用 `topic.light-review` Prompt、`TOPIC_LIGHT_REVIEW_STRICT_SCHEMA`、target tool 和 `maxAttempts=1`；
- 第一轮不发送 thinking，effective request 为 `provider_default`；
- 第二轮发送 `thinking=disabled`；
- 两轮输入、Prompt SHA、model、strategy、tool choice 和除 thinking 外的 effective request 完全相同；
- 总 attempt 恰为 2，不允许 fallback/retry。

- [x] **Step 2: 运行测试确认 RED**

```powershell
npx vitest run --configLoader runner tests/harness/topic-light-review-thinking-replay.test.ts -t "runs one shared-budget provider-default and disabled request"
```

Expected: FAIL，A/B runner 尚未实现。

- [x] **Step 3: 实现最小 live runner**

两轮使用相同诊断 operation name，避免未来生产 operation policy 改成 disabled 后污染 provider-default 对照；prompt id 仍为正式 `topic.light-review`。第一轮 invocation options 省略 thinking，第二轮显式 disabled。

- [x] **Step 4: 运行测试确认 GREEN**

使用 Step 2 同一命令，Expected: PASS。

### Task 4: 实现静态 annotation 比较和生产决策门禁

**Files:**
- Modify: `harness/scripts/runtime/topic-light-review-thinking-replay.ts`
- Modify: `tests/harness/topic-light-review-thinking-replay.test.ts`

- [x] **Step 1: 写语义、性能和脱敏失败测试**

覆盖：任一轮漏召回风险、误报 `none`、enum 不精确、coverage 不完整、effective thinking 不匹配、attempt 不是 1、Prompt SHA/其余参数漂移、default reasoning 不是明确正数、disabled reasoning 不是明确 0、disabled 未同时节省至少 `10s` 且降到 default 的 `60%` 以下时，`production_gate_passed=false`。duration、effective request、attempt、token、Prompt SHA 任一为 null 时必须 fail closed；报告不得包含候选正文、system prompt、raw output、API key 或 base URL。

- [x] **Step 2: 运行测试确认 RED**

```powershell
npx vitest run --configLoader runner tests/harness/topic-light-review-thinking-replay.test.ts -t "production gate"
```

Expected: FAIL，比较器/门禁尚不存在。

- [x] **Step 3: 实现只按 id 与静态 enum 比较的门禁**

不得读取 title/angle/正文决定标签；风险召回、exact enum 和 `none` 对照均从 fixture annotation 与 provider 返回值直接比较。

逐轮捕获异常并写脱敏失败结果，禁止 retry/fallback。首轮失败后可以继续第二轮，但最终门禁必为 false，总 attempt 不得超过共享预算 2。

- [x] **Step 4: 运行 harness 测试确认 GREEN**

```powershell
npx vitest run --configLoader runner tests/harness/topic-light-review-thinking-replay.test.ts
```

Expected: PASS。

- [x] **Step 5: 运行零请求 dry-run**

```powershell
npm run harness:topic-light-review-thinking-replay -- -- --output-dir harness/scripts/runtime/output/topic-light-review-thinking-replay/dry-run
```

Expected: `actual_requests=0`，只生成 plan。

- [x] **Step 6: 提交 Chunk 2**

```powershell
git add -- harness/scripts/runtime/topic-light-review-thinking-replay.ts tests/harness/topic-light-review-thinking-replay.test.ts package.json harness/samples/topic-light-review-thinking-replay/task17-controls.fixture.json
git commit -m "完善选题轻审核推理隔离门禁"
```

## Chunk 3: 两请求 live、条件生产落地与收口

### Task 5: 执行 exactly 2 次 GLM-5.2 live A/B

**Files:**
- Generate: `harness/scripts/runtime/output/topic-light-review-thinking-replay/20260717-ab/*`
- Create: `docs/records/2026-07-17-topic-light-review-thinking-isolation-live-check.md`

- [x] **Step 1: 确认非 live 回归和工作区边界**

```powershell
npx vitest run --configLoader runner tests/harness/topic-light-review-thinking-replay.test.ts tests/backend/topic/topic-light-review.test.ts tests/backend/runtime/llm-operation-policy.test.ts
npm run typecheck:backend
git status --short
```

- [x] **Step 2: 执行两请求 live**

```powershell
npm run harness:topic-light-review-thinking-replay -- -- --live --confirm-live --model glm-5.2 --max-requests 2 --max-cost-cny 1 --output-dir harness/scripts/runtime/output/topic-light-review-thinking-replay/20260717-ab
```

必须串行完成 provider-default 与 disabled，各一请求；任何失败都不得自动补请求。

- [x] **Step 3: 读取脱敏 summary 决策**

若 `production_gate_passed=true`，进入 Task 6；否则跳过生产代码修改，只执行 Task 7 记录失败边界。

### Task 6: 仅在主门通过后精确关闭 Light Review thinking

> 未执行：2026-07-17 live 的 `production_gate_passed=false`，按计划保留生产 operation policy 不变。

**Files:**
- Modify: `tests/backend/runtime/llm-operation-policy.test.ts`
- Modify: `backend/src/runtime/llm/operation-policy.ts`

- [ ] **Step 1: 写精确 operation policy RED**

```ts
expect(getOperationPolicy("topic.light-review").thinking).toBe("disabled");
expect(getOperationPolicy("publish.title-generator").thinking).toBeUndefined();
```

- [ ] **Step 2: 运行测试确认 RED**

```powershell
npx vitest run --configLoader runner tests/backend/runtime/llm-operation-policy.test.ts -t "topic.light-review"
```

Expected: FAIL，当前 thinking 为 undefined。

- [ ] **Step 3: 最小增加 approved override**

只增加：

```ts
"topic.light-review": "disabled",
```

- [ ] **Step 4: 运行测试确认 GREEN**

使用 Step 2 同一命令，Expected: PASS。

### Task 7: 完整验证、记录和中文提交

**Files:**
- Create: `docs/records/2026-07-17-topic-light-review-thinking-isolation-live-check.md`
- Modify: `docs/plans/README.md`
- Modify: `docs/todos/roadmap-todo.md`
- Modify: `docs/plans/2026-07-17-s2-0-topic-light-review-thinking-isolation-implementation-plan.md`

- [x] **Step 1: 记录逐轮证据和生产决策**

写明两轮 duration、attempt、effective thinking、prompt/completion/reasoning tokens、四项 verdict、语义门禁、性能门禁和是否修改生产；单次 A/B 不得表述为稳定分布。

- [x] **Step 2: 运行受影响矩阵**

```powershell
npx vitest run --configLoader runner tests/harness/topic-light-review-thinking-replay.test.ts tests/backend/topic/topic-light-review.test.ts tests/backend/topic/topic-runtime-recommendation.test.ts tests/backend/runtime/topic-prompt-contract.test.ts tests/backend/runtime/llm-operation-policy.test.ts tests/backend/api/topic-api-runtime.test.ts --no-file-parallelism
npx vitest run --configLoader runner harness/scripts/check-prompt-language.test.ts
npm run typecheck:backend
git diff --check
```

- [x] **Step 3: 自审边界**

确认 Builder/Light Review Prompt、schema、模型、max tokens、temperature、timeout、补充条件和用户未跟踪文件均未改动；输出目录只含脱敏结果。

- [x] **Step 4: 中文提交**

若主门通过并落地：

```powershell
git add -- backend/src/runtime/llm/operation-policy.ts tests/backend/runtime/llm-operation-policy.test.ts docs/records/2026-07-17-topic-light-review-thinking-isolation-live-check.md docs/plans/README.md docs/todos/roadmap-todo.md docs/plans/2026-07-17-s2-0-topic-light-review-thinking-isolation-implementation-plan.md harness/scripts/runtime/output/topic-light-review-thinking-replay/20260717-ab
git commit -m "关闭选题轻审核推理并记录隔离验证"
```

若主门失败：不暂存 operation policy 文件，只提交真实记录、状态文档和脱敏输出，提交信息使用“记录选题轻审核推理隔离结果”。
