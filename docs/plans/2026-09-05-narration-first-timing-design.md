# 口播前置与真实时间轴设计

日期：2026-09-05。状态：设计交付，尚未实现；模型选型为官方能力核对结论，真实音质及时间戳精度尚未验收。

实施入口：[实施计划](./2026-09-05-narration-first-timing-implementation-plan.md)。

## 1. 决策与范围

采用“确认文案 → 生成并确认整篇口播 → 按真实口播规划分镜 → 资产规划/生成 → 合成”的方案。口播准备归属现有文案步骤，不增加第七个产品阶段，不改变 Topic Package 合同、script writer 主链路和 reviewer shadow-only 边界。

**工程首选模型为 `cosyvoice-v3-flash`，通过百炼 WebSocket 接入。** 首选历史叙事音色候选为 `longsanshu_v3`（龙三叔），需要情感控制时使用 `longanyang`（龙安洋）候选。它们必须分别通过本设计的模型验收后才能标记可用。不是承诺 CosyVoice 音质优于所有新模型，也不是因价格低就忽略声音表现。

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
| `cosyvoice-v3-flash` | WS 支持长文本与原生字级时间戳；系统音色表逐项标注支持情况 | 首选：有叙事类现成音色，不必先复刻；需要新增 WS adapter，不能只改旧 HTTP model 参数 |
| `qwen-audio-3.0-tts-plus` / `flash` | 与 CosyVoice 共用 WS 协议；支持部分音色的时间戳；另有预复刻基础音色 | 升级备选：官方推荐的新系列，但系统音色表没有逐项时间戳列；不能据此断言不支持，也不能未经具体音色验证直接设默认 |
| `cosyvoice-v3.5-plus` / `flash` | 原生时间戳能力在客户端文档列出；无现成系统音色，需要自定义音色 | 暂不首选：引入音色创建、兼容与运营状态，不是本轮解决时长的必要条件 |
| `MiniMax/speech-2.8-hd` / `2.8-turbo`（百炼） | 同步文本少于 10,000 字符；百炼 `subtitle_enable` 仅非流式可用 | 备选：当前百炼文档未完整给出字幕输出字段及字词粒度，不把 MiniMax 直连接口能力当成百炼已透传能力 |
| 当前 `qwen3-tts-instruct-flash` HTTP 路径 | 文本上限 600 字符；现有接口没有本方案所需的原生字词时间戳合同 | 保留旧链路，不作为新主路径 |

