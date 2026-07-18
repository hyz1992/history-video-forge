# Script Text / Trace Boundary Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clarify the boundary between `script_text` and `beat_trace` so writer drafts reduce field-like beat restatement while preserving auditability.

**Architecture:** This is a narrow prompt-contract change. `beat_trace.beat` remains the audit field that copies `hard_lane.must_include_beats`; `script_text` is explicitly responsible for natural oral storytelling. No schema, validator, reviewer, patch, topic, UI, or downstream changes are allowed.

**Tech Stack:** TypeScript, Vitest, Prompt Registry, markdown prompt files, harness live check.

---

## Context

Design source:

- `docs/plans/2026-05-07-script-text-trace-boundary-quality-design.md`

Current evidence:

- `glm-5.1 + glm-4 structured` 5-round run passed structurally with `LLM_TIMEOUT_MS=120000`.
- The quality issue is not thin body or missed beats. The typical issue is field-like prose, for example a script sentence such as “专诸当场被杀，但公子光成功夺权” reads like a copied `must_include_beats` item instead of natural oral narration.

Execution constraints:

- Work directly on `dev`, no worktree.
- One low-coupling task at a time.
- Implementation tasks must use TDD: write failing test, run red, implement minimally, run green.
- Do not stage or commit `storage/topic-candidate-library/`.
- Commit messages must be Chinese.
- Do not add local keyword/blacklist rules pretending to judge semantic quality.
- Do not convert semantic reviewer into a gate.
- Do not touch topic, UI, downstream, storyboard, asset, or compose.

## File Structure

- Modify: `tests/backend/runtime/prompt-runtime.test.ts`
  - Adds one prompt-contract test for `script.writer`.
  - The test only asserts that the prompt contains the new boundary contract.

- Modify: `prompts/script/script-writer.prompt.md`
  - Adds one short section or bullet group clarifying `script_text` / `beat_trace` responsibility.
  - Does not repeat existing opening, duration, ending, thin-regeneration, or “viral” constraints.

- Create: `docs/records/YYYY-MM-DD-script-text-trace-boundary-quality-check.md`
  - Records the real 5-round observation after the prompt change.
  - Human observation only. It is not a machine gate.

## Task 1: Add Prompt Boundary Contract

**Files:**

- Modify: `tests/backend/runtime/prompt-runtime.test.ts`
- Modify: `prompts/script/script-writer.prompt.md`

- [ ] **Step 1: Write the failing prompt contract test**

Add this test near the other `script.writer` prompt-contract tests in `tests/backend/runtime/prompt-runtime.test.ts`:

```ts
  it("separates natural script text from beat trace audit fields", () => {
    const prompt = createPromptRegistry().getPrompt("script.writer");

    expect(prompt.metadata.language).toBe("zh-CN");
    expect(prompt.body).toContain("`beat_trace.beat` 逐字复用输入 beat");
    expect(prompt.body).toContain("`script_text` 不要把 `must_include_beats` 原句当正文逐条交代");
    expect(prompt.body).toContain("每个 beat 在正文中写成局面推进");
    expect(prompt.body).toContain("`beat_trace.excerpt` 从自然正文中截取证明片段");
  });
```

- [ ] **Step 2: Run red**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/runtime/prompt-runtime.test.ts -t "separates natural script text"
```

Expected: FAIL because `script.writer` does not yet contain the new boundary contract.

- [ ] **Step 3: Add the minimal prompt contract**

In `prompts/script/script-writer.prompt.md`, add a short contract under the hard constraints section, near the existing `beat_trace` and `must_include_beats` rules:

```markdown
- `beat_trace.beat` 逐字复用输入 beat，用于审计；`script_text` 不要把 `must_include_beats` 原句当正文逐条交代，而要把每个 beat 在正文中写成局面推进，至少用动作、反应、压力后果中的一到两个具体元素承接；`beat_trace.excerpt` 从自然正文中截取证明片段，不要求正文写成 beat 列表。
```

Do not add more “爆款感” or “抓人” language. Do not rewrite nearby unrelated prompt sections.

- [ ] **Step 4: Run green for the focused test**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/runtime/prompt-runtime.test.ts -t "separates natural script text"
```

Expected: PASS.

- [ ] **Step 5: Run prompt regression**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/runtime/prompt-runtime.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

Stage only the test and prompt:

```powershell
git add tests/backend/runtime/prompt-runtime.test.ts prompts/script/script-writer.prompt.md
git commit -m "明确正文与追踪字段分工"
```

## Task 2: Run Focused Script Runtime Regression

**Files:**

- No production code changes expected.
- No test changes expected.

