# TopicPackage Opening Pressure Ending Material Shape Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve opening pressure, pressure-chain visibility, and story-internal ending residue through existing TopicPackage fields, without adding Brief-like objects, new schema, or new runtime stages.

**Architecture:** Keep the current `TopicCandidateCard -> TopicPackage -> ScriptInputBundle -> script.writer` flow. Tighten the existing `must_cover_preview` contract, then map the first two preview nodes into existing `hook_claim` and `pressure_escalation` during topic confirmation.

**Tech Stack:** TypeScript, Vitest, Prompt Registry markdown prompts, existing GLM-5.1 harness `topic-script-five-round-quality-check`.

---

## Scope And Constraints

Work directly in `D:/myproject/story-video-forge2` on `dev`. Do not create a worktree.

Before every task:

```powershell
git status --short
```

Do not stage or commit:

- `storage/topic-candidate-library/`
- `harness/scripts/runtime/output/`
- existing unrelated untracked files

Do not add:

- `storyBrief`
- `scriptBrief`
- `openingEndingPlan`
- `ScriptBrief`
- `ScriptWritingBrief`
- `materialization_brief`
- new `TopicPackage` fields
- new runtime stages between topic and script
- local semantic judges, keyword blacklists, field-copy scoring, or automatic semantic gates
- storyboard, asset, compose, or patch integration objects

## File Responsibilities

- `harness/prompts/topic/candidate-builder.prompt.md`: defines the ordered meaning of the existing `must_cover_preview` array.
- `tests/backend/runtime/prompt-runtime.test.ts`: pins the prompt contract through Prompt Registry.
- `backend/src/modules/topic/topic-confirm.service.ts`: maps ordered candidate preview material into existing `TopicPackage` fields.
- `tests/backend/topic/topic-confirm-material-shape.test.ts`: verifies existing `TopicPackage` fields carry opening pressure, pressure turn, and ending residue.
- `tests/harness/script-brief-shadow-stopped.test.ts`: keeps Brief-like runtime surfaces out.
- `docs/records/2026-05-08-topic-package-opening-pressure-ending-quality-check.md`: records the live five-round GLM-5.1 observation.

## Task 1: Add Opening And Ending Prompt Contract Red Test

**Files:**
- Modify: `D:/myproject/story-video-forge2/tests/backend/runtime/prompt-runtime.test.ts`

- [ ] **Step 1: Write the failing prompt contract test**

Add this test near the existing `topic.candidate-builder` prompt tests:

```ts
  it("keeps candidate preview grounded for opening pressure and story residue", () => {
    const prompt = createPromptRegistry().getPrompt("topic.candidate-builder");

    expect(prompt.metadata.language).toBe("zh-CN");
    expect(prompt.body).toContain("第一条必须是具体开场压力");
    expect(prompt.body).toContain("人物、逼迫动作、即将失去的东西");
    expect(prompt.body).toContain("第二条必须是压力转折或高潮兑现");
    expect(prompt.body).toContain("第三条必须是故事内余震");
    expect(prompt.body).toContain("不得写成脱离故事的现代金句");
  });
```

- [ ] **Step 2: Run red test**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/runtime/prompt-runtime.test.ts
```

Expected:

- command exits non-zero;
- the new test fails because the prompt does not yet contain `第一条必须是具体开场压力`.

- [ ] **Step 3: Commit nothing**

Do not commit after Task 1. Leave the failing test for Task 2.

## Task 2: Tighten Candidate Builder Opening/Ending Contract

**Files:**
- Modify: `D:/myproject/story-video-forge2/harness/prompts/topic/candidate-builder.prompt.md`
- Test: `D:/myproject/story-video-forge2/tests/backend/runtime/prompt-runtime.test.ts`

- [ ] **Step 1: Replace the current `must_cover_preview` wording**

In `harness/prompts/topic/candidate-builder.prompt.md`, replace the current three adjacent `must_cover_preview` bullets:

```markdown
- `must_cover_preview` 三条顺序必须稳定：第一条：进入压力；第二条：峰值动作或高潮兑现；第三条：代价、余震或第二名句回响。
- 第二条不得只写准备、训练、铺垫或泛泛强场面，必须落到观众真正等待的动作、反击、刺杀、摊牌、名句打回去或局面翻转。
- `must_cover_preview` 是叙事节点，不是正文句；优先写成场景、动作或转折短语，不写解释性评价或完整总结句；名句可以作为节点锚点，但不要附带完整解释。
```

with:

```markdown
- `must_cover_preview` 三条顺序必须稳定：第一条必须是具体开场压力；第二条必须是压力转折或高潮兑现；第三条必须是故事内余震。
- 第一条必须包含人物、逼迫动作、即将失去的东西，优先写成具体羞辱、危险、失控、选择或反常识画面，不写“他该怎么办”这类泛问题。
- 第二条不得只写准备、训练、铺垫或泛泛强场面，必须落到观众真正等待的动作、反击、刺杀、摊牌、名句打回去、决策裂缝或局面翻转。
- 第三条必须从故事内部产生余震，可写命运反讽、权力代价、人物性格裂缝、后续历史后果或名场面回扣；不得写成脱离故事的现代金句。
- `must_cover_preview` 是叙事节点，不是正文句；优先写成场景、动作或转折短语，不写解释性评价或完整总结句；名句可以作为节点锚点，但不要附带完整解释。
```

This is a replacement of the old contract, not an additive writer-prompt pile-up.

- [ ] **Step 2: Check prompt did not grow by unrelated addition**

Run:

```powershell
git diff --word-diff -- harness/prompts/topic/candidate-builder.prompt.md
```

Expected:

- diff shows the old three bullets replaced by the new five bullets;
- no `storyBrief`, `scriptBrief`, `openingEndingPlan`, `ScriptBrief`, `ScriptWritingBrief`, or `materialization_brief`.

- [ ] **Step 3: Run green prompt test**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/runtime/prompt-runtime.test.ts
```

