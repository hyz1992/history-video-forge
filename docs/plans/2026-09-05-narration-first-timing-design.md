# 口播前置与真实时间轴设计

> **2026-09-10 变更注记**：发布开关（`NARRATION_FIRST_ENABLED`）与演示模式（`DEMO_MODE`）已按用户决策移除——新建项目一律走口播前置链路，存量 legacy 项目保留可读并经显式升级入口切换。下文关于"开关关闭"的部署语义为历史设计上下文，不再作为当前产品行为。验收现状见 [A1-A10 标注矩阵](../records/2026-09-10-narration-task12c-acceptance-matrix.md)。

日期：2026-09-05。状态：三轮有限自审修复后，文档可实施性终审通过，可从任务 0 离线实施开始；尚未实现业务，最终模型/音色须经有限对比后确定，真实音质及时间戳精度尚未验收。见[审查闭环记录](../records/2026-09-05-narration-first-design-review-loops.md)。

2026-09-06 实施状态：原生/ASR与正常短中长声音、隐藏故障观察的六项机器工程证据已齐；Qwen基准参数已通过样例范围机器工程资格终审，当前最终闸门以[机器工程资格记录](../records/2026-09-06-narration-engineering-qualification.md)为准，允许进入任务1。累计用量折价3.3866178元，未改业务或全局默认。

实施入口：[实施计划](./2026-09-05-narration-first-timing-implementation-plan.md)。

## 1. 决策与范围

采用“确认文案 → 生成并确认整篇口播 → 按真实口播规划分镜 → 资产规划/生成 → 合成”的方案。口播准备归属现有文案步骤，不增加第七个产品阶段，不改变 Topic Package 合同、script writer 主链路和 reviewer shadow-only 边界。

**新模式推荐组合以任务0最终资格记录为准，实际默认物化仍在任务2B实现，全局默认不变。** 首轮比较 `cosyvoice-v3-flash` 的 `longsanshu_v3`（龙三叔）、`longanyang`（龙安洋）与 `qwen-audio-3.0-tts-plus` 的一个预复刻叙事音色，统一通过百炼 WebSocket 验证。先过长文/时间戳硬门，再用同稿试听比较；不能把“CosyVoice 能用”写成“CosyVoice 最适合”。比较对象是模型、音色及参数组合，而非抽象模型排名。

核心约束：

1. 以最终保存的口播音频为时长真相，以同一次合成返回的原生字词时间戳为文本定位真相。
2. 字幕、分镜、资产视频时长和合成消费同源时间数据；不能各自按字数重新估算。
3. 常规文案整篇、单任务合成；流式传输的数据包不等于多次独立 TTS。禁止固定 500 字分段和失败后偷偷按分镜重试。
4. 未生成、未确认、时间戳不合格或已过期的口播，不能启动正式分镜生成；后端检查不可被深链/API 绕过。
5. 保留旧项目及历史成品。模型、配置切换不得暗中重新生成或删除已有音频。
6. 本次不包含环境音效、BGM/SFX 改造、视频原声音轨策略变更、多角色对白系统、自动文案重写或自动变速补救。

## 2. 模型选型依据

### 2.1 选择顺序

先检查原生时间戳、整篇长度、可用音色及授权边界，再比较叙事听感、可控性、稳定性和费用。不以“更新”“旗舰”标签代替接口契约，更不以一次成功推断长文永不漏读。

| 候选 | 长文本与时间信息 | 本项目取舍 |
|---|---|---|
| `cosyvoice-v3-flash` | WS 支持长文本与原生字级时间戳；系统音色表逐项标注支持情况 | 必测候选：有叙事类现成音色，不必先复刻；需要新增 WS adapter，不能只改旧 HTTP model 参数 |
| `qwen-audio-3.0-tts-plus` / `flash` | 与 CosyVoice 共用 WS 协议；支持部分音色的时间戳；另有预复刻基础音色 | plus 纳入同轮比较，不以 CosyVoice 失败为前提；flash 暂不扩入付费矩阵。系统音色表未逐项标注时间戳不等于整个系列不支持，具体组合仍须验证 |
| `cosyvoice-v3.5-plus` / `flash` | 原生时间戳能力在客户端文档列出；无现成系统音色，需要自定义音色 | 暂不首选：引入音色创建、兼容与运营状态，不是本轮解决时长的必要条件 |
| `MiniMax/speech-2.8-hd` / `2.8-turbo`（百炼） | 同步文本少于 10,000 字符；百炼 `subtitle_enable` 仅非流式可用 | 备选：当前百炼文档未完整给出字幕输出字段及字词粒度，不把 MiniMax 直连接口能力当成百炼已透传能力 |
| 当前 `qwen3-tts-instruct-flash` HTTP 路径 | 文本上限 600 字符；现有接口没有本方案所需的原生字词时间戳合同 | 保留旧链路，不作为新主路径 |

