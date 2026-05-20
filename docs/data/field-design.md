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

### `viral_rubric`

定位：

- 这是 `Topic Candidate Card` 的内部创意势能描述
- 它不是用户要编辑的对象
- 它也不是黑箱总分

作用：

- 帮助推荐阶段从“能讲”进一步走到“更有爆款潜力”
- 给轻评审和 candidate 排序一个统一的进攻性参考

最小字段建议：

| 字段 | 含义 | 备注 |
|---|---|---|
| `hook_power` | 首屏停留力是否足够 | 第一优先维度 |
| `novelty_gap` | 是否存在反常识张力 | 第二优先维度 |
| `emotion_gap` | 是否存在强情绪缺口 | 辅助维度 |
| `share_impulse` | 是否容易引发评论/转发欲 | 第三优先维度 |
| `visual_promise` | 是否承诺强场面、强器物、强动作 | 第四优先维度 |

设计边界：

- 不做单一总分
- 不直接定义 hard fail
- 主要用于 candidate 排序、淘汰和轻评审

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
| `narrative_tension_map` | 叙事张力图 | 轻量描述这条内容的张力递进 |
| `duration_band` | 合理时长区间 | 后验范围检查参考 |
| `voice_hint` | 建议声线 | 轻量偏置，不是强模板 |
| `strong_scene` | 最抓人的场面 | 给开头与分镜提供高价值锚 |
| `packaging_seed` | 包装抓点一句话 | 服务标题/封面/开头包装 |

### `narrative_tension_map`

定位：

- 它属于 `Topic Package`
- 它描述的是这条内容的叙事张力骨架，而不是交付微调

作用：

- 把“topic 边界”与“script 递进”连接起来
- 避免 script 在 beats 都齐的情况下仍然写得平

最小字段建议：

| 字段 | 含义 |
|---|---|
| `hook_claim` | 开头最核心的 promise 是什么 |
| `pressure_escalation` | 中段压力如何升级 |
| `mid_reveal` | 中段关键信息揭示或翻面 |
| `peak_payoff` | 观众真正等的高潮兑现点 |
| `ending_residue` | 结尾想留下的余味 |

设计边界：

- 不是新大纲
- 不是段落模板
- 不是分镜合同
- 每个字段只允许短句

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
| `hook_claim` | 包装层抓点命题 | 与 `narrative_tension_map.hook_claim` 同源，但表达更包装化 |
| `hook_emotion` | 包装层激发的核心情绪 | 例如好奇、不信、压迫、震惊 |
| `reveal_position` | 包装 promise 在正文中的大致兑现位置 | `early / mid / late` |
| `caution_notes` | 本题交付注意事项 | 只做提醒，不做硬边界 |

补充说明：

- `Topic Package.narrative_tension_map.hook_claim` 定义的是叙事 promise
- `Topic Delivery Pack.hook_claim` 定义的是包装表达
- 二者必须同源，不能说两件不同的事

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

承接关系：

- `Script Input Bundle.hard_lane` 负责把 `Topic Package` 中的 `core_conflict / stakes / must_include_beats / forbidden_expansions / source_anchor_refs / canonical_quotes / ambiguity_notes` 原样送进 script 运行时，不再让 script 自己猜测故事硬边界或史料硬锚点。

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

- `hook_claim`
- `hook_emotion`
- `reveal_position`
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

## 9. ScriptValidationResult

定位：

- script 阶段统一的校验/裁判结果对象
- 第一版建议做成判别联合，而不是单一扁平对象

作用：

- 统一本地硬校验与单一语义审校的返回格式
- 避免 API、持久化、runtime 各自发明结果对象

### 变体 A：本地硬校验

| 字段 | 含义 |
|---|---|
| `stage` | 固定为 `script_local_validation` |
| `decision` | `pass / regen_once / hard_fail` |
| `errors` | 结构性错误列表 |
| `warnings` | 警告列表，不直接阻断流程 |
| `metrics` | 轻量统计，如时长偏差、beat 覆盖情况 |

### 变体 B：单一语义审校

| 字段 | 含义 |
|---|---|
| `stage` | 固定为 `script_semantic_review` |
| `decision` | `pass / patch_once / regen_once / return_topic` |
| `patch_intent` | `fix / lift / null` |
| `hard_issues` | 硬问题标签列表 |
| `soft_issues` | 软问题标签列表 |
| `patch_targets` | 最多 3 个定点修补目标 |
| `summary` | 一句总评 |
| `confidence` | 0-1 置信度 |

补充说明：

- `patch_intent=lift` 只表示“提升势能”，不允许改 `must_include_beats / forbidden_expansions / narrative_tension_map / scope`
- `return_topic` 只用于 topic 合同自身冲突，不能拿来替代“稿子一般”

