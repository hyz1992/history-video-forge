# Script Prompt Debt Audit and Brief Shadow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Use `superpowers:test-driven-development` for every code or prompt contract task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Stop Status

ScriptWritingBrief path stopped.

Reason: Task 8 observation recorded `continue_to_ab_design: no`; real shadow output failed the strict schema and included forbidden script/downstream fields. This implementation plan is retained as historical evidence only. Do not resume remaining Brief implementation, do not create A/B design, and do not connect Brief to writer.

**Goal:** Build a cautious, shadow-only workflow for auditing `script.writer` prompt debt and observing whether `ScriptWritingBrief` has real incremental value before any main-chain integration is considered.

**Architecture:** The first two tasks create document-only audit scaffolding and a current prompt debt record. Later tasks add a schema, prompt contract, and harness-only shadow generator that writes observation artifacts without feeding writer, validator, reviewer, patch, regen, API, or downstream stages. The plan stops before any A/B main-chain integration.

**Tech Stack:** TypeScript, Vitest, Zod, Node filesystem utilities, existing prompt registry, existing harness runtime conventions.

---

## Global Execution Rules

- Work directly on `dev`; do not create a worktree.
- Do not stage or commit `storage/topic-candidate-library/`.
- Do not modify `prompts/script/script-writer.prompt.md` in this plan.
- Do not change `TopicPackage`, `ScriptInputBundle`, script writer runtime input, reviewer behavior, validator behavior, topic selection, UI, storyboard, asset, or compose.
- Do not add local semantic scoring rules for "viral", "scene quality", "story completeness", or "brief usefulness".
- Every code or prompt contract task must follow TDD: write failing test, run red, implement minimally, run green.
- Each task must be committed separately with a Chinese commit message.
- Stop immediately if a task requires feeding Brief into writer, changing main runtime decisions, or making Brief a gate.

## Files And Responsibilities

- `docs/records/templates/script-prompt-debt-audit-template.md`
  - Markdown template for manual prompt debt audits.
  - Does not modify any prompt.

- `tests/harness/script-prompt-debt-audit-template.test.ts`
  - Guard test for the audit template sections and risk controls.

- `docs/records/2026-05-07-script-writer-prompt-debt-audit.md`
  - Snapshot audit of the current `script.writer` prompt.
  - Captures metrics, categories, suspected debt, and stop recommendations.

- `tests/harness/script-prompt-debt-audit-record.test.ts`
  - Guard test that the audit record contains required metrics, categories, and non-implementation conclusions.

- `shared/src/script/script-writing-brief-shadow.schema.ts`
  - Zod schema for `ScriptWritingBriefShadow`.
  - Pure data contract; no runtime integration.

- `shared/src/index.ts`
  - Exports the shadow schema only if the shared package pattern requires it.

- `tests/shared/script-writing-brief-shadow-schema.test.ts`
  - Schema tests for valid fixture parsing and rejection of downstream/fact-risk fields.

- `harness/samples/script-writing-brief-shadow/yanzi-shichu.fixture.json`
  - A concrete shadow fixture for schema and harness tests.

- `prompts/script/script-writing-brief-shadow.prompt.md`
  - Formal Chinese prompt contract for producing `ScriptWritingBriefShadow`.
  - It must explicitly forbid generating `script_text`, storyboard, new beats, or new facts.

- `tests/backend/runtime/prompt-runtime.test.ts`
  - Adds prompt registry guard tests for the new shadow prompt.

- `harness/scripts/runtime/script-writing-brief-shadow.ts`
  - Harness-only helper that reads a topic package, invokes the shadow prompt, validates output, and writes `script-writing-brief-shadow.json`.
  - It does not modify writer input or script generation output.

- `tests/harness/script-writing-brief-shadow.test.ts`
  - Tests the harness helper with a fake provider/gateway and temporary output directory.

- `harness/scripts/runtime/script-brief-shadow-five-round-check.ts`
  - Post-processes an existing five-round output directory and writes shadow briefs beside each `topic-package.json`.
  - It does not run script generation and does not alter existing artifacts.

- `package.json`
  - Adds a harness script for the post-process shadow run.

- `tests/harness/script-brief-shadow-five-round-check.test.ts`
  - Tests the post-process runner on temporary sample directories.

- `docs/records/templates/script-writing-brief-shadow-observation-template.md`
  - Template for human review of shadow brief usefulness and risk.

- `tests/harness/script-writing-brief-shadow-observation-template.test.ts`
  - Guard test for required observation fields and stopping criteria.

- `docs/records/2026-05-07-script-writing-brief-shadow-observation.md`
  - First real observation record after running the shadow helper on a fixed five-round output.

---

## Task 1: Add Prompt Debt Audit Template

**Purpose:** Create a stable audit record format before touching prompt or Brief design artifacts.

**Files:**
- Create: `docs/records/templates/script-prompt-debt-audit-template.md`
- Create: `tests/harness/script-prompt-debt-audit-template.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/harness/script-prompt-debt-audit-template.test.ts`:

