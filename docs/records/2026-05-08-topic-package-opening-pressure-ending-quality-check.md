# TopicPackage Opening Pressure Ending Quality Check

Date: 2026-05-08

## Source

- Design: `docs/plans/archive/topic-script/2026-05-08-topic-package-opening-pressure-ending-material-shape-design.md`
- Implementation plan: `docs/plans/archive/topic-script/2026-05-08-topic-package-opening-pressure-ending-material-shape-implementation-plan.md`
- Output dir: `harness/scripts/runtime/output/2026-05-08-glm51-opening-pressure-ending-five-round`

## Configuration

- LLM_PROVIDER: openai
- LLM_MODEL: glm-5.1
- LLM_STRUCTURED_MODEL: glm-5.1
- LLM_TIMEOUT_MS: 180000

Run note: the first attempt timed out at the outer shell after two samples and no longer wrote files after `18:11:05`; the orphan node process from that attempt was stopped, then the same output dir was rerun to completion. The completed run wrote `live-check-summary.json`.

## Summary

- total samples: 5
- passed samples: 5
- failed samples: 0
- sample-ready samples: 5
- local validation passed samples: 5
- local validation failed samples: 0
- local validation unknown samples: 0
- TopicPackage sufficiency ok samples: 5
- TopicPackage sufficiency observe samples: 0
- TopicPackage sufficiency needs attention samples: 0
- TopicPackage sufficiency unknown samples: 0
- semantic reviewer shadow: 4 pass / 1 patch_once / 0 skipped / 0 unknown

## Manual Observation

### yanzi-shichu

- opening sharpness: better. Evidence: `楚王当众设局羞辱，晏子若爬狗洞则齐使尊严扫地，若折返则使命难全`.
- pressure explanation: better. `pressure_escalation` includes public humiliation, the closed main gate, and the logic trap: `逼入“自认狗国”或“开正门”的死局`.
- ending aftershock: better. Evidence: `这扇大门虽开，楚君臣设局折辱之心却昭然若揭，前方绝非坦途`.

### zhuanzhu-ciwangliao

- opening sharpness: better. Evidence: `吴王僚将身家性命押在三重铠甲与满院卫兵上`.
- pressure explanation: better. The script stages the security logic before the strike: `两侧甲士便交叉长戟，连上菜的厨役都要脱衣搜检`.
- ending aftershock: better. Evidence: `他防住了所有活人，唯独没防住那道要命的菜`.

### julu-zhizhan

- opening sharpness: better. Evidence: `五万楚军马上就要被秦军吃掉，统帅宋义却连坐四十六天按兵不动`.
- pressure explanation: better. The script shows the pressure chain from delay to cut-off retreat: `把船全凿沉！把做饭的铁锅全砸碎！`.
- ending aftershock: same. The ending has story-internal cost, `再无退路的恐惧永远刻进了这支绝命军团的骨血里`, but it is still more summary-like than scene-residual.

### hongmenyan

- opening sharpness: better. Evidence: `项羽握着能斩草除根的刀，为何却任由死敌步出军帐？刘邦伏地谢罪的瞬间，项羽眼底的杀意竟被轻蔑浇灭`.
- pressure explanation: better. The script explains the non-action pressure through status and vanity: `一头匍匐在脚下的丧家犬，怎配让他拔剑？`.
- ending aftershock: better. Evidence: `贵族的骄傲免去了挥刀的血污，却换来了乌江畔自刎的寒锋`.

### yanzi-shichu-repeat-2

- opening sharpness: same. Evidence: `齐国使臣晏子面临生死抉择——低头受辱，还是硬刚楚王？` is direct but still starts as a broad choice question before the concrete gate image.
- pressure explanation: better. Evidence: `不钻狗洞，就别想入城` makes the coercion clearer than a plain quote setup.
- ending aftershock: better. Evidence: `这第一记耳光，晏子连朝堂都没进，就已经原样奉还了`.

## Conclusion

This material-shape pass helped overall. The strongest gains are opening pressure and pressure-chain visibility: all five samples carried the first preview node into `hook_claim`, and the scripts repeatedly started from concrete danger, humiliation, or forced choice rather than plain historical explanation.

Ending aftershock also improved, especially `zhuanzhu-ciwangliao`, `hongmenyan`, and both `yanzi-shichu` samples. The remaining weak spot is not structural mapping but tone: `julu-zhizhan` still drifts toward a strong summary line instead of a fully scene-internal residue. The evidence supports stopping prompt-layer piling for this pass; if more improvement is needed, the next work should inspect source material and candidate sample ergonomics rather than adding another writer prompt layer.

Semantic reviewer remains shadow-only. The single `patch_once/lift` was `yanzi-shichu-repeat-2`; it did not enter patch or main-chain gating.
