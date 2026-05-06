# Script Writer Quality Check After Validator Floor Tightening

日期：2026-05-06

## 背景

上一轮真实 5 轮复测显示，低于 240 字但句子数达标的 medium 稿仍能通过本地校验。

本轮已将 local validator 的正文体量下限从：

- `script_char_count < min && script_sentence_count < min`

收紧为：

- `script_char_count < min || script_sentence_count < min`

该规则仍是结构性下限，不判断“是否爆款”，不使用关键词或黑名单。

## 运行命令

```powershell
npm run harness:topic-script-five-round-quality-check -- --output-dir harness/scripts/runtime/output/script-writer-quality-check/2026-05-06-after-validator-floor-tightening
```

运行结果：

- `5 / 5 sample-ready`
- `4 / 5 local validation pass`
- `1 / 5 local validation regen_once`
- `hongmenyan` 命中 `script_body_too_thin`
- `hongmenyan` 的 semantic review 为 `semantic skipped`

重要口径：

- passed_samples 不是 local validation pass。
- 本轮 summary 中 `5 / 5 sample-ready` 只说明样本产物生成完成，不代表 5 个脚本都通过本地硬校验。

## 5 轮结果表

| sample id | output dir | local validation | semantic shadow | script chars | sentence count | 人工观察 | 人工结论 |
| --- | --- | --- | --- | ---: | ---: | --- | --- |
| `yanzi-shichu` | `yanzi-shichu` | `pass` | `pass` | 248 | 13 | 刚过 medium 字数下限，opening 有冲突但仍以“你能想象吗”起手；结尾偏“智勇交锋”。 | 可用线，未到爆款首稿线。 |
| `zhuanzhu-ciwangliao` | `zhuanzhu-ciwangliao` | `pass` | `pass` | 241 | 9 | 刚过字数下限，鱼腹藏剑场面存在，但结尾“改变命运轨迹 / 新篇章”偏泛。 | 可用线，未到爆款首稿线。 |
| `julu-zhizhan` | `julu-zhizhan` | `pass` | `pass` | 341 | 12 | 体量达标，场面更完整；结尾“勇气与决心”偏价值概括。 | 可用线，接近爆款首稿线。 |
| `hongmenyan` | `hongmenyan` | `regen_once` | `semantic skipped` | 67 | 3 | 首稿和 regen 后仍明显过薄，命中 `script_body_too_thin`。 | 不合格，结构下限正确拦截。 |
| `yanzi-shichu repeat` | `yanzi-shichu-repeat-2` | `pass` | `pass` | 516 | 18 | 体量充足，楚宫对话展开更完整；结尾仍是尊严/国威概括。 | 可用线，接近但未稳定达到爆款首稿线。 |

## validator 行为结论

本轮收紧有效：

- 之前 200 字左右、短句堆叠的 medium 稿可以漏过。
- 现在 67 字 / 3 句的 `hongmenyan` 被明确拦截为 `regen_once`。
- local validation 未通过时，semantic review 被跳过，符合“本地硬校验未通过不得进入语义审校”的阶段闸门。

同时暴露新问题：

- 当前 five-round summary 的 `passed_samples` 仍按 `sample-ready` 统计，不等于 local validation pass。
- `hongmenyan` 在触发一次 regen 后仍未达结构下限，说明 writer 或 regen 路径仍可能生成过薄稿。

## 质量结论

本轮仍未达到爆款首稿线。

更准确的状态是：

- 可追溯性：已改善。
- 结构下限：更严格，且真实样本中已触发。
- writer 首稿质量：仍不稳定。
- 结尾余震：仍普遍偏泛。
- 不接入 patch / regen 主链路。

## 后续建议

1. 优先修正 five-round summary 的统计口径：区分 `sample-ready`、`local validation pass`、`semantic shadow pass`。
2. 单独调查 `hongmenyan` 触发 regen 后仍只有 67 字的原因，判断是 writer prompt 执行不稳、regen 输入不足，还是 runner 没暴露最终失败状态。
3. 继续保持 local validator 只做结构下限，不把“结尾是否有余震”等语义判断本地化。
