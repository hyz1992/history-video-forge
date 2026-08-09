# 事件库启动同步顺序修复设计

## 背景

S2-4 真实推荐验收中，LLM 已返回候选，但候选规范化落库失败：`EventRegistryEntry.canonicalName` 触发唯一约束。启动流程当前先把 Prisma 中的事件表 hydrate 到内存，再异步把文件事件库同步到 Prisma；同步新增的事件因此只存在于数据库，不存在于运行时 `db.events`。推荐候选命中这些事件时会被误判为新事件，并尝试用新 ID 写入同名记录。

## 目标

- 服务开始接收请求前，文件事件库与运行时事件表保持一致。
- 文件同步失败仍不阻塞服务启动，继续使用数据库中已有事件。
- 不改变事件身份、writer upsert 语义或推荐筛选合同。

## 方案

新增一个聚焦的启动初始化单元：

1. 等待 `syncEventLibraryFromFiles` 完成。
2. 同步失败时调用告警回调，不抛出错误。
3. 随后执行 `hydrateFirstAggregates`，使 `db.events` 包含同步后的 `EventRegistryEntry`。

`startServer` 使用该单元替换当前“先 hydrate、后异步 sync”的顺序。第二、第三聚合 hydrate 和中断运行恢复保持原样。

## 验证

- 集成测试在临时数据库和临时事件库中复现启动场景；初始化后，同名候选必须复用已同步事件且不得再次写入。
- 同步函数抛错时，已有数据库事件仍能 hydrate，证明失败保持非阻塞。
- 回跑 server、事件库同步、Prisma writer、事件规范化和 S2-4 推荐测试。
- 修复后重新执行两组真实 S2-4 推荐，并检查候选、Builder 输入、诊断和 fallback 证据。

## 非目标

- 不改变管理员手动同步的并发模型。
- 不按 `canonicalName` 改写 writer upsert。
- 不调整 S2-4 筛选维度或 Prompt。
