# Topic Recommendation Event Identity Stability Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 提升 `topic` builder 输出 `event_identity` 的稳定性，减少同一事件跨轮换 key，且不引入任何本地伪语义归一。

**Architecture:** 保持现有 `builder 候选池 + selector 最终选择` 两阶段不变。builder 新增 `recent_event_memory` 输入，并把 `event_identity` 从“存在字段”升级为“稳定命名合同”；本地层继续只按显式 identity 做精确去重、fatigue 与 round history；selector 沿用既有 recent memory 输入做最终避让。

**Tech Stack:** TypeScript, Vitest, prompt registry, runtime trace storage, markdown interaction logs

---

### Task 1: 收紧 builder prompt 的 `event_identity` 命名合同

**Files:**
- Modify: `prompts/topic/candidate-builder.prompt.md`
- Test: `tests/backend/runtime/topic-prompt-contract.test.ts`

**Step 1: Write the failing test**

```ts
it("requires topic.candidate-builder to define stable event_identity naming rules", () => {
  const prompt = createPromptRegistry().getPrompt("topic.candidate-builder");
  expect(prompt.body).toContain("event_identity 必须使用中文");
  expect(prompt.body).toContain("非必要不带年份");
  expect(prompt.body).toContain("不得把包装文案写进 event_identity");
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/backend/runtime/topic-prompt-contract.test.ts
```

Expected: FAIL because builder prompt only要求输出 `event_identity`，还没有稳定命名规则。

**Step 3: Write minimal implementation**

- 在 builder prompt 中新增一小段 `event_identity` 命名规则：
  - 使用中文
  - 使用稳定、简短、偏史学命名的事件短语
  - 非必要不带年份
  - 不得混入 angle、修辞包装或脚本化表述
- 加 2-3 组正反例，但不要把 prompt 写成冗长说明文。

**Step 4: Run test to verify it passes**

Run:

```bash
npm test -- tests/backend/runtime/topic-prompt-contract.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add prompts/topic/candidate-builder.prompt.md tests/backend/runtime/topic-prompt-contract.test.ts
git commit -m "收紧选题事件标识命名合同"
```

### Task 2: 给 builder 接入 `recent_event_memory` 输入合同

**Files:**
- Modify: `prompts/topic/candidate-builder.prompt.md`
- Test: `tests/backend/runtime/topic-prompt-contract.test.ts`
- Test: `tests/backend/runtime/prompt-runtime.test.ts`

**Step 1: Write the failing tests**

```ts
it("requires topic.candidate-builder to consume recent_event_memory", () => {
  const prompt = createPromptRegistry().getPrompt("topic.candidate-builder");
  expect(prompt.body).toContain("recent_event_memory");
});
```

```ts
it("requires builder to reuse prior event_identity when the same event reappears", () => {
  const prompt = createPromptRegistry().getPrompt("topic.candidate-builder");
  expect(prompt.body).toContain("若与 recent_event_memory 中为同一事件，应复用已有 event_identity");
});
```

**Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- tests/backend/runtime/topic-prompt-contract.test.ts tests/backend/runtime/prompt-runtime.test.ts
```

Expected: FAIL because builder prompt 目前不消费 `recent_event_memory`。

**Step 3: Write minimal implementation**

- 扩展 builder prompt 输入合同，新增 `recent_event_memory`
- 明确两条规则：
  - 若候选与 recent memory 中为同一事件，应复用已有 `event_identity`
  - 若近期已经高频，优先扩展到其他事件，不要只换包装重推同事件

**Step 4: Run tests to verify they pass**

Run:

```bash
npm test -- tests/backend/runtime/topic-prompt-contract.test.ts tests/backend/runtime/prompt-runtime.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add prompts/topic/candidate-builder.prompt.md tests/backend/runtime/topic-prompt-contract.test.ts tests/backend/runtime/prompt-runtime.test.ts
git commit -m "为选题builder补充近期事件记忆合同"
```

### Task 3: 把 `recent_event_memory` 接到 builder runtime 输入

**Files:**
- Modify: `backend/src/modules/topic/topic-recommendation.service.ts`
- Test: `tests/backend/topic/topic-runtime-recommendation.test.ts`

**Step 1: Write the failing tests**

```ts
it("sends recent_event_memory to topic.candidate-builder on later rounds", async () => {
  await recommendTopicCandidatesWithTrace(db, firstInput, options);
  await recommendTopicCandidatesWithTrace(db, secondInput, options);
  expect(capturedBuilderInput.recent_event_memory).toEqual(expect.any(Array));
});
```

```ts
it("keeps builder recent_event_memory trace-visible", async () => {
  const result = await recommendTopicCandidatesWithTrace(db, input, options);
  expect(builderLogContent).toContain("recent_event_memory");
});
```

**Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- tests/backend/topic/topic-runtime-recommendation.test.ts
```

