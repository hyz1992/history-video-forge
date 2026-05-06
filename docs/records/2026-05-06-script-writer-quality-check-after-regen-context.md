# Script Writer Quality Check After Regen Context

日期：2026-05-06

## 背景

上一轮修复已经让 `regen_once` 二次生成携带上一稿 local validation 的结构失败原因与 metrics。本轮用真实 5 轮 topic+script 复测确认：

- `regeneration_context` 是否实际进入第二次 `script.writer` 输入。
- `min_script_chars_for_band` / `min_sentence_count_for_band` 是否被 writer 采纳。
- 新的 five-round 汇总口径是否能区分 sample-ready、local validation 与 semantic shadow。

## 运行命令

```powershell
npm run harness:topic-script-five-round-quality-check -- --output-dir harness/scripts/runtime/output/script-writer-quality-check/2026-05-06-after-regen-context
```

输出目录：

`harness/scripts/runtime/output/script-writer-quality-check/2026-05-06-after-regen-context`

## 汇总结果

- `5 / 5 sample-ready`
- `3 / 5 local validation pass`
- `2 / 5 local validation failed`
- `3 / 5 semantic shadow pass`
- `2 / 5 semantic shadow skipped`
- `0 / 5 semantic shadow attention`

本轮证明新的汇总口径有效：`passed_samples` 仍表示 sample-ready，不再被误读为 local validation pass。

## 5 轮结果表

| sample id | local validation | semantic shadow | script chars | sentence count | 备注 |
| --- | --- | --- | ---: | ---: | --- |
| `yanzi-shichu` | `pass` | `pass` | 通过 | 通过 | 可用线稳定，但仍需人工判断口播张力。 |
| `zhuanzhu-ciwangliao` | `regen_once` | `skipped` | 203 | 8 | 仍触发 `script_body_too_thin`，低于 240 字下限。 |
| `julu-zhizhan` | `pass` | `pass` | 通过 | 通过 | 结构下限通过。 |
| `hongmenyan` | `regen_once` | `skipped` | 192 | 8 | 仍触发 `script_body_too_thin`，低于 240 字下限。 |
| `yanzi-shichu repeat` | `pass` | `pass` | 通过 | 通过 | repeat 独立输出正常。 |

## Regen Context 证据

两个失败样本都走过 `regen-once`：

- `zhuanzhu-ciwangliao`: `script-generate -> local-validate -> regen-once -> local-validate`
- `hongmenyan`: `script-generate -> local-validate -> regen-once -> local-validate`

二次 writer 交互记录中均包含：

- `regeneration_context`
- `script_body_too_thin`
- `min_script_chars_for_band: 240`
- `min_sentence_count_for_band: 7`

因此，本轮不能再归因为 “local validation 失败信号没有传到 writer”。信号已经传到 writer，但 writer 仍没有稳定遵守正文体量下限。

## 质量结论

本轮没有达到预期改善：

- regen context 链路生效。
- 真实二次稿仍有 2 / 5 未过 local validation。
- 失败原因集中在正文体量低于结构下限，而不是句子数不足。
- 当前仍未达到爆款首稿线。

这说明当前问题从 “链路未传递约束” 转为 “writer 对结构下限约束服从不稳定”。不应放松 validator，也不应接入 patch / regen 主链路来掩盖这个问题。

## 后续建议

下一步建议只做一个低耦合修复：强化 writer 正文体量合同，但必须短而清晰，不堆爆款口号，不引入本地语义规则。

建议方向：

- 让 writer 明确 `medium` 首稿正文需要至少约 240 个汉字等价长度。
- 要求 `estimated_duration_sec` 与正文体量一致，不允许 85 秒稿只有 190-200 字。
- 保持 reviewer shadow-only。
- 不接入 patch / regen 主链路。
