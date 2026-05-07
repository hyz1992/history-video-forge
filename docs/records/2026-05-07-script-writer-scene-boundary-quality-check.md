# Script writer scene boundary quality check

Date: 2026-05-07

Command:

```bash
npm run harness:topic-script-five-round-quality-check -- --output-dir harness/scripts/runtime/output/2026-05-07-script-writer-scene-boundary-quality-check
```

## Summary

This run checks commit `15d9fa2`, which changed the sparse-material thin-regeneration
boundary from a broad "do not add extra facts" rule to a clearer distinction:

- do not add people, events, endings, or causal changes
- do allow scene-internal actions, reactions, pauses, looks, and pressure that do
  not change the facts

Result: strong recovery from the previous regression, with important quality caveats.

- End-to-end live check: 5/5 completed.
- Local validation: 5/5 pass.
- Semantic shadow: 5 pass / 0 skipped / 0 attention.
- Topic package sufficiency: 5 ok / 0 needs_attention.

This should not be read as "word count solved quality." The improvement is that
several drafts now use body volume for scene realization: pressure, action,
reaction, and immediate consequence. There are still ending-quality issues in
some samples.

## Harness Result

```json
{
  "status": "five-round-quality-check-completed",
  "total_samples": 5,
  "passed_samples": 5,
  "failed_samples": 0,
  "sample_ready_samples": 5,
  "local_validation_passed_samples": 5,
  "local_validation_failed_samples": 0,
  "semantic_shadow_passed_samples": 5,
  "semantic_shadow_skipped_samples": 0,
  "semantic_shadow_attention_samples": 0,
  "topic_package_sufficiency_ok_samples": 5,
  "topic_package_sufficiency_needs_attention_samples": 0
}
```

## Per-sample Evidence

| sample | regen ran | local validation | script chars | sentence count | quote trace | semantic shadow | quality note |
| --- | --- | --- | ---: | ---: | ---: | --- | --- |
| `yanzi-shichu` | no | pass | 375 | 13 | 0 | pass | Strong dialogue density and pressure. Ending stops on the rhetorical counter, which is better than broad praise. Some dialogue may still feel over-elaborated. |
| `zhuanzhu-ciwangliao` | yes | pass | 261 | 8 | 0 | pass | Clear recovery: banquet setup, guard check, strike, blood, counteraction. Ending still uses broad "history assassin list" phrasing. |
| `julu-zhizhan` | yes | pass | 249 | 9 | 0 | pass | Improved from unchanged-thin failure: includes siege pressure, command, soldier reaction, and consequence. Some phrasing remains conventional. |
| `hongmenyan` | no | pass | 343 | 12 | 0 | pass | Good oral-scene draft: sweat, sword pressure, hesitation, escape, and consequence. Ending has residue, though still partly "changed history" style. |
| `yanzi-shichu-repeat-2` | yes | pass | 357 | 12 | 3 | pass | Uses quotes and pressure well, but final sentence turns into broad diplomatic praise and is weaker than the scene body. |

## Diagnostics

No sample emitted `regen_output_unchanged_after_thin_context` in this run.

Runtime diagnostics were limited to expected topic candidate info and
`semantic_review_passed`. This indicates the previous unchanged-thin failure mode
did not recur in this sample set.

## Quality Assessment

What improved:

- The previous 1/5 local-pass regression recovered to 5/5.
- `zhuanzhu-ciwangliao` crossed the body floor and gained scene-internal pressure
  without changing the formal event contract.
- `julu-zhizhan` no longer repeated an unchanged thin draft; it added reaction and
  consequence around the破釜沉舟 decision.
- `hongmenyan` is closer to the target oral-story first draft: action, body
  reaction, hesitation, and outcome are all present.

What remains insufficient:

- Passing local validation is still only the structural floor.
- Some endings still drift toward broad evaluation:
  - "刻在了历史的刺客名录中"
  - "展现了外交官在公开场合捍卫国家尊严的典范"
- Some body expansion is useful but still conventional; it needs sharper
  judgment, cost, or residue to reach a stronger viral first-draft line.
- The run is positive but still one live sample set. It should guide the next
  small task, not close the quality work.

## Conclusion

The scene-boundary correction appears to fix the immediate over-constraining
problem from the prior prompt wording. It restored structural pass distribution
and improved several drafts by allowing safe scene realization instead of
overly conservative summary.

The current bottleneck is no longer simply "too short." The next quality gap is
ending residue and judgment: several drafts can now produce enough scene body,
but still close with generic historical praise.

Reviewer remains shadow-only. This result does not justify wiring patch/lift into
the main chain.

## Recommended Next Step

Do not add more body-length pressure.

Recommended low-coupling next task:

- add a narrow prompt contract test for `ending_span`
- require endings to close on cost, irony, unresolved consequence, or judgment
  from the scene
- forbid generic "changed history / became a model / went down in history" style
  praise as the default ending
- keep this as a short ending rule, not a broad new slogan
- rerun the fixed 5-round quality check afterward

