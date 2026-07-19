# Script Thin Regen Repair Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This project explicitly works on `dev` without a worktree for this session.

**Goal:** Add a low-coupling `thin_body_repair` object to script regen context so `script_body_too_thin` regen gets actionable structure without piling more writer prompt rules.

**Architecture:** Keep the existing `topic -> script -> local validation -> regen_once` flow. Extend only the regen context builder and runtime diagnostics; do not add a new stage, retry loop, reviewer gate, or Brief path. The local logic may only transform structural metrics and previous draft summary into repair context, never judge semantic quality.

**Tech Stack:** TypeScript, Vitest, existing backend script services, existing harness runtime.

---

## Guardrails

- Work directly in `history-video-forge` on `dev`; do not create a worktree.
- Do one Task at a time. Do not start the next Task until the current Task has green verification and a Chinese commit.
- Use TDD for every implementation Task: write failing test, run red, make minimal implementation, run green.
- Do not stage or commit `storage/topic-candidate-library/`.
- Do not modify topic, UI, downstream, storyboard, asset, compose.
- Do not modify `prompts/script/script-writer.prompt.md` in this plan.
- Do not introduce keyword rules, blacklists, semantic scoring, or local "viral" judgment.
- Keep reviewer shadow-only. Do not connect patch / lift to the main path.
- If real 5-round output becomes longer but more watery, record that as failure; do not add more prompt pressure.

## File Map

- Modify: `backend\src\modules\script\script-regenerate.service.ts`
  - Owns the `regenerationContext` object sent back into `generateScriptDraft`.
  - Add optional `thin_body_repair` only when `localValidation.errors` contains `script_body_too_thin`.
- Modify: `backend\src\runtime\orchestration\script-run-nodes.ts`
  - Owns runtime diagnostics after regen.
  - Add a diagnostic when thin regen still fails after changed output.
- Modify: `tests\backend\script\script-patch-regen.test.ts`
  - Add TDD coverage for thin repair context and non-thin protection.
- Modify: `tests\backend\script\script-graph-run.test.ts`
  - Add TDD coverage for the new runtime diagnostic.
- Create: `docs\records\2026-05-07-script-thin-regen-repair-context-observation.md`
  - Record real 5-round results and paste each generated script for user inspection.

---

### Task 1: Add Thin Repair Context For Thin Regen

**Files:**
- Modify: `tests\backend\script\script-patch-regen.test.ts`
- Modify: `backend\src\modules\script\script-regenerate.service.ts`

- [ ] **Step 1: Write the failing test**

Append this test inside the existing `describe("script patch / regenerate services", () => { ... })` block in `tests/backend/script/script-patch-regen.test.ts`:

```ts
  it("adds thin body repair context when local validation reports script_body_too_thin", async () => {
    const generateDraft = vi
      .fn<() => Promise<typeof regeneratedDraft>>()
      .mockResolvedValue(regeneratedDraft);

    await regenerateScriptDraft({
      bundle: scriptInputBundle,
      draft: weakDraft,
      regenerateUsed: false,
      localValidation: {
        decision: "regen_once",
        errors: ["script_body_too_thin"],
        metrics: {
          script_char_count: 205,
          script_sentence_count: 6,
          min_script_chars_for_band: 240,
          min_sentence_count_for_band: 7,
        },
      },
      generateDraft,
    });

    expect(generateDraft).toHaveBeenCalledWith({
      regenerationContext: expect.objectContaining({
        reason: "local_validation_regen_once",
        errors: ["script_body_too_thin"],
        thin_body_repair: {
          issue: "script_body_too_thin",
          previous_script_chars: 205,
          previous_sentence_count: 6,
          min_script_chars_for_band: 240,
          min_sentence_count_for_band: 7,
          target_script_chars: 280,
          target_sentence_count: 8,
          shortfall_chars: 35,
          shortfall_sentences: 1,
          repair_instruction:
            "正文仍是压缩摘要体。请只围绕既有 must_include_beats 扩写场面动作、对方反应和压力后果，明显越过结构下限；不得用解释、评价或口号凑字数，不得新增人物、事件、结局或改写因果。",
          beat_expansion_targets: weakDraft.beat_trace.map((trace) => ({
            beat: trace.beat,
            previous_excerpt: trace.excerpt,
            expand_with: ["action", "reaction", "consequence"],
          })),
        },
      }),
    });
  });
```

