# Script Writer Anti-Label Assimilation Design

Date: 2026-05-08

## Background

The strict structured provider work made GLM-5.1 usable for the `topic.selector` pilot. The five-round GLM-5.1 check passed the runtime chain:

- total samples: 5
- passed samples: 5
- local validation passed samples: 5
- topic package sufficiency ok samples: 5
- semantic reviewer shadow: 2 `pass`, 3 `patch_once`

This changes the current quality question. The provider and upstream topic package are no longer the immediate blocker. The remaining issue is the conversion from `TopicPackage` material into natural `script_text`.

Observed residual problems:

- `script_text` sometimes copies `must_include_beats` as explanatory labels instead of absorbing them into action, reaction, and pressure.
- Peak moments can be structurally covered but still summarized too quickly.
- High-quote topics, especially `yanzi-shichu`, can cover the dog-gate conflict while failing to naturally include the second quote thread.

## Prior Attempt To Avoid

Commit `b313d44f2cc358e7cd2b330bfaa6e6626fbed6bb` stopped the `ScriptWritingBrief` shadow path. That attempt produced no valid brief artifacts and crossed runtime boundaries by emitting script and downstream planning fields.

This design must not repeat that path.

Do not introduce:

- `ScriptWritingBrief`
- a new script brief schema
- a new intermediate runtime stage between topic and script
- a local materialization judge
- a downstream planning object

## Design Goals

1. Reduce beat-label leakage in `script_text`.
2. Keep `beat_trace.beat` as exact audit data while making `script_text` read like spoken historical narrative.
3. Preserve local validation as structural only.
4. Keep the semantic reviewer shadow-only.
5. Make one small prompt-contract iteration, then measure. If it does not help, stop prompt tweaking.

## Non-Goals

- Do not change `topic.selector`, topic candidate building, topic confirmation, or provider policy.
- Do not change writer/reviewer into a multi-agent or multi-draft workflow.
- Do not restore Script Brief or create a replacement brief under another name.
- Do not add local semantic validation, keyword blacklists, field-copy scoring, or automatic semantic gates.
- Do not add downstream objects for storyboard, asset, compose, or patch integration.
- Do not relax the script schema or topic package schema for GLM-5.1.

## Recommended Approach

Use a narrow "anti-label assimilation" pass on the existing writer prompt and observation harness.

The implementation should consolidate existing writer prompt rules instead of adding many new ones. The desired contract is:

- `beat_trace.beat` is the audit field and must reuse the input beat exactly.
- `script_text` is the spoken draft and must not recite beat text as labels or checklist items.
- Each beat should become a short narrative unit with at least one concrete action, reaction, pressure change, or consequence.
- `beat_trace.excerpt` must be cut from natural script prose, not from a copied beat label.
- `canonical_quote_intents` should be honored through scene purpose and payoff, not pasted as detached explanation.

This should replace or merge overlapping prompt lines where possible. The net prompt should become clearer, not heavier.

## Alternatives Considered

### A. Add a New Script Brief

Rejected. This repeats the path stopped by `b313d44f2cc358e7cd2b330bfaa6e6626fbed6bb`. It increases schema surface area, creates another place for model drift, and risks downstream leakage.

### B. Add Local Field-Copy Detection

Rejected for the main path. Even if implemented as a string heuristic, it would drift toward local semantic policing and could produce false confidence. Manual quality records may note label leakage, but local code must not gate or repair semantic quality.

### C. Consolidate Writer Contract And Observe

Recommended. It keeps the system shape stable, targets the current failure mode, and gives a clear stop rule. It also respects the existing evidence that repeated prompt piling has limited marginal return.

## Measurement

Automated checks:

- Prompt/runtime tests must prove the concise audit/prose boundary exists.
- Existing script runtime tests must keep passing.
- Existing Brief-stopped guard must keep passing.

Live observation:

- Run the established five-round `topic -> script` quality harness with GLM-5.1.
- Record local validation count, topic sufficiency count, semantic reviewer shadow distribution, and manual notes on beat-label leakage.

Success is not "all semantic reviewer pass". Success for this iteration is:

- local validation remains 5/5
- topic package sufficiency remains stable
- no new schema/runtime drift appears
- manual observation shows less beat-label leakage or better peak-scene absorption than the previous GLM-5.1 five-round record

If the five-round result still shows obvious beat-label leakage, do not keep adding prompt lines. Document the result and move to a higher-level design, likely around `TopicPackage` material shape or selected sample style, while still avoiding local semantic gates.

## Implementation Shape

This design should become a short implementation plan with three tasks:

1. Add failing tests for the writer prompt contract and no-Brief boundary.
2. Minimally consolidate `harness/prompts/script/script-writer.prompt.md` to express the audit/prose boundary without increasing prompt weight.
3. Run and record a five-round GLM-5.1 quality observation.

Each implementation task must use TDD where code or prompt behavior is changed, then commit separately with a Chinese commit message.

## Stop Criteria

Stop this optimization path if any of the following happen:

- Prompt lines increase without removing or merging older overlapping constraints.
- The change requires a new schema, new stage, or new runtime object.
- The five-round observation shows no reduction in label leakage.
- The solution starts relying on local semantic classification.

At that point the right next move is not more prompt patching. It is a higher-level design review of upstream material shape and writer input ergonomics.
