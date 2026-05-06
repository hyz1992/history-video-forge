# Script writer sparse thin regen contract check

Date: 2026-05-07

Command:

```bash
npm run harness:topic-script-five-round-quality-check -- --output-dir harness/scripts/runtime/output/2026-05-07-script-writer-sparse-thin-regen-contract-check
```

## Summary

This run checks commit `4a343b3`, which added a narrow sparse-material thin-regeneration
contract to `script.writer`.

Result: regression. Do not treat this prompt change as proven effective.

- End-to-end live check: 5/5 completed.
- Local validation: 1/5 pass, 4/5 still `script_body_too_thin`.
- Semantic shadow: 1 pass / 4 skipped / 0 attention.
- Topic package sufficiency: 4 ok / 1 needs_attention.

The important quality note is that the failure is not simply "word count is low,
therefore bad." Some drafts, especially `hongmenyan`, have stronger scene texture
than a summary, but still miss the structural body floor. The goal remains oral
story quality; body volume is only a lower-bound indicator.

## Harness Result

```json
{
  "status": "five-round-quality-check-completed",
  "total_samples": 5,
  "passed_samples": 5,
  "failed_samples": 0,
  "sample_ready_samples": 5,
  "local_validation_passed_samples": 1,
  "local_validation_failed_samples": 4,
  "semantic_shadow_passed_samples": 1,
  "semantic_shadow_skipped_samples": 4,
  "semantic_shadow_attention_samples": 0,
  "topic_package_sufficiency_ok_samples": 4,
  "topic_package_sufficiency_needs_attention_samples": 1
}
```

## Per-sample Evidence

| sample | regen ran | local validation | script chars | sentence count | floor | semantic shadow | quality note |
| --- | --- | --- | ---: | ---: | --- | --- | --- |
| `yanzi-shichu` | yes | `regen_once`, `script_body_too_thin` | 199 | 10 | 240 chars / 7 sentences | skipped | Has dialogue, but ending repeats the same completion idea and the body is too compressed. |
| `zhuanzhu-ciwangliao` | yes | `regen_once`, `script_body_too_thin` | 230 | 6 | 240 chars / 7 sentences | skipped | Better than earlier 195-char summaries, with banquet setup and strike, but still short and ends with broad history phrasing. |
| `julu-zhizhan` | yes | `regen_once`, `script_body_too_thin` | 186 | 6 | 240 chars / 7 sentences | skipped | Covers pressure and decision, but remains an event skeleton rather than a full oral scene. |
| `hongmenyan` | yes | `regen_once`, `script_body_too_thin` | 222 | 8 | 240 chars / 7 sentences | skipped | Scene quality is relatively good: body reaction, sword pressure, hesitation, and consequence. It is still below floor and topic sufficiency flagged repetition risk. |
| `yanzi-shichu-repeat-2` | yes | pass | 252 | 8 | 240 chars / 7 sentences | pass | Best sample in this run; dialogue creates pressure without obvious padding. |

## Diagnostics

`julu-zhizhan` emitted:

```json
{
  "code": "regen_output_unchanged_after_thin_context",
  "level": "warning"
}
```

This confirms the earlier observational diagnostic can catch one failure mode:
thin regeneration returning unchanged text.

`zhuanzhu-ciwangliao` also emitted topic candidate diagnostics:

```json
[
  { "code": "topic_candidate_duplicate_removed", "level": "info" },
  { "code": "topic_candidate_slots_insufficient", "level": "error" }
]
```

That does not make the script failure a reviewer or patch issue. Reviewer remained
shadow-only, and skipped samples were skipped because local validation did not pass.

## Quality Assessment

The sparse-material prompt addition did not stabilize the first draft line.

What improved:

- Some outputs show more concrete scene texture than the older compressed summaries.
- `zhuanzhu-ciwangliao` moved closer to the floor than the earlier 195-char run.
- `yanzi-shichu-repeat-2` passed with usable dialogue pressure.

What got worse or stayed weak:

- Distribution regressed from 4/5 local pass to 1/5 local pass.
- Several drafts still treat the final sentence as broad historical commentary.
- The prompt phrase "不能添加额外事实" may have made the writer too conservative
  when `quote_trace` is empty, reducing expansion instead of encouraging safe
  scene-level detail.
- Passing the floor is not enough anyway; the real target is still action,
  reaction, pressure escalation, and ending residue without padding.

## Conclusion

Do not continue stacking stricter prompt slogans.

Current hypothesis: the sparse-material clause is directionally right, but the
"不能添加额外事实" wording is too constraining. It should distinguish between
forbidden factual invention and allowed non-contradictory scene realization.

## Recommended Next Step

Run one low-coupling prompt correction:

- replace "不能添加额外事实" with a clearer boundary:
  "不得新增人物、事件、结局或改写因果；可以补原场景内不改变事实的动作、反应、停顿、目光、场面压力"
- keep the change short
- prove with a prompt contract test
- rerun the same 5-round quality check afterward

