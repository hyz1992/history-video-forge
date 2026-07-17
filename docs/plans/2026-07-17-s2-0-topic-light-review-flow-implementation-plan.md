# S2-0 Topic 轻审核流程调整实施计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Topic 生产主链路从“Builder 生成 8 个 + 重型 Selector 8 选 4”调整为“Builder 生成 4 个 + 轻审核 + 最多一次补充”，并允许最终 1～4 个合格候选正常展示。

**Architecture:** 保留现有 Builder 内容策略和本地去重/疲劳职责，只机械调整 Builder 目标数量。新增独立轻审核合同，生产服务只按审核 `consistency_issue` 过滤；首次审核已有 1～4 个合格候选时立即返回，只有首次 0 个时才再运行一次原 Builder，并只审核去重后的新增候选。旧 Selector 回放能力保留，但不再进入生产推荐。

**Tech Stack:** TypeScript、Vitest、LangGraph、Zod、文件化中文 Prompt、现有 LLM Gateway strict structured/fallback。

---

## 文件结构

- Create: `backend/src/modules/topic/topic-light-review.ts`
  - 定义轻审核 issue、strict schema、输出解析、candidate id 覆盖和送审投影。
- Modify: `backend/src/modules/topic/topic-recommendation.service.ts`
  - 接入轻审核、一次补充、部分成功和 review trace；停止生产 Selector 调用。
- Modify: `backend/src/runtime/orchestration/topic-recommendation-nodes.ts`
  - 原始目标数量改为 4；候选数量不足不在 Graph 内提前重开 Builder。
- Modify: `backend/src/runtime/orchestration/runtime-diagnostics.ts`
  - 增加 reviewed candidates 诊断字段，不再依赖模型排名解释最终选择。
- Modify: `backend/src/runtime/llm/operation-policy.ts`
  - 将 `topic.light-review` 显式登记为短结构化判断；不新增 thinking override。
- Modify: `harness/prompts/topic/candidate-builder.prompt.md`
  - 只把正式数量文字从 8 改为 4。
- Modify: `harness/prompts/topic/candidate-builder-repair.prompt.md`
  - 只同步原始候选数量文字，不修改修复策略。
- Modify: `harness/prompts/topic/light-review.prompt.md`
  - 收窄为逐候选内部一致性审核，删除质量、多样性、疲劳和排序职责。
- Modify: `tests/backend/topic/topic-runtime-recommendation.test.ts`
  - 删除已失效的生产 Selector 行为断言，增加轻审核与降级行为回归。
- Modify: `tests/backend/topic/topic-graph-recommendation.test.ts`
  - 更新 4 候选目标和 Graph 内不因数量不足提前二次生成的断言。
- Modify: `tests/backend/runtime/topic-prompt-contract.test.ts`
  - 锁定 Builder 只做 8→4 数量适配和轻审核职责边界。
- Modify: `tests/backend/runtime/llm-operation-policy.test.ts`
  - 锁定 `topic.light-review` operation class 且没有 thinking override。
- Modify: `tests/backend/api/topic-api-runtime.test.ts`
  - API stub 改为轻审核输出，并覆盖 1～4 个候选正常返回、0 个失败。
- Modify: `docs/plans/README.md`
  - 记录本轮实际实现和验证结论。
- Modify: `docs/todos/roadmap-todo.md`
  - 更新 S2-0 当前入口和未验证的真实效果边界。

## Chunk 1: 合同与数量适配

### Task 1: 锁定 Builder 只做 4 候选数量适配

**Files:**
- Modify: `tests/backend/runtime/topic-prompt-contract.test.ts`
- Modify: `tests/backend/topic/topic-graph-recommendation.test.ts`
- Modify: `harness/prompts/topic/candidate-builder.prompt.md`
- Modify: `harness/prompts/topic/candidate-builder-repair.prompt.md`
- Modify: `backend/src/runtime/orchestration/topic-recommendation-nodes.ts`

- [ ] **Step 1: 先把 Prompt 合同测试改为期望 4 个候选**

将 Builder 数量断言改为：

```ts
expect(prompt.body).toContain("输出 4 个候选");
expect(prompt.body).not.toContain("输出 8 个候选");
```