## 10. Task 2 共享 Schema 最小落地

本节回答一个实现前问题：

- 当前已确认的对象很多，但第一阶段真正要落成 shared schema 的最小集合到底是什么

当前推荐第一版 shared schema 只明确落以下 4 个对象：

### A. `TopicCandidateCard`

建议至少包含：

- `candidate_id`
- `event_id`
- `title`
- `one_line_angle`
- `family_label`
- `scope_label`
- `estimated_duration_band`
- `why_this_now`
- `core_conflict`
- `strong_scene`
- `must_cover_preview`
- `risk_hints`
- `source_hint`
- `recent_usage_hint`
- `viral_rubric`

其中：

- `viral_rubric` 第一版只允许 `low / medium / high`
- 不在 shared schema 中提前引入复杂数值打分

### B. `TopicPackage`

建议至少包含：

- `topic_package_id`
- `source_mode`
- `event_id`
- `canonical_title`
- `selected_angle`
- `family_label`
- `scope_label`
- `core_conflict`
- `stakes`
- `must_include_beats`
- `forbidden_expansions`
- `risk_hints`
- `source_anchor_refs`
- `canonical_quotes`
- `ambiguity_notes`
- `duration_band`
- `voice_hint`
- `strong_scene`
- `packaging_seed`
- `narrative_tension_map`

### C. `TopicDeliveryPack`

第一版建议纳入 shared schema，而不是只停留在 prose 规则：

- `opening_move`
- `opening_pressure_level`
- `voice_tilt`
- `pacing_tilt`
- `ending_tilt`
- `visual_tilt`
- `hook_claim`
- `hook_emotion`
- `reveal_position`
- `caution_notes`

说明：

- `hook_claim` 与 `TopicPackage.narrative_tension_map.hook_claim` 同源
- 但表达更偏包装，不要求逐字相同

### D. `ScriptValidationResult`

shared schema 层应实现为判别联合，而不是扁平对象：

- `script_local_validation` 变体
- `script_semantic_review` 变体

这样后续：

- API 返回
- 持久化 JSON
- runtime 事件

都可以共用同一套结果合同。

## 11. 最小 JSON 示例

本节只给“第一阶段最小可实现形态”的对象示例。

注意：

- 这些示例的目标是减少字段理解偏差
- 它们不是最终 API 完整返回
- 也不是数据库持久化后的完整快照

### A. `TopicCandidateCard`

```json
{
  "candidate_id": "cand_evt_yan_zi_shi_chu_reversal",
  "event_id": "evt_yan_zi_shi_chu",
  "title": "晏子使楚",
  "one_line_angle": "楚王连压三次，晏子一次没退",
  "family_label": "外交压场型",
  "scope_label": "完整事件",
  "estimated_duration_band": {
    "min_sec": 75,
    "max_sec": 95
  },
  "why_this_now": "强反转、强对抗、近期未做同簇题材",
  "core_conflict": "楚王在公开场合连续压场，晏子必须当场顶回去",
  "strong_scene": "楚王设局压人，晏子一句话当场翻盘",
  "must_cover_preview": [
    "狗门羞辱",
    "齐国无人",
    "橘生淮南淮北"
  ],
  "risk_hints": [
    "不要只讲狗门",
    "不要写成成语串烧"
  ],
  "source_hint": "主要史料：晏子春秋",
  "recent_usage_hint": "近期未出现同 event_id",
  "viral_rubric": {
    "hook_power": "high",
    "novelty_gap": "medium",
    "emotion_gap": "high",
    "share_impulse": "high",
    "visual_promise": "high"
  }
}
```

### B. `TopicPackage`