- [ ] **Step 1: Run script runtime regression**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/script/script-runtime-generate.test.ts tests/backend/script/script-graph-run.test.ts tests/backend/script/script-local-validator.test.ts --no-file-parallelism
```

Expected: PASS. If it fails, stop and investigate before continuing.

- [ ] **Step 2: Check working tree**

Run:

```powershell
git status --short
```

Expected:

- No modified runtime files from this task.
- `storage/topic-candidate-library/` may remain untracked and must not be staged.

## Task 3: Run Real 5-Round Observation

**Files:**

- Generated only: `harness/scripts/runtime/output/<run-id>/`
- Create later in Task 4: `docs/records/YYYY-MM-DD-script-text-trace-boundary-quality-check.md`

- [ ] **Step 1: Confirm live-check environment**

Confirm `.env` non-secret values:

```powershell
Get-Content .env | Where-Object { $_ -match '^(LLM_PROVIDER|LLM_BASE_URL|LLM_MODEL|LLM_STRUCTURED_BASE_URL|LLM_STRUCTURED_MODEL|LLM_TIMEOUT_MS)=' }
```

Expected:

```text
LLM_PROVIDER=openai
LLM_BASE_URL=https://open.bigmodel.cn/api/paas/v4
LLM_MODEL=glm-5.1
LLM_STRUCTURED_BASE_URL=https://open.bigmodel.cn/api/paas/v4
LLM_STRUCTURED_MODEL=glm-4
```

If `LLM_TIMEOUT_MS=45000`, prefer a temporary shell override for this run because `glm-5.1` has already timed out at 45 seconds:

```powershell
$env:LLM_TIMEOUT_MS='120000'
```

- [ ] **Step 2: Run fixed 5-round harness command**

Run:

```powershell
npm run harness:topic-script-five-round-quality-check -- --output-dir harness/scripts/runtime/output/2026-05-07-script-text-trace-boundary-five-round
```

Expected:

- `status` is `five-round-quality-check-completed`.
- `total_samples` is `5`.
- `passed_samples` is `5`.
- `sample_ready_samples` is `5`.
- `local_validation_passed_samples` is `5`.

If the run fails because of external timeout, retry once with `LLM_TIMEOUT_MS=120000`. If it fails for prompt/schema/validation reasons, stop and investigate before changing anything.

- [ ] **Step 3: Extract every script for human review**

Run:

```powershell
node -e "const fs=require('fs'); const path=require('path'); const root='harness/scripts/runtime/output/2026-05-07-script-text-trace-boundary-five-round'; for (const dir of fs.readdirSync(root).filter((n)=>fs.statSync(path.join(root,n)).isDirectory()).sort()) { const draft=JSON.parse(fs.readFileSync(path.join(root,dir,'script-draft.json'),'utf8')); const text=(draft.draft&&draft.draft.script_text)||draft.script_text||''; console.log('\\n===== '+dir+' =====\\n'+text); }"
```

Expected: full script text for all 5 rounds is visible for manual judgement.

## Task 4: Record Observation and Conclusion

**Files:**

- Create: `docs/records/2026-05-07-script-text-trace-boundary-quality-check.md`

- [ ] **Step 1: Create the observation record**

Create `docs/records/2026-05-07-script-text-trace-boundary-quality-check.md` after reading the actual files in `harness/scripts/runtime/output/2026-05-07-script-text-trace-boundary-five-round`.

The committed record must contain these sections with real values from the run:

- `# Script Text / Trace Boundary Quality Check`
- `日期：2026-05-07`
- `## 配置`
- `## 汇总`
- `## 逐轮观察`
- `## 每轮正文`
- `## 结论`

Use `status.json`, `validation-result.json`, `semantic-review-result.json`, and `script-draft.json` from each sample directory to fill the tables. The “字段痕迹” column is a human observation label, not an automated gate. Use one of:

- `明显`
- `轻微`
- `无明显`

The “人工判断” column should briefly state whether the draft is still field-like, natural enough for first draft, or needs further prompt work.

The record must include full `script_text` for all five rounds under these headings:

```markdown
### hongmenyan
### julu-zhizhan
### yanzi-shichu
### yanzi-shichu-repeat-2
### zhuanzhu-ciwangliao
```

Do not commit the record until every section contains actual run data and full scripts.

- [ ] **Step 2: Verify record has no placeholders**

Run:

```powershell
Select-String -Path docs/records/2026-05-07-script-text-trace-boundary-quality-check.md -Pattern '粘贴完整|待补|未填写|  \\|  \\|'
```

Expected: no output.

- [ ] **Step 3: Commit Task 4**

Stage only the record:

```powershell
git add docs/records/2026-05-07-script-text-trace-boundary-quality-check.md
git commit -m "记录正文与追踪字段边界观察"
```

## Final Verification

Before claiming completion, run:

```powershell
git status --short --branch
```

Expected:

- Branch is `dev`.
- Only expected untracked `storage/topic-candidate-library/` may remain.

Then report:

- Actual changed files.
- Test commands and results.
- 5-round result summary.
- Full scripts for user review.
- Whether field-like beat restatement improved.

Do not claim the quality problem is solved unless the 5-round scripts support that claim.
