# Script First-pass Quality Follow-up Baseline

Date: 2026-05-05

## 1. Run Context

- Purpose: re-check the first-pass script local gate after strengthening `beat_trace.excerpt` proof snippets.
- Runtime provider: `LLM_PROVIDER=openai`
- Runner: one-off follow-up runner using the current `runScriptGeneration()` path.
- Output directory: `harness/scripts/runtime/output/script-first-pass-quality-followup-2026-05-05`
- Sample count: 10
- Patch / regen request flags: `allowPatch=false`, `allowRegen=false`
- Reviewer mode: shadow-only.

The previous Task 5 runner was temporary and did not persist full input packages, so this follow-up reconstructed the same 10 topic titles and families as fixed `TopicPackage` records. This is a comparable local-gate follow-up, not a byte-for-byte replay of the previous input payloads.

## 2. Aggregate Result

| Metric | Result |
|---|---:|
| Completed runtime calls | 10 / 10 |
| Runtime errors | 0 / 10 |
| Local validation pass | 10 / 10 |
| Local validation `regen_once` | 0 / 10 |
| Local hard fail | 0 / 10 |
| Shadow semantic pass | 0 / 10 |
| Shadow semantic `patch_once` | 0 / 10 |
| Semantic skipped | 10 / 10 |

Local issue distribution was empty. The previous dominant blocker, `beat_trace_weak`, did not reappear.

## 3. Per-sample Record

| ID | Title | Opening span | Local decision | Semantic decision | Local issue |
|---|---|---|---|---|---|
| baseline-01-yanzi | 晏子使楚 | 楚王设宴招待晏子，却故意让人打开旁边的小门，冷笑道：'这扇小门是给客人走的，难道齐国没人了吗？' | `pass` | `skipped` | - |
| baseline-02-zhuzhiwu | 烛之武退秦师 | 夜色沉沉，秦晋大军把郑国围住，烛之武独自出城。 | `pass` | `skipped` | - |
| baseline-03-zhuanzhu | 专诸刺王僚 | 最危险的刺杀，不在战场，而在一桌饭局上。 | `pass` | `skipped` | - |
| baseline-04-jingke | 荆轲刺秦王 | 风萧萧兮易水寒，壮士一去兮不复还。 | `pass` | `skipped` | - |
| baseline-05-xuanwumen | 玄武门之变 | 玄武门前伏兵已定，李建成和李元吉正一步步走入门内。 | `pass` | `skipped` | - |
| baseline-06-duomen | 夺门之变 | 深夜，北京城陷入死寂。南宫之内，曾经的皇帝朱祁镇被软禁多年，已从权力之巅跌落谷底。 | `pass` | `skipped` | - |
| baseline-07-feishui | 淝水之战 | 淝水两岸对峙，前秦大军还没交战，阵脚先乱了。 | `pass` | `skipped` | - |
| baseline-08-julu | 巨鹿之战 | 秦军围巨鹿，各路诸侯却都驻扎在城外，按兵不动，只敢远远观望。 | `pass` | `skipped` | - |
| baseline-09-lisi | 李斯之死 | 刑场上，曾经权倾朝野的李斯被推向腰斩。 | `pass` | `skipped` | - |
| baseline-10-hanxin | 韩信之死 | 韩信最刺痛的结局，是他没倒在敌人手里。 | `pass` | `skipped` | - |

## 4. Interpretation

The `beat_trace.excerpt` structural repair is effective for the local hard gate in this follow-up: all 10 samples passed local validation, and no local issue code was emitted.

The run still does not produce a semantic quality baseline. The semantic reviewer node was reached, but the real model response did not match `ScriptSemanticReviewResult`; for example, it returned an outer `answer` object with `tags` and `patch_points`. The shadow reviewer correctly degraded to `skipped` instead of driving the main chain.

## 5. Next Follow-up

Do not start semantic patch work yet. The next smallest task should make the shadow reviewer produce and parse the formal `ScriptSemanticReviewResult` shape, with tests that reject wrapped `answer` payloads unless they are explicitly normalized by a schema-safe adapter. Keep reviewer output as a metric only; do not let it drive patch behavior in the main chain.
