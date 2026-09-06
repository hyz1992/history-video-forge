# 任务 0：离线人工发声边界核验

日期：2026-09-06；dev 主工作区；审查级别 T2。TASK_BASE_SHA：d0e14f3c0db4fdc1ab03382aee036d92525ffbf8。

## 范围与最小实现约定

承接用户“按建议继续”：只使用已付费采集的两份自然段长稿，补齐设计 §2.4 和实施计划任务 0 的人工测量入口。没有新模型调用，不修改业务、已有原生时间、配置或 storage。初始工作区的 .claude/settings.local.json、.zcode/、q-tmp.mjs、storage 现有日志/成本文件保留，不纳入提交。

允许文件仅为本记录、实施计划进度、harness 的 narration-boundary-review.ts 及对应 tests/harness 测试、narration-timing/boundary-review-evidence.json。

1. 冻结两份采集的报告、原始事件、出站记录、PCM 与正文摘要；准备和评估均重新核对冻结原件，拒绝换音频、换文本或换输入策略。
2. 每组合固定抽取至少 30 个不同 token 的发声起点，覆盖首尾和分布位置；正文零时长等异常 token 必须保留。不是质量盲听评分，不复用原九次不同输入策略的人工结论。
3. 人工表不预填测量值、不展示原生时间作为测量答案。以完整 WAV 起点为 0、填写整数毫秒；明确未审、实测、听不到、无法确定及备注。数据不完整、重复或越界不得得出满足目标的结论。
4. 全部固定点实测完成才计算绝对偏差，P95 使用 nearest-rank（第 ceil(0.95*n) 个排序误差），目标 P95≤200ms、max≤500ms。缺失/不确定保留缺口；不会用原生值或 ASR 补空。
5. 输出只表示该长稿发声起点样本的测量结果，qualification 始终 unverified。全文听审、PCM 布局、发声终点、规范化语义与三稿盲听评分不由此工具授予通过；既有截断/零时长结构问题继续列出。

## 验收与证据

本次新增 33 个隔离 fixture/CLI 用例。先观察 29 项因入口缺失失败；新增材料写出保护用例先出现 1 项失败、32 项通过，随后完整回归 121/121（新工具33、检查器15、自然段诊断28、原资格入口45）。严格 TypeScript 检查退出0。

本机证据在忽略目录 `harness/scripts/runtime/output/narration-boundary-verification-20260906/`：red.log、pack-red.log、green.log（中间29项）、regression.log（最终121项）、typecheck.log、prepare.log、empty-evaluation.json、no-overwrite.json、tamper-check.mjs/log。

实际 prepare/evaluate 均零请求，生成两组合各30点；Qwen token-12-onset“了”保留。两组 status=pending、manual_onset_count=0、P95/max=null、qualification=unverified。Cosy source_mapping_mismatch/零时长引号与Qwen正文零时长仍在输出；没有按空表授予资格。对已生成目录再次prepare被拒绝，人工表hash未变；对10份原件逐份只在内存翻转一个字节，全部报review_evidence_changed，磁盘原件未改。

费用保持11次累计用量折价2.33198元，上限5元，余额2.66802元；本次新增请求0、新增费用0。未发供应商消息、未创建音色、未占用语气槽。

| 用户原始验收项 | 状态 | 本次证据/边界 |
|---|---|---|
| 按任务0小步实施，离线入口、测试、证据可复跑 | 已修 | 本次脚本、33用例、121回归、实际prepare/evaluate |
| CosyVoice与Qwen同轮同稿，保留现有付费授权边界 | 已修 | 冻结两份已有诊断原件的10个摘要；本次零外呼 |
| 截断问题解决、末句实际完整 | 未修 | 既有Cosy全文token缺失仍保留；实际音频尾部听审未收到 |
| 原生时间戳30边界人工精度与听感比较 | 部分修 | 已准备60点、提供测量校验及误差统计；人工真值0、听审/盲听未验证 |
| 任务0资格与模型/音色选择完成 | 未验证 | 未推荐赢家，所有qualification保持unverified |
| legacy/三入口/数据库/并发继承/分镜摘录/renderer/整篇只播一次 | 未验证 | 任务1尚未开放，本次未触碰业务实现 |

## 使用方式

项目根目录执行，以下命令不加载密钥、不外呼：

