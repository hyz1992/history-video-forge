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

## Notes

- An earlier run without explicitly setting `LLM_PROVIDER=openai` completed the sample through the stub topic provider, so it is not counted as topic selector strict tool-call evidence.
- The first live command attempt used too short an outer shell timeout and produced only the initial plan artifacts. The successful run used the same model timeout settings with a longer outer command timeout.
- The optional five-round run was not executed in this task. A single real sample is enough to prove the raw tool-call shape, but not enough to recommend `tool_call` as the default structured strategy.

## Conclusion

The strict tool-call path is viable for this GLM-5.1 `topic.selector` sample. It should remain opt-in until a five-round run confirms provider-shape stability across repeated topic selector calls.
