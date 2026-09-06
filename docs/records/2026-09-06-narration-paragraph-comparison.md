# 任务 0：已授权的自然段输入对照

日期：2026-09-06；dev主工作区。TASK_BASE_SHA：fe2752a3dbe4d1302c3f6c1c2e0e37209ce7947e。审查级别T2。

## 授权与范围

用户在获知截断尚未修复、两次自然段对照预计0.78096元且总费用不超过5元后明确说“那请你继续”，本轮执行已提出的具体调整。前置提案见[上一轮诊断](./2026-09-06-narration-timing-diagnostics.md)。只比较 cosyvoice-v3-flash / longsanshu_v3 与 qwen-audio-3.0-tts-plus / qwen-audio-3.0-tts-plus-longyimuling，同一1740 UTF-16长稿各一次；每次一个WS任务、18条continue-task、一个finish-task。分段只按原17个换行，18段连同原换行拼接严格等于原文，不建立18个TTS任务，不拼接独立合成结果。

新增2次诊断授权与原9次矩阵分开记录，不借用原语气试验槽；不重试、不创建音色、不自动执行第三次。本项上限1元，总授权上限5元；既有9次usage折价1.55102元，本项估价0.78096元，2倍正文调度预留0.83520元。预留不是供应商账单保证；未知费用占满本项余额并停止，已知费用超过预留时下一项会在派发前重新检查余额。实际账单与免费额度未核实。

