# Open Discovery Topic Recommendation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将“系统自动推荐”第一版正式收敛为“LLM 开放发现 + 本地约束收口”的可运行推荐器，并补齐约束、诊断与验证链路。

**Architecture:** 前端只负责表达系统筛选条件并构造推荐意图 seed；后端 `topic` 链路继续以开放发现为主，但在 `Event Registry`、`Candidate Cache` 与 runtime diagnostics 上补齐去重、疲劳惩罚与可观测性。实现遵循 TDD，小步提交，每次只推进一个低耦合任务。

**Tech Stack:** Vue 3, TypeScript, Vitest, custom backend runtime, prompt registry, runtime trace storage

---

### Task 1: 冻结开放发现推荐 seed 合同

**Files:**
- Modify: `frontend/src/stores/topic.ts`
- Modify: `frontend/src/views/TopicPage.vue`
- Modify: `backend/src/modules/topic/topic.controller.ts`
- Test: `tests/frontend/topic-store.spec.ts`
- Test: `tests/backend/topic/topic-runtime-recommendation.test.ts`

**Step 1: Write the failing tests**

```ts
it("sends canonical recommendation seed fields derived from system filters", async () => {
  await api.generateSystemRecommendations("project-1", {
    era: "medieval",
    tension: "balanced",
  });

  expect(requestBody).toMatchObject({
    canonical_name: expect.stringContaining("魏晋至唐宋"),
    tags: expect.arrayContaining(["medieval", "balanced"]),
  });
});
```

```ts
it("rejects malformed topic recommendation payloads missing seed fields", async () => {
  const response = await createTopicRecommendationsController({
    payload: { canonical_name: "" },
  } as any);

  expect(response.statusCode).toBe(400);
});
```

**Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- tests/frontend/topic-store.spec.ts tests/backend/topic/topic-runtime-recommendation.test.ts
```

Expected: FAIL because the request contract is either under-specified or not validated.

**Step 3: Write minimal implementation**

- Keep the current filter-to-seed mapping entrypoint in `topic.ts`.
- Add explicit backend validation in `topic.controller.ts` for:
  - `canonical_name`
  - `summary`
  - `core_conflict`
  - `strong_scene`
  - `source_hint`
  - `recent_usage_hint`
  - `tags`
- Return `400` for malformed payloads instead of silently accepting bad input.

**Step 4: Run tests to verify they pass**

Run:

```bash
npm test -- tests/frontend/topic-store.spec.ts tests/backend/topic/topic-runtime-recommendation.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add frontend/src/stores/topic.ts frontend/src/views/TopicPage.vue backend/src/modules/topic/topic.controller.ts tests/frontend/topic-store.spec.ts tests/backend/topic/topic-runtime-recommendation.test.ts
git commit -m "冻结开放发现推荐seed合同"
```

### Task 2: 为系统推荐补上本地重复与疲劳惩罚

**Files:**
- Modify: `backend/src/modules/topic/topic-recommendation.service.ts`
- Modify: `backend/src/modules/topic/topic-candidate.builder.ts`
- Modify: `backend/src/modules/topic/event-normalizer.ts`
- Modify: `backend/src/modules/cache/candidate-cache.repository.ts`
- Test: `tests/backend/topic/topic-runtime-recommendation.test.ts`

**Step 1: Write the failing tests**

```ts
it("filters duplicate event identities from a single open-discovery recommendation round", async () => {
  const result = await recommendTopicCandidatesWithTrace(db, input, options);
  expect(uniqueEventFingerprints(result.candidates)).toHaveLength(result.candidates.length);
});
```

```ts
it("demotes recently used events through a fatigue penalty before returning final candidates", async () => {
  seedRecentEventUsage(db, "yanzi-shichu");
  const result = await recommendTopicCandidatesWithTrace(db, input, options);
  expect(result.diagnostics.checks).toContainEqual(
    expect.objectContaining({ code: "topic_candidate_fatigue_penalty_applied" }),
  );
});
```

**Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- tests/backend/topic/topic-runtime-recommendation.test.ts
```

Expected: FAIL because current recommendation flow still trusts raw open-discovery outputs too much.

**Step 3: Write minimal implementation**

- Add a deterministic post-processing stage after candidate normalization.
- Compute candidate fingerprints from normalized event identity + angle.
- Drop exact duplicates within the same round.
- Add a lightweight fatigue penalty using:
  - recent `candidateCache`
  - project-level recent topic rounds
- Record diagnostics instead of silently mutating outcomes.

**Step 4: Run tests to verify they pass**

Run:

```bash
npm test -- tests/backend/topic/topic-runtime-recommendation.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/modules/topic/topic-recommendation.service.ts backend/src/modules/topic/topic-candidate.builder.ts backend/src/modules/topic/event-normalizer.ts backend/src/modules/cache/candidate-cache.repository.ts tests/backend/topic/topic-runtime-recommendation.test.ts
git commit -m "补充系统推荐去重与疲劳惩罚"
```

### Task 3: 提升开放发现候选的差异化与诊断可读性

