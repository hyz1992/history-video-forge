# Asset Planning Quality Guardrails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tighten asset planning v1 quality guardrails that were proven by the 2026-05-11 five-round review, without changing shared schema, API shape, or downstream implementation boundaries.

**Architecture:** This is a prompt-contract and structural-output refinement only. The formal asset planning planner prompt remains the only LLM-facing implementation surface; local validators remain structural and do not judge aesthetics, historical meaning, or viral quality. No reviewer is added to the asset planning main chain.

**Tech Stack:** TypeScript, Vitest, prompt registry, existing zh-CN prompt files, existing asset planning five-round harness.

---

## Execution Contract

Follow `AGENTS.md` strictly.

- Execute exactly one low-coupling task at a time.
- Start each task by printing:
  - `任务`
  - `目标`
  - `本次改动文件`
  - `不改什么`
  - `验证方式`
- Finish each task by printing:
  - `实际改动`
  - `验证结果`
  - `自审结论`
  - `剩余风险`
  - `下一步建议`
- Write tests first, watch them fail, then implement.
- Commit after each completed task with a Chinese commit message.
- Do not implement frontend.
- Do not implement assets, physical file generation, compose timeline, upload UI, or preview UI.
- Do not modify topic, script, or storyboard semantic chain.
- Do not submit `storage/topic-candidate-library/`.
- Do not add `Asset Planning Reviewer` or route semantic reviewer into the asset planning main chain.
- Local validator changes, if any later become necessary, must only check structure and references; they must not judge aesthetics, historical quality, or viral quality.

## Review Findings And Decisions

| Finding | Evidence From 5-round Review | Decision | Rationale |
| --- | --- | --- | --- |
| Historical character labels are sometimes generic | Round 2 labels include `谋划夺位之臣`, `赴死刺客`, `当权吴王`; Round 3 labels include English generic labels. | Adopt | Labels are an identity anchor for prompt compiler, manual review, and asset replacement. Use the historical name in `label`; put story function in `role`. |
| Language drifts into English | Round 3 art bible and task prompts contain extensive English. | Adopt | Formal prompt metadata is `zh-CN`; primary planning fields should stay Chinese. Provider-specific English can be deferred to later prompt compiler work. |
| Modern or unstable historical artifacts can be frozen into art bible | Round 5 contains `必须乘坐轮椅/木车`; Round 3 freezes `Thorny Vine and Poison Fruit`. | Adopt | Asset planning must not amplify known visual risks into hard constraints. Use historically safer descriptions and negative prompts. |
| `video_clip` allocation is still a little broad | Round 1 gives video to speech/analogy moments; Round 4 gives video to smashing jade. | Adopt | Keep default path `image_still + render_motion_cue`; reserve video for continuous action that cannot be expressed with still plus motion. |
| `risk_notes` are often empty on visual tasks | Several image/video tasks have empty `risk_notes`, including war and assassination topics. | Adopt | This is structural enough to require through prompt contract: visual tasks should record safety, historical accuracy, and generation stability risks. |
| BGM coverage is uneven | Some rounds have BGM on only 3 segments, and some BGM intents imply cross-segment coverage. | Defer | This needs schema or downstream timing design for span semantics. Do not patch it into prompt wording now. |
| SFX/BGM sometimes depend on video timing | Round 3 has timing dependencies from audio cues to `video_clip`. | Defer | Dependency strategy belongs to assets/compose timing design. Do not change in this quality-guardrail task. |
| TTS has many chunks but one task | TTS plan contains segment chunks, while task list has one global `tts_audio`. | No change | Current v1 design intentionally creates deterministic local TTS/subtitle skeletons; one task can own chunked output. |
| Cost tier consistency is fuzzy | Some BGM cues are `medium`, some are `low`. | Defer | Cost-tier policy should be tightened with provider-cost assumptions later. |

## Files

Expected modify:

- `harness/prompts/asset-planning/asset-planner.prompt.md`
- `tests/backend/runtime/prompt-runtime.test.ts`

Possible modify only if a task explicitly needs it:

- `tests/harness/asset-planning-five-round-quality-check.test.ts`

Do not modify:

- `shared/src/**`
- `backend/src/modules/asset-planning/**`
- `backend/src/runtime/llm/**`
- `harness/prompts/storyboard/**`
- `harness/prompts/script/**`
- `harness/prompts/topic/**`
- frontend files
- assets / compose implementation files

## Task 1: Historical Labels And zh-CN Output Contract

**Files:**

- Modify: `tests/backend/runtime/prompt-runtime.test.ts`
- Modify: `harness/prompts/asset-planning/asset-planner.prompt.md`

- [ ] **Step 1: Write the failing prompt contract test**

In the existing `loads asset-planning.asset-planner from harness prompts with zh-CN metadata` test, add these assertions:

```ts
expect(prompt.body).toContain("label 优先使用中文历史实名");
expect(prompt.body).toContain("role 写叙事功能");
expect(prompt.body).toContain("主字段必须使用中文");
expect(prompt.body).toContain("不得把核心人物写成英文泛称");
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/runtime/prompt-runtime.test.ts -t "asset-planning"
```

Expected: FAIL because the new prompt wording is not present yet.

- [ ] **Step 3: Update the formal asset planning prompt**

In `harness/prompts/asset-planning/asset-planner.prompt.md`, add a short zh-CN rule near the `ProjectArtBible` section:

```md
`ProjectArtBible` 的 `label` 优先使用中文历史实名，例如“专诸”“公子光”“吴王僚”“项羽”“孙膑”；`role` 写叙事功能，例如“赴死刺客”“决策主将”“核心谋士”。不得把核心人物写成英文泛称或只有功能身份的泛称。除 `global_prompt_prefix` 或 provider hint 这类后续生成提示外，art_bible、production_intent、risk_notes、budget_notes 等主字段必须使用中文。
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/runtime/prompt-runtime.test.ts -t "asset-planning"
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```powershell
git add tests/backend/runtime/prompt-runtime.test.ts harness/prompts/asset-planning/asset-planner.prompt.md
git commit -m "收紧 asset planning 人物命名和中文输出规则"
```

## Task 2: Video Clip Allocation Guardrails

**Files:**

- Modify: `tests/backend/runtime/prompt-runtime.test.ts`
- Modify: `harness/prompts/asset-planning/asset-planner.prompt.md`

- [ ] **Step 1: Write the failing prompt contract test**

Add these assertions to the same asset planning prompt test:

```ts
expect(prompt.body).toContain("video_clip 只给连续动作是叙事核心的镜头");
expect(prompt.body).toContain("why_static_insufficient");
expect(prompt.body).toContain("人物说话、表情变化、象征画面、短促碎裂动作默认不得规划 video_clip");
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/runtime/prompt-runtime.test.ts -t "asset-planning"
```

Expected: FAIL because the new video rules are not present yet.

- [ ] **Step 3: Update the prompt video policy**

Replace or extend the existing video policy in `asset-planner.prompt.md` with:

```md
`video_clip` 只给连续动作是叙事核心的镜头，例如刺杀爆发、撞门入帐、冲锋崩阵、沉船倒灌、战车伏击。只有静态图加运镜无法表达动作因果时才规划 `video_clip`。人物说话、表情变化、象征画面、摔杯/碎玉/挥手/转身等短促碎裂动作默认不得规划 `video_clip`，应降级为 `image_still + render_motion_cue + sfx_cue`。每个 `video_clip` 必须在 `parameters.why_static_insufficient` 写明为什么静态图和运镜不足。
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/runtime/prompt-runtime.test.ts -t "asset-planning"
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```powershell
git add tests/backend/runtime/prompt-runtime.test.ts harness/prompts/asset-planning/asset-planner.prompt.md
git commit -m "收紧 asset planning 视频任务规划规则"
```