```json
{
  "topic_package_id": "tpk_20260417_yanzi_full",
  "source_mode": "recommended",
  "event_id": "evt_yan_zi_shi_chu",
  "canonical_title": "晏子使楚",
  "selected_angle": "楚王连压三次，晏子一次没退",
  "family_label": "外交压场型",
  "scope_label": "完整事件",
  "core_conflict": "楚王借公开场合连续羞辱晏子与齐国，晏子必须当场顶回去",
  "stakes": "一旦退让，就不只是个人丢脸，而是齐国在场面上被压一头",
  "must_include_beats": [
    "狗门羞辱",
    "齐国无人",
    "晏子以使臣规制反击",
    "楚国借盗贼羞辱齐人",
    "晏子以橘枳之喻反顶"
  ],
  "forbidden_expansions": [
    "不要拔高为改变历史格局",
    "不要追加无史料依据的群臣反应"
  ],
  "risk_hints": [
    "不要写成课堂讲义",
    "不要把三轮攻防压成一句总结"
  ],
  "source_anchor_refs": [
    "《晏子春秋》"
  ],
  "canonical_quotes": [
    "使狗国者，从狗门入",
    "橘生淮南则为橘，生于淮北则为枳"
  ],
  "ambiguity_notes": "",
  "duration_band": {
    "min_sec": 75,
    "max_sec": 95
  },
  "voice_hint": "强旁白解说",
  "strong_scene": "楚王连续压场，晏子当场一句句顶回去",
  "packaging_seed": "楚王连压三次，晏子一次没退",
  "narrative_tension_map": {
    "hook_claim": "楚王不是只压了晏子一次，而是连压三次",
    "pressure_escalation": "从羞辱身形，升级到羞辱齐国，再升级到羞辱齐人风气",
    "mid_reveal": "晏子不是在逞口舌，而是在守住齐国场面",
    "peak_payoff": "橘枳之喻把楚王的第三次压场原样顶回",
    "ending_residue": "这种场面，一退就不只是退掉自己"
  }
}
```

### C. `TopicDeliveryPack`

```json
{
  "opening_move": "question",
  "opening_pressure_level": "high",
  "voice_tilt": "sharper",
  "pacing_tilt": "neutral",
  "ending_tilt": "judgment",
  "visual_tilt": [
    "faces",
    "courtroom"
  ],
  "hook_claim": "如果有人当着所有人的面羞辱你，你敢不敢当场顶回去？",
  "hook_emotion": "压迫",
  "reveal_position": "mid",
  "caution_notes": [
    "不要把 hook 写成课堂导入",
    "不要让包装 promise 偏离 narrative_tension_map.hook_claim"
  ]
}
```

### D. `ScriptValidationResult`

本地硬校验示例：

```json
{
  "stage": "script_local_validation",
  "decision": "pass",
  "errors": [],
  "warnings": [
    "duration_slightly_out_of_band"
  ],
  "metrics": {
    "estimated_duration_sec": 88,
    "duration_band_min_sec": 75,
    "duration_band_max_sec": 95,
    "beat_coverage_count": 5,
    "beat_expected_count": 5
  }
}
```

单一语义审校示例：

```json
{
  "stage": "script_semantic_review",
  "decision": "patch_once",
  "patch_intent": "lift",
  "hard_issues": [],
  "soft_issues": [
    "hook_kill_power_weak",
    "ending_residue_weak"
  ],
  "patch_targets": [
    {
      "zone": "opening",
      "issue": "hook_kill_power_weak",
      "instruction": "在不改变 selected_angle 的前提下增强第一屏 promise",
      "max_scope": "1段"
    }
  ],
  "summary": "结构合格，但开头抓力不足，建议做一次 lift 型 patch。",
  "confidence": 0.78
}
```

## 12. 当前待补充

`TBD`

- cache object 字段细化
- compose timeline 字段

## Storyboard v1 字段（2026-05-10 已实现）

`StoryboardPlan` 是 storyboard 阶段的正式输出对象，定位为“视觉叙事计划”，不是素材计划、镜头资产清单或 compose timeline。

### `StoryboardPlan`

| 字段 | 含义 |
|---|---|
| `plan_version` | 固定为 `storyboard_v1` |
| `source_script_record_id` | 来源 active script record |
| `source_topic_package_id` | 来源 topic package |
| `estimated_total_duration_sec` | 分镜计划对应的总时长 hint |
| `segments` | 分镜段落数组 |
| `global_visual_notes` | 全局视觉注意事项，第一版只做轻量 notes |

### `StoryboardSegment`

| 字段 | 含义 |
|---|---|
| `segment_id` | 分镜段唯一标识 |
| `order` | 段落顺序，从 0 开始 |
| `script_excerpt` | 来自 `script_text` 的连续原文片段 |
| `start_hint_sec` / `end_hint_sec` | 对口播时长的粗略时间 hint |
| `narrative_role` | `opening/setup/pressure/turn/peak/ending/bridge` |
| `visual_intent` | 本段希望观众看见的视觉意图 |
| `scene_description` | 场面描述 |
| `visual_elements` | 主要可视元素 |
| `framing_hint` | `wide/medium/close/detail/symbolic` |
| `content_type` | `live_action/text_card/map/illustration` |
| `motion_hint` | `static/push_in/pull_back/pan` |
| `editing_hint` | `single/cutaway/montage` |
| `on_screen_text` | 屏幕文字建议 |
| `linked_beats` | 对应 script beat trace |
| `linked_quotes` | 对应 script quote trace |
| `risk_notes` | 结构性风险提示 |

### `StoryboardValidationResult`

| 字段 | 含义 |
|---|---|
| `stage` | 固定为 `storyboard_local_validation` |
| `decision` | `pass / regen_once / hard_fail` |
| `errors` | 结构错误码 |
| `warnings` | 非阻断警告 |
| `metrics` | 覆盖率、段落数、时长 hint 等结构指标 |

边界：
- 本地 validator 只判断结构，不判断“爆款感”或视觉审美。
- `StoryboardPlan` 不包含资产生成参数，不替代 asset planning。
- `StoryboardPlan` 不回写 topic/script。

## Asset Planning v1 字段（2026-05-11 已实现）

`AssetPlan` 是 asset planning 阶段的正式输出对象。它描述后续素材生产任务合同，但不代表任何物理文件已经生成。

### `AssetPlan`

| 字段 | 含义 |
|---|---|
| `plan_version` | 固定为 `asset_plan_v1` |
| `source_storyboard_record_id` | 来源 active storyboard record |
| `source_script_record_id` | 来源 script record |
| `source_topic_package_id` | 来源 topic package |
| `art_bible` | 全局视觉一致性说明，类型为 `ProjectArtBible` |
| `global_audio_strategy` | 全局音频策略；当前可包含 `voice_intent`，用于 assets 阶段匹配全局音色 |
| `tts_plan` | 本地确定性 TTS 分块计划 |
| `tasks` | 素材生产任务列表，元素为 `AssetTask` |
| `dependencies` | 任务依赖关系 |
| `cost_summary` | 本地汇总的任务数量、成本档位和预估 provider 调用数 |
| `global_production_notes` | 全局生产注意事项 |

### `ProjectArtBible`

| 字段 | 含义 |
|---|---|
| `era_style` | 时代、服化道、空间质感等全局时代风格 |
| `visual_tone` | 全片视觉情绪与光色倾向 |
| `characters` | 角色一致性描述 |
| `locations` | 场景一致性描述 |
| `props` | 道具一致性描述 |
| `global_prompt_prefix` | 视觉任务可复用的全局 prompt 前缀 |
| `global_negative_prompts` | 全局负向提示词 |
| `consistency_notes` | 跨任务一致性约束 |

### `VoiceIntent`

`VoiceIntent` 是 asset planning 到 assets 的结构化音色意图，可放在 `AssetPlan.global_audio_strategy.voice_intent` 中。它只描述匹配目标，不代表供应商音色已经创建。

| 字段 | 含义 |
|---|---|
| `content_family` | 内容类型，例如 `historical_power`、`documentary`、`suspense` |
| `narrator_persona` | 旁白人格描述 |
| `desired_traits` | 期望音色特征列表 |
| `avoid_traits` | 需要避开的音色特征列表 |
| `gender_tone` | 性别/声线倾向，可为 `null` |
| `age_band` | 年龄段倾向，可为 `null` |
| `pitch` | 音高倾向，可为 `null` |
| `pace` | 语速倾向，可为 `null` |
| `energy` / `authority` / `suspense` / `warmth` | 0-1 区间的数值偏好，可为 `null` |
| `style_notes` | 补充风格说明 |

### `AssetTask`

| 字段 | 含义 |
|---|---|
| `task_id` | 全局任务 ID，由本地 merger 分配 |
| `order` | 任务排序，从 0 开始 |
| `task_type` | `tts_audio / image_still / video_clip / subtitle_track / sfx_cue / bgm_cue / render_motion_cue` |
| `source_segment_id` | 对应 storyboard segment；全片级任务可为 `null` |
| `source_excerpt` | 任务依据的 script excerpt |
| `production_intent` | 生产意图 |
| `recommended_mode` | `auto / manual_allowed / manual_preferred / placeholder_only` |
| `provider_hint` | 可选 provider 提示，不代表已调用 provider |
| `prompt_draft` | 视觉类任务的 prompt 草稿；TTS、字幕、音效、BGM、运镜 cue 可为 `null` |
| `parameters` | 结构化参数 |
| `manual_upload_policy` | 是否允许或要求人工上传替代素材 |
| `risk_notes` | 结构性风险提示 |
| `cost_tier` | `free / low / medium / high` |
| `initial_status` | `planned / blocked` |

### `AssetPlanningValidationResult`

| 字段 | 含义 |
|---|---|
| `stage` | 固定为 `asset_planning_local_validation` |
| `decision` | `pass / regen_once / hard_fail` |
| `errors` | 结构、引用、依赖或覆盖错误码 |
| `warnings` | 非阻断警告 |
| `metrics` | 任务数、依赖数、TTS 覆盖率等结构指标 |

