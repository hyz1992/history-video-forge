# 项目现状与后续流水线作战地图

日期：2026-05-09

## 1. 文档定位

本文档用于帮助项目负责人和后续 agent 快速建立全局认知：

- 当前项目已经做到哪里
- 哪些阶段已经可以暂时冻结
- 接下来视频流水线应按什么顺序推进
- 每个后续阶段在正式实施前必须先回答什么问题
- 后续 agent 进入项目后第一件事该做什么，不该做什么

本文档不是 implementation plan，也不替代正式架构文档。它是一份“宏观作战地图”：

- 负责整理方向、边界和推进顺序
- 不负责定义具体字段、API、数据库表或 prompt 正文
- 不授权任何 agent 直接实现 downstream 详细阶段

如果本文档与 `AGENTS.md`、`docs/architecture/`、`harness/README.md` 冲突，以后者作为更高优先级真相源。

---

## 2. 一句话当前结论

`topic + script` 第一阶段已经达到当前可用线，可以作为后续视频流水线的稳定上游；下一步不应继续打磨 topic/script，而应先为 `storyboard` 阶段补正式设计文档与 implementation plan。

---

## 3. 项目整体目标

`story-video-forge2` 是一个面向历史故事短视频的 AI 生成系统。

它不是通用视频生成平台，也不是通用内容工厂。当前产品焦点是：

> 通过结构化上游边界、轻量候选筛选与有限修补，把“历史故事短视频”的生成过程做成稳定、可复验、可扩展的流水线。

项目最终希望形成的完整流水线大致是：

```text
topic
-> script
-> storyboard
-> asset planning
-> assets
-> compose
-> final video
```

其中当前已经完成到：

```text
topic
-> script
```

后续阶段已经有高层边界，但还没有进入可实施设计状态。

---

## 4. 当前已完成与可冻结范围

### 4.1 Topic 阶段

当前 topic 阶段已经具备：

- 系统自动推荐入口
- 事件库入口的设计边界
- 自定义输入入口的设计边界
- Event Registry 归一化
- Topic Candidate Builder
- Topic Candidate Card
- 用户确认
- Topic Package 冻结
- topic candidate library 与受控 fallback 复用

当前 topic 阶段的核心产物是 `Topic Package`。

它是 script 阶段唯一正式上游，不应在 downstream 阶段被重新解释或重写。

### 4.2 Script 阶段

当前 script 阶段已经具备：

- Topic Delivery Pack
- Script Input Bundle
- Script Draft Package
- 本地硬校验
- semantic reviewer shadow-only 量尺
- 有限 regen / patch 的设计边界
- runtime harness 与真实样本质量观测

当前 script 首稿已达到“可用线”：

- 不跑题
- 覆盖 `must_include_beats`
- 本地校验 pass
- 无模板污染
- reviewer shadow 未出现严重偏离
- 可以作为 storyboard 的上游输入基础

它还不等于“发布线”。发布线仍需要人工事实核查、最终口播打磨、镜头匹配与成片审看。

### 4.3 Harness 与观测

当前 harness 已服务于：

- `topic + script` 第一阶段稳定回归
- topic -> script live check
- script 首稿质量观测
- semantic reviewer shadow 校准
- UI acceptance 显式巡检
- topic candidate library observability

重要边界：

- live check 不作为默认自动化门
- semantic reviewer 只作为 shadow-only 量尺
- patch integration 不进入当前主路径
- harness 不重新定义产品对象

### 4.4 文档治理

当前已完成：

- `AGENTS.md` 已更新为 topic+script 暂时冻结后的阶段说明
- `docs/README.md` 已更新新 agent 阅读顺序
- 旧 topic/script plans 已归档到 `docs/plans/archive/topic-script/`
- `docs/plans/README.md` 与 `docs/records/README.md` 已说明 archive/records 的历史证据定位

后续 agent 不应从 archive 中挑旧 implementation plan 继续执行。

---

## 5. 当前不应继续做的事

在开启视频流水线下一步之前，不建议继续做这些事：

- 继续主动打磨 topic writer / selector / validator
- 继续堆 script writer prompt
- 为了 storyboard 方便而回改 `Topic Package`
- 把 `Topic Delivery Pack` 变成新的 narrative 合同
- 把 semantic reviewer 的 `patch_once/lift` 接入主路径
- 直接实现 storyboard / asset planning / assets / compose
- 让 downstream 阶段自由发明新的故事理解对象
- 恢复旧项目式“每个阶段重新理解一遍故事”的链路

只有在发现明确阻塞或回归时，才应回到 topic/script 做小范围修复。

