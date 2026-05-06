# Script Writer Quality Check After No-padding Volume Contract

日期：2026-05-06

## 背景

上一轮真实复测显示：`regeneration_context` 已经传到第二次 writer，但 writer 仍有 2 / 5 低于 `medium` 结构体量下限。随后 prompt 只新增一条短合同：

- `medium` 首稿正文至少约 240 个汉字等价长度。
- 85 秒稿不能只有 190-200 字。
- 只能用场景、动作、对话或转述、压力升级、即时后果补足体量。
- 不得为了凑字数重复解释、空泛评价或喊口号。

本轮验证这条 “不能为了凑字数说废话” 的体量合同是否有效。

## 运行命令

```powershell
npm run harness:topic-script-five-round-quality-check -- --output-dir harness/scripts/runtime/output/script-writer-quality-check/2026-05-06-after-no-padding-volume-contract
```

输出目录：

`harness/scripts/runtime/output/script-writer-quality-check/2026-05-06-after-no-padding-volume-contract`

## 汇总结果

- `5 / 5 sample-ready`
- `4 / 5 local validation pass`
- `1 / 5 local validation failed`
- `3 / 5 semantic shadow pass`
- `1 / 5 semantic shadow skipped`
- `1 / 5 semantic shadow attention`

相对上一轮 `3 / 5 local validation pass`，本轮体量合同局部有效，但仍不稳定。

## 5 轮结果表

| sample id | local validation | semantic shadow | script chars | sentence count | 观察 |
| --- | --- | --- | ---: | ---: | --- |
| `yanzi-shichu` | `pass` | `pass` | 通过 | 通过 | 结构下限通过。 |
| `zhuanzhu-ciwangliao` | `regen_once` | `skipped` | 175 | 8 | 仍触发 `script_body_too_thin`；结尾仍偏 “开启新时代” 式泛化。 |
| `julu-zhizhan` | `pass` | `pass` | 通过 | 通过 | 结构下限通过。 |
| `hongmenyan` | `pass` | `pass` | 273 | 8 | 从上一轮失败变为通过；体量主要来自项庄舞剑、项羽犹豫、刘邦反应等具体压力细节。 |
| `yanzi-shichu repeat` | `pass` | `patch_once` | 通过 | 通过 | reviewer shadow 标记 `patch_once/lift`，集中在场景、对话、递进不足；不接入主链路。 |

## 质量结论

本轮结果说明：

- 体量合同对 `hongmenyan` 有改善，且改善不是明显灌水。
- `zhuanzhu-ciwangliao` 仍低于 240 字，说明 writer 对体量下限仍不稳定。
- `yanzi-shichu repeat` 虽然结构通过，但 reviewer shadow 仍认为场景与对话张力不足。
- 当前仍未达到爆款首稿线。

这轮不能宣称首稿质量达标，只能说结构下限稳定性从 3 / 5 改善到 4 / 5。

## 后续建议

下一步不要继续堆 prompt 口号，也不要放松 validator。建议先分析 `zhuanzhu-ciwangliao` 的上游输入材料是否足以支撑 240 字有效展开：

- `strong_scene`
- `must_include_beats`
- `narrative_tension_map`
- `stakes`
- `source_anchor_refs`

如果上游材料足够，再考虑做更窄的 writer 输入组织修复；如果上游材料不足，应回到 topic package 质量，而不是让 writer 硬编。

继续保持：

- 不接入 patch / regen 主链路。
- semantic reviewer 只做 shadow-only。
- 不用本地关键词或字符串规则冒充语义审校。
