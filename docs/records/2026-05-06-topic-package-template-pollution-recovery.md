# Topic Package Template Pollution Recovery

日期：2026-05-06

## 背景

5 轮 topic -> script 抽检显示，首稿链路稳定，但 `TopicPackage.narrative_tension_map` 与 `must_include_beats` 仍会把跨题材模板句带入 script：

- `公开压场`
- `局势先被对方抢走`
- `必须把这口气当场顶回去`
- `这类场面一旦退掉`

本轮修复只处理 TopicPackage 合同生成源头，不改 script writer、不改 semantic reviewer、不让 patch 进入主路径。

## 改动

`topic-confirm.service` 不再用固定模板拼接 `pressure_escalation / mid_reveal / ending_residue / must_include_beats`，改为复用候选自身字段：

- `coreConflict`
- `strongScene`
- `oneLineAngle`

这样 TopicPackage 仍保持结构完整，但不再向下游注入跨题材包装句。

## 验证

### 单元与回归

- `tests/backend/topic/topic-confirm.service.test.ts`：2 / 2 通过。
- 相关 topic/script 串行回归：24 / 24 通过。

### 5 轮真实 topic -> script

命令输出目录：`harness/scripts/runtime/output/topic-script-five-round-quality-check-after-template-fix-2026-05-06`

- live check：5 / 5 通过。
- 本地硬校验：5 / 5 `pass`。
- TopicPackage 模板污染命中：0。
- Script 正文模板污染命中：0。
- semantic shadow：
  - `pass`：4
  - `patch_once/lift`：1
  - `return_topic`：0
  - `regen_once`：0

| Round | Sample | Local | Semantic | Template Hits | Opening |
| --- | --- | --- | --- | --- | --- |
| `round-1-yanzi` | `yanzi-shichu` | `pass` | `pass` | 0 | 面对楚王的当众羞辱，晏子不能退。 |
| `round-2-zhuanzhu` | `zhuanzhu-ciwangliao` | `pass` | `pass` | 0 | 宴席之上，吴王僚正与群臣欢饮，全然不知危险已悄然逼近。 |
| `round-3-julu` | `julu-zhizhan` | `pass` | `patch_once/lift` | 0 | 项羽如何用一场豪赌，逼出楚军的全部潜能？ |
| `round-4-hongmenyan` | `hongmenyan` | `pass` | `pass` | 0 | 项庄拔剑起舞，剑锋一次次擦向刘邦。 |
| `round-5-yanzi-repeat` | `yanzi-shichu` | `pass` | `pass` | 0 | 楚王当众羞辱，晏子不能退。 |

## 结论

模板污染已从 TopicPackage 和 script 正文中清零。当前剩余的 `patch_once/lift` 来自 `julu-zhizhan` 场景细节不足，不是上游模板污染。

下一步如果继续提升首稿质量，应单独处理“战场翻盘类强场面细节不足”，不要再用模板句或 reviewer 驱动主链路来补。
