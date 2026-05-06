# Zhuanzhu Upstream Material Sufficiency Diagnosis

日期：2026-05-06

## 背景

在 `2026-05-06-after-no-padding-volume-contract` 真实 5 轮复测中，`zhuanzhu-ciwangliao` 仍未通过 local validation：

- local validation: `regen_once`
- error: `script_body_too_thin`
- script chars: 175
- sentence count: 8
- medium 下限：240 字 / 7 句

本记录用于判断问题更像 writer 服从不稳，还是上游 TopicPackage 材料不足。

## 上游材料观察

`zhuanzhu-ciwangliao` 的 TopicPackage 存在明显重复：

- `selected_angle`: 一场被安排进宴席的刺杀，决定了吴国权力翻盘的起点。
- `stakes`: 动手只有一次机会，失手就是全盘皆输；后半句又回到 “决定吴国权力翻盘的起点”。
- `narrative_tension_map.hook_claim`: 重复 “决定吴国权力翻盘的起点”。
- `narrative_tension_map.mid_reveal`: 重复 “决定吴国权力翻盘的起点”。
- `narrative_tension_map.ending_residue`: 重复 “决定吴国权力翻盘的起点”。

唯一比较具体的 `strong_scene` 是：

- 鱼腹藏剑，专诸在席间暴起。

`must_include_beats` 也基本围绕同一组表达：

- 动手只有一次机会，失手就是全盘皆输。
- 鱼腹藏剑，专诸在席间暴起。
- 一场被安排进宴席的刺杀，决定了吴国权力翻盘的起点。

## 归因

这不是简单的 “writer 没看到体量下限”。writer 已经收到不得灌水的体量合同，但上游材料给它的有效展开点太少：

- 缺少宴席前的伪装、检查、上菜、靠近王僚等压力阶梯。
- 缺少刺杀动作的即时后果，例如护卫反应、席间混乱、专诸代价。
- 缺少结尾余震，只反复落回 “权力翻盘的起点”。

因此，本轮更接近 “上游材料不足 / tension map 重复”，而不是继续堆 writer prompt 可以稳定解决的问题。

## 对照

`hongmenyan` 本轮从失败转为 pass，script chars 达到 273。它的上游材料虽然也不完美，但至少给了更具体的可展开场面：

- 项庄拔剑起舞。
- 剑锋一次次擦向刘邦。
- 项羽一念之间放走未来敌人。

writer 因此可以用动作、表情、心理压力和即时危险补足体量，而不是单纯解释历史意义。

## 结论

`zhuanzhu-ciwangliao` 当前瓶颈更像上游 TopicPackage 的结构性材料不足：

- tension map 多字段重复。
- strong_scene 太短。
- stakes 与 ending residue 没有提供新的压力或代价。

下一步不建议继续堆 writer prompt，也不建议放松 validator。更合适的低耦合修复是 topic package / topic-to-script 交付前的结构性防重复观察或下限：

- 检查 `narrative_tension_map` 多字段是否明显重复。
- 检查 `strong_scene` 是否只是一句标签而缺少动作和压力源。
- 检查 `stakes` 是否只是复述 selected angle。

这些只能作为结构性质量下限或 harness 观测，不能冒充 “是否爆款” 的语义审校。

继续保持：

- 不接入 patch / regen 主链路。
- 不用本地关键词或黑名单冒充语义判断。
- reviewer 继续 shadow-only。
