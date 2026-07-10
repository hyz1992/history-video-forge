# Recent Memory 设计

本文档定义 `Recent Memory` 是什么，以及它和 `Event Registry`、`Candidate Cache` 的关系。

## 1. 定位

`Recent Memory` 是推荐排序用的近期行为记忆层。

它回答的问题是：
- 最近做过哪些事件
- 最近展示过哪些候选
- 最近哪些人物/事件簇已经过热
- 当前是否需要对明星题、同簇题、同人题做降权

它不是：
- 事件身份账本
- 候选缓存库
- 正式业务对象

## 2. 与其它对象的区别

### 与 `Event Registry` 的区别

`Event Registry` 负责：
- 这是谁
- 它有哪些别名
- 它属于哪个 cluster / family

`Recent Memory` 负责：
- 最近是否做过它
- 最近是否做过同簇事件
- 最近是否频繁用到同一个人物

### 与 `Recommendation Candidate Cache` 的区别

`Candidate Cache` 负责：
- 之前生成过哪些高质量 candidate
- 它们是否还值得复用

`Recent Memory` 负责：
- 即使 candidate 很好，最近是不是已经刷得太多

## 3. 推荐的最小内容

第一版建议至少能回答这几类信息：

### A. 最近已确认事件
- 最近选中过的 `event_id`
- 最近选中过的 `event_cluster`
- 最近选中过的核心人物

### B. 最近已展示候选
- 最近向用户展示过的 candidate 指纹
- 最近被用户明确拒绝或忽略的 candidate 指纹

### C. 近期频率统计
- 某人物在最近 N 条任务中出现次数
- 某簇在最近 N 条任务中出现次数
- 头部事件最近是否过热

## 4. 当前推荐的数据来源

第一版不建议把 `Recent Memory` 单独做成新的主业务表。

更推荐：
- 以 `projects + topic_packages + candidate exposure log` 为 source-of-truth
- `Recent Memory` 作为派生读模型或缓存视图

## 5. 更新时机

### 在 topic 阶段
- 候选展示给用户后，记录 candidate exposure
- 用户确认 `Topic Package` 后，更新最近选中事件记忆

### 在 script 阶段
- 一般不更新 `Recent Memory`
- script 失败或 patch 不应改变推荐记忆

## 6. 消费方

当前主要由这些环节消费：
- 推荐入口排序器
- 事件库排序或“近期做过”提示
- candidate 展示层的 `recent_usage_hint`

## 7. 当前仍为 TBD 的点

当前运行时已将推荐轮次写入 `DbClient.recommendationRounds`，并随 JSON snapshot v2 持久化；它是当前 restart memory 的实现来源。`WeakMap` 不再作为正式来源。fingerprint 统一使用规范化 `event_identity + one_line_angle`。

- candidate exposure log 是否单独落库
- `N` 的默认窗口大小
- reject / ignore 的衰减规则
- 是否需要单独做物化表提升查询性能