**Files:**
- Modify: `harness/prompts/topic/candidate-builder.prompt.md`
- Modify: `backend/src/runtime/llm/interaction-log.ts`
- Modify: `backend/src/modules/topic/topic-recommendation.service.ts`
- Test: `tests/backend/runtime/prompt-runtime.test.ts`
- Test: `tests/backend/topic/topic-runtime-recommendation.test.ts`

**Step 1: Write the failing tests**

```ts
it("keeps prompt metadata zh-CN and includes diversity instructions for open discovery", () => {
  const prompt = registry.getPrompt("topic.candidate-builder");
  expect(prompt.body).toContain("候选之间必须明显区分");
});
```

```ts
it("writes recommendation diagnostics that explain why candidates were kept or dropped", async () => {
  expect(result.diagnostics.checks).toContainEqual(
    expect.objectContaining({ code: "topic_candidate_duplicate_removed" }),
  );
});
```

**Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- tests/backend/runtime/prompt-runtime.test.ts tests/backend/topic/topic-runtime-recommendation.test.ts
```

Expected: FAIL because the current prompt and diagnostics do not yet express diversity and filtering reasons strongly enough.

**Step 3: Write minimal implementation**

- Update `candidate-builder.prompt.md` to explicitly ask for:
  - event diversity
  - angle diversity
  - no celebrity-topic collapse
- Keep metadata `language: zh-CN`.
- Add runtime diagnostics codes for:
  - duplicate removal
  - fatigue penalty
  - slot backfill trigger
- If helpful, extend markdown interaction logs with a short “归因注记” section summarizing filtering outcomes.

**Step 4: Run tests to verify they pass**

Run:

```bash
npm test -- tests/backend/runtime/prompt-runtime.test.ts tests/backend/topic/topic-runtime-recommendation.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add harness/prompts/topic/candidate-builder.prompt.md backend/src/runtime/llm/interaction-log.ts backend/src/modules/topic/topic-recommendation.service.ts tests/backend/runtime/prompt-runtime.test.ts tests/backend/topic/topic-runtime-recommendation.test.ts
git commit -m "增强开放发现推荐差异化约束"
```

### Task 4: 把开放发现推荐的可观测性补进 harness 手册

**Files:**
- Modify: `harness/README.md`
- Modify: `docs/process/ui-design-to-code-playbook.md`
- Create: `docs/records/2026-04-28-open-discovery-topic-recommendation-notes.md`
- Test: manual verification notes only

**Step 1: Write the failing verification checklist**

Add a checklist entry in a draft note:

```md
- [ ] 能定位 topic run 的 llm-interactions markdown
- [ ] 能看见 recommendation seed
- [ ] 能看见最终候选与 diagnostics
```

**Step 2: Run manual verification to confirm the docs are insufficient**

Run:

```bash
npm run harness:ui-acceptance:smoke
```

Expected: PASS for runtime, but docs still do not explain how to inspect recommendation logs end-to-end.

**Step 3: Write minimal documentation**

- In `harness/README.md`, add a short section:
  - where topic/script run logs live
  - how to inspect `llm-interactions/*.md`
- In the notes file, capture one successful end-to-end example path.
- Do not change runtime behavior in this task.

**Step 4: Re-run manual verification**

Run:

```bash
npm run harness:ui-acceptance:smoke
```

Expected: PASS and docs now point to the right artifacts.

**Step 5: Commit**

```bash
git add harness/README.md docs/records/2026-04-28-open-discovery-topic-recommendation-notes.md
git commit -m "补充开放发现推荐日志定位说明"
```

### Task 5: 追加一轮开放发现推荐的真实端到端回归

**Files:**
- Modify: `tests/harness/ui-acceptance-page-rules.test.ts`
- Modify: `harness/scripts/ui-acceptance/page-rules.ts`
- Modify: `harness/scripts/ui-acceptance/page-auditor.ts`
- Test: `harness/scripts/ui-acceptance/ui-acceptance-smoke.ts`

**Step 1: Write the failing test**

```ts
it("requires topic system recommendation runs to expose recommendation diagnostics hooks", () => {
  expect(topicRules).toContain("topic-recommendation-diagnostics");
});
```

**Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/harness/ui-acceptance-page-rules.test.ts
```

Expected: FAIL because the current harness rules focus on layout and core actions, not recommendation diagnostics visibility.

**Step 3: Write minimal implementation**

- Extend page rules/auditor so `Topic` page smoke can confirm:
  - recommendation generation completed
  - a candidate list exists
  - recommendation diagnostics or trace entry remains inspectable

**Step 4: Run test and smoke to verify they pass**

Run:

```bash
npm test -- tests/harness/ui-acceptance-page-rules.test.ts
npm run harness:ui-acceptance:smoke
```

Expected: PASS

**Step 5: Commit**

```bash
git add tests/harness/ui-acceptance-page-rules.test.ts harness/scripts/ui-acceptance/page-rules.ts harness/scripts/ui-acceptance/page-auditor.ts
git commit -m "补充开放发现推荐端到端回归"
```

