# TopicPackage Opening Pressure Ending Material Shape Design

Date: 2026-05-08

## Background

The previous TopicPackage material-shape pass improved peak-scene absorption:

- 5/5 samples reached `sample-ready`.
- 5/5 samples passed local validation.
- 5/5 samples had TopicPackage sufficiency `ok`.
- semantic reviewer shadow reported 4 `pass` and 1 `patch_once`.

The generated scripts now look like short-video historical story drafts instead of plain historical explanations. The remaining gap is not mainly writer structure or label leakage. It is the sharpness of the story material handed to the writer:

- openings often start with a regular question instead of throwing the viewer into a concrete humiliation, danger, or loss frame;
- mid-body explanation can flatten complex motives into a simple "爽文" cause;
- endings sometimes become modern summary slogans rather than story-internal aftershocks.

This design responds to the external review notes while preserving the current project boundary: no Brief revival, no new runtime stage, no new schema, no local semantic gate.

## Goal

Improve the existing `TopicPackage` material shape so the script writer receives clearer opening pressure, pressure-chain logic, and story-internal ending residue through existing fields.

## Non-Goals

- Do not introduce `storyBrief`, `scriptBrief`, `openingEndingPlan`, `ScriptBrief`, `materialization_brief`, or any renamed Brief-like object.
- Do not add a new runtime stage between topic and script.
- Do not add new `TopicPackage` schema fields.
- Do not add local semantic validation, keyword blacklists, copy scoring, or automatic semantic gates.
- Do not change topic selector semantics, provider policy, UI, downstream, storyboard, asset, or compose.
- Do not make `script.writer.prompt.md` heavier in this iteration.

## Current Shape

The current candidate-builder contract already gives `must_cover_preview` three ordered nodes:

1. entry pressure;
2. peak action or climax payoff;
3. cost, residue, or second quote echo.

Topic confirmation currently maps them into existing fields:

- `mid_reveal`: first preview node;
- `peak_payoff`: second preview node;
- `ending_residue`: third preview node;
- `pressure_escalation`: `core_conflict + first preview node`;
- `hook_claim`: `oneLineAngle`;
- `stakes`: `core_conflict + third preview node`.

That is enough to carry peak action, but not yet enough to make the opening and ending reliably sharp.

## Alternatives Considered

### A. Add `openingEndingPlan`

Rejected. It would be expressive, but it is a new intermediate planning object and would reopen the Brief route that was intentionally stopped. It also increases runtime surface area before we have exhausted existing `TopicPackage` fields.

### B. Add New TopicPackage Fields

Rejected for this pass. Fields like `opening_pressure`, `pressure_chain`, or `ending_mode` would be clean, but they require shared schema, persistence, API, prompt, and tests. The current fields can carry one more small material-shape iteration.

### C. Refine Existing Field Semantics

Recommended. Keep the three-node `must_cover_preview`, but make each node more specific:

- first node: concrete opening pressure;
- second node: peak action, reversal, quote strike, or decision fracture;
- third node: story-internal residue type, not an abstract slogan.

Then tune existing `TopicPackage` mapping so the writer sees:

- `hook_claim` anchored to the first preview node plus selected angle;
- `pressure_escalation` as conflict plus the first two preview nodes;
- `ending_residue` and `stakes` anchored to the third preview node.

This keeps the implementation small and testable.

## Proposed Contract

### Candidate Builder Prompt

Update the existing `must_cover_preview` wording instead of adding a new prompt block.

The three nodes should mean:

1. **Opening pressure**: a concrete scene with actor, forcing action, and what is about to be lost. It should avoid generic question hooks such as "他该怎么办" and avoid abstract labels such as "尊严受到挑战" unless the physical action is present.
2. **Peak or pressure turn**: the concrete action, quote strike, assassination moment, command, refusal, or decision fracture that changes the situation.
3. **Story-internal aftershock**: a consequence, cost, ironic reversal, power price, character crack, later historical result, or famous-scene callback. It should avoid standalone modern slogans.

For high-explanation topics such as 鸿门宴, the second node may be a decision fracture rather than a physical action:

- 范增频频举玦催杀，项羽为了霸主姿态迟迟不令；
- 刘邦把自己压成已经认输的人，让项羽杀他也不体面。

This is still material shaping, not a local semantic judgment.

### Topic Confirmation Mapping

Use existing fields only:

- `hook_claim`: combine the first preview node and selected angle in one short sentence. This gives the writer an opening pressure source without forcing it to copy a finished line.
- `pressure_escalation`: combine `core_conflict`, first preview node, and second preview node. This makes the pressure chain visible before the writer reaches the peak.
- `mid_reveal`: keep the first preview node.
- `peak_payoff`: keep the second preview node.
- `ending_residue`: keep the third preview node.
- `stakes`: combine `core_conflict` and the third preview node, preserving the story's consequence.

Do not classify ending types in code. The candidate-builder prompt can ask the LLM to express the third node as one of these story-internal shapes: fate irony, power cost, character crack, later consequence, or famous-scene callback.

## Expected Effect

This should improve:

- openings: more concrete first-frame pressure, fewer generic question hooks;
- explanations: more visible pressure logic, especially for non-action topics;
- endings: fewer detached motivational slogans, more consequence or irony from the story itself.

It should not attempt to guarantee:

- viral performance;
- full historical nuance;
- fact checking beyond current source anchors;
- semantic quality through local code.

## Measurement

Automated checks:

- prompt-runtime test proves the three-node contract mentions opening pressure, pressure turn, and story-internal aftershock;
- topic-confirm test proves `hook_claim` and `pressure_escalation` absorb the first two preview nodes without adding fields;
- no-Brief guard remains passing;
- existing topic and script runtime tests remain passing.

Live observation:

- run the same five-round GLM-5.1 topic-script harness;
- record sample-ready, local validation, TopicPackage sufficiency, semantic shadow, and manual notes;
- judge whether openings are sharper, explanations are less flattened, and endings are more story-internal.

## Stop Criteria

Stop this path if:

- the design needs a new schema or runtime planner;
- the implementation starts doing local semantic classification;
- prompt wording grows by additive piling rather than replacing older loose wording;
- five-round observation shows no improvement in opening sharpness or ending aftershock.

If it fails, the next review should move to source material selection and topic sample ergonomics, not another writer prompt iteration.
