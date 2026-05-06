# Topic preview confirm chain quality check

Date: 2026-05-06

Command:

```bash
npm run harness:topic-script-five-round-quality-check -- --output-dir harness/scripts/runtime/output/2026-05-06-topic-preview-confirm-chain-quality-check
```

## Summary

This check validates the two recent topic-side fixes:

- candidate normalization no longer emits empty `must_cover_preview`
- recommendation -> confirm now carries `must_cover_preview` into `TopicPackage.must_include_beats`

Result: the upstream topic package material issue is improved, but the full topic -> script first-draft chain is not yet improved end to end.

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
  "topic_package_sufficiency_observe_samples": 0,
  "topic_package_sufficiency_needs_attention_samples": 0
}
```

Previous comparable run:

- `sample_ready`: 5/5
- local validation: 5/5 pass
- semantic shadow: 5/5 pass
- topic package sufficiency: 0 ok / 0 observe / 5 needs_attention

Current run:

- `sample_ready`: 5/5
- local validation: 2/5 pass
- semantic shadow: 2/5 pass, 3/5 skipped because local validation did not pass
- topic package sufficiency: 5 ok / 0 observe / 0 needs_attention

## Per-sample Evidence

| sample | candidate preview | package beats | preview -> package match | local validation | script chars | sentence count | semantic shadow |
| --- | ---: | ---: | --- | --- | ---: | ---: | --- |
| `hongmenyan` | 3 | 3 | yes | `regen_once`, `script_body_too_thin` | 197 | 10 | skipped |
| `julu-zhizhan` | 3 | 3 | yes | pass | 240 | 8 | pass |
| `yanzi-shichu` | 3 | 3 | yes | pass | 325 | 12 | pass |
| `yanzi-shichu-repeat-2` | 3 | 3 | yes | `regen_once`, `script_body_too_thin` | 161 | 6 | skipped |
| `zhuanzhu-ciwangliao` | 3 | 3 | yes | `regen_once`, `script_body_too_thin` | 189 | 6 | skipped |

All five selected candidates had three `must_cover_preview` beats. All five confirmed topic packages had three `must_include_beats`, and the package beats matched the selected candidate preview.

## Conclusion

The topic-side material sufficiency fix worked:

- the selected candidate now carries script-writable preview beats
- confirm preserves those beats into the topic package
- the sufficiency observer moved from 5/5 `needs_attention` to 5/5 `ok`

The full first-draft quality did not improve end to end in this run:

- three scripts still failed local structural validation
- the failure reason was `script_body_too_thin`
- failed scripts did cover the three beats, but compressed them too aggressively

## Next Focus

The next low-coupling task should move back to the script writer, not the topic package:

- tighten the writer contract so medium-band drafts expand covered beats into enough scene/action/dialogue body
- avoid asking for filler or word-count padding
- keep the constraint structural and prompt-level; do not add local semantic keyword checks

