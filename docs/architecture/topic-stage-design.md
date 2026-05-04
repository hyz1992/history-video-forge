# 主题阶段设计

## 1. 目标

主题阶段的目标不是让用户选一个标题，而是让系统与用户共同确认一个可执行的 `Topic Package`，供 script 阶段稳定消费。

## 2. 主题阶段闭环

```text
系统自动推荐 / 事件库 / 自定义输入
-> 事件识别或开放发现
-> Event Registry 归一化
-> Topic Candidate Builder
-> Topic Candidate Card
-> 用户确认
-> Topic Package
-> 回写记忆层/缓存
-> 进入 script 阶段
```

主题阶段完成的标志：

- 用户已确认一个 candidate
- `Topic Package` 已冻结并落盘
- Event Registry 和记忆层已回写
- 项目状态推进到 `script_ready`

## 3. 三入口定义

### A. 系统自动推荐

- 默认入口
- 不以本地事件库为候选来源
- 候选来源主要依赖开放发现
- 本地层只负责归一化、去重、疲劳惩罚和风险约束

#### 当前对“开放发现”的定义

当前已确认的第一版含义是：

- 由 LLM 基于历史知识空间进行开放式候选发现
- 结合用户偏好、`Recent Memory`、`Event Registry` 做归一化与筛除
- 不把 curated 事件库当作默认推荐的候选源

当前未确认项：

- 是否引入外部实时数据源
- 是否接入独立检索引擎

因此第一版明确采用：
- `LLM 开放发现 + 本地记忆约束`

而不是：
- `本地事件库排序换皮`

### B. 事件库

- 用户手动选择 event
- 事件库用于浏览，不直接产生 final topic
- 选中 event 后，系统仍需生成 candidate 供用户确认

### C. 自定义输入

- 用户输入事件名 / 成语 / 简介 / 描述
- 系统先做事件识别与归一化
- 再生成 candidate
- 不再暴露内部 draft 编辑

## 4. Event Registry

定位：

- 历史事件身份账本
- 不是推荐题库
- 不是人工浏览库

### 生命周期

- `provisional`
- `confirmed`
- `curated`

### 匹配规则

- `exact match`
- `high-confidence match`
- `ambiguous match`
- `no match`

自动系统允许：

- 复用已有 `event_id`
- 新建 `provisional`

自动系统禁止：

- 直接合并两个已有事件

## 5. 推荐审核链

主题推荐阶段不是“生成一个然后反复修”，而是：

```text
生成 12-20 个原始候选
-> 本地硬筛
-> 身份/重复筛
-> 单一轻评审
-> 产出 3-5 个 candidate
```

### 约束

- 候选展示不足 `3` 个时，只补位一次
- 不做无限自动重试
- 审核对象是结构化 candidate，不是长文案

## 6. Candidate Cache

定位：

- 推荐候选缓存层
- 不是知识库
- 不是浏览库

### 原则

- 高质量未选中 candidate 可以缓存
- 当前任务内优先复用
- 跨任务短期复用必须重评分
- 不直接写入事件库

## 7. event family

当前第一版采用 8 个主家族：

- `外交压场型`
- `战场翻盘型`
- `刺杀政变型`
- `朝堂博弈型`
- `继承夺位型`
- `变法治术型`
- `乱局崩盘型`
- `人物命运型`

### 低置信回退

- 主家族 + 副家族
- 通用安全槽位
- 只有事件身份不清楚时才要求用户澄清

## 8. Family Pack 原则

- 每个 family 固定 3 个候选槽位
- 槽位描述的是讲法重心，不是全文模板
- 候选差异控制在 builder 阶段完成

### family 扩展与回退原则

当前不建议一开始把 family 做成无限扩张的分类系统。

第一版规则：

1. 先使用当前 8 个主 family。
2. 如果命中不稳，允许：
   - 主 family + 副 family
   - 或通用安全槽位
3. 只有在同类题材持续无法被现有 family 自然覆盖时，才讨论新增 family。

新增 family 前至少要补三样东西：

- 该 family 解决什么老 family 无法稳定覆盖的问题
- 它的 3 个槽位是什么
- 它与相邻 family 的边界是什么

这条规则的目标是：
- 避免 family 太少导致题材别扭
- 也避免 family 无节制增长重新变成 prompt 黑箱

