# TopicPackage Material Shape For Peak Scene Absorption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make frozen `TopicPackage` material more naturally carry peak action and quote payoff into `script.writer` without changing schema or adding a new stage.

**Architecture:** Keep the current `TopicCandidateCard -> TopicPackage -> ScriptInputBundle -> script.writer` flow. Tighten the existing `must_cover_preview` prompt contract, then map its ordered nodes into existing `narrative_tension_map` fields during topic confirmation.

**Tech Stack:** TypeScript, Vitest, Prompt Registry markdown prompts, existing harness `topic-script-five-round-quality-check`.

---

## Scope And Constraints

Work directly in `D:/myproject/story-video-forge2` on `dev`. Do not create a worktree unless the user explicitly changes that instruction.

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
- `script_brief`
- `ScriptBrief`
- new `TopicPackage` fields
- new runtime stages between topic and script
- local semantic judges, keyword blacklists, field-copy scoring, or automatic semantic gates
- storyboard, asset, compose, or patch integration objects

## File Responsibilities

- `harness/prompts/topic/candidate-builder.prompt.md`: defines the ordered meaning of the existing `must_cover_preview` array.
- `tests/backend/runtime/prompt-runtime.test.ts`: pins the prompt contract through Prompt Registry.
- `backend/src/modules/topic/topic-confirm.service.ts`: maps ordered candidate preview material into existing `TopicPackage` fields.
- `tests/backend/topic/topic-confirm-material-shape.test.ts`: verifies the frozen package uses a concrete peak preview node, not generic `strong_scene`, for `peak_payoff`.
- `tests/harness/script-brief-shadow-stopped.test.ts`: keeps Brief-like runtime surfaces out.
- `docs/records/2026-05-08-topic-package-material-shape-quality-check.md`: records the live five-round GLM-5.1 observation.

## Task 1: Add Ordered Preview Prompt Contract Test

**Files:**
- Modify: `D:/myproject/story-video-forge2/tests/backend/runtime/prompt-runtime.test.ts`

- [ ] **Step 1: Write the failing prompt contract test**

Add this test near the existing topic candidate-builder prompt tests:

```ts
  it("keeps candidate must_cover_preview ordered for peak scene absorption", () => {
    const prompt = createPromptRegistry().getPrompt("topic.candidate-builder");

    expect(prompt.metadata.language).toBe("zh-CN");
    expect(prompt.body).toContain("`must_cover_preview` 三条顺序");
    expect(prompt.body).toContain("第一条：进入压力");
    expect(prompt.body).toContain("第二条：峰值动作或高潮兑现");
    expect(prompt.body).toContain("第三条：代价、余震或第二名句回响");
    expect(prompt.body).toContain("第二条不得只写准备、训练、铺垫或泛泛强场面");
  });
```

- [ ] **Step 2: Run red test**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/runtime/prompt-runtime.test.ts
```

Expected:

- command exits non-zero
- the new test fails because the prompt does not yet contain `` `must_cover_preview` 三条顺序 ``

- [ ] **Step 3: Commit nothing**

Do not commit after Task 1. Leave the failing test for Task 2.

## Task 2: Tighten Candidate Builder Preview Contract

**Files:**
- Modify: `D:/myproject/story-video-forge2/harness/prompts/topic/candidate-builder.prompt.md`
- Test: `D:/myproject/story-video-forge2/tests/backend/runtime/prompt-runtime.test.ts`

- [ ] **Step 1: Replace the current loose `must_cover_preview` wording**

In `harness/prompts/topic/candidate-builder.prompt.md`, replace the existing two adjacent bullets:

```markdown
- `must_cover_preview` 必须给出 3 条可交给脚本审计的叙事节点：进入局面、关键动作、压力/代价；不得把同一句角度摘要改写三遍
- `must_cover_preview` 是叙事节点，不是正文句；优先写成场景、动作或转折短语，不写解释性评价或完整总结句；名句可以作为节点锚点，但不要附带完整解释。
```

with this concise ordered contract:

```markdown
- `must_cover_preview` 三条顺序必须稳定：第一条：进入压力；第二条：峰值动作或高潮兑现；第三条：代价、余震或第二名句回响。
- 第二条不得只写准备、训练、铺垫或泛泛强场面，必须落到观众真正等待的动作、反击、刺杀、摊牌、名句打回去或局面翻转。
- `must_cover_preview` 是叙事节点，不是正文句；优先写成场景、动作或转折短语，不写解释性评价或完整总结句；名句可以作为节点锚点，但不要附带完整解释。
```

- [ ] **Step 2: Check prompt did not grow by pure addition**

Run:

```powershell
git diff --word-diff -- harness/prompts/topic/candidate-builder.prompt.md
```

Expected:

- diff shows the ordered `must_cover_preview` contract
- diff shows older loose wording was replaced or merged
- no new `ScriptWritingBrief`, `materialization_brief`, `script_brief`, or `ScriptBrief`

- [ ] **Step 3: Run green prompt test**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/runtime/prompt-runtime.test.ts
```

