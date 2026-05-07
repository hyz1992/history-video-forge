# Script Writing Brief Shadow Observation

Date: 2026-05-07
Source five-round output: harness/scripts/runtime/output/2026-05-07-brief-shadow-source-five-round
Shadow output command: `$env:LLM_TIMEOUT_MS='90000'; npm run harness:script-brief-shadow-five-round-check -- --source-output-dir harness/scripts/runtime/output/2026-05-07-brief-shadow-source-five-round`

## Run Metadata

- total_samples: 5
- source_processed_samples: 5
- source_sample_ready_samples: 5
- source_local_validation_passed_samples: 1
- source_local_validation_failed_samples: 4
- source_semantic_shadow_passed_samples: 1
- source_semantic_shadow_skipped_samples: 4
- shadow_processed_samples: 0
- shadow_written_files: 0
- shadow_exit_code: 1

## Source Sample Table

| sample | topic | local_validation | semantic_shadow | script_chars | observed_script_failure |
| --- | --- | --- | --- | ---: | --- |
| yanzi-shichu | 晏子使楚：外交尊严的捍卫战 | regen_once | skipped | 229 | body too thin; complete key quotes but still summary-like ending |
| zhuanzhu-ciwangliao | 鱼腹藏剑：专诸刺王僚 | regen_once | skipped | 216 | body too thin; scene has action but compression remains |
| julu-zhizhan | 破釜沉舟：项羽的绝地反击 | pass | pass | 244 | no blocking local issue in this run |
| hongmenyan | 鸿门宴：项羽的一念之间 | regen_once | skipped | 205 | body too thin; pressure beats are present but compressed |
| yanzi-shichu-repeat-2 | 晏子使楚：外交尊严之战 | regen_once | skipped | 229 | body too thin; final beat becomes generic wisdom statement |

## Shadow Sample Table

| sample | has_incremental_value | fact_risk | template_risk | useful_for_failure_mode | notes |
| --- | --- | --- | --- | --- | --- |
| yanzi-shichu | no | high | high | no | No valid shadow brief was written before the post-process failed. |
| zhuanzhu-ciwangliao | no | high | high | no | No valid shadow brief was written before the post-process failed. |
| julu-zhizhan | no | high | high | no | No valid shadow brief was written before the post-process failed. |
| hongmenyan | no | high | high | no | No valid shadow brief was written before the post-process failed. |
| yanzi-shichu-repeat-2 | no | high | high | no | No valid shadow brief was written before the post-process failed. |

## Incremental Value Review

- No valid `ScriptWritingBriefShadow` artifact exists for any sample, so there is no usable incremental story material to compare against TopicPackage.
- The source run does confirm the current dominant script failure mode: 4/5 samples still fail local validation with `script_body_too_thin`.
- Because shadow output failed before writing valid artifacts, this run cannot show that Brief explains beat underdevelopment, weak endings, or quote intent risks better than the existing TopicPackage fields.

## Fact Risk Review

- Stop if Brief adds unsupported facts.
- Stop if inferred material is written as history rather than inference.
- The failed real shadow response violated the strict schema and included forbidden fields such as `script_text`, `storyboard_elements`, `asset_requirements`, and `compose_notes`.
- The failed response also used a different beat structure with `beat_id`, `beat_title`, `beat_description`, `duration_sec`, and `key_elements` instead of the required `beat`, `scene_pressure`, `actor_action`, `opponent_reaction`, and `immediate_consequence`.
- This is a contract-controllability risk, not evidence of safe incremental value.

## Template Risk Review

- Stop if Brief is only a longer summary.
- Stop if Brief turns every beat into mechanical action/reaction/consequence filling.
- The failed response suggests the model drifted toward a generic planning object rather than the minimal shadow observation object.
- Because no valid brief was written, template risk cannot be bounded by sample comparison.

## Main-Chain Safety Review

- Confirm writer input did not change: confirmed. No `script-input-bundle.json` was modified by the shadow post-process.
- Confirm validator and reviewer decisions did not change: confirmed. The post-process failed before writing any shadow output and does not call validator or reviewer.
- Confirm no patch or regen behavior changed: confirmed. No patch, regen, writer, validator, or reviewer files were changed in Task 8 observation work.
- Stop if Brief requires writer prompt to become heavier: stop. Current evidence points toward strengthening the shadow prompt or generator contract, not toward feeding Brief into writer or making writer prompt heavier.

## Decision

continue_to_ab_design: no

Reason:

The shadow Brief did not meet the minimum observation gate. The source run produced five script samples, but the shadow post-process wrote zero valid brief artifacts and exited with a schema error. The failed real response crossed explicit boundaries by producing script/downstream planning fields, so this run provides evidence of controllability risk rather than safe incremental value.

Recommended next step:

Do not enter A/B design. Either stop the Brief path for now, or redesign the shadow prompt/generator contract in a separate plan with stricter structured-output repair and retry rules. The more direct quality signal from this run remains script body thinness, which should be addressed without adding Brief to the writer main chain.