并把“原始 8 候选”相关断言机械同步为“原始 4 候选”，不增加新的质量规则断言。

- [ ] **Step 2: 运行 Prompt 合同测试，确认 RED**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/runtime/topic-prompt-contract.test.ts
```

Expected: FAIL，现有 Prompt 仍声明 8 个候选。

- [ ] **Step 3: 机械修改 Builder 两份 Prompt 的数量文字**

只把生成目标、原始槽位和相关自检中的 `8` 改为 `4`；不修改其他句子、字段、质量策略或参数。

- [ ] **Step 4: 先修改 Graph 测试，要求原始目标为 4 且数量不足不在 Graph 内重开生成**

新增/修改断言：

```ts
expect(TOPIC_RAW_CANDIDATE_POOL_TARGET_COUNT).toBe(4);
expect(invokeStructuredPrompt).toHaveBeenCalledTimes(1);
expect(result.candidates).toHaveLength(3);
expect(result.diagnostics.checks).toContainEqual(
  expect.objectContaining({ code: "topic_candidate_slots_insufficient" }),
);
```

- [ ] **Step 5: 运行 Graph 测试，确认 RED**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/topic/topic-graph-recommendation.test.ts
```

Expected: FAIL，当前 raw target 为 8，且数量不足会在 Graph 内提前二次调用 Builder。

- [ ] **Step 6: 最小修改 Graph 数量与路由条件**

```ts
export const TOPIC_CANDIDATE_TARGET_COUNT = 4;
export const TOPIC_RAW_CANDIDATE_POOL_TARGET_COUNT = 4;

const shouldRepair = runtime.pendingFieldRepair;
```

保留字段缺失专用 `topic.candidate-builder-repair`，但普通数量不足交给服务层审核后的唯一补充路径。

- [ ] **Step 7: 运行两组测试并确认 GREEN**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/runtime/topic-prompt-contract.test.ts tests/backend/topic/topic-graph-recommendation.test.ts --no-file-parallelism
```

Expected: PASS。

### Task 2: 建立轻审核最小合同

**Files:**
- Create: `backend/src/modules/topic/topic-light-review.ts`
- Modify: `harness/prompts/topic/light-review.prompt.md`
- Modify: `tests/backend/runtime/topic-prompt-contract.test.ts`
- Create: `tests/backend/topic/topic-light-review.test.ts`

- [ ] **Step 1: 先写轻审核 Prompt 边界测试**

断言必须包含：

```ts
const prompt = createPromptRegistry().getPrompt("topic.light-review");
expect(prompt.metadata.language).toBe("zh-CN");
expect(prompt.body).toContain("只检查候选内部是否互相支持");
expect(prompt.body).toContain("consistency_issue");
expect(prompt.body).not.toContain("quality_score");
expect(prompt.body).not.toContain("质量排序");
expect(prompt.body).not.toContain("疲劳");
expect(prompt.body).not.toContain("多样性");
```

- [ ] **Step 2: 运行 Prompt 测试，确认 RED**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/runtime/topic-prompt-contract.test.ts
```

Expected: FAIL，现有 light-review 仍承担传播力、多样性、疲劳等职责。

- [ ] **Step 3: 重写 light-review Prompt 为最小审核职责**

输出固定为：

```json
{
  "candidate_reviews": [
    {
      "candidate_id": "candidate-id",
      "consistency_issue": "none",
      "note": ""
    }
  ]
}
```

风险项使用既有 issue enum 和非空简短 note；pass 项使用 `none` 和空 note。

- [ ] **Step 4: 先写轻审核解析和覆盖测试**

覆盖：

- 4 个 id 全覆盖可解析。
- 未知 id 拒绝。
- 遗漏 id 拒绝。
- 重复 id 拒绝。
- 非 `none` 缺少 note 拒绝。
- `none` 携带风险 note 拒绝。
- 送审投影不包含 `viral_rubric`、`fatigue_score`、`recently_seen`。

- [ ] **Step 5: 运行轻审核单测，确认 RED**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/topic/topic-light-review.test.ts
```

Expected: FAIL，目标模块尚不存在。

- [ ] **Step 6: 实现最小 schema、parser、coverage 和 projection**

核心合同：

```ts
export interface TopicLightReviewCandidateResult {
  candidate_id: string;
  consistency_issue: TopicConsistencyIssue;
  note: string;
}

