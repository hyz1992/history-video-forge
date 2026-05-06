# Script First-pass Quality Recheck After Template Fix

日期：2026-05-06

## 背景

本记录用于复检 `992bbbc 收掉选题合同模板污染` 之后的首稿质量。

本轮只观测 5 次真实 topic -> script 输出，不改代码、不改 prompt、不启用 patch 主路径。

## 运行输入

输出目录：`harness/scripts/runtime/output/topic-script-five-round-quality-recheck-after-template-fix-2026-05-06`

样本：

- `yanzi-shichu`
- `zhuanzhu-ciwangliao`
- `julu-zhizhan`
- `hongmenyan`
- `yanzi-shichu` repeat

## 汇总结果

- live check：5 / 5 通过。
- 本地硬校验：5 / 5 `pass`。
- semantic shadow：
  - `pass`：5
  - `patch_once/lift`：0
  - `return_topic`：0
  - `regen_once`：0
- TopicPackage 模板污染命中：0。
- Script 正文模板污染命中：0。

检查的模板污染短语：

- `公开压场`
- `局势先被对方抢走`
- `必须把这口气当场顶回去`
- `这类场面一旦退掉`

## 分轮结果

| Round | Sample | Local | Semantic | Template Hits | Chars | Opening |
| --- | --- | --- | --- | --- | ---: | --- |
| `round-1-yanzi` | `yanzi-shichu` | `pass` | `pass` | 0 | 354 | 外交官如何在羞辱中捍卫尊严？楚王当众羞辱，晏子不能退。 |
| `round-2-zhuanzhu` | `zhuanzhu-ciwangliao` | `pass` | `pass` | 0 | 158 | 一场精心策划的宴席刺杀，如何改变吴国命运走向？ |
| `round-3-julu` | `julu-zhizhan` | `pass` | `pass` | 0 | 244 | 项羽如何用一场豪赌逼出楚军最强战斗力？ |
| `round-4-hongmenyan` | `hongmenyan` | `pass` | `pass` | 0 | 217 | 项庄拔剑起舞，剑锋一次次擦向刘邦。 |
| `round-5-yanzi-repeat` | `yanzi-shichu` | `pass` | `pass` | 0 | 101 字 | 楚国大殿之上，楚王当众羞辱，晏子不能退。 |

## 质量判断

当前首稿质量已经达到“可用线”：

- 链路稳定，5 / 5 成功。
- 本地硬校验稳定通过。
- semantic reviewer shadow 全部判为 `pass`。
- 模板污染没有回潮。
- opening 不再出现统一挑战句或跨题材压场模板。

但还没有达到“精品线”：

- 部分脚本仍偏概括，尤其 `round-5-yanzi-repeat` 只有 101 字。
- reviewer 虽判 `pass`，但仍指出缺少具体场景和对话细节。
- 目前更像合格首稿，不是可直接发布的成片文案。

## 结论

模板污染修复有效，首稿质量可以判断为：结构稳定、合同覆盖、可进入后续人工或专项 lift，但不应宣称已达到最终稿质量。

下一步如果继续提升，应单独处理“首稿细节密度不足”，尤其是对话、动作和关键场面展开；这应作为 writer 质量专项，不应回到 fake reviewer 或模板句路径。
