# 项目生命周期设计（第一版）

本文档回答：

- 一个 `project` 从创建到当前已设计阶段，应该有哪些状态
- 哪些状态转移是合法的
- `return_topic` 发生后项目如何回退

## 1. 设计原则

1. 生命周期状态只覆盖当前已确认阶段。
2. 不复刻旧项目的重型多阶段状态机。
3. 状态名优先表达“当前是否可进入下一阶段”，而不是记录所有内部细碎子步骤。
4. topic/script 阶段的内部执行细节用任务事件流表达，不全部写进项目主状态。

## 2. 当前建议的项目主状态

### `created`
- 项目已创建，但还未开始正式选题

### `topic_selecting`
- 用户正在系统推荐 / 事件库 / 自定义输入中挑选候选题

### `script_ready`
- 已冻结 `Topic Package`
- 允许进入 script 阶段

### `script_generating`
- script 阶段正在运行

### `script_completed`
- 当前 active script 已确认完成

### `topic_returned`
- script 阶段判定必须退回 topic 重新确认

### `failed`
- 当前阶段经过有限修补后仍失败

## 3. 当前合法状态转移

```text
created -> topic_selecting
topic_selecting -> script_ready
script_ready -> script_generating
script_generating -> script_completed
script_generating -> topic_returned
script_generating -> failed
topic_returned -> topic_selecting
failed -> topic_selecting
failed -> script_ready
```

## 4. `return_topic` 的含义

`return_topic` 不等于普通脚本失败。

它只在这些情况使用：
- `Topic Package` 的硬边界自相矛盾
- `scope` 明显装不下 `must_include_beats`
- `selected_angle` 与 `forbidden_expansions` 或 `source anchors` 明显冲突

它不应用于：
- 开头不够抓
- 口播不自然
- 结尾过火

这些应该在 script 阶段内部 patch / regenerate 解决。

## 5. 任务事件流 vs 项目主状态

项目主状态只表达“项目当前在哪个大阶段”。

更细的执行事件，例如：
- `topic_candidates_ready`
- `script_patch_started`
- `script_local_validation_failed`

应通过：
- SSE 事件流
- 或任务日志

来表达，而不是都塞进 `projects.current_status`。

## 6. 当前不提前承诺的生命周期

以下阶段状态等后续架构确认后再补：
- storyboard
- asset planning
- assets
- compose