- [ ] **Step 2: Run red**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/script/script-patch-regen.test.ts -t "adds thin body repair context"
```

Expected: FAIL because `thin_body_repair` is not present.

- [ ] **Step 3: Implement the minimal type and builder**

In `backend/src/modules/script/script-regenerate.service.ts`, extend `ScriptInputBundleInput`:

```ts
interface ScriptInputBundleInput {
  hard_lane: {
    event_identity: string;
    must_include_beats?: unknown;
  };
}
```

Add these interfaces near `ScriptDraftInput`:

```ts
interface ThinBodyRepairContext {
  issue: "script_body_too_thin";
  previous_script_chars: number;
  previous_sentence_count: number;
  min_script_chars_for_band: number;
  min_sentence_count_for_band: number;
  target_script_chars: number;
  target_sentence_count: number;
  shortfall_chars: number;
  shortfall_sentences: number;
  repair_instruction: string;
  beat_expansion_targets: Array<{
    beat: string;
    previous_excerpt: string;
    expand_with: ["action", "reaction", "consequence"];
  }>;
}

interface RegenerationContext {
  reason: "local_validation_regen_once";
  errors: string[];
  metrics: Record<string, unknown>;
  previous_draft?: {
    script_text_excerpt: string;
    opening_span: string;
    ending_span: string;
    beat_trace_summary: Array<{
      beat: string;
      excerpt: string;
    }>;
  };
  thin_body_repair?: ThinBodyRepairContext;
}
```

Change the `generateDraft` input type to:

```ts
  generateDraft: (input?: {
    regenerationContext?: RegenerationContext;
  }) => Promise<unknown>;
```

Inside `regenerateScriptDraft`, build context before calling `generateDraft`:

```ts
  const errors = (input.localValidation?.errors ?? []).filter(
    (error): error is string => typeof error === "string",
  );
  const metrics = input.localValidation?.metrics ?? {};
  const previousDraft = buildPreviousDraftSummary(input.draft);

  const regenerationContext: RegenerationContext = {
    reason: "local_validation_regen_once",
    errors,
    metrics,
  };
  if (previousDraft) {
    regenerationContext.previous_draft = previousDraft;
  }
  const thinBodyRepair = buildThinBodyRepairContext({
    errors,
    metrics,
    previousDraft,
  });
  if (thinBodyRepair) {
    regenerationContext.thin_body_repair = thinBodyRepair;
  }

  const regenerated = await input.generateDraft({
    regenerationContext,
  });
```

Add this helper below `buildPreviousDraftSummary`:

```ts
function buildThinBodyRepairContext(input: {
  errors: string[];
  metrics: Record<string, unknown>;
  previousDraft: ReturnType<typeof buildPreviousDraftSummary>;
}): ThinBodyRepairContext | undefined {
  if (!input.errors.includes("script_body_too_thin")) {
    return undefined;
  }

  const previousScriptChars = readMetricNumber(
    input.metrics.script_char_count,
  );
  const previousSentenceCount = readMetricNumber(
    input.metrics.script_sentence_count,
  );
  const minScriptChars = readMetricNumber(
    input.metrics.min_script_chars_for_band,
  );
  const minSentenceCount = readMetricNumber(
    input.metrics.min_sentence_count_for_band,
  );

  if (
    previousScriptChars === null ||
    previousSentenceCount === null ||
    minScriptChars === null ||
    minSentenceCount === null
  ) {
    return undefined;
  }

  return {
    issue: "script_body_too_thin",
    previous_script_chars: previousScriptChars,
    previous_sentence_count: previousSentenceCount,
    min_script_chars_for_band: minScriptChars,
    min_sentence_count_for_band: minSentenceCount,
    target_script_chars: minScriptChars + 40,
    target_sentence_count: minSentenceCount + 1,
    shortfall_chars: Math.max(0, minScriptChars - previousScriptChars),
    shortfall_sentences: Math.max(0, minSentenceCount - previousSentenceCount),
    repair_instruction:
      "正文仍是压缩摘要体。请只围绕既有 must_include_beats 扩写场面动作、对方反应和压力后果，明显越过结构下限；不得用解释、评价或口号凑字数，不得新增人物、事件、结局或改写因果。",
    beat_expansion_targets:
      input.previousDraft?.beat_trace_summary.map((trace) => ({
        beat: trace.beat,
        previous_excerpt: trace.excerpt,
        expand_with: ["action", "reaction", "consequence"],
      })) ?? [],
  };
}

function readMetricNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
```

- [ ] **Step 4: Run green**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/script/script-patch-regen.test.ts -t "adds thin body repair context"
```

Expected: PASS.

- [ ] **Step 5: Update existing exact regen-context assertions if needed**

If the existing test `allows regen_once only once and reuses the formal generator callback` fails because it expects the exact old context shape, change only that assertion to keep its original intent while allowing thin repair fields on thin errors:

```ts
    expect(generateDraft).toHaveBeenCalledWith({
      regenerationContext: expect.objectContaining({
        reason: "local_validation_regen_once",
        errors: ["script_body_too_thin"],
        metrics: {
          script_char_count: 67,
          script_sentence_count: 3,
          min_script_chars_for_band: 240,
          min_sentence_count_for_band: 7,
        },
      }),
    });
```

Do not loosen assertions in the new thin repair test.

- [ ] **Step 6: Run Task 1 minimum suite**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/script/script-patch-regen.test.ts tests/backend/script/script-runtime-generate.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```powershell
git add -- backend/src/modules/script/script-regenerate.service.ts tests/backend/script/script-patch-regen.test.ts
git commit -m "增加薄稿再生成修复上下文"
```

Before committing, confirm `git status --short` does not show `storage/topic-candidate-library/` staged.

---

### Task 2: Protect Non-Thin Regen From Thin Context Pollution

**Files:**
- Modify: `tests\backend\script\script-patch-regen.test.ts`
- Modify: `backend\src\modules\script\script-regenerate.service.ts` only if Task 1 implementation needs adjustment

- [ ] **Step 1: Write the failing/protection test**

Append this test inside the same `describe` block:

```ts
  it("does not add thin body repair context for non-thin local validation errors", async () => {
    const generateDraft = vi
      .fn<() => Promise<typeof regeneratedDraft>>()
      .mockResolvedValue(regeneratedDraft);

    await regenerateScriptDraft({
      bundle: scriptInputBundle,
      draft: weakDraft,
      regenerateUsed: false,
      localValidation: {
        decision: "regen_once",
        errors: ["opening_missing"],
        metrics: {
          script_char_count: 260,
          script_sentence_count: 8,
          min_script_chars_for_band: 240,
          min_sentence_count_for_band: 7,
        },
      },
      generateDraft,
    });

    expect(generateDraft).toHaveBeenCalledWith({
      regenerationContext: expect.not.objectContaining({
        thin_body_repair: expect.anything(),
      }),
    });
  });
```

- [ ] **Step 2: Run red/protection**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/script/script-patch-regen.test.ts -t "does not add thin body repair context"
```

Expected: PASS if Task 1 already gates correctly. If it fails, the failure should show `thin_body_repair` leaking into non-thin regen.

- [ ] **Step 3: Minimal implementation if needed**

If Step 2 fails, adjust `buildThinBodyRepairContext` so the first guard remains:

```ts
  if (!input.errors.includes("script_body_too_thin")) {
    return undefined;
  }
```

- [ ] **Step 4: Run green**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/script/script-patch-regen.test.ts -t "does not add thin body repair context"
```

Expected: PASS.

- [ ] **Step 5: Run Task 2 minimum suite**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/script/script-patch-regen.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```powershell
git add -- backend/src/modules/script/script-regenerate.service.ts tests/backend/script/script-patch-regen.test.ts
git commit -m "保护非薄稿再生成上下文"
```