Expected:

- command exits 0;
- all prompt-runtime tests pass.

- [ ] **Step 4: Commit Task 2**

Stage only the prompt and prompt-runtime test:

```powershell
git add -- tests/backend/runtime/prompt-runtime.test.ts harness/prompts/topic/candidate-builder.prompt.md
git status --short
git commit -m "收紧候选开场余震材料合同"
```

Before committing, confirm `git status --short` does not stage `storage/topic-candidate-library/`, generated harness output, or unrelated untracked files.

## Task 3: Add Topic Confirm Opening/Pressure Mapping Red Test

**Files:**
- Modify: `D:/myproject/story-video-forge2/tests/backend/topic/topic-confirm-material-shape.test.ts`

- [ ] **Step 1: Add the failing topic confirm test**

Append this test inside the existing `describe("topic confirm material shape", () => { ... })` block:

```ts
  it("carries opening pressure and pressure turn into existing tension fields", async () => {
    const db = createDbClient();
    const project = await createProject(db, {
      name: "Topic Opening Pressure Shape",
    });
    const event = createEvent({
      id: "event-hongmenyan",
      canonicalName: "鸿门宴",
    });

    const candidate = createCandidate(project.id, {
      candidateId: "candidate-hongmenyan",
      event,
      title: "鸿门宴：刘邦如何把自己变成杀了也不体面的人",
      oneLineAngle: "刘邦赌的不是项羽善良，而是项羽太在乎自己像不像天下共主。",
      familyLabel: "权力饭局型",
      scopeLabel: "完整事件",
      coreConflict:
        "项羽一念之间可以杀刘邦，但刘邦把自己包装成已经认输的人，让项羽动手也不像霸主。",
      strongScene: "范增举玦，项羽迟迟不令。",
      mustCoverPreview: [
        "刘邦带礼物低头入营谢罪，把自己压成已经认输的人",
        "范增频频举玦催杀，项羽为了霸主姿态迟迟不令",
        "刘邦从项羽的性格裂缝里逃出鸿门宴",
      ],
      sourceHint: "《史记·项羽本纪》",
    });

    const result = await confirmTopicCandidate({
      projectDb: db,
      project,
      candidate,
    });

    expect(result.topic_package.narrative_tension_map.hook_claim).toContain(
      "刘邦带礼物低头入营谢罪，把自己压成已经认输的人",
    );
    expect(result.topic_package.narrative_tension_map.hook_claim).toContain(
      "刘邦赌的不是项羽善良",
    );
    expect(
      result.topic_package.narrative_tension_map.pressure_escalation,
    ).toContain(
      "项羽一念之间可以杀刘邦，但刘邦把自己包装成已经认输的人，让项羽动手也不像霸主。",
    );
    expect(
      result.topic_package.narrative_tension_map.pressure_escalation,
    ).toContain("刘邦带礼物低头入营谢罪，把自己压成已经认输的人");
    expect(
      result.topic_package.narrative_tension_map.pressure_escalation,
    ).toContain("范增频频举玦催杀，项羽为了霸主姿态迟迟不令");
    expect(result.topic_package.narrative_tension_map.peak_payoff).toBe(
      "范增频频举玦催杀，项羽为了霸主姿态迟迟不令",
    );
    expect(result.topic_package.narrative_tension_map.ending_residue).toBe(
      "刘邦从项羽的性格裂缝里逃出鸿门宴",
    );
    expect(result.topic_package.stakes).toContain(
      "刘邦从项羽的性格裂缝里逃出鸿门宴",
    );
  });
```

