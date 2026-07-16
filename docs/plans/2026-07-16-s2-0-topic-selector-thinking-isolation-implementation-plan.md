# S2-0 Topic Selector 推理预算隔离与召回修复实施计划

> **For agentic workers:** REQUIRED: Use `superpowers:subagent-driven-development` (if subagents available and project rules allow) or `superpowers:executing-plans` to implement this plan. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 在完全相同的两份固定 Selector 输入上隔离验证 `thinking=enabled`，通过风险 `2/2`、`none` `2/2`、结构 `2/2` 闸门后，把 enabled 写入 `topic.selector` 精确 operation policy，并保持 8/4、prompt、compact DTO、parser、selection、API 与下游合同不变。

**Architecture:** 先扩展现有 Selector-only replay，使 CLI、dry-run、live runner、脱敏 summary 都显式携带 requested thinking，并把 effective thinking 纳入主闸门；这一提交不改生产。随后执行 exactly 2 次 GLM-5.2 live。只有 live 通过，才由 operation policy 统一为 strict 和 structured fallback 提供 `topic.selector=enabled`，移除 strict 调用处的硬编码覆盖。

**Tech Stack:** TypeScript、Node.js、Vitest、Zod strict tool schema、Prompt Registry、OpenAI-compatible GLM-5.2 gateway、Markdown 状态文档。

**设计依据：** `docs/plans/2026-07-16-s2-0-topic-selector-thinking-isolation-design.md`

---

## Chunk 1：诊断入口与单变量 live

### Task 1：冻结工作区与测试入口

**Files:**

- Read only: `docs/plans/2026-07-16-s2-0-topic-selector-thinking-isolation-design.md`
- Read only: `harness/scripts/runtime/topic-selector-semantic-replay.ts`
- Read only: `tests/harness/topic-selector-semantic-replay.test.ts`

- [x] **Step 1：确认只存在用户排除的未跟踪文件**

Run:

```powershell
git status --short
```

Expected：只看到以下两个用户文件，另加本实施计划（提交后不再出现）：

```text
?? docs/plans/2026-07-15-trae-s2-0b-task10-launch-prompt.md
?? docs/plans/2026-07-16-codex-s2-0-compact-verdict-launch-prompt.md
```

- [x] **Step 2：确认当前失败证据仍指向 thinking disabled**

Run:

```powershell
Get-Content -Raw harness/scripts/runtime/output/topic-selector-semantic-replay/replay-summary.json
```

Expected：`recalled_risk_count=0`、`passed_none_control_count=2`、`primary_gate_passed=false`，两份 observation 的 effective thinking 均为 `disabled`。

### Task 2：先写 replay thinking 契约红灯

**Files:**

- Modify: `tests/harness/topic-selector-semantic-replay.test.ts`
- Test: `tests/harness/topic-selector-semantic-replay.test.ts`

Use: `@superpowers:test-driven-development`

- [x] **Step 1：扩展测试辅助 observation**

让 `createObservation()` 接受 thinking 参数：

```ts
function createObservation(
  fixtureId: string,
  thinking: "enabled" | "disabled" = "disabled",
) {
  return {
    // existing fields
    effective_request: {
      strategy: "tool_call",
      thinking,
      toolChoice: "target_function",
      maxAttempts: 1,
    },
    // existing fields
  };
}
```

- [x] **Step 2：为 CLI 与 dry-run 写红灯**

新增断言：

```ts
expect(
  parseTopicSelectorSemanticReplayArgs(["--thinking=enabled"]),
).toMatchObject({ thinking: "enabled" });

expect(
  buildTopicSelectorSemanticReplayPlan({ thinking: "enabled" }),
).toMatchObject({ requested_thinking: "enabled", actual_requests: 0 });

expect(() =>
  parseTopicSelectorSemanticReplayArgs(["--thinking=provider_default"]),
).toThrow("topic_selector_semantic_replay_thinking_invalid");
```

- [x] **Step 3：为 live 参数护栏写红灯**

现有所有合法 live stub 输入显式补 `thinking: "disabled"`；新增缺少 thinking 的拒绝用例：

```ts
await expect(
  runTopicSelectorSemanticReplay({
    live: true,
    confirmLive: true,
    model: "glm-5.2",
    maxRequests: 2,
    maxCostCny: 10,
  }),
).rejects.toThrow("topic_selector_semantic_replay_thinking_required");
```

- [x] **Step 4：为 runner 单变量透传写红灯**

把真实 gateway 接线测试改为：

