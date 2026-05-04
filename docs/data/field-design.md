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
- storyboard / asset manifest 字段
- 审校输出对象字段的落盘形式
