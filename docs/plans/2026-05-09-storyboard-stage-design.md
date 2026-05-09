# Storyboard Stage Design

日期：2026-05-09

状态：待执行设计

## 任务

为 `topic -> script` 之后的第一个 downstream 阶段定义正式边界。

本阶段命名为 `storyboard`，第一版目标不是镜头级分镜，也不是素材任务编排，而是把已确认的口播脚本翻译成“观众每几秒看到什么”的视觉段落计划。

## 一句话结论

第一版 storyboard 输出独立对象 `StoryboardPlan`：

> 以 `Script Draft Package` 为主输入，把口播正文按顺序拆成若干视觉段落，每段记录原文片段、时间提示、叙事位置、画面意图、场面描述、视觉元素和风险备注。

它不改脚本，不生成素材，不决定最终剪辑时间轴。

## 背景

当前 `topic + script` 第一阶段已经可以暂时冻结。`Script Draft Package` 已能稳定提供：

- `script_text`
- `estimated_duration_sec`
- `beat_trace`
- `quote_trace`
- `opening_span`
- `ending_span`

这意味着 downstream 可以从稳定脚本开始工作，而不需要回到 topic 或 writer prompt 里重新理解故事。

如果 storyboard 一开始就做镜头级分镜，很容易把资产生成、构图、剪辑节奏和口播对齐一次性混在一起。当前更稳妥的第一版是先做“视觉段落计划”：它足够支撑后续 asset planning，也足够轻，不会把还没设计的 assets / compose 提前写死。

## 阶段定位

### Storyboard 做什么

- 消费当前激活的 `Script Draft Package`。
- 参考对应 `Topic Package` 的边界信息，避免画面计划越出题材合同。
- 按口播顺序生成视觉段落。
- 给每个视觉段落标记：
  - 对应的口播原文片段
  - 大致时间提示
  - 叙事功能
  - 画面意图
  - 场面描述
  - 关键视觉元素
  - 画面表达风险
  - beat / quote trace 关联
- 输出可被 asset planning 消费的 `StoryboardPlan`。
- 记录本地结构校验结果。

### Storyboard 不做什么

- 不修改 `script_text`。
- 不回改 `Topic Package`、`Topic Delivery Pack` 或 `Script Input Bundle`。
- 不新增剧情、不补史实、不替 script 解决内容质量问题。
- 不做镜头级 shot list。
- 不决定图片、视频、TTS、字幕等具体资产任务。
- 不选择模型、素材供应商、分辨率、seed、重试策略。
- 不生成图片、视频、音频或字幕文件。
- 不生成 compose 时间轴。

## 输入边界

### 必需输入

运行时的正式必需输入是当前项目的激活脚本记录：

- `project.active_script_record_id`
- `ScriptRecord.topic_package_id`
- `ScriptRecord` 中可还原出的 `Script Draft Package`

从 `ScriptRecord` 还原 `Script Draft Package`：

| 字段 | 来源 |
|---|---|
| `script_text` | `script_records.script_text` |
| `estimated_duration_sec` | `script_records.estimated_duration_sec` |
| `beat_trace` | `script_records.beat_trace_json` |
| `quote_trace` | `script_records.quote_trace_json` |
| `opening_span` | `script_records.opening_span` |
| `ending_span` | `script_records.ending_span` |

### 边界参考输入

Storyboard 可以读取对应的 `Topic Package` 作为边界参考，但只能使用这些字段：

- `id`
- `title`
- `selected_angle`
- `core_conflict`
- `strong_scene`
- `forbidden_expansions`
- `risk_hints`
- `source_anchor_refs`
- `canonical_quotes`
- `narrative_tension_map`

这些字段只用于避免越界、帮助视觉化和标注风险。它们不能让 storyboard 重写脚本。

### 不应读取的输入

- `docs/records/` 中的历史质量记录。
- `docs/plans/archive/` 中的旧计划。
- topic 推荐阶段的候选池。
- prompt prose 里的临时说明。
- asset planning、assets、compose 的未定对象。

## 输出对象

### `StoryboardPlan`

`StoryboardPlan` 是 storyboard 阶段的正式输出对象，也是 asset planning 的未来上游。

第一版建议字段：

