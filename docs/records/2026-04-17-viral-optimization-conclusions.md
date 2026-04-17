# 2026-04-17 “爆款化优化”讨论结论留档

## 文档定位

本文档不是正式规范本身，而是对当前“爆款化优化”讨论结论的阶段性留档。

它回答的是：

1. 为什么当前新流水线虽然更稳，但还不足以稳定产出“爆款潜力”内容
2. 外部批评里哪些判断成立，哪些只部分成立
3. 在不破坏现有稳定结构的前提下，最小可接受的优化方案是什么
4. 哪些改动明确不做，以避免重新回到旧项目那种重流程、重 prompt、重重试的失控状态

正式规范仍以这些文档为准：

- [主题阶段设计](../architecture/topic-stage-design.md)
- [Script 阶段设计](../architecture/script-stage-design.md)
- [Script 校验与决策实现规范](../architecture/script-validation-spec.md)
- [字段设计](../data/field-design.md)
- [流水线阶段输入输出规范](../architecture/pipeline-io-spec.md)

## 一、当前总判断

当前新项目方案已经明显强于旧项目的地方，在于它更强调：

- 上游边界清楚
- topic 和 script 责任分离
- prompt 负担收紧
- 单一主裁判
- 有限 patch / regenerate
- 避免多稿风暴和多头审校

这些设计对“稳定性”非常有帮助。

但是，当前方案主要擅长的是：

- 防止写错
- 防止漂移
- 防止越界
- 防止漏桥段
- 防止语气失控

而它还不够擅长的是：

- 让用户第一秒停下来
- 让中段持续有往下看的动力
- 让高潮明确兑现
- 让结尾留下余味、评论欲或转发欲

所以当前方案的最准确判断不是“没用”，而是：

**它已经很像一个稳定的质量控制系统，但还不够像一个稳定产出爆款潜力内容的创意系统。**

## 二、为什么说“当前系统还不够爆”

### 1. topic 阶段更会选“能讲的题”，不够会选“最有势能的讲法”

当前 topic 阶段已经能做：

- 候选发现
- 家族归类
- 推荐审核
- `Topic Candidate Card`
- `Topic Package`

它能解决：

- 这题是不是历史事件
- 这次讲哪个切口
- 这次讲多大范围
- 哪些桥段不能漏

但它还没有显式回答：

- 这个切口的首屏停留力够不够
- 这个切口有没有反常识张力
- 这个切口有没有强情绪缺口
- 这个切口有没有分享冲动
- 这个切口是否承诺了一个强视觉场面

这就导致 topic 阶段更像在选“正确题”，而不是选“最容易炸的题”。

### 2. `Topic Package` 目前有叙事边界，但缺少张力递进

当前 `Topic Package` 重点是：

- `core_conflict`
- `stakes`
- `must_include_beats`
- `forbidden_expansions`
- 史料锚点

这套设计能保证 script 阶段“讲对”。

但它还不能告诉 script：

- 开头 promise 要抛什么
- 中段压力怎么升级
- 中段关键翻面在哪里
- 高潮兑现点在哪里
- 结尾应该留下什么余味

也就是说：

**当前有叙事边界，但缺少轻量的叙事张力图。**

### 3. script 审校现在偏“防守型”

当前 script 审校更擅长拦截：

- 口播不自然
- beat 漏失
- 营销腔过火
- 结尾拔高
- 越界或偏题

但它还不够擅长主动判断：

- 钩子是否足够有杀伤力
- 中段悬念密度是否足够
- 是否存在清晰高潮
- 结尾是否留下余味

这意味着它更会说“别写坏”，还不够会说“怎么更炸”。

### 4. 包装层太薄

如果 Packaging Lane 只有一句 `packaging_hook`，它很难同时稳住：

- 标题
- 封面
- 开头前两句

这三个东西没有共享同一个轻量抓点结构时，最常见的问题就是：

- 标题很炸，但正文兑现不了
- 开头抓点和中段 promise 不是同一件事
- 结尾没有和包装形成闭环

## 三、外部批评里哪些判断成立

### 明确成立

以下判断当前已经成立，而且是值得吸收的：

1. 当前系统更强的是稳定，不是爆款势能
2. topic 阶段缺少“爆款潜力”的显式评估
3. script 阶段缺少轻量的情绪/张力弧线设计
4. 审校层偏防守型
5. packaging 结构太薄，标题/封面/开头之间联动不够强

### 只部分成立

以下批评只部分成立：

1. `family` 只是分类系统，不是创作引擎  
   这句话部分对。当前 family 已经不是硬模板，但它确实主要解决“别写歪”，还没有足够解决“如何更精彩”。