### `VoiceProfile`

`VoiceProfile` 是 assets 阶段维护的全局共享音色档案，不属于单个视频任务私有数据。系统会 seed 预设音色与系统 fallback 音色；当 `VoiceIntent` 无法匹配到足够合适的已有音色时，可以只创建本地 `generated` 音色档案，供应商音色仍延后到 TTS 执行时懒创建。

| 字段 | 含义 |
|---|---|
| `voice_profile_id` | 本地全局音色 ID |
| `kind` | `preset / generated / system` |
| `name` / `description` | 便于检索和人工理解的音色名称与摘要 |
| `design_prompt` | 供应商声音设计提示词 |
| `preview_text` | 声音设计预览文本 |
| `provider_name` | 当前供应商，现阶段为 `dashscope` |
| `provider_voice_id` | 供应商真实音色 ID；未创建时为 `null` |
| `provider_status` | `missing / creating / ready / failed / deleted` |
| `target_model` | 供应商目标 TTS 模型 |
| `recommended_content_families` | 推荐匹配的内容类型 |
| `voice_traits` / `avoid_traits` | 匹配用的正向与反向特征 |
| `gender_tone` / `age_band` / `pitch` / `pace` | 匹配用的声线维度 |
| `energy` / `authority` / `suspense` / `warmth` | 0-1 区间的匹配维度 |
| `preview_audio_uri` | 供应商预览音频 URI，可为 `null` |
| `usage_count` / `last_used_at` / `quality_score` | 后续运营与排序字段 |
| `created_at` / `updated_at` | 创建与更新时间 |

持久化说明：

- 当前实现使用 `storage/voice-profiles/voice-profiles.json` 作为全局音色库 JSON backing store，文档版本为 `voice_profiles_v1`。
- `provider_voice_id`、`provider_status`、`preview_audio_uri`、`usage_count`、`last_used_at` 与 `updated_at` 会随 repository 写入持久化；`usage_count` 和 `last_used_at` 在 assets 成功选择/复用音色后回写。
- seed 只补齐缺失的预设/system 音色，不覆盖已有同 ID 档案；这保证已 ready 的供应商音色不会被预设默认值覆盖。
- `preview_audio_uri` 当前可保存声音设计返回的 data URI；若后续预览音频变大，应迁移到 media storage，只在 `VoiceProfile` 保留引用。
- 该文件不保存 API key 或原始 provider request/response；迁移、备份、清理 storage 时必须保留它，避免重复创建付费 provider voice。

### `VoiceMatchResult`

`VoiceMatchResult` 记录 assets 阶段选择本地音色的确定性结果。它用于解释为什么选中某个 `VoiceProfile`，不代表供应商调用结果。

| 字段 | 含义 |
|---|---|
| `selected_voice_profile_id` | 最终选中的本地音色 ID |
| `match_score` | 0-1 区间匹配分 |
| `match_decision` | `matched_existing / created_local_profile / fallback_system` |
| `match_reasons` | 可读匹配原因 |
| `rejected_profile_ids` | 未选中候选及原因 |

边界：

- `AssetPlan` 不包含真实文件路径、上传状态、生成结果 URL 或 compose timeline。
- local validator 不判断审美、爆款、历史相似度或 prompt 质量。
- `render_motion_cue` 是 compose 建议任务，不等于已实现 compose。

## Assets v1 字段（2026-05-18 已同步后端执行基础）

`AssetManifest` 是 assets 阶段的正式输出对象。它描述资产执行结果清单，包含任务执行状态、artifact 元数据、分镜 route 和音频摘要。当前 assets 后端已覆盖 manifest builder、本地 validator、fake/local provider 执行、本地文件存储、provider job 记录、manual artifact metadata registration / accept、media library 基础、执行期 TTS 分块规范化、音频时长探测与字幕 timing metadata，以及显式 DashScope TTS/文生图/image-to-video 路径；仍不包含真实 BGM/SFX provider、上传/预览 UI 或发布级素材运营流。

### `AssetManifest`

| 字段 | 含义 |
|---|---|
| `manifest_version` | 固定为 `asset_manifest_v1` |
| `source_asset_plan_id` | 来源 active asset plan record |
| `source_storyboard_record_id` | 来源 storyboard record |
| `source_script_record_id` | 来源 script record |
| `execution_options` | 执行选项，类型为 `AssetExecutionOptions` |
| `executions` | 任务执行记录列表，元素为 `AssetTaskExecution` |
| `artifacts` | 已生成的 artifact 列表，元素为 `AssetArtifact`（discriminated union） |
| `audio_summary` | 音频摘要，类型为 `AssetAudioSummary` |
| `segment_routes` | 分镜资产路由列表，元素为 `SegmentAssetRoute` |
| `readiness` | 整体就绪状态：`ready_for_compose / blocked / partial` |
| `notes` | 全局备注列表 |

