# Must Cover Preview Contract Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the upstream `must_cover_preview` contract conflict, stop local fallback paths from modeling prose-like beats, and make preview/beat propagation observable in harness artifacts.

**Architecture:** Keep `TopicCandidateCard` and `TopicPackage` schemas unchanged. Make prompt wording, stub preview construction, runtime fallback construction, and diagnostics artifacts agree on one responsibility: `must_cover_preview` is an auditable narrative-node list, not script prose and not a semantic quality gate.

**Tech Stack:** TypeScript, Vitest, Prompt Registry markdown prompts, existing topic recommendation runtime, existing topic/script harness.

---

## Boundaries

Allowed changes:
- `prompts/topic/candidate-builder.prompt.md`
- `prompts/topic/candidate-builder-repair.prompt.md`
- `tests/backend/runtime/topic-prompt-contract.test.ts`
- `backend/src/modules/topic/topic-candidate.builder.ts`
- `tests/backend/topic/topic-candidate.builder.test.ts`
- `backend/src/runtime/orchestration/topic-recommendation-nodes.ts`
- `backend/src/runtime/orchestration/runtime-diagnostics.ts`
- `backend/src/modules/topic/topic-recommendation.service.ts`
- `tests/backend/topic/topic-runtime-recommendation.test.ts`
- `harness/scripts/runtime/topic-script-smoke.ts`
- `harness/scripts/runtime/topic-script-live-check.ts`
- `harness/scripts/runtime/topic-script-five-round-quality-check.ts`
- `tests/harness/topic-script-smoke.test.ts`
- `tests/harness/topic-script-live-check.test.ts`
- `tests/harness/topic-script-five-round-quality-check.test.ts`
- One record under `docs/records/`

Do not change:
- `TopicCandidateCard` schema
- `TopicPackage` schema
- script writer prompt
- script local validator semantics
- semantic reviewer behavior
- topic selector prompt selection criteria
- patch/regen main path
- UI, storyboard, asset, compose, downstream objects
- `.env.example`
- `storage/topic-candidate-library/`

Do not add:
- local keyword blacklists
- local string rules that decide whether a beat is good
- automatic semantic gates
- retry/patch/regen behavior

---

### Task 1: Remove Prompt Contract Conflict

**Files:**
- Modify: `tests/backend/runtime/topic-prompt-contract.test.ts`
- Modify: `prompts/topic/candidate-builder.prompt.md`
- Modify: `prompts/topic/candidate-builder-repair.prompt.md`

- [ ] **Step 1: Write the failing test**

In `tests/backend/runtime/topic-prompt-contract.test.ts`, replace the existing test named:

```ts
it("requires candidate-builder must_cover_preview to carry script-writable beats", () => {
```

with:

```ts
  it("requires candidate-builder must_cover_preview to carry auditable narrative nodes", () => {
    const prompt = createPromptRegistry().getPrompt("topic.candidate-builder");

    expect(prompt.metadata.language).toBe("zh-CN");
    expect(prompt.body).toContain(
      "`must_cover_preview` 必须给出 3 条可交给脚本审计的叙事节点",
    );
    expect(prompt.body).toContain("进入局面、关键动作、压力/代价");
    expect(prompt.body).toContain("不得把同一句角度摘要改写三遍");
    expect(prompt.body).not.toContain("可写入脚本的具体 beat");
  });
```

In the existing repair test named `requires builder-repair to fill missing must_cover_preview as beat nodes`, change the assertions to:

```ts
  it("requires builder-repair to fill missing must_cover_preview as auditable narrative nodes", () => {
    const prompt = createPromptRegistry().getPrompt("topic.candidate-builder-repair");

    expect(prompt.metadata.language).toBe("zh-CN");
    expect(prompt.body).toContain("如果补齐 `must_cover_preview`");
    expect(prompt.body).toContain("可交给脚本审计的叙事节点");
    expect(prompt.body).toContain("不是正文句");
    expect(prompt.body).toContain("不写解释性评价或完整总结句");
  });
```

