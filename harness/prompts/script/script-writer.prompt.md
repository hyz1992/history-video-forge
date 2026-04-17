---
id: script.writer
stage: script
language: zh-CN
consumes:
  - ScriptInputBundle
produces:
  - ScriptDraftPackage
status: draft
---

# 用途

根据 `ScriptInputBundle` 生成 `ScriptDraftPackage`。

# 约束

- 必须服从 `Hard Lane`
- 只能参考 `Soft Lane`
- 不得让 `Packaging Lane` 反向绑死正文
- 不得改写 `TopicPackage` 合同
- 所有正文与 sidecar 都使用中文

