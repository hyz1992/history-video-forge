# 分镜事实忠实边界验收记录

日期：2026-10-07。项目：`79e6c95d-79d9-41b0-9503-ac52bf0c24c0`（玄奘失水绝境）。

## 结论与验收范围

用户批准继续“收紧事实忠实约束，再验证分镜”。本批已完成一份正式planner合同修改与一次有界Flash调用。规则和结构回归通过；新自动稿的已走距离、流沙险情两个旧偏差在本样例中消失，但仍把求援目标画成已可见烽燧，另有心理因果解释过度，**自动稿整体语义未通过**。

另附独立的零费用人工文字候选，保留自动原件和失败结论。该候选只修两镜及一个相关全局提示，结构核验与独立11镜文字审阅通过（Critical0、Important0、Minor0）；没有写回项目或生成媒体。不得把人工稿当作新规则自动通过的证据。

本次费用按官方高峰未缓存价保守估算为 **0.036706元**；累计含历史预留 **48.0031235元**，距50元上限剩 **1.9968765元**。账户实际账单未核验。本有限批停止，未追加LLM或下游调用。用户最终需要的高质量成片仍未完成。

设计与计划：[事实忠实边界设计](../plans/archive/2026-10-07-storyboard-factual-fidelity-design.md)、[实施计划](../plans/archive/2026-10-07-storyboard-factual-fidelity-plan.md)。前批证据：[原文区间展示验收](./2026-10-06-storyboard-readable-input-acceptance.md)。

## 实际改动与验证

直接在dev主工作区，未创建分支/worktree。

| 任务 | 实际范围 | 验证证据 |
| --- | --- | --- |
| 设计 | 中文设计、计划及当前入口，提交`8facda4b` | 独立文档规格审查通过 |
| 正式合同 | `prompts/storyboard/storyboard-planner.prompt.md`的两个已有规则位置，v1.7.0→v1.8.0；配套changes与既有合同测试，提交`c6dfa3ca` | 通用事实关系边界及普通还原许可；未增加题材特例、自动语义分类或业务代码 |
| 红灯 | 扩展原合同用例 | 目标文件1失败/14通过，退出1；首先缺新的事实关系断言，不只是版本断言失败 |
| 绿灯及回归 | 目标15项、三个storyboard文件88项、fake runtime smoke3项 | 根代理合并复跑四文件91/91，退出0；真实凭据拒绝guard保持 |
| 治理及审查 | prompt治理、diff、独立规格后质量审查 | `npm run harness:check-prompts`与`git diff --check`退出0；T1质量Critical/Important/Minor均0 |
| 真实结构 | 正式`generateStoryboardPlan`一次 | 11段、75,170ms、完整覆盖；请求与前批只差system planner正文；零网络复核退出0 |
| 自动文字 | 根代理和独立审阅者逐段对照源稿 | Critical0、Important1、Minor1；见下表，未整体通过 |
| 人工文字候选 | 独立JSON，仅五处叶字段改变 | 原自动稿SHA、其他字段、来源、全文覆盖与时间投影保持；独立11镜文字复核通过，Critical/Important/Minor均0 |
| 最终事实/链接审查 | 本批记录、归档设计/计划及相关入口 | 独立核对输入、费用、原件与候选，收口范围通过；12个本地链接全存在。唯一Minor是入口将延续的可见烽燧偏差称为“新增”，已对照前批原始JSON修正 |

最小回归命令：

```powershell
npx vitest run --configLoader runner --no-file-parallelism tests/backend/storyboard/storyboard-narration-prompt.test.ts tests/backend/storyboard/storyboard-narration-timing.test.ts tests/backend/storyboard/storyboard-generation.test.ts tests/harness/narration-first-runtime-smoke.test.ts
npm run harness:check-prompts
git diff --check
```

这些检查证明合同、结构及原通路保持，不能证明LLM语义或实际视听质量。没有业务代码、schema或UI改动，本批未运行前端构建或浏览器媒体验收。

## 输入、来源与保护证据

实验目录：`storage/storyboard-factual-fidelity-acceptance-20261007/`，生成态不提交。`live.mts`已派发一次，不作为续跑入口。仅本批`offline-review.mts`与`human-draft.mts`可做零网络复核。

