# Script First-pass Quality Recovery Final Check

日期：2026-05-06

## 背景

本记录用于对 `Script First-pass Quality Recovery` 做最终收口检查。

当前工作树中已无 `docs/plans/2026-05-05-script-first-pass-quality-recovery-implementation-plan.md`，因此本检查只引用当前可验证的 commit 链、records 与 harness 输出，不凭空复述不可读取的计划文本。

## 目标回看

本轮核心问题不是把 semantic review 直接做成主链路裁判，而是按顺序完成：

1. 收掉 fake semantic review。
2. 修复首稿 opening 的上游模板污染。
3. 收口 writer 首稿 opening 生成。
4. 以 shadow-only 方式接入真实 semantic reviewer。
5. 用对照样本和真实 smoke 观察 reviewer 是否能作为可信量尺。

## 已完成证据

| Area | Evidence |
| --- | --- |
| fake semantic review | `df7c92b 收掉脚本假的语义审校决策`，无 reviewer/stub 时返回 `skipped`，不再冒充语义判断 |
| opening 上游污染 | `59febcb 去掉选题交付包装的统一挑战句模板` |
| writer opening | `f40fbee 收口脚本开头的场面化生成合同` |
| shadow reviewer 接入 | `af40955 接入脚本语义审校的影子评估链路` |
| 本地首稿质量 | `99028bb 记录脚本首稿质量复测基线`，固定样本本地校验 `10 / 10` |
| reviewer 输出结构 | `6430958 收口脚本语义审校输出结构` |
| 首稿量尺校准 | `c9ad077 校准脚本语义审校首稿量尺` 与 `3cbcdb2 记录脚本语义审校校准分布` |
| 对照样本巡检 | `d9a174f 固化脚本语义审校对照巡检` |
| 跨题材对照扩展 | `ef7d63b 扩展脚本语义审校跨题材样本` |
| 9 fixture 校准 | `d12948c 记录脚本语义审校校准复测`，真实 shadow `9 / 9` matched |
| smoke 观测 | `4fb2d14 记录脚本首稿校准后冒烟观测` |
| skipped 测试期望 | `c59ce06 修正脚本冒烟语义跳过断言`，承认无真实 reviewer 时 `skipped` 是合法结果 |
| 扩展首稿 smoke | `212fde2 扩展脚本首稿冒烟样本`，真实扩展 smoke `4 / 4` live check、本地硬校验 `4 / 4`、semantic shadow `4 / 4 pass` |

## 当前链路状态

当前 script 主链路是：

1. 生成首稿。
2. 运行本地硬校验。
3. 运行 semantic reviewer shadow。
4. 持久化 review、diagnostics 和 graph trace。

reviewer 的作用仍是量尺，不是方向盘。`patch_once`、`return_topic`、`regen_once` 都不自动驱动主链路动作。

## 验证摘要

- Controlled fixture：9 个跨题材对照样本，`9 / 9` matched。
- Expanded live smoke：4 个真实 topic -> script 样本，`4 / 4` sample-ready。
- Expanded live smoke local validation：`4 / 4` pass。
- Expanded live smoke semantic shadow：`pass` 4，`patch_once/lift` 0，`return_topic` 0，`regen_once` 0。
- 相关串行回归：`26 / 26` 通过。

## 明确不做

- patch 仍不进入本轮主路径。
- 不把 reviewer 输出升级成自动门禁。
- 不用本地字符串规则、关键词匹配或类似方法冒充正式语义审校。
- 不为了迎合 reviewer 单次反馈继续堆 prompt。
- 不把当前工作扩散到 storyboard、assets、compose 或其他 downstream。
- 不修改默认稳定回归 `family-set.md`；扩展样本集只用于显式真实巡检。

## 剩余风险

- 真实 LLM 输出仍会波动，`yanzi-shichu` 在不同 smoke 中出现过 `patch_once/lift` 与 `pass` 的变化。
- `storage/topic-candidate-library/` 是未跟踪生成态数据，串行验证可通过，但并行写入同一 seed 时仍可能产生竞争风险。
- 当前扩展 smoke 只有 4 个真实样本，足够做恢复线收口，不足以声明生产级稳定。

## 结论

`Script First-pass Quality Recovery` 的本轮目标已经闭环：fake review 已移除，opening 上游污染已收掉，writer opening 合同已收口，真实 reviewer 已以 shadow-only 方式接入并通过跨题材对照与扩展 smoke 观察。

下一阶段如果要继续推进，应先单独设计 patch integration，而不是在这条 recovery 线上顺手打开 patch 主路径。