export interface TopicLightReviewDecision {
  candidate_reviews: TopicLightReviewCandidateResult[];
}
```

strict schema 只允许这三个候选字段和单一顶层 `candidate_reviews`，并导出：

```ts
TOPIC_LIGHT_REVIEW_STRICT_SCHEMA
parseTopicLightReviewDecision(rawOutput, expectedCandidateIds)
projectTopicLightReviewPool(candidates)
```

- [ ] **Step 7: 运行合同和模块测试并确认 GREEN**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/runtime/topic-prompt-contract.test.ts tests/backend/topic/topic-light-review.test.ts --no-file-parallelism
```

Expected: PASS。

## Chunk 2: 生产流程与降级

### Task 3: 用轻审核替换生产 Selector

**Files:**
- Modify: `tests/backend/topic/topic-runtime-recommendation.test.ts`
- Modify: `backend/src/modules/topic/topic-recommendation.service.ts`
- Modify: `backend/src/runtime/orchestration/runtime-diagnostics.ts`

- [ ] **Step 1: 先写正常路径失败测试**

构造 4 个完整 Builder 候选和 4 个 `none` 审核结果，断言：

```ts
expect(result.candidates).toHaveLength(4);
expect(operationNames).toEqual([
  "topic.candidate-builder",
  "topic.light-review",
]);
expect(operationNames).not.toContain("topic.selector");
```

- [ ] **Step 2: 运行目标测试，确认 RED**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/topic/topic-runtime-recommendation.test.ts -t "uses topic.light-review instead of topic.selector on the normal path"
```

Expected: FAIL，生产仍调用 `topic.selector`。

- [ ] **Step 3: 实现 strict light-review 调用及受控 structured fallback**

在服务中新增：

```ts
async function invokeTopicLightReview(input: {
  llmGateway: LlmGateway;
  expectedCandidateIds: string[];
  reviewInput: unknown;
  interactionLogWriter?: LlmInteractionLogWriter;
}): Promise<TopicLightReviewDecision>
```

优先 `invokeStrictStructured` + `review_topic_candidates` 目标工具；只在 provider capability、目标工具或 review 结构错误时进入一次既有 structured fallback。不得回退到 Selector。

- [ ] **Step 4: 最小替换正常选择逻辑**

```ts
const acceptedIds = new Set(
  decision.candidate_reviews
    .filter((item) => item.consistency_issue === "none")
    .map((item) => item.candidate_id),
);
const accepted = rankings
  .filter((entry) => acceptedIds.has(entry.candidateId))
  .slice(0, TOPIC_CANDIDATE_TARGET_COUNT);
```

本地顺序只继承既有疲劳排序和原始顺序；不再读取模型质量分数或排名。

- [ ] **Step 5: 增加 review trace 和 preview diagnostics**

trace 至少包含：

```ts
{
  reviewed_candidate_ids: string[];
  accepted_candidate_ids: string[];
  rejected_candidates: Array<{
    candidate_id: string;
    consistency_issue: TopicConsistencyIssue;
    note: string;
  }>;
  refill_attempts: number;
}
```

`candidate_preview_trace` 新增 `reviewed_candidates`；不伪造 `quality_rank`、`quality_score` 或 deductions。

- [ ] **Step 6: 运行正常路径测试并确认 GREEN**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/topic/topic-runtime-recommendation.test.ts -t "uses topic.light-review instead of topic.selector on the normal path"
```

Expected: PASS。

### Task 4: 实现一次补充和部分成功

**Files:**
- Modify: `tests/backend/topic/topic-runtime-recommendation.test.ts`
- Modify: `backend/src/modules/topic/topic-recommendation.service.ts`

- [ ] **Step 1: 先写首次部分通过、补充成功测试**

首轮 4 个中 2 个 pass、2 个 risk；第二轮 Builder 产生 2 个去重新候选，第二次审核均 pass。断言最终 4 个，并且 Builder/审核各调用 2 次，第二次审核只收到 2 个新增 id。