## Task 3: Risk Notes And Historical Texture Guardrails

**Files:**

- Modify: `tests/backend/runtime/prompt-runtime.test.ts`
- Modify: `harness/prompts/asset-planning/asset-planner.prompt.md`

- [ ] **Step 1: Write the failing prompt contract test**

Add these assertions to the same asset planning prompt test:

```ts
expect(prompt.body).toContain("视觉类任务 risk_notes 必须非空");
expect(prompt.body).toContain("战争、刺杀、伏击、尸骨、血战");
expect(prompt.body).toContain("避免现代轮椅、金属轮椅、橡胶轮胎、现代医疗器械");
expect(prompt.body).toContain("不得把奇幻毒果、怪诞植物等象征物固化为核心资产");
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/runtime/prompt-runtime.test.ts -t "asset-planning"
```

Expected: FAIL because the new risk rules are not present yet.

- [ ] **Step 3: Update prompt risk rules**

Add this rule near the segment chunk task guidance:

```md
视觉类任务包括 `image_still`、`render_motion_cue`、`video_clip`，其 `risk_notes` 必须非空。遇到战争、刺杀、伏击、尸骨、血战、处刑、穿刺、逃亡等题材时，必须写明平台安全、历史准确性和生成稳定性风险：优先远景、剪影、旗帜倒伏、局部道具、尘土、火光、人物背影，不要写血液喷溅、断肢、穿刺特写或尸体堆叠。涉及孙膑行动不便时，使用“古代木制乘舆”“军榻”“低矮木车”等历史质感描述，并在 negative prompts 或 risk_notes 中避免现代轮椅、金属轮椅、橡胶轮胎、现代医疗器械。象征镜头必须保持历史正剧质感，不得把奇幻毒果、怪诞植物等象征物固化为核心资产；应优先用破碎铁锅、残旗、阴影、背影、裂纹、远景等历史质感元素表达余震。
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/runtime/prompt-runtime.test.ts -t "asset-planning"
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```powershell
git add tests/backend/runtime/prompt-runtime.test.ts harness/prompts/asset-planning/asset-planner.prompt.md
git commit -m "补充 asset planning 风险和历史质感护栏"
```

## Task 4: Verification And Optional Live Review

**Files:**

- No code changes expected.
- Runtime output may update under `harness/scripts/runtime/output/` if live review is explicitly run.

- [ ] **Step 1: Run prompt contract tests**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/runtime/prompt-runtime.test.ts -t "asset-planning"
```

Expected: PASS.

- [ ] **Step 2: Run prompt language tests**

Run:

```powershell
npx vitest run --configLoader runner harness/scripts/check-prompt-language.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run whitespace diff check**

Run:

```powershell
git diff --check
```

Expected: no errors.

- [ ] **Step 4: Inspect git status**

Run:

```powershell
git status --short
```

Expected: no uncommitted code/doc changes after Tasks 1-3 are committed. Output directories may be ignored and must not be staged.

- [ ] **Step 5: Optional fixed-input live check**

Only run this if the user explicitly asks for a fresh LLM review after prompt changes:

```powershell
$env:LLM_TIMEOUT_MS='240000'
npx tsx harness/scripts/runtime/asset-planning-five-round-quality-check.ts --output-dir harness/scripts/runtime/output/<new-run-id>
```

Expected: `live-check-summary.json` has `passed_rounds` equal to `total_rounds`, or any provider-side 429/content-filter issue is reported as an external blocker rather than a code failure.

## Self-Review Checklist

- This plan addresses only findings proven by the 2026-05-11 five-round review.
- No task changes shared schema, API, generation service, storage, frontend, assets, or compose.
- Each implementation task starts with a failing prompt-contract test.
- Each implementation task has an independent Chinese commit.
- Deferred items are explicitly scoped out and must not be implemented opportunistically.