```powershell
node node_modules/tsx/dist/cli.mjs harness/scripts/runtime/narration-boundary-review.ts --prepare harness/scripts/runtime/output/人工核验新目录
node node_modules/tsx/dist/cli.mjs harness/scripts/runtime/narration-boundary-review.ts --evaluate harness/scripts/runtime/output/narration-boundary-review-20260906/review.json
```

本机已准备的 `narration-boundary-review-20260906/README.md` 说明完整WAV路径和测量步骤；在 `review.json` 填写 status/measured_ms/reviewer/note。时间是完整音频起点后的整数毫秒；只测括号标定token的实际发声起点。不要按reference.json原生值抄答案。无法定位填uncertain，实际未发声填inaudible，两者均不补时间。这里不是质量盲听入口。

表中测量须由实际听审者负责；本工具只能核验数据一致性和计算统计，不能证明填写者确实进行了听审。仅对这两份自然段长稿有效，不把原9次不同输入策略的结论混用。P95/max不覆盖未抽到的位置及发声终点；PCM布局、完整性、三稿音质评分仍单独验收。

## 自审与独立审查

自审：只改允许的5个文件；没有改变原生时间、补ASR、提高覆盖率容忍或绕过任务0。同模型、新上下文 diff/contract 初审均 Critical 0 / Important 0 / Minor 0，无需整改（整改复审0轮）。代码审查独立重跑121项及严格类型检查，合同审查核对10份冻结摘要；两者均复核WAV data与PCM一致、空表状态未验证。审查前后5文件hash和git status一致。候选1（e5f1e70d422f7f5b3cb5557ce2a02fba04266c2f）终审阶段一因读取范围失误接触执行进度，审查者主动中止、未评定代码finding，不构成有效终审。按流程Important缺口处理并重开候选：原始合同片段预先独立抽取，第一阶段仅可读该片段和3个代码/测试/冻结索引文件，不读计划/记录全文或执行证据；阶段二再核对全部文档diff与验证。片段机器检查排除了执行进度、测试结果和审查叙事（phase-one-packet-proof.json）。此项为第1轮整改复审，未修改代码或统计规则。diff/contract累计复审均Critical 0 / Important 0 / Minor 0，流程缺口闭合；片段最终SHA256为2fa04c3de73de439bf2bb2b8fa3ac7f2cbace67574d00d8e6b4788b175f05637。候选2的有效终审见下节。任务0整体未通过；下一步需要真实听审/测量反馈并处理供应商截断和零时长问题，不能因本工具完成进入任务1。


## 固定候选终审（机械落盘）

FINAL_REVIEW_CANDIDATE: f886d7d73293f2afd9893a1cea3c1ab638f70ab9

FINAL_REVIEW_COUNT: 2

FINAL_REVIEW_ABORTED_COUNT: 1

FINAL_REVIEW_COMPLETED_COUNT: 1

REPAIR_REVIEW_ROUNDS: 1

FINAL_REVIEW_RESULT: Critical=0 Important=0 Minor=0

总共两个候选周期：候选1的终审阶段一因输入隔离失误中止，未评定finding；第1轮整改复审闭合该流程Important后，候选2由全新上下文审查者完成同一次R5两阶段终审。先独立核对原始合同和代码，形成0/0/0 finding，再核对全量文档diff、原件和验证。不能把中止的一次隐去或算作有效终审。

最终审查独立核对10份原件摘要、18条同稿输入、两组各30固定点及Qwen异常点、WAV data/PCM逐字节一致；实际回归日志4文件121/121、独立严格类型检查退出0、只读evaluate退出0且与存档一致。两组人工实测仍为0、P95/max=null，原结构问题保留。五文件及工作树只读不变；有效终审Critical 0 / Important 0 / Minor 0，限定离线入口通过。任务0整体与模型资格仍未通过，任务1继续关闭。

本次提交仅机械记录终审，不改变代码、协议、命令或计划；人工表/原始音频仍不提交。下一步由实际听审者填写核验表并核对完整性，另处理供应商截断与零时长问题；没有新增付费调用。

## 用户局部听审补充（2026-09-06）

本次仅归档听审反馈，审查级别T0，任务基准565f1d3db218ade1c18acca838093abf4e48fbbc；不修改代码、音频、原生时间或资格门。用户依前次播放顺序反馈：CosyVoice为“傍晚，城门外的人看到一条粮船靠岸...”，Qwen为“孩子从队伍里跑过...”。引文保留用户原话和省略号；原文第一处写作“看见”，不据此判读错字或改写规范化规则。

