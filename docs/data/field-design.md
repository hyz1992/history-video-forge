# 字段设计

本文档记录当前已经确认的核心中间对象字段，并说明：

- 该对象存在的意义
- 字段的用途
- 哪个阶段负责生成
- 哪个阶段负责消费

原则：

- 只收录当前已确认对象
- 不把临时展示字段和正式执行字段混在一起
- 不把 prompt prose 当成字段

## 1. Event Registry

定位：

- 本地事件身份账本
- 不是推荐题库
- 不是浏览事件库
- 不是最终选题对象

作用：

- 给历史事件分配稳定 `event_id`
- 支持去重、疲劳惩罚、命名归一化、混淆约束
- 作为推荐阶段和自定义输入阶段的本地记忆层

### 生命周期

- `provisional`：系统刚识别到的新事件，尚未稳定
- `confirmed`：已被选中过，或已被多次稳定复用
- `curated`：人工整理和校正过的高质量事件记录

### 最小字段说明

| 字段 | 含义 | 备注 |
|---|---|---|
| `event_id` | 事件唯一身份键 | 一经创建不再变化 |
| `canonical_title` | 规范事件标题 | 统一展示名 |
| `aliases` | 别名集合 | 用于归一化匹配 |
| `era` | 时代 | 如春秋、战国、唐 |
| `dynasty` | 朝代 | 与 `era` 可并存 |
| `core_people` | 核心人物 | 用于人物疲劳与展示 |
| `event_cluster` | 事件簇 | 用于簇级惩罚 |
| `event_family` | 主家族归类 | topic 阶段使用 |
| `disambiguation_notes` | 消歧说明 | 防止相似事件混淆 |
| `confusion_pairs` | 常混淆事件 | 高风险匹配时参考 |
| `status` | 生命周期状态 | `provisional / confirmed / curated` |
| `selection_count` | 被用户选中次数 | 用于记忆层 |
| `last_seen_at` | 最近被看到时间 | 用于推荐冷却 |
| `last_selected_at` | 最近被选中时间 | 用于推荐冷却 |
| `fame_band` | 热门度档位 | `head / mid / tail` |
| `source_anchor_refs` | 主要史料来源名 | 轻量来源锚点 |
| `canonical_quotes` | 核心短原文锚句 | 最多 0-3 句 |
| `common_failure_modes` | 常见误写点/漏桥段 | 用于提醒与审校 |

## 2. Topic Candidate Card

定位：

- 用户在主题阶段真正选择的对象
- 是选题展示对象，不是 script 阶段执行对象

生成时机：

- 由 `Topic Candidate Builder` 在 topic 阶段生成

消费方：

- 主题页列表
- 主题页详情抽屉
- 用户确认动作

### 列表态字段说明

| 字段 | 含义 | 为什么要有 |
|---|---|---|
| `title` | 当前候选的标题 | 用户快速识别 |
| `one_line_angle` | 一句话讲法 | 区分同事件不同 candidate |
| `family_label` | 主家族 | 帮助理解讲法类型 |
| `scope_label` | 范围档位 | 说明是微切口还是完整事件 |
| `estimated_duration_band` | 预计时长区间 | 提供体感预期 |
| `why_this_now` | 当前推荐理由 | 说明为什么值得选 |

### 抽屉态补充字段说明

| 字段 | 含义 | 为什么放在抽屉里 |
|---|---|---|
| `core_conflict` | 这条视频真正讲的冲突 | 列表中不宜过重 |
| `strong_scene` | 最抓人的场面 | 帮助用户想象成片潜力 |
| `must_cover_preview` | 必讲节点预览 | 让用户知道不会只讲空壳标题 |
| `risk_hints` | 该候选的主要风险 | 提示用户不要误选 |
| `source_hint` | 主要来源提示 | 提供史料感知 |
| `recent_usage_hint` | 与近期选题关系 | 提醒是否过近重复 |

## 3. Topic Package

定位：

- script 阶段唯一正式上游输入源
- 是 topic 阶段的正式终点对象
- 是 script 阶段的硬边界输入，不是用户直接编辑对象

### 设计原则

- 只定义“讲什么”和“不能怎么讲”
- 不提前写大纲，不提前做分镜
- 不把 narrative 细节膨胀成重型合同

### 最小字段说明