- [ ] **Step 2: Run red**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/runtime/topic-prompt-contract.test.ts -t "auditable narrative nodes"
```

Expected: `FAIL`, because `topic.candidate-builder` still contains `可写入脚本的具体 beat`, and `topic.candidate-builder-repair` does not yet contain `可交给脚本审计的叙事节点`.

- [ ] **Step 3: Make the minimal prompt change**

In `prompts/topic/candidate-builder.prompt.md`, replace the current `must_cover_preview` contract bullet:

```md
- `must_cover_preview` 必须给出 3 条可写入脚本的具体 beat：进入局面、关键动作、压力/代价；不得把同一句角度摘要改写三遍
```

with:

```md
- `must_cover_preview` 必须给出 3 条可交给脚本审计的叙事节点：进入局面、关键动作、压力/代价；不得把同一句角度摘要改写三遍
```

In the JSON skeleton in the same prompt, replace:

```json
"进入局面的具体 beat"
"关键动作的具体 beat"
"压力或代价的具体 beat"
```

with:

```json
"进入局面的叙事节点"
"关键动作的叙事节点"
"压力或代价的叙事节点"
```

In `prompts/topic/candidate-builder-repair.prompt.md`, replace the current repair bullet:

```md
- 如果补齐 `must_cover_preview`，必须写成 3 条叙事节点，不是正文句；优先写成场景、动作或转折短语，不写解释性评价或完整总结句。
```

with:

```md
- 如果补齐 `must_cover_preview`，必须写成 3 条可交给脚本审计的叙事节点，不是正文句；优先写成场景、动作或转折短语，不写解释性评价或完整总结句。
```

- [ ] **Step 4: Run green**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/runtime/topic-prompt-contract.test.ts -t "auditable narrative nodes"
```

Expected: `PASS`.

- [ ] **Step 5: Run the full prompt contract file**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/runtime/topic-prompt-contract.test.ts
```

Expected: all tests in `topic-prompt-contract.test.ts` pass.

- [ ] **Step 6: Commit**

Stage only Task 1 files:

```powershell
git add tests/backend/runtime/topic-prompt-contract.test.ts prompts/topic/candidate-builder.prompt.md prompts/topic/candidate-builder-repair.prompt.md
git commit -m "消除必讲预览提示词冲突"
```

---

### Task 2: Fix Stub Builder Preview Shape

**Files:**
- Create: `tests/backend/topic/topic-candidate.builder.test.ts`
- Modify: `backend/src/modules/topic/topic-candidate.builder.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/backend/topic/topic-candidate.builder.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { buildTopicCandidates } from "../../../backend/src/modules/topic/topic-candidate.builder.js";

describe("topic candidate builder", () => {
  it("builds must_cover_preview from node-like seed material instead of summary prose", () => {
    const summary = "楚王在公开场合连续羞辱晏子，晏子必须当场顶回去。";
    const coreConflict = "楚王当众羞辱，晏子不能退。";
    const strongScene = "狗门羞辱与朝堂反击";

    const candidates = buildTopicCandidates({
      canonicalName: "晏子使楚",
      summary,
      coreConflict,
      strongScene,
      sourceHint: "《晏子春秋》",
      recentUsageHint: "测试样本",
      canonicalQuotes: [
        "使狗国者，从狗门入",
        "橘生淮南则为橘，生于淮北则为枳",
      ],
      tags: ["diplomacy", "court", "humiliation", "showdown"],
    });

    expect(candidates[0]?.must_cover_preview).toEqual([
      strongScene,
      "使狗国者，从狗门入",
      "橘生淮南则为橘，生于淮北则为枳",
    ]);
    expect(candidates[0]?.must_cover_preview).not.toEqual([
      summary,
      strongScene,
      coreConflict,
    ]);
  });
});
```

- [ ] **Step 2: Run red**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/topic/topic-candidate.builder.test.ts -t "node-like seed material"
```

