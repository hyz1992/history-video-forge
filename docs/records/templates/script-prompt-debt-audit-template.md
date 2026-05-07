# Script Prompt Debt Audit Record

Date:
Prompt:
Audit Scope:

## Prompt Metrics

- prompt_chars:
- prompt_lines:
- bullet_count:
- hard_contract_count:
- quality_goal_count:
- regen_only_count:

## Constraint Categories

| Category | Count | Notes |
| --- | ---: | --- |
| schema_contract | 0 | |
| topic_boundary | 0 | |
| quality_goal | 0 | |
| opening_strategy | 0 | |
| body_density | 0 | |
| regen_only | 0 | |
| quote_usage | 0 | |
| duplicate_or_competing | 0 | |

## Duplicate Or Competing Constraints

- Record only concrete overlaps or competing instructions.
- Do not infer semantic quality from local keyword rules.

## Keep In Writer Prompt

- List only constraints that must remain in writer prompt.

## Move Out Candidates

- List constraints that may belong in regen-only context, shadow brief observation, or documentation.

## Stop Conditions

- Stop if the audit cannot classify most prompt constraints.
- Stop if the audit recommends adding more always-on writer prompt rules.
- Stop if the audit requires changing TopicPackage, reviewer, validator, or runtime decisions.

## Non-Changes

- Do not modify script.writer prompt in this audit.
- Do not introduce ScriptWritingBrief into runtime.
- Do not use local semantic quality scoring.
- Do not change TopicPackage.
- Do not change ScriptInputBundle.

## Conclusion

- Audit conclusion:
- Recommended next step:
