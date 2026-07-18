# Script Beat Node Contract Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tighten the topic-to-script beat contract so `must_include_beats` carries auditable narrative nodes rather than prose-like explanatory sentences that the script writer is tempted to paste into `script_text`.

**Architecture:** Keep the existing `TopicCandidateCard.must_cover_preview -> TopicPackage.must_include_beats -> ScriptInputBundle.hard_lane.must_include_beats` path intact. This round only clarifies topic prompt contracts and observes real runtime output; it does not add local semantic judgment, schema changes, patch/regen, or downstream phases.

**Tech Stack:** TypeScript, Vitest, Prompt Registry markdown prompts, existing topic/script runtime harness.

---

## Boundaries

Allowed changes:
- `prompts/topic/candidate-builder.prompt.md`
- `prompts/topic/candidate-builder-repair.prompt.md`
- `tests/backend/runtime/topic-prompt-contract.test.ts`
- One record under `docs/records/`

Do not change:
- `TopicPackage` schema
- `TopicCandidateCard` schema
- script writer prompt
- script local validator semantics
- semantic reviewer gate behavior
- patch/regen main path
- UI, storyboard, asset, compose, downstream objects
- `.env.example` unless a separate task explicitly asks for model config docs
- `storage/topic-candidate-library/`

Do not add a local heuristic that decides whether a beat is "good", "viral", or "semantic enough". Local tests may only verify prompt contract text and structural wiring.

## Current Code Facts

- `backend/src/modules/topic/topic-confirm.service.ts` already has `StoredTopicCandidate.mustCoverPreview?: string[]`.
- `buildMustIncludeBeats()` already prefers `candidate.mustCoverPreview` when at least three non-empty values exist.
- `buildNarrativeTensionMap()` and `buildStakes()` already reuse preview beat material.
- The remaining observed problem is that real `must_cover_preview` values can be written as full explanatory prose, so script text can inherit field-shaped sentences.
- Therefore this plan starts upstream at `topic.candidate-builder` and `topic.candidate-builder-repair`, not at the script writer.

---

### Task 1: Tighten Candidate Builder Beat Node Contract

**Files:**
- Modify: `tests/backend/runtime/topic-prompt-contract.test.ts`
- Modify: `prompts/topic/candidate-builder.prompt.md`

- [ ] **Step 1: Write the failing test**

Add this test inside `describe("topic prompt contract", () => { ... })` in `tests/backend/runtime/topic-prompt-contract.test.ts`, near the existing `must_cover_preview` test:

```ts
  it("requires candidate-builder must_cover_preview to be beat nodes instead of prose sentences", () => {
    const prompt = createPromptRegistry().getPrompt("topic.candidate-builder");

    expect(prompt.metadata.language).toBe("zh-CN");
    expect(prompt.body).toContain("`must_cover_preview` 是叙事节点，不是正文句");
    expect(prompt.body).toContain("优先写成场景、动作或转折短语");
    expect(prompt.body).toContain("不写解释性评价或完整总结句");
    expect(prompt.body).toContain("名句可以作为节点锚点，但不要附带完整解释");
  });
```

- [ ] **Step 2: Run red**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/runtime/topic-prompt-contract.test.ts -t "beat nodes instead of prose sentences"
```

Expected: `FAIL`, because `topic.candidate-builder` does not yet contain the new beat node wording.

- [ ] **Step 3: Make the minimal prompt change**

In `prompts/topic/candidate-builder.prompt.md`, place this single bullet directly after the existing `must_cover_preview` bullet:

```md
- `must_cover_preview` 是叙事节点，不是正文句；优先写成场景、动作或转折短语，不写解释性评价或完整总结句；名句可以作为节点锚点，但不要附带完整解释。
```

Do not add examples, blacklists, topic-specific rules, or repeated "viral" slogans in this task.

- [ ] **Step 4: Run green**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/runtime/topic-prompt-contract.test.ts -t "beat nodes instead of prose sentences"
```

Expected: `PASS`.