### `AssetExecutionOptions`

| 字段 | 含义 |
|---|---|
| `execution_mode` | `auto_available / dry_run` |
| `voice_profile_id` | TTS 声线 ID，可为 `null` |
| `enabled_provider_types` | 启用的 provider 类型列表，元素为 `tts / image / video / sfx / bgm` |
| `allow_manual_placeholders` | 是否允许手动占位 |

### `AssetTaskExecution`

| 字段 | 含义 |
|---|---|
| `execution_id` | 执行唯一 ID |
| `task_id` | 对应 `AssetPlan` 中的 task_id |
| `task_type` | 与 `AssetTask.task_type` 相同枚举 |
| `status` | 执行状态：`planned / ready / running / waiting_manual_upload / waiting_manual_selection / completed / skipped_with_fallback / failed / accepted / rejected` |
| `origin` | artifact 来源：`provider / local / manual_upload / library / inline / external_url` |
| `started_at` | 开始时间 ISO 字符串，初始为 `null` |
| `completed_at` | 完成时间 ISO 字符串，初始为 `null` |
| `provider_id` | 实际调用 provider 的 ID，可为 `null` |
| `attempts` | 尝试次数，初始为 `0` |
| `output_artifact_ids` | 产出的 artifact ID 列表；首元素在 `accept` 后为选中 artifact |
| `notes` | 执行备注列表 |

### `AssetArtifact`（discriminated union on `artifact_type`）

基础字段（所有变体共享）：

| 字段 | 含义 |
|---|---|
| `artifact_id` | artifact 唯一 ID |
| `artifact_type` | 判别键，见下表 |
| `origin` | 来源类型 |
| `file_uri` | 文件 URI；占位 artifact 使用 `planned://` 或 `inline://` 前缀 |
| `created_at` | 创建时间 ISO 字符串 |
| `metadata` | 按类型不同的结构化元数据 |

`artifact_type` 变体与元数据字段：

| artifact_type | 元数据关键字段 |
|---|---|
| `tts_chunk_audio` | `duration_sec`、`estimated_duration_sec`、`duration_source`、`voice_profile_id`、`provider_voice_id`、`voice_profile_match_score`、`voice_profile_match_reasons`、`timing_source`、`duration_probe_error`、`sample_rate`、`format`、`tts_chunk_id`、`segment_ids`、`script_excerpt` |
| `tts_merged_audio` | `duration_sec`、`estimated_duration_sec`、`duration_source`、`voice_profile_id`、`provider_voice_id`、`voice_profile_match_score`、`voice_profile_match_reasons`、`timing_source`、`duration_probe_error`、`sample_rate`、`format`、`chunk_artifact_ids` |
| `subtitle_track` | `format`、`source_tts_artifact_id`、`source_tts_chunk_artifact_ids`、`caption_count`、`duration_sec`、`timing_source` |
| `image` | `width`、`height` |
| `video` | `duration_sec`、`width`、`height`、`fps`、`provider_name`、`provider_job_id`、`source_image_artifact_id`、`model`、`resolution` |
| `motion_recipe` | `recipe_type`、`source_image_artifact_id`、`parameters` |
| `sfx_audio` | `duration_sec` |
| `sfx_selection` | `library_item_id` 或 `selection_label`（至少一个） |
| `bgm_audio` | `duration_sec`、`loopable` |
| `bgm_selection` | `library_item_id` 或 `selection_label`（至少一个） |

### `SegmentAssetRoute`

| 字段 | 含义 |
|---|---|
| `segment_id` | 对应 storyboard segment ID |
| `tts_artifact_id` | 对应 TTS chunk artifact，可为 `null` |
| `subtitle_artifact_id` | 对应字幕 artifact，可为 `null` |
| `primary_visual_artifact_id` | 主视觉 artifact，可为 `null` |
| `visual_route_type` | `video_clip / image_with_motion / image_only / missing` |
| `motion_artifact_id` | 运动配方 artifact，可为 `null` |
| `fallback_visual_artifact_id` | 后备视觉 artifact，可为 `null` |
| `sfx_artifact_ids` | 音效 artifact ID 列表 |
| `bgm_placement_ids` | BGM placement ID 列表 |
| `readiness` | 段落就绪状态：`ready / blocked / fallback_ready` |
| `notes` | 段落备注列表 |

说明：

