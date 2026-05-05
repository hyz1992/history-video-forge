# Script Semantic Reviewer Distribution Baseline

Date: 2026-05-05

## 1. Run Context

- Purpose: measure shadow semantic reviewer distribution after schema-safe output normalization.
- Runtime provider: `LLM_PROVIDER=openai`
- Runner: one-off runner using the current `runScriptGeneration()` path.
- Output directory: `harness/scripts/runtime/output/script-semantic-reviewer-distribution-2026-05-05`
- Sample count: 10
- Patch / regen request flags: `allowPatch=false`, `allowRegen=false`
- Reviewer mode: shadow-only.

This run used fixed `TopicPackage` records for the same 10 historical topics used in the previous first-pass follow-up. The goal was to measure reviewer output shape and decision distribution, not to tune reviewer judgment.

## 2. Aggregate Result

| Metric | Result |
|---|---:|
| Completed runtime calls | 10 / 10 |
| Runtime errors | 0 / 10 |
| Local validation pass | 10 / 10 |
| Semantic `pass` | 0 / 10 |
| Semantic `patch_once` | 10 / 10 |
| Semantic `regen_once` | 0 / 10 |
| Semantic `return_topic` | 0 / 10 |
| Semantic `skipped` | 0 / 10 |
| Semantic `patch_intent=lift` | 10 / 10 |
| Main-chain `patch-once` step present | 0 / 10 |

The reviewer is now producing parseable `ScriptSemanticReviewResult` records instead of falling back to `skipped`. The graph still keeps reviewer output in shadow mode: no run entered `patch-once`.

## 3. Per-sample Record

| ID | Title | Opening span | Semantic decision | Patch intent | Hard issues | Soft issues | Patch targets |
|---|---|---|---|---|---:|---:|---:|
| baseline-01-yanzi | 晏子使楚 | 楚王设下重重陷阱，当着满朝文武的面，他让晏子从狗门进入。 | `patch_once` | `lift` | 2 | 3 | 0 |
| baseline-02-zhuzhiwu | 烛之武退秦师 | 夜色沉沉，秦晋大军把郑国围住，危在旦夕。 | `patch_once` | `lift` | 2 | 2 | 0 |
| baseline-03-zhuanzhu | 专诸刺王僚 | 最危险的刺杀，不在战场，而在一桌饭局上。 | `patch_once` | `lift` | 1 | 2 | 0 |
| baseline-04-jingke | 荆轲刺秦王 | 风萧萧兮易水寒，壮士一去兮不复还。荆轲捧着地图走进秦殿，匕首就藏在卷轴尽头。 | `patch_once` | `lift` | 3 | 3 | 0 |
| baseline-05-xuanwumen | 玄武门之变 | 玄武门前伏兵已定，李建成和李元吉正一步步走入门内。 | `patch_once` | `lift` | 1 | 2 | 0 |
| baseline-06-duomen | 夺门之变 | 深夜，南宫大门紧锁，被幽禁的太上皇朱祁镇辗转难眠。 | `patch_once` | `lift` | 3 | 3 | 4 |
| baseline-07-feishui | 淝水之战 | 淝水两岸，前秦大军压境，号称百万雄师 | `patch_once` | `lift` | 2 | 2 | 0 |
| baseline-08-julu | 巨鹿之战 | 秦军围巨鹿，各路诸侯却都在观望，谁都不敢出兵。就在这危急关头，项羽做出了一个令人震惊的决定。 | `patch_once` | `lift` | 2 | 2 | 0 |
| baseline-09-lisi | 李斯之死 | 刑场上，曾经权倾朝野的李斯被推向腰斩。 | `patch_once` | `lift` | 2 | 2 | 3 |
| baseline-10-hanxin | 韩信之死 | 韩信最刺痛的结局，是他没倒在敌人手里。这位曾经的战神，如今却要面对自己人的背叛。 | `patch_once` | `lift` | 2 | 3 | 0 |

## 4. Interpretation

The output-shape recovery worked: semantic review is no longer lost to schema mismatch, and `skipped` dropped from 10 / 10 to 0 / 10 in this comparable run.

The distribution also shows the reviewer is currently too eager to return `patch_once/lift`: every sample was judged as needing lift, often with generic requests for more scene detail, stronger tension, or richer pacing. This is useful as a shadow metric, but it is not yet a trustworthy gate for the main chain.

Two observations should be kept separate:

- Local first-pass generation is now structurally acceptable: local validation passed 10 / 10.
- Semantic reviewer calibration is still immature: 10 / 10 `patch_once/lift` suggests the reviewer may be measuring against an idealized rewrite target rather than the current first-pass acceptance bar.

## 5. Next Follow-up

Do not enable semantic patch behavior from this baseline. The next smallest task should calibrate the semantic reviewer prompt as a measuring instrument:

- Define when a first-pass script is acceptable enough for `pass`.
- Keep `patch_once/lift` for clearly localized improvements, not broad "make it richer" feedback.
- Preserve strict `return_topic` boundaries and avoid turning reviewer feedback into a second writer prompt.
- Add tests with good-enough first-pass drafts that must receive `pass`, plus clearly weak drafts that may receive `patch_once/lift`.
