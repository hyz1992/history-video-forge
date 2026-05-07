# Script writer ending residue quality check

Date: 2026-05-07

Command:

```bash
npm run harness:topic-script-five-round-quality-check -- --output-dir harness/scripts/runtime/output/2026-05-07-script-writer-ending-residue-quality-check
```

## Summary

This run checks commit `05e7392`, which added a short `ending_span` residue
contract:

- end on cost, irony, unresolved consequence, or scene-level judgment
- avoid default "changed history / became a model / went down in history" style
  praise

Result: mixed.

- End-to-end live check: 5/5 completed.
- Local validation: 4/5 pass, 1/5 `script_body_too_thin`.
- Semantic shadow: 3 pass / 1 skipped / 1 attention.
- Topic package sufficiency: 5 ok / 0 needs_attention.

The ending rule did not create a severe regression, but this run is weaker than
the previous scene-boundary run. It should not be treated as a completed quality
improvement.

## Harness Result

```json
{
  "status": "five-round-quality-check-completed",
  "total_samples": 5,
  "passed_samples": 5,
  "failed_samples": 0,
  "sample_ready_samples": 5,
  "local_validation_passed_samples": 4,
  "local_validation_failed_samples": 1,
  "semantic_shadow_passed_samples": 3,
  "semantic_shadow_skipped_samples": 1,
  "semantic_shadow_attention_samples": 1,
  "topic_package_sufficiency_ok_samples": 5,
  "topic_package_sufficiency_needs_attention_samples": 0
}
```

## Per-sample Evidence

| sample | regen ran | local validation | script chars | sentence count | semantic shadow | quality note |
| --- | --- | --- | ---: | ---: | --- | --- |
| `yanzi-shichu` | yes | `regen_once`, `script_body_too_thin` | 236 | 8 | skipped | Misses floor by 4 chars; not a severe quality collapse, but still structurally below floor. Ending has scene reaction but also "完胜" summary. |
| `zhuanzhu-ciwangliao` | yes | pass | 240 | 8 | pass | Barely hits floor. Reviewer says expression is still somewhat general. Ending is still broad history framing. |
| `julu-zhizhan` | yes | pass | 254 | 8 | `patch_once/lift` | Reviewer attention: core scene lacks enough concrete action detail despite covering beats. Ending becomes lesson-like. |
| `hongmenyan` | yes | pass | 359 | 12 | pass | Strongest sample: pressure, sword action, body reaction, intervention, consequence. Ending has useful residue. |
| `yanzi-shichu-repeat-2` | no | pass | 301 | 9 | pass | Structurally fine, but reviewer notes it is still broad and fast. Ending still summarizes dignity being preserved. |

## Draft Texts

### yanzi-shichu

楚王设宴时，故意让晏子从一个小门进入，当众嘲讽他身材矮小。晏子站在小门前，目光坚定，直视楚王，不卑不亢地直言：'出使狗国才从狗门入，我出使的是楚国，为何要走小门？'楚王脸色一沉，哑口无言，只好挥手让人打开大门。宴席上，楚王再次发难，讽刺齐国无人，竟派晏子这样矮小的人来。晏子从容举杯，不急不缓地回应：'齐国派遣使者，各有不同。贤者出使贤主国，不贤者出使不贤主国。我最不贤，所以才被派到楚国来。'满座宾客哗然，楚王面红耳赤，只能尴尬地举起酒杯，这场外交交锋以晏子的完胜告终。

### zhuanzhu-ciwangliao

吴国宫廷深处，一场精心设计的宴席正在上演。公子光设宴款待王僚，表面上宾主尽欢，暗地里却暗流涌动。专诸以献鱼为名接近，他的每一步都踏在生死边缘。当那道精心烹制的鱼被端上席间，所有人都以为只是一道寻常菜肴。然而，专诸在鱼腹中藏剑，趁王僚不备拔剑刺杀，剑光闪过，王僚应声倒地。卫士们反应迅速，长剑齐出，专诸当场被乱刃杀死。但刺杀已经成功，王僚身亡，吴国宫廷陷入混乱，公子光终于如愿以偿登上了王位。这场被安排进宴席的刺杀，不仅改变了吴国权力的格局，更成为春秋时期最惊心动魄的宫廷政变之一。