- [ ] **Step 5: Run the prompt contract file**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/runtime/topic-prompt-contract.test.ts
```

Expected: all tests in `topic-prompt-contract.test.ts` pass.

- [ ] **Step 6: Commit**

Stage only the two Task 1 files:

```powershell
git add tests/backend/runtime/topic-prompt-contract.test.ts prompts/topic/candidate-builder.prompt.md
git commit -m "收紧主题候选必讲节点合同"
```

---

### Task 2: Tighten Candidate Builder Repair Beat Node Contract

**Files:**
- Modify: `tests/backend/runtime/topic-prompt-contract.test.ts`
- Modify: `prompts/topic/candidate-builder-repair.prompt.md`

- [ ] **Step 1: Write the failing test**

Add this test inside `tests/backend/runtime/topic-prompt-contract.test.ts`, near the existing `topic.candidate-builder-repair` tests:

```ts
  it("requires builder-repair to fill missing must_cover_preview as beat nodes", () => {
    const prompt = createPromptRegistry().getPrompt("topic.candidate-builder-repair");

    expect(prompt.metadata.language).toBe("zh-CN");
    expect(prompt.body).toContain("如果补齐 `must_cover_preview`");
    expect(prompt.body).toContain("叙事节点，不是正文句");
    expect(prompt.body).toContain("不写解释性评价或完整总结句");
  });
```

- [ ] **Step 2: Run red**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/runtime/topic-prompt-contract.test.ts -t "fill missing must_cover_preview as beat nodes"
```

Expected: `FAIL`, because `topic.candidate-builder-repair` currently says it fills missing fields but does not define the beat-node shape for missing `must_cover_preview`.

- [ ] **Step 3: Make the minimal prompt change**

In `prompts/topic/candidate-builder-repair.prompt.md`, place this single bullet under `## 处理原则` after the field-completeness bullet:

```md
- 如果补齐 `must_cover_preview`，必须写成 3 条叙事节点，不是正文句；优先写成场景、动作或转折短语，不写解释性评价或完整总结句。
```

Do not allow repair to reopen candidate discovery, rewrite complete fields, or produce `TopicPackage`.

- [ ] **Step 4: Run green**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/runtime/topic-prompt-contract.test.ts -t "fill missing must_cover_preview as beat nodes"
```

Expected: `PASS`.

- [ ] **Step 5: Run the prompt contract file**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/runtime/topic-prompt-contract.test.ts
```

Expected: all tests in `topic-prompt-contract.test.ts` pass.

- [ ] **Step 6: Commit**

Stage only the two Task 2 files:

```powershell
git add tests/backend/runtime/topic-prompt-contract.test.ts prompts/topic/candidate-builder-repair.prompt.md
git commit -m "收紧主题候选修复必讲节点合同"
```

---

### Task 3: Run Minimal Topic-to-Script Regression

**Files:**
- No source edits.

