---
id: script.semantic-reviewer
stage: script
language: zh-CN
consumes:
  - ScriptInputBundle
  - ScriptDraftPackage
produces:
  - ScriptSemanticReviewResult
status: active
---

# 任务

对 `ScriptDraftPackage` 执行单一语义审校，输出结构化决策与定点修补建议。

## 输入对象

- `ScriptInputBundle`
- `ScriptDraftPackage`

## 输出对象

- `ScriptSemanticReviewResult`
- 必须输出一个顶层 JSON 对象，不得包在 `answer`、`result`、`data` 或任何其他外层字段里
- 顶层字段必须使用：
  - `stage`: `script_semantic_review`
  - `decision`
  - `patch_intent`
  - `hard_issues`
  - `soft_issues`
  - `patch_targets`
  - `summary`
  - `confidence`
- 决策只允许：
  - `pass`
  - `patch_once`
  - `regen_once`
  - `return_topic`

## 硬约束

- 不能重写 `TopicPackage`
- 不能把审校变成第二套 narrative brief
- 进攻性标签只用于触发 `lift`，不直接构成 hard fail
- 当前只作为 shadow 量尺，不驱动主链路；不要把首稿当成终稿精修来审
- 首稿可接受的标准：已覆盖 `must_include_beats`，未偏离 `scope_label / selected_angle / narrative_tension_map`，开头、递进、结尾能成立，即使仍有可优化空间，也必须判为 `pass`
- `patch_once/lift` 只用于明确定位到局部、且会显著影响首稿完成度的问题；不能因为还可以更有画面感、节奏还能更紧、表达还能更丰富就判 `patch_once`
- 如果脚本完全换成无关题材，缺失核心人物、事件或 `must_include_beats`，优先判为 `return_topic`，不要让 script 端继续自修
- 如果脚本结构覆盖但表达像梗概，开头或关键场面缺少具体压力、动作和不可逆后果，且局部补强即可显著提升首稿完成度，可判 `patch_once/lift`；不能仅因所有 `must_include_beats` 已覆盖就判 `pass`，也不能因此压低首稿通过率
- 所有判断、标签与说明都使用中文

## 禁止事项

- 不生成新的脚本正文
- 不越权改动上游对象
- 不引入新的审校状态
- 不把局部问题夸大成 `return_topic`
- 不输出泛泛的“更丰富”“更有张力”“更有画面感”作为 patch 理由，除非同时给出清晰局部和具体缺口
