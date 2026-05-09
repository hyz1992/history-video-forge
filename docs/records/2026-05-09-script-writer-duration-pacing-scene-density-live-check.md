# 2026-05-09 script writer 体量、节奏与场面密度 live check

## 背景

- 本轮目标：验证 `script.writer` 的正文体量、估时一致性、节奏推进和 beat 场面展开约束是否提升首稿质量。
- 运行配置：
  - `LLM_STRUCTURED_MODEL=glm-4`
  - writer 使用当前主配置
  - `LLM_TIMEOUT_MS=240000`
- 输出目录：`harness/scripts/runtime/output/2026-05-09-script-writer-duration-pacing-scene-density-five-round`
- 对比基线：`harness/scripts/runtime/output/2026-05-09-topic-selector-quality-ranker-five-round-retry2`

## 本轮结果

| 指标 | 本轮 |
| --- | --- |
| 样本数 | 5 |
| sample-ready | 5/5 |
| local validation pass | 5/5 |
| semantic shadow pass | 5/5 |
| semantic attention | 0/5 |
| regen-once | 3/5 |
| 平均正文长度 | 392.4 |
| 最短正文长度 | 374 |
| 最长正文长度 | 412 |
| 平均句数 | 13 |
| 平均估时 | 86.2 秒 |
| 平均字/秒 | 4.55 |
| 平均总耗时 | 150.6 秒 |

## 对比基线

| 指标 | selector 后基线 | 本轮 | 观察 |
| --- | ---: | ---: | --- |
| sample-ready | 5/5 | 5/5 | 稳定 |
| local validation pass | 5/5 | 5/5 | 稳定 |
| semantic shadow pass | 5/5 | 5/5 | 稳定 |
| semantic soft issue 样本 | 5/5 | 3/5 | 有改善 |
| regen-once | 0/5 | 3/5 | 成本明显上升 |
| 平均正文长度 | 378.6 | 392.4 | 小幅提升 |
| 最短正文长度 | 331 | 374 | 明显改善 |
| 平均句数 | 12 | 13 | 小幅提升 |
| 平均估时 | 85.6 秒 | 86.2 秒 | 基本持平 |
| 平均字/秒 | 4.43 | 4.55 | 更匹配口播估时 |
| 平均总耗时 | 97.9 秒 | 150.6 秒 | 明显变慢 |

## 样本观察

### `hongmenyan`

- 本地校验：`pass`
- semantic shadow：`pass`
- 正文：412 字，14 句，87 秒，4.74 字/秒
- 触发 `regen-once`
- soft issue：开头可以更精炼，减少对结果的直接描述，增加场景氛围。
- 观察：开头从旧版“项羽为何放走刘邦”的解释式疑问，变成“酒杯一摔、伏兵尽出、范增举玦”的现场压力，强场面更清楚。

### `julu-zhizhan`

- 本地校验：`pass`
- semantic shadow：`pass`
- 正文：374 字，11 句，83 秒，4.51 字/秒
- 未触发 `regen-once`
- soft issue：开头可更简洁，中段战斗细节可增强，结尾可更精炼。
- 观察：仍是本轮相对偏弱样本；问题不是合同失败，而是强场面密度和表达锋利度还可继续打磨。

### `yanzi-shichu`

- 本地校验：`pass`
- semantic shadow：`pass`
- 正文：410 字，15 句，85 秒，4.82 字/秒
- 触发 `regen-once`
- soft issue：无
- 观察：狗门、哄笑、正门、大殿二次挑衅都落成了可视化场景，是本轮较强样本。

### `yanzi-shichu-repeat-2`

- 本地校验：`pass`
- semantic shadow：`pass`
- 正文：374 字，12 句，88 秒，4.25 字/秒
- 未触发 `regen-once`
- soft issue：开头细节、对话细节可增强。
- 观察：通过但略偏紧，仍能看出 prompt 对体量下限的牵引。

### `zhuanzhu-ciwangliao`

- 本地校验：`pass`
- semantic shadow：`pass`
- 正文：392 字，13 句，88 秒，4.45 字/秒
- 触发 `regen-once`
- soft issue：无
- 观察：开头动作、道具、死局和结尾血债余震都比较到位。

## 结论

本轮优化是可行的：它没有破坏 topic -> script 链路，通过率和 semantic shadow 都保持稳定，同时把最短稿体量从 331 拉到 374，减少了明显偏薄稿和 reviewer soft issue。

但性价比不是纯正向：`regen-once` 从 0/5 升到 3/5，平均总耗时从约 98 秒升到约 151 秒。主要成本不是本地 validator，而是首稿没有一次命中新下限后触发第二次 writer 调用。

## 建议

- 可以保留本轮优化，因为它提升的是 script 首稿最短板：体量、估时匹配和场面密度。
- 不建议继续在 script 阶段堆更多语义规则或 reviewer 门禁；边际收益会下降，且更容易拖慢。
- 如果还要做一个小收口，优先降低 `regen-once` 触发率：继续压实 writer 首稿体量指令，而不是放松 validator。
- 从阶段推进角度看，`script` 可以进入“阶段性可用并观察”的状态；下一步更高性价比是设计 `script -> storyboard planning` 的合同，而不是继续在 script 内部做大改。