资料核对日为 2026-09-05；以上长度按各自接口定义，不能跨协议套用。来源：[百炼语音合成模型总览](https://help.aliyun.com/zh/model-studio/tts-model)、[WS 客户端事件](https://help.aliyun.com/zh/model-studio/cosyvoice-client-events)、[CosyVoice 音色表](https://help.aliyun.com/zh/model-studio/cosyvoice-voice-list)、[Qwen-Audio 音色表](https://help.aliyun.com/zh/model-studio/qwen-audio-tts-voice-list)、[百炼 MiniMax API](https://help.aliyun.com/zh/model-studio/minimax-synchronous-speech-synthesis-api)、[Qwen TTS API](https://help.aliyun.com/zh/model-studio/qwen-tts-api)。

### 2.2 首选的具体能力边界

- `longsanshu_v3`：官方定位有声书、沉稳男声，支持时间戳，不支持 Instruct。允许音色/语速快捷设置，情感控件禁用并解释原因。
- `longanyang`：支持时间戳与指定格式的情感/旁白角色指令。控件只开放该音色官方允许的值，不把自由文本“悲壮、悬疑”等直接当成供应商枚举。
- 正式 TTS 指令模板同样放在 `prompts/narration/`，声明 `language: zh-CN` 并版本化；业务代码只按能力校验参数、加载模板，不内嵌另一份正式模型指令。
- 首批部署固定北京地域，显式冻结 model、voice、region、protocol、rate、pitch、volume、sample rate、format 和指令版本。不同模型音色不能混用。现有自定义音色不因名字相似自动迁移。
- 首版选择 PCM 流并在本地封装单个 WAV，避免逐包 WAV 头拼接。采样率拟用 24 kHz；声道、位深及字节顺序由任务 0 的协议小样本锁定并用 fixture 固化，不凭猜测处理二进制。

上述音色能力来源：[CosyVoice 官方音色表](https://help.aliyun.com/zh/model-studio/cosyvoice-voice-list)。音色适合本项目的判断是选型推断，仍需试听验收。

### 2.3 整篇输入，不承诺无限长

WS 的单次 `continue-task` 最多 20,000 字符，同一任务累计最多 200,000 字符。首版本项目只开放单次输入，应用侧采用 UTF-16 长度不超过 20,000 的保守校验；这不是供应商字符计数规则的声明。当前几百至几千字文案应整体提交。超过应用上限，在请求前报 `narration_text_too_long`，让用户缩短文案；本轮不实现多请求拼接。20 万累计能力留作未来扩展，不显示为本产品已支持。

`run-task → task-started → 一次 continue-task（全文）→ finish-task → 收齐音频/时间戳 → task-finished`。这是一个供应商合成任务；供应商内部仍可能按句处理，不能承诺“一次神经网络前向计算”或绝对无衔接问题。[协议依据](https://help.aliyun.com/zh/model-studio/cosyvoice-client-events)

### 2.4 上线资格门

开发开始时先做有限能力验证，不直接修改默认配置。先验证首选两种音色；只有首选不满足要求时，才经明确授权验证 Qwen-Audio 备选，不自动扩大付费矩阵。

至少覆盖 3 种文案：短文、当前约 534 字的历史案例、1,500–3,000 字长文；覆盖多句、数字、年号、人名、多音字、引号、长停顿。保留 request ID、模型/音色、调用次数、耗时、计费字符、最终文件 hash、原始时间事件及脱敏报告。

通过条件：

- 全文同一任务，无客户端分段合成/交叉淡化；末句完整，听审无明显漏读、重复、跳音、破音及句间重置感。
- 每一个应朗读文本单位均有可验证来源映射；不允许以“覆盖率差不多”隐藏缺失。数字规范化必须可追踪，不要求朗读文本与显示文本逐字符相同。
- 字词时间有效、整体单调、无无法解释的重叠、位于实测音频范围内。验证供应商时间是句内还是任务累计时间，以及中文/英文/代理对索引单位。未确认时不得进入生产适配。
- 人工抽样至少 30 个边界，建议验收目标为绝对偏差 P95 ≤ 200 ms、最大 ≤ 500 ms；这是本项目验收目标，不是官方精度承诺。不通过则调整候选/参数重新验收，不能回落估算冒充通过。
- 明确判断叙事表现是否可接受，不能用本地关键词规则或“最新模型”标签代替听审。

本轮仅写设计和计划，以上 live 均未执行。真实验证需单独明确请求次数与费用上限；不恢复已经移除的产品 quote/预算授权体系。

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

新增轻量 `NarrationSubtitleRevision` 表：id、projectId、narrationRecordId、audioHash、timingHash、subtitleSettingsHash、builderVersion、SRT/VTT 相对 URI/hash、createdAt；记录不可变。初始字幕也是一个 revision，由 narration 记录保留初始引用；后续换行/样式产生新 revision，绝不覆盖原 bundle。预览按指定 revision 读取，项目 active 字幕指针必须属于 active narration。新字幕生成成功后事务切换指针：尚无 manifest 时只切字幕引用；已有 manifest 时以复用已有视觉 artifacts 的新 manifest 引用该 revision，再使 compose/render/publish 过期；失败保留旧字幕及视觉结果。

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

保存供应商原始事件（去凭据）用于定位问题；归一化为 `NarrationTimingMapV1`，包含 source/spoken 文本、映射版本、音频 hash、durationMs、`tokens[]` 和 `units[]`。

- token：稳定 ID、sourceStart/sourceEnd（正文 UTF-16 半开区间）、spokenText、startMs/endMs（整数）、providerSentenceIndex、providerIndexRange。
- unit：稳定 ID、连续 token ID 区间、source 范围、实际起止毫秒、正文文本。`unitizer_v1` 在标点处分隔，长句按最多 12 个 UTF-16 单位或 1,800 ms 组成小单元，若加入下一完整 source span 将越界则先结束当前单元；单个 span 超界时整体保留并告警。不可拆规范化 span；不做语义判断。单位在 bundle ready 前生成并冻结，LLM 只能组合，不得事后重写 timing map。
- sourceText 是正文原样快照；首版不启用 SSML、Markdown 自动过滤、供应商任意文本 replace，也不向正文插入情感标签。语气走独立参数。
- 数字/规范读法可能产生一对多 token，保留 source span；多 token 共用 source span 时，不能在该 span 中间切镜头。重复短语用供应商句序号和递增 source 范围定位，不用全篇首次 `indexOf`。
- 供应商 text index 是句内索引，不能直接当全文索引；time 的基准由实测协议资格报告锁定。若句内时间需平移，只允许使用该句实际 PCM 起点，不能累加预估句长。冲突/缺失/不明确映射报 `narration_timing_invalid`，不插值猜测。

字段依据：[服务端事件](https://help.aliyun.com/zh/model-studio/cosyvoice-server-events)。跨句基准和字符单位是必须验证的协议边界，不把该文档没有说明的细节写成事实。

### 5.2 语音边界与画面边界不是同一概念

原始 token 时间只描述“何时说了什么”，字幕显示延长、停顿画面停留不得覆盖它。分镜有独立 `visualStartMs/visualEndMs`：必须按序无缝覆盖 `[0,durationMs]`，首镜从 0 开始，末镜到文件结束；句间停顿默认保留给前镜，下一镜在下一单元首 token 开始时切换。首尾静音归入首末镜。

首版分镜选择连续 unit ID 范围，不让 LLM 编造精确秒数。输入给 planner 每个已冻结 unit 的原文、真实时长和邻接停顿。LLM 负责合并/选择范围及视觉节奏，本地只校验顺序、连续覆盖和确定性时间映射，不按字数重排、不把一段强制拉长到最少 1 秒。

正式 `storyboard_v2` 包含 source narration ID/hash、timingMap hash、unit ranges 与最终 visual intervals；旧 `start_hint_sec/end_hint_sec` 若为 UI 兼容保留，只能由最终毫秒派生。新旧合同用版本判别联合，禁止 v2 缺字段时回落 v1。

提供实际时长能消除估时误差带来的节奏决策失真，但不能保证镜头创意必然优秀。过密/过长镜头展示告警和预览供人判断，不新增语义审校器自动卡关。已有一次结构性 regen 可保留，不新增无限“节奏修复”循环。

### 5.3 字幕

从 raw token 按标点、字数和现有字幕样式约束断行，确定性产出 SRT/VTT。字幕显示不得越过下一字幕或音频结束；可在既有显示规则内延长可读时间，但不跨后一句发声起点。保留 `speechStartMs/speechEndMs` 与 `displayStartMs/displayEndMs`，样式变化仅重建显示层。

SRT/VTT 是本地产物，不要求供应商直接提供字幕文件；新路径禁止 ASR 再识别，也禁止无声息回退按字均分。时间戳不合格时可播放候选排查，但不能确认、生成正式字幕或进入分镜。

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

复用 GenerationRun / RunConfigurationSnapshot / usage ledger，新增内部 operation `script.narration.generate`，capability 仍为 `tts.synthesize`，成本归属文案步骤。显式模型由已冻结 resolved_capabilities 构造，音色由 resolved_creative 及兼容能力表解析；不能临场读取环境默认值覆盖 run。不恢复 quote API、预算闸门或辅助音色自动创建。

输出保存在项目根下 `narration-runs/<runId>/`；现有 artifact resolver/file API 增加该目录及 owner 检查，不依赖 assets run 才能播放。先写临时文件，全部验证后原子提交 bundle manifest，随后 DB 标为 ready；半成品不可被 active 引用。沿用项目删除/备份恢复边界，不新增自动清理历史音频。

外部请求前以 GenerationRunEvent 持久化 provider call intent（稳定 providerRequestKey、attempt、请求指纹），不伪造尚不存在的 AssetProviderJob/manifest。usage 接口允许按 run/snapshot/request key 记媒体使用量，assetProviderJobRecordId 为空。客户端幂等不等于供应商保证 exactly-once：网络断开或进程崩溃后若无法确定供应商结果，状态为 `unknown`，禁止自动重发全文。用户显式重新生成会创建新 run，并提示可能已有费用。已成功保存 bundle 可从 DB/磁盘恢复；lease fencing 防旧实例回写。usage 的累计 characters 取最终值/单调最大值，不能把每次 sentence-end 累计值相加；未知费用标未知，不记零。

新 operation 的请求指纹包含 source script ID/text hash、有限 TTS overrides、生成时语音配置投影/版本，避免“同 key 换正文/语速”被当成相同请求。overrides 经过 schema 校验后进入配置 resolver 和冻结 snapshot，再构造 provider 参数；不只是 dispatch payload 的附加字段。旧 operation 的幂等语义不顺带改写。

错误码至少：`narration_required`、`narration_not_confirmed`、`narration_stale`、`narration_timing_invalid`、`narration_text_too_long`、`narration_voice_incompatible`、`narration_duration_not_accepted`、`narration_provider_unknown`。前置错误在 provider/LLM 调用前返回；403/404、409 来源冲突、422 不合法参数语义与既有 API 对齐。

## 8. 旧项目兼容与发布

迁移只添加 nullable 字段与新表，现存项目回填 `legacy_estimated`，新功能关闭时新项目也维持 legacy。资格验收及端到端验证通过后，部署开关让新建项目使用 `narration_first_v1`；开关关闭只停止创建新模式项目，不把已有 v2 强制解释成 v1。

旧项目继续预览、导出原有结果，显示旧时间来源。升级采用显式动作：展示将失效的分镜/资产/合成结果，用户确认后在同一事务切换项目模式、清空下游 active 指针和写升级事件，再回到文案准备口播；保留历史文件。不把旧 ASR 时间戳标成 provider_native，不用旧 merged 音频加猜测映射通过新 gate。

v1/v2 可并存读取，单条链路不能混用。部分实施期间 v2 创建关闭，不能只上线按钮就允许资产按旧计划再合成口播。回滚保持数据库增量和 v2 读取能力；不能运行破坏性 down migration 删除新文件/记录。

## 9. 验收清单与剩余风险

以下是后续实施验收要求，当前均为**未验证**，不是已修复声明。

| 编号 | 必须证明的结果 | 验证方式 |
|---|---|---|
| A1 | 官方能力对应实际 model/voice，长文一个任务完成，原生时间有效 | 显式 live + 人工听审 + 脱敏事件 |
| A2 | 文案页能设置、生成、播放、确认；无口播 API/深链都不能新生成分镜 | 组件测试 + API 对抗 + 浏览器 |
| A3 | 音频与时间戳一次生成；新路径无 ASR、无按字 fallback | provider spy + fixture 回放 |
| A4 | 重复语句、数字、多音字、UTF-16 索引及停顿映射正确 | timeline unit/contract 测试 |
| A5 | 分镜规划输入已含实际时间，分镜/资产/compose 数值同源 | runtime harness 跨阶段断言 |
| A6 | 大于 500 字不拆独立 TTS；资产重试零额外 TTS 请求 | adapter/execution 回归 |
| A7 | 配置/文案更新、迟到响应、重启、重复提交不激活错版本 | DB 多实例及恢复测试 |
| A8 | 最终时间轴覆盖音频；字幕误差人工达标；素材时长非整篇误用 | 音视频 probe + 成品验收 |
| A9 | 旧项目可继续查看/导出，显式升级可追溯，不删历史资产 | 迁移测试 + 浏览器 |
| A10 | 使用量正确归入项目文案成本，失败未知不伪造成功或零费用 | usage 对抗测试 |

残余风险：TTS 本身仍可能读错历史人名、长文表现变差、原生时间边界不准；提前音频仅提供真实约束，不保证 LLM 自动选择最佳节奏。通过资格测试、逐项目试听确认、版本固定和成品检查解决；不通过时停止新路径发布，而不是退回估算掩盖问题。