If only the test file changed, stage only the test file.

---

### Task 3: Record Diagnostic When Thin Regen Still Fails After Changed Output

**Files:**
- Modify: `tests\backend\script\script-graph-run.test.ts`
- Modify: `backend\src\runtime\orchestration\script-run-nodes.ts`

- [ ] **Step 1: Write the failing test**

Append this test inside `describe("script run graph", () => { ... })` after the existing unchanged-output diagnostic test:

```ts
  it("records a diagnostic when thin regen changes output but remains too thin", async () => {
    const calls: string[] = [];
    const initialThinDraft = {
      ...passDraft,
      script_text: "initial thin script text",
      opening_span: "initial thin opening",
    };
    const changedStillThinDraft = {
      ...passDraft,
      script_text: "changed but still thin script text",
      opening_span: "changed thin opening",
    };
    const generateDraft = vi
      .fn()
      .mockImplementationOnce(async () => {
        calls.push("script-generate");
        return initialThinDraft;
      })
      .mockImplementationOnce(async () => {
        calls.push("script-generate");
        return changedStillThinDraft;
      });
    const validateDraft = vi.fn(() => {
      calls.push("local-validate");
      return createRegenLocalValidation();
    });

    const result = await runScriptRunGraph(
      {
        bundle: inputBundle,
        allowPatch: true,
        allowRegen: true,
      },
      {
        generateDraft,
        validateDraft,
        reviewSemantics: vi.fn(() => {
          calls.push("semantic-review");
          return createPassSemanticReview();
        }),
        patchDraft: vi.fn(async () => {
          calls.push("patch-once");
          return patchedDraft;
        }),
        regenerateDraft: vi.fn(async ({ generateDraft: rerunGenerateDraft }) => {
          calls.push("regen-once");
          return rerunGenerateDraft();
        }),
      },
    );

    expect(calls).toEqual([
      "script-generate",
      "local-validate",
      "regen-once",
      "script-generate",
      "local-validate",
    ]);
    expect(result.draft).toEqual(changedStillThinDraft);
    expect(result.localValidation.decision).toBe("regen_once");
    expect(result.runtimeDiagnostics.checks).toContainEqual(
      expect.objectContaining({
        code: "regen_output_still_too_thin_after_repair_context",
        level: "warning",
      }),
    );
    expect(result.runtimeDiagnostics.checks).not.toContainEqual(
      expect.objectContaining({
        code: "regen_output_unchanged_after_thin_context",
      }),
    );
  });
```

- [ ] **Step 2: Run red**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/script/script-graph-run.test.ts -t "changes output but remains too thin"
```

Expected: FAIL because the new diagnostic is not recorded.

- [ ] **Step 3: Implement minimal diagnostic**

In `backend/src/runtime/orchestration/script-run-nodes.ts`, replace the current thin check inside `localValidate()` with:

```ts
      if (
        runtime.pendingThinRegenCheck &&
        runtime.localValidation.errors.includes("script_body_too_thin")
      ) {
        const outputUnchanged =
          draft.script_text.trim() ===
          runtime.pendingThinRegenCheck.previousScriptText;
        runtime.runtimeDiagnostics.push({
          code: outputUnchanged
            ? "regen_output_unchanged_after_thin_context"
            : "regen_output_still_too_thin_after_repair_context",
          level: "warning",
        });
      }
```

Keep `runtime.pendingThinRegenCheck = null;` immediately after the block.

- [ ] **Step 4: Run green**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/script/script-graph-run.test.ts -t "changes output but remains too thin"
```

Expected: PASS.

- [ ] **Step 5: Run Task 3 minimum suite**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/script/script-graph-run.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```powershell
git add -- backend/src/runtime/orchestration/script-run-nodes.ts tests/backend/script/script-graph-run.test.ts
git commit -m "记录薄稿再生成仍薄诊断"
```

---

### Task 4: Run Integrated Unit Verification

**Files:**
- No planned source edits.

