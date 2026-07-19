# Script Writer Duration Pacing Scene Density Design

## 任务

对 script writer 做最后一轮小范围收口，重点处理首稿体量、估时、节奏推进和强场面密度的结构性下限。

## 目标

- 让 `script_text` 的正文体量更接近 `estimated_duration_sec`，避免 330-350 字标 85-90 秒的虚高估时。
- 让 writer 明确按口播正文体量回填估时，而不是先固定写 85 秒。
- 让正文中段保持动作、反应、局势变化或即时后果的推进密度。
- 让每条 `must_include_beats` 更稳定地展开成可见场面，而不是一两句压缩摘要。
- 只增加结构性 validator 下限，不用本地规则判断“是否爆款”。

## 非目标

- 不新增 storyboard、asset planning、assets、compose 或任何 downstream 对象。
- 不把 semantic reviewer 接入主链路门禁。
- 不做多稿竞赛、多头审校或无限 retry。
- 不用关键词黑名单、本地语义打分或字符串规则冒充“强场面”判断。
- 不重写 `TopicPackage`、`ScriptInputBundle` 或共享 schema。

## 当前问题

2026-05-09 selector/ranker 五轮 live 后，script 链路已经稳定通过，但仍有三个可见问题：

- `script_text` 常在 330-430 字，而 `estimated_duration_sec` 常标 82-88 秒，估时偏虚。
- 部分稿子中段是顺滑摘要，动作和反应有，但密度不稳定。
- `beat_trace.excerpt` 只要求 8 字，能证明覆盖，却不能推动 writer 给出更完整的叙事单元。

这些问题会在 storyboard 阶段放大：分镜会被迫替 script 补节奏点和画面点。因此进入 downstream 前，script 应先达到“首稿可用冻结”的结构下限。

## 方案

### 1. Prompt 收口

在 `prompts/script/script-writer.prompt.md` 中合并增加三类短约束：

- `medium` 正文优先写到约 330-450 个汉字等价长度；如果正文只有 320-360 字，估时应更保守，不能硬标 85-90 秒。
- `estimated_duration_sec` 必须根据最终正文体量回填，按约 3.6-4.6 个汉字等价长度/秒估算。
- 正文每 2-3 句必须出现新的动作、对方反应、场面压力变化或即时后果；每条 beat 至少写出一个可见动作和一个反应或后果。

这不是新增风格层，而是把已有“体量、节奏、场面”规则收紧成更可执行的写作约束。

### 2. Validator 结构下限

在 `script-local-validator` 中只增加结构性检查：

- 调高 duration band 的正文/句子下限：
  - `short`: 180 字 / 6 句
  - `medium`: 320 字 / 8 句
  - `long`: 420 字 / 10 句
- 增加 `duration_body_mismatch`：
  - 当 `estimated_duration_sec` 与正文体量明显失真时触发 `regen_once`。
  - 初始阈值使用 `script_char_count / estimated_duration_sec < 3.6`。
  - 该规则只防“明显虚高估时”，不判断文采。
- 增加 `beat_trace_excerpt_not_in_script`：
  - `beat_trace.excerpt` 必须能在 `script_text` 中找到。
  - 防止 sidecar 审计字段和正文脱节。
- 将 beat excerpt 弱命中下限从 8 字提高到 14 字，仍只是结构下限。

### 3. 文档同步

同步更新 `docs/architecture/script-validation-spec.md` 与 `docs/architecture/script-stage-design.md` 的 validator 口径，避免实现与阶段文档脱节。

## 风险

- 字数下限过高会让 writer 为凑体量而重复解释。prompt 必须明确只能用动作、反应、压力升级和即时后果补足体量。
- `duration_body_mismatch` 是启发式结构检查，不等于真实语速估计。阈值要保守，只抓明显虚高。
- live 结果可能变慢，因为 writer 需要输出更完整正文。

## 验证

- Prompt runtime 测试确认 writer prompt 包含体量、估时、节奏、场面密度约束。
- Local validator 测试确认：
  - medium 300 字 / 85 秒触发 `script_body_too_thin` 或 `duration_body_mismatch`。
  - 330 字 / 95 秒触发 `duration_body_mismatch`。
  - beat excerpt 不在正文中触发 `beat_trace_excerpt_not_in_script`。
  - 结构完整、体量合理的稿子继续 pass。
- Prompt language 测试继续通过。
- 至少跑 script local validator 与 prompt runtime 相关测试；如时间允许，跑一轮真实 5 轮 live check 观察质量。