```ts
const runner = createTopicSelectorSemanticReplayLiveRunner(
  "glm-5.2",
  "enabled",
  { createProvider: () => provider },
);

expect(capturedRequest?.options).toMatchObject({
  strategy: "tool_call",
  thinking: "enabled",
  toolChoice: "target_function",
});
expect(result.observation.effective_request).toMatchObject({
  maxAttempts: 1,
  thinking: "enabled",
});
```

- [x] **Step 5：为 summary 和 effective thinking 闸门写红灯**

合法 stub live 传 `thinking: "enabled"`，两份 observation 也返回 enabled，断言：

```ts
expect(result).toMatchObject({
  requested_thinking: "enabled",
  effective_thinking_match_count: 2,
  primary_gate_passed: true,
});
```

另建一个语义标签全部命中、但 observation 仍返回 disabled 的用例，断言：

```ts
expect(result).toMatchObject({
  requested_thinking: "enabled",
  effective_thinking_match_count: 0,
  primary_gate_passed: false,
});
```

- [x] **Step 6：运行红灯**

Run:

```powershell
npx vitest run --configLoader runner tests/harness/topic-selector-semantic-replay.test.ts --no-file-parallelism
```

Expected：FAIL，原因只包括 `thinking` 参数/字段/校验尚不存在或 runner 签名未更新；不得是 fixture 或环境故障。

### Task 3：最小实现 replay thinking 控制

**Files:**

- Modify: `harness/scripts/runtime/topic-selector-semantic-replay.ts`
- Test: `tests/harness/topic-selector-semantic-replay.test.ts`

- [x] **Step 1：引入正式 thinking 类型并扩展输入/输出合同**

从 provider contract 引入：

```ts
import type {
  StrictStructuredThinking,
  StructuredPromptProvider,
} from "../../../backend/src/runtime/llm/provider-contract.js";
```

扩展类型：

```ts
export interface TopicSelectorSemanticReplayInput {
  // existing fields
  thinking?: StrictStructuredThinking;
}

export interface TopicSelectorSemanticReplayPlan {
  // existing fields
  requested_thinking: StrictStructuredThinking | null;
}

export interface TopicSelectorSemanticReplaySummary {
  // existing fields
  requested_thinking: StrictStructuredThinking;
  effective_thinking_match_count: number;
}

export interface TopicSelectorSemanticReplayDependencies {
  createLiveRunner?: (
    model: string,
    thinking: StrictStructuredThinking,
  ) => TopicSelectorSemanticReplayLiveRunner;
}
```

- [x] **Step 2：解析并验证 CLI**

实现：

```ts
function readThinking(
  value: string | undefined,
): StrictStructuredThinking | undefined {
  if (value === undefined) return undefined;
  if (value === "enabled" || value === "disabled") return value;
  throw new Error("topic_selector_semantic_replay_thinking_invalid");
}
```

在 `parseTopicSelectorSemanticReplayArgs()` 写入：

```ts
thinking: readThinking(readCliValue(argv, "--thinking")),
```

在 `validateLiveInput()` 中加入：

```ts
if (!input.thinking) {
  throw new Error("topic_selector_semantic_replay_thinking_required");
}
```

- [x] **Step 3：透传给 runner**

签名改为：

```ts
export function createTopicSelectorSemanticReplayLiveRunner(
  model: string,
  thinking: StrictStructuredThinking,
  dependencies: TopicSelectorSemanticReplayLiveRunnerDependencies = {},
): TopicSelectorSemanticReplayLiveRunner
```

strict options 使用：

```ts
thinking,
```

`runTopicSelectorSemanticReplay()` 在 live 校验后调用：

```ts
const runner =
  dependencies.createLiveRunner?.(input.model!, input.thinking!) ??
  createTopicSelectorSemanticReplayLiveRunner(input.model!, input.thinking!);
```

- [x] **Step 4：把 requested/effective thinking 写入计划和闸门**

plan 写入：

```ts
requested_thinking: input.thinking ?? null,
```

统计：

```ts
const effectiveThinkingMatchCount = results.filter(
  (result) =>
    result.observation?.effective_request?.thinking === input.thinking,
).length;
```

主闸门追加：

```ts
effectiveThinkingMatchCount === fixtures.length
```

summary 和 `trace.md` 写入 `requested_thinking` 与 `effective_thinking_match_count`。CLI 的 dry-run/live 精简 stdout 同样打印 requested thinking。

- [x] **Step 5：运行最小绿灯**

Run:

```powershell
npx vitest run --configLoader runner tests/harness/topic-selector-semantic-replay.test.ts --no-file-parallelism
```

