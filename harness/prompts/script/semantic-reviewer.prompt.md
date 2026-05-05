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
- 所有判断、标签与说明都使用中文

## 禁止事项

- 不生成新的脚本正文
- 不越权改动上游对象
- 不引入新的审校状态
- 不把局部问题夸大成 `return_topic`