- [ ] **Step 1: Run the structural regression set**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/runtime/topic-prompt-contract.test.ts tests/backend/topic/topic-runtime-recommendation.test.ts tests/backend/topic/topic-confirm.service.test.ts tests/backend/script/script-runtime-generate.test.ts --no-file-parallelism
```

Expected:
- `topic-prompt-contract.test.ts` passes.
- topic runtime recommendation tests pass.
- topic confirm service tests pass.
- script runtime generate tests pass.

- [ ] **Step 2: Confirm no forbidden file was staged**

Run:

```powershell
git status --short
```

Expected:
- Task 1 and Task 2 are already committed.
- `.env.example` may still appear if it was dirty before this plan; do not stage it in this task.
- `storage/topic-candidate-library/` may still appear as untracked; do not stage it.

---

### Task 4: Run Real Five-Round Observation

**Files:**
- Create: `docs/records/2026-05-07-script-beat-node-contract-quality-check.md`

- [ ] **Step 1: Run the fixed five-round harness command**

Use a unique output directory:

```powershell
$env:LLM_TIMEOUT_MS='120000'; npm run harness:topic-script-five-round-quality-check -- --output-dir harness/scripts/runtime/output/2026-05-07-script-beat-node-contract-five-round
```

Expected:
- Command exits `0`.
- Summary reports `total = 5`.
- Local validation does not fail.
- Semantic reviewer remains shadow-only.

- [ ] **Step 2: Extract every round's topic beats and script text**

Run:

```powershell
node -e "const fs=require('fs'); const path='harness/scripts/runtime/output/2026-05-07-script-beat-node-contract-five-round'; for (const name of fs.readdirSync(path).sort()) { const p=path+'/'+name; if (!fs.statSync(p).isDirectory()) continue; const topic=JSON.parse(fs.readFileSync(p+'/topic-package.json','utf8')); const script=JSON.parse(fs.readFileSync(p+'/script-record.json','utf8')); console.log('\\n## '+name); console.log('must_include_beats:'); for (const beat of topic.must_include_beats) console.log('- '+beat); console.log('\\nscript_text:\\n'+script.script_text); }"
```

Expected:
- Output includes five round sections.
- Each section includes `must_include_beats`.
- Each section includes full `script_text`.

- [ ] **Step 3: Write the observation record**

Create `docs/records/2026-05-07-script-beat-node-contract-quality-check.md` from the actual harness output. The saved record must include:

- Title: `# Script Beat Node Contract Quality Check`
- Date: `日期：2026-05-07`
- Run config with actual `LLM_MODEL`, `LLM_STRUCTURED_MODEL`, `LLM_TIMEOUT_MS`, and the harness command.
- Automatic summary with the actual `total`, `passed`, `sample-ready`, local validation count, and semantic reviewer shadow count from the command output.
- Manual observation that answers each of these with evidence from the five scripts:
  - whether `must_include_beats` now looks more like narrative nodes
  - whether `script_text` reduces field-shaped restatement
  - whether 晏子使楚 covers 狗门、使狗国者从狗门入、橘生淮南淮北
  - whether shorter beat nodes caused famous scenes to be missed
  - whether any new template pollution appeared
- Five round sections, each with the actual `must_include_beats` list and the full `script_text`.
- A conclusion that says whether this direction is effective, ineffective, or mixed.

Do not save blank bullets, empty counters, or empty code fences. The record must include the full script text from every round because the user asked to personally judge each generated script.

- [ ] **Step 4: Verify the record has no empty placeholders**

Run:

```powershell
Select-String -Path docs/records/2026-05-07-script-beat-node-contract-quality-check.md -Pattern "total:$|passed:$|sample-ready:$|local validation:$|semantic reviewer shadow:$|^- $|```text\\s*```"
```

Expected: no matches.

- [ ] **Step 5: Commit the record**

Stage only the record:

```powershell
git add docs/records/2026-05-07-script-beat-node-contract-quality-check.md
git commit -m "记录脚本必讲节点合同观察"
```

---

## Success Criteria

- Prompt contract tests fail before each prompt change and pass after the minimal change.
- No schema, API, writer prompt, validator, reviewer gate, or downstream files are changed.
- Topic confirm still preserves `mustCoverPreview` as `must_include_beats`.
- The five-round live check exits successfully.
- The observation record includes every round's full script text.
- The observation explicitly judges whether 晏子使楚 covers:
  - 狗门羞辱
  - 使狗国者从狗门入
  - 橘生淮南淮北
- `storage/topic-candidate-library/` is not staged or committed.

## Risk Controls

- If Task 1 or Task 2 makes the prompt noticeably longer than one new bullet per prompt, stop and reduce it.
- If Task 3 fails outside prompt-contract assertions, use `superpowers:systematic-debugging` before changing code.
- If Task 4 passes structurally but real scripts still read like field traces, record that honestly; do not add another prompt rule in the same task.
- If `must_include_beats` becomes too short and scripts start missing famous scenes, treat that as a failed quality direction and design a separate fix.
- If the live run times out with the default `.env` timeout, rerun with temporary `$env:LLM_TIMEOUT_MS='120000'` rather than editing `.env.example`.