[官方客户端事件](https://help.aliyun.com/zh/model-studio/cosyvoice-client-events)允许同任务分段发送；[北京价格表](https://help.aliyun.com/zh/model-studio/model-pricing)于2026-09-06复核，两模型仍为1元/万字符及1.4元/万字符。生产设计的一次全文输入暂不改变；这是已授权的诊断例外，未确认有效前不扩大为生产策略。

## 实现与最小验证

本轮只改8文件：独立脚本 narration-paragraph-diagnostic.ts、对应测试、冻结 paragraph-diagnostic.json、本记录、设计§2.3的诊断例外注记、实施计划任务0进度和两个README入口。既有采集器/诊断检查器、业务dispatcher/legacy目录、DB、UI、renderer不改。用户.claude/settings.local.json、.zcode、q-tmp.mjs及storage既有改动不动。

脚本复用captureTask接收及累计usage逻辑，独立包装出站send，把原continue-task的全文替换为18条顺序文本消息；run-task/finish-task不改。保留每条出站的task ID、段落长度/hash及send是否返回成功；接收原始事件及连续PCM原样落盘。manifest与原矩阵绑定，固定两组和参数，正文/段落/既有report hash均在真实外呼前校验。CLI没有输出目录/模型/音色切换参数，真实目录固定且独占创建；重复/并发启动失败，不自动恢复已派发前缀。

缺省/--dry-run零网络。显式调用命令：

~~~text
node --env-file=.env node_modules/tsx/dist/cli.mjs harness/scripts/runtime/narration-paragraph-diagnostic.ts --live --confirm-live --max-requests 2 --max-cost-cny 1
~~~

原文/密钥/音频不入Git。运行目录为 harness/scripts/runtime/output/narration-paragraph-live-20260906/，离线验证日志为同级 narration-paragraph-verification-20260906/。

TDD：首22项因缺少入口明确失败，之后CLI负例暴露同步解析异常未转JSON，修复后26项通过；独立审查再发现完成账本ID被供应商ID覆盖，新增null/UUID两项红→绿测试后改为分别保存计划request_id和provider_request_id。五文件回归实际101/101（新28+旧采集器45+离线检查器15+旧live入口3+旧provider10），严格ES2022/ESNext/Bundler TypeScript检查两个新TS文件退出0；原始输出见regression.log、typecheck.log。dry-run.json为零请求冻结计划；input-proof.log已验证真实长稿18段拼接相同及旧报告usage折价1.55102元。初审diff发现Important 1（账本身份），无其他Critical/Important；不变量为供应商ID不得改变派发与完成的计划ID关联，两个反向测试核对四行准确ID和独立provider_request_id。第1轮整改后diff/contract对完整累计8文件复审均为Critical 0 / Important 0 / Minor 0，确认可执行限定诊断。

## 真实结果与验收

两次调用均成功结束，无重试或第三次。实际usage均3254，折价分别0.32540/0.45556元，本轮合计0.78096元；累计11个供应商任务、usage折价2.33198元，原5元上限内尚余2.66802元。此处按usage及冻结价格计算，不是账户实付账单。原语气试验仍未执行。

| 同稿组合 | 原一次全文输入 | 本轮18段输入 | 本轮结论 |
|---|---|---|---|
| CosyVoice 龙三叔 | 66.88秒、2句块，全文token缺失 | 244.9秒、19句块，1,107 token文本合计1,113 UTF-16 | 输出增多但截断问题未修；四句块仍各33.44秒，token尾部停在“仓吏在”，未到正文末句 |
| Qwen 龙翼暮凌 | 197.33秒、2句块，尾部1,138 token严格等分 | 349.7秒、18句块，1,514 token文本合计1,723 UTF-16 | 去除明确的17个换行后全文仍严格相等（旧样本也已相等）；旧长等分现象本轮消失，但正文“了”存在零时长，仍未过时间资格门 |

两组合均为一次run-task、18条continue-task、一次空input的finish-task；出站20条记录全部sent=true、task ID一致、每段hash/长度匹配冻结manifest。返回original_text按句拼接均严格等于原1740 UTF-16正文，证明输入收齐，但不能以服务端回显当实际朗读证明。两份保存PCM逐帧完整，WAV的data块与PCM hash相同；16bit/little-endian/mono/24kHz仍按当前布局假设封装，保留听审确认要求。未调整音频速率或原生时间戳。

Cosy仍受限的句块（源区间为UTF-16半开区间）：

| 句序号 | source范围 | source长度 | token文本长度 | PCM时长 |
|---|---|---:|---:|---:|
| 5 | [205,395) | 190 | 149 | 33.44秒 |
| 7 | [426,771) | 345 | 170 | 33.44秒 |
| 13 | [924,1347) | 423 | 167 | 33.44秒 |
| 18 | [1437,1740) | 303 | 159 | 33.44秒 |

输入每段89–105字符，服务端仍将部分段落合并成190–423字符的句块；18条输入消息不保证18个独立句块，也不保证句块被控制在原段长度以内。可以确认输入消息划分影响输出，但尚不能确认托管服务内部截断上限、参数或修复方式；没有杜撰max_tokens、改超时或私自加节流重跑。

本轮直接枚举所有起点、连续且时长差≤1ms的候选子段，最长只有Cosy 5 token / Qwen 13 token，因此本次没有≥32 token严格等分段；此项补充核验解决检查器非穷举可能漏检的证据局限，但不能证明实际边界准确。Cosy还有两个零时长引号token；Qwen ordinal12的“了”为[2480,2480]ms，前“起”[2240,2480]，后“一”[2480,2640]；原始对象没有音素字段可供核验，未通过合并/插值猜出其发声区间。

完整复跑材料：narration-paragraph-verification-20260906/inspect-captures.mjs读取新报告与原始PCM/事件，调用既有离线检查器；live-inspection.json保存两份结果，live-inspection.log为输出；text-comparison-details.json、segment-facts.json和media-verification.json保存上述具体对照。正式报告/attempts、两份PCM/WAV、原事件和outbound均在narration-paragraph-live-20260906/。所有这些含原文或媒体的材料留在Git忽略目录。

已提供两组最后12秒供用户核对：Cosy [232.9,244.9]秒、Qwen [337.7,349.7]秒。尚未收到听审结论；人工边界数仍为0，P95/max、长文连贯性和盲听评分保持未验证。没有把Qwen明显改善等同于最终音质优胜或生产合格。

| 原始要求 | 状态 | 证据 |
|---|---|---|
| 执行已批准两次同稿诊断 | 已修 | 两条dispatch及对应完成记录，出站各20条，raw任务成功结束 |
| 修复截断 | 部分修 | Qwen全文映射仍完整、旧长等分现象本轮消失；Cosy仍有四句块受限、token末句缺失，未修好 |
| 原生时间轴资格、人工听审与30边界 | 未验证 | Qwen正文零时长，人工真值0，不插值或跳过资格门 |
| 预算与禁止重试/扩矩阵/音色创建 | 已修 | 本轮2次0.78096元、累计2.33198元；无第三次，原语气槽未动 |
| 测试、旧入口保真及数据保留 | 已修 | 101/101+严格tsc，旧采集器/业务无diff，用户配置/数据未提交 |

下一步先补实际听审与边界真值；已备可提交给供应商的最小复现信息（准确组合/任务ID/参数/源范围/原始事件），尚未对外发送。任何新增付费试验须先冻结具体变化并获得授权，不因尚有余额自动扩大矩阵。任务0整体未通过，不进入任务1。


## 自审与独立审查

本任务累计有效finding为Critical 0 / Important 1 / Minor 2；共3轮整改复审，未超过上限。

| 时点 | finding与处置 | 复核 |
|---|---|---|
| 初审→第1轮 | Important：完成账本计划ID被provider ID覆盖；以null/UUID两个反向用例红→绿闭环 | diff/contract均0/0/0，101项回归及strict tsc通过后才执行两次live |
| 实测补交→第2轮 | Minor：记录音色中文名与冻结manifest不一致；改为龙翼暮凌，实际voice ID一直正确 | manifest标签+rg双来源核对；contract 0/0/0，diff补充下一项文档Minor |
| 第3轮 | Minor：将旧样本已经完整的文字映射误写为本轮改善；改为仍完整，本轮变化是旧长等分消失 | 新旧原始token拼接各1723字符且相同；diff/contract均0/0/0 |

源码/测试在101项回归后未再改变；后两轮只有文档修正，不重复跑无关测试。审查者均为同模型、新上下文，只读；最终状态与起始用户无关改动相符。候选提交后进行一次R5两阶段终审，结果另作纯记录提交。此处通过范围仅为限定诊断实现/执行/证据，未声明截断或任务0整体完成。

## 固定候选终审落盘

被终审候选：700b208d3ebb1920d7f379611b09c7a3aa4da6a3；TASK_BASE_SHA：fe2752a3dbe4d1302c3f6c1c2e0e37209ce7947e。整改复审3轮，候选收敛周期1个，final调用1次（同一审查者R5两阶段），终审Critical 0 / Important 0 / Minor 0。独立核对原始出站/入站、PCM/WAV、账本、红绿日志与101/101输出，并独立严格类型检查退出0后，仅限定诊断实现、两次执行及证据记录通过。截断未整体修复，任务0整体未通过，任务1保持关闭。

本节仅机械记录终审，未改变候选代码/协议/输入或追加调用。落盘前检查：候选SHA与当前HEAD一致、候选引用唯一、final计数为1、累计8文件与授权范围一致，本次提交只含本记录。
