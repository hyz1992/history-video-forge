# Topic Selector Quality Ranker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development while implementing this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade topic selector from returning three ids to returning a full ranked scorecard for the selector pool, then deterministically select the final three candidates in backend code.

**Architecture:** Keep one `topic.selector` LLM call. The LLM produces structured `ranked_candidates`; backend code validates the ranked queue, skips invalid or repeated-event candidates, selects the first three valid entries, and exposes scorecards through diagnostics.

**Tech Stack:** TypeScript, Vitest, existing prompt registry, existing OpenAI-compatible strict structured tool-call path.

---

### Task 1: Prompt Contract Tests

**Files:**
- Modify: `tests/backend/runtime/topic-prompt-contract.test.ts`
- Modify later: `prompts/topic/selector.prompt.md`

- [ ] Add a failing test that expects `topic.selector` to describe `ranked_candidates`, `quality_rank`, `quality_score`, `deductions`, and `risk_summary`.
- [ ] Update the old “exactly three ids” prompt test to expect full ranking instead.
- [ ] Run: `npx vitest run --configLoader runner tests/backend/runtime/topic-prompt-contract.test.ts`
- [ ] Expected: FAIL because selector prompt still describes only `selected_candidate_ids`.

### Task 2: Runtime Selection Tests

**Files:**
- Modify: `tests/backend/topic/topic-runtime-recommendation.test.ts`
- Modify later: `backend/src/modules/topic/topic-recommendation.service.ts`
- Modify later: `backend/src/runtime/orchestration/runtime-diagnostics.ts`

- [ ] Update test helper `createSelectorDecision` to create `ranked_candidates` instead of `selected_candidate_ids`.
- [ ] Add a failing test where selector returns a full ranking and backend selects the rank 1-3 candidates.
- [ ] Add a failing test where rank 2 repeats rank 1 event identity and backend skips it, selecting rank 4 as the third final candidate.
- [ ] Add a failing test that final candidate preview trace includes `quality_score`, `deductions`, and `risk_summary`.
- [ ] Run: `npx vitest run --configLoader runner tests/backend/topic/topic-runtime-recommendation.test.ts --no-file-parallelism`
- [ ] Expected: FAIL because production code still parses `selected_candidate_ids`.

### Task 3: Runtime Implementation

**Files:**
- Modify: `backend/src/modules/topic/topic-recommendation.service.ts`
- Modify: `backend/src/runtime/orchestration/runtime-diagnostics.ts`

- [ ] Replace `TopicSelectorDecision` with a `ranked_candidates` decision shape.
- [ ] Replace strict schema with `rank_topic_candidates`, requiring a ranked array of scorecards.
- [ ] Parse and normalize strict/fallback output as ranked scorecards.
- [ ] Extend `SelectorPoolCandidate` with existing quality evidence fields from `TopicCandidateCard`.
- [ ] Replace repair-based selection with deterministic selection from the ranked queue.
- [ ] Record selected ids, ranked candidate scorecards, skipped ids, and `repair_attempts: 0` in selector trace.
- [ ] Extend candidate preview trace entries with optional scorecard fields.
- [ ] Run runtime tests again.
- [ ] Expected: PASS for the newly added runtime behavior.

### Task 4: Prompt Update

**Files:**
- Modify: `prompts/topic/selector.prompt.md`

- [ ] Rewrite selector prompt in Chinese to describe the new contract.
- [ ] Keep metadata `language: zh-CN`.
- [ ] Require a complete ranked list covering all ids in `selector_pool`.
- [ ] Require scorecards to focus on扣分项 and风险摘要.
- [ ] Prohibit scripts, downstream objects, invented candidates, and long marketing text.
- [ ] Run prompt contract tests.
- [ ] Expected: PASS.

### Task 5: Verification

**Files:**
- No new production files expected.

- [ ] Run: `npx vitest run --configLoader runner tests/backend/runtime/topic-prompt-contract.test.ts tests/backend/topic/topic-runtime-recommendation.test.ts --no-file-parallelism`
- [ ] Run: `npx vitest run --configLoader runner harness/scripts/check-prompt-language.test.ts`
- [ ] Run: `npx vitest run --configLoader runner tests/backend/runtime/prompt-runtime.test.ts`
- [ ] Inspect git diff to ensure no downstream or writer changes were introduced.