Expected: `FAIL`, because `buildMustCoverPreview()` currently returns `[summary, strongScene, coreConflict]`.

- [ ] **Step 3: Implement minimal stub preview construction**

In `backend/src/modules/topic/topic-candidate.builder.ts`, add this helper above `buildMustCoverPreview()`:

```ts
function compactUnique(values: Array<string | undefined>): string[] {
  return Array.from(
    new Set(values.map((value) => value?.trim()).filter(Boolean) as string[]),
  );
}
```

Replace `buildMustCoverPreview()` with:

```ts
function buildMustCoverPreview(input: BuildTopicCandidatesInput): string[] {
  return compactUnique([
    input.strongScene,
    ...(input.canonicalQuotes ?? []),
    input.coreConflict,
  ]).slice(0, 3);
}
```

This is not a semantic cleaner. It only changes the local stub/fallback example shape so `summary` is no longer the first preview beat.

- [ ] **Step 4: Run green**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/topic/topic-candidate.builder.test.ts -t "node-like seed material"
```

Expected: `PASS`.

- [ ] **Step 5: Run nearby topic builder/runtime tests**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/topic/topic-candidate.builder.test.ts tests/backend/topic/topic-runtime-recommendation.test.ts --no-file-parallelism
```

Expected: both test files pass.

- [ ] **Step 6: Commit**

Stage only Task 2 files:

```powershell
git add tests/backend/topic/topic-candidate.builder.test.ts backend/src/modules/topic/topic-candidate.builder.ts
git commit -m "修正主题候选预览范式"
```

---

### Task 3: Fix Runtime Preview Fallback Order

**Files:**
- Modify: `tests/backend/topic/topic-runtime-recommendation.test.ts`
- Modify: `backend/src/runtime/orchestration/topic-recommendation-nodes.ts`

- [ ] **Step 1: Write the failing test**

In `tests/backend/topic/topic-runtime-recommendation.test.ts`, replace the existing test named:

```ts
it("fills empty must_cover_preview from existing seed material before exposing raw candidates", async () => {
```

with:

```ts
  it("fills empty must_cover_preview without prioritizing summary prose", async () => {
    const db = createDbClient();
    const { gateway } = createGatewayWithSelectorResponses([
      [
        {
          ...createRuntimeCandidate("event-a", "angle-a"),
          must_cover_preview: [],
        },
        createRuntimeCandidate("event-b", "angle-b"),
        createRuntimeCandidate("event-c", "angle-c"),
        createRuntimeCandidate("event-d", "angle-d"),
        createRuntimeCandidate("event-e", "angle-e"),
        createRuntimeCandidate("event-f", "angle-f"),
        createRuntimeCandidate("event-g", "angle-g"),
        createRuntimeCandidate("event-h", "angle-h"),
      ],
    ]);

    const result = await recommendTopicCandidatesWithTrace(
      db,
      {
        canonicalName: "seed-a",
        summary: "the seed starts with a public standoff",
        coreConflict: "the protagonist must answer pressure in front of everyone",
        strongScene: "the room goes silent after the public answer",
        sourceHint: "test",
        recentUsageHint: "empty preview from builder",
        canonicalQuotes: [
          "first quote anchor",
          "second quote anchor",
        ],
      },
      {
        llmGateway: gateway,
      },
    );

    expect(result.raw_candidates[0]?.must_cover_preview).toEqual([
      "the room goes silent after the public answer",
      "first quote anchor",
      "second quote anchor",
    ]);
    expect(result.raw_candidates[0]?.must_cover_preview).not.toContain(
      "the seed starts with a public standoff",
    );
  });
```

