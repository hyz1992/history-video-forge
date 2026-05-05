# 2026-05-05 Script First-pass Quality Baseline

## 1. Run Context

- Run date: 2026-05-05
- Runtime provider: `LLM_PROVIDER=openai`
- Runner: one-off Task 5 runner using the current `runScriptGeneration()` path
- Output directory: `harness/scripts/runtime/output/script-first-pass-quality-baseline-2026-05-05`
- Sample count: 10
- Patch / regen request flags: `allowPatch=false`, `allowRegen=false`
- Reviewer mode: shadow-only, but only reachable after local validation pass

This run used fixed `TopicPackage` records rather than topic recommendation discovery. The goal was to measure the current first-pass `script` stage after Tasks 1-4, not to test topic selection.

## 2. Sample Coverage

| ID | Family | Topic |
|---|---|---|
| baseline-01-yanzi | 外交压场 | 晏子使楚 |
| baseline-02-zhuzhiwu | 外交压场 | 烛之武退秦师 |
| baseline-03-zhuanzhu | 刺杀政变 | 专诸刺王僚 |
| baseline-04-jingke | 刺杀政变 | 荆轲刺秦王 |
| baseline-05-xuanwumen | 继承夺位型 | 玄武门之变 |
| baseline-06-duomen | 宫廷夺位 | 夺门之变 |
| baseline-07-feishui | 战场崩盘 | 淝水之战 |
| baseline-08-julu | 战场翻盘型 | 巨鹿之战 |
| baseline-09-lisi | 人物命运型 | 李斯之死 |
| baseline-10-hanxin | 人物命运型 | 韩信之死 |

## 3. Aggregate Result

| Metric | Result |
|---|---:|
| Completed runs | 10 / 10 |
| Runtime errors | 0 / 10 |
| Local validation pass | 0 / 10 |
| Local validation `regen_once` | 10 / 10 |
| Shadow semantic pass | 0 / 10 |
| Shadow semantic `patch_once` | 0 / 10 |
| Semantic skipped | 10 / 10 |

The semantic result is not a quality judgment in this run. Every sample stopped before semantic review because local hard validation returned `regen_once`.

## 4. Local Failure Distribution

| Local issue | Count |
|---|---:|
| `beat_trace_weak` | 10 / 10 |

The dominant blocker is not reviewer strictness. The current first-pass writer output is producing `beat_trace` entries that are present but too weak for the local proof threshold.

## 5. Per-sample Record

| ID | Hook claim | Opening span | Local decision | Semantic decision | Local issue |
|---|---|---|---|---|---|
| baseline-01-yanzi | 楚王不是只压了晏子一次，而是连压三次 | 楚王设下连环局，三次羞辱，晏子一次没退。 | `regen_once` | `skipped` | `beat_trace_weak` |
| baseline-02-zhuzhiwu | 郑国最危险的时候，能出城谈判的人只有烛之武 | 夜色沉沉，秦晋大军将郑国围得水泄不通。 | `regen_once` | `skipped` | `beat_trace_weak` |
| baseline-03-zhuanzhu | 最危险的刺杀，不在战场，而在一桌饭局上 | 最危险的刺杀，不在战场，而在一桌饭局上。 | `regen_once` | `skipped` | `beat_trace_weak` |
| baseline-04-jingke | 荆轲进殿时，秦王以为他献的是地图 | 荆轲带着地图进殿，秦王以为他献的是燕国土地。 | `regen_once` | `skipped` | `beat_trace_weak` |
| baseline-05-xuanwumen | 玄武门那天，李世民赌的是先下手还是被清算 | 玄武门那天，李世民赌的是先下手还是被清算。 | `regen_once` | `skipped` | `beat_trace_weak` |
| baseline-06-duomen | 一个被关在南宫的人，竟然在一夜里重回皇位 | 一个被关在南宫的人，竟然在一夜里重回皇位 | `regen_once` | `skipped` | `beat_trace_weak` |
| baseline-07-feishui | 淝水最反常的地方，是大军还没败，心先散了 | 淝水最反常的地方，是大军还没败，心先散了。 | `regen_once` | `skipped` | `beat_trace_weak` |
| baseline-08-julu | 项羽真正狠的不是喊冲，而是先把退路砸碎 | 秦军围巨鹿，诸侯观望不前。 | `regen_once` | `skipped` | `beat_trace_weak` |
| baseline-09-lisi | 李斯最讽刺的地方，是他死在自己参与维护的权力机器里 | 刑场上，曾经权倾朝野的丞相李斯，即将被处以腰斩。 | `regen_once` | `skipped` | `beat_trace_weak` |
| baseline-10-hanxin | 韩信最刺痛的结局，是他没倒在敌人手里 | 长乐宫内，韩信一步步走入圈套。 | `regen_once` | `skipped` | `beat_trace_weak` |

Opening spans above are shortened where needed for readability. Full raw records are in the output directory.

## 6. Opening Template Observation

The previous unified challenge suffix did not reappear in this baseline. No sample used the former `你敢当场顶回去吗？` challenge sentence as a generated opening.

However, several openings still stayed very close to `hook_claim`, especially in samples 03, 05, 06, and 07. This is an observation from the recorded fields, not a semantic gate. It should be treated as follow-up evidence for writer behavior, not as a local semantic reviewer.

## 7. Interpretation

Task 5 did not produce a meaningful shadow semantic pass-rate baseline because the local gate blocked every sample first. This is still useful:

- Fake semantic review is gone: every skipped semantic result is caused by local validation, not by local string-based semantic judging.
- The unified upstream challenge template is gone.
- The current first-pass bottleneck is now concrete: `beat_trace_weak`.
- Before using reviewer pass rate as the next quality metric, the writer or normalizer must produce stronger `beat_trace.excerpt` evidence.

## 8. Next Follow-up

Do not start semantic patch work from this baseline. The next smallest follow-up should target first-pass `beat_trace` proof quality:

- Verify whether the model is producing weak excerpts or the normalization layer is degrading usable excerpts.
- Keep the fix structural: strengthen `beat_trace` output/proof contract without adding local semantic judgment.
- Re-run this same 10-sample baseline after local pass rate is non-zero.
