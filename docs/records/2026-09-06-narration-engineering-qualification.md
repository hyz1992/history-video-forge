# 任务0机器工程资格结论

日期2026-09-06；基线0f43b7216a6367f1d04ce0944e64a030ccebb8ea，dev。T2资格结论审查，当前为待终审候选；不修改供应商原件、生产配置或业务代码。用户当前已明确确认三份旧合成音频向阿里云北京各核验一次，本次已执行，无重试。

## 适用合同

按调用前已冻结的[机器工程资格门](./2026-09-06-narration-audio-acceptance.md#在听审调用前固定的替代证据门)六项联合判断。人工30点与35/25/20/10/10偏好总分不伪填；机器交叉一致性不是人工绝对精度。声音负对照只验证本轮明显循环故障的观察适用性。发布前事实核查、人工编辑及最终成品体验不属于本轮供应商样例资格。

候选结论：Qwen龙翼暮凌仅在本报告冻结样例和基准参数范围内满足机器工程资格，可作为后续narration新模式的唯一合格推荐候选；这是资格筛选，不是跨模型盲听音质优胜。不修改全局默认、legacy自动候选或已有项目。正式终审完成前不进入任务1。

## 冻结组合与输入方式

| 字段 | 值 |
|---|---|
| candidate_id | qwen-yimuling |
| model | qwen-audio-3.0-tts-plus |
| voice | qwen-audio-3.0-tts-plus-longyimuling（龙翼暮凌） |
| region / protocol | cn-beijing / dashscope_ws |
| endpoint | wss://dashscope.aliyuncs.com/api-ws/v1/inference |
| parameters_version | neutral-pcm24k-v1（既有manifest版本，另受本表输入约束限定） |
| parameters | text_type=PlainText、format=pcm、sample_rate=24000、rate=1、pitch=1、volume=50、word_timestamp_enabled=true、enable_ssml=false、seed=0 |
| 实测PCM | 16bit、mono、24kHz；WAV data与PCM一致 |
| 输入 | 同一WS任务按自然段顺序continue-task，拼回原文完全一致，一次finish-task；短/中各1条、长18条 |
| 时间适配 | narration-native-spans/v1；保留raw与来源，零点仅按已验证共享原生端点归并，不造毫秒 |
| 未开放 | 语气、其他语速/音调/参数、其他音色/模型/区域、单条超长输入资格 |

只有上述参数及输入方式有本轮证据。长段落切分/生产adapter和新项目策略仍在后续任务实现、测试；不得把本记录当作已完成生产接线。

## 逐项验收候选

| 原始要求 | 状态 | 直接证据 |
|---|---|---|
| 同一任务、完整音频、全文映射 | 已修（样例范围） | 短/中原qualification报告，长paragraph报告与outbound同task/18条/一次finish；三份source/WAV/PCM/事件摘要一致 |
| 原生片段正时长、单调、范围和来源完整 | 已修 | 短/中/长142/468/1513片段，142/469/1514合法边界；长仅“起了”2240–2480ms归并，raw“了”零点保留且内部不可切 |
| 无提示ASR全文差分无未解决明显缺读/重复 | 已修（机器交叉证据） | 长删除0/同音替换9/插入2；原盲E/F两处只出现一次“开”/“一”，与native一致，ASR原差分保留 |
| 至少30有效同文发声起点，P95≤200/max≤500 | 已修（机器一致性） | 1423有效锚点，P95=90ms/max=379ms；ASR零点/重叠保留并排除，人工字段仍空 |
| 隐藏中段循环故障必须拒绝并定位 | 已修（该类故障） | K原回答false、major、133秒；故障134–142秒250ms片段重复32次，窗口外不变；已绑定独立裁决 |
| 短/中/长全段声音各达到冻结门 | 已修（待终审复核） | L/M/N分别true、5/5/5、issues空；均明确全程，limitations为设备/环境、主观偏好及不对照原稿校对内容的职责限制，无未解决声音不确定项 |
| 不伪填语气/人类偏好，不提前改默认 | 已修 | 原人工字段及旧原件保持，未测语气不开放，业务与seed未改 |
| 任务1–12真实业务/浏览器/成品 | 未验证 | 本次仅供应商样例资格，不代表业务完成 |

CosyVoice龙三叔与龙安洋已完成同稿基础9项矩阵中的对应观察，当前组合不合格：全文缺失/原生时间问题未消除。龙三叔自然段长稿仍native_text_mismatch、ASR删除522；P95=220ms/max=1640ms仅作诊断。此结论不推断模型永不可修；不追加TTS或继续刷失败评分。

## 真实声音响应与费用

| 匿名项 | 范围 | acceptable | 自然/连贯/发音 | usage音频/文本入/文本出 | 折价元 |
|---|---|---|---|---|---|
| K | 349.70秒故障对照 | false | 2/1/4 | 2445/497/473 | 0.151984 |
| L | 34.69秒正常短稿 | true | 5/5/5 | 240/497/344 | 0.029959 |
| M | 107.65秒正常中稿 | true | 5/5/5 | 751/497/312 | 0.055762 |
| N | 349.70秒正常长稿 | true | 5/5/5 | 2445/497/343 | 0.146784 |

四份均固定qwen3.5-omni-plus-2026-03-15，身份唯一、stream_state=complete、stop/末尾DONE/最终usage完整且原文可由SSE重建。原数组解析器因limitations字符串保留capture.status=failed/review=null；格式兼容独立decodeObservation有效，N的JSON围栏也已兼容，不改原采集状态或原文。

本次3请求新增0.232505元；含K新组共4请求0.384489元，低于0.65元。历史3.0021288元加本组，累计3.3866178元，剩余1.6133822元，总预算5元；按最终usage×冻结53/7/40元每百万token核算，非账单。新组权威合并账本为narration-omni35-samples-live-20260906/result.json，已包含K，不能再加probe账本或pending预留。

原TTS观测费用/耗时：Qwen短0.04312元/9252ms、中0.14014元/30098ms、自然段长0.45556元/87715ms；龙三叔自然段长0.3254元/67588ms但不合格。基础9项完整费用和elapsed仍见原qualification报告；耗时不作为稳定性统计。TTS累计2.33198、ASR0.11968、旧Omni14次0.5504688、新Omni4次0.384489，合计3.3866178元。

## 证据与局限

- 原生：output/narration-native-span-evidence-20260906/的qwen-short/medium/long.input.json、replay.json和round1-replay-summary.json；原短/中事件在narration-qualification-live-20260905-r1-continued，原长在narration-paragraph-live-20260906。
- ASR：output/narration-asr-live-20260906/comparison.json及原响应；争议局部盲转写在narration-audio-review-blind-live-20260906/sample-e、sample-f。
- 声音：output/narration-omni35-probe-live-20260906及narration-omni35-samples-live-20260906；执行前冻结在narration-omni35-evidence-20260906/samples-before-live。根独立重放和费用复算见narration-qualification-final-evidence-20260906/root-sound-replay.json。
- 代码最近受影响回归：8文件319项（新工具80项）及strict tsc通过，证据narration-format-compatibility-evidence-20260906/round1-regression/typecheck.json；本次未改代码，不无故重复付费或测试。

单次隐藏故障不能证明评分普遍可靠；本轮不声称人工绝对精度、审查代理直接听音、精确循环词转写或人类偏好。专项声音审查首次误读旧acceptance记录全文，已记录为输入范围异常，其结论仅为专项辅助；最终资格须由另一个新上下文按R5两阶段独立终审核对，不能以历史结论代替原件。

补充证据边界：短/中历史采集未单独保存outbound journal，发送次数由已验证采集源码、单任务事件和完整source回显交叉支持；长稿有逐条实际发送日志。不能声称三稿都有完整出站wire。Cosy末端“旁边记下”仍存在ASR/盲转写与用户/native的局部矛盾，大范围缺读结论不依赖该局部。

## 候选1最终闸门：任务0机器工程资格通过

- 被审SHA：d721648058c80461f2baf0e26759889fe11c6663；TASK_BASE_SHA：0f43b7216a6367f1d04ce0944e64a030ccebb8ea。三份候选文档与冻结摘要一致，本节只机械记录最终结论，上文“待终审”是候选形成时点状态。
- 原生/ASR及声音两个专项均C0/I0/M0；文档初审合计C0/I0/M1（L内容校对职责限制摘要遗漏），整改轮1两项完整累计复审均C0/I0/M0。有效R5两阶段终审1次，C0/I0/M0，阶段一仅原始需求与源码，阶段二先独立重算原件再读候选文档，没有使用专项历史全文输入异常作为终审来源。
- R5逐项A–G已修（限定机器样例资格），H业务1–12未修/未验证。独立重算三稿142/468/1513原生片段、1423锚点90/379ms、ASR差分及K–N全SSE和控制PCM，与候选一致；319项实际回归及strict tsc证据核对通过。
- 正式结论：可以结束任务0机器工程资格验收，依既有连续实施授权进入任务1。冻结组合、基准参数、自然段同任务输入及narration-native-spans/v1边界保持；不授予未测语气/参数资格，不改变全局默认，不宣称业务、浏览器或成品完成。
- 费用最终核对：本次3项0.232505元；新组含K共0.384489元；累计3.3866178元，余额1.6133822元，非账单。原capture failed/review=null保持；短中无单独outbound日志、机器一致性非人工精度、单故障样例局限与Cosy尾部矛盾全部保留。