- [ ] **Step 2: Run red test**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/topic/topic-confirm-material-shape.test.ts
```

Expected:

- command exits non-zero;
- the new test fails because current `hook_claim` does not contain the first preview node and current `pressure_escalation` does not contain the second preview node.

- [ ] **Step 3: Commit nothing**

Do not commit after Task 3. Leave the failing test for Task 4.

## Task 4: Map Opening Pressure Into Existing TopicPackage Fields

**Files:**
- Modify: `D:/myproject/story-video-forge2/backend/src/modules/topic/topic-confirm.service.ts`
- Test: `D:/myproject/story-video-forge2/tests/backend/topic/topic-confirm-material-shape.test.ts`
- Test: `D:/myproject/story-video-forge2/tests/backend/api/topic-api-runtime.test.ts`
- Test: `D:/myproject/story-video-forge2/tests/backend/api/topic-api.test.ts`
- Test: `D:/myproject/story-video-forge2/tests/backend/script/script-runtime-generate.test.ts`
- Test: `D:/myproject/story-video-forge2/tests/backend/runtime/prompt-runtime.test.ts`
- Test: `D:/myproject/story-video-forge2/tests/harness/script-brief-shadow-stopped.test.ts`

- [ ] **Step 1: Add small local helpers**

In `backend/src/modules/topic/topic-confirm.service.ts`, after `getCandidatePreviewBeats`, add:

```ts
function trimTerminalPunctuation(value: string) {
  return value.trim().replace(/[。.!！?？]+$/u, "");
}

function buildHookClaim(candidate: StoredTopicCandidate, entryPressure?: string) {
  const selectedAngle = trimTerminalPunctuation(candidate.oneLineAngle);

  return [entryPressure, selectedAngle].filter(Boolean).join(" ");
}
```

- [ ] **Step 2: Update `buildNarrativeTensionMap`**

Replace the current `buildNarrativeTensionMap` function with:

```ts
function buildNarrativeTensionMap(candidate: StoredTopicCandidate) {
  const previewBeats = getCandidatePreviewBeats(candidate);
  const entryPressure = previewBeats[0] ?? candidate.strongScene;
  const peakPayoff = previewBeats[1] ?? candidate.strongScene;
  const endingResidue = previewBeats[2] ?? peakPayoff ?? candidate.coreConflict;

  return {
    hook_claim: buildHookClaim(candidate, entryPressure),
    pressure_escalation: [candidate.coreConflict, entryPressure, peakPayoff]
      .filter(Boolean)
      .join(" "),
    mid_reveal: entryPressure,
    peak_payoff: peakPayoff,
    ending_residue: endingResidue,
  };
}
```

Do not change `buildStakes` unless the Task 3 test shows it no longer contains the third preview node.

- [ ] **Step 3: Run focused green test**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/topic/topic-confirm-material-shape.test.ts
```

Expected:

- command exits 0;
- all topic-confirm material shape tests pass.

- [ ] **Step 4: Run topic API regressions serially**

Run:

```powershell
npx vitest run --configLoader runner --no-file-parallelism tests/backend/topic/topic-confirm-material-shape.test.ts tests/backend/api/topic-api-runtime.test.ts tests/backend/api/topic-api.test.ts
```

Expected:

- command exits 0;
- API shape remains stable;
- no generated `storage/topic-candidate-library/` files are staged.

- [ ] **Step 5: Run script runtime and no-Brief regressions**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/script/script-runtime-generate.test.ts tests/backend/runtime/prompt-runtime.test.ts tests/harness/script-brief-shadow-stopped.test.ts
```

Expected:

- command exits 0;
- script runtime and no-Brief guard remain stable.

- [ ] **Step 6: Commit Task 4**

Stage only the topic confirm implementation and test:

```powershell
git add -- backend/src/modules/topic/topic-confirm.service.ts tests/backend/topic/topic-confirm-material-shape.test.ts
git status --short
git commit -m "塑形TopicPackage开场压力材料"
```

Before committing, confirm unrelated untracked files and `storage/topic-candidate-library/` are not staged.

## Task 5: Record Five-Round GLM-5.1 Opening/Ending Observation

**Files:**
- Create: `D:/myproject/story-video-forge2/docs/records/2026-05-08-topic-package-opening-pressure-ending-quality-check.md`

This task records evidence only. Do not add gates, validators, runtime code, or automatic patching.

- [ ] **Step 1: Run the five-round harness with GLM-5.1**

Use:

```powershell
$env:LLM_PROVIDER='openai'
$env:LLM_MODEL='glm-5.1'
$env:LLM_STRUCTURED_MODEL='glm-5.1'
$env:LLM_TIMEOUT_MS='180000'
$runId='2026-05-08-glm51-opening-pressure-ending-five-round'
npm run harness:topic-script-five-round-quality-check -- --output-dir harness/scripts/runtime/output/$runId
```

Expected:

- command exits 0 or the outer shell timeout is followed by a completed summary file;
- `harness/scripts/runtime/output/2026-05-08-glm51-opening-pressure-ending-five-round/live-check-summary.json` exists;
- total samples is 5.

If the outer shell times out but the underlying process continues, monitor the output directory and summary file before judging the run.

- [ ] **Step 2: Read the summary and sample artifacts**

Run:

```powershell
Get-Content -LiteralPath 'harness/scripts/runtime/output/2026-05-08-glm51-opening-pressure-ending-five-round/live-check-summary.json'
rg -n "semantic|local|topic_package|sufficiency|patch_once|pass|script_text|hook_claim|pressure_escalation|ending_residue|opening_span|ending_span" harness/scripts/runtime/output/2026-05-08-glm51-opening-pressure-ending-five-round
```

Expected:

- summary reports all sample counts;
- artifacts contain enough evidence to compare opening sharpness, explanation depth, and ending aftershock against `docs/records/2026-05-08-topic-package-material-shape-quality-check.md`.

- [ ] **Step 3: Write the observation record**

Create `docs/records/2026-05-08-topic-package-opening-pressure-ending-quality-check.md` with these sections and concrete run evidence:

```markdown
# TopicPackage Opening Pressure Ending Quality Check

