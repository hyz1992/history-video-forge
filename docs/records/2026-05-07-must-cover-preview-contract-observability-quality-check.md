# Must Cover Preview Contract Observability Quality Check

## 运行配置

- 日期：2026-05-08
- run-id：2026-05-07-must-cover-preview-contract-observability-five-round
- 命令：`$env:LLM_TIMEOUT_MS='120000'; npm run harness:topic-script-five-round-quality-check -- --output-dir harness/scripts/runtime/output/2026-05-07-must-cover-preview-contract-observability-five-round`
- LLM_MODEL：glm-5.1
- LLM_STRUCTURED_MODEL：glm-4
- LLM_TIMEOUT_MS：120000，本次命令显式设置为 120000
- semantic reviewer：shadow-only，本次只记录分布，不作为主链路门禁

## 自动摘要

- total_samples：5
- passed_samples：5
- failed_samples：0
- sample_ready_samples：5
- local_validation_passed_samples：5
- semantic_shadow_passed_samples：5
- semantic_shadow_attention_samples：0
- topic_package_sufficiency_ok_samples：4
- topic_package_sufficiency_needs_attention_samples：1

## 人工观察结论

- 候选 preview 整体已经明显从 summary prose 转向可审计叙事节点；每轮 final candidate preview 都是场景、动作、压力或代价节点，不再以长摘要开头。
- confirm 与 script input 仍然只是承接上游字段；`TopicPackage.must_include_beats` 与 `ScriptInputBundle.hard_lane.must_include_beats` 在五轮中逐项一致，没有额外本地语义改写。
- 晏子使楚两轮都覆盖狗门羞辱、`使狗国者，从狗门入`、`橘生淮南则为橘，生于淮北则为枳`，这次没有漏掉“橘生淮南/淮北”的名场面。
- script_text 中字段形复述减少，正文更像口播稿：多数样本用反问或危险局面开头，随后进入场景动作。
- 仍有不足：鸿门宴 topic package sufficiency 标记为 needs_attention，原因是 tension map 和 selected angle 重复、must_include_beats 去重后只有 2 个独立材料；脚本文案本身能用，但上游 topic 材料密度仍需继续治理。
- 未观察到新的跨题材模板污染；名场面遗漏风险在晏子样本上有改善，但不能据此证明所有题材都已稳定。

## hongmenyan

- canonical_title：鸿门宴：刘邦的生死局
- selected_angle：项羽一念之间可以杀刘邦，但每一次犹豫都在放走未来的敌人
- local_validation：pass
- semantic_review_shadow：pass
- topic_package_sufficiency：needs_attention
- topic_package_sufficiency_warnings：tension_map_repetition_risk, selected_angle_repetition_risk, must_include_beats_material_risk

### Final Candidate Preview

- 鸿门宴：刘邦的生死局：刘邦赴宴，表面赔罪实则暗藏机锋 / 项庄拔剑起舞，剑锋一次次擦向刘邦 / 樊哙闯帐，刘邦借如厕逃出生天
- 鸿门宴：范增的愤怒：范增精心设计鸿门宴的计谋 / 项羽犹豫不决时范增的焦急 / 宴后范增对项羽的失望与预言
- 鸿门宴：刘邦的伪装：刘邦低声下气向项羽赔罪 / 宴席上刘邦巧妙应对项羽的试探 / 刘邦借故离席，逃离险境

### TopicPackage.must_include_beats

- 刘邦赴宴，表面赔罪实则暗藏机锋
- 项庄拔剑起舞，剑锋一次次擦向刘邦
- 樊哙闯帐，刘邦借如厕逃出生天

### ScriptInputBundle.hard_lane.must_include_beats

- 刘邦赴宴，表面赔罪实则暗藏机锋
- 项庄拔剑起舞，剑锋一次次擦向刘邦
- 樊哙闯帐，刘邦借如厕逃出生天

### script_text

> 项羽握着能诛杀刘邦的生杀大权，为何却让猎物在眼皮底下溜走？刘邦踏入鸿门军营赔罪，刀斧手已在暗处就位。刘邦推杯换盏，满脸恭顺地向项羽谢罪，每一句伏低做小都在试探项羽杀意的底线，把身家性命全押在对方的一念之间。杀机骤起，项庄以助兴为名拔剑起舞，寒光闪烁间剑锋直逼刘邦咽喉，逼得刘邦连连后退，冷汗浸透衣背。千钧一发，樊哙持盾撞开帐门，怒目圆睁死死盯住项羽，用肉身挡住杀局。趁项羽被这股狠劲震慑的瞬间，刘邦起身借口如厕，连车驾都不敢坐，策马狂奔逃出楚营。项羽那一刻的默许，换来的不是臣服，而是自己日后乌江自刎的催命符。

