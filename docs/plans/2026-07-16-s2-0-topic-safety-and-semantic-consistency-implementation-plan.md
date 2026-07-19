# S2-0 Topic 首次安全表达与语义一致性优化实施计划

> **供 agentic worker 使用：** REQUIRED：使用 `superpowers:test-driven-development` 按红灯、最小实现、绿灯顺序执行。当前任务未授权子 agent，使用 `superpowers:executing-plans` 在当前会话逐批执行并保留检查点。所有步骤使用复选框跟踪。

**目标：**让 `topic.candidate-builder` 首次请求即遵守供应商安全的中文历史策划表达，保留一次受控 1301 重生成，同时让 selector 对标题、主体、动作、因果和叙事节点的内部矛盾进行语义扣分。

**架构：**正式语义规则只写入 `prompts/topic/`；topic service 的 safety retry 只传结构化 reason/mode，不再在业务代码注入英文自然语言指令。现有 `RequestBudget` 继续作为普通/strict HTTP attempt 的唯一请求硬闸门，后续真实页面验收通过进程环境显式设置最大请求数。

**技术栈：**TypeScript、Vitest、Zod、Prompt Registry、OpenAI-compatible provider、现有 Topic Recommendation Graph。

---

## Chunk 1：首次安全表达与受控 retry

### Task 1：前置 Candidate Builder 安全表达

**文件：**

- 修改：`tests/backend/runtime/prompt-runtime.test.ts`
- 修改：`tests/backend/api/topic-api-runtime.test.ts`
- 修改：`prompts/topic/candidate-builder.prompt.md`
- 修改：`backend/src/modules/topic/topic-recommendation.service.ts`

- [x] **Step 1：为正式 builder prompt 写红灯测试**

在 `tests/backend/runtime/prompt-runtime.test.ts` 增加独立用例：

```ts
it("keeps high-tension history concrete while using provider-safe planning language", () => {
  const prompt = createPromptRegistry().getPrompt("topic.candidate-builder");

  expect(prompt.metadata.language).toBe("zh-CN");
  expect(prompt.body).toContain("保留具体人物");
  expect(prompt.body).toContain("明确赌注");
  expect(prompt.body).toContain("不展开具体血腥");
  expect(prompt.body).toContain("strict_neutral_historical_planning");
  expect(prompt.body).toContain("不得因为安全表达");
});
```

该测试只验证 prompt 合同是否存在，不用于在本地判断真实候选质量。

- [x] **Step 2：为 1301 retry 元数据写红灯测试**

扩展 `tests/backend/api/topic-api-runtime.test.ts` 现有 `retries provider content filter rejection once before failing the topic flow` 用例：

```ts
expect(builderCalls[1]?.[0].input).toMatchObject({
  safety_retry_context: {
    reason: "provider_content_filter",
    mode: "strict_neutral_historical_planning",
  },
});
expect(
  (builderCalls[1]?.[0].input as {
    safety_retry_context?: { instruction?: unknown };
  }).safety_retry_context?.instruction,
).toBeUndefined();
```

继续保留既有断言：首次调用不带 `safety_retry_context`，只有识别为供应商内容过滤的错误才执行一次 safety retry。

- [x] **Step 3：运行红灯并核对失败原因**

运行：

```powershell
npx vitest run --configLoader runner tests/backend/runtime/prompt-runtime.test.ts tests/backend/api/topic-api-runtime.test.ts --no-file-parallelism
```

预期：

- prompt 用例因缺少首次安全表达段落失败；
- API 用例因 retry context 缺少 `mode` 且仍包含 `instruction` 失败；
- 不允许出现导入错误、fixture 错误或其他无关失败。

- [x] **Step 4：最小修改正式中文 builder prompt**

在 `prompts/topic/candidate-builder.prompt.md` 增加一个短小的“供应商安全表达边界”段落，要求：

```md
## 供应商安全表达边界

- 必须保留具体人物、对抗力量、关键动作、明确赌注和故事余震，不得把高张力事件写成抽象主题或无动作概括。
- 使用中性的历史叙事策划语言，不展开具体血腥、尸体、酷刑、肢体伤害细节或猎奇化处决画面；通过决策、压力、场景和后果保持张力。
- 不得因为安全表达而删掉关键行动主体、因果关系或历史后果。
- 当输入包含 `safety_retry_context.mode=strict_neutral_historical_planning` 时，进一步压缩物理伤害描写，只保留理解事件所必需的行动、压力与后果。
```

