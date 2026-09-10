# Script 阶段设计

> 口播前置注记（2026-09-10 更新）：本设计描述 legacy 链路语义（存量项目仍适用）。narration-first 模式自 2026-09-10 起为新建项目唯一模式（发布开关已移除），在"确认 script"之后扩展出「确认正文 → 生成口播 → 确认口播」链路，产物为供应商原生词级时间轴的 `NarrationRecord` 与字幕 revision，并门控分镜推进。设计真相源：[口播前置与真实时间轴设计](../plans/2026-09-05-narration-first-timing-design.md)；阶段输入输出见 [Pipeline IO 规范 §2.6](./pipeline-io-spec.md)。

## 1. 目标

script 阶段的任务不是重新定义故事，而是在已经冻结的 `Topic Package` 边界内，稳定写出一版可口播、可继续进入后续阶段的历史短视频脚本。

实现级的校验阈值、返回对象 schema、标签定义与第二稿触发规则，详见：

- [Script 校验与决策规范](./script-validation-spec.md)

这一阶段必须避免旧项目中出现过的问题：

- 重新定义 topic
- 多稿并行后无限选稿/重写
- 多头语义审校
- prompt 过重导致风格、事实、包装互相打架

## 2. script 阶段的正式输入

script 阶段上游正式输入不是散落对象，而是以下结构化输入：

- `Topic Package`
- `Project Style Pack`
- `Family Bias Pack`
- `Topic Delivery Pack`
- `Script Input Bundle`

其中 `Script Input Bundle` 是 script 生成器真正消费的唯一统一对象。

## 3. script 阶段主链路

```text
Topic Package
-> Topic Delivery Pack
-> Script Input Bundle
-> Script Draft Package
-> 本地硬校验
-> 单一语义审校
-> 最多一次 patch / regen
-> 确认 script
```

当前阶段注记（2026-05-06）：

- 上述 `patch / regen` 是 script 阶段的设计态能力，不是当前实现主路径。
- `Script Writer Viral First-draft Quality` 执行期间，semantic reviewer 只作为 shadow-only 量尺。
- 本轮不得把 `patch_once / regen_once` 接入自动主链路；如需进入主路径，必须先有独立 patch integration 设计与执行指令。

narration-first 变体（2026-09 已实现，开关未开放）：主链路末端「确认 script」扩展为「确认正文 → 生成口播 → 确认口播」；`Script Draft Package` 之外新增 `NarrationRecord`（音频 + provider_native 词级时间戳 + 字幕 revision）作为本阶段正式产物，消费方为 storyboard/asset planning/compose 的 `narration_reference`。

## 4. 设计原则

1. 默认单稿，不默认多稿并行。
2. `patch_once` 与 `regen_once` 都必须有限次。
3. 时长只做严重异常检查，不做精确秒数 gate。
4. 本地硬校验只处理结构与显式边界，不做语义裁判。
5. 语义审校只有一个主裁判。
6. script 阶段不得反向修改 `Topic Package`。

## 5. Topic Delivery Pack 的定位

`Topic Delivery Pack` 是单题交付微调对象，不是 narrative 合同。

它负责：

- 开头动作倾向
- 压迫强度倾向
- 口播微偏置
- 节奏微偏置
- 结尾收束倾向
- 包装层抓点表达

它不能做的事：

- 修改 `must_include_beats`
- 修改 `forbidden_expansions`
- 修改 `family_label` 或 `scope_label`
- 修改 `narrative_tension_map`
- 把 Packaging Lane 变成正文硬模板

补充说明：

- `narrative_tension_map` 属于 `Topic Package`，因为它描述的是这条内容的叙事张力骨架
- `Topic Delivery Pack` 只负责把这条张力骨架转换成更适合本题交付的开头动作、声线微调、节奏微调与包装表达
- Packaging `hook_claim` 必须与 `narrative_tension_map.hook_claim` 同源，但表达可以更外显、更适合标题/封面/开头

## 6. Script Input Bundle 三通道

### A. Hard Lane

负责 script 阶段必须服从的硬边界，例如：

- 事件身份
- 本次切口
- 范围档位
- 核心冲突
- stakes
- 必讲节点
- 禁止扩写项
- 史料来源锚点
- 短原文锚句

当前第一阶段正式承接关系应写实为：

- `hard_lane.core_conflict <- Topic Package.core_conflict`
- `hard_lane.stakes <- Topic Package.stakes`
- `hard_lane.must_include_beats <- Topic Package.must_include_beats`
- `hard_lane.forbidden_expansions <- Topic Package.forbidden_expansions`
- `hard_lane.source_anchor_refs <- Topic Package.source_anchor_refs`
- `hard_lane.canonical_quotes <- Topic Package.canonical_quotes`
- `hard_lane.ambiguity_notes <- Topic Package.ambiguity_notes`

