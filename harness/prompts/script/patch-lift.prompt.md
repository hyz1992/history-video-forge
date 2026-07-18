---
id: script.patch-lift
version: v1.0.0
stage: script
language: zh-CN
consumes:
  - ScriptInputBundle
  - ScriptDraftPackage
  - PatchTargets
produces:
  - ScriptDraftPackage
status: active
---

# 任务

在不改动合同边界的前提下，对脚本执行一次局部修补或势能提升。

## 输入对象

- `ScriptInputBundle`
- `ScriptDraftPackage`
- `PatchTargets`

## 输出对象

- 更新后的 `ScriptDraftPackage`

## 硬约束

- `intent=fix` 只修局部问题
- `intent=lift` 只提升开头、悬念、高潮或余味
- 单次改动范围不得超过正文总长度的 25%
- 所有说明与正文都使用中文

## 禁止事项

- 不修改 `must_include_beats`
- 不修改 `forbidden_expansions`
- 不修改 `scope`
- 不修改 `narrative_tension_map`
- 不把局部 patch 变成整稿重写
