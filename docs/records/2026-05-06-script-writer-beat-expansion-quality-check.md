# Script writer beat expansion quality check

Date: 2026-05-06

Command:

```bash
npm run harness:topic-script-five-round-quality-check -- --output-dir harness/scripts/runtime/output/2026-05-06-script-writer-beat-expansion-quality-check
```

## Summary

This run checks the writer prompt change from commit `dba6486`, which requires every `must_include_beats` item to become a developed narrative unit instead of compressed coverage.

Result: the change helped, but it is not enough to stabilize first-draft quality.

## Harness Result

```json
{
  "status": "five-round-quality-check-completed",
  "total_samples": 5,
  "passed_samples": 5,
  "failed_samples": 0,
  "sample_ready_samples": 5,
  "local_validation_passed_samples": 3,
  "local_validation_failed_samples": 2,
  "semantic_shadow_passed_samples": 2,
  "semantic_shadow_skipped_samples": 2,
  "semantic_shadow_attention_samples": 1,
  "topic_package_sufficiency_ok_samples": 5,
  "topic_package_sufficiency_needs_attention_samples": 0
}
```

Previous comparable run after topic preview confirm-chain fix:

- local validation: 2/5 pass
- semantic shadow: 2 pass / 3 skipped / 0 attention
- topic package sufficiency: 5 ok / 0 needs_attention

Current run:

- local validation: 3/5 pass
- semantic shadow: 2 pass / 2 skipped / 1 attention
- topic package sufficiency: 5 ok / 0 needs_attention

## Per-sample Evidence

| sample | candidate preview | package beats | preview -> package match | local validation | script chars | sentence count | semantic shadow |
| --- | ---: | ---: | --- | --- | ---: | ---: | --- |
| `hongmenyan` | 3 | 3 | yes | pass | 243 | 9 | pass |
| `julu-zhizhan` | 3 | 3 | yes | pass | 247 | 8 | pass |
| `yanzi-shichu` | 3 | 3 | yes | `regen_once`, `script_body_too_thin` | 181 | 5 | skipped |
| `yanzi-shichu-repeat-2` | 3 | 3 | yes | pass | 298 | 12 | `patch_once/lift` attention |
| `zhuanzhu-ciwangliao` | 3 | 3 | yes | `regen_once`, `script_body_too_thin` | 195 | 5 | skipped |

## Observations

- Topic-side material remains healthy: all five samples have three candidate preview beats, three package beats, and exact preview-to-package match.
- The writer prompt change improved local validation from 2/5 pass to 3/5 pass.
- `script_body_too_thin` decreased from 3/5 samples to 2/5 samples.
- The remaining thin drafts still cover three beats in `beat_trace`, but compress them into 181 and 195 characters.
- One local-pass sample received semantic shadow attention: `yanzi-shichu-repeat-2` passed structure at 298 characters, but reviewer shadow reported missing/weak handling of a key 晏子反击情节. Reviewer remains shadow-only and is not a gate.

## Conclusion

The beat-expansion prompt contract is directionally useful, but not sufficient.

Current bottleneck:

- writer still sometimes treats beat coverage as enough
- regen-once does not reliably expand thin drafts into medium-band body
- local structure can pass while semantic shadow still spots weak or missing narrative substance

This should not be fixed with local keyword rules or reviewer-gated patching. The next low-coupling task should stay at writer prompt / regen context level and make thin-draft recovery more explicit.

## Next Focus

Recommended next task:

- tighten writer handling of `regeneration_context`
- when `script_body_too_thin` appears, require the regenerated draft to expand existing beats with new scene/action/reaction material
- forbid solving regen by merely rephrasing or shortening the same coverage

