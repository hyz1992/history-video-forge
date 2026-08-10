# Asset Planning 语义意图编译器真实验收记录

- 日期：2026-08-10
- 模式：`intent_compiler`
- provider / model：DeepSeek / `deepseek-v4-pro`
- 结论：15 / 21 分镜双闸门通过，允许把默认模式切换为 `intent_compiler`

## 授权与范围

用户分别明确授权将 15 分镜与 21 分镜合成 fixture 中的历史长文、Topic Package、Storyboard Plan 和相关 Prompt 发送至 DeepSeek API，并接受对应 provider 费用。验收只运行 Asset Planning；未调用图片、音频、视频 provider，未生成或上传真实资产。

## 首次 15 分镜失败基线

修复前输出目录：`harness/scripts/runtime/output/live-20260810-15`

| 指标 | 结果 |
| --- | ---: |
| 总轮次 / 有效 provider 轮次 | 5 / 5 |
| 端到端成功 | 0 / 5 |
| provider failure | 0 |
| structural/compiler failure | 5 |
| repair / regeneration / safety | 20 / 20 / 0 |
| provider attempts | 125 |
| accounting incomplete | 0 |

失败证据显示五类意图字段合同没有完整进入 planner / repair Prompt，模型稳定产生 `motion_prompt`、`sfx_prompt`、`music_description` 等未知键，并漏写部分正式必填字段；同时设计已冻结的“未知键先机械剥离、再严格解析”没有在 intent 边界实现。该失败不是 provider 重试不足。

根因修复提交：`003d6cc 修复资产意图合同漂移`。修复补齐五类精确字段与示例，并只对已识别正式意图机械剥离未知键；缺少语义字段仍进入受限 repair，不由本地逻辑猜测或补写。

## 修复后 15 分镜闸门

输出目录：`harness/scripts/runtime/output/live-20260810-15-v2`

| 指标 | 结果 |
| --- | ---: |
| 总轮次 / 有效 provider 轮次 | 6 / 5 |
| 端到端成功 | 5 / 5 |
| provider failure | 1 |
| structural/compiler failure | 0 |
| repair / regeneration / safety | 8 / 0 / 0 |
| provider attempts | 118 |
| makeup rounds | 1 |
| accounting incomplete | 0 |

唯一失败轮为 provider 类失败，未计入有效分母；补跑后取得 5 个有效轮次全部成功。五个成功轮均产出 `asset-plan.json` 与 `asset-planning-validation-result.json`。

## 修复后 21 分镜压力闸门

输出目录：`harness/scripts/runtime/output/live-20260810-21-v1`

| 指标 | 结果 |
| --- | ---: |
| 总轮次 / 有效 provider 轮次 | 2 / 2 |
| 端到端成功 | 2 / 2 |
| provider failure | 0 |
| structural/compiler failure | 0 |
| repair / regeneration / safety | 3 / 0 / 0 |
| provider attempts | 52 |
| makeup rounds | 0 |
| accounting incomplete | 0 |

## 结论与剩余风险

双闸门满足正式设计：15 分镜 5/5 有效轮次端到端成功，21 分镜 2/2 成功，且两组 `structural_compiler_failure_rounds=0`。因此默认模式可以切换到 `intent_compiler`，同时保留显式 `ASSET_PLANNING_GENERATION_MODE=legacy` 回滚。

本记录只证明本次固定长样本和 provider 配置下的结构韧性，不承诺真实 provider 永不超时、永不内容过滤，也不替代审美、历史准确性或发布质量的人工验收。provider 类失败继续独立报告，不能伪装成结构成功。