- [ ] **Step 2: Run red**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/topic/topic-runtime-recommendation.test.ts -t "without prioritizing summary prose" --no-file-parallelism
```

Expected: `FAIL`, because `completeMustCoverPreview()` currently uses `runtime.input.summary` before `strongScene`, quotes, or description.

- [ ] **Step 3: Implement minimal fallback ordering**

In `backend/src/runtime/orchestration/topic-recommendation-nodes.ts`, replace `completeMustCoverPreview()` with this implementation:

```ts
function completeMustCoverPreview(
  preview: string[],
  runtime: TopicRecommendationGraphRuntime,
  description: string,
): string[] {
  const normalizedPreview = uniqueStrings(preview);
  if (normalizedPreview.length >= 3) {
    return normalizedPreview;
  }

  return uniqueStrings([
    ...normalizedPreview,
    runtime.input.strongScene.trim(),
    ...(runtime.input.canonicalQuotes ?? []).map((quote) => quote.trim()),
    runtime.input.coreConflict.trim(),
    description.trim(),
  ].filter((item) => item.length > 0)).slice(0, 3);
}
```

Do not add string scoring, keyword filtering, or punctuation-based semantic cleanup.

- [ ] **Step 4: Run green**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/topic/topic-runtime-recommendation.test.ts -t "without prioritizing summary prose" --no-file-parallelism
```

Expected: `PASS`.

- [ ] **Step 5: Run nearby runtime tests**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/topic/topic-runtime-recommendation.test.ts --no-file-parallelism
```

Expected: all tests in `topic-runtime-recommendation.test.ts` pass.

- [ ] **Step 6: Commit**

Stage only Task 3 files:

```powershell
git add tests/backend/topic/topic-runtime-recommendation.test.ts backend/src/runtime/orchestration/topic-recommendation-nodes.ts
git commit -m "调整必讲预览兜底顺序"
```

---

### Task 4: Add Candidate Preview Trace Diagnostics

**Files:**
- Modify: `backend/src/runtime/orchestration/runtime-diagnostics.ts`
- Modify: `backend/src/modules/topic/topic-recommendation.service.ts`
- Modify: `tests/backend/topic/topic-runtime-recommendation.test.ts`

- [ ] **Step 1: Write the failing test**

Add this test near other diagnostics/selector tests in `tests/backend/topic/topic-runtime-recommendation.test.ts`:

```ts
  it("exposes candidate preview trace across raw selector pool and final choices", async () => {
    const db = createDbClient();
    const { gateway } = createGatewayWithSelectorResponses([
      [
        {
          ...createRuntimeCandidate("event-a", "angle-a"),
          must_cover_preview: ["a-entry", "a-action", "a-cost"],
        },
        {
          ...createRuntimeCandidate("event-b", "angle-b"),
          must_cover_preview: ["b-entry", "b-action", "b-cost"],
        },
        {
          ...createRuntimeCandidate("event-c", "angle-c"),
          must_cover_preview: ["c-entry", "c-action", "c-cost"],
        },
        createRuntimeCandidate("event-d", "angle-d"),
        createRuntimeCandidate("event-e", "angle-e"),
        createRuntimeCandidate("event-f", "angle-f"),
        createRuntimeCandidate("event-g", "angle-g"),
        createRuntimeCandidate("event-h", "angle-h"),
      ],
    ]);

    const result = await recommendTopicCandidatesWithTrace(
      db,
      {
        canonicalName: "seed-a",
        summary: "preview trace should show raw and selected preview material",
        coreConflict: "preview diagnostics must not become a selector gate",
        strongScene: "preview trace is written only for observation",
        sourceHint: "test",
        recentUsageHint: "preview trace",
      },
      {
        llmGateway: gateway,
      },
    );

    expect(result.diagnostics.candidate_preview_trace).toMatchObject({
      raw_candidates: [
        {
          candidate_id: "raw_candidate_1",
          title: "event-a",
          one_line_angle: "angle-a",
          must_cover_preview: ["a-entry", "a-action", "a-cost"],
        },
      ],
      selector_pool: [
        {
          candidate_id: "selector_candidate_1",
          title: "event-a",
          one_line_angle: "angle-a",
          must_cover_preview: ["a-entry", "a-action", "a-cost"],
        },
      ],
      final_candidates: [
        {
          candidate_id: "selector_candidate_1",
          title: "event-a",
          one_line_angle: "angle-a",
          must_cover_preview: ["a-entry", "a-action", "a-cost"],
        },
        {
          candidate_id: "selector_candidate_2",
          title: "event-b",
          one_line_angle: "angle-b",
          must_cover_preview: ["b-entry", "b-action", "b-cost"],
        },
        {
          candidate_id: "selector_candidate_3",
          title: "event-c",
          one_line_angle: "angle-c",
          must_cover_preview: ["c-entry", "c-action", "c-cost"],
        },
      ],
    });
  });
