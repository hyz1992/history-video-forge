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
- `beat_trace.excerpt` 必须从 `script_text` 中截取能证明该 beat 已写到的完整短句，不少于 8 个汉字等价长度；不得只填 beat 名称、序号或概括标签
- `script_text` 的口播体量必须服务于 `hard_lane.duration_band`；先按档位控制正文体量，再回填 `estimated_duration_sec`；`short=45-70秒`，`medium=75-95秒`，`long=90-140秒`；`estimated_duration_sec` 必须落在对应时长区间内，且不得与正文体量明显失真
- `medium` 首稿正文至少约 240 个汉字等价长度；85 秒稿不能只有 190-200 字；只能用场景、动作、对话或转述、压力升级、即时后果补足体量，不得为了凑字数重复解释、空泛评价或喊口号
- 先单独确定一个可独立成立的 `opening_span`，再让 `script_text` 以 `opening_span` 原文起手顺势展开；`opening_span` 优先从 `soft_lane.strong_scene` 的具体场面、动作或危险局面起手，第一句就要落在冲突、危险、反常识或即将出事的局面上；`hook_claim` 只是包装 promise 弱参考，如需借用，必须还原成具体场面，不能机械复述或照搬，禁止默认使用统一挑战句模板；`ending_span` 必须回收到 `ending_residue` 或 `stakes`，不要空泛拔高或喊口号收尾
- `ending_span` 必须落在代价、反讽、未平后果或场景内判断上；不要默认写成改变历史、成为典范、留名史册式空泛收尾
- 首稿是可口播的历史故事草稿，不能写成摘要稿；每个 `must_include_beats` 要写成局面推进，而不是只点名；至少一个核心场面包含人物、动作、压力源、即时后果；如用问句开头，问句后必须进入具体场面；结尾要留下代价、反讽或判断，不要只做空泛拔高
- 每条 `must_include_beats` 至少展开成一个叙事单元，不能只用一句话点名后立刻跳到下一条 beat；展开时优先写人物动作、对方反应、场面压力、即时后果，三条 beat 不能压缩成列表式交代
- 如输入包含 `regeneration_context`，只用它修正上一稿的结构下限问题，正文不得低于 `min_script_chars_for_band` 与 `min_sentence_count_for_band`，且不得改写 `TopicPackage`；如 `regeneration_context` 指出 `script_body_too_thin`，必须沿用既有 `must_include_beats` 扩写，新增场景动作、对方反应、压力后果，不能只刚刚贴线，要明显高于 `min_script_chars_for_band`；每条 beat 至少补足一个动作、一个反应、一个后果；若 `quote_trace` 为空或材料像事件骨架，每条 beat 围绕原事实补一个动作前一拍、一个即时反应、一个后果句；不得新增人物、事件、结局或改写因果；可以补原场景内不改变事实的动作、反应、停顿、目光、场面压力；不得只重排、改写或缩短上一稿，也不得写成比上一稿稍长一点的压缩摘要

## 禁止事项

- 不擅自增删 `must_include_beats`
- 不踩 `forbidden_expansions`
- 不把 `hook_claim` 写成独立的新合同
- 不输出超出 `ScriptDraftPackage` 的附加对象