## julu-zhizhan

- canonical_title：巨鹿之战
- selected_angle：破釜沉舟：项羽如何用绝望创造胜利
- local_validation：pass
- semantic_review_shadow：pass
- topic_package_sufficiency：ok

### Final Candidate Preview

- 巨鹿之战：诸侯联军观望不救，秦军围困巨鹿 / 项羽破釜沉舟，断绝楚军退路 / 楚军背水一战，大破秦军主力
- 巨鹿之战：项羽面对数倍于己的秦军，面临生死抉择 / 项羽下令破釜沉舟，激发楚军战斗意志 / 楚军以一当十，大破秦军主力
- 巨鹿之战：诸侯联军观望不救，秦军围困巨鹿 / 项羽破釜沉舟，激发楚军战斗意志 / 楚军以少胜多，大破秦军主力

### TopicPackage.must_include_beats

- 诸侯联军观望不救，秦军围困巨鹿
- 项羽破釜沉舟，断绝楚军退路
- 楚军背水一战，大破秦军主力

### ScriptInputBundle.hard_lane.must_include_beats

- 诸侯联军观望不救，秦军围困巨鹿
- 项羽破釜沉舟，断绝楚军退路
- 楚军背水一战，大破秦军主力

### script_text

> 项羽面对章邯的秦军主力，凭什么敢把楚军最后的活路全砸碎？巨鹿城下，诸侯军缩在营垒里死活不出，楚军再退一步就是全军覆没。秦将王离的重兵死死围困巨鹿，那些作壁上观的援军连一步都不敢迈，楚军被孤立在最前线，直面数倍于己的强敌，稍一退缩就会被碾成齑粉。项羽横下心，直接下令砸烂做饭的锅，凿沉渡河的船。士兵们回头一看，河里的船全沉了，地上的锅全碎了，退路连个渣都不剩。没饭吃，没退路，要么打赢吃秦军的粮，要么死在阵地上。绝望逼出了最凶狠的杀气，楚军士兵红着眼以一当十，直接扑向秦军阵地。连续九次冲杀，生生撕裂了秦军的防线，不可一世的秦军主力轰然崩溃。砸碎退路换来的胜仗，固然大破秦军，却也把楚军彻底绑死在了“只能一直赢”的战车上——再输一次，连口能做饭的锅都没了。

## yanzi-shichu

- canonical_title：晏子使楚：外交辞令下的尊严之战
- selected_angle：一人舌战群儒，为国安邦立威
- local_validation：pass
- semantic_review_shadow：pass
- topic_package_sufficiency：ok

### Final Candidate Preview

- 晏子使楚：外交辞令下的尊严之战：楚王故意安排从狗门入城，晏子当场质问 / 楚王以齐人善盗羞辱，晏子以橘生淮南为橘反击 / 楚王无言以对，晏子为齐国赢得尊严
- 晏子使楚：环境与人性：楚王以齐人善盗羞辱齐国 / 晏子以橘生淮南为橘反击 / 晏子揭示环境对人性的影响
- 晏子使楚：文化差异与理解：楚王利用文化差异羞辱齐国 / 晏子理解文化差异并巧妙应对 / 晏子以文化智慧化解冲突

### TopicPackage.must_include_beats

- 楚王故意安排从狗门入城，晏子当场质问
- 楚王以齐人善盗羞辱，晏子以橘生淮南为橘反击
- 楚王无言以对，晏子为齐国赢得尊严

### ScriptInputBundle.hard_lane.must_include_beats

- 楚王故意安排从狗门入城，晏子当场质问
- 楚王以齐人善盗羞辱，晏子以橘生淮南为橘反击
- 楚王无言以对，晏子为齐国赢得尊严

### script_text

> 楚王当众开狗洞逼晏子钻，齐国使臣若退一步，国家的颜面还往哪搁？楚王在城门设下矮洞，满朝文武冷眼旁观，就等看晏子低头受辱的狼狈。晏子看着眼前仅容犬类出入的侧门，停下脚步，丝毫没有怯场。他挺直腰背，当场质问：“使狗国者，从狗门入！”这七个字如利刃出鞘，直接将难题抛回——只有出使狗国才走狗门，出使楚国绝不走狗门。守卫脸色僵住，只能默默打开正门迎他入城。一计不成，楚王在朝堂上再生一计，他指着阶下押着的齐人盗贼，当着群臣的面讥讽齐人生性善盗。这是赤裸裸的族群羞辱，晏子若认了，齐国便是贼国。他反手抛出比喻反击：“橘生淮南则为橘，生于淮北则为枳。”齐人在齐国安分守己，一入楚国却成盗贼，恰恰是楚国这水土环境使人堕落。楚臣无人敢接话，楚王原本等着看笑话的笑脸彻底挂不住，僵在王座上无言以对。楚王费尽心机却无言以对，晏子用辞令守住的，不只是个人的站姿，更是齐国在强权面前的生存筹码。

