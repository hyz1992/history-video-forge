# V2 Repository 作用域与并发验证记录

日期：2026-07-11

## 1. 访问合同

Task 8.5-5 已移除“省略 owner 即获得全局访问”的仓储合同：

- 普通项目读取：`findByIdForOwner(projectId, ownerId)`。
- 内部系统读取：`findByIdForSystem(projectId)`，名称显式区别于用户路径。
- 状态和 active record 更新均使用 `ForOwner` 方法并在写入前验证 owner。
- 推荐轮次写入和最近事件读取均要求 ownerId，并拒绝跨 owner 项目访问。
- active record 除 owner 检查外，继续验证目标记录属于同一项目。

越权统一返回稳定的 `project_scope_denied`，不把 Prisma 的未找到或约束错误作为权限判断泄露给调用方。

## 2. 推荐轮次并发

推荐轮次在当前单进程后端内按 projectId 排队。进入数据库事务后，第一条写操作同时验证项目 owner 并获取 SQLite 写锁，再读取最大 roundIndex 和创建下一轮。

底层唯一冲突、SQLite busy 和 Prisma 事务冲突最多重试三次；重试耗尽映射为 `recommendation_round_conflict`，其他底层持久化错误映射为 `recommendation_round_persistence_failed`。

## 3. 验证范围

- 两个用户访问同一项目：非 owner 查询不可见，更新和推荐读写被拒绝。
- 两个项目的 active record：跨项目引用在事务提交前被拒绝。
- 两个独立 Prisma client 同时记录同一项目推荐轮次：最终得到 roundIndex 1、2，数据库恰有两轮。
- 重启后项目状态、推荐曝光和最近事件身份仍可读取。

## 4. 剩余边界

- 项目锁是进程内锁，只适用于当前 SQLite + 单后端实例部署。若未来增加多后端实例，必须停止沿用该结论，重新评估 PostgreSQL、数据库锁或分布式协调。
- 当前业务主链路尚未调用这些 Prisma repository；Task 8.5-7 切换时必须通过编译和 parity test 逐一迁移调用方。
- 本任务没有新增管理员写接口。未来确需管理员代操作时，应增加名称明确、带审计上下文的独立方法，不能复用 system read 绕过 owner。