## 9. Topic Candidate Card

用户在主题阶段真正确认的对象是 `Topic Candidate Card`，而不是事件条目。

列表态字段：

- `title`
- `one_line_angle`
- `family_label`
- `scope_label`
- `estimated_duration_band`
- `why_this_now`

抽屉态补充：

- `core_conflict`
- `strong_scene`
- `must_cover_preview`
- `risk_hints`
- `source_hint`
- `recent_usage_hint`

### `viral_rubric`

为了让 topic 阶段不只会挑“能讲的题”，还会挑“更有势能的讲法”，当前建议给每个 candidate 增加一组轻量 `viral_rubric`。

它不是黑箱总分，也不是独立阶段，只是 topic candidate 的内部创意评估维度。

最小维度：

- `hook_power`
- `novelty_gap`
- `emotion_gap`
- `share_impulse`
- `visual_promise`

当前建议的最小使用规则：

1. 只有通过本地硬筛和身份/重复筛的 candidate，才进入 `viral_rubric` 排序。
2. `viral_rubric` 不决定“能不能讲”，只影响“优先推哪个”。
3. 推荐排序优先级建议为：
   - 第一优先：`hook_power`
   - 第二优先：`novelty_gap`
   - 第三优先：`share_impulse`
   - 第四优先：`visual_promise`
   - 第五优先：`emotion_gap`
4. 若满足以下任一情况，可直接从推荐候选中淘汰：
   - `hook_power` 与 `visual_promise` 同时低
   - 5 个维度中有 4 个及以上为低
   - `novelty_gap / emotion_gap / share_impulse` 全部低

这条规则的目标是：

- 不把 topic 阶段做成新的创意黑箱
- 但也不让 `viral_rubric` 退化成“写在文档里但排序不用”的装饰字段

## 10. Topic Package

`Topic Package` 是 script 阶段唯一正式输入源。

它只负责：

- 范围
- 冲突
- 必讲桥段
- 禁止扩写
- 事实锚点
- 叙事张力图
- 声线建议
- 包装种子

当前冻结给 script 的最小故事合同，至少要显式包含这些字段名：

- `core_conflict`
- `stakes`
- `must_include_beats`
- `forbidden_expansions`
- `source_anchor_refs`
- `canonical_quotes`
- `ambiguity_notes`

它不负责：

- 完整大纲
- 分镜
- 全文草稿
- 重型 prompt 指导

### `narrative_tension_map`

当前明确结论：

- `narrative_tension_map` 归属 `Topic Package`
- 它定义的是叙事张力骨架，而不是交付微调

最小字段：

- `hook_claim`
- `pressure_escalation`
- `mid_reveal`
- `peak_payoff`
- `ending_residue`

这层的作用是：

- 把 `core_conflict / stakes / must_include_beats` 连接成一条有张力的递进线
- 避免 script 虽然“讲对了”，却没有明确的中段翻面、高潮兑现和结尾余味

边界：

- 它不是新大纲
- 它不是分镜合同
- 它不是新的 narrative brief
- 每个字段只允许短句

### 与 Packaging Lane 的关系

`narrative_tension_map.hook_claim` 与后续 Packaging Lane 中的 `hook_claim` 必须同源。

区别在于：

- `Topic Package.narrative_tension_map.hook_claim`
  - 定义叙事 promise
- `Packaging Lane.hook_claim`
  - 定义包装表达

它们可以是不同表述，但不能承诺两件不同的事

## 11. 当前已确认风险与规避

### 风险

- 推荐回流到明星题
- family 不够覆盖，导致题材别扭
- candidate 同质化
- Event Registry 膨胀变脏
- 自定义输入重新变成 prompt 编辑器

### 已确认规避方向

- 4 层惩罚：
  - `event_id` 冷却
  - `event_cluster` 冷却
  - 人物疲劳惩罚
  - 热门惩罚
- `8` 个主 family + 低置信回退
- family 槽位化 candidate builder
- Event Registry 状态分层
- 自定义输入只做识别与确认，不做大字段编辑

## 12. 当前待补充

`TBD`

- `family_confidence` 具体计算方法
- Event Registry 具体匹配阈值
- Candidate Cache 细化字段与淘汰规则
