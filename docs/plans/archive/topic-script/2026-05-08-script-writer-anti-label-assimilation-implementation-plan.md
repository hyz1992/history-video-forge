# Script Writer Anti-Label Assimilation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce `must_include_beats` label leakage in script drafts by clarifying the existing writer prompt contract, without adding local semantic gates or a new Brief stage.

**Architecture:** Keep the current `TopicPackage -> ScriptInputBundle -> script.writer -> ScriptDraftPackage` flow unchanged. Add prompt-runtime tests that pin a concise audit/prose boundary, then consolidate existing overlapping writer prompt rules into that boundary. Validate with the existing prompt/runtime tests and one GLM-5.1 five-round observation record.

**Tech Stack:** TypeScript, Vitest, Prompt Registry markdown prompts, existing harness `topic-script-five-round-quality-check`.

---

## Scope And Constraints

Work directly in `history-video-forge` on `dev`. Do not create a worktree.

Before every task:

```powershell
git status --short
```

Do not stage or commit:

- `storage/topic-candidate-library/`
- `harness/scripts/runtime/output/`
- existing unrelated untracked files

Do not add:

- `ScriptWritingBrief`
- `materialization_brief`
- new script brief schemas
- new runtime stages between topic and script
- local semantic judges, keyword blacklists, field-copy scoring, or automatic semantic gates

If a task makes the prompt longer without deleting or merging overlapping old wording, stop and revise the task before committing.

## File Responsibilities

- `tests/backend/runtime/prompt-runtime.test.ts`: pins the writer prompt contract loaded through Prompt Registry.
- `tests/harness/script-brief-shadow-stopped.test.ts`: keeps executable Brief-like entry points out of runtime surfaces.
- `prompts/script/script-writer.prompt.md`: the only prompt file allowed to change in this implementation.
- `docs/records/2026-05-08-script-writer-anti-label-assimilation-quality-check.md`: records the live five-round GLM-5.1 observation after the prompt change.

## Task 1: Add Prompt Contract And No-Brief Guard Tests

**Files:**
- Modify: `tests/backend/runtime/prompt-runtime.test.ts`
- Modify: `tests/harness/script-brief-shadow-stopped.test.ts`

- [ ] **Step 1: Write the failing prompt contract test**

Add this test near the existing script writer prompt tests in `tests/backend/runtime/prompt-runtime.test.ts`:

```ts
  it("keeps script writer audit fields separate from spoken prose without label recitation", () => {
    const prompt = createPromptRegistry().getPrompt("script.writer");

    expect(prompt.metadata.language).toBe("zh-CN");
    expect(prompt.body).toContain("审计字段与正文边界");
    expect(prompt.body).toContain("`beat_trace.beat` 是审计字段，必须逐字复用输入 beat");
    expect(prompt.body).toContain(
      "`script_text` 是口播正文，不得把 `must_include_beats` 原句当标签、清单或解释句逐条复述",
    );
    expect(prompt.body).toContain(
      "每条 beat 必须吸收成局面推进，至少包含动作、反应、压力变化或后果中的一个具体元素",
    );
    expect(prompt.body).toContain("`beat_trace.excerpt` 必须从自然正文截取");
    expect(prompt.body).toContain("`canonical_quote_intents` 必须通过场面目的和结尾回响兑现");
  });
```

- [ ] **Step 2: Add the no-Brief runtime-surface guard**

In `tests/harness/script-brief-shadow-stopped.test.ts`, add this constant after `executableEntries`:

```ts
const runtimeSurfaceEntries = [
  "package.json",
  "shared/src/index.ts",
  "backend/src/modules/script/script-generation.service.ts",
  "prompts/script/script-writer.prompt.md",
];
```

Then add this test inside `describe("script brief shadow stopped state", () => { ... })`:

```ts
  it("does not reintroduce Brief-like runtime surfaces under another name", () => {
    for (const entry of runtimeSurfaceEntries) {
      const content = readFileSync(entry, "utf8");

      expect(content, entry).not.toContain("ScriptWritingBrief");
      expect(content, entry).not.toContain("materialization_brief");
      expect(content, entry).not.toContain("script_brief");
      expect(content, entry).not.toContain("ScriptBrief");
    }
  });
```

This guard may already pass. The red signal for this task must come from the new prompt contract test.

