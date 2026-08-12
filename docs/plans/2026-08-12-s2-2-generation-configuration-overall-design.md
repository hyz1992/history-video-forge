# S2-2 用户偏好、生成策略与成本控制总体设计

日期：2026-08-12

状态：已获用户批准，作为 S2-2 当前总体设计入口。

## 1. 任务与结论

S2-2 的目标不是增加一个孤立的“视频生成方式”下拉框，而是建立统一、分层、可追溯的生成配置体系，使用户能够在质量、速度和成本之间做明确选择，并使历史运行可以解释当时实际使用的策略、provider、model、参数和价格版本。

S2-2 分成三棒连续交付：

1. `S2-2A 配置与成本基础`
   - 用户默认、项目配置、单次运行覆盖和逐分镜覆盖。
   - 四档视频素材策略与 API 视频画质。
   - 后端费用报价、可选单次预算、超额授权。
   - 不可变运行配置快照与请求级成本记录。
2. `S2-2B 创作偏好`
   - 音色、画风、字幕样式。
3. `S2-2C Provider/Model 高级选择`
   - `llm.smart`、`llm.flash`、`image.generate`、`video.image_to_video`、`tts.synthesize` 五个独立能力槽位。

三棒顺序固定：A 验收后立即进入 B，B 验收后立即进入 C；中间不插入其他 V2 大功能。每一棒仍需独立设计、实施、验证和中文提交。B/C 的详细设计与实施计划在前一棒验收后根据当时代码和验证结果新建，不能把本总体设计当成可直接续跑的实施清单。

## 2. 设计依据与当前事实

本设计以以下当前事实为准：

- V2 数据基础、S1、S2-0、S2-1、S2-3、S2-4、S2-5 已收口。
- 当前前端和后端已有逐分镜 `api_video / remotion_motion` 切换、API 视频任务升级、DashScope 图生视频 provider、Remotion image-with-motion fallback 和前端费用估算。
- 当前 `visual_strategy_preference` 同时混合了 LLM 建议、默认值和用户修改，来源语义不够清晰。
- 当前费用主要由前端 `frontend/src/utils/pricing.ts` 估算，后端没有统一报价、预算门禁和请求级成本账本。
- 当前 assets API 通过 `provider_mode` 选择 DashScope/fake 路径，媒体 provider/model 还没有用户级能力槽位。
- S2-1 已建立 LLM `smart / flash` tier 与 provider:model 路由，但还没有用户级选择和不可变运行配置快照。
- `providers.json` 当前只承担 LLM provider 连接注册，不是用户可见的模型目录。
- DashScope 图生视频属于 assets 阶段；compose/renderer 只消费已有视频 artifact，不得调用视频 provider。
- 默认自动化不得调用真实付费 provider；真实调用只能显式执行并记录成本。

## 3. 设计原则

### 3.1 一个解析器，一份最终配置

建立集中式 `GenerationConfigurationResolver`。流水线阶段不得各自读取用户设置并自行解释优先级，只消费解析后的 `ResolvedGenerationConfiguration`。

配置生命周期分成两个明确步骤。项目初始化时：

```text
系统默认 → 用户默认 → 创建并冻结项目配置
```

项目运行时不再读取当前用户默认，只按以下顺序解析：

```text
系统硬限制
→ 管理员启用范围
→ 项目配置
→ 单次运行覆盖
→ 逐分镜覆盖
→ ResolvedGenerationConfiguration
→ RunConfigurationSnapshot
```

高优先级约束可以收紧低优先级配置，但不能被低优先级配置突破。例如演示模式、provider 无凭据、模型停用和能力不兼容都可以否决用户选择。

### 3.2 用户默认不追溯既有项目

- 用户设置只作为新建项目的初始值。
- 创建项目时复制一份完整项目配置并记录来源用户 preference revision。
- 用户随后修改默认值，不影响既有项目。
- 项目配置可以显式修改，但不反向更新用户默认。
- 单次运行覆盖只进入当次运行快照，不写回项目配置。
- 逐分镜覆盖只影响对应镜头。

### 3.3 历史运行不可变