Expected:

- command exits 0
- all prompt-runtime tests pass

- [ ] **Step 4: Commit Task 2**

Stage only the prompt and prompt-runtime test:

```powershell
git add -- tests/backend/runtime/prompt-runtime.test.ts harness/prompts/topic/candidate-builder.prompt.md
git status --short
git commit -m "收紧候选预览峰值节点合同"
```

Before committing, confirm `git status --short` does not stage `storage/topic-candidate-library/`, generated harness output, or unrelated untracked files.

## Task 3: Add Topic Confirm Material Shape Tests

**Files:**
- Create: `D:/myproject/story-video-forge2/tests/backend/topic/topic-confirm-material-shape.test.ts`

- [ ] **Step 1: Create the failing topic confirm test file**

Create `tests/backend/topic/topic-confirm-material-shape.test.ts` with this content:

```ts
import { describe, expect, it } from "vitest";

import type { EventRegistryRecord } from "../../../backend/src/db/client.js";
import { createDbClient } from "../../../backend/src/db/client.js";
import { createProject } from "../../../backend/src/modules/projects/project.repository.js";
import {
  confirmTopicCandidate,
  type StoredTopicCandidate,
} from "../../../backend/src/modules/topic/topic-confirm.service.js";

function createEvent(overrides: Partial<EventRegistryRecord> = {}): EventRegistryRecord {
  const now = new Date("2026-05-08T00:00:00.000Z");

  return {
    id: "event-zhuanzhu",
    canonicalName: "专诸刺王僚",
    aliases: [],
    canonicalQuotesJson: [],
    canonicalQuoteIntentsJson: [],
    sourceType: "fixture",
    isProvisional: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function createCandidate(
  projectId: string,
  overrides: Partial<StoredTopicCandidate> = {},
): StoredTopicCandidate {
  return {
    candidateId: "candidate-zhuanzhu",
    projectId,
    event: createEvent(),
    title: "专诸刺王僚",
    oneLineAngle: "真正刺出去的不是一把刀，而是一条已经押上的命。",
    familyLabel: "刺杀政变型",
    scopeLabel: "完整事件",
    coreConflict: "公子光把夺位希望压在专诸一人身上，专诸必须用一场鱼宴完成近身刺杀。",
    strongScene: "鱼腹藏剑改变吴国权力。",
    mustCoverPreview: [
      "公子光以国士之礼结恩专诸",
      "专诸端上鱼宴并从鱼腹中抽剑刺向王僚",
      "专诸以命还恩却把家人余债留在身后",
    ],
    sourceHint: "《史记·刺客列传》",
    recentUsageHint: "近期未出现同 event_id",
    ...overrides,
  };
}

describe("topic confirm material shape", () => {
  it("freezes peak payoff from the second preview node instead of generic strong_scene", async () => {
    const db = createDbClient();
    const project = await createProject(db, {
      name: "Topic Material Shape",
    });

    const result = await confirmTopicCandidate({
      projectDb: db,
      project,
      candidate: createCandidate(project.id),
    });

    expect(result.topic_package.must_include_beats).toEqual([
      "公子光以国士之礼结恩专诸",
      "专诸端上鱼宴并从鱼腹中抽剑刺向王僚",
      "专诸以命还恩却把家人余债留在身后",
    ]);
    expect(result.topic_package.narrative_tension_map.peak_payoff).toBe(
      "专诸端上鱼宴并从鱼腹中抽剑刺向王僚",
    );
    expect(result.topic_package.narrative_tension_map.peak_payoff).not.toBe(
      "鱼腹藏剑改变吴国权力。",
    );
    expect(result.topic_package.narrative_tension_map.ending_residue).toBe(
      "专诸以命还恩却把家人余债留在身后",
    );
    expect(result.topic_package.stakes).toContain(
      "专诸以命还恩却把家人余债留在身后",
    );
  });

  it("preserves quote intent material while using preview nodes for payoff shape", async () => {
    const db = createDbClient();
    const project = await createProject(db, {
      name: "Topic Quote Payoff Shape",
    });
    const event = createEvent({
      id: "event-yanzi",
      canonicalName: "晏子使楚",
      canonicalQuotesJson: [
        "使狗国者，从狗门入",
        "橘生淮南则为橘，生于淮北则为枳",
      ],
      canonicalQuoteIntentsJson: [
        {
          quote: "使狗国者，从狗门入",
          intent: "用于反击楚王以狗门羞辱齐国使节。",
        },
        {
          quote: "橘生淮南则为橘，生于淮北则为枳",
          intent: "用于反击楚王以齐人善盗羞辱齐国。",
        },
      ],
    });

    const result = await confirmTopicCandidate({
      projectDb: db,
      project,
      candidate: createCandidate(project.id, {
        candidateId: "candidate-yanzi",
        event,
        title: "晏子使楚",
        familyLabel: "外交压场型",
        coreConflict: "楚王连续羞辱齐国使节，晏子必须把羞辱当场顶回去。",
        strongScene: "楚王连续压场，晏子一句句顶回去。",
        mustCoverPreview: [
          "楚人闭正门开狗门迎齐使",
          "晏子以使狗国者从狗门入反击狗门羞辱",
          "楚王再以齐人善盗压场，晏子以橘枳之喻把羞辱反扣回楚国",
        ],
      }),
    });

    expect(result.topic_package.canonical_quote_intents).toEqual(
      event.canonicalQuoteIntentsJson,
    );
    expect(result.topic_package.narrative_tension_map.peak_payoff).toBe(
      "晏子以使狗国者从狗门入反击狗门羞辱",
    );
    expect(result.topic_package.narrative_tension_map.ending_residue).toBe(
      "楚王再以齐人善盗压场，晏子以橘枳之喻把羞辱反扣回楚国",
    );
  });
});
```

