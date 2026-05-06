# Script writer thin regen expansion contract check

Date: 2026-05-07

Command:

```bash
npm run harness:topic-script-five-round-quality-check -- --output-dir harness/scripts/runtime/output/2026-05-07-script-writer-thin-regen-expansion-contract-check
```

## Summary

This run checks commit `51fdad5`, which tightened only the `script_body_too_thin` regeneration path in `script.writer`.

Result: clear improvement, but still not stable.

- End-to-end live check: 5/5 completed.
- Local validation: 4/5 pass, 1/5 still `script_body_too_thin`.
- Semantic shadow: 4 pass / 1 skipped / 0 attention.
- Topic package sufficiency: 5 ok / 0 needs_attention.

Compared with the previous regen-context run, local pass improved from 3/5 to 4/5 and semantic shadow pass improved from 2/5 to 4/5. The strongest positive signal is `hongmenyan`, which triggered regen and moved from 234 chars / failed to 306 chars / pass.

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

| sample | regen ran | local validation | script chars | sentence count | floor | semantic shadow | manual note |
| --- | --- | --- | ---: | ---: | --- | --- | --- |
| `hongmenyan` | yes | pass | 306 | 10 | 240 chars / 7 sentences | pass | Clear improvement; adds actions, reactions, and consequence without padding. |
| `julu-zhizhan` | yes | pass | 240 | 7 | 240 chars / 7 sentences | pass | Passes exactly at the floor; useful but still too close to the boundary. |
| `yanzi-shichu` | no | pass | 272 | 10 | 240 chars / 7 sentences | pass | Usable scene/dialogue draft. |
| `yanzi-shichu-repeat-2` | no | pass | 320 | 10 | 240 chars / 7 sentences | pass | Strongest body volume in this run. |
| `zhuanzhu-ciwangliao` | yes | `regen_once`, `script_body_too_thin` | 202 | 7 | 240 chars / 7 sentences | skipped | Still compressed; covers action but rushes setup, reaction, and aftermath. |

## Quality Observations

- The targeted regen prompt contract worked on distribution: 4/5 local pass is the best result in this recent sequence.
- No 100-character summary draft appeared.
- `hongmenyan` is the strongest evidence that the writer can use the regen context and expanded contract well.
- `julu-zhizhan` technically passes but lands exactly on the minimum character floor, so the “comfortably above floor” instruction is not yet fully reliable.
- `zhuanzhu-ciwangliao` remains the persistent miss. It has enough sentences, but each sentence is still too compressed. The writer names the setup, strike, death, and aftermath, but does not linger on human reaction or pressure consequences.
- This run still does not justify changing topic contracts: topic package sufficiency remains 5/5 ok.
- Semantic reviewer remains shadow-only. The skipped sample was skipped because local validation failed.

## Manual Layer Conclusion

The script writer has moved closer to the viral first-draft line, but is not stable enough to declare the quality work complete.

- Structural floor: nearly stable, 4/5.
- Oral-story feel: improved on `hongmenyan`, stable on both `yanzi` samples, still compressed on `zhuanzhu`.
- Current bottleneck: one persistent thin-regeneration case, not broad topic insufficiency.

## Next Focus

Recommended next low-coupling task:

- diagnose `zhuanzhu-ciwangliao` specifically by inspecting its topic package and regen interaction log
- confirm whether the writer received `previous_draft` and floor metrics in that run
- if the input is healthy, do not add another broad prompt slogan; instead consider a narrower “assassination/banquet action consequence” expansion note only if it can stay genre-neutral enough for historical story scripts
- keep reviewer patch/lift out of the main chain