每次真正提交生成任务前创建不可变 `RunConfigurationSnapshot`。快照至少冻结：

- 配置 schema 版本与配置 hash。
- 用户、项目、项目配置 revision、stage、operation 和 run id。
- 视频策略、API 视频画质、创作偏好。
- 每个 capability 最终解析出的 provider/model/模型版本。
- pricing version、报价、预算上限和超额授权。
- 逐分镜计划视觉路线与决策原因。

历史运行不得随着用户默认、项目配置、模型目录或价格变化而改变解释结果。

快照只记录提交时的计划配置。provider 失败后的自动降级、用户接受 fallback 和最终实际路线不回写快照，而是写入 append-only 运行事件并由最终 `AssetManifest` 保存实际 artifact route。

### 3.4 语义判断与本地策略映射分离

- LLM/分镜阶段只负责给出镜头是否适合 API 视频的结构化语义结论。
- 本地配置解析器只负责确定性优先级、映射、能力校验、预算判断和降级状态机。
- 禁止使用关键词、字符串黑名单或本地规则冒充“这个镜头是否值得 API 视频”的语义判断。

### 3.5 价格与预算由后端负责

- 后端是模型目录、价格版本、费用报价和预算门禁的唯一真相源。
- 前端只展示后端报价，不再硬编码生产价格用于授权判断。
- 估算费用和供应商确认的实际费用必须区分。
- 无法获得真实账单时不得把估算包装成实际费用。

### 3.6 不保存用户 API Key

S2-2C 第一版只允许用户选择平台已配置、已启用且凭据健康的 provider/model：

- 不支持 BYOK。
- 不保存或回显用户 API Key。
- 不向前端返回服务端环境变量名、credential id 或内部连接详情。
- 当前 assets API 的客户端 `dashscope.api_key` 覆盖需在 S2-2A 停止作为用户入口；显式 live harness 改用进程环境配置。

## 4. 三棒范围

### 4.1 S2-2A：配置与成本基础

正式交付：

- 用户默认配置和项目配置。
- 四档视频素材策略。
- API 视频 720P/1080P 质量设置。
- 逐分镜适配度、用户覆盖、最终路线三层合同。
- 可选单次付费生成预算上限。
- 后端费用报价、报价确认、超额授权和幂等消费。
- 不可变运行配置快照。
- 请求级用量/费用记录和项目成本明细。
- provider/model capability 槽位和目录合同，为 C 预留；A 默认仍使用系统自动解析。

不进入 A：

- 音色、画风、字幕设置 UI。
- 用户直接选择具体 provider/model。
- BYOK、支付、充值、套餐、月度账单、管理员额度分配。
- 图片/TTS 独立质量档。

### 4.2 S2-2B：创作偏好

正式方向：

- 音色：自动匹配或选择现有 `VoiceProfile`，支持试听；不做声音克隆。
- 画风：选择版本化画风 preset，将解析结果输入 `ProjectArtBible` 和正式中文 prompt；不把正式 prompt 写进设置代码。
- 字幕：选择版本化字幕 preset，并允许有限安全参数覆盖；renderer 消费最终解析样式。

三类偏好均复用用户默认、项目配置、单次覆盖和运行快照，不新建第二套配置系统。

### 4.3 S2-2C：Provider/Model 高级选择

能力槽位：

| capability slot | 说明 |
|---|---|
| `llm.smart` | 复用 S2-1 smart tier，承载高推理/高质量 operation |
| `llm.flash` | 复用 S2-1 flash tier，承载低延迟 operation |
| `image.generate` | 分镜图/封面等生图片能力，首批为 DashScope |
| `video.image_to_video` | 图生视频能力，首批为 DashScope |
| `tts.synthesize` | TTS 能力，首批为 DashScope |

UI 采用双层方式：

- 普通设置展示质量、速度、成本档位和自动推荐。
- 高级设置展开 capability 的具体 provider/model。

当前只有一个媒体 provider 时仍返回真实目录并显示“当前仅配置 DashScope”，不得伪造未接入 provider。显式选择的模型停用后要求用户重新选择；自动模式可以重新解析可用模型，但必须在运行快照中保存实际结果。