### B. Soft Lane

负责 script 的风格偏置，例如：

- narrator persona
- wording register
- 开头动作倾向
- 口播微偏置
- 节奏微偏置
- 结尾微偏置
- 强场面

### C. Packaging Lane

负责标题 / 封面 / 开头包装参考，例如：

- `hook_claim`
- `hook_emotion`
- `reveal_position`
- 标题 profile
- 封面 profile
- 风险姿态

原则：

- script 正文必须服从 `Hard Lane`
- script 正文可以吸收 `Soft Lane`
- script 正文不得被 `Packaging Lane` 绑死

### 创意引导层的最小补充

为了避免“结构稳定但稿子偏平”，当前建议在不新增阶段的前提下，为 script 增加极轻的创意引导输入：

- 来自 topic 阶段的 `viral_rubric`
- 来自 `Topic Package` 的 `narrative_tension_map`
- 来自 Packaging Lane 的：
  - `hook_claim`
  - `hook_emotion`
  - `reveal_position`

这些对象的职责分工是：

- `viral_rubric`
  - 帮助 topic 阶段挑出更有势能的 candidate
- `narrative_tension_map`
  - 给 script 正文提供张力递进目标
- Packaging Lane
  - 给标题/封面/开头提供外包装抓点

script 阶段不应该自己重新发明这一层。

## 7. Script Draft Package

script 生成阶段不只输出正文，还要输出轻量 sidecar：

- `script_text`
- `estimated_duration_sec`
- `beat_trace`
- `quote_trace`
- `opening_span`
- `ending_span`

这样本地硬校验和语义审校才有抓手，而不需要重新引入重型大纲。

### `beat_trace` 最小格式

每条只保留：

- `beat`
- `excerpt`
- `confidence`

它只回答一件事：

- 这条 `must_include_beat` 在正文里写到哪里了

它不是：

- 新大纲
- 新分段模板
- 分镜对象

### `quote_trace` 最小格式

每条只保留：

- `quote`
- `usage_type`
  - `exact`
  - `paraphrase`
- `excerpt`

它只服务于：

- 原文锚句使用追踪
- 本地硬校验
- 语义审校

## 8. 本地硬校验

本地硬校验只处理：

- bundle 完整性
- draft 完整性
- 正文非空
- beat 覆盖
- quote 使用追踪
- 严重时长异常
- 占位符
- 显式禁用扩写
- 开头 / 结尾存在

它不处理：

- 语气是否高级
- 开头是否够抓
- 口播是否像成熟历史号
- 结尾是否“更有余味”

这些属于语义审校。

### 本地硬校验输出

本地硬校验输出只允许：

- `pass`
- `regen_once`
- `hard_fail`

其中：

- `regen_once` 只用于可恢复的结构性问题
- `hard_fail` 表示本轮脚本无法继续自动推进

### 本地硬校验阈值表

| 检查项 | 判定方式 | 结果 |
|---|---|---|
| `bundle 完整性` | `Script Input Bundle` 必需字段缺失 | `hard_fail` |
| `draft 完整性` | `script_text / estimated_duration_sec / beat_trace / opening_span / ending_span` 缺失 | `hard_fail` |
| `正文非空` | `script_text` 为空或明显残缺 | `regen_once` |
| `正文体量过薄` | 正文低于当前时长档位的结构下限 | `regen_once` |
| `估时与正文体量失真` | `estimated_duration_sec` 明显高于正文体量可支撑的口播时长 | `regen_once` |
| `beat 覆盖缺失` | 任一 `must_include_beat` 没有 trace | `regen_once` |
| `beat_trace excerpt 过短` | excerpt 明显不足以证明命中 | `regen_once` |
| `beat_trace excerpt 脱离正文` | excerpt 无法在 `script_text` 中找到 | `regen_once` |
| `quote_trace 缺失` | 使用了锚句但未标明 `exact/paraphrase` | `regen_once` |
| `严重时长异常` | 明显超出当前档位合理范围 | `regen_once` |
| `极端时长异常` | 明显说明 topic 与正文完全错位 | `hard_fail` |
| `占位符残留` | `TODO / 待补充 / placeholder` 等 | `regen_once` |
| `显式禁写命中` | 确定性命中 `forbidden_expansions` | `hard_fail` |
| `opening/ending 缺失` | `opening_span` 或 `ending_span` 为空 | `regen_once` |

说明：

