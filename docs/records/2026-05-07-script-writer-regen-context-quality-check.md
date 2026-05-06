# Script writer regen context quality check

Date: 2026-05-07

Command:

```bash
npm run harness:topic-script-five-round-quality-check -- --output-dir harness/scripts/runtime/output/2026-05-07-script-writer-regen-context-quality-check
```

## Summary

This run checks commit `300fdc8`, which made `regen_once` pass local validation errors, structural metrics, and a previous-draft summary back into the second `script.writer` call.

Result: partial improvement, not a complete fix.

- End-to-end live check: 5/5 completed.
- Local validation: 3/5 pass, 2/5 still `script_body_too_thin`.
- Semantic shadow: 2 pass / 2 skipped / 1 attention.
- Topic package sufficiency: 5 ok / 0 needs_attention.

Compared with the previous thin-regen run, local pass improved from 2/5 to 3/5. The clearest positive signal is `julu-zhizhan`: it triggered `regen_once` and crossed the structural floor after regeneration. The remaining failures show that context alone is not enough to reliably force the writer to expand thin drafts.

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

## Per-sample Evidence

| sample | regen ran | local validation | script chars | sentence count | floor | semantic shadow | manual note |
| --- | --- | --- | ---: | ---: | --- | --- | --- |
| `hongmenyan` | yes | `regen_once`, `script_body_too_thin` | 234 | 7 | 240 chars / 7 sentences | skipped | Near the floor but still short; concise, not padded. |
| `julu-zhizhan` | yes | pass | 246 | 9 | 240 chars / 7 sentences | `patch_once`, `lift` | Regen crossed the floor; reviewer wanted stronger scene detail. |
| `yanzi-shichu` | no | pass | 288 | 10 | 240 chars / 7 sentences | pass | Usable first draft, dialogue-heavy. |
| `yanzi-shichu-repeat-2` | no | pass | 315 | 12 | 240 chars / 7 sentences | pass | Strongest sample in this run; scene and dialogue are clearer. |
| `zhuanzhu-ciwangliao` | yes | `regen_once`, `script_body_too_thin` | 214 | 9 | 240 chars / 7 sentences | skipped | Covers action, but still too compressed. |

## Quality Observations

- The regen-context code fix is useful but insufficient. It improved at least one thin sample (`julu-zhizhan`) from failed distribution to pass, but two regen samples still ended below the character floor.
- The two remaining failures are not obvious padding failures. They are compact story summaries with some action, but they stop too early instead of developing consequences and reactions.
- `hongmenyan` missed by only 6 characters, which suggests the model understood the structure but did not treat the floor as a hard enough expansion target.
- `zhuanzhu-ciwangliao` is the more meaningful miss: it has 9 sentences but only 214 characters, so the problem is not sentence count; each sentence is too compressed.
- `julu-zhizhan` crossed the floor after regen, but semantic shadow still requested `patch_once/lift` for stronger scene detail. This should remain observation only and must not drive automatic patch integration.
- Topic package sufficiency remains healthy. This run does not support shifting blame back to topic material.

## Manual Layer Conclusion

Current state is still between usable-line and viral first-draft-line.

- Structural availability improved: 3/5 local pass, and no 100-character summary draft appeared.
- Viral first-draft quality is not stable: only about 2/5 clearly approach the desired oral-story feel.
- The main remaining issue is not topic quality and not reviewer gating. It is writer expansion behavior under thin-draft regeneration.

## Next Focus

Recommended next low-coupling task:

- tighten only the regeneration path contract so `script_body_too_thin` means “expand to comfortably above the floor,” not “barely rephrase the same draft”
- keep the rule short and specific
- do not add local keyword checks
- do not wire reviewer patch/lift into the main chain
- after that, rerun the same 5-round check and compare the two remaining thin samples

