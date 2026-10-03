# 角色场景视觉细节真实规划复验记录

## 结论与验收范围

2026-10-03，在用户继续整改、新增最多 50 元预算的授权内，使用现有 `generateAssetPlan`、Prompt Registry、gateway 和 compiler 完成 **七次真实 LLM 调用**：一次 global，六次串行分段规划。生成计划的结构校验通过，但本任务目标的**语义验收未通过**，没有激活 QA 计划，也没有执行后续两镜生图。

正式分段 prompt v1.4.0 已加入关键衣冠器物的可见结构和多人位置关系要求；实际输出仍缺少目标衣冠的辨识形状，并把“李世民一步步登上御座”改为“正面立于御座前”。新 global 的身份/造型字段分离通过，但角色年龄偏早，与当前 H2/E2 参考不相容。schema pass、供应商成功返回和文本里保留角色名都不能替代语义及真实出图验收。

范围来自用户原始角色一致性请求，以及[九图复验](./2026-10-03-character-sheet-full-body-acceptance.md)发现的衣冠、动作、额外帝王风险；按[场景视觉细节计划](../plans/2026-10-03-character-scene-visual-detail-plan.md)分别检查真实规划和真实图片。九图阶段的 1.80 元、无新增 LLM/视频仍作为该阶段历史保留。

## 执行与数据来源

- 正式 prompt 提交 `8b3fbdaa`：仅分段 prompt、中文 changelog 与既有合同测试；红阶段 1 failed / 1 passed，绿阶段及父独立复跑 133/133，prompt 治理通过，规格与代码质量审查均 Approved，零 Critical / Important / Minor。这些结果只证明合同，不证明生成语义。
- 本地未跟踪探针 `storage/acceptance-20261003/scene-planner-live.mts` 调用现有链路，不新增业务阶段或正式 prompt。探针规格与质量审查 Approved，零问题；**本次真实输出的独立语义审查已完成，结论未通过**，不将探针审查结论移作语义批准。
- 使用同一 QA 项目的完整 18 段 storyboard、script、既有口播时间轴、冻结写实画风和解析路线。能力来源为原 `asset_plan.generate` 快照；其路线为空，路线按计划使用同项目首次 `assets.generate` 的原样 18 条解析路线，不凭内容推测。视频保持原 720P。
- QA 数据库以 readonly 打开。保留旧 plan/manifest JSON 哈希和上游来源哈希；运行后保护检查通过。生成计划只保存在本地，没有写入或激活 QA 新计划，没有新媒体任务。
- gateway/provider 边界逐次覆盖 `maxAttempts=1`、`maxTokens=8192`，发出前检查输入不超过 50000 UTF-8 字节和费用预留；完整调用日志核对实际模型 `deepseek-v4-pro`、尝试数和输入/输出。没有重试或语义自动改稿。

本地证据目录为 `storage/acceptance-20261003/`：`scene-planner-preflight.json`、`scene-planner-input.json`、`scene-planner-preview.json`、`scene-planner-live-started.json`、`scene-planner-live-events.json`、`scene-planner-generated-plan.json`、`scene-planner-local-validation.json`、`scene-planner-human-review.json`、`scene-planner-live-summary.json`；调用 01–07 各有 `scene-planner-call-<编号>-scheduled.json`、`-interaction.json`、`-settled.json`。完整 prompt、输入、原始与解析输出、版本哈希、effectiveRequest、时间和 token usage 保留本地，不提交凭据或生成态记录。`human-review.json` 是人工审读材料，文件中的待审标记不是自动语义裁决。

global prompt 版本 v1.4.0，正文 SHA-256 为 `1fd963209ffe1647680c79cd345d67cb4a6caccf96087471afe7199c9a168002`；六次分段 prompt 均 v1.4.0，正文 SHA-256 为 `ad1950d025d9bc52355203dfed842eeeca616e4aae42bd0543075a4b019527ac`。

## 结构结果与人工语义审读

本地校验 `decision=pass`：65 个任务、20 条依赖、0 errors、0 warnings；TTS 覆盖 512/512 字，覆盖率 1。结构修复未触发，七次调用全为一次供应商尝试。`scene-planner-live-summary.json` 的 `local_validation_pass_pending_human_review` 只代表结构结束、等待人工，不能解释为本任务通过。