- [ ] **Step 2: Run red test**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/topic/topic-confirm-material-shape.test.ts
```

Expected:

- command exits non-zero
- first test fails because current `peak_payoff` equals `candidate.strongScene`

- [ ] **Step 3: Commit nothing**

Do not commit after Task 3. Leave the failing test for Task 4.

## Task 4: Map Ordered Preview Nodes Into TopicPackage

**Files:**
- Modify: `D:/myproject/story-video-forge2/backend/src/modules/topic/topic-confirm.service.ts`
- Test: `D:/myproject/story-video-forge2/tests/backend/topic/topic-confirm-material-shape.test.ts`
- Test: `D:/myproject/story-video-forge2/tests/backend/api/topic-api-runtime.test.ts`
- Test: `D:/myproject/story-video-forge2/tests/backend/api/topic-api.test.ts`

- [ ] **Step 1: Update `buildNarrativeTensionMap` and `buildStakes`**

Replace the current `buildNarrativeTensionMap` and `buildStakes` functions in `backend/src/modules/topic/topic-confirm.service.ts` with:

```ts
function buildNarrativeTensionMap(candidate: StoredTopicCandidate) {
  const previewBeats = getCandidatePreviewBeats(candidate);
  const entryPressure = previewBeats[0] ?? candidate.strongScene;
  const peakPayoff = previewBeats[1] ?? candidate.strongScene;
  const endingResidue = previewBeats[2] ?? peakPayoff ?? candidate.coreConflict;

  return {
    hook_claim: candidate.oneLineAngle.replace(/[。.!！]+$/u, ""),
    pressure_escalation: [candidate.coreConflict, entryPressure]
      .filter(Boolean)
      .join(" "),
    mid_reveal: entryPressure,
    peak_payoff: peakPayoff,
    ending_residue: endingResidue,
  };
}

