# Script Thin Regen Repair Context Observation

## Run

- command: `npm run harness:topic-script-five-round-quality-check -- --output-dir harness/scripts/runtime/output/2026-05-07-thin-regen-repair-context-five-round`
- output_dir: `harness/scripts/runtime/output/2026-05-07-thin-regen-repair-context-five-round`
- purpose: observe whether `thin_body_repair` improves `script_body_too_thin` regen without making scripts watery

## Summary

- total_samples: 5
- local_pass: 5
- final_regen_once: 0
- script_body_too_thin_count: 0
- still_thin_after_repair_context_count: 0
- unchanged_after_thin_context_count: 0
- samples_with_regen_step: 4
- semantic_shadow_pass: 4
- semantic_shadow_attention: 1

## Per-Sample Scripts

### hongmenyan

- decision: pass
- errors: []
- chars: 318
- sentences: 8
- diagnostics: `topic_candidate_generate_passed`, `topic_candidate_slot_guard_passed`, `patch_once`
- graph steps: `topic-candidate-generate > script-generate > local-validate > regen-once > local-validate > semantic-review`
- semantic decision: patch_once
- human note: local body floor passed and the final draft has more scene action than prior thin outputs. However semantic shadow still requests lift: environment tension and dramatic interaction remain not strong enough. This should not be treated as complete quality success.

```text
项羽在鸿门设宴，刘邦明知此去凶多吉少，却不得不亲自赴宴。他低眉顺眼地向项羽敬酒，双手微微颤抖，额头渗出冷汗，内心恐惧如虎，却只能强作镇定，表面恭顺如犬。席间，谋士范增多次暗示项羽除掉刘邦，并安排项庄舞剑助兴。项羽却犹豫不决，目光游移不定，似乎不忍下手，又或是轻视刘邦的威胁。项庄见状拔剑起舞，剑锋一次次擦向刘邦的衣袖，每一步都踏在生死边缘，刘邦面色苍白，强作镇定，双手紧握酒杯，指节因用力而发白。樊哙见状闯帐入席，手持盾牌，怒目圆睁，斥责项羽背信弃义，为刘邦解围。项羽被樊哙的气势所慑，一时竟无言以对。刘邦借机如厕，趁机逃回军营，留下项羽在宴席上懊悔不已，一场决定楚汉天下归属的饭局，就此落下帷幕，项羽一念之间的犹豫，放走了未来的敌人。
```

### julu-zhizhan

- decision: pass
- errors: []
- chars: 351
- sentences: 8
- diagnostics: `topic_candidate_generate_passed`, `topic_candidate_slot_guard_passed`, `semantic_review_passed`
- graph steps: `topic-candidate-generate > script-generate > local-validate > regen-once > local-validate > semantic-review`
- semantic decision: pass
- human note: body volume and action/reaction structure are improved. Still has some generic heroic language in the ending, but not merely a structural summary.

```text
秦军主力将巨鹿团团围困，诸侯联军观望不前，战局危在旦夕。项羽站在高处，眉头紧锁，看着远处黑压压的秦军营寨，又回头望了望身后犹豫不前的楚军将士，他们眼神中充满了恐惧和不安。项羽深知，若不破釜沉舟，楚军将永远无法突破这绝境，只能沦为历史的尘埃。他深吸一口气，大步走向楚军阵前，目光如炬，举起手中的宝剑，厉声下令砸碎锅釜、凿沉渡船，断绝所有退路！楚军将士们面面相觑，有人开始低声议论，但看到项羽决绝的眼神，他们渐渐明白已经没有退路。楚军将士回头望去，河水湍急，船只已沉，退路已经没了，唯有向前冲杀才有生路。项羽振臂高呼，楚军将士们爆发出震天的怒吼，他们像猛虎一样冲向秦军阵营，以一当十，奋勇杀敌。项羽的这一豪赌，将犹豫的楚军逼成了无敌之师，他们背水一战，以少胜多击溃秦军主力，扭转了整个战局，成就了历史传奇。
```

### yanzi-shichu

- decision: pass
- errors: []
- chars: 290
- sentences: 14
- diagnostics: `topic_candidate_generate_passed`, `topic_candidate_slot_guard_passed`, `semantic_review_passed`
- graph steps: `topic-candidate-generate > script-generate > local-validate > semantic-review`
- semantic decision: pass
- human note: key famous moment is preserved, including dog gate and "橘生淮南". It is quote-complete and structurally clean, but the ending is still somewhat summary-like.