- DashScope image-to-video 成功时，`video` artifact 作为该 segment 的 `primary_visual_artifact_id`，`visual_route_type` 为 `video_clip`。
- 同 segment 的 source image 会保留为 `fallback_visual_artifact_id`；图生视频缺失或失败时，compose/renderer 仍可使用 image + `motion_recipe` fallback。
- DashScope image-to-video provider job 只属于 assets 阶段字段和 provider job 记录，不进入 compose 或 renderer 字段语义。
- TTS timing source 当前支持 `estimated / audio_probe / provider_timestamp / forced_alignment / mixed`，并兼容旧值 `provider / aligned`。DashScope TTS 在 mocked WAV 和真实 WAV/PCM 可探测时写入 `audio_probe`，不可探测格式保守回落为 `estimated`。
- 字幕 artifact 当前来自本地 subtitle provider，跟随 TTS chunk artifact 生成 chunk-level cues，并记录来源 TTS chunk ids、总时长和 timing source；多个来源不一致时写入 `mixed`。word-level provider timestamps 或 forced alignment 仍属于后续工作。

### `AssetAudioSummary`

| 字段 | 含义 |
|---|---|
| `voice_profile_id` | TTS 声线 ID |
| `tts_total_duration_sec` | TTS 总时长，可为 `null` |
| `tts_chunk_artifact_ids` | TTS 分块 artifact ID 列表 |
| `tts_chunk_routes` | TTS 分块路由列表，元素为 `TtsChunkRoute` |
| `tts_merged_artifact_id` | TTS 合并 artifact，可为 `null` |
| `subtitle_artifact_id` | 字幕 artifact，可为 `null` |
| `bgm_placements` | BGM placement 列表，元素为 `BgmPlacement` |
| `sfx_artifact_ids` | 音效 artifact ID 列表 |

### `BgmPlacement`

| 字段 | 含义 |
|---|---|
| `bgm_placement_id` | placement 唯一 ID |
| `scope` | `global / segment / segment_span` |
| `artifact_id` | BGM audio artifact，可为 `null` |
| `start_policy` | `timeline_start / segment_start` |
| `end_policy` | `timeline_end / segment_end / fade_out_after_span` |
| `segment_ids` | 关联的 segment ID 列表 |
| `volume` | 音量，0-1 范围，默认 `0.3` |
| `fade_in_sec` | 淡入时长（秒），默认 `0` |
| `fade_out_sec` | 淡出时长（秒），默认 `0` |

### `TtsChunkRoute`

| 字段 | 含义 |
|---|---|
| `tts_chunk_id` | TTS 分块 ID |
| `artifact_id` | 对应 artifact，可为 `null` |
| `segment_ids` | 关联的 segment ID 列表 |
| `script_excerpt` | 对应的口播原文片段 |

说明：

- assets run 会在执行期对 `tts_plan.chunks` 做本地确定性规范化，按句号/感叹号/问号/分号优先切分，超长无标点文本按字符窗口切分；该过程不修改持久化的 `AssetPlanRecord.planJson`。
- 子分块继承父 chunk 的 segment route；例如父 chunk 对应 `sb_001`，其 `chunk_1_part_1`、`chunk_1_part_2` 都继续路由到 `sb_001`。

### `AssetsValidationResult`

| 字段 | 含义 |
|---|---|
| `stage` | 固定为 `assets_local_validation` |
| `decision` | `ready_for_compose / blocked / partial` |
| `errors` | 结构错误码列表 |
| `warnings` | 非阻断警告列表 |
| `metrics` | 结构指标（task_count、execution_count、artifact_count、segment_route_count） |

边界：

- `AssetManifest` 不包含 compose timeline 或最终视频导出。
- local validator 不判断审美、爆款、语义质量或 provider 生成质量。
- 第一版 `buildInitialAssetManifest` 是纯确定性函数，不调用任何外部 provider。

## Compose v1 字段（2026-05-17 已实现后端 timeline 合同）

`ComposeTimeline` 是 compose 阶段的正式输出对象。它描述从 `AssetManifest` 派生出来的时间轴合同，供后续 renderer 消费。第一版只生成 timeline，不渲染视频。

### `ComposeTimeline`

| 字段 | 含义 |
|---|---|
| `timeline_version` | 固定为 `compose_timeline_v1` |
| `source_asset_manifest_record_id` | 来源 active asset manifest record |
| `source_asset_plan_record_id` | 来源 asset plan record |
| `source_storyboard_record_id` | 来源 storyboard record |
| `source_script_record_id` | 来源 script record |
| `output_profile` | 输出规格，第一版固定为 9:16、1080x1920、30fps |
| `duration_sec` | 时间轴总时长，优先来自 merged TTS artifact |
| `tracks` | 轨道列表，元素为 `ComposeTrack` |
| `segments` | segment 时间片列表，元素为 `ComposeTimelineSegment` |
| `readiness` | 整体就绪状态：`ready_for_render / partial / blocked` |
| `notes` | 全局备注列表 |