function buildStakes(candidate: StoredTopicCandidate) {
  const previewBeats = getCandidatePreviewBeats(candidate);
  const peakOrResidue =
    previewBeats[2] ?? previewBeats[1] ?? candidate.strongScene;

  return `${candidate.coreConflict} ${peakOrResidue}`;
}
```

Do not change `TopicPackage` schema. Do not add local semantic classification. This is positional mapping only.

- [ ] **Step 2: Run focused green test**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/topic/topic-confirm-material-shape.test.ts
```

Expected:

- command exits 0
- both topic-confirm material shape tests pass

- [ ] **Step 3: Run topic API regressions**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/topic/topic-confirm-material-shape.test.ts tests/backend/api/topic-api-runtime.test.ts tests/backend/api/topic-api.test.ts
```

Expected:

- command exits 0
- API shape remains stable

- [ ] **Step 4: Run script runtime regression**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/script/script-runtime-generate.test.ts tests/backend/runtime/prompt-runtime.test.ts tests/harness/script-brief-shadow-stopped.test.ts
```

Expected:

- command exits 0
- script runtime and no-Brief guard remain stable

- [ ] **Step 5: Commit Task 4**

Stage only the topic confirm implementation and its tests:

```powershell
git add -- backend/src/modules/topic/topic-confirm.service.ts tests/backend/topic/topic-confirm-material-shape.test.ts
git status --short
git commit -m "塑形TopicPackage峰值场面材料"
```

Before committing, confirm the already committed prompt files are not accidentally staged again unless Task 2 was not committed.

## Task 5: Record Five-Round GLM-5.1 Material Shape Observation

**Files:**
- Create: `D:/myproject/story-video-forge2/docs/records/2026-05-08-topic-package-material-shape-quality-check.md`

This task records evidence only. Do not add gates, validators, or runtime code.

- [ ] **Step 1: Run the five-round harness with GLM-5.1**

Use the model-aware structured defaults already in code. Only set the model and timeout values needed for this run.

```powershell
$env:LLM_PROVIDER='openai'
$env:LLM_MODEL='glm-5.1'
$env:LLM_STRUCTURED_MODEL='glm-5.1'
$env:LLM_TIMEOUT_MS='120000'
$runId='2026-05-08-glm51-material-shape-five-round'
npm run harness:topic-script-five-round-quality-check -- --output-dir harness/scripts/runtime/output/$runId
```

Expected:

- command exits 0 or the outer shell timeout is followed by a completed summary file
- `harness/scripts/runtime/output/2026-05-08-glm51-material-shape-five-round/live-check-summary.json` exists
- total samples is 5

If the outer shell times out but the underlying process continues, monitor the output directory and summary file before judging the run.

- [ ] **Step 2: Read the summary and sample artifacts**

Run:

```powershell
Get-Content -LiteralPath 'harness/scripts/runtime/output/2026-05-08-glm51-material-shape-five-round/live-check-summary.json'
rg -n "semantic|local|topic_package|sufficiency|patch_once|pass|script_text|peak_payoff|canonical_quote|鱼腹|橘枳" harness/scripts/runtime/output/2026-05-08-glm51-material-shape-five-round
```

Expected:

- summary reports the sample counts
- logs contain enough evidence to compare against `docs/records/2026-05-08-script-writer-anti-label-assimilation-quality-check.md`

- [ ] **Step 3: Write the observation record**

Create `docs/records/2026-05-08-topic-package-material-shape-quality-check.md` with this structure. Every metric line must contain concrete values copied from `live-check-summary.json`.

