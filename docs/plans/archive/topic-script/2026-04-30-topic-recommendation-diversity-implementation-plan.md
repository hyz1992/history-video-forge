# Topic Recommendation Diversity Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将当前单阶段 `topic` 推荐链路升级为 “builder 候选池 + selector 最终选择” 的两阶段多样性推荐器，降低连续多轮同 seed 下的高频事件塌缩。

**Architecture:** 保持 `LLM 开放发现 + 本地结构约束` 总路线不变，但把“最终多样性选择”从单一 builder prompt 中拆出，新增一个 `topic.selector` prompt。builder 只负责开放发现并产出 `8` 个原始候选；本地只做 identity 去重、fatigue 标注与结构编排；selector 负责从候选池中选出最终 `3` 个更分散的候选。

**Tech Stack:** TypeScript, Vitest, custom backend runtime, prompt registry, runtime trace storage

---

### Task 1: 将 builder 目标从 3 个候选扩成 8 个候选池

**Files:**
- Modify: `prompts/topic/candidate-builder.prompt.md`
- Modify: `backend/src/runtime/orchestration/topic-recommendation-nodes.ts`
- Modify: `backend/src/modules/topic/topic-recommendation.service.ts`
- Test: `tests/backend/runtime/topic-prompt-contract.test.ts`
- Test: `tests/backend/topic/topic-runtime-recommendation.test.ts`

**Step 1: Write the failing tests**

```ts
it("requires candidate-builder to generate a larger raw candidate pool", () => {
  const prompt = registry.getPrompt("topic.candidate-builder");
  expect(prompt.body).toContain("输出 8 个候选");
});
```

```ts
it("keeps raw recommendation pool larger than final delivery size", async () => {
  const result = await recommendTopicCandidatesWithTrace(db, input, options);
  expect(result.raw_candidates).toHaveLength(8);
});
```

**Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- tests/backend/runtime/topic-prompt-contract.test.ts tests/backend/topic/topic-runtime-recommendation.test.ts
```

Expected: FAIL because builder still targets the final delivery count directly.

**Step 3: Write minimal implementation**

- Update `candidate-builder.prompt.md` so it only focuses on开放发现，并明确要求先产出 `8` 个原始候选。
- Introduce a separate raw pool target constant in `topic-recommendation-nodes.ts`.
- Ensure `topic-recommendation.service.ts` can preserve `raw_candidates` for downstream selection instead of immediately treating builder output as final delivery.

**Step 4: Run tests to verify they pass**

Run:

```bash
npm test -- tests/backend/runtime/topic-prompt-contract.test.ts tests/backend/topic/topic-runtime-recommendation.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add prompts/topic/candidate-builder.prompt.md backend/src/runtime/orchestration/topic-recommendation-nodes.ts backend/src/modules/topic/topic-recommendation.service.ts tests/backend/runtime/topic-prompt-contract.test.ts tests/backend/topic/topic-runtime-recommendation.test.ts
git commit -m "扩展选题builder原始候选池"
```

### Task 2: 在本地层整理 selector 候选池

**Files:**
- Modify: `backend/src/modules/topic/topic-recommendation.service.ts`
- Modify: `backend/src/modules/cache/candidate-cache.repository.ts`
- Test: `tests/backend/topic/topic-runtime-recommendation.test.ts`

**Step 1: Write the failing tests**

```ts
it("only keeps one entry per normalized event identity in the selector pool", async () => {
  const result = await recommendTopicCandidatesWithTrace(db, input, options);
  expect(uniqueEventIdentities(result.selector_pool)).toHaveLength(result.selector_pool.length);
});
```

```ts
it("includes fatigue metadata for selector instead of directly finalizing the top 3", async () => {
  const result = await recommendTopicCandidatesWithTrace(db, input, options);
  expect(result.selector_pool[0]).toMatchObject({
    fatigue_score: expect.any(Number),
    recently_seen: expect.any(Boolean),
  });
});
```

**Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- tests/backend/topic/topic-runtime-recommendation.test.ts
```