| 字段 | 类型 | 含义 |
|---|---|---|
| `plan_version` | string literal | 固定为 `storyboard_v1` |
| `source_script_record_id` | string | 对应的 script record |
| `source_topic_package_id` | string | 对应的 topic package |
| `estimated_total_duration_sec` | number | 来自 script 的预计时长 |
| `segments` | `StoryboardSegment[]` | 视觉段落 |
| `global_visual_notes` | string[] | 全局视觉注意事项 |

### `StoryboardSegment`

第一版 segment 字段：

| 字段 | 类型 | 含义 |
|---|---|---|
| `segment_id` | string | 段落稳定 id，如 `sb_001` |
| `order` | integer | 从 0 开始的顺序 |
| `script_excerpt` | string | 必须来自 `script_text` 的连续原文片段 |
| `start_hint_sec` | number | 大致开始秒数，不是 compose 时间轴 |
| `end_hint_sec` | number | 大致结束秒数，不是 compose 时间轴 |
| `narrative_role` | enum | 该段在口播里的叙事功能 |
| `visual_intent` | string | 这段画面要帮助观众感受到什么 |
| `scene_description` | string | 可视化场面描述 |
| `visual_elements` | string[] | 人物、地点、器物、动作、文字牌等高层元素 |
| `framing_hint` | enum | 景别/构图类型（镜头语言维度） |
| `content_type` | enum | 画面内容形态（内容类型维度） |
| `motion_hint` | enum | 镜头运动方式（运镜维度） |
| `editing_hint` | enum | 剪辑手法（剪辑节奏维度） |
| `on_screen_text` | string[] | 少量需要上屏强调的文字，不是完整字幕 |
| `linked_beats` | string[] | 关联 `beat_trace.beat` |
| `linked_quotes` | string[] | 关联 `quote_trace.quote` |
| `risk_notes` | string[] | 视觉表达风险或人工注意点 |

补充边界：

- `global_visual_notes` 允许为空数组。没有全局视觉注意事项时必须返回 `[]`，不得为了填字段编造泛泛提醒。
- 单个 segment 的 `linked_beats` / `linked_quotes` 允许为空数组，因为 opening、bridge 或 ending 可能只承担节奏和情绪衔接。
- 但 plan 级别必须覆盖上游 trace：`draft.beat_trace[].beat` 中的每个 beat 至少要被一个 segment 的 `linked_beats` 引用；`draft.quote_trace[].quote` 中实际存在的 quote 至少要被一个 segment 的 `linked_quotes` 引用。
- `linked_beats` 和 `linked_quotes` 只做追踪，不允许把 beat 标签或 quote 解释硬塞进画面描述。

### 枚举建议

`narrative_role`：

- `opening`
- `setup`
- `pressure`
- `turn`
- `peak`
- `ending`
- `bridge`

`framing_hint`（景别/构图类型，不含内容形态）：

- `wide` — 全景/远景
- `medium` — 中景
- `close` — 近景/特写
- `detail` — 细节/极近景
- `symbolic` — 象征性构图

`content_type`（画面内容形态，与 framing_hint 正交）：

- `live_action` — 人物/场景实景画面
- `text_card` — 文字牌/字幕卡
- `map` — 地图/示意图
- `illustration` — 插画/图示

`motion_hint`（镜头运动方式，不含剪辑手法）：

- `static` — 固定镜头
- `push_in` — 推进
- `pull_back` — 拉出
- `pan` — 摇镜

`editing_hint`（剪辑手法，与 motion_hint 正交）：

- `single` — 单镜/单张素材
- `cutaway` — 插入相关场景
- `montage` — 多张/多段连切

这四个枚举各自对应一个独立维度，asset planning 可以分别读取，不会产生混用歧义。

## 段落粒度

第一版 segment 以“口播段落对应的视觉段落”为单位。

建议粒度：

- 常规 60-120 秒脚本约 `5-12` 个视觉段落。
- 单段通常覆盖 `1-3` 个口播句子。
- 单段时间提示通常约 `5-12` 秒。
- opening 和 ending 可以更短，以便后续 asset planning 单独处理。

不建议：

- 一句一镜头。
- 一个 beat 一个超长段落。
- 直接写成镜头号、转场号、素材号。
- 把所有画面都写成抽象历史氛围。

## 本地结构校验

Storyboard 本地校验只做结构和合同边界检查，不判断“画面是否爆款”。

建议返回对象 `StoryboardValidationResult`：