```markdown
# TopicPackage Material Shape Quality Check

Date: 2026-05-08

## Source

- Design: `docs/plans/2026-05-08-topic-package-material-shape-for-peak-scene-absorption-design.md`
- Implementation commits: the Task 2 and Task 4 commit SHAs
- Output dir: `harness/scripts/runtime/output/2026-05-08-glm51-material-shape-five-round`

## Configuration

- LLM_PROVIDER: openai
- LLM_MODEL: glm-5.1
- LLM_STRUCTURED_MODEL: glm-5.1
- LLM_TIMEOUT_MS: 120000
- Structured defaults: model-aware defaults from code

## Summary

- total samples: copy the exact `total_samples` number from `live-check-summary.json`
- passed samples: copy the exact `passed_samples` number from `live-check-summary.json`
- failed samples: copy the exact `failed_samples` number from `live-check-summary.json`
- local validation passed samples: copy the exact `local_validation_passed_samples` number from `live-check-summary.json`
- topic package sufficiency ok samples: copy the exact `topic_package_sufficiency_ok_samples` number from `live-check-summary.json`
- semantic reviewer shadow: count `pass`, `patch_once`, `skipped`, and `unknown` decisions from `live-check-summary.json`

## Manual Material Shape Observation

| Sample | Peak scene absorption | Quote payoff absorption | Label leakage | Note |
| --- | --- | --- | --- | --- |
| yanzi-shichu | write one of `better`, `same`, `weaker` versus anti-label record | write one of `better`, `same`, `weaker` | write one of `lower`, `same`, `higher` | quote one short concrete sentence from the sample |
| zhuanzhu-ciwangliao | write one of `better`, `same`, `weaker` versus anti-label record | `not applicable` | write one of `lower`, `same`, `higher` | quote one short concrete sentence from the sample |
| julu-zhizhan | write one of `better`, `same`, `weaker` versus anti-label record | `not applicable` | write one of `lower`, `same`, `higher` | quote one short concrete sentence from the sample |
| hongmenyan | write one of `better`, `same`, `weaker` versus anti-label record | `not applicable` | write one of `lower`, `same`, `higher` | quote one short concrete sentence from the sample |
| yanzi-shichu-repeat-2 | write one of `better`, `same`, `weaker` versus anti-label record | write one of `better`, `same`, `weaker` | write one of `lower`, `same`, `higher` | quote one short concrete sentence from the sample |

## Conclusion

State whether TopicPackage material shaping improved peak-scene absorption. If `zhuanzhu-ciwangliao` still misses the fish-belly peak when the peak preview node is present, explicitly recommend stopping this path and reviewing selected sample ergonomics or candidate material quality.
```

Do not leave placeholders such as `concrete value`, `better, same, or weaker`, or `one concrete sentence` in the saved file. Replace them with the actual run evidence.

- [ ] **Step 4: Run minimal documentation verification**

Run:

```powershell
$patterns = @('T' + 'ODO', 'T' + 'BD', 'copy the exact', 'write one of', 'quote one short concrete sentence', '\[[^\]]+\]')
Select-String -Path 'docs/records/2026-05-08-topic-package-material-shape-quality-check.md' -Pattern $patterns
git status --short
```

Expected:

- `Select-String` prints no matches because no placeholders remain
- `git status --short` shows only the new record as a staged candidate plus unrelated pre-existing untracked files

- [ ] **Step 5: Commit Task 5**

Stage only the observation record:

```powershell
git add -- docs/records/2026-05-08-topic-package-material-shape-quality-check.md
git status --short
git commit -m "记录TopicPackage材料塑形五轮观察"
```

Do not stage generated output directories or `storage/topic-candidate-library/`.

## Final Verification After Task 5

Run:

```powershell
npx vitest run --configLoader runner tests/backend/runtime/prompt-runtime.test.ts tests/backend/topic/topic-confirm-material-shape.test.ts tests/backend/api/topic-api-runtime.test.ts tests/backend/api/topic-api.test.ts tests/backend/script/script-runtime-generate.test.ts tests/harness/script-brief-shadow-stopped.test.ts
git status --short
```

Expected:

- Vitest exits 0
- only unrelated pre-existing untracked files remain
- no generated storage or harness output was committed

## Completion Criteria

The implementation is complete only when:

- Task 2 has a passing red/green trail for the ordered preview prompt contract.
- Task 2 commit exists with a Chinese commit message.
- Task 4 has a passing red/green trail for `topic-confirm` material shape.
- Task 4 commit exists with a Chinese commit message.
- Task 5 record exists and has no placeholders.
- Task 5 commit exists with a Chinese commit message.
- The final verification command exits 0.
- The final report states whether material shaping helped, did not help, or produced mixed evidence.
