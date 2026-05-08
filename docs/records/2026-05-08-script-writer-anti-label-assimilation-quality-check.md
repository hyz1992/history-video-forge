# Script Writer Anti-Label Assimilation Quality Check

Date: 2026-05-08

## Source

- Design: `docs/plans/2026-05-08-script-writer-anti-label-assimilation-design.md`
- Implementation commit: `5cc1cb3`
- Output dir: `harness/scripts/runtime/output/2026-05-08-glm51-anti-label-five-round`

## Configuration

- LLM_PROVIDER: openai
- LLM_MODEL: glm-5.1
- LLM_STRUCTURED_MODEL: glm-5.1
- LLM_TIMEOUT_MS: 120000
- Structured defaults: model-aware defaults from code

## Summary

- total samples: 5
- passed samples: 5
- failed samples: 0
- local validation passed samples: 5
- topic package sufficiency ok samples: 5
- semantic reviewer shadow: 4 pass, 1 patch_once, 0 skipped, 0 unknown

Operational note:

- The first outer shell wait timed out after four sample directories had been written.
- The underlying run continued and later wrote `live-check-summary.json`.
- The completed summary is counted here.

## Manual Anti-Label Observation

| Sample | Label leakage | Peak scene absorption | Quote intent absorption | Note |
| --- | --- | --- | --- | --- |
| yanzi-shichu | lower versus previous GLM-5.1 record | better | mixed | Script prose turns dog-gate beats into action: “晏子车轮猛地刹停，他死死盯着那道矮洞”; however the second `橘生淮南则为橘` quote intent is still not absorbed. |
| zhuanzhu-ciwangliao | lower versus previous GLM-5.1 record | weaker | not applicable | Beat labels are absorbed into scenes such as “妻子停下手里的活，死死咬住嘴唇回望”, but the reviewer still flags missing fish-belly assassination peak. |
| julu-zhizhan | lower versus previous GLM-5.1 record | better | not applicable | The draft converts beats into concrete pressure: “士兵们眼睁睁看着归家的木船被凿穿沉入河底”. |
| hongmenyan | lower versus previous GLM-5.1 record | better | not applicable | The draft uses action and pressure rather than labels: “项庄拔剑起舞，剑锋一次次直逼刘邦咽喉”. |
| yanzi-shichu-repeat-2 | lower versus previous GLM-5.1 record | same | mixed | The dog-gate quote is integrated into a scene, but the ending still has mild summary pull in “楚王连番压场，晏婴一句句顶回去”, and the second quote intent is not absorbed. |

## Conclusion

This prompt consolidation helped reduce obvious beat-label recitation in `script_text`: all five drafts read as prose units rather than checklist coverage, and local validation stayed 5/5 with topic package sufficiency 5/5 ok.

The evidence is still mixed for higher-order story quality. `zhuanzhu-ciwangliao` remains weak because the peak action is missing despite clean beat absorption, and high-quote `yanzi-shichu` samples still do not naturally absorb the second quote intent. Do not continue prompt piling for this issue. The next design move should be a higher-level `TopicPackage` material-shape or writer input ergonomics pass, while still avoiding local semantic gates or any replacement Brief stage.