### `ComposeTrack`

| 字段 | 含义 |
|---|---|
| `track_id` | 轨道 ID |
| `track_type` | `visual / narration / subtitle / bgm / sfx` |
| `clips` | clip 列表，元素为 `ComposeClip` |

### `ComposeClip`

| 字段 | 含义 |
|---|---|
| `clip_id` | clip ID |
| `segment_id` | 关联 storyboard segment；全片 narration 可为 `null` |
| `artifact_id` | 引用的 asset artifact ID |
| `start_sec` | 起始时间，单位秒 |
| `duration_sec` | 持续时间，单位秒 |
| `clip_kind` | `video / image_with_motion / image_only / audio / subtitle` |
| `motion_artifact_id` | motion recipe artifact，可为 `null` |
| `notes` | clip 级备注 |

### `ComposeTimelineSegment`

| 字段 | 含义 |
|---|---|
| `segment_id` | storyboard segment ID |
| `start_sec` | segment 起始时间，单位秒 |
| `duration_sec` | segment 持续时间，单位秒 |
| `visual_clip_ids` | 对应 visual clip ID 列表 |
| `narration_clip_ids` | 对应 narration clip ID 列表 |
| `subtitle_clip_ids` | 对应 subtitle clip ID 列表 |
| `notes` | segment 级备注 |

### `ComposeValidationResult`

| 字段 | 含义 |
|---|---|
| `stage` | 固定为 `compose_local_validation` |
| `decision` | `ready_for_render / partial / blocked` |
| `errors` | 结构与引用错误码列表 |
| `warnings` | 非阻断警告列表 |
| `metrics` | 结构指标，如 track_count、clip_count、segment_count、duration_sec |

边界：

- `ComposeTimeline` 不包含最终 MP4、Remotion composition 或 provider job；若输入 `AssetManifest` 已有 `video` artifact，timeline 只保存对该 artifact 的引用。
- segment 时长优先消费 TTS chunk artifact 的 `duration_sec`；当多个 TTS chunks 指向同一 segment 时按总和累加，缺失 chunk 覆盖时才按 merged narration 总时长 fallback。
- compose local validator 不判断画面质量、声音质量、审美、爆款节奏或历史相似度。
- 缺失可选 BGM 只产生 warning，不阻断 `ready_for_render`。

## Renderer / Export v1 字段（2026-05-18 后端首批实现）

Renderer v1 字段只描述 `ComposeTimeline` 之后的渲染与导出结果，不改变上游 topic/script/storyboard/asset planning/assets/compose 字段语义。

### `ExportArtifact`

| 字段 | 含义 |
|---|---|
| `artifact_id` | 导出 artifact ID |
| `artifact_type` | 当前为 `mp4` |
| `uri` | 本地输出文件 URI 或路径引用 |
| `mime_type` | 当前为 `video/mp4` |
| `duration_sec` | 导出视频时长 |
| `width` | 导出宽度 |
| `height` | 导出高度 |
| `fps` | 导出帧率 |
| `file_size_bytes` | 输出文件大小 |
| `checksum` | 可选校验信息 |
| `metadata` | adapter、probe 或运行时补充信息 |

### `RenderValidationResult`

| 字段 | 含义 |
|---|---|
| `stage` | 固定为 `render_source_validation` |
| `decision` | `ready_for_render / blocked` |
| `errors` | 阻塞类结构、引用或文件错误 |
| `warnings` | 非阻塞告警，例如缺失可选 BGM/SFX |
| `metrics` | timeline、track、clip、artifact、duration 等结构指标 |

### `RenderJobRecord`

| 字段 | 含义 |
|---|---|
| `id` | render job record ID |
| `project_id` | 所属项目 |
| `compose_record_id` | source compose record |
| `output_artifact_json` | `ExportArtifact` |
| `validation_result_json` | `RenderValidationResult` |
| `execution_state_json` | render 状态、adapter、source 与 activation 信息 |
| `graph_trace_summary_json` | run trace summary |
| `runtime_diagnostics_json` | runtime diagnostics |
| `created_at` | 创建时间 |
| `updated_at` | 更新时间 |

边界：

- renderer 字段不表达素材审美、爆款评分、历史相似度或人工审稿结论。
- renderer 字段不表达 DashScope 图生视频 provider job。
- renderer 字段不替代 compose timeline；最终视频的时间轴 source 仍是 `ComposeTimeline`。