```ts
import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const templatePath =
  "docs/records/templates/script-prompt-debt-audit-template.md";

describe("script prompt debt audit template", () => {
  it("contains the required audit sections and safety guards", () => {
    expect(existsSync(templatePath)).toBe(true);

    const template = readFileSync(templatePath, "utf8");
    const requiredSections = [
      "# Script Prompt Debt Audit Record",
      "## Prompt Metrics",
      "## Constraint Categories",
      "## Duplicate Or Competing Constraints",
      "## Keep In Writer Prompt",
      "## Move Out Candidates",
      "## Stop Conditions",
      "## Non-Changes",
      "## Conclusion",
    ];

    for (const section of requiredSections) {
      expect(template).toContain(section);
    }

    expect(template).toContain("Do not modify script.writer prompt in this audit");
    expect(template).toContain("Do not introduce ScriptWritingBrief into runtime");
    expect(template).toContain("Do not use local semantic quality scoring");
  });
});
```

- [ ] **Step 2: Run red**

Run:

```powershell
npx vitest run --configLoader runner tests/harness/script-prompt-debt-audit-template.test.ts
```

Expected: FAIL because `docs/records/templates/script-prompt-debt-audit-template.md` does not exist.

- [ ] **Step 3: Add the minimal template**

Create `docs/records/templates/script-prompt-debt-audit-template.md`:

```markdown
# Script Prompt Debt Audit Record

Date:
Prompt:
Audit Scope:

## Prompt Metrics

- prompt_chars:
- prompt_lines:
- bullet_count:
- hard_contract_count:
- quality_goal_count:
- regen_only_count:

## Constraint Categories

| Category | Count | Notes |
| --- | ---: | --- |
| schema_contract | 0 | |
| topic_boundary | 0 | |
| quality_goal | 0 | |
| opening_strategy | 0 | |
| body_density | 0 | |
| regen_only | 0 | |
| quote_usage | 0 | |
| duplicate_or_competing | 0 | |

## Duplicate Or Competing Constraints

- Record only concrete overlaps or competing instructions.
- Do not infer semantic quality from local keyword rules.

## Keep In Writer Prompt

- List only constraints that must remain in writer prompt.

## Move Out Candidates

- List constraints that may belong in regen-only context, shadow brief observation, or documentation.

## Stop Conditions

- Stop if the audit cannot classify most prompt constraints.
- Stop if the audit recommends adding more always-on writer prompt rules.
- Stop if the audit requires changing TopicPackage, reviewer, validator, or runtime decisions.

## Non-Changes

- Do not modify script.writer prompt in this audit.
- Do not introduce ScriptWritingBrief into runtime.
- Do not use local semantic quality scoring.
- Do not change TopicPackage.
- Do not change ScriptInputBundle.

## Conclusion

- Audit conclusion:
- Recommended next step:
```

- [ ] **Step 4: Run green**

Run:

```powershell
npx vitest run --configLoader runner tests/harness/script-prompt-debt-audit-template.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```powershell
git add docs/records/templates/script-prompt-debt-audit-template.md tests/harness/script-prompt-debt-audit-template.test.ts
git commit -m "新增脚本提示债务审计模板"
```

Do not stage `storage/topic-candidate-library/`.

---

## Task 2: Write Current Script Writer Prompt Debt Audit Record

**Purpose:** Produce a factual audit snapshot before adding any Brief artifacts.

**Files:**
- Create: `docs/records/2026-05-07-script-writer-prompt-debt-audit.md`
- Create: `tests/harness/script-prompt-debt-audit-record.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/harness/script-prompt-debt-audit-record.test.ts`:

```ts
import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const recordPath =
  "docs/records/2026-05-07-script-writer-prompt-debt-audit.md";

describe("script writer prompt debt audit record", () => {
  it("records current prompt metrics and explicit non-change conclusions", () => {
    expect(existsSync(recordPath)).toBe(true);

    const record = readFileSync(recordPath, "utf8");
    const required = [
      "# Script Writer Prompt Debt Audit Record",
      "prompt_chars:",
      "prompt_lines:",
      "bullet_count:",
      "schema_contract",
      "topic_boundary",
      "quality_goal",
      "opening_strategy",
      "body_density",
      "regen_only",
      "quote_usage",
      "duplicate_or_competing",
      "Current conclusion",
      "Do not modify script.writer prompt in this task",
      "Do not introduce ScriptWritingBrief into runtime",
    ];

    for (const item of required) {
      expect(record).toContain(item);
    }

    expect(record).toMatch(/prompt_chars:\s*\d+/);
    expect(record).toMatch(/prompt_lines:\s*\d+/);
    expect(record).toMatch(/bullet_count:\s*\d+/);
    for (const forbidden of ["TB" + "D", "TO" + "DO"]) {
      expect(record).not.toContain(forbidden);
    }
  });
});
```

- [ ] **Step 2: Run red**

Run:

```powershell
npx vitest run --configLoader runner tests/harness/script-prompt-debt-audit-record.test.ts
```

Expected: FAIL because the audit record does not exist.

- [ ] **Step 3: Gather prompt metrics without editing prompt**

Run:

```powershell
@'
const fs = require("fs");
const promptPath = "prompts/script/script-writer.prompt.md";
const text = fs.readFileSync(promptPath, "utf8");
const bullets = text.split(/\r?\n/).filter((line) => /^\s*-\s+/.test(line));
console.log(JSON.stringify({
  prompt_chars: text.length,
  prompt_lines: text.split(/\r?\n/).length,
  bullet_count: bullets.length
}, null, 2));
'@ | node -
```

Expected: prints numeric metrics for the current prompt.

- [ ] **Step 4: Create the audit record**

Create `docs/records/2026-05-07-script-writer-prompt-debt-audit.md` using the template from Task 1. Include:

```markdown
# Script Writer Prompt Debt Audit Record

Date: 2026-05-07
Prompt: prompts/script/script-writer.prompt.md
Audit Scope: Current script.writer prompt after quote intent hard anchor work.

## Prompt Metrics

- prompt_chars: <number from Step 3>
- prompt_lines: <number from Step 3>
- bullet_count: <number from Step 3>
- schema_contract: output object, required sidecars, language contract
- topic_boundary: Hard Lane, TopicPackage, forbidden expansion, packaging weak reference
- quality_goal: oral story draft, scene/action/reaction, ending residue
- opening_strategy: break-wall opening and concrete pressure opening
- body_density: medium body floor, beat expansion, non-padding rule
- regen_only: regeneration_context and script_body_too_thin rules
- quote_usage: canonical_quote_intents usage rule
- duplicate_or_competing: body density + regen expansion + beat expansion overlap

## Constraint Categories

| Category | Count | Notes |
| --- | ---: | --- |
| schema_contract | 1 | Keep in writer prompt. |
| topic_boundary | 1 | Keep in writer prompt. |
| quality_goal | 2 | Candidate for simplification after shadow evidence. |
| opening_strategy | 1 | Already heavy; do not extend. |
| body_density | 3 | Overlaps with local structural floors. |
| regen_only | 1 | Candidate to move to regen-only context. |
| quote_usage | 1 | Keep because it binds explicit upstream quote intents. |
| duplicate_or_competing | 2 | Beat expansion and body density repeat similar pressure. |

## Duplicate Or Competing Constraints

- Beat expansion, body density, and thin-regeneration rules all ask for action/reaction/consequence.
- Opening rules already include several subrules; do not add new opening slogans.
- Regen-only details are present in always-on writer prompt and may distract first drafts.

## Keep In Writer Prompt

- Output schema and language requirements.
- Hard Lane and TopicPackage boundary requirements.
- Canonical quote intent requirement.
- A short statement that the output is an oral historical story draft, not a summary.

## Move Out Candidates

- Regen-only thin-draft expansion rules.
- Detailed beat action/reaction/consequence checklist.
- Detailed body density language that duplicates local structural floors.

## Stop Conditions

- Stop if any next task proposes editing script.writer prompt before shadow evidence.
- Stop if any next task feeds Brief into writer.
- Stop if any next task uses local semantic quality scoring.

## Non-Changes

- Do not modify script.writer prompt in this task.
- Do not introduce ScriptWritingBrief into runtime.
- Do not use local semantic quality scoring.
- Do not change TopicPackage.
- Do not change ScriptInputBundle.

## Current conclusion

The prompt is carrying schema, boundary, writing quality, opening strategy, body density, quote usage, and regen-only concerns in one place. The next safe step is not another prompt edit. The next safe step is a shadow-only Brief contract and fixture that can test whether upstream story material can be made more executable without changing the main chain.
```

Replace the three metric placeholders with real numbers from Step 3. Do not leave angle-bracket placeholders.

- [ ] **Step 5: Run green**

Run:

```powershell
npx vitest run --configLoader runner tests/harness/script-prompt-debt-audit-record.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```powershell
git add docs/records/2026-05-07-script-writer-prompt-debt-audit.md tests/harness/script-prompt-debt-audit-record.test.ts
git commit -m "记录脚本提示债务审计"
```

Do not stage `storage/topic-candidate-library/`.

---

## Task 3: Add Shadow Brief Schema And Fixture

**Purpose:** Define the shadow data contract without adding runtime behavior.

**Files:**
- Create: `shared/src/script/script-writing-brief-shadow.schema.ts`
- Modify: `shared/src/index.ts`
- Create: `tests/shared/script-writing-brief-shadow-schema.test.ts`
- Create: `harness/samples/script-writing-brief-shadow/yanzi-shichu.fixture.json`

- [ ] **Step 1: Write the failing schema test**

Create `tests/shared/script-writing-brief-shadow-schema.test.ts`:

```ts
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { ScriptWritingBriefShadow } from "../../shared/src/index.js";

const fixture = JSON.parse(
  readFileSync(
    "harness/samples/script-writing-brief-shadow/yanzi-shichu.fixture.json",
    "utf8",
  ),
);

describe("ScriptWritingBriefShadow schema", () => {
  it("accepts the minimal shadow brief fixture", () => {
    const parsed = ScriptWritingBriefShadow.parse(fixture);

    expect(parsed.stage).toBe("script_writing_brief_shadow");
    expect(parsed.topic_id).toBe("topic_yanzi_shichu");
    expect(parsed.beat_units.map((unit) => unit.beat)).toEqual([
      "入楚受辱",
      "橘枳之喻",
    ]);
    expect(parsed.material_gaps).toEqual([]);
  });

  it("rejects downstream or invented fact fields", () => {
    expect(() =>
      ScriptWritingBriefShadow.parse({
        ...fixture,
        storyboard_shots: [],
      }),
    ).toThrow();

    expect(() =>
      ScriptWritingBriefShadow.parse({
        ...fixture,
        beat_units: [
          {
            ...fixture.beat_units[0],
            source_basis: "invented_fact",
          },
        ],
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run red**

Run:

```powershell
npx vitest run --configLoader runner tests/shared/script-writing-brief-shadow-schema.test.ts
```

Expected: FAIL because `ScriptWritingBriefShadow` is not exported and the fixture does not exist.

- [ ] **Step 3: Add fixture**

Create `harness/samples/script-writing-brief-shadow/yanzi-shichu.fixture.json`:

```json
{
  "stage": "script_writing_brief_shadow",
  "topic_id": "topic_yanzi_shichu",
  "event_focus": "晏子出使楚国时，楚王连续当众羞辱齐国使臣，晏子必须当场守住齐国体面。",
  "opening_bridge_intent": "把观众拉进楚王公开设局羞辱使臣、晏子一退就等于齐国失面的压力。",
  "beat_units": [
    {
      "beat": "入楚受辱",
      "scene_pressure": "楚王用小门和身形羞辱压低晏子与齐国。",
      "actor_action": "晏子停在小门前，不顺着羞辱进入。",
      "opponent_reaction": "楚王和群臣等着看齐国使臣低头。",
      "immediate_consequence": "晏子用狗门反击把羞辱推回楚国。",
      "source_basis": "canonical_quote",
      "confidence": "high"
    },
    {
      "beat": "橘枳之喻",
      "scene_pressure": "楚王借齐人善盗继续羞辱齐国风气。",
      "actor_action": "晏子用橘枳之喻转回水土环境。",
      "opponent_reaction": "楚王的羞辱被反扣到楚国环境上。",
      "immediate_consequence": "齐人在齐不盗、入楚为盗的责任被推回楚国。",
      "source_basis": "canonical_quote",
      "confidence": "high"
    }
  ],
  "iconic_moment_intents": [
    {
      "moment": "使狗国者，从狗门入",
      "usage_intent": "反击狗门羞辱，说明只有出使狗国才走狗门。",
      "source_basis": "canonical_quote"
    },
    {
      "moment": "橘生淮南则为橘，生于淮北则为枳",
      "usage_intent": "反击齐人善盗的羞辱，把问题归到楚国水土和环境。",
      "source_basis": "canonical_quote"
    }
  ],
  "ending_residue_target": "晏子不是赢一句话，而是在公开场合让楚王的羞辱反压回楚国。",
  "factual_bounds": [
    "不得新增未定人物。",
    "不得把橘枳之喻解释成人才寓意。",
    "不得扩展到 storyboard、asset 或 compose。"
  ],
  "material_gaps": []
}
```

- [ ] **Step 4: Add schema and export**

Create `shared/src/script/script-writing-brief-shadow.schema.ts`:

```ts
import { z } from "zod";

export const ScriptWritingBriefShadow = z
  .object({
    stage: z.literal("script_writing_brief_shadow"),
    topic_id: z.string().min(1),
    event_focus: z.string().min(1),
    opening_bridge_intent: z.string().min(1),
    beat_units: z
      .array(
        z
          .object({
            beat: z.string().min(1),
            scene_pressure: z.string().min(1),
            actor_action: z.string().min(1),
            opponent_reaction: z.string().min(1),
            immediate_consequence: z.string().min(1),
            source_basis: z.enum([
              "topic_package",
              "canonical_quote",
              "narrative_tension_map",
              "inferred_from_topic",
            ]),
            confidence: z.enum(["high", "medium", "low"]),
          })
          .strict(),
      )
      .min(1),
    iconic_moment_intents: z.array(
      z
        .object({
          moment: z.string().min(1),
          usage_intent: z.string().min(1),
          source_basis: z.enum([
            "canonical_quote",
            "must_include_beat",
            "source_anchor",
          ]),
        })
        .strict(),
    ),
    ending_residue_target: z.string().min(1),
    factual_bounds: z.array(z.string().min(1)),
    material_gaps: z.array(
      z
        .object({
          gap: z.string().min(1),
          impact: z.string().min(1),
        })
        .strict(),
    ),
  })
  .strict();

export type ScriptWritingBriefShadow = z.infer<
  typeof ScriptWritingBriefShadow
>;
```

Modify `shared/src/index.ts`:

```ts
export { ScriptWritingBriefShadow } from "./script/script-writing-brief-shadow.schema";
```

Add this export near the other script schema exports.

- [ ] **Step 5: Run green**

Run:

```powershell
npx vitest run --configLoader runner tests/shared/script-writing-brief-shadow-schema.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run adjacent schema checks**

Run:

```powershell
npx vitest run --configLoader runner tests/shared/schema-contracts.test.ts tests/shared/script-writing-brief-shadow-schema.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```powershell
git add shared/src/script/script-writing-brief-shadow.schema.ts shared/src/index.ts tests/shared/script-writing-brief-shadow-schema.test.ts harness/samples/script-writing-brief-shadow/yanzi-shichu.fixture.json
git commit -m "定义脚本brief影子结构"
```

---

## Task 4: Add Shadow Brief Prompt Contract

**Purpose:** Add a formal prompt contract for shadow generation without calling it from runtime.

**Files:**
- Create: `prompts/script/script-writing-brief-shadow.prompt.md`
- Modify: `tests/backend/runtime/prompt-runtime.test.ts`

- [ ] **Step 1: Write failing prompt registry test**

Add this test to `tests/backend/runtime/prompt-runtime.test.ts`:

```ts
  it("loads script.writing-brief-shadow as a shadow-only prompt contract", () => {
    const prompt = createPromptRegistry().getPrompt("script.writing-brief-shadow");

    expect(prompt.metadata.id).toBe("script.writing-brief-shadow");
    expect(prompt.metadata.language).toBe("zh-CN");
    expect(prompt.body).toContain("shadow-only");
    expect(prompt.body).toContain("不得生成 `script_text`");
    expect(prompt.body).toContain("不得修改 `TopicPackage`");
    expect(prompt.body).toContain("不得新增、删除或改名 `must_include_beats`");
    expect(prompt.body).toContain("不得创建 storyboard、asset、compose 或镜头对象");
    expect(prompt.body).toContain("材料不足时写入 `material_gaps`");
    expect(prompt.body).toContain("不得把推断写成史实");
  });