---

## 6. 当前正式上游对象地图

后续流水线设计必须先理解这些对象的职责。

### `Topic Candidate Card`

给用户看的候选讲法。

它用于确认“这条视频讲什么角度”，不是后续阶段的完整剧本或分镜。

### `Topic Package`

script 阶段唯一正式上游。

它负责：

- 范围
- 核心冲突
- stakes
- 必讲 beats
- 禁止扩写
- 史料锚点
- canonical quotes
- ambiguity notes
- narrative tension map

它不负责：

- 完整大纲
- 分镜
- 素材计划
- 成片时间轴

### `Topic Delivery Pack`

单题交付微调对象。

它负责把 `Topic Package` 转成更适合本题交付的开头动作、口播气口、节奏和包装抓点。

它不能修改 narrative 合同。

### `Script Input Bundle`

script writer 真正消费的统一输入对象。

它是 topic/story 信息进入正文生成的收束层。

### `Script Draft Package`

script 阶段输出对象。

它至少包含：

- `script_text`
- `estimated_duration_sec`
- `beat_trace`
- `quote_trace`
- `opening_span`
- `ending_span`

后续 storyboard 阶段最可能从这里开始消费，而不是回头读散落 prompt 或 records。

---

## 7. 下一步流水线建议顺序

后续流水线不应一次性全开。推荐按以下顺序推进。

### Step 0：冻结确认与上游交接

目标：

- 明确 `topic + script` 是当前稳定上游
- 明确 storyboard 的输入只能来自已确认 script 产物和必要 sidecar
- 明确 downstream 不反向修 topic/script

建议产物：

- 一份小型 freeze checkpoint 或直接引用本文档
- 后续 storyboard design 的输入假设清单

完成标准：

- agent 能回答：storyboard 可以消费什么，不可以消费什么
- 不再要求先继续改 topic/script prompt

### Step 1：Storyboard 阶段设计

这是下一步最应该优先做的正式设计。

高层目标：

> 把已确认的口播脚本翻译成“观众每几秒看到什么”，不重新发明故事。

Storyboard 阶段应该回答：

- 输入是否直接消费 `Script Draft Package`
- 是否需要独立 `Storyboard Plan`
- 分镜单位是什么：句子、beat、镜头段、时间片，还是混合结构
- 每个分镜段需要哪些字段
- 如何表达画面内容、字幕、口播对齐、视觉重点、镜头动作
- 如何标记无法视觉化或需要人工处理的脚本片段
- 如何做本地结构校验
- 是否需要 LLM 参与，以及 prompt 放在哪里
- 是否允许 storyboard 请求 script 回改

建议边界：

- storyboard 不改 `script_text`
- storyboard 不改 `Topic Package`
- storyboard 不做素材生成
- storyboard 不做 compose 时间轴
- storyboard 只做“视觉叙事计划”

建议第一份正式文档：

- `docs/plans/YYYY-MM-DD-storyboard-stage-design.md`
- `docs/plans/YYYY-MM-DD-storyboard-stage-implementation-plan.md`

### Step 2：Asset Planning 阶段设计

在 storyboard 边界稳定后再做。

高层目标：

> 把 storyboard 拆成可以交给图片、视频、TTS、字幕等生成器的任务清单。

Asset planning 应回答：

- 资产任务对象叫什么
- 单个 storyboard segment 可能拆成哪些 asset task
- 图片、视频、音频、字幕是否用统一任务状态模型
- 哪些资产可以复用，哪些必须生成
- 如何表达素材依赖关系
- 失败重试策略如何限制
- 何时允许人工介入

建议边界：

- 不重写 script
- 不重做分镜
- 不做真实资产生成
- 只做任务编排与可执行计划

### Step 3：Assets 阶段设计

在 asset planning 对象稳定后再做。

高层目标：

> 按 asset plan 生成或收集图片、视频片段、口播音频、字幕中间产物。

Assets 阶段应回答：

- 图片生成、视频生成、TTS、字幕是否分 runner
- 每类资产的最小输入与输出是什么
- 资产文件如何落盘
- trace / diagnostics 如何记录
- 失败、重试、跳过、人工替换如何表达
- 是否复用旧项目基础设施，复用边界是什么

建议边界：

- 不做内容主裁判
- 不重新理解故事
- 不在资产生成失败时回改 topic/script

### Step 4：Compose 阶段设计

在 assets 最小产物可用后再做。

高层目标：

> 组合口播、镜头、字幕、转场和最终时间轴，形成成片导出物。

Compose 阶段应回答：

