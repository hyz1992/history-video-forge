# Zhuanzhu thin regen diagnosis

Date: 2026-05-07

Related run:

```bash
npm run harness:topic-script-five-round-quality-check -- --output-dir harness/scripts/runtime/output/2026-05-07-script-writer-thin-regen-expansion-contract-check
```

Sample: `zhuanzhu-ciwangliao`

## Question

Why did `zhuanzhu-ciwangliao` still fail local validation with `script_body_too_thin` after the thin-regen expansion contract was tightened?

## Evidence

Final local validation:

```json
{
  "decision": "regen_once",
  "errors": ["script_body_too_thin"],
  "metrics": {
    "script_char_count": 202,
    "script_sentence_count": 7,
    "min_script_chars_for_band": 240,
    "min_sentence_count_for_band": 7
  }
}
```

Graph trace shows `regen-once` did run:

- `script-generate`
- `local-validate`
- `regen-once`
- `local-validate`

The second writer call did receive the expected regen context:

- `errors`: `script_body_too_thin`
- `metrics.script_char_count`: 202
- `metrics.min_script_chars_for_band`: 240
- `metrics.script_sentence_count`: 7
- `metrics.min_sentence_count_for_band`: 7
- `previous_draft.script_text_excerpt`: present
- `previous_draft.beat_trace_summary`: present for all 3 beats

The second writer prompt also contained the tightened contract:

- cannot merely land on the floor
- should be clearly above `min_script_chars_for_band`
- each beat should add at least one action, one reaction, and one consequence
- must not be a slightly longer compressed summary

The decisive finding: raw model output from `01-script.writer.md` and `02-script.writer.md` was byte-for-byte identical in extracted text blocks.

```json
{
  "same": true,
  "firstLength": 641,
  "secondLength": 641
}
```

## Topic Material

The topic package is structurally sufficient but sparse:

- `strong_scene`: `鱼腹藏剑，专诸在席间暴起。`
- `core_conflict`: `动手只有一次机会，失手就是全盘皆输。`
- `must_include_beats`:
  - 公子光设宴邀请王僚，专诸伪装献鱼进入宴会现场
  - 专诸在献鱼时突然拔出藏在鱼腹中的短剑刺向王僚
  - 专诸当场被卫士杀死，但王僚已死，公子光成功夺权
- `canonical_quotes`: none

This is enough to keep the script on-topic, but it gives the writer very little concrete sensory or reaction material beyond the event skeleton.

## Current Draft Shape

The final draft covers all beats, but each beat stays compressed:

- setup: public banquet, disguised cook, fish with hidden sword
- strike: Wang Liao tastes the fish, Zhuanzhu attacks
- aftermath: guards kill Zhuanzhu, Wang Liao dies, Gongzi Guang takes power

Missing expansion opportunities that would remain within contract:

- Wang Liao or guards noticing the fish being presented
- the beat before the sword is revealed
- the immediate chaos after the strike
- Gongzi Guang waiting for the attack to land
- the cost of Zhuanzhu dying even though the coup succeeds

## Diagnosis

This is not a runtime-input bug. The regen path passed the right context, the previous draft, and the updated prompt.

This is also not enough evidence to shift the whole focus back to topic quality. The topic package is sparse, but valid; other samples improved with the same runtime path.

The narrow failure is that the writer can ignore thin-regen instructions and return the same compressed draft when the topic material is event-skeleton-like and lacks concrete reaction anchors.

## Recommended Next Step

Do not add another broad prompt slogan.

Recommended low-coupling implementation task:

- add a code-level diagnostic guard for `regen_once` only: when the regenerated draft is still structurally thin and its `script_text` is unchanged from the previous draft, surface a specific runtime diagnostic such as `regen_output_unchanged_after_thin_context`
- keep it observational; do not add another automatic retry
- add a test proving the diagnostic is emitted
- then decide whether a later design should introduce a second-stage recovery, prompt variant, or topic-material enrichment

Reviewer remains shadow-only. Patch/lift must stay out of the main chain.

