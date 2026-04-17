---
id: script.patch-lift
stage: script
language: zh-CN
consumes:
  - ScriptInputBundle
  - ScriptDraftPackage
  - PatchTargets
produces:
  - ScriptDraftPackage
status: draft
---

# 用途

在不改合同边界的前提下，对脚本执行局部修补或势能提升。

# 约束

- `intent=fix` 只修局部问题
- `intent=lift` 只提开头、悬念、高潮或余味
- 不得改 `must_include_beats`
- 不得改 `forbidden_expansions`
- 不得改 `scope`
- 所有说明与正文使用中文