- 时长异常按“是否与当前档位明显失真”判断，不按精确秒数卡死
- 本地硬校验只判断“是否还能继续进入语义审校”，不判断“这稿好不好”
- 第一版数值阈值按以下规则执行：
  - 偏离 `duration_band` 不超过 `15%`：只记 `warning`
  - 偏离 `duration_band` 在 `15% ~ 35%`：`regen_once`
  - 偏离 `duration_band` 超过 `35%`：`hard_fail`
- 正文体量下限：`short=180字/6句`，`medium=320字/8句`，`long=420字/10句`
- 若 `script_char_count / estimated_duration_sec < 3.6`，视为估时明显虚高，按 `regen_once` 处理
- `beat_trace.excerpt` 少于 `14` 个汉字等价长度，或 excerpt 无法在 `script_text` 中找到时，视为 trace 命中不足，按 `regen_once` 处理；若 excerpt 与正文只差中英文引号边界符，可按结构性命中处理，但不得允许 `……` 拼接、改写或跨片段合并
- `quote_trace` 只有在正文实际使用了 `canonical_quotes` 时才强制要求存在；若使用了锚句但未标明 `usage_type` 或 excerpt 为空，按 `regen_once` 处理
- 本地硬校验建议返回：
  - `decision`
  - `errors`
  - `warnings`

## 9. 单一语义审校

语义审校必须只有一个主裁判。

输出集合固定为：

- `pass`
- `patch_once`
- `regen_once`
- `return_topic`

它主要看：

- 是否越界
- 是否明显漏 beat
- 是否营销腔过火
- 是否开头太弱
- 是否结尾拔高
- 是否口播不自然
- 是否缺少明显高潮
- 是否中段缺少持续悬念
- 是否结尾缺少余味

它不能做的事：

- 自己发明新的 topic
- 把 topic 改成另一种讲法
- 输出一大段新 narrative 建议

### 语义审校决策表

| 问题类型 | 典型表现 | 决策 | 原因 |
|---|---|---|---|
| `opening_weak` | 开头不抓人，但正文主体成立 | `patch_once` | 局部问题，值得小修 |
| `ending_overreach` | 结尾拔高、上价值、超出边界 | `patch_once` | 通常只需改结尾段 |
| `marketing_overfire` | 某几句营销腔过重 | `patch_once` | 局部降火即可 |
| `orality_weak_local` | 一两段书面腔明显 | `patch_once` | 局部口播化 |
| `beat_underplayed` | 某个 beat 提到了但不够清楚 | `patch_once` | 不需要整稿重来 |
| `pace_flat_local` | 中段某一段拖 | `patch_once` | 局部节奏修补 |
| `orality_weak_global` | 整篇像讲义、整体都不像口播 | `regen_once` | 局部修补救不回来 |
| `pace_flat_global` | 全篇节奏平、开中尾都弱 | `regen_once` | 整稿写法偏了 |
| `voice_mismatch_global` | 整体不符合 persona / family 气质 | `regen_once` | 全稿腔调错位 |
| `topic_mismatch` | 写出来的核心根本不是当前 `selected_angle` | `regen_once` | 不是局部 bug，是整稿偏题 |
| `scope_drift` | 全稿明显超出或缩窄既定范围 | `regen_once` 或 `return_topic` | 先看是执行偏差还是 topic 本身装不下 |
| `quote_misuse_minor` | 原文锚句轻微意译偏差，但可修 | `patch_once` | 局部修正 |
| `quote_misuse_major` | 原文关键意思被写反 | `regen_once` | 已影响全稿可信度 |

### `return_topic` 触发规则

只有这些情况可以 `return_topic`：

- `scope` 明显装不下 `must_include_beats`
- `selected_angle` 与 `must_include_beats` 天然冲突
- `forbidden_expansions` 与 `selected_angle` 冲突
- `source anchors` 与当前 topic 讲法冲突
- 事件识别本身错误，script 才暴露出来

这些情况不能 `return_topic`：

- 开头弱
- 口播别扭
- 节奏平
- 结尾拔高
- 营销腔过重

这些都应优先在 script 阶段内部 patch / regenerate 解决。

### 进攻性标签

在不新增第二个审校器的前提下，单一语义审校允许补充以下进攻性标签：

- `hook_kill_power_weak`
- `suspense_density_low`
- `peak_missing`
- `ending_residue_weak`

这些标签的作用不是触发 hard fail，而是触发**有边界的提升型修补**。

也就是说：

- 它们不单独构成 `hard_fail`
- 但它们不能只是“记录一下就算了”
- 它们应优先导向 `patch_once(intent=lift)`

补充阈值：

- `patch_once`
  - 没有 topic 合同冲突
  - 没有全局问题标签
  - `patch_targets` 不超过 `3` 个区域