| 核对项 | CosyVoice 龙三叔 | Qwen 龙翼暮凌 |
|---|---|---|
| 相关原文UTF-16起点 | 1541（“傍晚”） | 1684（“孩子从队伍里跑过”） |
| 既有12秒试听范围 | [232900,244900)ms | [337700,349700)ms |
| 相关token原生开始时间 | 232740ms（“傍”） | 338130ms（“。孩”token） |
| 原生token记录尾部 | “县令亲自站在秤旁，仓吏在”，最后token结束244020ms | 记录覆盖“今天的门开了，明天的路，还得有人去走。”，最后token结束349570ms |

两处定位都靠近试听片段开头；上述时间全部来自已有原生事件，不是用户人工测量。用户省略号未明确表示音频停止处，因此只能记为听到相应段落，不能据此认定Cosy停在“傍晚”或Qwen停在“孩子”，也不能认定Qwen末句已完整朗读。已向用户澄清：这些是片段开头还是实际结束内容，以及Qwen是否读完原稿末句；待回复。

只读复核：两份完整WAV的data均与PCM逐字节相同；两份tail WAV的data均严格等于相应PCM最后576000字节（按现有布局假设为12秒）。尾段data SHA256分别为bd1e28b8e0d3bc915616a065842fa322297416cde082744bd6caf19562a581e7、2d358b597d5134fe54655104de7e43d0585737f9b4d22403add4789c2bdf530b。摘要与定位存于忽略目录 narration-boundary-verification-20260906/user-listening-fragments.json。

验收状态：局部试听反馈已收到；末句完整性未验证，30点人工测量仍为每组0，P95/max未验证；既有Cosy正文映射缺失与Qwen零时长问题不变，任务0资格和比较门未通过，任务1保持关闭。本次新增付费请求0，累计用量折价仍2.33198元。

自审：仅本记录与计划进度两处文档变更，未改历史终审结论；将用户听辨、原生元数据、推断与待确认项分开记录。T0不启动审查子代理，不重复运行未改代码的测试；检查原件对照和git diff --check。

## 用户确认实际音频末句（2026-09-06）

任务基准615c5ad30a840514bb6281c28515f0f47c90fa55，审查级别T0。本节更新上一节“停止处待确认”的状态。用户明确说明此前只摘写了片段开头；实际完整听到了CosyVoice的“县令亲自站在秤旁，仓吏在”和Qwen的“今天的门开了，明天的路，还得有人去走。”。这是用户听审反馈，不是执行者自行听辨。

| 验收项 | 状态与证据 |
|---|---|
| CosyVoice 龙三叔本次样本末句完整性 | 未通过：实际音频停在“仓吏在”，与原生token尾部一致；原稿后续内容及最后一句没有到达，实际截断得到听审确认 |
| Qwen 龙翼暮凌本次样本末句完整性 | 通过（仅末句子项）：用户确认完整说出原稿最后一句，与原生记录覆盖结尾一致 |
| 整篇没有漏读、重复、错读、跳音或衔接异常 | 未验证：末尾12秒听审不能证明中间全文质量 |
| 正文零时长词、30点人工精度与三稿比较 | 未验证：Qwen“了”原生零时长问题仍在；两组人工边界测量仍各0，P95/max无人工结果，盲听评分未完成 |
| 任务0整体资格与任务1开放 | 未通过：不把单一样本末句通过变成模型合格或音质优胜，任务1仍关闭 |

结论仅绑定本次各一个WS任务、18条自然段输入的两份长稿采集，不追认一次全文输入策略已解决，也不外推其他音色。当前剩余工作转向原生零时长定位、真实边界测量及全文质量核验，无需再询问这两段末句是否读完。

只读验证：冻结PCM摘要仍匹配，两个尾部WAV data仍逐字节等于对应PCM后缀且摘要与此前一致。新增听审证据在忽略目录 narration-boundary-verification-20260906/user-tail-listening-confirmation.json，保留此前片段反馈文件，未写入人工测量表。

本次仅修改本记录和任务0进度，检查git diff --check；T0自审，不重复测试未改代码，不修改既有终审记录。本次新增模型请求0、费用0，累计用量折价仍2.33198元，保留用户现有配置、临时文件与storage。