- [ ] **Step 1: Run integrated backend/harness script tests**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/script/script-patch-regen.test.ts tests/backend/script/script-graph-run.test.ts tests/backend/script/script-runtime-generate.test.ts tests/backend/script/script-local-validator.test.ts tests/shared/schema-contracts.test.ts
```

Expected: PASS.

- [ ] **Step 2: Inspect git status**

Run:

```powershell
git status --short --branch
```

Expected: only intended tracked changes from previous Tasks are already committed; `storage/topic-candidate-library/` may remain untracked and must not be staged.

- [ ] **Step 3: No commit unless files changed**

If this Task changes no files, do not create an empty commit. If verification requires a small documentation note, stage only that note and commit:

```powershell
git add -- docs/records/<exact-file>
git commit -m "记录薄稿再生成单元验证"
```

---

### Task 5: Real 5-Round Quality Check And Observation Record

**Files:**
- Create: `docs\records\2026-05-07-script-thin-regen-repair-context-observation.md`
- Runtime output only: `harness\scripts\runtime\output\2026-05-07-thin-regen-repair-context-five-round\...`

- [ ] **Step 1: Run the fixed real 5-round command**

Run:

```powershell
npm run harness:topic-script-five-round-quality-check -- --output-dir harness/scripts/runtime/output/2026-05-07-thin-regen-repair-context-five-round
```

Expected: command completes and writes output under `harness/scripts/runtime/output/2026-05-07-thin-regen-repair-context-five-round`.

- [ ] **Step 2: Extract per-round validation and scripts**

For each sample directory in the output, read:

```text
status.json
validation-result.json
runtime-diagnostics.json
script-draft.json
semantic-review-result.json
```

Record these fields:

- sample id
- local validation decision
- `script_body_too_thin` present or absent
- `script_char_count`
- `script_sentence_count`
- runtime diagnostics
- full `script_text`

- [ ] **Step 3: Write observation record**

Create `docs/records/2026-05-07-script-thin-regen-repair-context-observation.md` with this structure:

```md
# Script Thin Regen Repair Context Observation

## Run

- command: `npm run harness:topic-script-five-round-quality-check -- --output-dir harness/scripts/runtime/output/2026-05-07-thin-regen-repair-context-five-round`
- output_dir: `harness/scripts/runtime/output/2026-05-07-thin-regen-repair-context-five-round`
- purpose: observe whether `thin_body_repair` improves `script_body_too_thin` regen without making scripts watery

## Summary

- total_samples:
- local_pass:
- final_regen_once:
- script_body_too_thin_count:
- still_thin_after_repair_context_count:
- unchanged_after_thin_context_count:

## Per-Sample Scripts

### sample id copied from the output directory name

- decision: actual local validation decision
- errors: actual errors array
- chars: actual `script_char_count`
- sentences: actual `script_sentence_count`
- diagnostics: actual runtime diagnostics

```text
<full script_text>
```

## Human Quality Notes

- Does the draft feel like oral historical storytelling rather than structural summary?
- Are beats expanded with action, reaction, and consequence?
- Is there any padding, empty evaluation, or slogan-like ending?
- Are key famous moments and canonical quotes preserved?

## Conclusion

- outcome: continue | stop | revert
- reason:
```

Fill every field with actual values. Do not leave placeholders.

- [ ] **Step 4: Present every generated script to the user**

In the Task completion report, paste or summarize every full script from the observation record so the user can judge personally. If any script is too long for one message, split cleanly by sample id.

- [ ] **Step 5: Commit observation record**

Run:

```powershell
git add -- docs/records/2026-05-07-script-thin-regen-repair-context-observation.md
git commit -m "记录薄稿再生成修复观察"
```

Do not stage runtime output directories unless the project explicitly requires it in a later instruction.

---

## Final Verification Before Reporting

After Task 5, run:

```powershell
git status --short --branch
```

Expected:

- branch is `dev`
- commits are ahead of origin
- `storage/topic-candidate-library/` may remain untracked
- no unintended staged files

Then report:

- actual changed files
- all verification commands and pass/fail results
- 5-round script quality summary
- every generated script for user review
- whether the result supports continue, stop, or revert