资料核对日为 2026-09-05；以上长度按各自接口定义，不能跨协议套用。来源：[百炼语音合成模型总览](https://help.aliyun.com/zh/model-studio/tts-model)、[WS 客户端事件](https://help.aliyun.com/zh/model-studio/cosyvoice-client-events)、[CosyVoice 音色表](https://help.aliyun.com/zh/model-studio/cosyvoice-voice-list)、[Qwen-Audio 音色表](https://help.aliyun.com/zh/model-studio/qwen-audio-tts-voice-list)、[百炼 MiniMax API](https://help.aliyun.com/zh/model-studio/minimax-synchronous-speech-synthesis-api)、[Qwen TTS API](https://help.aliyun.com/zh/model-studio/qwen-tts-api)。

### 2.2 候选的具体能力边界

- `longsanshu_v3`：官方定位有声书、沉稳男声，支持时间戳，不支持 Instruct。允许音色/语速快捷设置，情感控件禁用并解释原因。
- `longanyang`：支持时间戳与指定格式的情感/旁白角色指令。控件只开放该音色官方允许的值，不把自由文本“悲壮、悬疑”等直接当成供应商枚举。
- Qwen-Audio plus：从官方预复刻基础音色表及试听中，按普通话、成年叙事声线、模型兼容性筛出一个候选；任务 0 在 dry-run 前冻结准确 voice ID、官方来源和选择理由。不能杜撰 ID、套用 flash 同名音色 ID，或把音色占位符带入 live。可控性按该组合官方能力及验证结果开放，不套用龙安洋枚举。
- 正式 TTS 指令模板同样放在 `prompts/narration/`，声明 `language: zh-CN` 并版本化；业务代码只按能力校验参数、加载模板，不内嵌另一份正式模型指令。
- 首批部署固定北京地域，显式冻结 model、voice、region、protocol、rate、pitch、volume、sample rate、format 和指令版本。不同模型音色不能混用。现有自定义音色不因名字相似自动迁移。
- 首版选择 PCM 流并在本地封装单个 WAV，避免逐包 WAV 头拼接。采样率拟用 24 kHz；声道、位深及字节顺序由任务 0 的协议小样本锁定并用 fixture 固化，不凭猜测处理二进制。

上述音色能力来源：[CosyVoice 官方音色表](https://help.aliyun.com/zh/model-studio/cosyvoice-voice-list)。音色适合本项目的判断是选型推断，仍需试听验收。

### 2.3 整篇输入，不承诺无限长

WS 的单条 `continue-task` 最多20,000字符、同一任务累计最多200,000字符。应用继续对整篇正文采用UTF-16长度不超过20,000的保守校验；这不是供应商字符计数规则声明。超过应用上限在请求前报 `narration_text_too_long`，本轮不开放20万字符能力。

2026-09-06 根据同稿诊断调整输入方式：同一个WS任务中按自然段顺序发送多条输入，所有片段拼接必须逐字等于原文；无换行的短稿172字和中稿534字各为一条，已测长稿1740字为18条；超长自然段（>534字）在发送前按句边界自动拆分为多条continue-task（2026-09-11，拼接仍逐字等于原文）。协议顺序为 `run-task → task-started → 顺序continue-task → 一次finish-task → 收齐音频/时间戳 → task-finished`。不另起多份TTS，不做交叉淡化，完整音频仍是一份；供应商内部可能按句处理，不承诺一次神经网络前向或绝对无衔接问题。[协议依据](https://help.aliyun.com/zh/model-studio/cosyvoice-client-events)

该方式先经任务0机器工程资格门验证，再于任务3接入独立adapter。长段落超出已测单条体量时的应用约束和失败路径须在任务3明确验证，不能仅凭官方20,000字符限额声称任意长输入已经保证连续朗读。任务0记录不等于生产接线完成。见[自然段对照](../records/2026-09-06-narration-paragraph-comparison.md)和[自动验收](../records/2026-09-06-narration-audio-acceptance.md)。

### 2.4 有限比较与上线资格门

2026-09-06 连续授权后的验收方式：按用户明确要求，以[预先冻结的机器工程资格门](../records/2026-09-06-narration-audio-acceptance.md)执行本轮剩余验收。原生结构/全文门保持；长稿ASR交叉一致性与短中长全段声音质检共同验证；正文完整性由原生/ASR/盲转写联合裁决，不交给无原稿的声音评分，声音工具另以隐藏的长稿中段故障对照核对适用性，不要求用户逐条听后转述。旧人工字段仍为空，不声称人工绝对精度或人类偏好评分。只有该替代证据门全部通过才可结束任务0；以下原人工抽样/评分保留为原方案来源，当前不再作为必须用户介入的执行条件。语气未测不开放，单个合格组合只作资格筛选。

2026-09-06 任务0核验方式补充：用户已授权使用系统现有付费ASR自动核验既有音频，明确不再要求其人工听后转述。固定两份自然段长稿各一次qwen3-asr-flash-filetrans识别，本项预留上限0.20元、总上限仍5元，见[执行记录](../records/2026-09-06-narration-asr-verification.md)。ASR全文及词级时间用于排查缺读和交叉比较，不是人工声学真值；不填入旧人工测量字段、不直接套用人工精度门、不替代TTS原生字幕。后续以机器证据继续任务0排查，不以用户逐条转述为前提；真实截断和无效原生时间仍阻断资格，任务1不得据此放行。

开发开始时先做有限对比，不直接修改默认配置。基础矩阵固定为上述三个模型/音色组合 × 三篇相同正文，共 9 次合成；Qwen-Audio 必须在同轮，不是失败后的备选。另预留龙安洋及 Qwen 候选各一次中篇的语气控制试验，共最多 11 次；不支持语气的组合跳过该项并明确能力缺失，不另换音色补满次数。禁止自动重试或扩大矩阵；故障调用也占请求额度，未知费用按预算上界处理，不能假设没收费。缺少任一模型的有效比较证据时，结论只能是“比较未完成”，不能宣布另一个模型胜出。

三篇文案为短文、当前约 534 字的历史案例、1,500–3,000 字长文；覆盖多句、数字、年号、人名、多音字、引号、长停顿。基础比较使用完全相同的正文、北京地域、PCM 24 kHz、默认语速/音调、不加情感指令；各组合完整参数在样例 manifest 冻结。试听随机隐藏候选标签，播放端可调整响度但不改变归档音频/时间戳。保留 request ID、模型/音色、调用次数、耗时、计费字符、最终文件 hash、原始时间事件及脱敏报告。

通过条件：

- 全文同一任务，无客户端分段合成/交叉淡化；末句完整，听审无明显漏读、重复、跳音、破音及句间重置感。
- 每一个应朗读文本单位均有可验证来源映射；不允许以“覆盖率差不多”隐藏缺失。数字规范化必须可追踪，不要求朗读文本与显示文本逐字符相同。
- 字词时间有效、整体单调、无无法解释的重叠、位于实测音频范围内。验证供应商时间是句内还是任务累计时间，以及中文/英文/代理对索引单位。未确认时不得进入生产适配。
- 每个组合人工抽样至少 30 个边界，建议验收目标为绝对偏差 P95 ≤ 200 ms、最大 ≤ 500 ms；这是本项目验收目标，不是官方精度承诺。不通过则调整候选/参数重新验收；超出本轮矩阵必须另行授权，不能回落估算冒充通过。
- 明确判断叙事表现是否可接受，不能用本地关键词规则或“最新模型”标签代替听审。

先按以上硬门给每个组合标合格/不合格，再对合格组合进行同稿人工评分：叙事自然度 35%、长文连贯性 25%、发音准确性 20%、语气控制 10%、整体声音偏好 10%。各项 1–5 分，1 表示明显不可用、3 表示可接受但有明显不足、5 表示样本内无明显问题；不支持语气控制记 1 分并公开原因，不能凭空打高分。质量项取三篇平均，语气项使用专项试验；记录每项理由及问题时间点。总分换算百分制；最高分领先不足 5 分视为近似持平，优先采用实测费用更低者，费用不可比较时由用户试听选择；耗时只报告本轮观测，不把小样本当稳定性统计。不得因便宜让未过硬门的组合入选。

报告必须列出全部组合的资格、评分、调用失败、费用与延迟，并给出“本项目样本范围内推荐”的默认组合和可选语气组合。只有一个模型的组合过硬门且另一模型已完成有效失败验证时，可推荐唯一合格者，但须写明这是资格筛选，不是音质优胜。未做比较前，代码计划不得硬编码 CosyVoice 为默认。

本轮仅写设计和计划，以上 live 均未执行。真实验证需单独明确请求次数与费用上限；不恢复已经移除的产品 quote/预算授权体系。

### 2.5 新旧项目的模型选择隔离

现有 resolver 的 `auto` 从全局模型目录选择唯一 active default（`shared/src/generation/generation-configuration-resolver.ts`）。本改造不改变该通用语义，也不修改旧 TTS 的全局 `isDefault` 或环境默认值。

- 经任务 0 验证的模型作为**非全局默认**目录项注册，复用现有 pricing catalog seed → bootstrap 注册链。新增版本化 `NarrationFirstModelPolicyV1`，只保存合格组合/报告引用、新模式默认 provider model ID、默认 voice ID 与策略版本；内容来自比较结果，不预设赢家。
- 新建 `narration_first_v1` 项目时，在项目配置落库前处理继承的 TTS 选择：`auto` 物化为 `{mode: "fixed", provider_model_id: 策略默认模型}`；显式 fixed 且已合格则原样保留。显式模型/音色不合格时拒绝本次创建并返回可选组合，要求用户明确选择后重试，不静默替换、不产生半个项目。auto 音色也在此固定为所选模型的合格音色；后续 run 只消费固定配置。
- 项目模式、固定模型/音色及策略版本/选择原因在同一创建事务保存。用户全局偏好不被回写；旧项目（包括 auto）仍按原全局默认工作。修改策略默认只影响此后新建或明确升级的项目，不追改已有新模式项目。
- 新模式项目后续保存 TTS 配置也必须遵守同一策略：`auto` 是一次明确的“应用当前新模式推荐”操作，保存时物化 fixed 并告知失效影响；显式选择未合格组合直接拒绝。界面展示实际固定模型与音色，不能显示为持续跟随全局的 auto。关闭/下架模型只阻止后续调用，不替换为别的模型、不妨碍播放冻结音频。
- 旧项目显式升级必须同时提交目标模型/音色选择和 expected 配置 revision；升级预览可建议合格组合，但不得提前修改旧项目配置。确认后一次事务切模式、写固定配置、记录策略与失效下游；不兼容或冲突时全部不写。发布开关关闭时拒绝新升级，但既有新模式仍可读取，不自动降级。

隔离测试必须同时覆盖 legacy auto/fixed、新模式 auto/fixed、显式不兼容选择、策略更新、模型停用、配置保存及升级事务；不能只证明新 operation 能解析到一个模型。

隔离还必须覆盖共享目录与实际协议，不能仅依赖 `isDefault`。本轮新增 WS 模型目录项明确标注 `execution_protocol=dashscope_ws`、`narration_only=true`，资格策略关联其音色档案 ID；历史无该标记的条目保持既有语义。项目候选展示、配置保存、run override 和外部 dispatch 共用兼容检查：新模式的 `script.narration.generate` 只接受合格 WS 模型/音色；legacy 资产 TTS 及旧 `voice.preview` 合成入口拒绝本轮 narration-only 组合，不能把 voice.targetModel 交给 HTTP adapter。旧 auto 匹配在评分前排除新增 narration-only 音色，既有候选评分/排序不变；显式选择不兼容时在调用前报错，不另找音色替换。全局偏好目录可展示带适用范围的组合，但不能绕过项目与执行入口的兼容检查。

先交付兼容过滤/协议防护，再发布新增全局模型及音色 seed；即使新模式开关关闭，新增 seed 也不得影响 legacy 自动匹配。旧音色试听入口对新 WS 组合仅允许读取已有授权预览缓存；本轮不扩建独立付费 WS 试听服务，完整口播在文案页生成后预览。直接 HTTP 请求、错误 voice target、过期快照均须在外呼前拒绝。

新建恢复沿用 `POST /api/projects`，实际入口为 `backend/src/modules/topic/topic.controller.ts` 的 `createProjectController`，不是 projects controller。请求新增可选 `narration_selection={provider_model_id,voice_profile_id,policy_version}`（由真实目录 ID 解析供应商 voice ID，不直接信任任意供应商字符串）。继承配置不兼容时返回 422 `narration_selection_required`、不兼容原因、当前策略版本及合格模型/音色组合；零项目写入。`CreateTopicModal.vue` 原地展示选择，保留项目名/选题输入，带选择重试同一创建入口，不改用户全局偏好。策略变动返回 409 和更新后的选择信息；开关关闭但请求仍带新模式选择时返回模式不可用，不暗中创建 legacy。创建成功才继续既有选题请求，取消选择零创建、零生成。创建合同/前后端接线在实施任务 2B/11C 闭环。

系统推荐、事件库 `EventLibraryBrowser.vue`、自定义选题 `CustomTopicInput.vue` 三个入口共用父弹窗提供的创建协调函数及选择组件，子组件不得各自吞掉 422 后重复无选择的创建。等待选择时保留各自筛选条件、事件 ID/角度或 rawDigest；父弹窗只协调创建，不重写三种选题生成逻辑。一次创建成功后调用原有对应选题动作一次，随后的 ensureProject 必须复用该 ID，不再创建；取消/关闭终止待续动作，选择控件不能被外层“创建中”锁死。

Prisma 模式下创建从 DB 权威用户偏好读取完整配置和 revision，不用本实例 Map 决定继承结果。读取后解析资格，创建事务再次比较该用户偏好 revision（缺记录也作为明确版本状态）；变化返回 409 `narration_creation_context_changed`，零项目写入，由同一创建选择流程提示用户确认后重新提交，禁止自动换成推荐。成功记录实际 sourceUserPreferenceRevision，模式/固定配置一起写入真实 first aggregate writer，事务提交后才刷新内存/项目 metadata；资格或事务拒绝不落项目目录。Project 的 narrationTimingMode 和两个 active 指针须贯通 first aggregate writer/hydrator、ProjectStore 映射和 snapshot；冷启动不能把新项目误判为 legacy。未启用新模式的既有创建语义不顺带重构。

## 3. 当前问题与代码落点

| 当前事实 | 证据位置 | 设计影响 |
|---|---|---|
| 分镜按文本占比乘文案估时重新排时间，不是测量 | `backend/src/modules/storyboard/storyboard-generation.service.ts` 的 `recalculateSegmentTimings` | 新路径必须停止调用该算法；不仅替换总时长，还要替换逐段边界 |
| asset compiler 从分镜生成 `segment_boundary` TTS chunks | `backend/src/modules/asset-planning/asset-plan-intent-compiler.ts` | 新合同改为引用已确认口播，不再规划重生音频 |
| 整篇仅在 ≤500 字分支尝试，失败还可能按 180 字拆 | `backend/src/modules/assets/providers/dashscope/dashscope-tts-provider.ts` | 新 adapter 独立，旧路径只供旧项目 |
| 当前字幕优先 ASR 对齐，失败退回估算 | `backend/src/modules/assets/providers/local-subtitle-provider.ts`、`asr-caption-aligner.ts` | 不是“当前全部字幕都估算”；新路径改用原生时间戳，失败不能静默 ASR/估算 |
| 合成使用 chunk duration，视频 provider 读取路由 TTS artifact 时长 | `backend/src/modules/compose/compose-timeline-builder.ts`、`backend/src/modules/assets/providers/dashscope/dashscope-image-to-video-provider.ts` | 必须防止把整篇音频时长误当每个镜头时长 |

本轮对话前序测试项目 `093c6c78-263f-4e05-a8e8-3034e8453cd8`：计划 88 秒，最终 WAV 117.21 秒；22 个 chunk 标记时长相加 117.84 秒，与合并后的文件差 0.63 秒。该案例用于回归背景，不代表新模型已测试，也不把非 active 的新 manifest 当当前项目结果。

工程经验文档中“必须拆分”“音色在资产规划时决定”等旧假设，在新路径由本设计取代；旧链路事实仍保留。正式架构文档在各实现任务完成时同步，不提前写成已上线。

## 4. 生命周期与页面交互

### 4.1 文案页面

沿用现有文案预览和确认动作，正文通过本地硬校验且已确认后显示口播准备区。未确认的文案不能正式合成。既有“确认并进入分镜”拆为文案确认与口播确认，不自动生成付费音频。

2026-09-07 实施核对补充：现有“确认文案”按钮仅导航，没有后端确认凭据。新增 `ScriptConfirmation` 持久化记录，绑定唯一 scriptRecordId、projectId、sourceTextSha256、confirmedBy、confirmedAt；旧稿件不自动补确认。`POST /api/projects/:projectId/script/:scriptRecordId/confirm` 接收 `source_text_sha256`，在事务中校验当前 owner/admin、active script、正文 hash 与本地硬校验通过后保存；同来源重复确认幂等，正文改变使旧 hash 凭据无效。该接口仅承担口播前置模式的文案确认，不发起生成，也不把 semantic reviewer 的 pass 当确认。口播 submit/dispatch 使用数据库凭据核验；前端现有按钮在任务 11 接入。此补充落实本节“已确认后才合成”的要求，不增加流水线阶段。


准备区包含：可用音色、该音色支持的语速/语气快捷设置、生成/重新生成、进度、失败原因、音频预览、真实总时长、目标区间、与估算的差值、字幕预览。生成成功不自动跳转；“确认此口播并进入分镜”一次完成确认和导航。

时长超出 topic 目标区间时，展示差异并要求明确接受本次实际时长，或由用户修改文案/语速后重生。不得自动压缩音频或触发 writer 重写。接受仅是交付时长例外，不回改 Topic Package；记录目标快照与接受者。目标区间变化会使确认失效，但无需重生声音。

区间内仍需确认听感。播放进度不作为听完的强制证明。生成中刷新可恢复；重复点击绑定同一个幂等键；失败有明确重试入口。只有改变字幕样式时本地更新预览，不重新 TTS。

### 4.2 记录与状态

新增 `NarrationRecord`，作为 script 的媒体派生产物而非新叙事合同。Project 增加 nullable `activeNarrationRecordId`、`activeNarrationSubtitleRevisionId` 和 `narrationTimingMode`（`legacy_estimated` / `narration_first_v1`）。候选由 script ID + generation run 查询，不能从最新记录偷偷回填 active。

记录最小字段：

| 字段组 | 内容 |
|---|---|
| 身份 | id、projectId、scriptRecordId、generationRunId（唯一）、createdAt、updatedAt |
| 版本 | schemaVersion、sourceTextSha256、spokenTextSha256、settingsSha256、sourceProjectTtsSettingsSha256、textMappingVersion、configurationSnapshotId |
| 输出 | audio 相对 URI/hash/采样率/声道/位深/sampleCount、durationMs、nativeEvents URI/hash、timingMap URI/hash、initialSubtitleRevisionId |
| 状态 | `generating / ready / confirmed / failed / cancelled / stale / unknown`；errorCode、confirmedAt、confirmedBy、acceptedDurationBandSnapshot |
| 来源 | provider task/request ID、model/voice/region/protocol 的冻结引用、timingSource=`provider_native`、validation report |

媒体输出在 ready 后不可原地修改；设置改变创建新候选。确认信息通过事务单独更新并记事件。音频/时间戳必须全部写完、探测及校验通过后才可 ready。

ready 候选不会替换原 active。确认新候选时事务执行：复查当前 script、项目 TTS 设置投影、目标区间和请求中的 expected active narration ID → 激活该记录。只有切换到不同 narration 来源时，清空后续 active 分镜、资产计划、manifest、compose、render、publish 及对应最新 trace；旧记录及文件保留。生成失败不会损坏已确认旧结果。

重复确认同一 active 记录且目标接受快照相同，幂等返回现有结果，不能再次失效下游。仅更新该 active 记录的目标区间接受信息时，保留已有分镜/视觉资产；不同候选并发确认通过 expected active ID 比较交换，迟到请求返回 409，不覆盖较新的选择。

`sourceProjectTtsSettingsSha256` 冻结生成时项目语音配置投影；`settingsSha256` 冻结叠加本次 override 后的实际语音参数。确认比较前者与当前项目语音投影，并校验后者与本次 run/bundle 一致，不把 override 错当项目配置漂移。视频、画风、字幕引起的整体 revision 改变不单独阻止口播确认；声音控件展示 active 参数与项目默认的差别。

新增轻量 `NarrationSubtitleRevision` 表：id、projectId、narrationRecordId、audioHash、timingHash、subtitleSettingsSnapshotJson、subtitleSettingsHash、builderVersion、SRT/VTT 相对 URI/hash、createdAt；记录不可变。`subtitleSettingsSnapshotJson` 必须保存 preset ID/版本（无预设时为 null）、完整解析后的 `resolvedStyle`、经校验的 overrides、断行策略及版本、样式 resolver 版本；不是只存 preset ID 或 hash。`resolvedStyle` 复用现有字幕样式合同的完整值，不能省略“当前默认”的字段。canonical hash 覆盖整个设置快照，builderVersion 另列参与派生幂等键。

初始字幕从口播 run 已冻结的字幕配置解析并保存快照；后续派生在请求开始时解析一次当前已保存配置及预设版本并冻结。builder、预览和 render 只消费该 revision 的完整快照，不重新查询最新预设/项目偏好；即使仅改样式导致 SRT/VTT 字节相同，也保留独立 revision 及样式 hash。初始字幕也是一个 revision，由 narration 记录保留初始引用；后续换行/样式产生新 revision，绝不覆盖原 bundle。预览按指定 revision 读取，项目 active 字幕指针必须属于 active narration。新字幕生成成功后事务切换指针：尚无 manifest 时只切字幕引用；已有 manifest 时以复用已有视觉 artifacts 的新 manifest 引用该 revision，再使 compose/render/publish 过期；失败保留旧字幕及视觉结果。

manifest 导入字幕时将 `resolvedStyle` 完整复制到现有消费者读取的 `artifact.metadata.subtitle_style`，同时写 subtitle revision ID、设置 hash；v2 校验两者与 revision 一致。`remotion-input-builder.ts` 的新路径消费此冻结 metadata，缺失/不一致就拒绝，不能用当前预设兜底。历史 revision 的预览/重放必须在预设更新后仍保持原样式。

### 4.3 配置与失效

| 变更 | 口播 | 下游 |
|---|---|---|
| 文案正文/标点/发音规则或生效的模型、音色、语速、语气变化 | 当前确认过期，保留历史，需生成新候选再确认 | 标记过期并清空 active；进行中的 run 不得激活旧来源结果 |
| 修改草稿控件但未保存/提交 | 不变 | 不变 |
| 仅目标时长区间改变 | 复用音频，重新确认区间 | 新确认前禁止新生成；改变接受区间不改变已有镜头时间数据 |
| 字幕样式/断行配置变化 | 复用音频与原始时间戳 | 重建字幕与 compose/render/publish；不使分镜、视觉资产过期 |
| 视觉意图、图片/视频策略或资产重试 | 复用口播 | 按既有依赖规则使受影响视觉产物及合成过期 |
| 用户默认偏好改变 | 已创建项目配置与冻结 run 不被追改 | 不变 |

所有新路径 run 绑定 script ID、narration ID/audio hash、timing hash 及自身直接上游 ID；dispatch 和激活均从 DB 复查。旧实例内存镜像不是权限或来源权威。

## 5. 时间与文本合同

### 5.1 原始事件与归一化时间图

保存供应商原始事件（去凭据）用于定位问题；归一化为 `NarrationTimingMapV1`，包含 source/spoken 文本、映射版本、音频 hash、durationMs、`tokens[]` 和 `boundaries[]`。原始 timing 与合法切点表在 ready 前冻结，但不预先按字数/毫秒切成只能合并的分镜单元。

- token：稳定 ID、sourceStart/sourceEnd（正文 UTF-16 半开区间）、spokenText、startMs/endMs（整数）、providerSentenceIndex、providerIndexRange。
- boundary：稳定 ID、sourceOffset、相邻 token ID、visualTimeMs、边界规则版本。完整枚举相邻非重叠 token/source span 之间的合法切点，另含正文首尾边界（画面时间 0/durationMs）。内部切点取下一 token 实际发声起点及其 sourceStart，之间未发声的标点/空白归前镜；同一 source span 的多 token、不完整代理对/组合字符内部均不可切。相同时间的内部候选只保留最大合法 sourceOffset，并保留其余 offset 的归并记录；时间为 0/durationMs 时只保留正文首/尾边界。最终可选边界时间严格递增，不能制造零时长镜头。结构合法不代表语义合适，具体切点仍由 planner 结合全文决定。
- sourceText 是正文原样快照；首版不启用 SSML、Markdown 自动过滤、供应商任意文本 replace，也不向正文插入情感标签。语气走独立参数。
- 数字/规范读法可能产生一对多 token，保留 source span；多 token 共用 source span 时，不能在该 span 中间切镜头。重复短语用供应商句序号和递增 source 范围定位，不用全篇首次 `indexOf`。
- 供应商 text index 的范围及单位（句内/任务累计、字符/token 序号）与 time 基准均由实测协议资格报告锁定，不能直接当正文 UTF-16 偏移。本轮诊断已观察到任务累计 token 序号，见[实测索引证据](../records/2026-09-06-narration-timing-diagnostics.md)；未验收组合不能套用该观察。若句内时间需平移，只允许使用该句实际 PCM 起点，不能累加预估句长。冲突/缺失/不明确映射报 `narration_timing_invalid`，不插值猜测。

字段依据：[服务端事件](https://help.aliyun.com/zh/model-studio/cosyvoice-server-events)。跨句基准和字符单位是必须验证的协议边界，不把该文档没有说明的细节写成事实。

2026-09-06 原生零时长适配补充：允许将同句、连续来源且共享原生端点的零时长token与紧邻正时长token组成不可拆片段，保留全部原始成员与归并证据；起止仅使用成员已有的原生时间，禁止补造内部字时间。首部零点可向后归并，其他优先向前；不共享端点、跨句、孤立/全零、缺文及正时长重叠仍无效。切点表不得进入归并片段内部，正常字token保留原有切点。见[限定适配记录](../records/2026-09-06-narration-native-span-adaptation.md)。该结构适配已通过118项回归及冻结样本重放，见所链接记录；通过范围不包含音质或模型整体资格。

### 5.2 语音边界与画面边界不是同一概念

原始 token 时间只描述“何时说了什么”，字幕显示延长、停顿画面停留不得覆盖它。分镜有独立 `visualStartMs/visualEndMs`：必须按序无缝覆盖 `[0,durationMs]`，首镜从 0 开始，末镜到文件结束；句间停顿默认保留给前镜，下一镜在所选边界的下一 token 开始时切换。首尾静音归入首末镜。

首版 planner 接收全文、token 发声信息和完整合法边界表，输出每镜 `start_boundary_id/end_boundary_id`。相邻镜头共享同一边界，首尾覆盖全部正文与音频；本地只校验来源、合法切点、连续覆盖和确定性时间映射，不让 LLM 编造精确秒数，不按字数重排、不把一段强制拉长到最少 1 秒。为阅读方便的分句展示不能缩减可选边界集合；不按 12 字或 1,800 ms 建立只能合并的桶。若单个不可拆 span 很长则提示限制，不插值制造词内切点。

2026-09-12 补记（[边界就近吸附设计](./2026-09-12-storyboard-boundary-snap-design.md)）：planner 从完整边界表原样复制 ID 的要求在实测中出现数字漂移（450 个边界、12 个端点错 3，漂移 ≤320ms），本地投影对不存在的 boundary ID 增加唯一最近吸附（仅当存在唯一最近真实边界且 `|Δ| ≤ 500ms`；等距歧义、超限、不可解析仍拒绝），吸附后存解析后的真实边界 ID，其余全部校验不变。prompt 仍要求精确复制，容错为运行时兜底。

2026-09-12 补记 2（[候选切点精简设计](./2026-09-12-storyboard-coarse-candidates-design.md)）：本节"为阅读方便的分句展示不能缩减可选边界集合"约束按生产证据修订——真实项目上全量边界表（450-464 个长 ID）的逐字复制连续三次失败（漂移/时间倒流/漏字段），即使有吸附与重生兜底，任务负担仍超出 LLM 可靠能力。修订为：planner 只接收按时间编号的**粗切点候选**（句末 或 停顿 ≥400ms，含首尾，实测 62-73 个），本地确定性还原为真实边界 ID 后照常投影；词内/句中细切点不再可选，属有意的质量上限收紧（候选密度约 1.5 秒/个，选择余量约 4-5 倍），规则为常量可回退全量。投影、吸附、重生触发面与校验全部不变。

正式 `storyboard_v2` 包含 source narration ID/hash、timingMap hash、boundary ranges 与最终 visual intervals；旧 `start_hint_sec/end_hint_sec` 若为 UI 兼容保留，只能由最终毫秒派生。新旧合同用版本判别联合，禁止 v2 缺字段时回落 v1。回归须证明 18 个各 250 ms 的独立字 token 可以在第 6 字后（1,500 ms）切镜头，而非只能选择机械分组末尾；投影前后原始 timing hash 不变。

每镜 `script_excerpt` 必须由同一范围确定性派生：`sourceText.slice(startBoundary.sourceOffset, endBoundary.sourceOffset)`；持久化 source 起止及派生摘录，不能让 LLM 再独立切一份正文。新 planner 输出合同不要求摘录；若兼容输入仍带摘录，须与派生值逐段完全相等，否则结构校验失败。v2 不走旧 `indexOf/fuzzy` 重定位与 82% 覆盖容忍。资产 planner 的 `script_excerpt`、compiler 的 `source_excerpt` 与真实 interval 共同来自这一已验证范围；单镜视觉重生锁定边界、时间、来源及派生摘录。测试同时覆盖“时间按 ABC/DEF、摘录按 AB/CDEF”的双重完整覆盖反例和重复句，不能只查总覆盖率。

提供实际时长能消除估时误差带来的节奏决策失真，但不能保证镜头创意必然优秀。过密/过长镜头展示告警和预览供人判断，不新增语义审校器自动卡关。已有一次结构性 regen 可保留，不新增无限“节奏修复”循环。

### 5.3 字幕

从 raw token 按标点、字数和现有字幕样式约束断行，确定性产出 SRT/VTT。字幕显示不得越过下一字幕或音频结束；可在既有显示规则内延长可读时间，但不跨后一句发声起点。保留 `speechStartMs/speechEndMs` 与 `displayStartMs/displayEndMs`，样式变化仅重建显示层。

SRT/VTT 是本地产物，不要求供应商直接提供字幕文件；新路径禁止 ASR 再识别，也禁止无声息回退按字均分。时间戳不合格时可播放候选排查，但不能确认、生成正式字幕或进入分镜。

时间来源跨层显式映射：NarrationRecord 的 `timingSource=provider_native` 导入字幕 artifact 时写必填 `metadata.timing_source=provider_timestamp`（沿用现有 artifact 枚举）、narration ID、audio/timing hash 及 subtitle revision ID。v2 schema/validator 校验来源及引用一致，缺失或 estimated/mixed 均拒绝；不能仅复制样式。`remotion-input-builder` 的 v2 分支在校验后直接消费字幕绝对 cue 时间，绕过 `normalizeSubtitleCuesToNarration` 的旧缩放逻辑；v1 行为不变。尾静音不等于字幕漂移，例如 117 秒音频、末字幕 115 秒结束必须保持 115 秒，禁止拉到文件末尾。跨 builder→manifest→真实 render props 逐 cue 验证起止相等（只允许 SRT 毫秒表示精度），且整篇口播仍只有一个全局播放 clip。

## 6. 资产与最终合成

新增 `asset_plan_v2` / `asset_manifest_v2` 判别分支，不给旧 v1 添一堆可缺省字段伪装新能力。

- 资产计划直接引用 confirmed narration bundle 和分镜真实 intervals；音色由上游冻结，asset planning 的全局音频意图不得重新挑选音色。
- v2 不创建付费 `tts_audio` 任务。字幕已有默认文件，样式改变时只本地派生。禁止 compiler、运行期 `tts-chunking.service`、批量资产按钮再次调用 TTS。
- manifest 的 narration reference 指向 script 口播文件；保留一个全局音频 artifact 供合成消费。每镜路由显式携带 `narrationRange={startMs,endMs}`，不把该全局 artifact.duration 当镜头时长。
- 原始素材需要的 duration 从该镜头 visual interval 计算，再根据冻结视频模型的可选时长/上限选择最小可覆盖长度；超上限按现有 clip 分拆策略规划。转场余量单独记录，不能写入口播实测时长。素材不足继续既有显式 fallback/阻塞规则，不通过口播变速掩盖。
- compose 直接使用已冻结 visual interval 和完整音轨，禁止按 chunk/字符再缩放。实际 WAV 时长从最终 sampleCount/sampleRate 得出，不把片段 duration 相加当最终探测值。
- render 用统一函数将绝对毫秒端点映射为 frame：每个端点只取整一次，再相减获得帧数，禁止逐镜取整后累计。零帧镜头报错并返回分镜调整；最终帧时长误差不超过一帧。
- 如既有结尾留白继续生效，显式表示 `contentDurationMs` 与 `outroDurationMs`；口播与字幕不延长，末画面停留单独编排。成片总长是内容时长加显式片尾，不能报成口播时长。

## 7. API、可靠性与存储

建议新增接口，均复用项目 owner/admin 权限校验：

| 接口 | 请求/行为 |
|---|---|
| `POST /api/projects/:id/script/narration/generate` | `source_script_record_id`、配置 revision、有限 settings override、必填 `idempotency_key`；返回 202 + run/record ID |
| `GET /api/projects/:id/script/narrations/:recordId` | 返回候选状态、校验结果、授权媒体链接与时长；不泄漏其他项目记录 |
| `POST /api/projects/:id/script/narrations/:recordId/confirm` | 携带 source/settings hash、expected active narration ID、目标区间快照、必要的超区间接受标志；事务复查并激活，重复确认幂等，返回新 snapshot |
| `POST /api/projects/:id/script/narrations/:recordId/cancel` | 取消本次任务；取消后迟到的 task-finished 不能激活，保留已发生的 usage |
| `POST /api/projects/:id/script/narrations/:recordId/subtitles` | 按当前已保存字幕配置派生 revision；携带 expected narration ID/hash 与字幕配置 hash；同 narration/settings/builder 版本幂等，成功返回 revision |

Project snapshot 添加 active narration 摘要、当前 script 的最新候选/run、`narration_readiness` 和阻塞原因。逐词大数组不塞进每次 snapshot，按授权 timing URL 获取。分镜 generate 仍是现有接口，只增加 v2 前置检查。

字幕设置保存后由配置 controller 调用独立 subtitle revision service；新字幕接口是显式重试入口。纯 builder 不负责 DB 副作用。尚无口播时只保存偏好；已有口播时本地派生，激活前复查 narration 与字幕配置投影。派生失败保留旧文件/引用并标记字幕待更新，旧成品可查看，新 compose/render 不得用新设置假称旧字幕已更新。该服务没有外部 TTS/ASR 调用。

2026-09-08 任务9C编排细化：复用口播 run 的 `GenerationRunEvent` 持久化 `narration_subtitle_target` 事件，保存完整目标字幕投影、项目字幕配置投影 hash、builder 版本、target ID 和 pending/ready/failed 状态。派生前以事务登记目标，激活事务必须复查同一目标，成功事件与 revision/manifest/活动引用一起提交；失败不修改旧引用，pending/failed 状态由快照及新 compose/render 共用读取。另一实例登记新预设版本后，旧目标即失去激活资格；同一预设更高版本不能被旧部署重试降级，同版本内容变动须显式升级版本。状态事件不计为供应商调用，不改不可变字幕 revision 或初始 bundle。Prisma 提交后同步活动引用镜像；下游入口再次读取数据库活动指针，防止热缓存或其他实例沿用已失效结果。

复用 GenerationRun / RunConfigurationSnapshot / usage ledger，新增内部 operation `script.narration.generate`，capability 仍为 `tts.synthesize`，成本归属文案步骤。显式模型由已冻结 resolved_capabilities 构造，音色由 resolved_creative 及兼容能力表解析；不能临场读取环境默认值覆盖 run。不恢复 quote API、预算闸门或辅助音色自动创建。

输出保存在项目根下 `narration-runs/<runId>/`；现有 artifact resolver/file API 增加该目录及 owner 检查，不依赖 assets run 才能播放。先写临时文件，全部验证后原子提交 bundle manifest，随后 DB 标为 ready；半成品不可被 active 引用。沿用项目删除/备份恢复边界，不新增自动清理历史音频。

外部请求前以 GenerationRunEvent 持久化 provider call intent（稳定 providerRequestKey、attempt、请求指纹），不伪造尚不存在的 AssetProviderJob/manifest。usage 接口允许按 run/snapshot/request key 记媒体使用量，assetProviderJobRecordId 为空。客户端幂等不等于供应商保证 exactly-once：网络断开或进程崩溃后若无法确定供应商结果，状态为 `unknown`，禁止自动重发全文。用户显式重新生成会创建新 run，并提示可能已有费用。已成功保存 bundle 可从 DB/磁盘恢复；lease fencing 防旧实例回写。usage 的累计 characters 取最终值/单调最大值，不能把每次 sentence-end 累计值相加；未知费用标未知，不记零。

口播租约身份按每次 claim 的 owner + claimCount 固定为不可变值。同 owner 再次取得租约也属于新的 claim；口播运行终态更新与续租在同一条条件更新中核对完整身份，失配不得改变新 claim 状态或释放/延长其租约。不能以先查后写替代原子 fencing。Map 与 Prisma 实现须保持一致，通过可选且明确的 claim 条件保留旧 operation 的既有语义。

2026-09-07 任务 5 可靠性补充：供应商事实与派生账本分离。实际收到的终态/累计回执先作为项目私有、不可变的原子事实文件保存，绑定 project/run/snapshot/providerRequestKey、source/settings hash 与供应商任务身份，记录严格校验的 partial/final/none、远端结果和稳定错误类别；不包含凭据或逐词大数组。文件按内容 hash 标识，同 run 合法晚到事实不得覆盖早先事实，未知推断不得阻塞后续实际回执。GenerationRunEvent 引用该事实/hash，usage ledger 是派生结果；已应用 hash 幂等，累计量只取最大值，完整性按回执事实而非取消状态判定。

若事实文件本身保存失败而数据库仍可用，失败处理仍应尝试将已验证的已知用量直接保存到既有账本；不伪造事实文件或已应用事件，不宣称存在可恢复的本地事实，也不重新请求供应商。若文件和数据库两种保存均失败，明确报告无法保全的边界，不能把未保存的用量记为零或宣称持久化成功。

账本或事件数据库写入暂错时保留本地事实，由既有 sweep 重放本地持久化；补账分支可读取已取消、失败或 unknown run 的未应用事实，但不能 claim 或改变这些 run/record 的业务状态，也不能调用供应商。生成中且完整 bundle 已验证的本地落库暂错继续沿既有 lease 恢复；无完整产物且远端未知仍禁止自动重发。事实读取复用项目路径防逃逸、严格 schema、内容 hash 及跨 run/source 校验；损坏事实拒绝处理，不伪造零用量。该记录属于运行内部恢复证据，不新增业务阶段、队列或自动清理，不把原子文件保存声称为断电级保障。

新 operation 的请求指纹包含 source script ID/text hash、有限 TTS overrides、生成时语音配置投影/版本，避免“同 key 换正文/语速”被当成相同请求。overrides 经过 schema 校验后进入配置 resolver 和冻结 snapshot，再构造 provider 参数；不只是 dispatch payload 的附加字段。旧 operation 的幂等语义不顺带改写。

错误码至少：`narration_required`、`narration_not_confirmed`、`narration_stale`、`narration_timing_invalid`、`narration_text_too_long`、`narration_voice_incompatible`、`narration_duration_not_accepted`、`narration_provider_unknown`。前置错误在 provider/LLM 调用前返回；403/404、409 来源冲突、422 不合法参数语义与既有 API 对齐。

## 8. 旧项目兼容与发布

迁移只添加 nullable 字段与新表，现存项目回填 `legacy_estimated`，新功能关闭时新项目也维持 legacy。资格验收及端到端验证通过后，部署开关让新建项目使用 `narration_first_v1` 并开放显式升级；开关关闭只停止创建/升级到新模式，不把已有 v2 强制解释成 v1。

旧项目继续预览、导出原有结果，显示旧时间来源。升级采用显式动作：展示将失效的分镜/资产/合成结果及模型/音色变化，用户确认后按 §2.5 在同一事务切换项目模式、固定合格配置、清空下游 active 指针和写升级事件，再回到文案准备口播；保留历史文件。不把旧 ASR 时间戳标成 provider_native，不用旧 merged 音频加猜测映射通过新 gate。新模式启用不改变全局 TTS 默认值。

v1/v2 可并存读取，单条链路不能混用。部分实施期间 v2 创建关闭，不能只上线按钮就允许资产按旧计划再合成口播。回滚保持数据库增量和 v2 读取能力；不能运行破坏性 down migration 删除新文件/记录。

## 9. 验收清单与剩余风险

以下是后续实施验收要求，当前均为**未验证**，不是已修复声明。

| 编号 | 必须证明的结果 | 验证方式 |
|---|---|---|
| A1 | 两个模型同稿有限比较后有可追溯选型，实际 model/voice 长文一个任务完成、原生时间有效 | 显式 live + 资格/评分矩阵 + 人工听审 + 脱敏事件 |
| A2 | 文案页能设置、生成、播放、确认；无口播 API/深链都不能新生成分镜 | 组件测试 + API 对抗 + 浏览器 |
| A3 | 音频与时间戳一次生成；新路径无 ASR、无按字 fallback | provider spy + fixture 回放 |
| A4 | 重复语句、数字、多音字、UTF-16 索引及停顿映射正确 | timeline unit/contract 测试 |
| A5 | planner 获得完整合法切点而非机械桶；分镜/资产/compose 数值同源且 raw timing 不变 | 6 字切点回归 + runtime harness 跨阶段断言 |
| A6 | 大于 500 字不拆独立 TTS；资产重试零额外 TTS 请求 | adapter/execution 回归 |
| A7 | 配置/文案更新、迟到响应、重启、重复提交不激活错版本；字幕完整样式快照可历史重放 | DB 多实例/恢复 + 预设更新后 revision/renderer 回归 |
| A8 | 最终时间轴覆盖音频；字幕误差人工达标；素材时长非整篇误用 | 音视频 probe + 成品验收 |
| A9 | 新旧模型默认隔离，auto/fixed、策略更新和升级事务可追溯；旧项目可查看/导出且不删历史资产 | 模型选择矩阵 + 迁移测试 + 浏览器 |
| A10 | 使用量正确归入项目文案成本，失败未知不伪造成功或零费用 | usage 对抗测试 |

残余风险：TTS 本身仍可能读错历史人名、长文表现变差、原生时间边界不准；提前音频仅提供真实约束，不保证 LLM 自动选择最佳节奏。通过资格测试、逐项目试听确认、版本固定和成品检查解决；不通过时停止新路径发布，而不是退回估算掩盖问题。
