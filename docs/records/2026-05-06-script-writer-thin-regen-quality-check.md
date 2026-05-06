# Script writer thin regen quality check

Date: 2026-05-06

Command:

```bash
npm run harness:topic-script-five-round-quality-check -- --output-dir harness/scripts/runtime/output/2026-05-06-script-writer-thin-regen-quality-check
```

## Summary

This run checks commit `6c85a9b`, which tightened the `script.writer` prompt contract for `script_body_too_thin` regeneration.

Result: no improvement in the five-round distribution. The run regressed from the previous 3/5 local pass result back to 2/5 local pass.

## Harness Result

```json
{
  "status": "five-round-quality-check-completed",
  "total_samples": 5,
  "passed_samples": 5,
  "failed_samples": 0,
  "sample_ready_samples": 5,
  "local_validation_passed_samples": 2,
  "local_validation_failed_samples": 3,
  "semantic_shadow_passed_samples": 2,
  "semantic_shadow_skipped_samples": 3,
  "semantic_shadow_attention_samples": 0,
  "topic_package_sufficiency_ok_samples": 5,
  "topic_package_sufficiency_needs_attention_samples": 0
}
```

Previous comparable run after beat-expansion prompt tightening:

- local validation: 3/5 pass
- `script_body_too_thin`: 2/5
- semantic shadow: 2 pass / 2 skipped / 1 attention
- topic package sufficiency: 5 ok / 0 needs_attention

Current run:

- local validation: 2/5 pass
- `script_body_too_thin`: 3/5
- semantic shadow: 2 pass / 3 skipped / 0 attention
- topic package sufficiency: 5 ok / 0 needs_attention

## Per-sample Evidence

| sample | candidate preview | package beats | preview -> package match | regen ran | local validation | script chars | sentence count | semantic shadow |
| --- | ---: | ---: | --- | --- | --- | ---: | ---: | --- |
| `hongmenyan` | 3 | 3 | yes | no | pass | 260 | 9 | pass |
| `julu-zhizhan` | 3 | 3 | yes | yes | `regen_once`, `script_body_too_thin` | 160 | 5 | skipped |
| `yanzi-shichu` | 3 | 3 | yes | no | pass | 277 | 13 | pass |
| `yanzi-shichu-repeat-2` | 3 | 3 | yes | yes | `regen_once`, `script_body_too_thin` | 261 | 6 | skipped |
| `zhuanzhu-ciwangliao` | 3 | 3 | yes | yes | `regen_once`, `script_body_too_thin` | 151 | 5 | skipped |

## Observations

- Topic package material remains stable: all five samples have three candidate preview beats, three package beats, and exact preview-to-package match.
- The thin regen prompt contract did not reduce `script_body_too_thin` in this run.
- Three samples triggered `regen_once`, and all three still failed local validation afterward.
- `yanzi-shichu-repeat-2` reached 261 characters, but only six sentences; it failed the sentence-count floor rather than the character floor.
- `julu-zhizhan` and `zhuanzhu-ciwangliao` failed both the practical body target and sentence floor, with 160 and 151 characters.

## Conclusion

The bottleneck is no longer topic package material.

This run suggests the next step should not be another general prompt slogan. We need to inspect the regen input/flow:

- whether `regeneration_context` is actually present on `regen_once`
- whether it includes concrete `script_body_too_thin` metrics
- whether the second writer call receives the previous draft and failed floors clearly enough
- whether the prompt can distinguish character shortfall from sentence-count shortfall

Reviewer remains shadow-only. The skipped semantic reviews are caused by local validation failures and must not be converted into gates.

## Next Focus

Recommended next low-coupling task:

- trace `regen_once` input construction for thin drafts
- add a test proving `regeneration_context` includes the failed validation errors and metric floors
- only then decide whether a code-level input fix is needed

