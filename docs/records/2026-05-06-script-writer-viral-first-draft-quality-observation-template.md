# Script Writer Viral First-draft Quality Observation Template

日期：2026-05-06

## 定位

本记录模板用于 Task 5 的真实 5 轮 topic -> script 首稿质量巡检。

它只服务人工观察与归因：

- 不作为自动门禁。
- 不接入 patch / regen 主链路。
- 不替代 local validation。
- 不把 semantic reviewer shadow 输出升级为主链路动作。
- 不把单次真实模型波动当作质量结论。

## 运行入口

```powershell
npm run harness:topic-script-five-round-quality-check -- --output-dir harness/scripts/runtime/output/script-writer-quality-check/<run-id>
```

## 记录字段

| 字段 | 记录口径 |
| --- | --- |
| sample id | 固定样本 id，例如 `yanzi-shichu`、`zhuanzhu-ciwangliao`、`julu-zhizhan`、`hongmenyan`、`yanzi-shichu repeat` |
| local validation | `validation-result.json` 中的 `decision / errors / warnings / metrics` |
| semantic shadow | `semantic-review-result.json` 中的 shadow-only `decision / patch_intent / issues / summary` |
| script chars | `script_text` 字数；优先记录 local validation metrics 中的 `script_char_count` |
| opening | 抄录或概括前 1-2 句，判断是否进入具体局面 |
| 是否摘要感明显 | 人工判断是否像资料摘要、梗概或课堂导入 |
| 核心场面是否有动作/压力/结果 | 人工判断至少一个核心场面是否出现动作、压力源与即时后果 |
| 是否有对话或可识别转述 | 记录准确引用、可识别转述，或说明上游无足够对话材料 |
| ending 是否有余震 | 判断结尾是否回到代价、反讽、判断或人性洞察 |
| upstream_material_sufficiency | 记录 `strong_scene / stakes / must_include_beats / source_anchor_refs / canonical_quotes` 是否足够支撑展开 |
| reviewer_variance_note | 如 semantic shadow 出现 `patch_once/lift / regen_once / return_topic`，记录人工归因，不当作硬门禁 |
| 人工结论 | `可用线 / 爆款首稿线 / 不合格`，并写一句理由 |

## 观测表

| sample id | local validation | semantic shadow | script chars | opening | 是否摘要感明显 | 核心场面是否有动作/压力/结果 | 是否有对话或可识别转述 | ending 是否有余震 | upstream_material_sufficiency | reviewer_variance_note | 人工结论 |
| --- | --- | --- | ---: | --- | --- | --- | --- | --- | --- | --- | --- |
| `yanzi-shichu` | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 | `strong_scene`: 待填；`stakes`: 待填；`must_include_beats`: 待填；`source_anchor_refs`: 待填；`canonical_quotes`: 待填 | 待填 | 待填 |
| `zhuanzhu-ciwangliao` | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 | `strong_scene`: 待填；`stakes`: 待填；`must_include_beats`: 待填；`source_anchor_refs`: 待填；`canonical_quotes`: 待填 | 待填 | 待填 |
| `julu-zhizhan` | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 | `strong_scene`: 待填；`stakes`: 待填；`must_include_beats`: 待填；`source_anchor_refs`: 待填；`canonical_quotes`: 待填 | 待填 | 待填 |
| `hongmenyan` | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 | `strong_scene`: 待填；`stakes`: 待填；`must_include_beats`: 待填；`source_anchor_refs`: 待填；`canonical_quotes`: 待填 | 待填 | 待填 |
| `yanzi-shichu repeat` | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 | `strong_scene`: 待填；`stakes`: 待填；`must_include_beats`: 待填；`source_anchor_refs`: 待填；`canonical_quotes`: 待填 | 待填 | 待填 |

## reviewer_variance_note 口径

- `pass`：只说明 shadow reviewer 没发现明显问题，不等同发布线。
- `patch_once/lift`：记录具体区域和问题，先人工判断是 writer 细节密度不足、上游材料不足，还是 reviewer 波动。
- `regen_once`：先复核是否真的全局偏摘要、偏题、口播不成立；不得为了迎合单次 reviewer 输出继续堆 prompt。
- `return_topic`：只在 topic 合同冲突时成立；若只是开头弱、节奏平、口播别扭、结尾弱，应归为 script 表达问题或 reviewer 波动。

## 人工结论口径

- `可用线`：本地校验通过，beats 覆盖，无模板污染，无明显跑题。
- `爆款首稿线`：在可用线之上，opening 进入局面，至少一个核心场面有动作/压力/结果，正文不是摘要体量，结尾有代价、反讽或判断。
- `不合格`：本地校验失败，或虽通过但明显摘要化、跑题、越界、缺关键 beat。
