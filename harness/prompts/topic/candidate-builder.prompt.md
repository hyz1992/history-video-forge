---
id: topic.candidate-builder
stage: topic
language: zh-CN
consumes:
  - RecommendationSeedSet
  - EventRegistryContext
  - recent_event_memory
produces:
  - TopicCandidateCard[]
status: active
---

# 任务

根据当前推荐种子、事件记忆与已确认边界，生成一组结构化 `TopicCandidateCard`。

## 输入对象

- `RecommendationSeedSet`
- `EventRegistryContext`
- `recent_event_memory`

## 输出对象

- 首轮输出的第一优先级，是先完整满足 `TopicCandidateCard` 最小字段合同
- 多样性、分布、recent memory 与时代边界等要求，都建立在先完整交付字段之后
- 参考以下唯一合法输出骨架组织输出；必须直接输出 `TopicCandidateCard[]`，不得包 `TopicCandidateCard` 外层对象
- 该骨架只用于约束字段形状；具体内容必须结合当前 seed、recent_event_memory 与候选事件重新生成
- 输出 `TopicCandidateCard[]`
- 先输出 8 个候选，作为原始候选池
- 必须直接输出候选数组，不得包 `TopicCandidateCard` 外层对象
- 唯一合法输出骨架：

```json
[
  {
    "event_identity": "事件标识",
    "title": "候选标题",
    "one_line_angle": "一句话切口",
    "family_label": "题材家族标签（如宫变夺权、战争博弈、文人政治）",
    "scope_label": "时代/朝代（如唐朝、宋朝、三国、汉朝）",
    "estimated_duration_band": "短/中/长篇估算（如 short、medium、long）",
    "why_this_now": "当下值得讲的原因",
    "core_conflict": "核心戏剧冲突（一句话概括人物+对抗力量+赌注）",
    "strong_scene": "最具视觉冲击力的核心场景描写（具体画面，不是抽象概括）",
    "must_cover_preview": [
      "进入局面的叙事节点",
      "关键动作的叙事节点",
      "压力或代价的叙事节点"
    ],
    "risk_hints": [
      "历史争议点或传播风险提醒"
    ],
    "source_hint": "信源提示（如史记、资治通鉴等）",
    "recent_usage_hint": "近期使用情况提示（如该事件在过去生成中是否被高频使用）",
    "viral_rubric": {
      "hook_power": "medium",
      "novelty_gap": "medium",
      "emotion_gap": "medium",
      "share_impulse": "medium",
      "visual_promise": "medium"
    }
  }
]
```

- 每个候选都必须给出 `event_identity`
- `event_identity` 只用于标识“这是哪个事件”，不能把包装文案、角度句式或脚本化表达写进这个字段
- `event_identity` 必须使用中文
- `event_identity` 必须使用稳定、简短、偏史学命名的事件级短语，而不是临时代码名
- `event_identity` 非必要不带年份；只有在不带年份会与另一常见事件混淆时，才允许加入年份或必要限定语
- 不得把包装文案、角度句式或脚本化表达写进 `event_identity`
- 若候选与 `recent_event_memory` 中为同一事件，应复用已有 `event_identity`，不得重新发明新 key
- 每个候选都必须完整给出最小字段
- `core_conflict` 必须写具体人物+对抗力量+明确赌注，不能写成朝代级历史意义或抽象主题概括
- `strong_scene` 必须是一个可视觉化的具体画面（谁在哪里做什么、面临什么压迫），不能写成"某事件体现了某趋势"这类抽象评价
- `estimated_duration_band` 必须是 `short`、`medium`、`long` 之一，根据事件天然可讲述的体量估算
- `risk_hints` 必须给出至少 1 条具体风险，优先写历史争议点、现代敏感性或传播注意事项；若无显式风险，填 `["暂无显式风险提醒"]`
- `source_hint` 优先写具体信源（如史记·项羽本纪），事件来源不明时填 `"基于历史共识推定"`
- `recent_usage_hint` 描述该事件在近期推荐中的使用密度；若 `recent_event_memory` 中有该事件，如实反映；若无记录，填 `"近期未使用"`
- `must_cover_preview` 必须给出 3 条可交给脚本审计的叙事节点，分别覆盖进入局面、关键动作、压力/代价。
- `one_line_angle` 必须被三条 `must_cover_preview` 共同支撑；不得为了锋利感新增 preview 无法兑现的压力点。
- 三条 preview 不得只是同一句角度摘要的改写，不得把同一句角度摘要改写三遍，必须形成从开场压力、关键动作/翻盘到代价/余震的闭环。
- `must_cover_preview` 三条顺序必须稳定：第一条必须是具体开场压力；第二条必须是压力转折或高潮兑现；第三条必须是故事内余震。
- 第一条必须包含人物、逼迫动作、即将失去的东西，优先写成具体羞辱、危险、失控、选择或反常识画面，不写“他该怎么办”这类泛问题。
- 第二条不得只写准备、训练、铺垫或泛泛强场面，必须落到观众真正等待的动作、反击、刺杀、摊牌、名句打回去、决策裂缝或局面翻转。
- 第三条必须从故事内部产生余震，可写命运反讽、权力代价、人物性格裂缝、后续历史后果或名场面回扣；不得写成脱离故事的现代金句。
- `must_cover_preview` 是叙事节点，不是正文句；优先写成场景、动作或转折短语，不写解释性评价或完整总结句；名句可以作为节点锚点，但不要附带完整解释。
- 每个候选都必须带 `viral_rubric`
- `viral_rubric` 只有五个正式字段：`hook_power`、`novelty_gap`、`emotion_gap`、`share_impulse`、`visual_promise`，值必须为 `low`、`medium`、`high` 之一
- `viral_rubric` 不得自定义额外评分键，不得改名，不得混入其他元数据
- `viral_rubric` 不得使用 `novelty`、`conflict`、`emotion`、`discussion`、`visual` 等废弃字段名
- `viral_rubric` 不得使用数字（如 4、5）代替 `low`/`medium`/`high`

