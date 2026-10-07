# 分镜与全局美术状态职责验收

日期：2026-10-08。项目：`79e6c95d-79d9-41b0-9503-ac52bf0c24c0`，玄奘失水绝境。

## 本批实际结果

用户批准继续上一轮建议：身体动作与事件先后由已确认分镜负责，全局美术只安排稳定身份、服饰造型、衣物使用痕迹与负载/物件延续。正式global v1.10.0和segment v1.8.0分别实施、验证、独立审查并提交。分段还明确镜内变化从可承接变化的起始锚点按原先后展开，不倒推补前情，也不因定格丢掉转折。没有修改shared schema、输入builder、compiler、模型配置或业务调用策略。

一次真实Flash global取得完整JSON，正式结构通过；根代理和独立审阅者整体 **fail，C0/I2/M0**：

- **I1：水囊载位仍相互矛盾。** 顶层`art_bible.consistency_notes[0]`及`manual_review_notes[2]`声明唯一左肩斜挎、右腰垂落，但顶层notes[2]又在sb_002–006写“挂回玄奘身上（或系于马鞍侧）”；`props[0].visual_description`也并列身上或马鞍两种方式。声明不能覆盖实际执行字段的任选关系。
- **I2：全局仍另写竞争动作链。** 顶层notes[8]前半段准确引用老马先偏向，后半段却写“人拉缰—马偏行—人跟随”，与原sb_008马先偏向、玄奘再拉缰不回、随后跟马竞争，且超出本次全局物件延续职责。结尾“不重写动作先后”的声明不能消除正文歧义。

普通行囊、行囊唯一右肩左腰、局部合理可见、旧衣休整保留及稳定身份/普通推断这些global文字局部项通过。上一批明确把凉风缓力移到sb_009的表达未再出现；notes[3]跨007–009的“随行或随人马一同倒卧”范围含混，不据此断言三镜都被安排为倒卧，也不另计问题。完整身体/镜内动作仍需分段实际验证。

按已批准失败停止条件，四chunk、完整编译、媒体执行器及三图均取消。没有新增图片、H3、TTS或合成视频，未做内置浏览器实图、音轨或成品验收；原项目未激活。**本批只确认合同实施及上述文字局部项通过，视频质量问题尚未整体解决。** 没有修改本模型结果当作pass，没有重试或追加容量对照。

一次gateway、一次HTTP POST，新用量保守估算 **0.120938元**；累计含历史失败预留 **48.5443075元**，距50元剩 **1.4556925元**。完整usage将本次预留0.218876元结算为用量估算，随后人工语义fail不重复计费。历史失败预留保留；供应商账户扣款未核验，产品费用表未更新。

[设计](../plans/archive/2026-10-08-visual-state-ownership-design.md)和[计划](../plans/archive/2026-10-08-visual-state-ownership-plan.md)已关闭归档。实验目录`storage/visual-state-ownership-acceptance-20261008/`全部为生成态，不stage/提交；其README、自审及preparation-integrity为付费前准备快照，当前结果以实际response、人工review、账本及关闭证据为准。

## 实施与核验

