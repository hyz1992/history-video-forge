# Runtime Orchestration Design

适用范围：`story-video-forge2` 第二阶段 `topic + script` 正式主链路。

## 目标

本设计文档用于冻结 backend runtime orchestration 的节点边界、状态边界与后续 LangGraph 接入闸门。

它服务三个目的：

- 让 `Task 3` 与 `Task 4` 在实现真实 runtime 主链路时，先按统一节点边界收口
- 防止 prompt registry / provider adapter / frontend 各自发明新的 orchestration 层
- 为 `Task 4` 之后是否正式接入 LangGraph 提供单一决策依据

## 当前边界

LangGraph 当前只作为 **backend runtime orchestration** 候选方向。

当前明确不属于 LangGraph 范围的层：

- `harness/prompts/` 下的 prompt registry / loader
- provider adapter
- external error / retry / structured-output-fix 基础设施
- frontend 页面状态与交互
- harness trace / diagnostics 表现层

## 当前计划中的 graph 节点边界

若后续正式接入 LangGraph，节点边界以当前第二阶段主链路为准：

- `topic-candidate-generate`
- `script-generate`
- `semantic-review`
- `patch-once`
- `regen-once`

这些节点只负责：

- 接收上游冻结对象
- 调用正式 runtime prompt / provider
- 产出下游冻结对象或明确错误

这些节点不负责：

- 发明新阶段对象
- 恢复旧项目重 `workflow-state`
- 让 patch / regen 演变成多轮无限重试

## 状态边界

当前不引入旧项目重状态机。

第二阶段只保留轻量状态穿透：

- 当前节点名称
- 当前输入对象
- 当前输出对象
- 当前失败原因

不保留旧项目那种：

- 大而全 workflow state
- 旧 narrative quality analysis 语义
- 多分支并行赛稿状态

## 消费时机

### 在 `Task 2A` 中

本文件在 `Task 2A / Step 4` 创建，用来冻结 runtime orchestration 设计边界。

### 在 `Task 3` 中

`Task 3` 开始前必须先读取本文件。

要求：

- `script writer` 的 service / route 接线要按这里的节点边界命名与拆分
- 代码应保持“未来可 graph 化”，但本任务不直接引入 LangGraph

### 在 `Task 4` 中

`Task 4` 开始前必须先读取本文件。

要求：

- `semantic review / patch_once / regen_once` 的执行流按这里定义的节点边界收口
- 仍然不引入旧项目重 `workflow-state`

### 在 `Task 4` 结束后

必须进入一个显式决策闸门：

- 判断是否新增一个独立的“LangGraph orchestration 接入任务”
- 若决定接入，必须单列任务，不得隐式塞进 `Task 3` 或 `Task 4`
- 若决定暂不接入，需在 todo 或结论文档中写清原因

## 当前结论

- 现在必须完成 orchestration 规划
- 现在不直接实现 LangGraph
- 最早在 `Task 4` 完成后，才允许决定是否新增 LangGraph 接入任务