| 项目 | 本批实际值 |
| --- | --- |
| 完整输入 | 与前批规范序列化完全相同，pretty JSON11,395字节；口播展示6,548字节 |
| 输入SHA256 | `a251343a56e5eeffb0579e909756952da9251e78781507a3f39f40f3fcb1706c` |
| 正文/候选 | 338个UTF-16代码单元，24候选；候选四值保持，276个候选范围原文逐一复核 |
| 原生时间图 | 75,170ms，289tokens/289spans/290合法边界；完整图规范SHA `7b8e1c098cba1c66087d5616b7fcaa732db4762a5ef5f4f0d2a8a7e2158bcc24` |
| 来源稿/选题 | `1bd3ec16-de05-48a2-930e-5db38ae7881f` / `1c7eacdb-2008-4ed1-a0a2-c784819856a0` |
| 口播身份 | record `cca1ca92-108a-4189-9f14-68d999fa4bac`；audio hash `2281cb6ab131f3a004760ef384476d5c4788444a9872ef4d1b5b0c411ed34063` |
| 前批6段 | 保存实验计划的正式投影逐值保持；不是数据库活动计划实测 |
| 原件保护 | 17份文件SHA保持：原13份加前批protocol/input/result/budget四份；包含原时间图、关键trace、旧MP4及各实验工件 |

口播引用保持不等于本批检查了音频文件或听过音轨。未读取原项目数据库状态，不声称数据库活动分镜验证通过。

| 冻结prompt | 版本与正文SHA256 |
| --- | --- |
| storyboard planner | v1.8.0；`918fd0353febec21790139a7cc6c9f9d498c87c784406b16a889e31e212ead8f` |
| 前批planner（比较基线） | v1.7.0；`1c6a51e12e463d241a58793c2ac32685f5877d5a76edd8ab1bf40026982664e7` |
| asset global | v1.7.0保持；`d4e9f99fba437f2a0e32f287d4f2a0a36fd9ef4bca8481fcc856269b3eec87ff` |
| asset segment | v1.7.0保持；`b53faf1c0836001a994770059355ee0b72ea550ca2e4c4561c6e8f4ff9d47a5d` |

## 单次真实调用与费用

请求`deepseek-v4-flash`，官方`api.deepseek.com`端点，回显`deepseek-flash`。2026-10-07核对的[官方中文价格和兼容名说明](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)显示，旧请求名由V4.1-Flash服务；本批没有宣称锁定退役原始V4，也未改模型或路由。

派发前预检按prompt字节、实际pretty输入字节及2,048余量保守界定输入23,162，输出上限8,192，预留0.11186元。新增上限0.50元含失败，总额仍50元。排他锁与派发前历史/预留保持，实际一gateway、一HTTP，`maxAttempts=1`，无重试。生产编排策略未修改。

| 项目 | 实际证据 |
| --- | --- |
| HTTP/完成 | 200 / `stop`，完整返回；response ID `90fd39cd-d9d4-455d-9945-8d82d9722bf1` |
| 用量 | 输入5,673、输出3,170token；未缓存按高峰价保守复算 |
| 单次估算 | `(5673×2 + 3170×8) / 1,000,000 = 0.036706元` |
| 本批余额 | 0.463294元；不继续派发 |
| 累计 | 47.9664175元基线含历史预留 + 0.036706 = 48.0031235元 |
| 总额余额 | 1.9968765元；历史预留未移除，产品成本表未回写，实际账户账单未核验 |

费用证据：`storyboard-request.json`、`storyboard-interaction.json`、`provider-response-echo.json`、`dispatch-history.json`、`budget-update.json`。检查响应echo使用同次HTTP响应副本，没有额外请求。结构修复器仅确定性恢复，无隐藏付费fixer。人工候选新增费用0元。

## 自动稿逐镜事实审阅

证据：`source-draft.json`、`storyboard-result.json`、`manual-review.json`；与正式源稿逐段对应，不能用合同测试代替语义审阅。

| 镜头 | 时间ms | 状态 | 证据及范围 |
| --- | --- | --- | --- |
| sb_001 | 0–5680 | 已修 | 失水和伸手已迟对应；跪姿、湿沙为普通还原，迷路为同时背景 |
| sb_002 | 5680–13920 | 已修 | 迷路、无人和老红马对应；无新增商队事件 |
| sb_003 | 13920–23600 | 未修 | 正文是回第四烽的求援机会，scene/elements却出现远处可见烽燧；Important，目标成了已见事实 |
| sb_004 | 23600–29760 | 已修 | 十余里为已走的东行过程，勒马对应当前摘录；原剩余距离误解在本样例中消失 |
| sb_005 | 29760–35120 | 部分修 | 西北转向正确；intent将失水作为更不能退却的理由，超出誓言反省，Minor |
| sb_006 | 35120–42480 | 已修 | 决心引语与风沙对应；抬袖遮面与马低头为即时反应 |
| sb_007 | 42480–48800 | 已修 | 昼夜、四夜五日及力竭倒卧对应；本样例未再扩写流沙陷落 |
| sb_008 | 48800–56880 | 已修 | 凉风、恢复及马偏方向对应；跟随为即时反应，未提前出现水草，逐秒同步未验 |
| sb_009 | 56880–62080 | 已修 | 跟随后发现青草和水；饮水/捧水属于发现后的即时反应 |
| sb_010 | 62080–68720 | 已修 | 存活、休息、装水、再西行顺序保持 |
| sb_011 | 68720–75170 | 已修 | 足迹与剪影表达余韵；未补后续历史结局 |