## 5. 视频策略合同

### 5.1 用户策略

```text
all_api_video
prefer_api_video
prefer_remotion
all_remotion
```

用户界面分别显示：

- 全部使用 API 视频。
- 优先使用 API 视频。
- 优先使用 Remotion 视频。
- 全部使用 Remotion 视频。

“全部 API”指全部适合 API 的叙事镜头，不强迫文字卡、地图、片尾署名等功能镜头调用视频 API。

### 5.2 分镜适配度

```text
remotion_only
remotion_sufficient
api_video_beneficial
api_video_strongly_recommended
```

适配度由分镜生成阶段输出，表达语义收益，不表达用户选择或 provider 可用性。

### 5.3 确定性映射

| 适配度 | 全部 API | 优先 API | 优先 Remotion | 全部 Remotion |
|---|---|---|---|---|
| `remotion_only` | Remotion | Remotion | Remotion | Remotion |
| `remotion_sufficient` | API | Remotion | Remotion | Remotion |
| `api_video_beneficial` | API | API | Remotion | Remotion |
| `api_video_strongly_recommended` | API | API | API | Remotion |

逐分镜显式覆盖优先于该表，但仍受系统硬限制、provider 能力和安全规则约束。

### 5.4 合同拆分

现有 `visual_strategy_preference` 拆成：

- `api_video_suitability`：分镜语义适配度。
- `visual_strategy_override`：用户显式覆盖，`api_video / remotion_motion / null`，保存于独立的 storyboard record + segment 作用域记录，不写回不可变分镜计划。
- `resolved_visual_strategy`：解析后的最终路线。
- `visual_strategy_resolution_reason`：来源和决策原因。

旧字段因来源不明确，不能直接认定为用户覆盖。既有已完成 storyboard/asset plan 不改写；新生成或重新生成的分镜使用新合同。兼容读取时可把旧值转为 legacy hint，但 `visual_strategy_override` 默认仍为 null。

逐段 regenerate 必须保留 `segment_id`，因此同一 storyboard record 下的用户覆盖继续有效；完整 storyboard regenerate 创建新 record，旧覆盖不使用文本相似度或顺序自动迁移。

### 5.5 API 视频失败语义

API 视频路线始终规划锚点图和 Remotion fallback 所需 motion cue：

- `all_api_video`：API 视频失败后不静默降级，segment 标记为等待重试或等待用户接受 fallback；用户明确接受后才激活 image-with-motion 路线。
- `prefer_api_video`：API 视频失败后自动激活 image-with-motion fallback，并记录 provider 错误、降级时间和原因。
- `prefer_remotion`：只有 `api_video_strongly_recommended` 自动使用 API；失败后自动回落 Remotion。
- `all_remotion`：不得规划或提交 video provider job。

## 6. 质量、创作偏好与 provider/model 的关系

- `api_video_quality` 首批为 `standard_720p / high_1080p`，它是素材参数，不等于最终 Remotion 导出分辨率。
- 音色 profile 与 TTS provider/model 正交：profile 表达声音偏好，provider/model 表达执行能力；解析器必须验证组合兼容性。
- 画风 preset 与 image provider/model 正交：preset 表达视觉约束，provider/model 表达执行能力；快照保存 preset 解析版本和实际模型。
- 字幕 style 与 TTS/ASR 正交：style 由 renderer 消费，不改变时间戳来源。
- 普通用户不需要理解模型 ID；高级用户可以对能力槽位显式选择。

## 7. 成本与预算总原则

- 用户可设置单次付费生成预算上限，也可不设上限。
- 新项目复制当时用户预算；既有项目不追溯。
- 每个付费生成请求先取得服务端报价。
- 报价包含配置 hash、pricing version、capability、provider/model、数量/时长/字符数、分项金额、总额和过期时间。
- 报价同时包含预计费用和授权上界；预算门禁比较授权上界，而不是乐观预计值。
- 用户可对该报价做一次显式超额授权；授权只对该 quote 生效并进入快照和审计日志。
- quote 必须短时有效、单次消费，并与幂等键一起阻止重复付费。
- 所有失败重试都必须重新报价；旧 quote 不存在“剩余额度”或分项二次消费语义。
- 项目成本视图同时展示预计费用、实际已确认费用和无法定价项。
- S2-2A 的预算是“提交前授权上界保护”，不是供应商账单硬封顶。若 provider 无法给出可信上界，该项必须显式超额授权；供应商实际账单异常高于上界时记录价格异常并停止该 catalog 项的新自动运行，等待运营修正。