Expected：该文件全部通过。

- [x] **Step 6：运行 dry-run，确认零请求**

Run:

```powershell
npx tsx harness/scripts/runtime/topic-selector-semantic-replay.ts --thinking=enabled
```

Expected：`mode=topic_selector_semantic_replay_plan`、`requested_thinking=enabled`、`required_requests=2`、`actual_requests=0`。

- [x] **Step 7：提交诊断入口**

```powershell
git add -- harness/scripts/runtime/topic-selector-semantic-replay.ts tests/harness/topic-selector-semantic-replay.test.ts
git diff --cached --check
git commit -m "支持选题回放隔离推理开关"
```

### Task 4：执行 thinking-enabled 固定 live

**Files:**

- Generated/ignored: `harness/scripts/runtime/output/topic-selector-semantic-replay/replay-plan.json`
- Generated/ignored: `harness/scripts/runtime/output/topic-selector-semantic-replay/replay-summary.json`
- Generated/ignored: `harness/scripts/runtime/output/topic-selector-semantic-replay/trace.md`
- Generated/ignored: `harness/scripts/runtime/output/topic-selector-semantic-replay/*.result.json`

- [x] **Step 1：确认环境与 dry-run**

Run:

```powershell
npx tsx harness/scripts/runtime/topic-selector-semantic-replay.ts --thinking=enabled
```

Expected：0 请求。不得在输出中打印 API key 或完整 prompt。

- [x] **Step 2：执行 exactly 2 requests**

Run:

```powershell
npx tsx harness/scripts/runtime/topic-selector-semantic-replay.ts --live --confirm-live --model=glm-5.2 --thinking=enabled --max-requests=2 --max-cost-cny=10 --output-dir=harness/scripts/runtime/output/topic-selector-semantic-replay/thinking-enabled-20260716
```

Expected：实际请求 2；无自动重跑、Builder、数据库或浏览器操作。

- [x] **Step 3：读取脱敏 summary 并逐项判闸门**

Run:

```powershell
Get-Content -Raw harness/scripts/runtime/output/topic-selector-semantic-replay/replay-summary.json
```

Pass 条件：

```text
requested_thinking = enabled
effective_thinking_match_count = 2
actual_requests = 2
recalled_risk_count = 2
passed_none_control_count = 2
primary_gate_passed = true
results[*].structural_failed = false
```

若不满足：停止生产策略 Task 5，不再追加 prompt 或请求；只记录失败证据。

---

## Chunk 2：live 通过后的生产修复

### Task 5：先写精确 operation policy 红灯

**Precondition:** Task 4 主闸门通过。若未通过，本 Task 不执行。

**Files:**

- Modify: `tests/backend/runtime/llm-operation-policy.test.ts`
- Modify: `tests/backend/topic/topic-runtime-recommendation.test.ts`

Use: `@superpowers:test-driven-development`

- [x] **Step 1：更新未批准列表**

从 `unapprovedOperations` 移除 `topic.selector`，其他 operation 保持不变。

- [x] **Step 2：新增精确 enabled 期望**

```ts
expect(getOperationPolicy("topic.selector").thinking).toBe("enabled");
expect(getOperationPolicy("publish.title-generator").thinking).toBeUndefined();
expect(getOperationPolicy("probe.strict-tool-call").thinking).toBeUndefined();
```

同时用 `resolveEffectiveRequest()` 证明无 invocation override 时 Selector strict/fallback 的 effective thinking 为 enabled。

- [x] **Step 3：更新 production strict 请求期望**

在 `uses strict structured invocation for topic.selector...` 中不再期待 invocation options 硬编码 thinking：

```ts
expect(selectorRequest?.options).toMatchObject({
  strategy: "tool_call",
  toolChoice: "target_function",
});
expect(selectorRequest?.options).not.toHaveProperty("thinking");
```