| 字段 | 含义 | 备注 |
|---|---|---|
| `topic_package_id` | package 唯一 id | 用于项目内落盘 |
| `source_mode` | 候选来源 | `recommended / library / custom` |
| `event_id` | 对应事件身份 | 连接 Event Registry |
| `canonical_title` | 规范标题 | 供下游展示与记录 |
| `selected_angle` | 本次确定的一句话讲法 | script 核心切口 |
| `family_label` | 主家族 | 供风格偏置和 candidate 语义参考 |
| `scope_label` | 范围档位 | 微切口 / 标准 / 完整事件 |
| `core_conflict` | 核心冲突 | script 必须围绕它写 |
| `stakes` | 为什么这件事不能轻描淡写 | script 的 stakes 边界 |
| `must_include_beats` | 必讲节点 | 只写节点，不写展开方式 |
| `forbidden_expansions` | 禁止越界项 | 防止乱拔高/乱发挥 |
| `risk_hints` | 风险提示 | 供 script 和审校参考 |
| `source_anchor_refs` | 主要来源名 | 史料来源锚点 |
| `canonical_quotes` | 短原文锚句 | 只做锚点，不做大段原文输入 |
| `ambiguity_notes` | 版本/归属歧义说明 | 防止误写 |
| `duration_band` | 合理时长区间 | 后验范围检查参考 |
| `voice_hint` | 建议声线 | 轻量偏置，不是强模板 |
| `strong_scene` | 最抓人的场面 | 给开头与分镜提供高价值锚 |
| `packaging_seed` | 包装抓点一句话 | 服务标题/封面/开头包装 |

## 4. Project Style Pack

定位：

- 项目/账号级固定风格对象

作用：

- 保持账号辨识度
- 避免每条视频风格完全漂移

| 字段 | 含义 |
|---|---|
| `style_pack_id` | 风格包 id |
| `brand_label` | 账号/栏目标识 |
| `visual_system` | 主视觉系统 |
| `narrator_persona` | 旁白人格基底 |
| `wording_register` | 文案基础腔调 |
| `subtitle_profile` | 字幕系统 |
| `cover_profile` | 封面系统 |
| `title_profile` | 标题基线 |
| `pacing_baseline` | 整体节奏基线 |
| `risk_posture` | 包装风险姿态 |

## 5. Family Bias Pack

定位：

- family 级软偏置包
- 只做“默认倾向”，不做全文模板

| 字段 | 含义 |
|---|---|
| `family_label` | 对应家族 |
| `narrative_emphasis` | 叙事重心顺序 |
| `opening_pressure_bias` | 开头压迫感偏置 |
| `exposition_budget` | 背景铺垫预算 |
| `pacing_bias` | 节奏偏置 |
| `voice_bias` | 口播偏置 |
| `visual_emphasis` | 视觉重点 |
| `packaging_bias` | 包装抓点偏置 |
| `anti_patterns` | 本家族常见错误写法 |

## 6. Topic Delivery Pack

定位：

- 单题交付微调对象
- 由规则化 Delivery Planner 生成

| 字段 | 含义 | 边界 |
|---|---|---|
| `opening_move` | 开头动作类型 | 不能改 topic 范围 |
| `opening_pressure_level` | 开头压迫强度 | 只能微调，不决定内容 |
| `voice_tilt` | 口播微偏置 | 不得反向覆盖 narrator persona |
| `pacing_tilt` | 节奏微偏置 | 不得反向覆盖 duration_band |
| `ending_tilt` | 结尾收束偏向 | 不得强迫正文结构 |
| `visual_tilt` | 画面侧重点 | 主要服务后续视觉层 |
| `packaging_hook` | 包装抓点一句话 | 不得变成正文硬约束 |
| `caution_notes` | 本题交付注意事项 | 只做提醒，不做硬边界 |

## 7. Script Input Bundle

定位：

- script 阶段唯一正式输入包
- 作用是把 topic、风格、微调统一收束成可消费结构

### Hard Lane

定义：

- script 阶段必须服从的硬边界

字段：

- `event_id`
- `canonical_title`
- `selected_angle`
- `family_label`
- `scope_label`
- `core_conflict`
- `stakes`
- `must_include_beats`
- `forbidden_expansions`
- `source_anchor_refs`
- `canonical_quotes`
- `ambiguity_notes`

### Soft Lane

定义：

- 可以影响风格与交付，但不得重定义 topic 的软偏置

- `narrator_persona`
- `wording_register`
- `pacing_baseline`
- `voice_tilt`
- `pacing_tilt`
- `opening_move`
- `opening_pressure_level`
- `ending_tilt`
- `strong_scene`
- `visual_tilt`

### Packaging Lane

定义：

- 主要服务标题、封面、开头包装；正文只能弱参考

- `packaging_hook`
- `title_profile`
- `cover_profile`
- `risk_posture`

## 8. Script Draft Package

定位：

- script 正文生成阶段的正式输出包

| 字段 | 含义 |
|---|---|
| `script_text` | 口播正文 |
| `estimated_duration_sec` | 预计口播时长 |
| `beat_trace` | 各必讲节点在正文中的命中片段 |
| `quote_trace` | 锚句使用追踪 |
| `opening_span` | 开头片段 |
| `ending_span` | 结尾片段 |

## 9. 当前待补充

`TBD`

- cache object 字段细化
- storyboard / asset manifest 字段
- 审校输出对象字段的落盘形式
