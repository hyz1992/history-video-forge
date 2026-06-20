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

## 6. 已实现的完整生命周期

以下阶段状态均已在 Prisma schema、前端 stores 和后端 routes 中实现。

### 6.1 完整状态转移

```text
# topic / script 主路径（第一阶段）
created -> topic_selecting
topic_selecting -> script_ready
script_ready -> script_generating
script_generating -> script_completed
script_generating -> topic_returned
script_generating -> failed
topic_returned -> topic_selecting
failed -> topic_selecting
failed -> script_ready

# downstream 主路径（第二阶段）
script_completed -> storyboard_ready
storyboard_ready -> storyboard_generating
storyboard_generating -> storyboard_completed
storyboard_generating -> failed
storyboard_completed -> asset_plan_ready
asset_plan_ready -> asset_plan_generating
asset_plan_generating -> asset_plan_completed
asset_plan_completed -> assets_ready
assets_ready -> assets_generating
assets_generating -> assets_ready        # 循环直到完成
assets_generating -> assets_blocked     # 上游变更
assets_blocked -> assets_ready          # 重新就绪
assets_ready -> compose_ready
compose_ready -> compose_blocked       # 上游变更
compose_blocked -> compose_ready       # 重新就绪
compose_ready -> render_ready
render_ready -> render_blocked / render_failed  # 渲染阻塞/失败
render_blocked -> render_ready
render_ready -> published
```

### 6.2 阶段状态

| 状态 | 含义 |
|---|---|
| `storyboard_ready` | 已冻结 script，允许进入分镜规划 |
| `storyboard_generating` | 分镜规划正在运行 |
| `storyboard_completed` | 分镜规划已确认完成 |
| `asset_plan_ready` | 已冻结 storyboard，允许进入素材计划 |
| `asset_plan_generating` | 素材计划正在运行 |
| `asset_plan_completed` | 素材计划已确认完成 |
| `assets_ready` | 已冻结 asset plan，允许进入素材生成 |
| `assets_generating` | 素材生成正在运行 |
| `assets_blocked` | 素材生成被阻塞（如上游变更） |
| `compose_ready` | 已冻结 assets，允许进入时间轴合成 |
| `compose_blocked` | 时间轴合成被阻塞 |
| `render_ready` | 已冻结 compose，允许进入渲染导出 |
| `render_blocked` / `render_failed` | 渲染被阻塞或失败 |
| `published` | 发布包已生成 |