新增约束前检查现有 prompt，删除或合并与该段重复的表达，不堆叠同义口号，不修改输出骨架、字段和8候选要求。

- [x] **Step 5：最小修改 safety retry context**

在 `backend/src/modules/topic/topic-recommendation.service.ts` 把：

```ts
const safetyRetryContext = {
  reason: "provider_content_filter",
  instruction: "Use neutral historical-video planning language...",
};
```

改为：

```ts
const safetyRetryContext = {
  reason: "provider_content_filter",
  mode: "strict_neutral_historical_planning",
} as const;
```

不得修改 `isProviderContentFilterError()` 的识别范围，不增加 retry 次数，不把 safety retry 下沉为 provider 自动 retry。

- [x] **Step 6：运行绿灯与英文散落检查**

运行：

```powershell
npx vitest run --configLoader runner tests/backend/runtime/prompt-runtime.test.ts tests/backend/api/topic-api-runtime.test.ts --no-file-parallelism
rg -n "Use neutral historical-video planning language" backend/src prompts
```

预期：测试通过；`rg` 无输出。

- [x] **Step 7：中文提交 Task 1**

```powershell
git add prompts/topic/candidate-builder.prompt.md backend/src/modules/topic/topic-recommendation.service.ts tests/backend/runtime/prompt-runtime.test.ts tests/backend/api/topic-api-runtime.test.ts
git commit -m "前置Topic构建器安全表达"
```

## Chunk 2：Selector 语义一致性保护

### Task 2：让 Selector 对内部矛盾扣分

**文件：**

- 修改：`tests/backend/runtime/prompt-runtime.test.ts`
- 修改：`prompts/topic/selector.prompt.md`

- [x] **Step 1：写 selector prompt 红灯测试**

在 `tests/backend/runtime/prompt-runtime.test.ts` 增加：

```ts
it("asks the selector to penalize internal subject action and outcome conflicts", () => {
  const prompt = createPromptRegistry().getPrompt("topic.selector");

  expect(prompt.metadata.language).toBe("zh-CN");
  expect(prompt.body).toContain("行为主体");
  expect(prompt.body).toContain("关键动作");
  expect(prompt.body).toContain("因果关系");
  expect(prompt.body).toContain("`source_or_scope_risk`");
  expect(prompt.body).toContain("不得改写候选");
});
```

- [x] **Step 2：运行红灯**

```powershell
npx vitest run --configLoader runner tests/backend/runtime/prompt-runtime.test.ts --no-file-parallelism
```

预期：新用例因 selector prompt 缺少内部一致性规则而失败。

- [x] **Step 3：最小修改 selector prompt**

在 `prompts/topic/selector.prompt.md` 的排序原则中加入：

```md
- 对照 `title`、`one_line_angle`、`core_conflict`、`strong_scene` 与 `must_cover_preview`，检查行为主体、关键动作、因果关系和事件结局是否内部一致。
- 如果标题声称的执行者、动作或结局与候选正文证据冲突，必须在 `source_or_scope_risk` 轴扣分并写明矛盾；不得自行改写候选来掩盖问题。
```

不得新增 deduction axis、tool 字段、本地 validator 或自动淘汰门禁。

- [x] **Step 4：运行绿灯与 topic prompt focused 回归**

```powershell
npx vitest run --configLoader runner tests/backend/runtime/prompt-runtime.test.ts tests/backend/topic/topic-runtime-recommendation.test.ts --no-file-parallelism
```

预期：prompt runtime 与 topic runtime 全绿；selector strict schema、target tool 和 fallback 合同无变化。

- [x] **Step 5：中文提交 Task 2**

```powershell
git add prompts/topic/selector.prompt.md tests/backend/runtime/prompt-runtime.test.ts
git commit -m "补充Topic选择器语义一致性检查"
```

## Chunk 3：显式预算验收入口

### Task 3：记录并验证现有共享 RequestBudget

**文件：**

- 修改：`tests/backend/runtime/provider-hardening.test.ts`
- 修改：`.env.example`
- 修改：`harness/README.md`

- [x] **Step 1：增加普通与 strict 路径共享预算的特征测试**

在 `tests/backend/runtime/provider-hardening.test.ts` 使用同一个 provider 和 `createRequestBudget({ maxRequests: 2 })`：

- 第一次 `invokeStructuredPrompt()` 成功；
- 第二次 `invokeStrictStructured()` 成功；
- 第三次任一路径抛 `budget_exceeded`；
- 普通与 strict fake API 合计只被调用 2 次。