## yanzi-shichu-repeat-2

- canonical_title：晏子使楚：外交官的尊严之战
- selected_angle：一人面对一国君主的羞辱，晏子如何用智慧捍卫国家尊严
- local_validation：pass
- semantic_review_shadow：pass
- topic_package_sufficiency：ok

### Final Candidate Preview

- 晏子使楚：外交官的尊严之战：楚王故意安排从狗门入城 / 晏子以'使狗国者从狗门入'反击 / 楚王以齐人善盗羞辱，晏子以'橘生淮南则为橘'回应
- 晏子使楚：文化差异的交锋：楚国以齐国礼仪为异 / 晏子以楚人视角解释文化差异 / 晏子以自然环境解释人性差异
- 晏子使楚：逆境中的外交智慧：楚王设置羞辱性外交场景 / 晏子以智慧化解不利局面 / 晏子以比喻揭示环境对人的影响

### TopicPackage.must_include_beats

- 楚王故意安排从狗门入城
- 晏子以'使狗国者从狗门入'反击
- 楚王以齐人善盗羞辱，晏子以'橘生淮南则为橘'回应

### ScriptInputBundle.hard_lane.must_include_beats

- 楚王故意安排从狗门入城
- 晏子以'使狗国者从狗门入'反击
- 楚王以齐人善盗羞辱，晏子以'橘生淮南则为橘'回应

### script_text

> 楚王把齐国使节堵在城墙下的狗洞前，晏子若低头钻过去，齐国的尊严就扫地了。楚国卫士冷眼拦住去路，只开旁边那扇矮小的狗门。晏子停在门外，目光扫过楚兵，绝不弯腰。他抛出一句：“使狗国者，从狗门入。”只有出使狗国才走狗门，楚国若开此门，便是自认狗国。楚王听闻汇报，只能硬着头皮下令打开正门。但羞辱并未结束，朝堂之上，楚王押出一名犯人，故意高喊此人是齐国盗贼。满朝文武紧盯晏子，目光刺人，就等这位使节面红耳赤下不来台。晏子却站起身，从容答道：“橘生淮南则为橘，生于淮北则为枳。”齐人在齐不盗，入楚为盗，正是楚国水土使人堕落。楚王两次设局，两次被当场顶回，气势全无。

## zhuanzhu-ciwangliao

- canonical_title：鱼腹藏剑：吴国权力更迭的刺杀之夜
- selected_angle：一次精心策划的宴席刺杀，如何改变吴国命运轨迹
- local_validation：pass
- semantic_review_shadow：pass
- topic_package_sufficiency：ok

### Final Candidate Preview

- 鱼腹藏剑：吴国权力更迭的刺杀之夜：公子光密室策划刺杀方案 / 专诸假献鱼腹藏剑刺杀王僚 / 专诸当场被杀与公子光夺权
- 宴席上的生死博弈：吴王僚的最后晚餐：吴王僚赴宴时的警惕与防备 / 专诸献鱼时的紧张对峙 / 刺杀现场的混乱与权力更迭
- 公子光的权谋：从隐忍到夺权：公子光长期隐忍等待时机 / 公子光寻找并说服专诸参与刺杀 / 刺杀成功后公子光的权力巩固

### TopicPackage.must_include_beats

- 公子光密室策划刺杀方案
- 专诸假献鱼腹藏剑刺杀王僚
- 专诸当场被杀与公子光夺权

### ScriptInputBundle.hard_lane.must_include_beats

- 公子光密室策划刺杀方案
- 专诸假献鱼腹藏剑刺杀王僚
- 专诸当场被杀与公子光夺权

### script_text

> 公子光面对戒备森严的王僚，动手只有一次机会，失手就是死局，剑该怎么送进宴席？密室昏暗，他死死盯住专诸，敲定了鱼腹藏剑的死令。公子光深知王僚护卫严密，寻常兵器根本近不了身，他将生杀的筹码全压在专诸身上，密定以烤鱼为掩护，将短剑藏入鱼腹。宴席之上，王僚身披重甲，左右亲兵持刀林立。专诸双手捧着热腾腾的烤鱼稳步上前，鱼香扑鼻之际，他猛然掰开鱼腹，抽出鱼肠短剑，暴起直刺王僚胸口！剑锋穿透重甲，王僚倒地毙命，而专诸瞬间便被左右亲兵乱刀分尸。血溅玉阶，公子光的伏兵趁势杀出，一举荡平王僚残部。专诸当场被杀，公子光踏着这具血肉之躯夺走王位，权力更迭的刺杀之夜，不过是拿一条命去填另一个权力深渊的开端。