| 项目 | 实际证据及范围 |
| --- | --- |
| 中文设计/计划 | `6ba56c04`，独立设计及计划审查通过；起始锚点/镜内先后边界、sb_007起点图片验收及金额精度修正均经审查。直接dev，无分支/worktree |
| 全局职责 | `13ba3f04`：global prompt、中文changes、既有合同测试三个文件。v1.10.0只收敛身份/造型及场景状态职责，第二条唯一携带规则原文保持，其他规则/骨架不改 |
| 分段职责 | `c4b79847`：segment prompt、中文changes、同一合同测试三个文件。v1.8.0仅替换状态前两条，缺省/冲突规则及其他规则/骨架保持；其他三个it保持 |
| TDD | 全局红exit1、2失败/2通过→绿exit0、4/4；分段红exit1、1失败/3通过→绿exit0、4/4。日志`storage/state-ownership-{global,segment}-tdd-20261008.{red,green}.log`；只证明合同存在，不判真实语义 |
| 正式独立审查与fresh回归 | 两子任务分别顺序规格→质量均Approved C/I/M0。根代理全局最小90/90；最终六文件195/195，23prompt/12fixture治理exit0；`f780cbf7`回填，storage保留真实日志 |
| 同源零费用控制器 | `960252d1`记录准备通过。新身份、91件保护、6份原生口播副本；旧planner/media-preparation字节相同。实际五源diff及Root final-prepaid离线16项、audit、verify exit0；付费前history/gateway/HTTP/新费用0 |
| 金额控制整改 | 新实验初次红exit1证明三次0.20浮点误拒→整数比较绿exit0；初轮质量I1发现固定换算容差接纳真实超精度，根代理复现。新增ULP红exit1→量级double误差界及正金额不归零绿exit0，原红绿保留。顺序规格→质量复审Approved C/I/M0；账本/价格/上限/锁/派发不改 |
| 预算及输入 | 基线48.4233695，新上限1.55（LLM0.95/条件三图0.60），最大49.9733695。global实际完整messages41,854字节，输入上界43,902、输出16384，预留0.218876元；maxAttempts1 |
| 真实结构 | HTTP200、finish=stop，node真实exit0；正式schema/normalization完成并捕获首chunk零网络预览，未实际派发chunk。没有repair、regen、安全重试或额外HTTP |
| 真实人工审查及停止 | [global人工fail](../../storage/visual-state-ownership-acceptance-20261008/reviews/global.json)绑定实际response/structure SHA；独立`state_ownership_text_review`直接读全部parsedOutput及11镜，C0/I2/M0。`preview chunk_001`真实exit1、manual_review_not_passed，费用次数不增 |
| 来源与关闭 | 最终fresh verify exit0、history/HTTP各1：[真实输出](../../storage/visual-state-ownership-acceptance-20261008/final-verify-output.json)。91件/原DB及存在WAL、关键配置/活动指针、6口播副本保持；[关闭证据](../../storage/visual-state-ownership-acceptance-20261008/batch-closure.json)列出所有取消及未验证项 |
| 最终独立收口审查 | state_ownership_spec_review只读Approved C/I/M0：实际字段、SHA绑定、usage/费用、91保护/6副本、DB/WAL与13个本地链接均核对；该批准只覆盖记录，不改变真实global C0/I2/M0 fail。根代理最终fresh verify及cached diff检查通过，正式四文档精确中文提交，storage不提交 |

正式prompt trimmed body SHA：global `42c89329e991af67b1a7fd60c868aed8bec355a138b864f570a5d42d61678a7a`；segment `4672ffc80ada16343fe88ecb387ae4d95f2822d4be6b31c493c5eb09f550a4e4`。独立实验身份`72eebaaf-9206-4234-a29a-472ddc89e0cc`与原记录及四个旧run不同，未安装进数据库。

根代理实际运行：

```powershell
npx vitest run --configLoader runner --no-file-parallelism tests/backend/asset-planning/asset-planning-generation.test.ts tests/backend/asset-planning/character-identity-prompt-contract.test.ts tests/backend/asset-planning/asset-plan-intent-compiler.test.ts tests/backend/asset-planning/narration-reference-compiler.test.ts tests/backend/assets/narration-manifest-importer.test.ts tests/backend/asset-planning/segment-intent-prompt-input.test.ts
npm run harness:check-prompts
node --import tsx storage/visual-state-ownership-acceptance-20261008/offline-verification.mts
node --import tsx storage/visual-state-ownership-acceptance-20261008/planner.mts verify
```

离线16项只在付费前运行（history为空前提），付费后只verify。PowerShell先保存node退出码再清理env并显式exit；next-stage预览exit1是人工fail闸门拒绝，不是第二次付费调用。隔离fixture的假锁/response/review仅用于拒绝测试，不是模型产物或语义通过证据。