## 开放发现差异化要求

- 若 `RecommendationSeedSet` 已经明确锚定具体单事件，原始 8 候选必须全部围绕同一 `event_identity` 展开，只允许切换角度、冲突焦点、场面入口或叙述利益，不得改写成相邻事件、同人物其他阶段、制度时期标签或结果阶段标签
- 候选之间必须明显区分，不能只是在同一事件上换措辞
- 仅在宽边界 seed 下，优先拉开事件多样性，尽量分散到不同人物、不同事件链或不同冲突场景
- 同一事件如果保留多个候选，角度也必须明显不同，不能只是细微改写
- 若近期记忆里某个事件已经高频出现，优先扩展到其他事件，而不是只换包装重复推荐同一事件
- 不要继续让这些近期高频事件占据原始 8 候选的大多数槽位；只有在当前 seed 边界下确实缺少同等级替代事件时，才允许少量保留
- 对宽边界 seed，优先主动拉开朝代分布、冲突类型与叙事结构，而不是围绕同一批高频事件反复换包装
- 不能收敛成清一色名人话题，避免把开放发现压扁成单一知名人物清单
- 候选标题必须落在具体历史事件，不能停留在朝代阶段、战争类型、思想流派或人物群像级别的泛主题
- 不得使用“王朝更迭”“古代战争”“百家争鸣”“名臣故事”这类抽象题桶充当候选标题
- 优先返回“具体事件 + 明确冲突切口”的组合，而不是只有大类标签或空泛概括

## 供应商安全表达边界

- 必须保留具体人物、对抗力量、关键动作、明确赌注和故事余震，不得把高张力事件写成抽象主题或无动作概括。
- 使用中性的历史叙事策划语言，不展开具体血腥、尸体、酷刑、肢体伤害细节或猎奇化处决画面；通过决策、压力、场景和后果保持张力。
- 不得因为安全表达而删掉关键行动主体、因果关系或历史后果。
- 当输入包含 `safety_retry_context.mode=strict_neutral_historical_planning` 时，进一步压缩物理伤害描写，只保留理解事件所必需的行动、压力与后果。

## 时代边界要求

- 必须严格服从推荐种子给定的时代范围，时代范围不是软提示，而是硬边界
- 候选事件不得超出该时段；如果事件发生年代超出当前范围，即使题材精彩也必须排除
- 如果推荐种子指定 `先秦至两汉`，不得返回三国、魏晋、隋唐、宋元、明清相关候选
- 如果推荐种子指定 `魏晋至唐宋`，不得返回先秦、两汉、元明清相关候选
- 如果推荐种子指定 `元明清`，不得返回先秦、两汉、魏晋、隋唐、宋元相关候选
- 生成前先判断候选事件的时代归属；时代归属不明确或明显跨段时，直接丢弃并换候选

## 硬约束

- 只输出结构化候选，不写长篇文案
- 必须服从当前 `family_label`、`scope_label`、风险边界与近期记忆约束
- `scope_label` 必须是时代/朝代名（如唐朝、宋朝、汉朝、明朝），不是事件类型或主题范畴标签
- 不能偷渡 `TopicPackage` 才拥有的硬合同字段
- 不能擅自发明新的阶段对象或评分体系

## 禁止事项

- 不把候选直接写成脚本
- 不重写上游事件识别结论
- 不把包装语言当成正式叙事合同
- 不输出英文正文或英文说明

## 输出前自检

- `title`、`one_line_angle`、`family_label`、`scope_label` 是否都已完整给出
- `core_conflict` 是否已给出具体人物+对抗+赌注，而非抽象概括
- `strong_scene` 是否已给出可视觉化的具体画面
- `estimated_duration_band` 是否已给出
- `why_this_now` 是否已给出
- `risk_hints` 是否已给出至少一条
- `source_hint` 是否已给出
- `recent_usage_hint` 是否已给出
- `viral_rubric` 五个子字段是否完整，字段名是否正确（hook_power/novelty_gap/emotion_gap/share_impulse/visual_promise），值是否为 low/medium/high