- `regen_once`
  - 出现任意 `1` 个全局问题标签
  - 或局部问题标签数量 `>= 3`
  - 或 `patch_targets` 已覆盖 `opening + middle + ending`
- `return_topic`
  - 只在 topic 合同自身矛盾时触发
  - 不能因为“开头弱、节奏平、口播别扭、营销腔过重”触发

建议补充的全局问题标签：

- `biography_flat_global`
- `decision_weak_global`
- `pressure_weak_global`
- `abstraction_heavy_global`
- `stakes_blurry_global`
- `name_stack_heavy`

## 10. patch / regenerate 策略

### patch

适用：

- 开头弱
- 结尾过火
- 某一处营销腔太重
- 某个 beat 的落点不够清楚

特点：

- 只修局部
- 最多一次

当前建议在实现上把 patch intent 进一步拆为：

- `intent=fix`
- `intent=lift`

其中：

- `fix` 用于修 bug、修局部违约、修表达问题
- `lift` 用于提升开头抓力、中段悬念、高潮兑现或结尾余味

`intent=lift` 的边界：

- 一次只允许作用于一个区域：
  - `opening`
  - `middle`
  - `ending`
- 一次只解决一个核心问题：
  - `hook`
  - `suspense`
  - `peak`
  - `ending_residue`
- 改动范围不应超过正文总长度的 `25%`
- 不允许修改：
  - `must_include_beats`
  - `forbidden_expansions`
  - `narrative_tension_map`
  - `scope`

### regenerate

适用：

- 整篇口播气口明显不对
- 整体像讲义
- 整体不符合 family 或 persona

特点：

- 整稿重生
- 最多一次

### return_topic

适用：

- topic 自身存在矛盾
- scope 装不下
- selected_angle 与 `must_include_beats` 打架

特点：

- script 阶段不自行修 topic
- 必须退回 topic 阶段

## 11. family 第二稿策略

原则：

- 默认单稿
- 只有少数 family 允许“默认预备第二稿”
- 即使允许，也不是一定生成两稿，而是第一稿明显整体偏了时才补第二稿

| `event_family` | 默认策略 | 是否允许默认第二稿 | 原因 |
|---|---|---|---|
| `外交压场型` | 单稿优先 | 否 | 结构通常清晰，问题多为开头或某轮反击不够强 |
| `战场翻盘型` | 单稿优先 | 否 | 问题常在铺垫和节奏，不必默认多稿 |
| `刺杀政变型` | 单稿优先 | 否 | 场面强，通常 patch 即可 |
| `朝堂博弈型` | 单稿优先 | 条件性允许 | 只有当第一稿明显写成名词堆砌时才补第二稿 |
| `继承夺位型` | 单稿优先 | 否 | 主要风险是人物关系乱，不是多稿问题 |
| `变法治术型` | 谨慎单稿 | 是 | 很容易写成制度课，第一稿常需要整体重写 |
| `乱局崩盘型` | 单稿优先 | 否 | 多数问题是压力链没拉住，不需默认多稿 |
| `人物命运型` | 谨慎单稿 | 是 | 最容易写成流水账、鸡汤或平铺人生简介 |

补充说明：

- `朝堂博弈型` 不是默认双稿，只在“整篇写糊了”时允许第二稿
- 允许默认第二稿的核心 family 只有：
  - `变法治术型`
  - `人物命运型`

进一步触发阈值：

- `人物命运型`
  - 命中以下标签任意 `2` 个时，允许第二稿：
    - `biography_flat_global`
    - `decision_weak_global`
    - `pressure_weak_global`
    - `orality_weak_global`
  - 或命中 `topic_mismatch`，但不构成 `return_topic`
- `变法治术型`
  - 命中以下标签任意 `2` 个时，允许第二稿：
    - `abstraction_heavy_global`
    - `stakes_blurry_global`
    - `orality_weak_global`
    - `opening_weak`
- `朝堂博弈型`
  - 不默认开放第二稿
  - 仅在同时命中 `name_stack_heavy + core_conflict_blurry`
  - 或命中 `orality_weak_global` 时条件性允许

## 12. script 阶段禁止事项

- 不重新引入大纲模板
- 不在本地再做一层语义推理 gate
- 不默认多稿并行
- 不无限 patch / regen
- 不因轻微时长偏差重写全文
- 不从 Candidate Cache、Event Registry prose、旧 brief 中拼接大 prompt

## 13. 当前待补充

`TBD`

- `warning / errors / decision` 的本地校验返回格式落地
- 口播自然度与营销腔的具体样本判定基线
- `core_conflict_blurry / stakes_blurry_global / name_stack_heavy` 的实现级判定方法
