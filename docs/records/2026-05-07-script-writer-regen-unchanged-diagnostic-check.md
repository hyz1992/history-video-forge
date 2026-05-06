# Script writer regen unchanged diagnostic check

Date: 2026-05-07

Command:

```bash
npm run harness:topic-script-five-round-quality-check -- --output-dir harness/scripts/runtime/output/2026-05-07-script-writer-regen-unchanged-diagnostic-check
```

## Summary

This run checks commit `a915ca6`, which added the observational runtime diagnostic
`regen_output_unchanged_after_thin_context`.

Result: the new diagnostic did not trigger in the live 5-sample run.

That is useful signal. The persistent failing sample is still `zhuanzhu-ciwangliao`,
but this time the failure is not the exact "regen returned unchanged text" case.
The writer did run `regen-once`, changed the draft, and still landed below the
structural body floor.

## Harness Result

```json
{
  "status": "five-round-quality-check-completed",
  "total_samples": 5,
  "passed_samples": 5,
  "failed_samples": 0,
  "sample_ready_samples": 5,
  "local_validation_passed_samples": 4,
  "local_validation_failed_samples": 1,
  "semantic_shadow_passed_samples": 4,
  "semantic_shadow_skipped_samples": 1,
  "semantic_shadow_attention_samples": 0,
  "topic_package_sufficiency_ok_samples": 5,
  "topic_package_sufficiency_needs_attention_samples": 0
}
```

## Per-sample Evidence

| sample | regen ran | local validation | script chars | sentence count | floor | semantic shadow | runtime diagnostic note |
| --- | --- | --- | ---: | ---: | --- | --- | --- |
| `yanzi-shichu` | no | pass | 240 | 9 | 240 chars / 7 sentences | pass | no regen diagnostic |
| `zhuanzhu-ciwangliao` | yes | `regen_once`, `script_body_too_thin` | 195 | 8 | 240 chars / 7 sentences | skipped | no `regen_output_unchanged_after_thin_context` |
| `julu-zhizhan` | yes | pass | 295 | 8 | 240 chars / 7 sentences | pass | no regen diagnostic |
| `hongmenyan` | no | pass | 289 | 13 | 240 chars / 7 sentences | pass | no regen diagnostic |
| `yanzi-shichu-repeat-2` | no | pass | 249 | 7 | 240 chars / 7 sentences | pass | no regen diagnostic |

## Diagnostic Observation

For `zhuanzhu-ciwangliao`, `runtime-diagnostics.json` contained:

```json
{
  "checks": [
    { "code": "topic_candidate_generate_passed", "level": "info" },
    { "code": "topic_candidate_slot_guard_passed", "level": "info" },
    { "code": "semantic_review_skipped", "level": "warning" }
  ]
}
```

The graph trace confirms the expected path:

- `topic-candidate-generate`
- `script-generate`
- `local-validate`
- `regen-once`
- `local-validate`

Final local validation for `zhuanzhu-ciwangliao`:

```json
{
  "decision": "regen_once",
  "errors": ["script_body_too_thin"],
  "metrics": {
    "script_char_count": 195,
    "script_sentence_count": 8,
    "min_script_chars_for_band": 240,
    "min_sentence_count_for_band": 7
  }
}
```

## Conclusion

The added diagnostic is working as a narrower probe, but this live run did not
hit that exact failure shape.

The current bottleneck is more precise now:

- not broad topic-package sufficiency: 5/5 topic packages are still `ok`
- not semantic reviewer behavior: reviewer remains shadow-only and was skipped
  only because local validation failed
- not exact regen-output repetition in this run
- still a writer density problem on sparse assassination material, where regen
  adds or changes text but does not add enough scene pressure, reaction, or
  aftermath to clear the body floor

## Recommended Next Step

Do not add another broad prompt slogan and do not wire patch/lift into the main
chain.

Recommended next low-coupling task:

- add a narrow writer contract for thin regen on sparse event-skeleton material:
  when no quotes are available and the draft is still below the body floor, each
  required beat must be expanded with one concrete pre-action, one immediate
  reaction, and one consequence sentence
- keep it short and framed as expansion of existing beats, not extra facts
- prove it with a prompt contract test before editing the prompt
- rerun the fixed 5-round quality check after the prompt change