2. 默认单稿会压低爆款上限  
   这句话也部分对。但旧项目已经证明，多稿竞赛和多头 review 会迅速拖垮稳定性。所以正确答案不是回到多稿系统，而是在当前单稿链路里补“有边界的进攻性提升”。

### 不采纳的方向

以下方向本轮明确不采纳：

1. 新增一个完整“创意阶段”
2. 恢复 script 阶段 2-3 稿并行竞赛
3. 再加第二个审校器
4. 把 family 扩成一套刚性正文模板系统
5. 通过增加长 prose prompt 来补爆款能力

原因很清楚：

- 这些做法都会重新拉长流程
- 会重新加重 prompt
- 会重新出现前后打架
- 会重新把系统拖回旧项目那种重链路状态

## 四、本轮优化必须遵守的约束

“爆款化优化”必须遵守以下硬边界：

1. 不新增主阶段  
   主题阶段和 script 阶段之间不新增一个独立 creative stage。

2. 不新增主裁判  
   仍然只有一个语义主裁判。

3. 不恢复多稿系统  
   script 阶段仍然默认单稿，局部修补优先。

4. 不让进攻性标签变成新的 hard gate  
   这些标签只能作为“提升信号”，不能直接替代结构和合同约束。

5. 不让新增对象重新长成大纲  
   任何新增对象都必须是轻量短字段，而不是新的 OutlinePlan。

## 五、最小可接受的优化方案

当前推荐方案不是新建一层大系统，而是在现有链路里补 3 个最小结构，再做 2 个轻量升级。

### A. `Topic Candidate` 增加 `viral_rubric`

#### 作用

这层用来解决 topic 阶段“会挑正确题，但不够会挑高势能讲法”的问题。

#### 最小字段建议

- `hook_power`
- `novelty_gap`
- `emotion_gap`
- `share_impulse`
- `visual_promise`

#### 字段含义

- `hook_power`
  - 这个 candidate 的开头是否天然容易抓停留
- `novelty_gap`
  - 这个 candidate 是否有“你以为 / 其实”的反常识张力
- `emotion_gap`
  - 这个 candidate 是否有足够强的情绪缺口
- `share_impulse`
  - 这个 candidate 看完后是否容易让人想评论或转发
- `visual_promise`
  - 这个 candidate 是否天然承诺了一个强场面、强器物、强对峙或强动作

#### 设计边界

- 不做黑箱总分
- 不引入复杂打分系统
- 不直接暴露成一堆用户评分细项
- 只作为 topic candidate 构造与轻评审时的辅助判断

### B. `Topic Package` 增加 `narrative_tension_map`

#### 作用

这层用来补上“叙事边界”和“叙事张力递进”之间的空档。

#### 最小字段建议

- `hook_claim`
- `pressure_escalation`
- `mid_reveal`
- `peak_payoff`
- `ending_residue`

#### 字段含义

- `hook_claim`
  - 开头最核心的 promise 是什么
- `pressure_escalation`
  - 中段压力如何一步步加上来
- `mid_reveal`
  - 中段最关键的信息揭示或翻面点是什么
- `peak_payoff`
  - 观众真正等的那一下在哪里
- `ending_residue`
  - 结尾想留给观众的余味是什么

#### 设计边界

- 不是新大纲
- 不是新段落模板
- 不是新分镜合同
- 每个字段只允许一两句短句

一句话：

**它只是一张轻量张力地图，不是新的 OutlinePlan。**

### C. Packaging Lane 从单个 `packaging_hook` 升级为微结构

#### 当前问题

单个 `packaging_hook` 太薄，难以稳定联动标题、封面和开头。

#### 最小升级建议

- `hook_claim`
- `hook_emotion`
- `reveal_position`

#### 字段含义

- `hook_claim`
  - 对外最核心的抓点命题
- `hook_emotion`
  - 这个抓点想激发什么情绪
  - 例如：好奇、不信、压迫、震惊
- `reveal_position`
  - 这个 promise 在正文中大致什么时候兑现
  - 建议只保留：
    - `early`
    - `mid`
    - `late`

#### 设计边界

- 仍然只服务 Packaging Lane
- 不得直接绑定 script 正文结构

### D. script 语义审校增加进攻性标签

#### 建议新增标签

- `hook_kill_power_weak`
- `suspense_density_low`
- `peak_missing`
- `ending_residue_weak`

#### 含义

- `hook_kill_power_weak`
  - 开头虽然没错，但不够有停留力
- `suspense_density_low`
  - 中段缺少持续往下听的动力
- `peak_missing`
  - 整篇没有明确高潮或兑现点
- `ending_residue_weak`
  - 结尾收住了，但没有余味或讨论欲