Expected: FAIL because builder 目前没有收到 recent memory。

**Step 3: Write minimal implementation**

- 复用现有 `buildRecentEventMemory(...)`
- 在 builder 调用时也传入 `recent_event_memory`
- 不新增任何新的本地 identity 判断逻辑

**Step 4: Run tests to verify they pass**

Run:

```bash
npm test -- tests/backend/topic/topic-runtime-recommendation.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/modules/topic/topic-recommendation.service.ts tests/backend/topic/topic-runtime-recommendation.test.ts
git commit -m "为选题builder接入近期事件记忆"
```

### Task 4: 让 diagnostics 和 trace 明确显示 builder identity 复用语境

**Files:**
- Modify: `backend/src/runtime/llm/interaction-log.ts`
- Modify: `docs/records/2026-04-30-topic-recommendation-diversity-notes.md`
- Test: `tests/backend/topic/topic-runtime-recommendation.test.ts`

**Step 1: Write the failing tests**

```ts
it("shows builder recent_event_memory in candidate-builder trace", async () => {
  expect(builderLogContent).toContain("recent_event_memory");
});
```

```ts
it("keeps event_identity visible in diagnostics candidates", async () => {
  expect(diagnosticsLogContent).toContain("event_identity");
});
```

**Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- tests/backend/topic/topic-runtime-recommendation.test.ts
```

Expected: FAIL until builder trace visibility is补齐。

**Step 3: Write minimal implementation**

- 确保 `01-topic.candidate-builder.md` 能清楚显示 `recent_event_memory`
- 保持 diagnostics 候选行继续显示 `event_identity`
- 更新 notes，加入“检查 builder 是否复用了近期 identity”的巡检点

**Step 4: Run tests to verify they pass**

Run:

```bash
npm test -- tests/backend/topic/topic-runtime-recommendation.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/runtime/llm/interaction-log.ts docs/records/2026-04-30-topic-recommendation-diversity-notes.md tests/backend/topic/topic-runtime-recommendation.test.ts
git commit -m "补充选题builder事件记忆日志可观测性"
```

### Task 5: 新增真实回归样本，锁定高频事件 identity 漂移

**Files:**
- Modify: `tests/backend/topic/topic-runtime-recommendation.test.ts`
- Optional notes: `docs/records/2026-04-30-topic-recommendation-diversity-notes.md`

**Step 1: Write the failing tests**

```ts
it("keeps exact fatigue working when builder reuses prior event_identity for the same event", async () => {
  // round 1 returns 黑斯廷斯战役
  // round 2 builder reuses the same explicit event_identity
  expect(result.selector_pool.find((candidate) => candidate.event_identity === "黑斯廷斯战役")?.fatigue_score).toBe(1);
});
```

```ts
it("does not require any local title heuristic to penalize repeated events", async () => {
  expect(result.diagnostics.checks).not.toContainEqual(
    expect.objectContaining({ code: "topic_local_title_heuristic_applied" }),
  );
});
```

**Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- tests/backend/topic/topic-runtime-recommendation.test.ts
```

Expected: FAIL until builder memory and prompt contract已经一起生效。

**Step 3: Write minimal implementation**

- 只补足测试所需的最小 runtime/trace wiring
- 不再引入新的 helper normalizer

**Step 4: Run tests to verify they pass**

Run:

```bash
npm test -- tests/backend/topic/topic-runtime-recommendation.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add tests/backend/topic/topic-runtime-recommendation.test.ts
git commit -m "补充选题事件标识稳定性回归样本"
```

### Task 6: 做真实 5 轮回归，验证 identity 稳定性是否改善

**Files:**
- No required code changes
- Optional notes: `docs/records/2026-04-30-topic-recommendation-diversity-notes.md`

**Step 1: Write the failing regression check**

不是单元测试，先定义人工验收标准：

- `黑斯廷斯战役`
- `《大宪章》签署`
- `黑死病欧洲大流行`

这类对象在 5 轮内不应再频繁换 key。

**Step 2: Run automated verification**

Run:

```bash
npm test -- tests/backend/topic/topic-runtime-recommendation.test.ts tests/harness/ui-acceptance-page-rules.test.ts
```

Expected: PASS

**Step 3: Run smoke**

Run:

```bash
npm run harness:ui-acceptance:smoke
```

Expected: PASS

**Step 4: Run real 5-round verification**

Run a real 5-round topic recommendation check and inspect:

- builder `recent_event_memory`
- builder output `event_identity`
- selector `recent_event_memory`
- repeated-event distribution

Expected:

- 同一高频事件不再每轮换 key
- fatigue 更依赖 exact identity 复用命中
- 不需要任何本地标题启发式

**Step 5: Commit**

```bash
git add docs/records/2026-04-30-topic-recommendation-diversity-notes.md
git commit -m "完成选题事件标识稳定性真实回归验证"
```
