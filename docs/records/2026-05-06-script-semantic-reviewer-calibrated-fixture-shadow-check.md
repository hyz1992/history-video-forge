# Script Semantic Reviewer Calibrated Fixture Shadow Check

日期：2026-05-06

## 背景

本记录用于固化 `9fa6f32 校准脚本语义审校边界` 之后的真实 shadow 复测结果。

本轮只验证 semantic reviewer 作为 shadow-only 量尺的边界稳定性，不改变 script 主链路，不开启自动 patch，不让 reviewer 决策驱动生成流程。

## 运行输入

- 命令：`npm run harness:script-semantic-fixtures -- harness/scripts/runtime/output/script-semantic-fixture-calibrated-smoke-2026-05-06-r2`
- fixture set：`harness/samples/script-semantic-reviewer/fixture-set.md`
- 输出目录：`harness/scripts/runtime/output/script-semantic-fixture-calibrated-smoke-2026-05-06-r2`
- 自动门禁：关闭
- reviewer 模式：shadow-only

## 汇总结果

- 总样本数：9
- 符合预期：9 / 9
- 偏差样本：0 / 9
- `mismatched_fixtures: 0`

| Sample ID | Category | Expected | Actual | Match |
| --- | --- | --- | --- | --- |
| `semantic-good-enough-yanzishichu` | `good_enough` | `pass` | `pass` | yes |
| `semantic-weak-opening-yanzishichu` | `weak_lift` | `patch_once/lift` | `patch_once/lift` | yes |
| `semantic-off-contract-yanzishichu` | `off_contract` | `return_topic` | `return_topic` | yes |
| `semantic-good-enough-zhuanzhu` | `good_enough` | `pass` | `pass` | yes |
| `semantic-weak-opening-zhuanzhu` | `weak_lift` | `patch_once/lift` | `patch_once/lift` | yes |
| `semantic-off-contract-zhuanzhu` | `off_contract` | `return_topic` | `return_topic` | yes |
| `semantic-good-enough-julu` | `good_enough` | `pass` | `pass` | yes |
| `semantic-weak-opening-julu` | `weak_lift` | `patch_once/lift` | `patch_once/lift` | yes |
| `semantic-off-contract-julu` | `off_contract` | `return_topic` | `return_topic` | yes |

## 校准收敛点

### `semantic-off-contract-zhuanzhu`

上一轮偏差为：预期 `return_topic`，实际 `regen_once`。

本轮已收敛为：实际 `return_topic`。这说明“完全换成无关题材、缺失核心人物/事件/must_include_beats”时，reviewer 当前能稳定落到上游合同退回边界，而不是让 script 端继续自修。

### `semantic-weak-opening-julu`

上一轮偏差为：预期 `patch_once/lift`，实际 `pass`。

本轮已收敛为：实际 `patch_once/lift`。这说明“结构覆盖但整体仍像梗概、关键场面缺少具体压力和不可逆后果”时，reviewer 当前能识别为局部 lift，而不是仅因 beat 覆盖就放行。

## 结论

校准后的 9 个跨题材对照样本全部符合预期，semantic reviewer 作为 shadow-only 量尺的当前边界可作为后续观察基线。

该结果不代表 reviewer 可升级为自动门禁，也不代表 patch 可以进入主路径。下一步如继续推进，应优先在真实首稿批量 smoke 中观察首稿通过率与 reviewer 分布是否保持健康。
