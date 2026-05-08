# Strict Structured Provider Topic Selector Probe

Date: 2026-05-08

## Configuration

- LLM_PROVIDER: openai
- LLM_MODEL: glm-5.1
- LLM_STRUCTURED_MODEL: glm-5.1
- LLM_STRUCTURED_STRATEGY: tool_call
- LLM_STRUCTURED_THINKING: disabled
- LLM_STRUCTURED_TEMPERATURE: 0.5
- LLM_STRUCTURED_TOP_P: 0.9
- LLM_STRUCTURED_MAX_TOKENS: 2048
- LLM_TIMEOUT_MS: 120000

## Command

```powershell
$env:LLM_PROVIDER='openai'
$env:LLM_MODEL='glm-5.1'
$env:LLM_STRUCTURED_MODEL='glm-5.1'
$env:LLM_STRUCTURED_STRATEGY='tool_call'
$env:LLM_STRUCTURED_THINKING='disabled'
$env:LLM_STRUCTURED_TEMPERATURE='0.5'
$env:LLM_STRUCTURED_TOP_P='0.9'
$env:LLM_STRUCTURED_MAX_TOKENS='2048'
$env:LLM_TIMEOUT_MS='120000'
$runId='2026-05-08-glm51-strict-selector-real-single'
npx tsx harness/scripts/runtime/topic-script-live-check.ts --sample harness/samples/topic-script/yanzi-shichu.sample.json --output-dir harness/scripts/runtime/output/$runId
```

## Result

- Status: pass
- Output dir: `harness/scripts/runtime/output/2026-05-08-glm51-strict-selector-real-single`
- Topic selector structured status: tool_call arguments parsed and strict schema passed
- Topic selector selected ids: `selector_candidate_1`, `selector_candidate_7`, `selector_candidate_8`
- Topic candidate slot guard: pass
- Script local validation: pass
- Semantic reviewer: shadow-only pass
- Topic package sufficiency: ok

## Raw Shape Notes

- The provider returned `message.tool_calls[0].function.arguments`.
- `finish_reason` was `tool_calls`.
- The tool name was `select_topic_candidates`.
- Arguments contained only `selected_candidate_ids`.
- No `answer`, `result`, or `explanation` wrapper was accepted.
- The interaction log recorded `reasoning_tokens: 0`, consistent with disabled thinking for this response.

Observed raw arguments:

```json
{
  "selected_candidate_ids": [
    "selector_candidate_1",
    "selector_candidate_7",
    "selector_candidate_8"
  ]
}
```

## Five-Round Probe

Command:

```powershell
$env:LLM_PROVIDER='openai'
$env:LLM_MODEL='glm-5.1'
$env:LLM_STRUCTURED_MODEL='glm-5.1'
$env:LLM_STRUCTURED_STRATEGY='tool_call'
$env:LLM_STRUCTURED_THINKING='disabled'
$env:LLM_STRUCTURED_TEMPERATURE='0.5'
$env:LLM_STRUCTURED_TOP_P='0.9'
$env:LLM_STRUCTURED_MAX_TOKENS='2048'
$env:LLM_TIMEOUT_MS='120000'
$runId='2026-05-08-glm51-strict-selector-five-round'
npm run harness:topic-script-five-round-quality-check -- --output-dir harness/scripts/runtime/output/$runId
```

Result:

- Status: pass
- Output dir: `harness/scripts/runtime/output/2026-05-08-glm51-strict-selector-five-round`
- Total samples: 5
- Passed samples: 5
- Failed samples: 0
- Sample-ready samples: 5
- Local validation passed samples: 5
- Topic package sufficiency ok samples: 5
- Semantic reviewer: shadow-only; 2 pass, 3 patch_once

Topic selector raw tool-call shape:

| Sample | Project id | `finish_reason` | Tool | Selected ids |
| --- | --- | --- | --- | --- |
| `yanzi-shichu` | `p_17f4667c` | `tool_calls` | `select_topic_candidates` | `selector_candidate_1`, `selector_candidate_2`, `selector_candidate_5` |
| `zhuanzhu-ciwangliao` | `p_05089664` | `tool_calls` | `select_topic_candidates` | `selector_candidate_2`, `selector_candidate_4`, `selector_candidate_8` |
| `julu-zhizhan` | `p_74930bd0` | `tool_calls` | `select_topic_candidates` | `selector_candidate_1`, `selector_candidate_5`, `selector_candidate_8` |
| `hongmenyan` | `p_0005cd31` | `tool_calls` | `select_topic_candidates` | `selector_candidate_1`, `selector_candidate_4`, `selector_candidate_5` |
| `yanzi-shichu-repeat-2` | `p_06b59752` | `tool_calls` | `select_topic_candidates` | `selector_candidate_1`, `selector_candidate_4`, `selector_candidate_6` |

All five selector responses used `message.tool_calls[0].function.arguments` with only the `selected_candidate_ids` field. No `answer`, `result`, or `explanation` wrapper was observed.

Operational note:

- The first shell wait hit an outer 15-minute timeout after two sample directories had already been written.
- The underlying npm/tsx/node process continued running and later wrote `live-check-summary.json`.
- A follow-up monitor confirmed the completed summary instead of treating the shell timeout as provider failure.

## Notes

- An earlier run without explicitly setting `LLM_PROVIDER=openai` completed the sample through the stub topic provider, so it is not counted as topic selector strict tool-call evidence.
- The first live command attempt used too short an outer shell timeout and produced only the initial plan artifacts. The successful run used the same model timeout settings with a longer outer command timeout.
- The five-round run confirms provider-shape stability for these five topic selector calls, but it does not evaluate full script quality as a release gate. The semantic reviewer remains shadow-only.

## Conclusion

The strict tool-call path is viable for GLM-5.1 `topic.selector` and stayed stable across one single-sample probe plus one five-round probe. The evidence supports recommending `LLM_STRUCTURED_STRATEGY=tool_call` for the `topic.selector` strict structured pilot, while keeping it opt-in until a broader provider policy is designed.