- [ ] **Step 3: Run red tests**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/runtime/prompt-runtime.test.ts tests/harness/script-brief-shadow-stopped.test.ts
```

Expected:

- command exits non-zero
- `keeps script writer audit fields separate from spoken prose without label recitation` fails because the prompt does not yet contain `审计字段与正文边界`
- the Brief stopped tests should pass or remain unrelated to the red failure

- [ ] **Step 4: Commit nothing**

Do not commit after Task 1. Leave the failing tests in the working tree for Task 2.

## Task 2: Consolidate Writer Prompt Anti-Label Contract

**Files:**
- Modify: `prompts/script/script-writer.prompt.md`
- Test: `tests/backend/runtime/prompt-runtime.test.ts`
- Test: `tests/harness/script-brief-shadow-stopped.test.ts`

- [ ] **Step 1: Replace overlapping beat/trace bullets with one concise section**

In `prompts/script/script-writer.prompt.md`, find the existing adjacent bullets that separately describe:

- `beat_trace` every `beat` reusing `hard_lane.must_include_beats`
- `beat_trace.excerpt` being cut from `script_text`
- `beat_trace.beat` reusing input beat while `script_text` should not recite `must_include_beats`
- `canonical_quote_intents`

Replace those overlapping bullets with this concise section. Keep all other prompt rules unchanged.

```markdown
## 审计字段与正文边界

- `beat_trace.beat` 是审计字段，必须逐字复用输入 beat；不得自行改名、改写或补充。
- `script_text` 是口播正文，不得把 `must_include_beats` 原句当标签、清单或解释句逐条复述。
- 每条 beat 必须吸收成局面推进，至少包含动作、反应、压力变化或后果中的一个具体元素；正文要像故事推进，不像字段验收。
- `beat_trace.excerpt` 必须从自然正文截取能证明该 beat 已写到的完整短句，不少于 8 个汉字等价长度；不得只填 beat 名称、序号或概括标签。
- `canonical_quote_intents` 必须通过场面目的和结尾回响兑现；引用或转述名句时按对应 `intent` 使用，不改成其他寓意，也不把名句贴成脱离场面的解释。
```

- [ ] **Step 2: Check prompt did not grow by pure addition**

Run:

```powershell
git diff --word-diff -- prompts/script/script-writer.prompt.md
```

Expected:

- diff shows the new `审计字段与正文边界` section
- diff also shows the older overlapping beat/trace/quote bullets were removed or merged
- no new `ScriptWritingBrief`, `materialization_brief`, `script_brief`, or `ScriptBrief`

- [ ] **Step 3: Run green tests for the changed contract**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/runtime/prompt-runtime.test.ts tests/harness/script-brief-shadow-stopped.test.ts
```

Expected:

- command exits 0
- all tests in both files pass

- [ ] **Step 4: Run focused script runtime regression**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/script/script-runtime-generate.test.ts tests/backend/runtime/prompt-runtime.test.ts tests/harness/script-brief-shadow-stopped.test.ts
```

Expected:

- command exits 0
- no local validator or script runtime regression is introduced

- [ ] **Step 5: Commit Task 2**

Stage only the prompt and test files:

```powershell
git add -- tests/backend/runtime/prompt-runtime.test.ts tests/harness/script-brief-shadow-stopped.test.ts prompts/script/script-writer.prompt.md
git status --short
git commit -m "收敛脚本writer反标签化合同"
```

Before committing, confirm `git status --short` does not stage `storage/topic-candidate-library/` or unrelated untracked files.

## Task 3: Record Five-Round GLM-5.1 Quality Observation

**Files:**
- Create: `docs/records/2026-05-08-script-writer-anti-label-assimilation-quality-check.md`

This task records evidence only. Do not add gates, validators, or runtime code.

- [ ] **Step 1: Run the five-round harness with GLM-5.1**

Use the model-aware structured defaults already in code. Only set the model and timeout values needed for this run.

```powershell
$env:LLM_PROVIDER='openai'
$env:LLM_MODEL='glm-5.1'
$env:LLM_STRUCTURED_MODEL='glm-5.1'
$env:LLM_TIMEOUT_MS='120000'
$runId='2026-05-08-glm51-anti-label-five-round'
npm run harness:topic-script-five-round-quality-check -- --output-dir harness/scripts/runtime/output/$runId
```

Expected:

- command exits 0
- `harness/scripts/runtime/output/2026-05-08-glm51-anti-label-five-round/live-check-summary.json` exists
- total samples is 5

If the outer shell times out but the underlying process continues, monitor the output directory and summary file before judging the run.

- [ ] **Step 2: Read the summary and sample logs**

Run:

```powershell
Get-Content -LiteralPath 'harness/scripts/runtime/output/2026-05-08-glm51-anti-label-five-round/live-check-summary.json'
rg -n "semantic|local|topic_package|sufficiency|patch_once|pass|script_text|must_include_beats|canonical_quote" harness/scripts/runtime/output/2026-05-08-glm51-anti-label-five-round
```

Expected:

- summary reports the sample counts
- logs contain enough evidence to manually compare beat-label leakage against `docs/records/2026-05-08-strict-structured-provider-topic-selector-probe.md`

- [ ] **Step 3: Write the observation record**

Create `docs/records/2026-05-08-script-writer-anti-label-assimilation-quality-check.md` with this structure. Every metric line must contain the concrete value copied from `live-check-summary.json` before the file is saved.

```markdown
# Script Writer Anti-Label Assimilation Quality Check

Date: 2026-05-08

## Source

- Design: `docs/plans/2026-05-08-script-writer-anti-label-assimilation-design.md`
- Implementation commit: the Task 2 commit SHA
- Output dir: `harness/scripts/runtime/output/2026-05-08-glm51-anti-label-five-round`

## Configuration

- LLM_PROVIDER: openai
- LLM_MODEL: glm-5.1
- LLM_STRUCTURED_MODEL: glm-5.1
- LLM_TIMEOUT_MS: 120000
- Structured defaults: model-aware defaults from code

## Summary

- total samples: the concrete total sample count from `live-check-summary.json`
- passed samples: the concrete passed sample count from `live-check-summary.json`
- failed samples: the concrete failed sample count from `live-check-summary.json`
- local validation passed samples: the concrete local-validation pass count from `live-check-summary.json`
- topic package sufficiency ok samples: the concrete topic-package sufficiency ok count from `live-check-summary.json`
- semantic reviewer shadow: concrete counts grouped by reviewer decision

## Manual Anti-Label Observation

| Sample | Label leakage | Peak scene absorption | Quote intent absorption | Note |
| --- | --- | --- | --- | --- |
| yanzi-shichu | lower, same, or higher versus previous GLM-5.1 record | better, same, or weaker | better, same, or weaker | one concrete sentence from the sample |
| zhuanzhu-ciwangliao | lower, same, or higher versus previous GLM-5.1 record | better, same, or weaker | not applicable, better, same, or weaker | one concrete sentence from the sample |
| julu-zhizhan | lower, same, or higher versus previous GLM-5.1 record | better, same, or weaker | not applicable, better, same, or weaker | one concrete sentence from the sample |
| hongmenyan | lower, same, or higher versus previous GLM-5.1 record | better, same, or weaker | better, same, or weaker | one concrete sentence from the sample |
| yanzi-shichu-repeat-2 | lower, same, or higher versus previous GLM-5.1 record | better, same, or weaker | better, same, or weaker | one concrete sentence from the sample |

## Conclusion

State whether this one prompt consolidation reduced beat-label leakage. If the answer is no or mixed, explicitly say not to continue prompt piling and recommend a higher-level TopicPackage material-shape design.
```

Do not put API keys or private environment values into the record.

- [ ] **Step 4: Run minimal documentation verification**

Run:

```powershell
$patterns = @('T' + 'ODO', 'T' + 'BD', '\[[^\]]+\]')
Select-String -Path 'docs/records/2026-05-08-script-writer-anti-label-assimilation-quality-check.md' -Pattern $patterns
git status --short
```

Expected:

- `Select-String` prints no matches because no placeholders remain
- `git status --short` shows only the new record as a staged candidate plus unrelated pre-existing untracked files

- [ ] **Step 5: Commit Task 3**

Stage only the observation record:

```powershell
git add -- docs/records/2026-05-08-script-writer-anti-label-assimilation-quality-check.md
git status --short
git commit -m "记录脚本反标签化五轮观察"
```

Do not stage generated output directories or `storage/topic-candidate-library/`.

## Final Verification After Task 3

Run:

```powershell
npx vitest run --configLoader runner tests/backend/runtime/prompt-runtime.test.ts tests/harness/script-brief-shadow-stopped.test.ts tests/backend/script/script-runtime-generate.test.ts
git status --short
```

Expected:

- Vitest exits 0
- only unrelated pre-existing untracked files remain
- no generated storage or harness output was committed

## Completion Criteria

The implementation is complete only when:

- Task 2 has a passing red/green trail for prompt contract tests.
- Task 2 commit exists with a Chinese commit message.
- Task 3 record exists and has no placeholders.
- Task 3 commit exists with a Chinese commit message.
- The final verification command exits 0.
- The final report states whether the prompt consolidation helped, did not help, or produced mixed evidence.
