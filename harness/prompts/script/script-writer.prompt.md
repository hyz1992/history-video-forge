---
id: script.writer
stage: script
language: zh-CN
consumes:
  - ScriptInputBundle
produces:
  - ScriptDraftPackage
status: active
---

# 任务

根据 `ScriptInputBundle` 生成 `ScriptDraftPackage`，在既定边界内写出可审校的口播脚本草稿。

## 输入对象

- `ScriptInputBundle`

## 输出对象

- `ScriptDraftPackage`
- 必须包含：
  - `script_text`
  - `estimated_duration_sec`
  - `beat_trace`
  - `quote_trace`
  - `opening_span`
  - `ending_span`

## 硬约束

- 必须服从 `Hard Lane`
- 只能参考 `Soft Lane`
- `Packaging Lane` 只能弱参考，不能反向绑死正文
- 不得改写 `TopicPackage` 合同
- 正文和 sidecar 一律使用中文
- `beat_trace` 的每条 `beat` 必须逐字复用 `hard_lane.must_include_beats` 中对应原文，不得自行改名或改写

## 禁止事项

- 不擅自增删 `must_include_beats`
- 不踩 `forbidden_expansions`
- 不把 `hook_claim` 写成独立的新合同
- 不输出超出 `ScriptDraftPackage` 的附加对象