- 时间轴对象的 source-of-truth 是什么
- storyboard segment 与 asset 文件如何对齐
- 音频、字幕、画面、转场如何同步
- 缺素材时是失败、跳过、占位，还是人工处理
- 导出产物如何命名和落盘
- compose harness 如何验证导出成功

建议边界：

- compose 是工程拼装阶段
- 不承担内容层补锅
- 不重新生成脚本或分镜

### Step 5：End-to-End Harness

等 storyboard / asset planning / assets / compose 都有最小设计后，再补完整流水线 harness。

高层目标：

> 用固定样例证明从 topic 到最终视频产物的最小链路可运行、可追踪、可复验。

它应覆盖：

- 固定样例输入
- 每阶段产物落盘
- trace 和 diagnostics
- 失败定位
- 最小 UI acceptance 或 CLI smoke

不建议一开始就做全链路 harness，因为 downstream 对象还没收口。

---

## 8. 推荐给下一位 agent 的第一项任务

下一位 agent 最适合领取的任务是：

> 为 storyboard 阶段写正式 design 文档与 implementation plan。

建议任务边界：

- 只做 storyboard
- 不实现代码
- 不设计 asset planning / assets / compose 细节
- 不回改 topic/script
- 不新增正式 prompt，除非 design 已明确需要

建议开始前阅读：

1. `AGENTS.md`
2. `docs/project-current-state-and-next-pipeline.md`
3. `docs/architecture/pipeline-io-spec.md`
4. `docs/architecture/downstream-stage-high-level-design.md`
5. `docs/architecture/script-stage-design.md`
6. `docs/data/field-design.md`
7. `harness/README.md`

建议第一轮输出：

- `任务`
- `目标`
- `本次改动文件`
- `不改什么`
- `验证方式`

然后先写：

- storyboard stage design
- storyboard stage implementation plan

再等待明确执行指令。

---

## 9. Storyboard 设计的最小问题清单

正式设计 storyboard 时，至少要回答以下问题。

### 输入

- 是否只消费 `Script Draft Package`
- 是否需要读取 `Script Input Bundle` 的 hard lane
- 是否需要读取 `Topic Package.narrative_tension_map`
- 是否需要保留 `beat_trace` 与 `quote_trace`

建议初始判断：

- 主输入应是 `Script Draft Package`
- 允许引用 `Script Input Bundle` / `Topic Package` 做边界校验
- 不允许重新解释 topic

### 输出

可能需要一个 `StoryboardPlan`，但名称和字段必须在 design 中确认。

候选字段可能包括：

- `storyboard_id`
- `script_run_id`
- `segments`
- `segment_id`
- `script_excerpt`
- `start_hint_sec`
- `end_hint_sec`
- `visual_intent`
- `scene_description`
- `camera_motion`
- `on_screen_text`
- `asset_requirements`
- `risk_notes`

这些只是候选，不是正式字段。

### 校验

Storyboard 本地校验至少应考虑：

- 是否覆盖完整 script
- segment 是否按顺序排列
- `script_excerpt` 是否能在 `script_text` 中定位
- 是否存在空画面描述
- 是否产生超出 script 的新剧情
- 是否出现 asset planning 才该决定的具体生成参数

### LLM 使用

如果 storyboard 需要 LLM，prompt 必须：

- 放在 `harness/prompts/` 下合适阶段目录
- 使用中文
- 声明 `language: zh-CN`
- 只消费正式对象
- 不重写 script

---

## 10. 当前开放问题

以下问题尚未正式决定：

- storyboard 是否独立持久化
- storyboard 是否允许多版本
- storyboard segment 与口播时间如何对齐
- asset planning 是否与 storyboard 合并为一个阶段
- TTS 是 assets 阶段的一类任务，还是 compose 前的独立阶段
- 字幕是 assets 产物，还是 compose 派生产物
- 最终视频导出是否需要人工审核状态
- downstream 是否需要 UI 页面，还是先用 harness/CLI 跑通

这些问题不应该在代码里顺手回答，必须进入正式 design。

---

## 11. 当前判断

现在项目已经从“上游质量恢复期”进入“下游流水线设计准备期”。

最稳妥的推进方式是：

1. 不再主动重开 topic/script
2. 以 `Script Draft Package` 为下游起点
3. 先设计 storyboard
4. storyboard 稳定后再设计 asset planning
5. asset planning 稳定后再设计 assets
6. assets 稳定后再设计 compose
7. 最后补端到端 harness

这条路线的核心是：

> 每个阶段只回答自己的问题，不把故事理解责任一路拖到最后。