- [x] **Step 4：运行红灯**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/runtime/llm-operation-policy.test.ts tests/backend/topic/topic-runtime-recommendation.test.ts --no-file-parallelism
```

Expected：FAIL，原因是 policy 尚未返回 enabled，且 service 仍显式发送 disabled。

### Task 6：实现精确生产修复

**Files:**

- Modify: `backend/src/runtime/llm/operation-policy.ts`
- Modify: `backend/src/modules/topic/topic-recommendation.service.ts`
- Test: `tests/backend/runtime/llm-operation-policy.test.ts`
- Test: `tests/backend/topic/topic-runtime-recommendation.test.ts`

- [x] **Step 1：批准精确 operation override**

在 `APPROVED_THINKING_OVERRIDE` 中增加：

```ts
"topic.selector": "enabled",
```

更新紧邻中文注释，明确证据来自本计划的两份固定 Selector-only live，不扩展到 operation class。

- [x] **Step 2：移除 strict invocation 硬编码**

从 `invokeTopicSelector()` strict options 删除：

```ts
thinking: "disabled",
```

保留：

```ts
strategy: "tool_call",
toolChoice: "target_function",
```

这样 strict 由 operation policy 解析 enabled；fallback 的 promptId/operationName 仍为 `topic.selector`，同样继承 enabled。

- [x] **Step 3：运行绿灯**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/runtime/llm-operation-policy.test.ts tests/backend/topic/topic-runtime-recommendation.test.ts --no-file-parallelism
```

Expected：两文件全部通过。

- [x] **Step 4：提交生产修复**

```powershell
git add -- backend/src/runtime/llm/operation-policy.ts backend/src/modules/topic/topic-recommendation.service.ts tests/backend/runtime/llm-operation-policy.test.ts tests/backend/topic/topic-runtime-recommendation.test.ts
git diff --cached --check
git commit -m "启用选题选择器精确推理策略"
```

### Task 7：完整非 live 回归

**Files:**

- Verify only: affected backend/harness tests

- [x] **Step 1：运行最小合同矩阵**

Run:

```powershell
npx vitest run --configLoader runner tests/harness/topic-selector-semantic-replay.test.ts tests/backend/runtime/llm-operation-policy.test.ts tests/backend/runtime/topic-prompt-contract.test.ts tests/backend/topic/topic-runtime-recommendation.test.ts --no-file-parallelism
```

Expected：全部通过。

- [x] **Step 2：运行受影响 17 文件矩阵**

Run:

```powershell
npx vitest run --configLoader runner tests/harness/topic-selector-semantic-replay.test.ts tests/backend/topic/topic-selector-prompt-projection.test.ts tests/backend/topic/topic-runtime-recommendation.test.ts tests/backend/runtime/topic-prompt-contract.test.ts tests/backend/runtime/topic-event-identity-prompt-contract.test.ts tests/backend/runtime/prompt-runtime.test.ts tests/backend/runtime/provider-hardening.test.ts tests/backend/runtime/llm-operation-policy.test.ts tests/backend/runtime/topic-script-graph.test.ts tests/backend/api/topic-api-runtime.test.ts tests/backend/script/script-runtime-generate.test.ts tests/backend/storyboard/storyboard-generation.test.ts tests/backend/asset-planning/asset-planning-generation.test.ts tests/backend/asset-planning/asset-planning-structural-repair.test.ts harness/scripts/check-prompt-language.test.ts harness/scripts/runtime/llm-s2-baseline.test.ts harness/scripts/runtime/llm-s2-baseline-stub.test.ts --no-file-parallelism
```

Expected：17 个文件全部通过（修改前基线为 299/299；新增测试后记录实际计数）；不得写入或暂存 `storage/topic-candidate-library/`。

- [x] **Step 3：类型检查**

Run:

```powershell
npm run typecheck:backend
```

Expected：exit 0。

- [x] **Step 4：最终 dry-run**

Run:

```powershell
npx tsx harness/scripts/runtime/topic-selector-semantic-replay.ts --thinking=enabled
```

Expected：0 请求，requested thinking 为 enabled。

### Task 8：记录真实结果和状态

**Files:**

- Modify: `harness/docs/s2-0-baseline-protocol.md`
- Modify: `docs/plans/README.md`
- Modify: `docs/todos/roadmap-todo.md`
- Modify: `docs/plans/2026-07-16-s2-0-topic-selector-thinking-isolation-implementation-plan.md`

- [x] **Step 1：记录 live 数字，不复制 raw output**

在 baseline protocol 追加中文小节，至少记录：

- 提交基线、prompt hash、fixture 数、requested/effective thinking；
- 两份结构状态；
- 靖康与鸿门宴实际 issue；
- 玄武门与巫蛊实际 issue；
- duration、prompt/completion/reasoning tokens、arguments chars；
- 风险召回、`none` 对照、exact enum 和主闸门；
- 与 disabled 上一轮的方向性成本对比；
- 两样本只能证明固定回归集，不宣称全分布稳定。

- [x] **Step 2：更新当前入口**

`docs/plans/README.md` 与 `docs/todos/roadmap-todo.md` 应说明：