参考实现：

```ts
it("shares one request budget across structured and strict invocations", async () => {
  const invokeApi = vi.fn(async () => ({
    rawOutput: '{"ok":true}',
    content: '{"ok":true}',
    metadata: {},
  }));
  const invokeStrictApi = vi.fn(async () => ({
    rawOutput: "{}",
    argumentsJson: '{"ranked_candidates":[]}',
    metadata: {},
  }));
  const provider = createOpenAiCompatibleProvider({
    model: "glm-5.2",
    requestBudget: createRequestBudget({ maxRequests: 2 }),
    invokeApi,
    invokeStrictApi,
  });
  const registry = createPromptRegistry();

  await provider.invokeStructuredPrompt({
    prompt: registry.getPrompt("topic.candidate-builder"),
    input: { seed: "slot-1" },
    operationName: "topic.candidate-builder",
  });
  expect(provider.invokeStrictStructured).toBeDefined();
  await provider.invokeStrictStructured!({
    prompt: registry.getPrompt("topic.selector"),
    input: { selector_pool: [] },
    operationName: "topic.selector",
    schema: {
      name: "rank_topic_candidates",
      description: "test schema",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
    parse: (value) => value,
    options: {
      strategy: "tool_call",
      toolChoice: "target_function",
    },
  });

  await expect(
    provider.invokeStructuredPrompt({
      prompt: registry.getPrompt("topic.candidate-builder"),
      input: { seed: "slot-3" },
      operationName: "topic.candidate-builder",
    }),
  ).rejects.toMatchObject({ code: "budget_exceeded" });

  expect(invokeApi).toHaveBeenCalledTimes(1);
  expect(invokeStrictApi).toHaveBeenCalledTimes(1);
});
```

这是对现有能力的特征测试，预期首次即通过；不得为了制造红灯修改生产实现。

- [x] **Step 2：运行共享预算特征测试**

```powershell
npx vitest run --configLoader runner tests/backend/runtime/provider-hardening.test.ts --no-file-parallelism
```

预期：通过，证明无需新增第二套 budget。

- [x] **Step 3：补充显式环境示例与真实页面启动说明**

在 `.env.example` 的 LLM timeout 附近增加：

```dotenv
# Per-provider-instance HTTP request budget. Live acceptance must set this to the explicitly authorized maximum.
LLM_REQUEST_BUDGET_MAX_REQUESTS=20
```

在 `harness/README.md` S2-0 章节补充：

- harness 自身的 `--max-requests` 只约束 harness runner；
- 真实页面验收必须在启动 backend 前设置 `LLM_REQUEST_BUDGET_MAX_REQUESTS=<授权值>`；
- 以最多2次为例：

```powershell
$env:LLM_REQUEST_BUDGET_MAX_REQUESTS="2"
npm run dev:backend
```

- 验收结束后重新启动 backend，避免临时预算继续影响日常开发；
- 不提交包含 API key 的 `.env`。

- [x] **Step 4：验证配置文档和预算测试**

```powershell
npx vitest run --configLoader runner tests/backend/runtime/provider-hardening.test.ts tests/backend/runtime/env-loading.test.ts --no-file-parallelism
git diff --check
```

预期：测试和 diff check 通过。

- [x] **Step 5：中文提交 Task 3**

```powershell
git add tests/backend/runtime/provider-hardening.test.ts .env.example harness/README.md
git commit -m "明确Topic真实验收请求预算"
```

## Chunk 4：完整非 live 收口

### Task 4：回归、状态文档与停止边界

**文件：**

- 修改：`docs/plans/2026-07-16-s2-0-topic-safety-and-semantic-consistency-implementation-plan.md`
- 修改：`docs/plans/README.md`
- 修改：`docs/todos/roadmap-todo.md`
- 修改：`harness/docs/s2-0-baseline-protocol.md`

- [x] **Step 1：运行完整 S2-0 非 live 回归**

```powershell
npx vitest run --configLoader runner tests/backend/runtime/provider-hardening.test.ts tests/backend/runtime/env-loading.test.ts tests/backend/runtime/prompt-runtime.test.ts tests/backend/runtime/llm-operation-policy.test.ts tests/backend/runtime/topic-script-graph.test.ts tests/backend/topic/topic-runtime-recommendation.test.ts tests/backend/script/script-runtime-generate.test.ts tests/backend/storyboard/storyboard-generation.test.ts tests/backend/asset-planning/asset-planning-generation.test.ts tests/backend/asset-planning/asset-planning-structural-repair.test.ts tests/backend/publish/cover-service.test.ts tests/backend/api/publish-api.test.ts tests/backend/api/topic-api-runtime.test.ts harness/scripts/runtime/llm-s2-baseline.test.ts harness/scripts/runtime/llm-s2-baseline-stub.test.ts --no-file-parallelism
npm run typecheck:backend
```

