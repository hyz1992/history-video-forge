# Script Writer Quality Check After Output Trace Fix

日期：2026-05-06

## 背景

上一轮真实 5 轮复测发现两个可追溯性问题：

- `--output-dir` 没有按预期生效，产物落到默认目录。
- `yanzi-shichu repeat` 与首轮 `yanzi-shichu` 使用同一个输出目录，导致 repeat 可能覆盖首轮产物。

本轮先修复 harness 输出追踪，再重跑真实 5 轮，用于确认产物路径和 repeat 样本可追溯。

## 运行命令

```powershell
npm run harness:topic-script-five-round-quality-check -- --output-dir harness/scripts/runtime/output/script-writer-quality-check/2026-05-06-after-output-trace-fix
```

第一次运行失败：

- `topic.candidate-builder timed out after 45000ms`
- `attempt_count: 3`
- 错误为 retryable 外部服务 timeout，不作为脚本质量结论。

第二次运行成功：

- `5 / 5 sample-ready`
- `5 / 5 local validation pass`
- 输出目录：`harness/scripts/runtime/output/script-writer-quality-check/2026-05-06-after-output-trace-fix`

## 输出追踪验证

本轮确认：

- 显式 output_dir 已生效。
- repeat 样本已独立落盘。
- `yanzi-shichu repeat` 输出目录为 `yanzi-shichu-repeat-2`。
- 五个样本目录互不覆盖：
  - `yanzi-shichu`
  - `zhuanzhu-ciwangliao`
  - `julu-zhizhan`
  - `hongmenyan`
  - `yanzi-shichu-repeat-2`

## 5 轮结果表

| sample id | output dir | local validation | semantic shadow | script chars | sentence count | 人工观察 | 人工结论 |
| --- | --- | --- | --- | ---: | ---: | --- | --- |
| `yanzi-shichu` | `yanzi-shichu` | `pass` | `patch_once` | 255 | 11 | 进入使楚受辱局面，但结尾是“捍卫国家尊严的典范”，仍偏概括。 | 可用线，未到爆款首稿线。 |
| `zhuanzhu-ciwangliao` | `zhuanzhu-ciwangliao` | `pass` | `pass` | 217 | 9 | 有宴席、鱼腹藏剑、刺杀动作，但结尾“开启吴国新的历史篇章”偏泛。 | 可用线，未到爆款首稿线。 |
| `julu-zhizhan` | `julu-zhizhan` | `pass` | `pass` | 322 | 14 | 字数达标，破釜沉舟清楚；opening 仍先泛问，结尾拔到精神激励。 | 可用线，接近但未稳定达到爆款首稿线。 |
| `hongmenyan` | `hongmenyan` | `pass` | `pass` | 291 | 13 | 有项庄舞剑场面，结尾“历史转折点”仍偏空。 | 可用线，接近但结尾余震弱。 |
| `yanzi-shichu repeat` | `yanzi-shichu-repeat-2` | `pass` | `pass` | 436 | 14 | repeat 独立产物可读；有楚宫对话展开，但结尾仍是智慧/尊严/国家荣誉概括。 | 可用线，接近但未到发布或稳定爆款首稿线。 |

## 质量结论

输出追踪问题已解决，但内容质量结论不变：

- 链路稳定：真实 5 轮成功完成。
- 可追溯性改善：显式 output_dir 已生效，repeat 样本已独立落盘。
- 质量层级：仍未达到爆款首稿线。
- 不能因为本轮 `5 / 5 local validation pass` 就宣称首稿质量达标。
- 不接入 patch / regen 主链路。

## 后续建议

1. 下一步优先复核 local validator 的 medium 结构下限：目前低于 240 字但句数达标的稿仍可 pass。
2. writer 仍需要继续强化结尾余震与 beat 场面推进，尤其避免“改变历史 / 开启篇章 / 国家尊严典范”式泛收束。
3. semantic shadow 对偏概括稿仍偏宽，继续只作为观察量尺，不升级为自动门禁。