```

- [ ] **Step 2: Run red**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/topic/topic-runtime-recommendation.test.ts -t "candidate preview trace" --no-file-parallelism
```

Expected: `FAIL`, because `RuntimeDiagnosticsSummary` does not yet expose `candidate_preview_trace`.

- [ ] **Step 3: Extend diagnostics type**

In `backend/src/runtime/orchestration/runtime-diagnostics.ts`, replace the file content with:

```ts
export interface RuntimeDiagnosticCheck {
  code: string;
  level: "info" | "warning" | "error";
}

export interface CandidatePreviewTraceEntry {
  candidate_id: string;
  event_identity: string;
  title: string;
  one_line_angle: string;
  must_cover_preview: string[];
}

export interface CandidatePreviewTrace {
  raw_candidates: CandidatePreviewTraceEntry[];
  selector_pool: CandidatePreviewTraceEntry[];
  final_candidates: CandidatePreviewTraceEntry[];
}

export interface RuntimeDiagnosticsSummary {
  checks: RuntimeDiagnosticCheck[];
  candidate_preview_trace?: CandidatePreviewTrace;
}

export function createRuntimeDiagnosticsSummary(
  checks: RuntimeDiagnosticCheck[],
  details: Omit<RuntimeDiagnosticsSummary, "checks"> = {},
): RuntimeDiagnosticsSummary {
  return {
    checks,
    ...details,
  };
}
```

- [ ] **Step 4: Build preview trace in recommendation service**

In `backend/src/modules/topic/topic-recommendation.service.ts`, import `CandidatePreviewTrace`:

```ts
import type { CandidatePreviewTrace } from "../../runtime/orchestration/runtime-diagnostics.js";
```

Add this helper near the selector interfaces:

```ts
function toCandidatePreviewTraceEntry(input: {
  candidateId: string;
  candidate: RecommendationCandidate;
}) {
  return {
    candidate_id: input.candidateId,
    event_identity: input.candidate.event_identity,
    title: input.candidate.title,
    one_line_angle: input.candidate.one_line_angle,
    must_cover_preview: input.candidate.must_cover_preview,
  };
}

function buildCandidatePreviewTrace(input: {
  rawCandidates: RecommendationCandidate[];
  rankings: RankedRecommendationCandidate[];
  selectorPool: SelectorPoolCandidate[];
  finalRankings: RankedRecommendationCandidate[];
}): CandidatePreviewTrace {
  const rankingsById = new Map(
    input.rankings.map((entry) => [entry.candidateId, entry] as const),
  );

  return {
    raw_candidates: input.rawCandidates.map((candidate, index) =>
      toCandidatePreviewTraceEntry({
        candidateId: `raw_candidate_${index + 1}`,
        candidate,
      }),
    ),
    selector_pool: input.selectorPool
      .map((candidate) => rankingsById.get(candidate.candidate_id))
      .filter((entry): entry is RankedRecommendationCandidate => Boolean(entry))
      .map((entry) =>
        toCandidatePreviewTraceEntry({
          candidateId: entry.candidateId,
          candidate: entry.candidate,
        }),
      ),
    final_candidates: input.finalRankings.map((entry) =>
      toCandidatePreviewTraceEntry({
        candidateId: entry.candidateId,
        candidate: entry.candidate,
      }),
    ),
  };
}
```

