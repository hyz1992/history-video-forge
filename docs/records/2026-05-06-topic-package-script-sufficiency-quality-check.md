# TopicPackage 脚本材料充足度五轮复测记录

## 运行信息

- 日期：2026-05-06
- run id：`2026-05-06-topic-package-script-sufficiency-quality-check`
- 命令：

```powershell
npm run harness:topic-script-five-round-quality-check -- --output-dir harness/scripts/runtime/output/2026-05-06-topic-package-script-sufficiency-quality-check
```

- 输出目录：`harness/scripts/runtime/output/2026-05-06-topic-package-script-sufficiency-quality-check`
- summary：`harness/scripts/runtime/output/2026-05-06-topic-package-script-sufficiency-quality-check/live-check-summary.json`

## 总体统计

- total samples：5
- sample-ready：5 / 5
- failed samples：0 / 5
- local validation pass：5 / 5
- local validation fail：0 / 5
- local validation unknown：0 / 5
- semantic shadow pass：5 / 5
- semantic shadow skipped：0 / 5
- semantic shadow attention：0 / 5
- semantic shadow unknown：0 / 5

TopicPackage sufficiency：

- ok：0 / 5
- observe：0 / 5
- needs_attention：5 / 5
- unknown：0 / 5

## 样本结果

| sample | script chars | local | semantic shadow | topic sufficiency | warnings |
| --- | ---: | --- | --- | --- | --- |
| `yanzi-shichu` | 361 | pass | pass | needs_attention | `tension_map_repetition_risk`, `must_include_beats_material_risk` |
| `zhuanzhu-ciwangliao` | 241 | pass | pass | needs_attention | `tension_map_repetition_risk`, `must_include_beats_material_risk` |
| `julu-zhizhan` | 244 | pass | pass | needs_attention | `tension_map_repetition_risk`, `must_include_beats_material_risk` |
| `hongmenyan` | 249 | pass | pass | needs_attention | `tension_map_repetition_risk`, `must_include_beats_material_risk` |
| `yanzi-shichu-repeat-2` | 261 | pass | pass | needs_attention | `tension_map_repetition_risk`, `must_include_beats_material_risk` |

## 观察

1. 本轮没有出现 `script_body_too_thin`。
2. `zhuanzhu-ciwangliao` 从此前 175 字且 local validation fail，提升到 241 字且 local validation pass。
3. semantic reviewer shadow 本轮 5 / 5 pass，没有 `patch_once/lift`、`skipped` 或 attention。
4. topic sufficiency 仍是 5 / 5 `needs_attention`，说明上游材料充足度还没有真正达标。
5. 每轮 `topic-candidates.json` 中首选候选的 `must_cover_preview` 仍为空数组，导致 confirm 阶段实际仍回退到 `core_conflict`、`strong_scene`、`selected_angle` 三句。
6. 每轮 `narrative_tension_map` 仍存在重复：`mid_reveal` 与 `peak_payoff` 重复，`ending_residue` 与 `pressure_escalation` 重复。

## 审慎结论

本轮 script 结果有明显改善：五轮全部 sample-ready、local pass、semantic pass，且没有短稿硬失败。

但这不能说明上游 topic 质量已经解决。`TopicPackage` sufficiency 仍全量报警，核心原因是当前固定样本链路里 `must_cover_preview` 没有进入候选结果，confirm 仍只能使用基础三句构建脚本合同。

因此，当前真实状态应判断为：

- script writer 首稿稳定性比上一轮更好。
- `zhuanzhu` 短稿问题在本轮没有复现。
- 上游 topic script-sufficiency 尚未达标。
- 下一步应聚焦候选生成/归一化/确认链路中 `must_cover_preview` 为空的问题，而不是继续单纯调 writer。

## 剩余风险

- topic sufficiency analyzer 是结构观察器，不判断“是否爆款”。
- 5 / 5 semantic pass 仍不等于发布线；发布线仍需要事实核查、人工审稿和口播打磨。
- 如果后续真实候选仍产出空 `must_cover_preview`，script writer 仍可能在更难样本上退回结构摘要或短稿。

## 下一步建议

1. 追查 `must_cover_preview` 在真实 topic candidate 输出中为空的原因。
2. 判断是 prompt 未被模型遵守、repair/normalization 清空字段，还是固定 sample runtime 没有携带该字段。
3. 先用一个低耦合 Task 固化 `must_cover_preview` 不得为空的结构下限或 repair 行为，再跑五轮复测。