- [ ] **Step 2: 运行测试，确认 RED**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/topic/topic-runtime-recommendation.test.ts -t "refills once and reviews only new candidates"
```

Expected: FAIL，补充路径尚不存在。

- [ ] **Step 3: 实现最多一次 Builder 补充**

补充输入复用原 seed，并把首轮候选追加到 `recent_event_memory`；合并后按既有 event identity/fingerprint 去重，只选缺口数量的新候选审核。无新候选时不得第三次生成。

- [ ] **Step 4: 写重试后仍部分通过测试**

首轮只有 1 个 pass，第二轮新增候选全部 risk；断言最终返回该 1 个候选、不抛错，且风险候选不在 final rankings、轮次和最终缓存中。

- [ ] **Step 5: 运行测试，确认 RED 后实现部分成功**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/topic/topic-runtime-recommendation.test.ts -t "returns existing eligible candidates after refill still falls short"
```

Expected before implementation: FAIL。实现后 PASS。

- [ ] **Step 6: 写最终 0 个合格候选测试**

首轮和补充轮均全部 risk，断言：

```ts
await expect(run()).rejects.toThrow("topic_review_no_eligible_candidates");
expect(builderCalls).toHaveLength(2);
expect(reviewCalls).toHaveLength(2);
```

- [ ] **Step 7: 运行测试，确认 RED 后实现 0 项报错**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/topic/topic-runtime-recommendation.test.ts -t "throws only when no eligible candidate remains after refill"
```

Expected before implementation: FAIL。实现后 PASS。

- [ ] **Step 8: 运行 Topic runtime 目标矩阵**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/topic/topic-runtime-recommendation.test.ts --no-file-parallelism
```

Expected: PASS；所有生产 Selector 专属测试已删除或改为 light-review 行为，Selector parser/replay 单测继续保留。

### Task 5: 登记轻审核 operation policy

**Files:**
- Modify: `tests/backend/runtime/llm-operation-policy.test.ts`
- Modify: `backend/src/runtime/llm/operation-policy.ts`

- [ ] **Step 1: 写失败测试**

```ts
expect(classifyOperation("topic.light-review")).toBe("short_structured_decision");
expect(getOperationPolicy("topic.light-review").thinking).toBeUndefined();
```

- [ ] **Step 2: 运行测试确认 RED**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/runtime/llm-operation-policy.test.ts
```

Expected: FAIL，operation 尚未登记。

- [ ] **Step 3: 只登记 class，不新增参数 override**

```ts
"topic.light-review": "short_structured_decision",
```

保留历史 `topic.selector` policy 供固定回放使用，但生产链路不再调用。

- [ ] **Step 4: 运行测试确认 GREEN**

Run 同 Step 2。Expected: PASS。

## Chunk 3: API、界面兼容与收口

### Task 6: 验证 API 的变量候选数量

**Files:**
- Modify: `tests/backend/api/topic-api-runtime.test.ts`
- Modify: `backend/src/modules/topic/topic.controller.ts`（仅当测试证明需要）

- [ ] **Step 1: 把 API provider stub 改为响应 `topic.light-review`**

审核输出使用 `candidate_reviews`，不再生成 `ranked_candidates`。

- [ ] **Step 2: 写 1 个合格候选仍返回 200 的失败测试**

```ts
expect(response.statusCode).toBe(200);
expect(response.body.candidates).toHaveLength(1);
```

- [ ] **Step 3: 写 0 个合格候选返回 500 的失败测试**

```ts
expect(response.statusCode).toBe(500);
expect(response.body).toMatchObject({
  error: "topic_generate_failed",
  message: "topic_review_no_eligible_candidates",
});
```

- [ ] **Step 4: 运行 API 测试确认 RED**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/api/topic-api-runtime.test.ts --no-file-parallelism
```

- [ ] **Step 5: 最小修正 controller（若需要）并确认 GREEN**

不得增加“必须 4 个”的 API 守卫；现有前端已经以数组渲染并默认选中第一个候选，无需伪造占位项。

### Task 7: 更新当前状态文档

**Files:**
- Modify: `docs/plans/README.md`
- Modify: `docs/todos/roadmap-todo.md`

- [ ] **Step 1: 记录实现事实**

