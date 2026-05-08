# TopicPackage Material Shape For Peak Scene Absorption Design

Date: 2026-05-08

## Background

The anti-label assimilation pass reduced obvious `must_include_beats` label recitation in `script_text`. The five-round GLM-5.1 observation stayed stable:

- total samples: 5
- passed samples: 5
- local validation passed samples: 5
- topic package sufficiency ok samples: 5
- semantic reviewer shadow: 4 pass, 1 patch_once

The remaining quality failures are no longer mainly about the writer copying labels. They are about the material shape handed to the writer:

- `zhuanzhu-ciwangliao` absorbed beat labels, but still skipped the fish-belly assassination peak.
- High-quote `yanzi-shichu` absorbed the dog-gate quote, but did not naturally absorb the second `橘生淮南则为橘` quote intent.
- Current `topic-confirm.service.ts` builds `narrative_tension_map.peak_payoff` from `candidate.strongScene`, which is often a broad scene promise rather than a concrete peak action.

## Goal

Improve `TopicPackage` material shape so the existing script writer can more reliably turn topic material into peak-scene action and quote payoff, without adding a new schema, stage, Brief, local semantic gate, or downstream object.

## Non-Goals

- Do not introduce `ScriptWritingBrief`, `materialization_brief`, `script_brief`, `ScriptBrief`, or any replacement Brief object.
- Do not add local semantic judges, keyword blacklists, field-copy scoring, or automatic semantic gates.
- Do not add storyboard, asset, compose, patch integration, or downstream structures.
- Do not change provider policy or topic selector behavior.
- Do not expand `TopicPackage` schema in this iteration.
- Do not continue piling writer prompt rules.

## Current Weak Point

`TopicPackage` already has useful fields:

- `must_include_beats`
- `strong_scene`
- `canonical_quote_intents`
- `narrative_tension_map.hook_claim`
- `narrative_tension_map.pressure_escalation`
- `narrative_tension_map.mid_reveal`
- `narrative_tension_map.peak_payoff`
- `narrative_tension_map.ending_residue`

The weak point is how those fields are filled during confirmation:

```ts
mid_reveal = previewBeats[1] ?? previewBeats[0] ?? strongScene
peak_payoff = strongScene
ending_residue = previewBeats[2] ?? previewBeats[1] ?? coreConflict
```

This keeps the object valid, but it lets `peak_payoff` stay too generic. A generic `strong_scene` such as “鱼腹藏剑改变吴国权力” does not force the writer to stage the concrete moment: fish is served, blade appears, Wang Liao is struck, the room breaks open.

## Recommended Approach

Use the existing `must_cover_preview` and `narrative_tension_map` fields as a positional material contract.

### `must_cover_preview` Order

The topic candidate builder should treat `must_cover_preview` as three ordered narrative nodes:

1. Entry pressure: the scene or pressure source that puts the protagonist into danger, humiliation, choice, or trap.
2. Peak action/payoff: the concrete action, confrontation, reversal, quote strike, or assassination moment the audience is waiting for.
3. Cost/residue: the immediate consequence, cost, unresolved aftershock, or second quote payoff.

This is not a new schema. It is a stricter meaning for an existing array field.

### Topic Confirmation Mapping

When freezing `TopicPackage`, use the ordered preview material this way:

- `must_include_beats`: preserve the deduplicated `must_cover_preview` nodes.
- `narrative_tension_map.mid_reveal`: prefer the first preview node.
- `narrative_tension_map.peak_payoff`: prefer the second preview node.
- `narrative_tension_map.ending_residue`: prefer the third preview node.
- `stakes`: combine `core_conflict` with the third preview node when available, otherwise fall back to the peak node.

This gives the writer a concrete peak target without creating a new outline object.

### Quote Intent Absorption

Do not require every `canonical_quote_intent` to become a local gate. Instead:

- Preserve `canonical_quote_intents` exactly.
- Make the candidate-builder prompt say that high-quote topics should put quote payoff into the ordered preview nodes when the quote is central to the selected angle.
- For two-quote topics, the second quote can naturally live in the third preview node as cost/residue or second reversal.

This keeps quote absorption as material shaping, not local semantic policing.

## Alternatives Considered

### A. Only Update The Writer Prompt

Rejected. The previous iteration already showed writer prompt consolidation helps with label leakage but not with missing peak action. More writer prompt lines would likely have diminishing returns.

### B. Add A New Peak Scene Schema

Rejected for this iteration. A new `peak_scene_contract` or `quote_payoff_map` would be expressive, but it expands shared schema, API, persistence, and prompt surfaces. The current fields are sufficient for one more small iteration.

### C. Positional Material Shape In Existing Fields

Recommended. It changes the meaning and mapping of existing fields without changing the pipeline shape. It is small enough to test with focused unit tests and one live five-round observation.

## Measurement

Automated checks:

- Prompt-runtime tests should prove the ordered `must_cover_preview` contract exists.
- Topic-confirm tests should prove `peak_payoff` freezes from the peak preview node, not from generic `strong_scene`.
- Existing topic/script runtime tests should keep passing.
- No Brief-like surface should be introduced.

Live observation:

- Run the existing five-round GLM-5.1 `topic -> script` quality harness.
- Record local validation, topic sufficiency, semantic reviewer shadow distribution, and manual notes.
- Compare specifically:
  - whether `zhuanzhu-ciwangliao` includes the fish-belly assassination peak,
  - whether `yanzi-shichu` better absorbs quote payoff,
  - whether label leakage remains low.

## Stop Criteria

Stop this optimization path if:

- The solution requires a new schema or new runtime stage.
- The implementation starts classifying semantic quality locally.
- The five-round result still misses peak action despite the peak preview node being present.
- The fix becomes a writer prompt pile-up instead of TopicPackage material shaping.

If that happens, the next review should focus on topic candidate sample quality or selected sample ergonomics, not another local validator.