- 问题位于 Selector 语义召回，不是 8 候选生成；
- Task 16 disabled 只证明部分显式风险命中；
- thinking-enabled 固定回放的真实结果；
- 若通过，精确 operation policy 已启用且不增加请求；
- S2-0 是否收口必须按真实结果表述，不自动进入 S2-1。

- [x] **Step 3：回填本计划 checkbox 和执行结果**

将已执行步骤标记 `[x]`，附真实命令和计数；未执行或失败步骤保持 `[ ]` 并写原因。

- [x] **Step 4：提交记录**

```powershell
git add -- harness/docs/s2-0-baseline-protocol.md docs/plans/README.md docs/todos/roadmap-todo.md docs/plans/2026-07-16-s2-0-topic-selector-thinking-isolation-implementation-plan.md
git diff --cached --check
git commit -m "记录选题推理召回修复结果"
```

### Task 9：完成前验证与自审

**Files:**

- Verify only: Git worktree and committed diff

Use: `@superpowers:verification-before-completion`

- [x] **Step 1：复跑关键验证**

至少重新运行：

```powershell
npx vitest run --configLoader runner tests/harness/topic-selector-semantic-replay.test.ts tests/backend/runtime/llm-operation-policy.test.ts tests/backend/runtime/topic-prompt-contract.test.ts tests/backend/topic/topic-runtime-recommendation.test.ts --no-file-parallelism
npm run typecheck:backend
npx tsx harness/scripts/runtime/topic-selector-semantic-replay.ts --thinking=enabled
git diff --check
```

- [x] **Step 2：检查提交范围**

Run:

```powershell
git status --short
git log -6 --oneline
```

Expected：只剩用户明确排除的两个未跟踪文件；不得出现 candidate library、runtime output 或 raw provider 文件。

- [x] **Step 3：逐项自审**

确认：

- 没有关键词/字符串/正则/相似度语义判断；
- 没有把 fixture 标签接入生产；
- 没有新增第三次调用；
- 没有改变 prompt、compact DTO、parser、selection、API/downstream；
- enabled 只作用于精确 `topic.selector`；
- strict 和 fallback 都通过同一 operation policy；
- live 失败时没有把未经验证的策略写入生产。

## 验收清单

- [x] 已回答问题位于 Selector 8 选 4 的语义判断，不是 Builder 生成 8 项。
- [x] 已找到并记录 Task 16 `6b9934b` / `1d56e75` 的 disabled 对比及其漏判边界。
- [x] replay CLI 显式支持且校验 enabled/disabled。
- [x] dry-run 仍为 0 请求并记录 requested thinking。
- [x] live exactly 2 requests，effective enabled `2/2`。
- [x] 结构 `2/2`、风险 `2/2`、`none` `2/2`。
- [x] live 通过后才写入精确 production operation policy。
- [x] strict 不再用 invocation options 遮蔽 policy，fallback 同样继承 enabled。
- [x] 没有本地语义规则、第三次 LLM 调用或下游合同变化。
- [x] 最小/受影响回归、typecheck、dry-run、diff check 通过。
- [x] 未触碰或提交两个排除文件、candidate library、runtime output 或 raw provider 数据。

## 实际执行结果

- 设计提交：`58b73db`；实施计划提交：`1c30d11`。
- Replay TDD RED 为 22 项中 8 项失败，GREEN 为 22/22；诊断入口提交：`8285d4d`。
- 本机 npm 11.5.1 会吞脚本后的 `--thinking` 参数，故按验证结果把计划命令更正为直接 `npx tsx`。最终 dry-run 为 requested enabled、fixture 2、required requests 2、actual requests 0。
- Live 实际 2 请求：requested/effective enabled 2/2、结构 2/2、风险 2/2、`none` 2/2、exact enum 2/2、主闸门通过。高张力 220.948 秒、4435/11317/10115 tokens；均衡叙事 203.383 秒、4586/10411/9213 tokens。
- Production TDD RED 为 85 项中 3 项失败，GREEN 为 85/85；生产策略提交：`7fc96f9`。
- 直接受影响合同 4 文件 137/137；完整矩阵 17 文件 302/302；`npm run typecheck:backend` 通过；prompt language 包含在完整矩阵内并通过。
- 生产改动只有精确 `topic.selector=enabled` 与删除 strict 的 disabled invocation override；Builder、8/4、prompt、compact DTO、parser、selection、API、前端、downstream 和 semantic reviewer 均未改。
- 未触碰、暂存或提交两个用户排除文件、`storage/topic-candidate-library/`、runtime output、raw provider 数据或凭据。
