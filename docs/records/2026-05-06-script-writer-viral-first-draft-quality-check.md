# Script Writer Viral First-draft Quality Check

日期：2026-05-06

## 任务范围

本记录收口 `Script Writer Viral First-draft Quality` implementation plan 的 Task 5-6。

本轮目标不是发布稿，也不是接入 patch，而是判断 Task 1-3 后，真实 `topic -> script` 首稿是否从“结构可用线”推进到“爆款首稿线”的最低要求。

## 运行信息

执行命令：

```powershell
npm run harness:topic-script-five-round-quality-check -- --output-dir harness/scripts/runtime/output/script-writer-quality-check/2026-05-06-task5
```

实际结果：

- `5 / 5 sample-ready`
- `5 / 5 local validation pass`
- `5 / 5 semantic shadow pass`
- 运行产物实际落在：`harness/scripts/runtime/output/topic-script-five-round-quality-check`

注意事项：

- 本次 `--output-dir` 参数未被脚本实际采用，输出落到了默认目录。
- `yanzi-shichu repeat` 与首轮 `yanzi-shichu` 使用同一个样本输出目录，repeat 产物可能覆盖首轮产物；因此 repeat 只能作为 summary 层面的成功样本记录，不能独立抽读首轮差异。

## 5 轮结果表

| sample id | local validation | semantic shadow | script chars | sentence count | 人工观察 | 人工结论 |
| --- | --- | --- | ---: | ---: | --- | --- |
| `yanzi-shichu` | `pass` | `pass` | 320 | 12 | opening 进入楚宫受辱场面，有对话推进；结尾仍有“智慧和尊严 / 自取其辱”的概括感。 | 可用线，接近爆款首稿线但结尾余震偏空。 |
| `zhuanzhu-ciwangliao` | `pass` | `pass` | 173 | 7 | 有鱼腹藏剑和席间刺杀动作，但整体很短，像高密度梗概；结尾是权力格局被颠覆。 | 可用线，不到爆款首稿线。 |
| `julu-zhizhan` | `pass` | `pass` | 209 | 9 | 破釜沉舟动作清楚，有恐惧到决绝的反应；但中后段仍偏概括，结尾“创造军事史奇迹”较泛。 | 可用线，不到爆款首稿线。 |
| `hongmenyan` | `pass` | `pass` | 213 | 8 | 项庄舞剑、范增示意、樊哙闯入具备场面；结尾“一念之差改变历史走向”仍是旧式拔高。 | 可用线，接近爆款首稿线但结尾弱。 |
| `yanzi-shichu repeat` | `pass` | `pass` | 320 | 12 | summary 显示成功；因输出目录覆盖，只能按同目录产物观察。 | 可用线；独立差异不可追溯。 |

## 质量分层结论

当前结论：链路稳定通过，但未达到爆款首稿线。

- `可用线`：达到。5 轮均 local validation pass，semantic shadow 均 pass，未观察到主链路失败。
- `爆款首稿线`：未达到。按人工抽读，不能确认至少 4/5 达到最低爆款首稿线。
- `发布线`：不属于本轮目标，本轮不宣称发布可用。

主要判断依据：

- 3 个样本仍低于 medium 首稿建议体量：`zhuanzhu-ciwangliao=173`、`julu-zhizhan=209`、`hongmenyan=213`。
- 部分 opening 已进入局面，但仍有“你敢相信吗”式泛问起手。
- 多数稿件有动作或场面锚点，但中段推进仍像压缩梗概，压力升级不足。
- 多个 ending 仍以“改变历史走向 / 创造军事史奇迹 / 权力格局被颠覆”收束，余震偏泛。

## 未解决问题

1. `--output-dir` CLI 行为与 README/计划预期不一致，影响质量巡检产物可追溯性。
2. repeat 样本使用相同 `sample_id` 输出目录，导致首轮与 repeat 产物可能互相覆盖。
3. local validator 当前采用“字数和句数都不足才拦截”的保守口径，导致 173 字但 7 句的 medium 稿仍 pass。
4. semantic shadow 对偏摘要稿仍全部判 `pass`，说明 reviewer 量尺偏宽，不能单独作为爆款首稿线判断依据。
5. writer 首稿仍倾向把 strong_scene 压缩成一两句，而不是稳定展开为动作、压力源、即时后果和余震。

## 上游材料归因

整体看，上游材料大多足够支撑可用线：

- `strong_scene` 已能给出核心画面，例如鱼腹藏剑、破釜沉舟、项庄舞剑、楚王连番压场。
- `stakes` 能说明为什么不能轻描淡写。
- `must_include_beats` 基本能被覆盖。
- `source_anchor_refs / canonical_quotes` 能提供有限史料锚点，但不足以保证每条稿件都有准确对话素材。

主要问题更偏 writer 展开密度，而不是 topic 合同完全不足：

- writer 能识别场面，但常把场面压缩成一句结果。
- writer 能覆盖 beats，但未稳定把每个 beat 写成局面升级。
- writer 能写结尾，但常回到抽象历史影响，而不是代价、反讽或判断。

## semantic shadow 异常标签的人工归因

本轮没有 semantic shadow 异常标签：

- `5 / 5 semantic shadow pass`
- 无 `patch_once/lift`
- 无 `regen_once`
- 无 `return_topic`

人工归因：

- reviewer 本轮更像“可用线裁判”，没有稳定识别偏摘要、结尾泛化、爆款首稿线不足。
- 因此不能因为 reviewer 全 pass 就宣称达到爆款首稿线。
- 本轮不为了迎合 reviewer 追加 prompt，也不把 reviewer 输出升级为自动门禁。

## 是否建议进入 patch integration 设计

当前不建议直接进入 patch integration 主路径。

原因：

- 首稿基础表达仍未稳定达到爆款首稿线，优先级仍应放在 writer 首稿密度、validator 结构下限口径和质量观测可追溯性。
- patch integration 应另写独立设计计划，并继续保持 `patch_once/lift` 不自动改 topic 合同。
- 本轮明确不接入 patch / regen 主链路。

建议后续优先事项：

1. 修正 5 轮巡检 `--output-dir` 与 repeat 输出目录可追溯性。
2. 复核 local validator 对 medium 稿的结构下限口径，尤其是 173 字但 7 句仍 pass 的情况。
3. 继续小步强化 writer 对 beat 展开、动作/压力/结果、结尾余震的生成意图。
4. 如后续仍需要 patch integration，先写独立 design + implementation plan，再执行。
