# Script First-pass Smoke After Semantic Calibration

日期：2026-05-06

## 背景

本记录用于观察 `9fa6f32 校准脚本语义审校边界` 与 `d12948c 记录脚本语义审校校准复测` 之后，真实 topic -> script 首稿链路是否仍保持健康。

本轮只做观测和记录。semantic reviewer 仍为 shadow-only 量尺，不驱动主链路，不开启自动 patch，不根据 reviewer 反馈回改 writer 或 topic。

## 运行输入

- 命令：`npx tsx harness/scripts/runtime/topic-script-live-check.ts --family-set harness/samples/topic-script/family-set.md --output-dir harness/scripts/runtime/output/topic-script-first-pass-smoke-2026-05-06`
- family set：`harness/samples/topic-script/family-set.md`
- 输出目录：`harness/scripts/runtime/output/topic-script-first-pass-smoke-2026-05-06`
- 自动门禁：关闭
- reviewer 模式：shadow-only

## 汇总结果

- 总样本数：2
- live check 通过：2 / 2
- 本地硬校验通过：2 / 2
- semantic shadow 分布：
  - `pass`：1
  - `patch_once/lift`：1
  - `return_topic`：0
  - `regen_once`：0

| Sample ID | Local Validation | Semantic Shadow | Patch Intent | Notes |
| --- | --- | --- | --- | --- |
| `yanzi-shichu` | `pass` | `patch_once` | `lift` | 覆盖 must_include_beats，但 reviewer 认为开场、对话和结尾仍偏简略 |
| `zhuanzhu-ciwangliao` | `pass` | `pass` | null | 覆盖 must_include_beats，首稿结构和场面成立 |

## 观察

### 首稿主链路

两个样本均完成 topic -> script 闭环，且本地硬校验全部通过。当前 writer 首稿没有被 semantic reviewer 拦截，符合“首稿通过率优先”的原则。

### Semantic Shadow

校准后的 reviewer 没有把真实首稿误判为 `return_topic` 或 `regen_once`，说明 off-contract 边界没有外溢到正常样本。

`yanzi-shichu` 被判为 `patch_once/lift`，主要原因是 reviewer 认为表达仍偏梗概化，开场压力、对话交锋和结尾力量不足。该结果可作为后续观察信号，但不能直接触发 patch 主路径，也不能为了迎合 reviewer 而牺牲整体首稿稳定性。

## 结论

本轮真实首稿 smoke 显示：

- 本地硬校验：健康，2 / 2 通过。
- reviewer shadow：可用但偏严格，1 个 `pass`，1 个 `patch_once/lift`。
- 主链路：保持不变，不引入 reviewer 驱动的生成或 patch。

下一步如果继续推进，应扩大真实首稿样本数，观察 semantic shadow 分布是否稳定，而不是立刻针对单个 `patch_once/lift` 样本继续堆 prompt。