## 8. 数据实体总览

S2-2A 详细字段见对应详细设计。总体实体为：

- `UserGenerationPreference`
- `ProjectGenerationConfiguration`
- `ProviderModelCatalog`
- `GenerationCostQuote`
- `RunConfigurationSnapshot`
- `GenerationRun`
- `GenerationRunEvent`
- `UsageCostRecord`

金额统一使用整数微元：`1 CNY = 1,000,000 cost_micros`。数据库使用 64 位整数；API 用十进制字符串传输。

## 9. UI 总体信息架构

### 用户设置页

新增 `/settings`，由现有齿轮入口进入：

- 基础设置：视频策略、API 视频画质、单次预算。
- 创作设置：音色、画风、字幕样式（B）。
- 高级设置：五个 capability slot 的 provider/model（C）。

### 项目设置

工作区提供项目设置入口，展示：

- 当前项目配置及其来源。
- 与用户默认的差异。
- 修改后受影响的阶段。
- 是否需要重新生成 storyboard、asset plan、assets 或 render。

配置修改不得自动删除或覆盖已经付费生成的 artifact。

### 成本明细

项目成本页/标签展示：

- 按运行和 capability 分组的费用。
- 预计/实际标记。
- provider/model、计量单位、请求状态。
- 超额授权记录。

## 10. 默认值与迁移

既有用户、既有项目和新注册用户默认值：

- 视频策略：`prefer_remotion`。
- API 视频质量：`standard_720p`。
- 单次预算：不设上限。
- provider/model：自动选择。
- 测试/演示/无真实凭据环境：真实视频 API 不可用。

迁移必须新增 migration，不改写 V2 baseline。既有运行、active record 和 artifact 不重写。

## 11. 非目标

- BYOK。
- 月度计费、充值、支付、套餐和商业账单。
- 管理员给用户分配消费额度。
- 自动选择价格最高模型作为“最好”。
- 为 B/C 提前写未来可能过期的详细实施计划。
- 将 semantic reviewer 接入策略主链路。
- 在本地用字符串规则判断镜头语义。

## 12. 阶段闸门

### S2-2A 进入 B 前

- 配置优先级、迁移、预算、报价、快照、成本账本和视频四档策略通过聚焦测试。
- 默认 fake/local 自动化不产生付费调用。
- 真实页面完成用户设置、项目设置、逐分镜覆盖和成本明细浏览器验收。
- 全部 API 与优先 API 的失败/回退差异有可复验结果。

### S2-2B 进入 C 前

- 音色、画风、字幕样式可从用户默认复制到项目并进入运行快照。
- 配置变化正确失效下游，不修改历史运行和已有 artifact。
- 真实页面完成试听、样式预览和项目覆盖验收。

### S2-2C 收口

- 五个 capability slot 都能列出平台真实可用 provider/model。
- 显式模型不可用时不静默切换。
- 自动选择可解释且快照完整。
- 前端、日志和 API 不泄露凭据。

## 13. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 配置逻辑散落 | 所有阶段只消费统一 resolver 输出 |
| 默认修改污染历史 | 项目复制 + 不可变运行快照 |
| 全部 API 名不副实 | 严格失败语义，不静默回退 |
| 全部 API 伤害功能镜头 | `remotion_only` 永久使用 Remotion |
| 预算可被直调 API 绕过 | 后端 quote + budget gate + 幂等消费 |
| 前端价格过期 | 后端 pricing version 为唯一授权依据 |
| 模型目录与 adapter 漂移 | readiness 校验启用项必须有 adapter 和凭据 |
| 用户设置泄露凭据 | 用户 API 只返回公开 catalog 元数据 |
| S2-2 膨胀 | A/B/C 独立闸门、独立计划、逐棒收口 |