Expected: FAIL because current post-processing still jumps straight from ranking to final candidates.

**Step 3: Write minimal implementation**

- Keep exact event identity deduplication.
- Keep cache / round history fatigue scoring.
- Stop collapsing directly to final `3` at this stage.
- Produce a selector pool object per candidate with:
  - normalized event identity
  - candidate id/reference
  - fatigue score
  - recently seen flag

**Step 4: Run tests to verify they pass**

Run:

```bash
npm test -- tests/backend/topic/topic-runtime-recommendation.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/modules/topic/topic-recommendation.service.ts backend/src/modules/cache/candidate-cache.repository.ts tests/backend/topic/topic-runtime-recommendation.test.ts
git commit -m "整理选题selector候选池"
```

### Task 3: 新增 topic.selector prompt 合同

**Files:**
- Create: `prompts/topic/selector.prompt.md`
- Modify: `backend/src/runtime/prompts/prompt-registry.ts`
- Test: `tests/backend/runtime/topic-prompt-contract.test.ts`

**Step 1: Write the failing tests**

```ts
it("registers a zh-CN topic.selector prompt dedicated to final diversity selection", () => {
  const prompt = registry.getPrompt("topic.selector");
  expect(prompt.metadata.language).toBe("zh-CN");
  expect(prompt.body).toContain("只从给定候选池中选择");
});
```

```ts
it("keeps selector responsibilities separate from builder responsibilities", () => {
  const prompt = registry.getPrompt("topic.selector");
  expect(prompt.body).toContain("不得发明新的候选");
  expect(prompt.body).toContain("优先选择事件不同的候选");
});
```

**Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- tests/backend/runtime/topic-prompt-contract.test.ts
```

Expected: FAIL because `topic.selector` does not exist yet.

**Step 3: Write minimal implementation**

- Add `topic.selector` prompt file under `prompts/topic/`.
- Register it in the prompt registry.
- Keep the prompt narrow:
  - input is the selector pool
  - output is selected candidate ids only
  - no new candidate invention
  - no script generation

**Step 4: Run tests to verify they pass**

Run:

```bash
npm test -- tests/backend/runtime/topic-prompt-contract.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add prompts/topic/selector.prompt.md backend/src/runtime/prompts/prompt-registry.ts tests/backend/runtime/topic-prompt-contract.test.ts
git commit -m "新增选题selector提示词合同"
```

### Task 4: 接入 selector 运行时并生成最终 3 个候选

**Files:**
- Modify: `backend/src/runtime/orchestration/topic-recommendation-nodes.ts`
- Modify: `backend/src/modules/topic/topic-recommendation.service.ts`
- Modify: `backend/src/runtime/llm/interaction-log.ts`
- Test: `tests/backend/topic/topic-runtime-recommendation.test.ts`
- Test: `tests/backend/runtime/prompt-runtime.test.ts`

**Step 1: Write the failing tests**

```ts
it("asks topic.selector to choose final candidates from the selector pool", async () => {
  const result = await recommendTopicCandidatesWithTrace(db, input, options);
  expect(result.selector_trace).toBeDefined();
  expect(result.candidates).toHaveLength(3);
});
```

```ts
it("rejects selector outputs that reference unknown candidate ids", async () => {
  await expect(runSelectorWithInvalidIds()).rejects.toThrow("topic_selector_invalid_selection");
});
```

**Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- tests/backend/topic/topic-runtime-recommendation.test.ts tests/backend/runtime/prompt-runtime.test.ts
```

Expected: FAIL because there is no selector runtime step yet.

**Step 3: Write minimal implementation**

- Add a selector step after selector pool construction.
- Call `topic.selector`.
- Validate selector output structurally:
  - ids exist in the pool
  - count is `3`
- Convert selected ids back into final candidates.
- Log selector interaction the same way builder interactions are logged.

