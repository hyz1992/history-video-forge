# Script Semantic Reviewer Expanded Fixture Shadow Check

日期：2026-05-06

## 背景

本记录用于固化脚本语义审校扩展对照样本的 shadow 复测结果。

本轮不调整 prompt、不调整 adapter、不改变 script 主链路，也不把 patch 拉入主路径。semantic reviewer 仍只作为 shadow-only 量尺，用于观察真实审校输出与人工预期标签之间的偏差。

## 运行输入

- 命令：`npm run harness:script-semantic-fixtures -- harness/scripts/runtime/output/script-semantic-fixture-expanded-smoke-2026-05-05`
- fixture set：`harness/samples/script-semantic-reviewer/fixture-set.md`
- 输出目录：`harness/scripts/runtime/output/script-semantic-fixture-expanded-smoke-2026-05-05`
- 自动门禁：关闭
- reviewer 模式：shadow-only

## 汇总结果

- 总样本数：9
- 符合预期：7 / 9
- 偏差样本：2 / 9

| Sample ID | Category | Expected | Actual | Match |
| --- | --- | --- | --- | --- |
| `semantic-good-enough-yanzishichu` | `good_enough` | `pass` | `pass` | yes |
| `semantic-weak-opening-yanzishichu` | `weak_lift` | `patch_once/lift` | `patch_once/lift` | yes |
| `semantic-off-contract-yanzishichu` | `off_contract` | `return_topic` | `return_topic` | yes |
| `semantic-good-enough-zhuanzhu` | `good_enough` | `pass` | `pass` | yes |
| `semantic-weak-opening-zhuanzhu` | `weak_lift` | `patch_once/lift` | `patch_once/lift` | yes |
| `semantic-off-contract-zhuanzhu` | `off_contract` | `return_topic` | `regen_once` | no |
| `semantic-good-enough-julu` | `good_enough` | `pass` | `pass` | yes |
| `semantic-weak-opening-julu` | `weak_lift` | `patch_once/lift` | `pass` | no |
| `semantic-off-contract-julu` | `off_contract` | `return_topic` | `return_topic` | yes |

## 偏差解释

### `semantic-off-contract-zhuanzhu`

- 预期：`return_topic`
- 实际：`regen_once`
- 含义：reviewer 已识别脚本严重偏离主题，但在“退回 topic”和“重生成 script”之间的边界不稳定。该偏差说明 off-contract 样本的决策层级仍需校准，尤其是当脚本完全换成无关题材时，应优先稳定落到 `return_topic`，而不是让 script 端继续局部自修。

### `semantic-weak-opening-julu`

- 预期：`patch_once/lift`
- 实际：`pass`
- 含义：reviewer 对“结构覆盖但表达过于概括”的战场翻盘型首稿偏宽。该样本说明 reviewer 能接受基本合同覆盖，但对 summary-like opening 的 lift 边界不够敏感。后续如果校准，应只收紧“弱开头/弱场面化”的判断边界，不能把 good-enough 首稿重新压成过度返工。

## 结论

扩展到 9 个跨题材样本后，semantic reviewer shadow 量尺整体可用，但存在两个需要单独校准的边界：

- `return_topic` vs `regen_once`：完全跑题时的上游合同退回边界。
- `pass` vs `patch_once/lift`：结构覆盖但开头和场面表达过弱时的 lift 边界。

本记录只作为观测基线，不改变当前运行链路。下一步应以独立任务校准 reviewer prompt 的这两个边界，并继续保持 shadow-only，不让 reviewer 反馈提前驱动主链路。
