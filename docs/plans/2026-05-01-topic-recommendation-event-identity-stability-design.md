# 2026-05-01 Topic Recommendation Event Identity Stability Design

## 1. 背景

`event_identity` 已经作为正式字段接入了 `topic` 推荐链路：

- builder 输出 `event_identity`
- 本地层只按显式 `event_identity` 做精确去重、fatigue 和 round history
- selector 接收 `recent_event_memory`

这解决了“本地伪语义归一”这个方向错误的问题，但没有完全解决“连续多轮重复度”。

最近一次真实 5 轮回归已经说明，当前主问题变成了：

- `event_identity` 作为显式字段存在，但跨轮不够稳定
- 同一事件会被 builder 换成不同 key
- 本地 exact match 没有错，但命中的前提不成立

典型漂移样本已经在真实回归中出现：

- `Battle_of_Hastings` vs `Battle_of_Hastings_1066`
- `Magna_Carta_signing` vs `Magna_Carta_1215`
- `Black_Death_outbreak` vs `Black_Death_1347` vs `Black_Death_arrival`
- `Crusades_Jerusalem_1099` vs `Fourth_Crusade` vs `Siege_of_Constantinople_1204`

因此，当前链路的问题已经从“本地层做错了事”收束为：

> builder 没有稳定地产出可复用的事件级 identity。

## 2. 问题定义

当前 `event_identity` 的失败方式不是字段缺失，而是字段漂移：

1. 同一事件在不同轮次被命名成不同字符串
2. 字符串里混入年份、场景切口、阶段状态或英语命名风格漂移
3. selector 虽然能基于 `recent_event_memory` 做语义避让，但本地 fatigue 与 round history 仍只认 exact identity

这导致链路出现一种“职责上正确、结果上仍不稳”的状态：

- 本地层已经遵守规则，不再猜语义
- 但 builder 输出的 identity 还不够像“稳定主键”

## 3. 这次不该怎么做

以下方向仍然明确禁止：

- 回到本地字符串裁剪、关键词、黑名单、标题截断
- 新增第三个本地 semantic normalizer
- 用 year-strip、prefix-strip、冒号前主干提取等方式补 identity
- 让 selector 输出后再由本地层猜“其实是同一事件”

这些做法都属于重新引入本地伪语义判断，不可接受。

## 4. 正式目标

本次 follow-up 设计只解决一件事：

> 提高 builder 产出 `event_identity` 的稳定性，让本地 exact match 真正具备可用前提。

成功后的链路应满足：

- 同一事件在连续多轮下尽量复用同一个 `event_identity`
- builder 即使重新讲述同一事件，也应优先沿用近期记忆里的既有 identity
- selector 和本地 fatigue 不需要新增任何伪语义逻辑
- trace 能直接回答“这个 identity 是 builder 新发明的，还是复用了近期记忆”

## 5. 根因分析

从当前真实日志看，identity 漂移主要来自两类问题。

### 5.1 identity 格式没有被收紧

现在 `event_identity` 只是“必须有”，但没有足够明确地约束：

- 应该优先使用什么语言
- 应该是史学事件名，还是临时代码名
- 什么时候允许带年份
- 什么时候不允许带阶段或结果描述

于是模型会自由发挥出：

- 英文驼峰
- 英文 snake_case
- 带年份后缀
- 带阶段状态词
- 带局部场景切口

这天然不稳定。

### 5.2 builder 还没有拿到“近期 identity 记忆”

当前只有 selector 接收 `recent_event_memory`。

这意味着：

- selector 能在最终选择时尽量避让近期事件
- 但 builder 在开放发现时，并不知道最近几轮已经用了哪些 identity
- 所以即便它再次产出“本质同一事件”，也没有机制去复用既有 identity

结果就是：

- selector 可能避免了一部分重复
- 但本地 fatigue 依赖的 exact identity 仍会被 builder 新 key 绕过

## 6. 正式方案

正式方案保持 `builder 候选池 + selector 最终选择` 两阶段不变，只强化 builder 合同。

### 6.1 把 `event_identity` 从“有这个字段”提升为“稳定命名合同”

builder prompt 需要明确以下规则：

1. `event_identity` 必须使用中文
2. `event_identity` 必须是简短、稳定、偏史学命名的事件级名词短语
3. 不得使用临时代码风格命名
4. 不得把叙事 angle、修辞包装、情绪词写进 `event_identity`
5. 非必要不带年份
6. 只有在不带年份会和另一常见事件混淆时，才允许加入年份或明确限定语