**Step 4: Run tests to verify they pass**

Run:

```bash
npm test -- tests/backend/topic/topic-runtime-recommendation.test.ts tests/backend/runtime/prompt-runtime.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/runtime/orchestration/topic-recommendation-nodes.ts backend/src/modules/topic/topic-recommendation.service.ts backend/src/runtime/llm/interaction-log.ts tests/backend/topic/topic-runtime-recommendation.test.ts tests/backend/runtime/prompt-runtime.test.ts
git commit -m "接入选题selector最终选择步骤"
```

### Task 5: 增加一次受控 repair 补位

**Files:**
- Modify: `prompts/topic/selector.prompt.md`
- Modify: `backend/src/modules/topic/topic-recommendation.service.ts`
- Test: `tests/backend/topic/topic-runtime-recommendation.test.ts`

**Step 1: Write the failing tests**

```ts
it("triggers one controlled repair when selector pool cannot supply three valid final picks", async () => {
  const result = await recommendTopicCandidatesWithTrace(db, sparseInput, options);
  expect(result.diagnostics.checks).toContainEqual(
    expect.objectContaining({ code: "topic_selector_repair_triggered" }),
  );
});
```

```ts
it("does not retry selector repairs indefinitely", async () => {
  const result = await recommendTopicCandidatesWithTrace(db, sparseInput, options);
  expect(countRepairAttempts(result.trace)).toBeLessThanOrEqual(1);
});
```

**Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- tests/backend/topic/topic-runtime-recommendation.test.ts
```

Expected: FAIL because current selector path has no repair branch.

**Step 3: Write minimal implementation**

- When selector cannot legally return 3 final picks, allow one repair pass.
- Repair input should include:
  - current seed
  - excluded identities
  - already kept candidates
  - missing slot count
- Record a dedicated diagnostics code.
- Stop after one repair attempt.

**Step 4: Run tests to verify they pass**

Run:

```bash
npm test -- tests/backend/topic/topic-runtime-recommendation.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add prompts/topic/selector.prompt.md backend/src/modules/topic/topic-recommendation.service.ts tests/backend/topic/topic-runtime-recommendation.test.ts
git commit -m "补充选题selector单次repair补位"
```

### Task 6: 补可观测性与真实回归

**Files:**
- Modify: `harness/README.md`
- Modify: `harness/scripts/ui-acceptance/page-auditor.ts`
- Modify: `harness/scripts/ui-acceptance/page-rules.ts`
- Modify: `tests/harness/ui-acceptance-page-rules.test.ts`
- Create: `docs/records/2026-04-30-topic-recommendation-diversity-notes.md`

**Step 1: Write the failing tests**

```ts
it("requires topic recommendation runs to expose builder and selector diagnostics hooks", () => {
  expect(topicRules).toContain("topic-selector-diagnostics");
});
```

**Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- tests/harness/ui-acceptance-page-rules.test.ts
```

Expected: FAIL because harness does not yet check selector-stage observability.

**Step 3: Write minimal implementation**

- Extend docs so engineers can find:
  - builder interaction logs
  - selector interaction logs
  - selector diagnostics / repair traces
- Extend page auditor / page rules so smoke can confirm topic recommendation still completes with diagnostics visibility.
- Record one real end-to-end sample in a notes file.

**Step 4: Run tests and smoke to verify they pass**

Run:

```bash
npm test -- tests/harness/ui-acceptance-page-rules.test.ts
npm run harness:ui-acceptance:smoke
```

Expected: PASS

**Step 5: Commit**

```bash
git add harness/README.md harness/scripts/ui-acceptance/page-auditor.ts harness/scripts/ui-acceptance/page-rules.ts tests/harness/ui-acceptance-page-rules.test.ts docs/records/2026-04-30-topic-recommendation-diversity-notes.md
git commit -m "补充选题多样性链路可观测性"
```
