# Script Writer Prompt Debt Audit Record

Date: 2026-05-07
Prompt: prompts/script/script-writer.prompt.md
Audit Scope: Current script.writer prompt after quote intent hard anchor work.

## Prompt Metrics

- prompt_chars: 2393
- prompt_lines: 55
- bullet_count: 30
- schema_contract: output object, required sidecars, language contract
- topic_boundary: Hard Lane, TopicPackage, forbidden expansion, packaging weak reference
- quality_goal: oral story draft, scene/action/reaction, ending residue
- opening_strategy: break-wall opening and concrete pressure opening
- body_density: medium body floor, beat expansion, non-padding rule
- regen_only: regeneration_context and script_body_too_thin rules
- quote_usage: canonical_quote_intents usage rule
- duplicate_or_competing: body density + regen expansion + beat expansion overlap

## Constraint Categories

| Category | Count | Notes |
| --- | ---: | --- |
| schema_contract | 1 | Keep in writer prompt. |
| topic_boundary | 1 | Keep in writer prompt. |
| quality_goal | 2 | Candidate for simplification after shadow evidence. |
| opening_strategy | 1 | Already heavy; do not extend. |
| body_density | 3 | Overlaps with local structural floors. |
| regen_only | 1 | Candidate to move to regen-only context. |
| quote_usage | 1 | Keep because it binds explicit upstream quote intents. |
| duplicate_or_competing | 2 | Beat expansion and body density repeat similar pressure. |

## Duplicate Or Competing Constraints

- Beat expansion, body density, and thin-regeneration rules all ask for action/reaction/consequence.
- Opening rules already include several subrules; do not add new opening slogans.
- Regen-only details are present in always-on writer prompt and may distract first drafts.

## Keep In Writer Prompt

- Output schema and language requirements.
- Hard Lane and TopicPackage boundary requirements.
- Canonical quote intent requirement.
- A short statement that the output is an oral historical story draft, not a summary.

## Move Out Candidates

- Regen-only thin-draft expansion rules.
- Detailed beat action/reaction/consequence checklist.
- Detailed body density language that duplicates local structural floors.

## Stop Conditions

- Stop if any next task proposes editing script.writer prompt before shadow evidence.
- Stop if any next task feeds Brief into writer.
- Stop if any next task uses local semantic quality scoring.

## Non-Changes

- Do not modify script.writer prompt in this task.
- Do not introduce ScriptWritingBrief into runtime.
- Do not use local semantic quality scoring.
- Do not change TopicPackage.
- Do not change ScriptInputBundle.

## Current conclusion

The prompt is carrying schema, boundary, writing quality, opening strategy, body density, quote usage, and regen-only concerns in one place. The next safe step is not another prompt edit. The next safe step is a shadow-only Brief contract and fixture that can test whether upstream story material can be made more executable without changing the main chain.