只写已经由代码和非 live 验证证明的内容：生产 Selector 已移除、Builder 数量为 4、轻审核/一次补充/部分成功合同已落地。

- [ ] **Step 2: 保留真实效果未验证边界**

在未执行新 live check 前不得声称首次通过率、端到端耗时或语义召回已经改善，也不得关闭 S2-0。

### Task 8: 完整验证与中文提交

**Files:**
- All files above

- [ ] **Step 1: 运行受影响测试矩阵**

```powershell
npx vitest run --configLoader runner tests/backend/topic/topic-light-review.test.ts tests/backend/topic/topic-graph-recommendation.test.ts tests/backend/topic/topic-runtime-recommendation.test.ts tests/backend/runtime/topic-prompt-contract.test.ts tests/backend/runtime/llm-operation-policy.test.ts tests/backend/api/topic-api-runtime.test.ts tests/harness/topic-script-smoke.test.ts --no-file-parallelism
```

Expected: PASS。

- [ ] **Step 2: 运行 Prompt 语言检查**

```powershell
npx vitest run --configLoader runner harness/scripts/check-prompt-language.test.ts
```

Expected: PASS。

- [ ] **Step 3: 运行 Backend typecheck**

```powershell
npm run typecheck:backend
```

Expected: exit 0。

- [ ] **Step 4: 检查禁止路径和 Builder 非数量差异**

```powershell
git diff --check
git diff -- harness/prompts/topic/candidate-builder.prompt.md harness/prompts/topic/candidate-builder-repair.prompt.md
git status --short
```

确认 Builder 两份 Prompt 只有数量文字变化；两份用户原有未跟踪计划和 `storage/topic-candidate-library/` 未被暂存。

- [ ] **Step 5: 用中文提交实现**

```powershell
git add -- <本计划明确列出的实现、测试和状态文档>
git commit -m "调整选题生成与轻审核流程"
```

## 真实验证边界

本计划默认先完成非 live 验证。完成后如执行真实 Topic 验证，应单独记录：

- Builder 实际输出数和首次结构通过情况。
- 轻审核首次通过数和 issue 分布。
- 是否触发一次补充以及最终展示数。
- Builder/轻审核各自耗时、completion、reasoning、effective thinking。
- 页面能否在最终 1～4 个候选时正常展示并确认。

只有真实证据支持后，才决定是否另起 Builder 优化设计；本计划不得顺手修改 Builder 质量策略。

## 2026-07-17 补充实施：仅首次零合格时补充

本节覆盖原 Task 4 中“首次不足 4 个即补充”的旧触发条件，其余轻审核、去重、部分成功和错误合同保持不变。

### Task 9: 收窄补充触发条件并计时复验

**Files:**
- Modify: `tests/backend/topic/topic-runtime-recommendation.test.ts`
- Modify: `tests/backend/api/topic-api-runtime.test.ts`
- Modify: `backend/src/modules/topic/topic-recommendation.service.ts`
- Modify: `docs/records/2026-07-17-topic-light-review-live-check.md`
- Modify: `docs/plans/README.md`
- Modify: `docs/todos/roadmap-todo.md`

- [x] **Step 1: 先写新的触发边界测试并确认 RED**

覆盖首次通过 1 个或多个候选时不再调用补充 Builder，以及首次 0 个时仍只补充一次并只审核新增候选。

- [x] **Step 2: 最小修改生产条件并确认 GREEN**

只把补充触发条件从“首次通过数小于 4”收窄为“首次通过数等于 0”；不修改 Builder Prompt、模型参数、内容策略或审核标准。

- [x] **Step 3: 回归受影响矩阵并自审**

运行 Topic runtime、API、Prompt 合同、语言检查和 backend typecheck；确认用户未跟踪文件及生成态候选库未被改动或暂存。

- [x] **Step 4: 使用同一燕子使楚样本执行一次显式 live check**

真实请求总预算仍为最多 4 次。逐次记录操作名、调用序号、成功/失败和 wall-clock 耗时，并记录总耗时、首次通过数、是否触发补充及最终展示数；若首次已有至少 1 个合格候选，预期只发生 Builder 与首次轻审核两次调用。
