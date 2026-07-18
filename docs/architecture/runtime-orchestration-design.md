# Runtime Orchestration Design

适用范围：`history-video-forge` 当前 `topic + script` 正式主链路。

> **归档说明**：本文档定格于 topic+script 第一阶段设计期。当前后端 `runtime/orchestration/` 中已有 `topic-recommendation-graph.ts`、`script-run-graph.ts`、`topic-script-graph.ts` 等实现；downstream 阶段（storyboard/assets/compose/render）各自有独立 service，不共用同一 LangGraph graph。storyboard→publish 阶段不共用本文档定义的 graph 节点体系。

## 目标

本设计文档用于冻结 backend runtime orchestration 的节点边界、状态边界，以及 LangGraph 的接入闸门。

它服务于三个目的：

- 为 `topic + script` 主链路的 orchestration 命名与拆分边界提供历史参考
- 防止 prompt registry、provider adapter、frontend 各自发明新的 orchestration 层
- 为第三阶段正式接入 LangGraph 提供唯一设计基线

## 当前边界

LangGraph 只作为 **backend runtime orchestration** 的实现层。

当前明确不属于 LangGraph 范围的层：

- `prompts/` 下的 prompt registry / loader
- provider adapter
- external errors / retry / structured-output-fix 基础设施
- frontend 页面状态与交互
- harness trace / diagnostics 表现层

## 当前计划中的 graph 节点边界

Graph 节点边界以当前 `topic + script` 主链路为准：

- `topic-candidate-generate`
- `script-generate`
- `semantic-review`

当前主链路不启用：

- `patch-once`
- `regen-once`

`patch-once / regen-once` 只保留为未来 patch integration 设计候选，不属于当前默认运行路径。

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

> 以下为本文档创建时的历史背景记录，不代表当前任务入口。

### 在 `Task 2A`

本文件最初在第二阶段 `Task 2A / Step 4` 创建，用来冻结 runtime orchestration 设计边界。

### 在 `Task 3`

第二阶段 `Task 3` 开始前，`script writer` 的 service / route 接线必须按这里的节点边界命名与拆分，但当时仍不直接引入 LangGraph。

### 在 `Task 4`

第二阶段 `Task 4` 开始前，`semantic review / patch_once / regen_once` 的执行流也必须按这里的节点边界收口，但当时仍不恢复旧项目重 `workflow-state`。

> **当前状态**：以上历史阶段均已完成。本文档已归档，不作为当前实施入口。

## 当前结论

> **当前状态**：第三阶段及后续阶段均已完成。topic+script、storyboard、asset planning、assets、compose、render、publish 各阶段均已完成后端实现，各自使用独立 service，不共用单一 LangGraph graph。

- 第二阶段已经完成 orchestration 规划与主链路收口
- 第三阶段开始正式实现 LangGraph
- LangGraph 的唯一正式落点是 backend runtime orchestration
- 当前 semantic reviewer 是 shadow-only
- 当前 patch 不进入主路径
- 后续如果 graph 设计与业务代码发生冲突，以本文件定义的边界为先，再回到实施计划和 todolist 做显式调整