After `selected` is available and before creating `finalDiagnostics`, build the preview trace:

```ts
  const candidatePreviewTrace = buildCandidatePreviewTrace({
    rawCandidates: result.candidates,
    rankings: selectorRankings,
    selectorPool,
    finalRankings: selected.rankings,
  });
  const finalDiagnostics = finalizeRecommendationDiagnostics({
    checks: result.diagnostics.checks,
    finalCandidateCount: selected.candidates.length,
    additionalChecks: [
      ...postProcessed.diagnostics,
      ...fallbackCandidates.diagnostics,
      ...selected.diagnostics,
    ],
    candidatePreviewTrace,
  });
```

Update `finalizeRecommendationDiagnostics()` signature and return value:

```ts
function finalizeRecommendationDiagnostics(input: {
  checks: RecommendationDiagnostic[];
  finalCandidateCount: number;
  additionalChecks: RecommendationDiagnostic[];
  candidatePreviewTrace?: CandidatePreviewTrace;
}) {
```

At the end of `finalizeRecommendationDiagnostics()`, return:

```ts
  return {
    checks,
    candidate_preview_trace: input.candidatePreviewTrace,
  };
```

Do not pass this trace into selector prompt input. It is observation only.

- [ ] **Step 5: Run green**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/topic/topic-runtime-recommendation.test.ts -t "candidate preview trace" --no-file-parallelism
```

Expected: `PASS`.

- [ ] **Step 6: Run topic runtime recommendation tests**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/topic/topic-runtime-recommendation.test.ts --no-file-parallelism
```

Expected: all tests in `topic-runtime-recommendation.test.ts` pass.

- [ ] **Step 7: Commit**

Stage only Task 4 files:

```powershell
git add backend/src/runtime/orchestration/runtime-diagnostics.ts backend/src/modules/topic/topic-recommendation.service.ts tests/backend/topic/topic-runtime-recommendation.test.ts
git commit -m "记录主题候选预览传播轨迹"
```

---

### Task 5: Write Preview Trace Harness Artifact

**Files:**
- Modify: `harness/scripts/runtime/topic-script-smoke.ts`
- Modify: `harness/scripts/runtime/topic-script-live-check.ts`
- Modify: `harness/scripts/runtime/topic-script-five-round-quality-check.ts`
- Modify: `tests/harness/topic-script-smoke.test.ts`
- Modify: `tests/harness/topic-script-live-check.test.ts`
- Modify: `tests/harness/topic-script-five-round-quality-check.test.ts`

- [ ] **Step 1: Write the failing smoke artifact test**

In `tests/harness/topic-script-smoke.test.ts`, after the existing semantic review assertions, add:

```ts
    const previewTrace = JSON.parse(
      readFileSync(join(outputDir, "topic-candidate-preview-trace.json"), "utf8"),
    ) as {
      raw_candidates: Array<{ must_cover_preview: string[] }>;
      selector_pool: Array<{ must_cover_preview: string[] }>;
      final_candidates: Array<{ must_cover_preview: string[] }>;
    };

    expect(previewTrace.final_candidates.length).toBeGreaterThan(0);
    expect(previewTrace.final_candidates[0]?.must_cover_preview.length).toBeGreaterThan(0);
    expect(Array.isArray(previewTrace.raw_candidates)).toBe(true);
    expect(Array.isArray(previewTrace.selector_pool)).toBe(true);
```

- [ ] **Step 2: Write the failing plan artifact tests**

In `tests/harness/topic-script-live-check.test.ts`, update the required artifact assertion to include:

```ts
        "topic-candidate-preview-trace.json",
```

In `tests/harness/topic-script-five-round-quality-check.test.ts`, add this assertion to the first plan test:

```ts
    expect(plan.required_artifacts).toContain("topic-candidate-preview-trace.json");
```

- [ ] **Step 3: Run red**