```text
齐国使者晏子抵达楚国都城，楚王竟命人打开旁门，让晏子从狗门入城。面对这赤裸裸的羞辱，晏子驻足不前，冷冷说道：'使狗国者，从狗门入；今臣使楚，不当从此门入。'楚王无言以对，只得改走正门。宴会上，楚王见晏子身材矮小，又讥讽道：'难道齐国无人了吗？竟派你这样的矮子出使？'晏子从容应对：'齐之临淄三百闾，张袂成阴，挥汗成雨，何谓无人？只是齐王所遣者，皆贤于臣。'楚王不甘失败，转而嘲讽：'齐人固善盗乎？'晏子笑答：'橘生淮南则为橘，生于淮北则为枳，叶徒相似，其实味不同。所以然者何？水土异也。今民生长于齐不盗，入楚则盗，得无楚之水土使民善盗耶？'楚王哑口无言，晏子以智慧捍卫了国家尊严。
```

### yanzi-shichu-repeat-2

- decision: pass
- errors: []
- chars: 251
- sentences: 12
- diagnostics: `topic_candidate_generate_passed`, `topic_candidate_slot_guard_passed`, `semantic_review_passed`
- graph steps: `topic-candidate-generate > script-generate > local-validate > regen-once > local-validate > semantic-review`
- semantic decision: pass
- human note: quote coverage is correct and the ending is less empty than earlier "智慧/荣誉" endings, but still close to the local lower bound and the first half merges two insults quickly.

```text
齐国使臣晏子抵达楚国，楚王却故意安排他从小小的狗门进入。楚王站在高高的台阶上，冷笑着对晏子说：'齐国无人吗？竟派你这样的小人出使？'晏子抬头直视楚王，目光坚定，从容回答：'使狗国者，从狗门入。今臣使楚，不当从此门入。'楚王一时语塞，脸色铁青，只得挥手命人打开正门。宴席上，楚王不甘心失败，又故意羞辱：'齐人善盗，是吗？'晏子举杯，不慌不忙道：'橘生淮南则为橘，生于淮北则为枳。叶徒相似，其实味不同。所以然者何？水土异也。'楚王哑口无言，满朝文武震惊于晏子的机智与勇气，楚王尴尬地挥了挥手，示意宴会继续。
```

### zhuanzhu-ciwangliao

- decision: pass
- errors: []
- chars: 373
- sentences: 10
- diagnostics: `topic_candidate_generate_passed`, `topic_candidate_slot_guard_passed`, `semantic_review_passed`
- graph steps: `topic-candidate-generate > script-generate > local-validate > regen-once > local-validate > semantic-review`
- semantic decision: pass
- human note: stronger scene density than the previous thin version, with action and immediate consequence. Ending still contains broad historical framing and may need later human/editorial tightening.

```text
吴王僚端坐宴席主位，目光锐利地扫过全场，警惕着每一个可能存在的威胁。公子光躬身侍立，笑容可掬地献上美酒，动作恭敬得无懈可击，但眼神深处却暗藏杀机。在这表面的恭敬之下，一场精心设计的刺杀正在悄然进行，所有人都不知道，这是吴国权力更迭的前奏。动手只有一次机会，失手就是全盘皆输，公子光深知这一点，因此他赌上了全部筹码。当专诸端着那盘看似普通的烤鱼走进大殿时，脚步沉稳如常，但手心却已渗出冷汗。所有人都未察觉其中暗藏的杀机，鱼腹中，一把短剑寒光闪闪，等待着致命一击。专诸突然暴起，动作快如闪电，将鱼腹中的短剑抽出，直刺王僚咽喉。王僚惊恐地睁大双眼，试图躲避却已来不及，鲜血喷涌而出。卫兵们反应不及，乱作一团，专诸当场被杀，但这一击已致命。刺杀成功为公子光铺平了夺位之路，吴国历史因此改写，而这场精心设计的宴席刺杀，也成为中国历史上最著名的政治阴谋之一。
```

## Human Quality Notes

- Does the draft feel like oral historical storytelling rather than structural summary? Mostly yes for `hongmenyan`, `julu-zhizhan`, and `zhuanzhu-ciwangliao`; partially yes for the two `yanzi-shichu` drafts.
- Are beats expanded with action, reaction, and consequence? Yes in all 5 at a structural level. Some beats remain compressed, especially `yanzi-shichu-repeat-2`.
- Is there any padding, empty evaluation, or slogan-like ending? Some generic ending language remains, especially `julu-zhizhan`, `yanzi-shichu`, and `zhuanzhu-ciwangliao`; not enough to call the change invalid, but not a release-line draft.
- Are key famous moments and canonical quotes preserved? Yes. Both `yanzi-shichu` runs include the dog gate quote and "橘生淮南" moment.

## Conclusion

- outcome: continue
- reason: The structural thinness problem improved in this run: 5/5 local pass, 0 `script_body_too_thin`, 0 still-thin diagnostics, and 4 regen steps ended in pass. However this is not proof of final quality. Continue only with observation-first caution: do not add more prompt pressure, and use the next cycle to inspect whether generic endings and compressed diplomatic scenes remain a bottleneck.
