# Runtime Orchestration Design

适用范围：`story-video-forge2` 当前 `topic + script` 正式主链路。

## 目标

本设计文档用于冻结 backend runtime orchestration 的节点边界、状态边界，以及 LangGraph 的接入闸门。

它服务于三个目的：

- 为 `Task 3`、`Task 4` 以及后续阶段提供统一的 orchestration 命名与拆分边界
- 防止 prompt registry、provider adapter、frontend 各自发明新的 orchestration 层
- 为第三阶段正式接入 LangGraph 提供唯一设计基线

## 当前边界

LangGraph 只作为 **backend runtime orchestration** 的实现层。

当前明确不属于 LangGraph 范围的层：

- `harness/prompts/` 下的 prompt registry / loader
- provider adapter
- external errors / retry / structured-output-fix 基础设施
- frontend 页面状态与交互
- harness trace / diagnostics 表现层

## 当前计划中的 graph 节点边界

Graph 节点边界以当前 `topic + script` 主链路为准：

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
- 让 `patch_once / regen_once` 演变成多轮无限重试

## 状态边界

当前不引入旧项目的重状态机。

graph state 只保留轻量状态穿透：

- 当前节点名称
- 当前输入对象引用
- 当前输出对象引用
- 当前失败原因
- `patch_used`
- `regenerate_used`

明确不保留：

- 大而全 workflow state
- 旧 narrative quality analysis 语义
- 多分支并行赛稿状态

## 历史消费时机

### 在 `Task 2A`

本文件最初在第二阶段 `Task 2A / Step 4` 创建，用来冻结 runtime orchestration 设计边界。

### 在 `Task 3`

第二阶段 `Task 3` 开始前，`script writer` 的 service / route 接线必须按这里的节点边界命名与拆分，但当时仍不直接引入 LangGraph。

### 在 `Task 4`

第二阶段 `Task 4` 开始前，`semantic review / patch_once / regen_once` 的执行流也必须按这里的节点边界收口，但当时仍不恢复旧项目重 `workflow-state`。

## 第三阶段正式接入决议

从第三阶段开始，LangGraph 不再只是规划候选，而是正式实现任务。

第三阶段执行时必须满足：

- LangGraph 只接入 backend orchestration
- graph node 只允许消费既有 service 能力
- 现有 prompt registry / loader、LLM gateway、provider adapter、structured-output-fix 的职责边界保持不变
- 不引入旧项目重 `workflow-state`
- `patch_once / regen_once` 仍然受单次机会约束

第三阶段实现优先顺序：

1. 先建立 LangGraph orchestration scaffold
2. 再把 `script-generate -> local-validate -> semantic-review -> patch-once / regen-once` 迁入 graph
3. 再让 topic recommendation 与 graph trace / diagnostics 共享统一编排语义

## 当前结论

- 第二阶段已经完成 orchestration 规划与主链路收口
- 第三阶段开始正式实现 LangGraph
- LangGraph 的唯一正式落点是 backend runtime orchestration
- 后续如果 graph 设计与业务代码发生冲突，以本文件定义的边界为先，再回到实施计划和 todolist 做显式调整
