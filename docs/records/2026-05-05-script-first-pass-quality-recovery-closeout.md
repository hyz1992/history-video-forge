# Script First-pass Quality Recovery Closeout

Date: 2026-05-05

## 1. Current Position

The `Script First-pass Quality Recovery` line is now closed at the shadow-metric level.

The main script path is:

1. generate first-pass script
2. run local hard validation
3. run semantic reviewer in shadow mode only
4. persist result and diagnostics

`patch_once` remains outside the main path. Reviewer output is a measuring instrument, not a driver.

## 2. Completed Commits

| Commit | Scope |
|---|---|
| `df7c92b` | 收掉脚本假的语义审校决策 |
| `59febcb` | 去掉选题交付包装的统一挑战句模板 |
| `f40fbee` | 收口脚本开头的场面化生成合同 |
| `af40955` | 接入脚本语义审校的影子评估链路 |
| `49b82d5` | 记录脚本首稿语义质量基线 |
| `49c2f1d` | 增强脚本beat追踪证明片段 |
| `99028bb` | 记录脚本首稿质量复测基线 |
| `6430958` | 收口脚本语义审校输出结构 |
| `72e6e74` | 记录脚本语义审校分布基线 |
| `c9ad077` | 校准脚本语义审校首稿量尺 |
| `3cbcdb2` | 记录脚本语义审校校准分布 |
| `0477eca` | 建立脚本语义审校对照样本 |
| `850e7fc` | 记录脚本语义审校对照复测 |
| `d9a174f` | 固化脚本语义审校对照巡检 |

## 3. Evidence Records

| Record | Main finding |
|---|---|
| `docs/records/2026-05-05-script-first-pass-quality-baseline.md` | After Tasks 1-4, local validation was blocked by `beat_trace_weak` in 10 / 10 samples. |
| `docs/records/2026-05-05-script-first-pass-quality-followup-baseline.md` | After strengthening `beat_trace.excerpt`, local validation passed 10 / 10 samples. |
| `docs/records/2026-05-05-script-semantic-reviewer-distribution-baseline.md` | After output-shape recovery, semantic reviewer parsed but returned `patch_once/lift` 10 / 10, showing over-triggering. |
| `docs/records/2026-05-05-script-semantic-reviewer-calibrated-distribution.md` | After first-pass calibration, semantic reviewer returned `pass` 10 / 10 on comparable first-pass samples. |
| `docs/records/2026-05-05-script-semantic-reviewer-fixture-shadow-check.md` | Controlled fixtures matched 3 / 3: good-enough -> `pass`, weak -> `patch_once/lift`, off-contract -> `return_topic`. |

## 4. Available Commands

| Command | Use |
|---|---|
| `npm test -- tests/backend/script/script-runtime-generate.test.ts tests/backend/script/script-graph-run.test.ts tests/backend/runtime/prompt-runtime.test.ts` | Script runtime, graph, prompt registry regression. |
| `npm test -- tests/harness/script-semantic-reviewer-fixtures.test.ts` | Fixture contract and non-default shadow check runner tests. |
| `npm run harness:script-semantic-fixtures` | Non-default real shadow calibration run for semantic reviewer fixtures. |
| `npm run harness:topic-script-live-check -- harness/samples/topic-script/family-set.md` | Explicit real topic -> script live check. |

`harness:script-semantic-fixtures` may print npm argument warnings on this npm version when optional flags are used. The runner accepts the positional output directory form and still writes the expected report artifacts.

## 5. Current Guarantees

- Fake semantic review is removed.
- The old unified challenge sentence no longer pollutes `TopicDeliveryPack`.
- Script opening generation now prioritizes concrete scene-first starts.
- `beat_trace.excerpt` now uses usable script-text proof snippets instead of short labels.
- Local validation passes fixed 10-sample first-pass checks.
- Semantic reviewer runs in shadow mode and parses formal `ScriptSemanticReviewResult`.
- Semantic reviewer has a non-default fixture calibration check.
- Main-chain patching remains disabled during normal script generation.

## 6. Still Not Allowed

- Do not enable semantic `patch_once` as an automatic main-chain action.
- Do not add local keyword or string rules to simulate semantic judging.
- Do not widen this work into storyboard, assets, compose, or downstream objects.
- Do not tune writer output just to satisfy reviewer feedback if it weakens the whole script.
- Do not treat the current 10-sample distribution as production stability.

## 7. Remaining Risks

- The 10-sample runs are fixed historical-topic samples, not broad production coverage.
- The reviewer contrast fixtures are useful but small, currently centered on `晏子使楚`.
- The reviewer can distinguish the controlled fixture classes, but cross-family stability is unproven.
- The current semantic reviewer may still vary under real model drift.
- Patch behavior remains intentionally unvalidated as a production action in this recovery line.

## 8. Next Gate

Before considering any patch integration, require all of the following:

1. Expand reviewer calibration fixtures across at least 3 content families.
2. Re-run `harness:script-semantic-fixtures` and record actual-vs-expected decisions.
3. Re-run a fixed multi-topic first-pass live check and confirm local validation remains stable.
4. Manually inspect at least one `pass`, one `patch_once/lift`, and one `return_topic` reviewer result.
5. Write a separate design plan for patch integration scope, rollback behavior, and quality safeguards.

Until those gates pass, reviewer output should remain a shadow metric only.
