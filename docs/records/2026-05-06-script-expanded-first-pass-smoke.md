# Script Expanded First-pass Smoke

日期：2026-05-06

## 背景

本记录用于固化扩展 topic -> script 首稿 smoke 的真实观测结果。

本轮新增独立扩展样本集 `harness/samples/topic-script/expanded-family-set.md`，默认稳定回归集 `family-set.md` 保持不变。semantic reviewer 仍只作为 shadow-only 量尺，不驱动主链路，不开启自动 patch。

## 运行输入

- 命令：`npx tsx harness/scripts/runtime/topic-script-live-check.ts --family-set harness/samples/topic-script/expanded-family-set.md --output-dir harness/scripts/runtime/output/topic-script-expanded-first-pass-smoke-2026-05-06`
- family set：`harness/samples/topic-script/expanded-family-set.md`
- 输出目录：`harness/scripts/runtime/output/topic-script-expanded-first-pass-smoke-2026-05-06`
- 自动门禁：关闭
- reviewer 模式：shadow-only

## 样本范围

| Sample ID | Event | Purpose |
| --- | --- | --- |
| `yanzi-shichu` | 晏子使楚 | 外交压场 |
| `zhuanzhu-ciwangliao` | 专诸刺王僚 | 刺杀政变 |
| `julu-zhizhan` | 巨鹿之战 | 战场翻盘 |
| `hongmenyan` | 鸿门宴 | 宴席杀局 |

## 汇总结果

- 总样本数：4
- live check 通过：4 / 4
- 本地硬校验通过：4 / 4
- semantic shadow 分布：
  - `pass`：4
  - `patch_once/lift`：0
  - `return_topic`：0
  - `regen_once`：0

| Sample ID | Local Validation | Semantic Shadow | Soft Issues | Confidence |
| --- | --- | --- | --- | --- |
| `yanzi-shichu` | `pass` | `pass` | 2 | 0.8 |
| `zhuanzhu-ciwangliao` | `pass` | `pass` | 2 | 0.85 |
| `julu-zhizhan` | `pass` | `pass` | 1 | 0.85 |
| `hongmenyan` | `pass` | `pass` | 2 | 0.9 |

## 观察

扩展到 4 个跨题材真实首稿样本后，本地硬校验和 semantic shadow 均未出现阻断性结果。上一轮 `yanzi-shichu` 曾被 shadow reviewer 判为 `patch_once/lift`，本轮同样本回到 `pass`，说明真实 reviewer 输出仍存在模型波动，不能把单次 shadow 结果当成自动门禁。

新增 `julu-zhizhan` 与 `hongmenyan` 均完成 topic -> script 闭环，并通过本地硬校验与 semantic shadow。当前没有证据表明 semantic reviewer 边界校准压低了首稿通过率。

## 结论

本轮扩展 smoke 支持继续保持当前策略：

- 首稿通过率优先。
- reviewer 继续作为可信量尺的 shadow 观测，不驱动主链路。
- patch 仍不进入本轮主路径。
- 默认稳定回归样本集不扩大，扩展样本集只用于显式真实巡检。

下一步如继续推进，应优先积累更多真实 smoke 记录，观察分布趋势，而不是针对单次 reviewer 波动继续堆 prompt。