### julu-zhizhan

项羽如何用断绝退路的策略，将一支观望的军队变成破秦的尖刀？公元前207年，项羽面对秦军主力围困与诸侯观望的困境，做出了一个惊人的决定。当楚军全部渡过漳河后，项羽突然下令砸碎所有炊具，凿沉渡船，断绝一切退路。士兵们惊恐地回头望去，船只已沉，炊具已碎，退路已经没了。项羽站在高处，冷冷地看着将士们，一言不发。将士们面面相觑，随即爆发出震天的怒吼，他们知道，要么死战，要么灭亡。没有退路的楚军爆发出了惊人的战斗力，九战九捷，最终大破秦军主力，扭转了整个战局。这场战役证明了，有时候，断绝退路才是激发潜能的最佳方式。

### hongmenyan

你能想象吗？一桌酒席，一场生死，刘邦如何从刀尖上走出鸿门宴？刘邦赴宴前，紧张得手心冒汗，反复叮嘱张良和樊哙应对策略。他深知此去九死一生，却不得不亲自赴会。宴席上，项羽表面热情，眼神却如刀锋般锐利，每一道目光都像在评估刘邦的价值。刘邦强作镇定，但每一个笑容都牵动着神经，他小心斟酌着每一句话，生怕触怒这位西楚霸王。突然，项庄拔剑起舞，剑锋一次次擦向刘邦，每一道寒光都让人心惊肉跳。项庄的剑时而刺向刘邦的咽喉，时而直指他的胸口，每一次逼近都让刘邦感到死亡的气息。刘邦脸色惨白，额头渗出冷汗，手中酒杯微微颤抖。危急时刻，樊哙闯入帐中，怒目圆睁，手持盾牌挡在刘邦身前，厉声质问项羽。项羽一时语塞，樊哙趁机护送刘邦借上厕所逃离，留下张良善后处理残局。这场鸿门宴，项羽的一念之间可以决定刘邦的生死，但每一次犹豫都在放走未来的敌人。

### yanzi-shichu-repeat-2

当晏子作为齐国使臣抵达楚国时，楚王早已设下圈套，准备当众羞辱这位矮小的外交官。楚王故意让晏子从一个小小的狗门进入宫殿，意图让他在众人面前颜面尽失。面对这明显的羞辱，晏子停下脚步，冷静地回道:'出使狗国方从狗门入，今日我出使的是楚国，理应从正门而入。'楚王被这巧妙的反击噎得说不出话，只能强作镇定地设宴招待。宴席上，楚王又讥讽道:'齐国难道就没有人了吗？怎会派你这样的使臣来？'晏子不卑不亢地回应:'齐国人才济济，只是派遣使臣要看对方国家的大小。齐国派往大国的使臣都是贤能之士，而我这样的，只能派往小国。'楚王连番压场，晏子却一句句顶了回去，最终让楚王不得不承认齐国人才辈出，晏子的智慧与尊严得到了保全。

## Quality Assessment

What improved or held:

- `hongmenyan` is a strong first-draft oral story sample.
- All topic packages were sufficient.
- The ending rule did not break the runtime chain.

What remains weak:

- `yanzi-shichu` missed local floor by 4 chars.
- `julu-zhizhan` was shadow-marked `patch_once/lift`; the main chain still does
  not patch, correctly.
- Several endings still end in abstract lessons or historical framing:
  - "完胜告终"
  - "最惊心动魄的宫廷政变之一"
  - "激发潜能的最佳方式"
  - "智慧与尊严得到了保全"

## Conclusion

The ending-residue prompt rule is not enough by itself. It may help `hongmenyan`,
but this run does not show a clean distribution-level improvement over the
previous scene-boundary run.

The current quality gap is broader than one ending sentence: some samples still
need more scene-specific consequence and less interpretive summary.

## Recommended Next Step

Pause further prompt edits until the user reviews the five drafts.

If continuing after manual review, prefer selecting one concrete failure mode
from the user's judgment and making one low-coupling change. Do not add another
generic quality slogan.

