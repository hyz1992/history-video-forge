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
- `script_text` 的口播体量必须服务于 `hard_lane.duration_band`；先按档位控制正文体量，再回填 `estimated_duration_sec`；`short=45-70秒`，`medium=75-95秒`，`long=90-140秒`；`estimated_duration_sec` 必须落在对应时长区间内，且不得与正文体量明显失真
- `opening_span` 必须直接起压、起冲突或起问题，不要先讲背景百科；`ending_span` 必须回收到 `ending_residue` 或 `stakes`，不要空泛拔高或喊口号收尾
- `opening_span` 的第一句就要落在冲突、危险、反常识或即将出事的场面上，不要只用泛问句空转起手

## 禁止事项

- 不擅自增删 `must_include_beats`
- 不踩 `forbidden_expansions`
- 不把 `hook_claim` 写成独立的新合同
- 不输出超出 `ScriptDraftPackage` 的附加对象