#### 设计边界

- 不新增新审校阶段
- 不新增第二个审校模型
- 仍由当前单一语义审校输出这些标签
- 这些标签默认不直接导致 hard fail

### E. `patch_once` 增加 `intent=lift`

#### 原因

如果只给审校端加进攻性标签，而不给现有 patch 机制一个明确的“提升用途”，后面实现很容易开始偷偷膨胀 prompt。

#### 建议

不新增新的状态 `lift_once`。  
仍然保留：

- `patch_once`
- `regen_once`
- `return_topic`

但允许 `patch_once` 带一个更轻的意图：

- `intent=fix`
- `intent=lift`

#### 含义

- `fix`
  - 修 bug、修表达、修局部违约
- `lift`
  - 只提升攻击性，例如：
    - 开头更抓
    - 中段悬念更密
    - 高潮更明确
    - 结尾余味更强

#### 设计边界

- `intent=lift` 只能作用于局部
- 不能突破当前 `patch_once` 的边界
- 不能把 patch 扩成隐性重写

## 六、为什么这个方案不会破坏当前稳定结构

### 1. 不拉长主流程

主链路仍然是：

```text
topic -> Topic Package -> Topic Delivery Pack -> script
```

没有新增 creative stage。

### 2. 不新增主裁判

仍然只有：

- 本地硬校验
- 单一语义审校

没有新引入“创意裁判”。

### 3. 不恢复多稿系统

script 阶段仍然默认单稿。  
进攻性提升走：

- `patch_once(intent=lift)`
- 或有限 `regen_once`

不回到多稿竞赛。

### 4. 新增的是字段，不是新 prompt 洪水

新增的都是：

- 短字段
- 枚举
- 轻量标签
- 轻量张力图

不是新的长 prose prompt。

这点非常关键，因为当前整个系统最怕的就是：

- 再次 prompt 过重
- 再次前后打架

## 七、如果只给审校端加标签、不同步给生成端，会发生什么

这是本轮讨论里确认过的关键风险。

如果只在审校端增加：

- `hook_kill_power_weak`
- `suspense_density_low`
- `peak_missing`
- `ending_residue_weak`

但 script 生成端并没有拿到：

- `viral_rubric`
- `narrative_tension_map`
- Packaging Lane 的微结构

那么会出现：

1. 审校端单边加压  
   生成器只知道“讲对”，审校器却在判“又对又炸”。

2. `patch_once(intent=lift)` 频率升高  
   但这种 lift 不是建立在统一目标上的，而是在后置修补。

3. 实现层偷偷膨胀 prompt  
   开发者为了过审，会开始在 script prompt 中私加“更炸”“更有悬念”等长 prose 指令。

所以结论非常明确：

**进攻性标签不能只存在于审校端。**  
它们必须和生成端共享同一套轻量“进攻目标”。

## 八、当前不做的事

为了避免过度修复，本轮明确不做这些：

1. 不做新的创意阶段
2. 不恢复 script 多稿竞赛
3. 不再加一个创意审校器
4. 不让 offensive labels 直接升级为 hard fail
5. 不把 `narrative_tension_map` 写成长段 narrative brief
6. 不把 family 扩成刚性正文模板

## 九、当前建议的落地顺序

这套优化建议的落地顺序应该是：

### P0

1. `Topic Candidate` 增加 `viral_rubric`
2. `Topic Package` 增加 `narrative_tension_map`
3. Packaging Lane 升级为：
   - `hook_claim`
   - `hook_emotion`
   - `reveal_position`
4. script 语义审校增加 4 个进攻性标签

### P1

5. `patch_once` 支持 `intent=lift`

### P2

6. 再评估 family bias 是否需要微调，而不是先继续扩 family 数量

## 十、当前仍未拍死的点

以下内容当前仍未定稿：

1. `viral_rubric` 是用三档标签、布尔标签，还是轻量枚举组合
2. `narrative_tension_map` 最终是放进 `Topic Package`，还是由 `Topic Delivery Pack` 承接其中一部分
3. `patch_once(intent=lift)` 的最大 patch scope 要不要单独限制
4. 进攻性标签是否需要区分 local / global 两级

## 十一、最终结论

当前结论可以压缩成一句话：

**当前新流水线的底座是对的，问题不是结构错了，而是它更擅长稳定、不够擅长进攻。**

因此，最合理的修法不是推翻已有设计，而是：

**在不新增阶段、不恢复多稿、不加重 prompt 的前提下，为 topic 和 script 之间补一层极轻的“创意引导与张力设计”，再让语义审校与这套张力目标对齐。**

这才是当前“爆款化优化”的主结论。
