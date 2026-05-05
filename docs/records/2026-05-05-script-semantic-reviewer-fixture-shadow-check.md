# Script Semantic Reviewer Fixture Shadow Check

Date: 2026-05-05

## 1. Run Context

- Purpose: compare real shadow reviewer decisions against the controlled calibration fixtures.
- Runtime provider: `LLM_PROVIDER=openai`
- Runner: one-off runner calling `reviewScriptSemantics()` directly with fixture `bundle` and `draft`.
- Output directory: `harness/scripts/runtime/output/script-semantic-reviewer-fixture-shadow-2026-05-05`
- Fixture count: 3
- Reviewer mode: shadow-only.

This run did not call writer, local validation, patch, regen, topic, or downstream stages. It only measured the semantic reviewer against fixed fixtures.

## 2. Aggregate Result

| Metric | Result |
|---|---:|
| Fixtures run | 3 / 3 |
| Expected decision matched | 3 / 3 |
| Mismatched | 0 / 3 |
| `pass` matched | 1 / 1 |
| `patch_once/lift` matched | 1 / 1 |
| `return_topic` matched | 1 / 1 |

## 3. Per-fixture Record

| Fixture | Category | Expected | Actual | Match | Hard issues | Soft issues | Summary |
|---|---|---|---|---|---:|---:|---|
| semantic-good-enough-yanzishichu | good_enough | `pass` | `pass` | yes | 0 | 1 | 已覆盖三项 must_include_beats，递进和结尾成立；可丰富场景但首稿可接受。 |
| semantic-weak-opening-yanzishichu | weak_lift | `patch_once/lift` | `patch_once/lift` | yes | 2 | 2 | 情节覆盖完整，但开头和结尾过于概括，缺乏场景感和叙事张力。 |
| semantic-off-contract-yanzishichu | off_contract | `return_topic` | `return_topic` | yes | 4 | 3 | 稿件偏离晏子使楚，变成虚构商队冒险故事，需要返回主题。 |

## 4. Interpretation

The calibrated reviewer can distinguish the three intended fixture classes in this small controlled set:

- good-enough first pass is accepted as `pass`
- weak but on-contract draft is marked `patch_once/lift`
- off-contract draft is marked `return_topic`

This is a useful shadow metric checkpoint, not permission to enable automatic patching. The sample size is small and intentionally controlled.

## 5. Next Follow-up

Do not enable semantic patch behavior yet. The next smallest task should integrate this fixture set into a repeatable non-default harness command/report so future prompt changes can run the same reviewer calibration check without recreating one-off runners.