## 原始诉求逐项验收

| 诉求 | 状态 | 实际证据与限制 |
| --- | --- | --- |
| Flash选项与默认 | 已修（前批） | [设置验收](./2026-10-05-llm-flash-options-acceptance.md)；本批直接Flash，未重验UI，原项目显式Pro配置保持 |
| 系统状态职责与镜内起点 | 已修（正式合同）；实际部分修 | 两prompt及195项验证通过；global真实仍有I2竞争动作链，segment新合同未实测 |
| 普通行装需求/形态 | 已修（本global文字） | props[2]粗麻褡裢，manual notes[1]披露普通视觉推断，未用水囊替代 |
| 唯一承载者/位置 | 部分修 | 行囊右肩左腰明确；水囊左肩右腰与马鞍任选矛盾I1 |
| 取用例外与归位 | 部分修 | 001临时离身、010灌满归位明确；002–006归位被任选破坏 |
| 持续存在与局部可见性 | 已修（本global文字） | 行囊notes[2]允许近景只露肩带/囊角，顶层notes[5]远景不强制露物件 |
| 尘土汗渍磨损与休整保留 | 已修（本global文字） | 顶层notes[6..7]及角色notes[1]明确此前使用痕迹不得自动清除 |
| 身体递进、微弱恢复及动作先后 | 部分修 | 旧凉风错移表达未再出现；sb008另写竞争动作链I2，未验证完整分段动作 |
| 稳定身份及普通推断 | 已修（本global文字局部） | 人物identity无动态疲态；manual notes[0..2]披露年龄/普通行装/载位推断，不把局部项扩大为整体事实通过 |
| 分段image/video/reserve消费 | 未验证 | 四chunk取消，未编译完整计划 |
| 实际行李、旧衣、狼狈、摆拍与同人 | 未验证 | 三图取消，无内置浏览器实图验收 |
| H3低价、全API及费用 | 部分修 | 本次有限LLM预算通过，源路线10 API+1 Remotion；H3单价/账单/输出效果未验证，本批无视频调用 |
| 人声乱码噪音、同步及高质量视频 | 未验证 | 无新音频/视频；口播SHA一致只证明来源未变，不能证明音轨质量 |

本批采用此前独立审查过的人工11镜候选，原自动分镜仍未整体通过。原文、75,170ms口播及timing/ref保持，原片不替换。实现者声称通过的范围是正式合同和实验控制器；用户要求的画面与视频质量范围仍未通过。

## 费用与剩余风险

请求`deepseek-v4-flash`，回显`deepseek-flash`，不能声称固定旧模型版本。输入10,661、completion12,452（其中reasoning8,404）、总23,113 token。按已核验[DeepSeek官方高峰未缓存价](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)，`(10661×2+12452×8)/1000000=0.120938元`，缓存/闲时折扣忽略，reasoning包含在completion内，不重复计费。累计含历史失败预留48.5443075元，余额1.4556925元；账户实际扣款未验证。[万相北京0.20元/张](https://help.aliyun.com/zh/model-studio/wan2-7-image)仅用于已取消条件图片预算，本批图片成本0。

职责规则已经短句替换，而模型仍在不同字段自由重述载位和动作，形成竞争描述；不能把增加prompt规则等同于保证执行。也不能据本样例判定Flash整体能力，或假设分段一定会照错/一定会覆盖。人工fail只是本实验真实文字闸门，没有把业务semantic reviewer升级为自动门。

下一步建议先零费用收敛一份独立人工全局候选：只保留一个载位合同，外观字段不并列承载选择，不在全局复述动作链，再独立对照原分镜审查。旧模型结果及fail不覆写、不冒充自动生成通过；任何后续调用另建明确范围与预算，不续跑本关闭run。当前不继续追加prompt或付费，更换高价模型和重新生成整片都缺少性价比证据。