| 字段 | 含义 |
|---|---|
| `stage` | 固定为 `storyboard_local_validation` |
| `decision` | `pass / regen_once / hard_fail` |
| `errors` | 结构性错误码 |
| `warnings` | 非阻断提醒 |
| `metrics` | 覆盖率、段落数、时间提示等统计 |

### 决策含义

- `pass`：结构可用，可以保存为当前 storyboard。
- `regen_once`：输出格式或覆盖存在可恢复问题，允许用结构反馈再生成一次。
- `hard_fail`：缺少激活脚本、script record 不存在、schema 无法解析等不可继续问题。

### 必要检查

| 错误码 | 决策 | 含义 |
|---|---|---|
| `storyboard_schema_invalid` | `hard_fail` | 输出无法通过 `StoryboardPlan` schema |
| `storyboard_segment_order_invalid` | `regen_once` | `order` 不连续或顺序错误 |
| `storyboard_timing_invalid` | `regen_once` | 时间提示不递增或 `end <= start` |
| `storyboard_excerpt_not_in_script` | `regen_once` | `script_excerpt` 无法在 `script_text` 中定位 |
| `storyboard_excerpt_order_invalid` | `regen_once` | excerpt 在正文中的位置倒序或重叠 |
| `storyboard_script_coverage_too_low` | `regen_once` | segment 覆盖正文比例过低 |
| `storyboard_opening_not_covered` | `regen_once` | 第一段没有覆盖开头附近内容 |
| `storyboard_ending_not_covered` | `regen_once` | 最后一段没有覆盖结尾附近内容 |
| `storyboard_trace_ref_invalid` | `regen_once` | linked beat / quote 不存在于上游 trace |
| `storyboard_trace_coverage_missing` | `regen_once` | 上游 beat / quote 没有被任何 segment 关联 |
| `storyboard_empty_visual_description` | `regen_once` | 画面意图或场面描述为空 |

### 建议阈值

第一版阈值保持保守：

- `segments.length >= 3`
- `segments.length <= 14` 先作为 warning，不作为硬失败
- excerpt 覆盖率低于 `0.82` 触发 `storyboard_script_coverage_too_low`
- 第一段 excerpt 起点距离正文开头超过 `20` 个汉字等价长度触发 `storyboard_opening_not_covered`
- 最后一段 excerpt 终点距离正文结尾超过 `40` 个汉字等价长度触发 `storyboard_ending_not_covered`
- segment 时间总长与 `estimated_duration_sec` 偏差超过 `25%` 记 warning，超过 `40%` 触发 `storyboard_timing_invalid`

覆盖率检查只用于防止 LLM 漏掉大段口播，不要求逐字切满所有连接词。

错误处理顺序：

- schema 无法解析时直接 `hard_fail`，不继续做结构检查。
- 如果任意 `script_excerpt` 无法在 `script_text` 中定位，先返回 `storyboard_excerpt_not_in_script`，并跳过覆盖率计算，避免把定位失败误报成覆盖率不足。
- 如果所有 excerpt 均可定位，再计算顺序、覆盖率、opening/ending 覆盖和 trace 覆盖。
- `errors` 可以包含多个可恢复错误；只要没有 hard fail，最终 `decision` 统一为 `regen_once`。

## LLM 使用

Storyboard v1 需要 LLM 参与，因为“把口播翻译成可观看段落”属于语义视觉化任务。

正式 prompt 要求：

- 文件位置：`harness/prompts/storyboard/storyboard-planner.prompt.md`
- 元数据 `language: zh-CN`
- 元数据 `stage: storyboard`
- 只消费正式对象：
  - `Script Draft Package`
  - 受限 `Topic Package` 边界摘要
- 只输出 `StoryboardPlan`
- 必须要求 `script_excerpt` 从 `script_text` 连续截取
- 必须要求不改写脚本、不新增剧情、不做资产任务

当本地结构校验返回 `regen_once` 时，第二次生成不修改 prompt 文件本身，而是在 prompt input 中加入：

- `regeneration_context.reason`
- `regeneration_context.errors`
- `regeneration_context.metrics`

正式 prompt 必须说明：第二次生成只能修复 segment 切分、excerpt 对齐、trace 关联、时间提示和空画面描述，不得借机改写 `script_text` 或扩展剧情。