Run:

```powershell
npx vitest run --configLoader runner tests/harness/topic-script-smoke.test.ts tests/harness/topic-script-live-check.test.ts tests/harness/topic-script-five-round-quality-check.test.ts
```

Expected: `FAIL`, because `topic-candidate-preview-trace.json` is not written and not listed as a required artifact.

- [ ] **Step 4: Write the smoke artifact**

In `harness/scripts/runtime/topic-script-smoke.ts`, after writing `topic-candidates.json`, add:

```ts
  writeJson(
    finalOutputDir,
    "topic-candidate-preview-trace.json",
    recommendationBody.runtime_diagnostics?.candidate_preview_trace ?? {
      raw_candidates: [],
      selector_pool: [],
      final_candidates: candidates.map((candidate) => ({
        candidate_id: candidate.candidate_id,
        event_identity: candidate.event_identity,
        title: candidate.title,
        one_line_angle: candidate.one_line_angle,
        must_cover_preview: candidate.must_cover_preview,
      })),
    },
  );
```

Keep this as an artifact write only. Do not feed it into script generation.

- [ ] **Step 5: Add required artifact entries**

In both `harness/scripts/runtime/topic-script-live-check.ts` and `harness/scripts/runtime/topic-script-five-round-quality-check.ts`, add:

```ts
"topic-candidate-preview-trace.json",
```

to `required_artifacts`.

- [ ] **Step 6: Run green**

Run:

```powershell
npx vitest run --configLoader runner tests/harness/topic-script-smoke.test.ts tests/harness/topic-script-live-check.test.ts tests/harness/topic-script-five-round-quality-check.test.ts
```

Expected: all three test files pass.

- [ ] **Step 7: Commit**

Stage only Task 5 files:

```powershell
git add harness/scripts/runtime/topic-script-smoke.ts harness/scripts/runtime/topic-script-live-check.ts harness/scripts/runtime/topic-script-five-round-quality-check.ts tests/harness/topic-script-smoke.test.ts tests/harness/topic-script-live-check.test.ts tests/harness/topic-script-five-round-quality-check.test.ts
git commit -m "输出候选预览观测产物"
```

---

### Task 6: Run Structural Regression

**Files:**
- No source edits.