Date: 2026-05-08

## Source

- Design: `docs/plans/2026-05-08-topic-package-opening-pressure-ending-material-shape-design.md`
- Implementation plan: `docs/plans/2026-05-08-topic-package-opening-pressure-ending-material-shape-implementation-plan.md`
- Output dir: `harness/scripts/runtime/output/2026-05-08-glm51-opening-pressure-ending-five-round`

## Configuration

- LLM_PROVIDER: openai
- LLM_MODEL: glm-5.1
- LLM_STRUCTURED_MODEL: glm-5.1
- LLM_TIMEOUT_MS: 180000

## Summary

Copy the numeric values from `live-check-summary.json` for total samples, passed samples, failed samples, local validation passed samples, TopicPackage sufficiency ok samples, and semantic reviewer shadow distribution.

## Manual Observation

For each sample, record whether opening sharpness, pressure explanation, and ending aftershock are `better`, `same`, or `weaker` compared with `docs/records/2026-05-08-topic-package-material-shape-quality-check.md`. Include one concrete sentence or clause from the generated script as evidence for each sample.

## Conclusion

Say whether this material-shape pass helped, did not help, or produced mixed evidence. If openings are sharper but endings remain slogan-like, say so directly and recommend stopping prompt work before adding another layer.
```

Before saving, ensure the record contains actual values and sample evidence, not deferred instructions.

- [ ] **Step 4: Run minimal documentation verification**

Run:

```powershell
$patterns = @('T' + 'ODO', 'T' + 'BD', 'replace' + ' with', 'fill' + ' with', 'cite one' + ' concrete sentence', '\[[^\]]+\]')
Select-String -Path 'docs/records/2026-05-08-topic-package-opening-pressure-ending-quality-check.md' -Pattern $patterns
git status --short
```

Expected:

- `Select-String` prints no matches because no placeholders remain;
- `git status --short` shows only the new record plus unrelated pre-existing untracked files.

- [ ] **Step 5: Commit Task 5**

Stage only the observation record:

```powershell
git add -- docs/records/2026-05-08-topic-package-opening-pressure-ending-quality-check.md
git status --short
git commit -m "记录开场余震材料塑形观察"
```

Do not stage generated output directories or `storage/topic-candidate-library/`.

## Final Verification After Task 5

Run:

```powershell
npx vitest run --configLoader runner --no-file-parallelism tests/backend/runtime/prompt-runtime.test.ts tests/backend/topic/topic-confirm-material-shape.test.ts tests/backend/api/topic-api-runtime.test.ts tests/backend/api/topic-api.test.ts tests/backend/script/script-runtime-generate.test.ts tests/harness/script-brief-shadow-stopped.test.ts
git status --short
```

Expected:

- Vitest exits 0;
- only unrelated pre-existing untracked files remain;
- no generated storage or harness output was committed.

## Completion Criteria

The implementation is complete only when:

- Task 2 has a passing red/green trail for the refined `must_cover_preview` prompt contract.
- Task 2 commit exists with a Chinese commit message.
- Task 4 has a passing red/green trail for `topic-confirm` opening/pressure mapping.
- Task 4 commit exists with a Chinese commit message.
- Task 5 record exists and has no placeholders.
- Task 5 commit exists with a Chinese commit message.
- The final verification command exits 0.
- The final report states whether opening/pressure/ending material shaping helped, did not help, or produced mixed evidence.