现有 prompt registry 只支持 `topic / script`，实现 storyboard 时必须同步扩展 registry 与 prompt language check 的 stage 枚举。

## 运行时编排

第一版推荐编排：

```text
project.active_script_record_id
-> load ScriptRecord
-> load TopicPackage boundary context
-> generate StoryboardPlan
-> local validate
-> optional regen_once
-> save StoryboardRecord
-> project.active_storyboard_record_id
-> project.status = storyboard_ready
```

约束：

- 不做多稿竞赛。
- 不做 semantic reviewer。
- 最多一次结构性 `regen_once`。
- 本地校验失败时不得写入 active storyboard。
- storyboard 失败不回滚 script。

## 持久化边界

建议新增 `StoryboardRecord`，与 `ScriptRecord` 一样保留历史版本，项目只激活当前版本。

建议字段：

- `id`
- `project_id`
- `topic_package_id`
- `script_record_id`
- `plan_json`
- `validation_result_json`
- `execution_state_json`
- `graph_trace_summary_json`
- `runtime_diagnostics_json`
- `created_at`

`Project` 建议新增：

- `active_storyboard_record_id`
- `latest_storyboard_run_trace_json`

状态流转：

- 成功生成并校验通过：`storyboard_ready`
- 失败：维持原状态，通常仍为 `script_ready`
- 当生成新的 active script 时，必须清空 `project.active_storyboard_record_id`，并将状态回到 `script_ready`。旧 `StoryboardRecord` 可以保留作历史记录，但不得继续作为当前 active storyboard。
- `project-snapshot` 的 `restore_route` 必须识别 `storyboard_ready`。第一版没有前端 storyboard 页面时，可以暂时指向 `/projects/:id/script` 并附带 TODO；一旦新增页面，应改为 `/projects/:id/storyboard`。不能让该行为保持隐式默认。

## API 边界

第一版新增：

```text
POST /api/projects/:projectId/storyboard/generate
```

第一版 API 使用同步模式：请求内完成 LLM 生成、本地校验、可选一次 regen、持久化和返回结果。不引入 `job_id`、SSE 或后台队列。后续如果 storyboard 变慢或接入批量处理，再单独设计异步接口，不在本阶段预留半成品协议。

成功返回：

- `project_id`
- `run_mode`
- `source_script_record_id`
- `storyboard_plan`
- `local_validation`
- `execution_state`
- `graph_trace_summary`
- `runtime_diagnostics`

主要错误：

- `project_not_found`
- `active_script_record_missing`
- `script_record_not_found`
- `topic_package_not_found`
- `storyboard_generation_failed`
- `storyboard_local_validation_failed`

## 与后续阶段的关系

### 对 asset planning

`StoryboardPlan` 是 asset planning 的输入。

Asset planning 可以读取：

- `segments`
- `visual_elements`
- `scene_description`
- `on_screen_text`
- `risk_notes`
- `framing_hint`
- `motion_hint`

但 asset planning 才能决定：

- 生成图片还是视频
- 使用什么模型
- 需要多少资产任务
- 资产依赖关系
- 文件命名和重试策略

### 对 assets

Storyboard 不直接生成资产，也不定义生成参数。

### 对 compose

`start_hint_sec` / `end_hint_sec` 只是提示，不是最终时间轴 source-of-truth。Compose 阶段未来应基于真实音频、字幕和资产时长生成最终 timeline。

## 风险

- 如果 segment 粒度太细，会提前滑向 shot list。
- 如果 segment 粒度太粗，asset planning 需要重新拆分。
- 如果 prompt 要求过多，LLM 会把 storyboard 写成素材清单。
- 如果 coverage 校验过严，会因为标点和连接词导致无意义失败。
- 如果不保存 trace，后续很难判断 storyboard 是脚本问题还是视觉化问题。

## 完成标准

后续实现完成时，至少应满足：

- `StoryboardPlan` shared schema 可解析。
- storyboard prompt 可被 registry 加载，且通过 zh-CN 检查。
- 本地 validator 能抓住缺 excerpt、倒序、覆盖不足、空画面描述。
- API 能从已确认 script 生成 storyboard。
- 成功结果能落库并成为项目 active storyboard。
- 失败结果不会回改 topic/script。
- 相关文档同步更新，不再让 storyboard 在核心文档中保持纯 `TBD`。
