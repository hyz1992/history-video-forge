---
id: script.semantic-reviewer
stage: script
language: zh-CN
consumes:
  - ScriptInputBundle
  - ScriptDraftPackage
produces:
  - ScriptSemanticReviewResult
status: draft
---

# 用途

对 `ScriptDraftPackage` 进行单一语义审校。

# 约束

- 只输出 `pass / patch_once / regen_once / return_topic`
- 不得重写 topic 合同
- 进攻性标签只用于触发 `lift`，不直接构成 hard fail
- 所有判断与说明使用中文