推荐示例：

- `黑斯廷斯战役`
- `《大宪章》签署`
- `黑死病欧洲大流行`
- `第四次十字军东征攻陷君士坦丁堡`
- `君士坦丁堡陷落（1453）`

不推荐示例：

- `Battle_of_Hastings`
- `Battle_of_Hastings_1066`
- `Magna_Carta_1215`
- `Black_Death_arrival`
- `十字军的疯狂与圣城陷落`

### 6.2 把 `recent_event_memory` 同时送给 builder

这是本次方案最关键的新增点。

builder 不只看 seed，还要看最近 2-3 轮已入选事件：

- `event_identity`
- `title`
- `one_line_angle`

builder 新职责不是“最终避让”，而是：

1. 若打算再次产出本质同一事件，应优先复用 `recent_event_memory` 中已有的 `event_identity`
2. 若只是同一事件换讲法，不得重新发明一个新 identity
3. 若近期已经明显高频，优先扩展到别的事件，而不是继续堆同事件不同包装

这一步仍属于 LLM 语义判断，符合仓库规则。

### 6.3 selector 继续使用 `recent_event_memory`

selector 方案不需要推翻，只要继续承担它原本该承担的事：

- 在最终 3 选中时做语义避让
- 在 builder 已尽量稳定 identity 的前提下，进一步避免近期回流

也就是说：

- builder 负责“发现候选时尽量稳定命名”
- selector 负责“最终选择时尽量避让近期重复”

## 7. 关键设计判断

### 7.1 为什么不用第三个 identity-normalizer prompt

不建议新增独立第三阶段。

原因：

- 会破坏当前已冻结的两阶段主结构
- 会新增新的职责边界和日志复杂度
- builder 本来就必须理解“自己推荐的是哪个事件”，identity 应该是 builder 输出的一部分，而不是事后再补

### 7.2 为什么建议 `event_identity` 改成中文稳定短语

不是因为中文天然更聪明，而是因为：

- 正式 prompt 全部是中文
- 当前使用模型在中文语境下更容易稳定输出中文史学名词短语
- 现有漂移大多正发生在英文 code-style identity 上
- 本地层只做 exact match，不依赖 identity 语言

所以这一步的目标不是“换语言”，而是“换成更适合稳定复用的表示法”。

### 7.3 为什么 builder 也要看 recent memory

因为只让 selector 看 recent memory，修复不了 identity 漂移本身。

真正需要解决的是：

- 同一事件再次出现时，builder 不要重新发明 key

这件事只能在 builder 侧完成。

## 8. 数据与职责调整

### 8.1 builder 输入扩展

新增：

- `recent_event_memory`

字段结构沿用 selector 现有 memory：

- `event_identity`
- `title`
- `one_line_angle`

### 8.2 builder 输出不新增字段，只强化 `event_identity` 语义

保持现有 `TopicCandidateCard` 结构不变，不再继续加字段。

本次重点不是扩 schema，而是强化 `event_identity` 的命名合同。

### 8.3 本地层保持“只认显式 identity”

本地层不新增任何近似匹配。

仍然只做：

- exact `event_identity` 去重
- exact `event_identity` fatigue
- exact `event_identity` round history

## 9. 可观测性要求

落地后，trace 应能直接回答：

1. builder 收到了哪些 `recent_event_memory`
2. builder 输出的每个候选使用了什么 `event_identity`
3. 某个高频事件再次出现时，它是否复用了既有 identity
4. selector 是否继续避让这些 recent identity

也就是说，下一轮真实回归的观察重点不再只是“重复少没少”，还要看：

- identity 是否稳定
- 稳定性改善来自 builder 合同，而不是本地魔法

## 10. 成功标准

如果方案有效，真实 5 轮回归至少应出现以下变化：

1. 同一事件的 `event_identity` 漂移显著减少
2. `Battle_of_Hastings / Magna_Carta / Black_Death` 这类对象不再每轮换 key
3. fatigue 命中更多依赖 exact identity 复用，而不是 selector 单独兜底
4. 不需要恢复任何本地标题启发式

## 11. 结论

当前问题已经不再是“有没有 event_identity”，而是“event_identity 能不能被 builder 稳定复用”。

因此，下一步的正式方向应该是：

- 不回到本地伪语义
- 不新增第三阶段
- 只在 builder 合同和 builder 输入上下文上做增强

即：

> 用 builder 的近期记忆感知和更严格的 identity 命名合同，提升 `event_identity` 稳定性；再让现有 selector 和本地 exact 链路发挥作用。