| 原始验收项 | 状态 | 实际输出与边界 |
| --- | --- | --- |
| 新 global 将稳定身份与造型分开（A14） | 部分修 | 五个角色的 `identity_description` 为年龄、脸型、五官、体型，冠服/甲胄/佩刀另在 `visual_description`；字段分工与结构通过。但李世民“十九至二十岁左右”、李渊“五十岁上下”偏早，不能整体批准身份语义 |
| 新 global 与 H2/E2 相容 | 未修 | H2 人工 QA 约二十八岁、E2 约六十岁；本次年龄描述不相容。没有手工把模型身份改回旧 QA 身份，也没有复用参考生图 |
| 甲胄镜 `sb_004` / `img_s003_01` 的可见衣冠细节（A11） | 未修 | 仅写“身披唐式明光甲”，没有关键甲片、胸部结构等可见辨识描述，未满足本次细节目标；不是据关键词自动判定，而是人工阅读完整目标 prompt |
| 衮冕镜 `sb_016` / `img_s015_01` 的可见衣冠细节（A11） | 部分修 | 新增“玄衣纁裳”“十二旒冕冠”及纹样名称，但未展开冕板和悬垂珠旒的可见形状，目标未通过，不能视为等价于已实测的 D1/D2 方向 |
| 原场景的登御座动作与角色职责（A13） | 未修 | 上游为“一步步登上御座”，新 prompt 改成“正面立于御座前”，核心动作被改变。李渊退居一侧、百官叩首在文本中保留，但未证明画面无额外帝王或动作正确 |
| 新计划结构与时间轴合同 | 已修 | 正式链路本地结构校验通过；65 tasks / 20 dependencies / 0 errors / 0 warnings，TTS 全覆盖。只证明合同下限 |
| 新 planner 输出的两镜真实图片 | 未验证 | 前置语义失败，任务 3 未执行，没有新图片、参考注入回执或浏览器效果可供签收 |
| 精确历史形制、全片成品与统计稳定性 | 未验证 | 本轮只是一次真实规划及两目标文本审读，不是全片事实审校、成品或概率稳定性测试 |

年龄偏差还与主时点不符：既有 script 以武德九年（626）为主，故宫词条列李世民生于 599 年，由年份差推算应处于二十多岁后段，十九至二十明显偏早；这里是粗略推算，不作精确生日、虚岁或出生年争议考据。[故宫博物院：李世民](https://www.dpm.org.cn/lemmas/244234.html)

教育部词条列李渊生于 566 年，由 626−566 粗略推算约六十岁，支持当前“五十岁上下”偏早的诊断。这个查证仅用于验收年龄问题，不把人物出生年份硬编码进正式 prompt，不扩展为全片史实审校。[教育部教育百科：唐高祖](https://pedia.cloud.edu.tw/Entry/Detail/?search=%E5%94%90&title=%E5%94%90%E9%AB%98%E7%A5%96)

## 调用与费用

按 2026-10-03 核验的 DeepSeek V4 Pro 高峰缓存未命中输入 9 元/百万 token、输出 27 元/百万 token 计算保守费用，未使用更低的缓存/空闲时段折扣。以 interaction 的 `promptTokens` 和 `completionTokens` 计算，不将单列 `reasoningTokens` 再次叠加；这不是供应商结算账单。[DeepSeek 官方人民币价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)

| 调用 | 阶段 | 输入字节 | 输入 token | 输出 token | 尝试 | 保守估算（元） |
| --- | --- | --- | --- | --- | --- | --- |
| 01 | global | 46004 | 12409 | 6346 | 1 | 0.283023 |
| 02 | 分段 | 19745 | 5486 | 7646 | 1 | 0.255816 |
| 03 | 分段 | 19880 | 5497 | 6219 | 1 | 0.217386 |
| 04 | 分段 | 19869 | 5516 | 8189 | 1 | 0.270747 |
| 05 | 分段 | 19774 | 5494 | 4468 | 1 | 0.170082 |
| 06 | 分段 | 19531 | 5420 | 4033 | 1 | 0.157671 |
| 07 | 分段 | 19713 | 5469 | 5608 | 1 | 0.200637 |
| 合计 | 7 次 | — | — | — | 每次 1 | **1.555362** |

发出时累计预留 3.093444 元，随后按已知 token 结算为上述保守估算；预留不是实际消费，不与估算重复相加。此次独立本地 LLM 探针 **没有写入项目 `UsageCostRecord`**，所以不能只按 UI 费用清单判断本轮总账，也不能把该缺项记成零费用。

| 新增 50 元授权内的费用来源 | 调用次数 | 估算金额（元） | 记账来源 |
| --- | --- | --- | --- |
| 前一全身图片小批 | 9 次图片 | 1.800000 | 系统 succeeded usage，`costBasis=estimate` |
| 本次真实规划 | 7 次 LLM | 1.555362 | 本地逐次 scheduled / interaction / settled 独立保守费用证据 |
| 累计 | 9 次图片 + 7 次 LLM | **3.355362** | 分别统计后合并，不重置预算基线 |
| 估算剩余 | — | **46.644638** | 50−3.355362 |

本次新增图片/视频调用为 0，原 0.40 元和 0.60 元两笔历史授权不重复计入新增 50 元基线。**所有供应商实际账单均未核验**；上述累计和剩余是预算管理用估算。

## 自审与后续闸门

本次文档只读复核七次日志的模型、maxAttempts、maxTokens、实际尝试数、字节上限、token 费用计算、结构结果和 summary 的只读/未激活/零新媒体标记。独立人工语义审查与父审读一致：仅运行防线与结构合同通过，目标语义未通过。审查确认年龄、衣冠与动作问题已存在于原始模型输出，编译保留原文，不是编译丢失；不因结构成功激活计划。

实际输出没有满足这次衣冠细节、动作保持和参考相容目标，任务 2 执行结束但语义未通过；任务 3 继续未执行。下一步见[规划语义回修计划](../plans/2026-10-03-character-planner-semantic-repair-plan.md)，该计划经规格与计划审查 Approved，已提交 `0b30b10c`，回修结果尚待独立验证；原七次失败证据不与后续调用混淆。逐个低耦合整改，保留来源和原动作，不用本地关键词规则、手工改年龄或无限重试掩盖失败。后续付费继续沿用原 50 元累计基线。