预期：所有测试与 typecheck exit 0。由于新增 prompt/API/预算特征测试，总数应高于 Task 13 的 237 项；以实际输出为准，不预写虚假数字。

- [x] **Step 2：运行边界与差异检查**

```powershell
git diff --check
git diff -- shared/src backend/src/modules/topic/topic.controller.ts frontend/src
rg -n "Use neutral historical-video planning language" backend/src prompts
git status --short
```

预期：

- shared schema、topic API controller、frontend 无 diff；
- 英文正式 instruction 无残留；
- 只有本计划允许的文件和用户原有未跟踪文件；
- raw output、`storage/topic-candidate-library/` 与 `.env` 不进入提交。

- [x] **Step 3：更新非 live 执行状态**

在本计划、`docs/plans/README.md`、`docs/todos/roadmap-todo.md` 与 `harness/docs/s2-0-baseline-protocol.md` 记录：

- TDD 红灯与绿灯证据；
- 首次安全表达和 selector 一致性规则的精确边界；
- 共享 budget 特征测试结果；
- 完整回归和 typecheck 实际数字；
- 未执行付费 live，速度和语义收益仍未验证；
- S2-0 保持打开。

- [x] **Step 4：中文提交 Task 4**

```powershell
git add docs/plans/2026-07-16-s2-0-topic-safety-and-semantic-consistency-implementation-plan.md docs/plans/README.md docs/todos/roadmap-todo.md harness/docs/s2-0-baseline-protocol.md
git commit -m "记录Task14非live优化结果"
```

- [x] **Step 5：停止并等待独立 live 授权**

不得自动启动 backend 真实 provider、创建项目或运行付费 A/B。下一次 live 授权至少必须包含：模型、最大请求数、人民币费用上限、样本输入、raw output 保存边界；启动 backend 时必须把最大请求数显式应用到 `LLM_REQUEST_BUDGET_MAX_REQUESTS`。

## 2026-07-16 非 live 执行记录

- builder 合同红灯同时命中两个预期缺口：正式 prompt 缺少首次安全表达边界；1301 重试上下文缺少 `mode` 且仍携带英文 `instruction`。最小实现后，prompt/API focused 回归为 55/55 通过，英文指令检索无残留。
- selector 合同红灯命中跨字段语义一致性缺口；加入两条短规则后，prompt runtime 与 topic runtime focused 回归为 99/99 通过。该能力仍由 LLM selector 语义判断，不是本地关键词门禁，也不改写候选。
- 普通 structured 与 strict 调用共享同一 `RequestBudget` 的特征测试首次即通过；provider 与 env focused 回归为 37/37 通过，因此未新增第二套预算实现。
- 完整非 live 回归按仓库真实文件路径覆盖 15 个文件、255 项测试，255/255 通过；`npm run typecheck:backend` 通过。首次矩阵命令中 4 个旧路径未被收集，随后纠正为当前路径，并额外纳入 baseline stub 测试后补跑 5 个文件、46 项，未把不完整的首轮结果当作完整验证。
- 未执行真实 provider、未创建项目、未产生或提交 raw output；速度收益、1301 首次通过率和候选语义质量仍需新的显式 live 授权验证。
- S2-0 保持打开，Task 14 只完成非 live 实施与验证；不得据此进入 S2-1。

## 完成标准

- builder 首次 prompt 已包含短而明确的中文供应商安全表达边界，同时保留具体人物、动作、赌注和余震要求；
- 1301 retry 只传结构化 reason/mode，业务代码不再散落英文自然语言正式指令；
- selector 使用现有 `source_or_scope_risk` 对标题/正文内部矛盾进行语义扣分，不改 schema；
- 现有共享 budget 由特征测试固定，真实页面验收入口明确显式预算；
- 8候选/4展示、TopicCandidateCard、API、模型、thinking、timeout、provider retry、semantic reviewer 均未改变；
- 完整非 live 验证通过；
- 未执行付费 live，未提前声明速度或质量优化成功，S2-0 仍保持打开。
