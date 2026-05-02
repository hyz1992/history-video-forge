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
    "family_label": "题材家族标签",
    "scope_label": "事件范围标签",
    "why_this_now": "当下值得讲的原因",
    "must_cover_preview": [
      "必须覆盖点1",
      "必须覆盖点2"
    ],
    "viral_rubric": {
      "novelty": 4,
      "conflict": 5,
      "emotion": 4,
      "discussion": 4,
      "visual": 4
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
- 每个候选都必须带 `viral_rubric`
- `viral_rubric` 只能使用正式字段：`hook_power`、`novelty_gap`、`emotion_gap`、`share_impulse`、`visual_promise`
- `viral_rubric` 不得自定义额外评分键，不得改名，不得混入其他元数据

## 开放发现差异化要求

- 候选之间必须明显区分，不能只是在同一事件上换措辞
- 优先拉开事件多样性，尽量分散到不同人物、不同事件链或不同冲突场景
- 同一事件如果保留多个候选，角度也必须明显不同，不能只是细微改写
- 若近期记忆里某个事件已经高频出现，优先扩展到其他事件，而不是只换包装重复推荐同一事件
- 不要继续让这些近期高频事件占据原始 8 候选的大多数槽位；只有在当前 seed 边界下确实缺少同等级替代事件时，才允许少量保留
- 对宽边界 seed，优先主动拉开朝代分布、冲突类型与叙事结构，而不是围绕同一批高频事件反复换包装
- 不能收敛成清一色名人话题，避免把开放发现压扁成单一知名人物清单
- 候选标题必须落在具体历史事件，不能停留在朝代阶段、战争类型、思想流派或人物群像级别的泛主题
- 不得使用“王朝更迭”“古代战争”“百家争鸣”“名臣故事”这类抽象题桶充当候选标题
- 优先返回“具体事件 + 明确冲突切口”的组合，而不是只有大类标签或空泛概括

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
- 不能偷渡 `TopicPackage` 才拥有的硬合同字段
- 不能擅自发明新的阶段对象或评分体系

## 禁止事项

- 不把候选直接写成脚本
- 不重写上游事件识别结论
- 不把包装语言当成正式叙事合同
- 不输出英文正文或英文说明
