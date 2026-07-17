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

根据当前推荐种子、事件记忆与已确认边界，生成 8 个完整、可比较的结构化 `TopicCandidateCard` 候选。

## 输入对象

- `RecommendationSeedSet`
- `EventRegistryContext`
- `recent_event_memory`

## 输出合同

- 首轮输出的第一优先级，是先完整满足 `TopicCandidateCard` 最小字段合同；多样性与时代分布建立在先完整交付字段之后。
- 必须直接输出 `TopicCandidateCard[]`，不得包 `TopicCandidateCard` 外层对象，不写解释或长篇文案。
- 先输出 8 个候选，作为原始候选池。唯一合法输出骨架：

```json
[
  {
    "event_identity": "事件标识",
    "title": "候选标题",
    "one_line_angle": "一句话切口",
    "family_label": "题材家族标签",
    "scope_label": "时代或朝代",
    "estimated_duration_band": "medium",
    "why_this_now": "当下值得讲的原因",
    "core_conflict": "人物、对抗力量与赌注",
    "strong_scene": "可视化核心场景",
    "must_cover_preview": [
      "进入局面的叙事节点",
      "关键动作的叙事节点",
      "压力或代价的叙事节点"
    ],
    "risk_hints": ["历史争议点或传播风险"],
    "source_hint": "信源提示",
    "recent_usage_hint": "近期使用情况",
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

## 字段质量

- 每个候选都必须给出 `event_identity`，必须使用中文、稳定、简短、偏史学命名的事件级短语；非必要不带年份。不得把包装文案、角度句式或脚本化表达写进 `event_identity`。
- 若候选与 `recent_event_memory` 中为同一事件，应复用已有 `event_identity`，不得重新发明新 key。
- `core_conflict` 必须写具体人物、对抗力量与明确赌注；`strong_scene` 必须写谁在哪里做什么、面临什么压力，不能写成抽象趋势。
- `estimated_duration_band` 只能是 `short`、`medium`、`long`；`scope_label` 必须是时代/朝代名，不是事件类型或泛主题标签。
- `risk_hints` 至少 1 条；无显式风险时填 `["暂无显式风险提醒"]`。`source_hint` 优先写具体信源，来源不明时填 `"基于历史共识推定"`。`recent_usage_hint` 必须如实反映近期记忆，无记录时填 `"近期未使用"`。
- `viral_rubric` 只有五个正式字段：`hook_power`、`novelty_gap`、`emotion_gap`、`share_impulse`、`visual_promise`，值只能是 `low`、`medium`、`high`；`viral_rubric` 不得自定义额外评分键，不得改名、使用数字或混入其他元数据。

## 三段叙事节点

- `must_cover_preview` 必须给出 3 条可交给脚本审计的叙事节点，分别覆盖进入局面、关键动作、压力/代价。
- `one_line_angle` 必须被三条 `must_cover_preview` 共同支撑；不得为了锋利感新增 preview 无法兑现的压力点。
- 三条 preview 不得只是同一句角度摘要的改写，不得把同一句角度摘要改写三遍。
- `must_cover_preview` 三条顺序必须稳定：第一条必须是具体开场压力；第二条必须是压力转折或高潮兑现；第三条必须是故事内余震。
- 第一条必须包含人物、逼迫动作、即将失去的东西；第二条不得只写准备、训练、铺垫或泛泛强场面，必须落到关键行动或局面翻转；第三条不得写成脱离故事的现代金句。
- `must_cover_preview` 是叙事节点，不是正文句；优先写成场景、动作或转折短语，不写解释性评价或完整总结句；名句可以作为节点锚点，但不要附带完整解释。

## 简洁表达预算

以下长度是生成偏好，不是硬性校验；为准确表达历史关系可以合理超出，不得因为追求短而删掉人物、动作、因果或结果：

- `event_identity`：4–16 个汉字；`title`：18–32 个汉字；`one_line_angle`：24–48 个汉字。
- `why_this_now`：20–40 个汉字；`core_conflict`：35–65 个汉字；`strong_scene`：35–65 个汉字。
- `must_cover_preview` 固定 3 条，每条 22–42 个汉字；`risk_hints` 1–2 条，每条 15–35 个汉字。
- `source_hint`：8–24 个汉字；`recent_usage_hint`：6–18 个汉字。
- `family_label`、`scope_label` 只写简短标签；`viral_rubric` 只写正式枚举，不增加解释。

## 开放发现差异化要求

- 若 `RecommendationSeedSet` 已经明确锚定具体单事件，原始 8 候选必须全部围绕同一 `event_identity` 展开，只允许切换角度、冲突焦点或场面入口，不得改写成相邻事件、同人物其他阶段、制度时期标签或结果阶段标签。
- 宽边界 seed 优先拉开事件多样性，分散到不同人物、事件链或冲突场景；同一事件若保留多个候选，角度也必须明显不同。
- 不要继续让这些近期高频事件占据原始 8 候选的大多数槽位；对宽边界 seed，主动拉开朝代分布、冲突类型与叙事结构。
- 候选必须落在具体历史事件，不得使用朝代阶段、战争类型、思想流派或人物群像级别的泛主题。

## 供应商安全表达边界

- 必须保留具体人物、对抗力量、关键动作、明确赌注和故事余震，不得把高张力事件写成抽象主题或无动作概括。
- 使用中性的历史叙事策划语言，不展开具体血腥、尸体、酷刑、肢体伤害细节或猎奇化处决画面；通过决策、压力、场景和后果保持张力。
- 不得因为安全表达而删掉关键行动主体、因果关系或历史后果。
- 当输入包含 `safety_retry_context.mode=strict_neutral_historical_planning` 时，进一步压缩物理伤害描写，只保留理解事件所必需的行动、压力与后果。

## 时代边界要求

- 必须严格服从推荐种子给定的时代范围，时代范围是硬边界，候选不得超出该时段。
- `先秦至两汉` 不得返回三国及以后候选；`魏晋至唐宋` 不得返回先秦、两汉、元明清候选；`元明清` 不得返回更早时期候选。
- 生成前先判断时代归属；归属不明或明显跨段时，丢弃并换候选。

## 硬约束

- 必须服从当前 `family_label`、`scope_label`、风险边界与近期记忆约束。
- 不偷渡 `TopicPackage` 才拥有的字段，不发明新阶段对象或评分体系，不输出英文正文或说明。

## 输出前自检

- `title`、`one_line_angle`、`family_label`、`scope_label` 与全部正式字段是否完整。
- `core_conflict` 是否包含具体人物、对抗与赌注；`strong_scene` 是否可视觉化；三条 preview 是否形成开场压力、关键转折、故事余震。
- 核对同一候选内的事件身份、行为主体、关键动作、因果和结果是否互相支持。
- 不得混淆决策者、执行者、受害者和最终受益者。
- 历史细节没有把握时使用准确的中性表达，不得为了标题张力发明确定性动作。
- `estimated_duration_band`、`why_this_now`、`risk_hints`、`source_hint`、`recent_usage_hint` 是否完整；`viral_rubric` 五个字段名和值域是否正确。
