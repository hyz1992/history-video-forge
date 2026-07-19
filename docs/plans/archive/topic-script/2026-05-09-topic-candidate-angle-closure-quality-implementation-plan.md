# Topic Candidate Angle-closure Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tighten `topic.candidate-builder` so `glm-4` structured output produces sharper but closed candidate angles.

**Architecture:** Keep the existing topic pipeline unchanged. Add only a prompt contract assertion and a minimal prompt quality clause for `one_line_angle` and `must_cover_preview` alignment.

**Tech Stack:** TypeScript, Vitest, Markdown prompt registry.

---

### Task 1: Candidate Builder Angle Closure Contract

**Files:**

- Modify: `tests/backend/runtime/topic-prompt-contract.test.ts`
- Modify: `prompts/topic/candidate-builder.prompt.md`

- [ ] **Step 1: Write the failing test**

Add one test that asserts `topic.candidate-builder` requires:

- `one_line_angle` to be supported by all three `must_cover_preview` nodes.
- the three preview nodes to avoid repeating the same angle summary.
- no invented pressure point that the preview nodes cannot close.

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/runtime/topic-prompt-contract.test.ts
```

Expected: FAIL because the new exact prompt contract is not present yet.

- [ ] **Step 3: Write minimal prompt implementation**

Add one short Chinese contract block to `prompts/topic/candidate-builder.prompt.md`. Do not modify writer, selector, schema, API, or validator.

- [ ] **Step 4: Run test to verify it passes**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/runtime/topic-prompt-contract.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run prompt language check**

Run:

```powershell
npx vitest run --configLoader runner harness/scripts/check-prompt-language.test.ts tests/backend/runtime/prompt-runtime.test.ts
```

Expected: PASS.

### Task 2: Real Five-round Quality Check

**Files:**

- No source change expected.
- Output only: `harness/scripts/runtime/output/2026-05-09-topic-candidate-angle-closure-quality-check`

- [ ] **Step 1: Run five-round check**

Run:

```powershell
npm run harness:topic-script-five-round-quality-check -- --output-dir harness/scripts/runtime/output/2026-05-09-topic-candidate-angle-closure-quality-check
```

Expected: 5 samples complete or a clearly recorded live-model failure.

- [ ] **Step 2: Compare with baseline**

Baseline:

```text
harness/scripts/runtime/output/2026-05-08-current-config-five-round
```

Compare `topic-package.json`, `script-draft.json`, and `semantic-review-result.json`.

- [ ] **Step 3: Report conclusion**

State whether the change improved:

- topic angle closure,
- script scene/action density,
- semantic reviewer shadow distribution,
- overall cost-benefit.