这里“已修”只指本镜文字对照项通过。11段中仍有偏差，不能表述为自动首稿链路或通用语义整体通过，也不能推断提示词已稳定解决所有题材。

## 独立人工候选

`storyboard-human-review-draft.json`是根代理人工编辑的离线候选，不是第二次LLM输出，不接自动patch或主链门禁。独立文字复核通过，Critical/Important/Minor均0；`human-draft-review.json`另行记录该结论，原自动稿未通过结论保持。

仅修改五处叶字段：sb_003的`scene_description`、`visual_elements`、`risk_notes`移除可见烽燧并明确东返求援的画面边界；sb_005的`visual_intent`改回对退却的反省及西北转向；`global_visual_notes[0]`移除会继续引出烽燧的造型提示。

`human-draft.mts`仅落实这些已确定的人工编辑，通过回退五字段后与原稿规范序列化相等，验证其他字段未变；正式`validateStoryboardTiming`通过，全文覆盖和来源保持。它没有判断或自动分类语义。

原自动JSON文件SHA `3c2721cbfa61f7a5c499a710e1e909c4f4ddd945a7a15194d7711ac8e5ffe258`保持；人工候选规范SHA `d9dc96235131d5c6c65d7760dcdc1eb5cc550a660156bc00844fbd3b7eb66fdd`。工件包含`human-draft-verification.json`，证明结构和修改范围，不代替人工文字复核。

## 原用户要求验收清单

| 用户原始要求 | 状态 | 证据与缺口 |
| --- | --- | --- |
| 提供Flash模型选项和默认 | 已修（前批） | 见当前入口所链2026-10-05设置验收；本批配置未变 |
| 从系统层面减少不合正文的画面 | 部分修 | 当前正式planner事实合同已扩展；本样例两个旧错消失，但自动稿仍有求援目标可见化与因果偏差 |
| 有行旅负载、磨损/困顿，避免光鲜摆拍 | 未验证 | 普通器物/服装状态还原许可保持；本批未派发全局/分段规划或生图，不能从文字推断视觉已修 |
| 逐阶段评估并产出高质量视频 | 部分修 | 有结构与逐镜文字评估，自动失败结论保留，另附人工候选；本批无新成片，最终视频未完成 |
| H3便宜、全API视频及费用可控 | 部分修 | 单次LLM新增估算在本批0.50元内、累计含预留在50元内；未调用H3，未核实H3账户实际单价/账单 |
| 没有人声问题、乱码或噪音 | 未验证 | 本批未播放或检查音轨/媒体；来源引用和旧MP4 SHA保持不能替代听审 |
| 真正的画面/口播同步与同人连续性 | 未验证 | 时间图/结构覆盖通过；没有逐秒视频、人物或跨镜磨损实物验收 |

11镜最短5,200ms，全部超过5秒；`h3-range-eligibility.json`只读统计，没有H3 prepare或媒体派发，也未私自切分成5秒镜头。

## 自审、剩余风险与下一步

实现范围保持三文件原子合同及文档/离线证据。没有修改输入、schema、API、writer、validator、reviewer、重生、模型路由或生产尝试策略；没有字符串语义门禁、自动修补或反复加prompt重跑。原件、旧实验、现有settings/杂项和生成态均保留。

本批完成的是一次有界事实合同实验，不是最终视频验收。自动结果整体未过；人工文字候选也不能证明实图、连续状态、音轨或历史形制达标。

本有限批已停止，设计与计划归档，不作为续跑清单。下一步优先以这份人工文字候选检验既有全局/分段规划能否将负载、磨损、脱水与恢复状态贯穿各镜，再做少量实图验收；这比继续重复分镜调用更能定位用户指出的视觉问题。若范围变化，另立低耦合任务与费用边界。