```

- [ ] **Step 2: Run red**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/runtime/prompt-runtime.test.ts
```

Expected: FAIL because prompt `script.writing-brief-shadow` does not exist.

- [ ] **Step 3: Add prompt contract**

Create `prompts/script/script-writing-brief-shadow.prompt.md`:

```markdown
---
id: script.writing-brief-shadow
stage: script
language: zh-CN
consumes:
  - TopicPackage
produces:
  - ScriptWritingBriefShadow
status: shadow-only
---

# 任务

根据 `TopicPackage` 生成 `ScriptWritingBriefShadow`，只用于 harness 观察，不进入主链路。

## 硬边界

- 本 prompt 是 shadow-only。
- 不得生成 `script_text`。
- 不得修改 `TopicPackage`。
- 不得新增、删除或改名 `must_include_beats`。
- 不得修改 `selected_angle`、`scope_label`、`forbidden_expansions`。
- 不得创建 storyboard、asset、compose 或镜头对象。
- 不得把推断写成史实。
- 不得生成精确台词，除非来自 `canonical_quotes`。
- 材料不足时写入 `material_gaps`，不得硬编细节。

## 输出

只输出 `ScriptWritingBriefShadow` JSON 对象。

`beat_units` 只把每个 beat 转成可执行场面提示，不写段落，不写大纲，不写分镜。

`source_basis=inferred_from_topic` 只表示从 TopicPackage 显性字段推导出的压力、动作或后果，不代表新增史实。
```

- [ ] **Step 4: Run green**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/runtime/prompt-runtime.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run prompt language guard**

Run:

```powershell
npx vitest run --configLoader runner harness/scripts/check-prompt-language.test.ts tests/backend/runtime/prompt-runtime.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```powershell
git add prompts/script/script-writing-brief-shadow.prompt.md tests/backend/runtime/prompt-runtime.test.ts
git commit -m "新增脚本brief影子提示合同"
```

---

## Task 5: Add Harness-Only Shadow Brief Generator

**Purpose:** Generate and validate shadow briefs from topic packages without touching writer input or script generation.

**Files:**
- Create: `harness/scripts/runtime/script-writing-brief-shadow.ts`
- Create: `tests/harness/script-writing-brief-shadow.test.ts`

- [ ] **Step 1: Write failing harness test**

Create `tests/harness/script-writing-brief-shadow.test.ts`:

```ts
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { runScriptWritingBriefShadow } from "../../harness/scripts/runtime/script-writing-brief-shadow";