- [ ] **Step 1: Run focused regression set**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/runtime/topic-prompt-contract.test.ts tests/backend/topic/topic-candidate.builder.test.ts tests/backend/topic/topic-runtime-recommendation.test.ts tests/backend/topic/topic-confirm.service.test.ts tests/backend/script/script-runtime-generate.test.ts tests/harness/topic-script-smoke.test.ts tests/harness/topic-script-live-check.test.ts tests/harness/topic-script-five-round-quality-check.test.ts --no-file-parallelism
```

Expected: all listed test files pass.

- [ ] **Step 2: Confirm forbidden files are not staged**

Run:

```powershell
git status --short
```

Expected:
- `.env.example` may still appear as modified from earlier local work; do not stage it.
- `storage/topic-candidate-library/` may still appear untracked; do not stage it.
- No implementation files should remain unstaged after Task 1-5 commits.

---

### Task 7: Run Real Five-Round Observation and Record

**Files:**
- Create: `docs/records/2026-05-07-must-cover-preview-contract-observability-quality-check.md`

- [ ] **Step 1: Run the fixed five-round harness command**

Use a unique output directory:

```powershell
$env:LLM_TIMEOUT_MS='120000'; npm run harness:topic-script-five-round-quality-check -- --output-dir harness/scripts/runtime/output/2026-05-07-must-cover-preview-contract-observability-five-round
```

Expected:
- Command exits `0`.
- Summary reports `total_samples = 5`.
- `topic-candidate-preview-trace.json` exists in every sample output directory.
- Semantic reviewer remains shadow-only.

- [ ] **Step 2: Extract every round's preview trace, beats, and script text**

Run:

```powershell
node -e "const fs=require('fs'); const base='harness/scripts/runtime/output/2026-05-07-must-cover-preview-contract-observability-five-round'; for (const name of fs.readdirSync(base).sort()) { const p=base+'/'+name; if (!fs.statSync(p).isDirectory()) continue; const preview=JSON.parse(fs.readFileSync(p+'/topic-candidate-preview-trace.json','utf8')); const topic=JSON.parse(fs.readFileSync(p+'/topic-package.json','utf8')); const bundle=JSON.parse(fs.readFileSync(p+'/script-input-bundle.json','utf8')); const script=JSON.parse(fs.readFileSync(p+'/script-draft.json','utf8')); console.log('\\n## '+name); console.log('final candidate preview:'); for (const item of preview.final_candidates) console.log('- '+item.title+' :: '+JSON.stringify(item.must_cover_preview)); console.log('topic must_include_beats:'); for (const beat of topic.must_include_beats) console.log('- '+beat); console.log('script input hard_lane beats:'); for (const beat of bundle.hard_lane.must_include_beats) console.log('- '+beat); console.log('\\nscript_text:\\n'+script.script_text); }"
```

Expected:
- Output includes five sample sections.
- Each section includes final candidate preview, `TopicPackage.must_include_beats`, `ScriptInputBundle.hard_lane.must_include_beats`, and full `script_text`.

- [ ] **Step 3: Write the observation record**

Create `docs/records/2026-05-07-must-cover-preview-contract-observability-quality-check.md` from actual output. Include:

- Run config with `LLM_MODEL`, `LLM_STRUCTURED_MODEL`, `LLM_TIMEOUT_MS`, and command.
- Automatic summary counts.
- Per-round `final_candidates.must_cover_preview`.
- Per-round `TopicPackage.must_include_beats`.
- Per-round `ScriptInputBundle.hard_lane.must_include_beats`.
- Full `script_text` for every round.
- Manual conclusion answering:
  - whether builder/final candidate preview is less prose-like
  - whether confirm and script input are still only carrying upstream fields
  - whether 晏子使楚 still covers 狗门、`使狗国者，从狗门入`、`橘生淮南淮北`
  - whether field-shaped restatement in `script_text` decreased
  - whether any new template pollution or famous-scene omission appeared

Do not save blank counters, blank bullets, or empty code fences.

- [ ] **Step 4: Verify record has no empty placeholders**

Run:

```powershell
Select-String -Path docs/records/2026-05-07-must-cover-preview-contract-observability-quality-check.md -Pattern "total:$|passed:$|sample-ready:$|local validation:$|semantic reviewer shadow:$|^- $|```text\\s*```"
```

Expected: no matches.

- [ ] **Step 5: Commit the record**

Stage only the record:

```powershell
git add docs/records/2026-05-07-must-cover-preview-contract-observability-quality-check.md
git commit -m "记录必讲预览合同观察"
```

---

## Success Criteria

- Prompt no longer contains `可写入脚本的具体 beat`.
- Prompt still says `must_cover_preview` is a narrative node, not prose.
- Stub builder no longer prioritizes `summary` for `must_cover_preview`.
- Runtime fallback no longer prioritizes `summary` when filling empty preview.
- Diagnostics expose raw, selector pool, and final candidate preview traces.
- Harness writes `topic-candidate-preview-trace.json` per sample.
- No schema changes.
- No writer prompt changes.
- No local semantic judge.
- No reviewer gate.
- Real five-round record includes all scripts and preview trace evidence.
- `storage/topic-candidate-library/` is not staged or committed.

## Risk Controls

- If any implementation step requires local keyword filtering to pass, stop and redesign.
- If adding preview trace starts changing selector decisions, stop and remove the coupling.
- If harness artifact writing requires changing product schema, stop and discuss a narrower artifact source.
- If real five-round output loses famous scenes, record the failure instead of adding another shortening rule.
- If prompt text grows beyond the two planned bullets, stop and reduce wording.