describe("script writing brief shadow harness helper", () => {
  it("writes a validated shadow brief without creating writer inputs", async () => {
    const outputDir = mkdtempSync(join(tmpdir(), "svf2-brief-shadow-"));
    const topicPackagePath = join(outputDir, "topic-package.json");
    writeFileSync(
      topicPackagePath,
      JSON.stringify(
        {
          topic_id: "topic_yanzi_shichu",
          canonical_title: "晏子使楚",
          selected_angle: "楚王连续羞辱，晏子当场反击。",
          scope_label: "完整事件",
          core_conflict: "楚王公开羞辱齐国使臣。",
          stakes: "晏子一退，齐国体面就被压住。",
          must_include_beats: ["入楚受辱", "橘枳之喻"],
          forbidden_expansions: ["不得扩展到 downstream"],
          source_anchor_refs: ["《晏子春秋》"],
          canonical_quotes: ["使狗国者，从狗门入"],
          canonical_quote_intents: [
            {
              quote: "使狗国者，从狗门入",
              intent: "反击狗门羞辱。",
            },
          ],
          ambiguity_notes: [],
          narrative_tension_map: {
            hook_claim: "楚王连续羞辱，晏子不能退。",
            pressure_escalation: "从小门羞辱到齐人善盗。",
            mid_reveal: "晏子把羞辱反扣给楚国。",
            peak_payoff: "橘枳之喻。",
            ending_residue: "楚王的局被反压回去。",
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    const fixture = JSON.parse(
      readFileSync(
        "harness/samples/script-writing-brief-shadow/yanzi-shichu.fixture.json",
        "utf8",
      ),
    );
    const llmGateway = {
      invokeStructuredPrompt: vi.fn(async () => fixture),
    };

    const result = await runScriptWritingBriefShadow({
      topicPackagePath,
      outputDir,
      llmGateway: llmGateway as any,
    });

    expect(result.outputPath).toBe(join(outputDir, "script-writing-brief-shadow.json"));
    expect(existsSync(result.outputPath)).toBe(true);
    expect(existsSync(join(outputDir, "script-input-bundle.json"))).toBe(false);
    expect(llmGateway.invokeStructuredPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        promptId: "script.writing-brief-shadow",
      }),
    );
  });
});
```

- [ ] **Step 2: Run red**

Run:

```powershell
npx vitest run --configLoader runner tests/harness/script-writing-brief-shadow.test.ts
```

Expected: FAIL because `runScriptWritingBriefShadow` does not exist.

- [ ] **Step 3: Implement minimal helper**

Create `harness/scripts/runtime/script-writing-brief-shadow.ts`:

```ts
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { ScriptWritingBriefShadow } from "../../../shared/src/index";
import { createLlmGateway, type LlmGateway } from "../../../backend/src/runtime/llm/llm-gateway";
import { createOpenAiCompatibleProvider } from "../../../backend/src/runtime/llm/openai-compatible-provider";
import { createPromptRegistry } from "../../../backend/src/runtime/prompts/prompt-registry";

export interface RunScriptWritingBriefShadowInput {
  topicPackagePath: string;
  outputDir: string;
  llmGateway?: LlmGateway;
}

export async function runScriptWritingBriefShadow(
  input: RunScriptWritingBriefShadowInput,
) {
  const topicPackage = JSON.parse(
    readFileSync(resolve(process.cwd(), input.topicPackagePath), "utf8"),
  );
  const gateway =
    input.llmGateway ??
    createLlmGateway({
      registry: createPromptRegistry(),
      provider: createOpenAiCompatibleProvider({}),
    });
  const rawBrief = await gateway.invokeStructuredPrompt<unknown>({
    promptId: "script.writing-brief-shadow",
    input: {
      topic_package: topicPackage,
    },
  });
  const brief = ScriptWritingBriefShadow.parse(rawBrief);
  const finalOutputDir = resolve(process.cwd(), input.outputDir);
  mkdirSync(finalOutputDir, { recursive: true });
  const outputPath = join(finalOutputDir, "script-writing-brief-shadow.json");
  writeFileSync(outputPath, JSON.stringify(brief, null, 2), "utf8");

  return {
    outputPath,
    brief,
  };
}
```

- [ ] **Step 4: Run green**

Run:

```powershell
npx vitest run --configLoader runner tests/harness/script-writing-brief-shadow.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run adjacent checks**

Run:

```powershell
npx vitest run --configLoader runner tests/harness/script-writing-brief-shadow.test.ts tests/shared/script-writing-brief-shadow-schema.test.ts tests/backend/runtime/prompt-runtime.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```powershell
git add harness/scripts/runtime/script-writing-brief-shadow.ts tests/harness/script-writing-brief-shadow.test.ts
git commit -m "增加脚本brief影子生成器"
```

---

## Task 6: Add Post-Run Five-Round Shadow Brief Check

**Purpose:** Generate brief shadow artifacts from an existing five-round output directory without rerunning or modifying script generation.

**Files:**
- Create: `harness/scripts/runtime/script-brief-shadow-five-round-check.ts`
- Modify: `package.json`
- Create: `tests/harness/script-brief-shadow-five-round-check.test.ts`

- [ ] **Step 1: Write failing post-run test**

Create `tests/harness/script-brief-shadow-five-round-check.test.ts`:

```ts
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { runScriptBriefShadowFiveRoundCheck } from "../../harness/scripts/runtime/script-brief-shadow-five-round-check";

describe("script brief shadow five-round post-run check", () => {
  it("writes shadow briefs next to topic packages without touching script drafts", async () => {
    const root = mkdtempSync(join(tmpdir(), "svf2-brief-shadow-five-"));
    const sampleDir = join(root, "yanzi-shichu");
    mkdirSync(sampleDir, { recursive: true });
    writeFileSync(
      join(sampleDir, "topic-package.json"),
      JSON.stringify({
        topic_id: "topic_yanzi_shichu",
        canonical_title: "晏子使楚",
        must_include_beats: ["入楚受辱", "橘枳之喻"],
      }),
      "utf8",
    );
    writeFileSync(
      join(sampleDir, "script-draft.json"),
      JSON.stringify({ script_text: "原脚本不得被修改" }),
      "utf8",
    );
    const fixture = JSON.parse(
      readFileSync(
        "harness/samples/script-writing-brief-shadow/yanzi-shichu.fixture.json",
        "utf8",
      ),
    );
    const llmGateway = {
      invokeStructuredPrompt: vi.fn(async () => fixture),
    };

    const result = await runScriptBriefShadowFiveRoundCheck({
      sourceOutputDir: root,
      llmGateway: llmGateway as any,
    });

    expect(result.processedSamples).toBe(1);
    expect(result.writtenFiles).toEqual([
      join(sampleDir, "script-writing-brief-shadow.json"),
    ]);
    expect(
      JSON.parse(readFileSync(join(sampleDir, "script-draft.json"), "utf8")),
    ).toEqual({ script_text: "原脚本不得被修改" });
  });
});
```

- [ ] **Step 2: Run red**

Run:

```powershell
npx vitest run --configLoader runner tests/harness/script-brief-shadow-five-round-check.test.ts
```

Expected: FAIL because the post-run checker does not exist.

- [ ] **Step 3: Implement post-run checker**

Create `harness/scripts/runtime/script-brief-shadow-five-round-check.ts`:

```ts
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import type { LlmGateway } from "../../../backend/src/runtime/llm/llm-gateway";
import { runScriptWritingBriefShadow } from "./script-writing-brief-shadow";

export interface RunScriptBriefShadowFiveRoundCheckInput {
  sourceOutputDir: string;
  llmGateway?: LlmGateway;
}

export async function runScriptBriefShadowFiveRoundCheck(
  input: RunScriptBriefShadowFiveRoundCheckInput,
) {
  const root = resolve(process.cwd(), input.sourceOutputDir);
  const sampleDirs = readdirSync(root)
    .map((entry) => join(root, entry))
    .filter((entry) => statSync(entry).isDirectory())
    .filter((entry) => existsSync(join(entry, "topic-package.json")));
  const writtenFiles: string[] = [];

  for (const sampleDir of sampleDirs) {
    const result = await runScriptWritingBriefShadow({
      topicPackagePath: join(sampleDir, "topic-package.json"),
      outputDir: sampleDir,
      llmGateway: input.llmGateway,
    });
    writtenFiles.push(result.outputPath);
  }

  return {
    sourceOutputDir: root,
    processedSamples: sampleDirs.length,
    writtenFiles,
  };
}

if (require.main === module) {
  const sourceOutputDir =
    process.argv[process.argv.indexOf("--source-output-dir") + 1];
  if (!sourceOutputDir) {
    throw new Error("missing --source-output-dir");
  }
  runScriptBriefShadowFiveRoundCheck({ sourceOutputDir })
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
```

Modify `package.json` scripts:

```json
"harness:script-brief-shadow-five-round-check": "tsx harness/scripts/runtime/script-brief-shadow-five-round-check.ts"
```

- [ ] **Step 4: Run green**

Run:

```powershell
npx vitest run --configLoader runner tests/harness/script-brief-shadow-five-round-check.test.ts tests/harness/script-writing-brief-shadow.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run package script smoke with a temp fixture directory**

Use a temp directory created by the test or create one manually under the system temp directory. Do not write to `storage/topic-candidate-library/`.

Run:

```powershell
npm run harness:script-brief-shadow-five-round-check -- --source-output-dir <temp-output-dir>
```

Expected: prints JSON with `processedSamples` and `writtenFiles`.

- [ ] **Step 6: Commit**

Run:

```powershell
git add harness/scripts/runtime/script-brief-shadow-five-round-check.ts package.json tests/harness/script-brief-shadow-five-round-check.test.ts
git commit -m "增加brief影子五轮后处理"
```

---

## Task 7: Add Shadow Observation Template

**Purpose:** Make human review explicit before any future A/B or main-chain proposal.

**Files:**
- Create: `docs/records/templates/script-writing-brief-shadow-observation-template.md`
- Create: `tests/harness/script-writing-brief-shadow-observation-template.test.ts`

- [ ] **Step 1: Write failing template test**

Create `tests/harness/script-writing-brief-shadow-observation-template.test.ts`:

```ts
import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const templatePath =
  "docs/records/templates/script-writing-brief-shadow-observation-template.md";

describe("script writing brief shadow observation template", () => {
  it("contains required human review fields and stop criteria", () => {
    expect(existsSync(templatePath)).toBe(true);

    const template = readFileSync(templatePath, "utf8");
    const required = [
      "# Script Writing Brief Shadow Observation",
      "## Run Metadata",
      "## Sample Table",
      "## Incremental Value Review",
      "## Fact Risk Review",
      "## Template Risk Review",
      "## Main-Chain Safety Review",
      "## Decision",
      "Stop if Brief is only a longer summary",
      "Stop if Brief adds unsupported facts",
      "Stop if Brief requires writer prompt to become heavier",
    ];

    for (const item of required) {
      expect(template).toContain(item);
    }
  });
});
```

- [ ] **Step 2: Run red**

Run:

```powershell
npx vitest run --configLoader runner tests/harness/script-writing-brief-shadow-observation-template.test.ts
```

Expected: FAIL because the observation template does not exist.

- [ ] **Step 3: Add observation template**

Create `docs/records/templates/script-writing-brief-shadow-observation-template.md`:

```markdown
# Script Writing Brief Shadow Observation

Date:
Source five-round output:
Shadow output command:

## Run Metadata

- total_samples:
- processed_samples:
- written_files:

## Sample Table

| sample | has_incremental_value | fact_risk | template_risk | useful_for_failure_mode | notes |
| --- | --- | --- | --- | --- | --- |
| sample-id | yes/no | none/low/high | none/low/high | yes/no | |

## Incremental Value Review

- Does the Brief add executable story material not directly stated by TopicPackage?
- Does the Brief explain beat underdevelopment, weak ending, or quote intent risk?

## Fact Risk Review

- Stop if Brief adds unsupported facts.
- Stop if inferred material is written as history rather than inference.

## Template Risk Review

- Stop if Brief is only a longer summary.
- Stop if Brief turns every beat into mechanical action/reaction/consequence filling.

## Main-Chain Safety Review

- Confirm writer input did not change.
- Confirm validator and reviewer decisions did not change.
- Confirm no patch or regen behavior changed.
- Stop if Brief requires writer prompt to become heavier.

## Decision

- Continue to A/B design: yes/no
- Reason:
```

- [ ] **Step 4: Run green**

Run:

```powershell
npx vitest run --configLoader runner tests/harness/script-writing-brief-shadow-observation-template.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```powershell
git add docs/records/templates/script-writing-brief-shadow-observation-template.md tests/harness/script-writing-brief-shadow-observation-template.test.ts
git commit -m "新增brief影子观察模板"
```

---

## Task 8: Run Real Five-Round Shadow Observation

**Purpose:** Produce evidence for whether the shadow Brief has enough value to justify any future A/B design.

**Files:**
- Create: `docs/records/2026-05-07-script-writing-brief-shadow-observation.md`
- Runtime output under: `harness/scripts/runtime/output/<run-id>`

- [ ] **Step 1: Run normal five-round check**

Run:

```powershell
$env:LLM_TIMEOUT_MS='90000'; npm run harness:topic-script-five-round-quality-check -- --output-dir harness/scripts/runtime/output/2026-05-07-brief-shadow-source-five-round
```

Expected:

- command exits 0
- JSON output includes `status: "five-round-quality-check-completed"`
- generated output directory contains five sample subdirectories

- [ ] **Step 2: Run shadow post-process**

Run:

```powershell
$env:LLM_TIMEOUT_MS='90000'; npm run harness:script-brief-shadow-five-round-check -- --source-output-dir harness/scripts/runtime/output/2026-05-07-brief-shadow-source-five-round
```

Expected:

- command exits 0
- JSON output includes `processedSamples: 5`
- each sample directory contains `script-writing-brief-shadow.json`

- [ ] **Step 3: Read shadow output and write observation record**

Create `docs/records/2026-05-07-script-writing-brief-shadow-observation.md` from the template. Record every sample and classify:

- `has_incremental_value`
- `fact_risk`
- `template_risk`
- `useful_for_failure_mode`

Use only human observation and artifact reading. Do not add local scoring logic.

- [ ] **Step 4: Apply decision gate**

The observation record must conclude one of:

```text
continue_to_ab_design: no
```

or:

```text
continue_to_ab_design: yes
```

Only use `yes` if all are true:

- at least 4/5 briefs add real executable story material
- zero briefs add unsupported facts
- zero briefs introduce downstream objects
- brief usefulness maps to observed script failure modes
- writer prompt can plausibly become lighter in a future A/B design

- [ ] **Step 5: Verify no main-chain files changed**

Run:

```powershell
git status --short
```

Expected:

- only the observation record and generated runtime output are new or modified
- no code, prompt, schema, writer, validator, reviewer, topic, UI, storyboard, asset, or compose files changed in this task
- `storage/topic-candidate-library/` remains unstaged

- [ ] **Step 6: Commit observation record only**

Run:

```powershell
git add docs/records/2026-05-07-script-writing-brief-shadow-observation.md
git commit -m "记录brief影子观察结果"
```

Do not commit generated runtime output unless the user explicitly asks to keep those artifacts in git.

---

## Task 9: Stop Or Write Separate A/B Design

**Purpose:** Prevent accidental main-chain integration after shadow observation.

**Files:**
- Create only if Task 8 decision is `continue_to_ab_design: yes`:
  - `docs/plans/2026-05-07-script-brief-ab-evaluation-design.md`

- [ ] **Step 1: If Task 8 decision is no, stop**

If the observation record says:

```text
continue_to_ab_design: no
```

Then do not create any new plan or implementation. Report the stop reason and propose either:

- refine TopicPackage material quality
- simplify writer prompt debt
- abandon Brief

- [ ] **Step 2: If Task 8 decision is yes, write A/B design only**

If the observation record says:

```text
continue_to_ab_design: yes
```

Create `docs/plans/2026-05-07-script-brief-ab-evaluation-design.md`.

The document must explicitly state:

- A/B is still not production integration.
- B path is experimental and harness-only.
- writer prompt must become lighter or the experiment fails.
- local validator and reviewer remain unchanged.
- no patch or regen behavior changes.

- [ ] **Step 3: Verify A/B design guard**

Run:

```powershell
@'
const fs = require("fs");
const path = "docs/plans/2026-05-07-script-brief-ab-evaluation-design.md";
if (!fs.existsSync(path)) {
  console.log("no ab design created");
  process.exit(0);
}
const text = fs.readFileSync(path, "utf8");
for (const phrase of [
  "not production integration",
  "harness-only",
  "writer prompt must become lighter",
  "reviewer remain unchanged",
  "validator remain unchanged"
]) {
  if (!text.includes(phrase)) {
    throw new Error(`missing guard: ${phrase}`);
  }
}
console.log("ab design guards present");
'@ | node -
```

Expected:

- If no A/B design exists, prints `no ab design created`.
- If A/B design exists, prints `ab design guards present`.

- [ ] **Step 4: Commit only the A/B design if created**

Run only if A/B design was created:

```powershell
git add docs/plans/2026-05-07-script-brief-ab-evaluation-design.md
git commit -m "设计脚本brief实验对比方案"
```

---

## Final Verification For This Plan

After all completed tasks, run:

```powershell
npx vitest run --configLoader runner tests/harness/script-prompt-debt-audit-template.test.ts tests/harness/script-prompt-debt-audit-record.test.ts tests/shared/script-writing-brief-shadow-schema.test.ts tests/backend/runtime/prompt-runtime.test.ts tests/harness/script-writing-brief-shadow.test.ts tests/harness/script-brief-shadow-five-round-check.test.ts tests/harness/script-writing-brief-shadow-observation-template.test.ts --no-file-parallelism
```

Expected: all tests pass.

Run:

```powershell
git status --short
```

Expected:

- no unstaged task files
- `storage/topic-candidate-library/` may remain untracked and must remain unstaged

## Plan Stop Rule

This plan stops after shadow observation and, at most, a separate A/B design document. It does not authorize implementation of A/B writer input, Brief runtime integration, prompt slimming, reviewer behavior changes, local semantic gates, patch integration, or downstream objects.
