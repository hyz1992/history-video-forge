# V2 第二批聚合 parity 基线记录

日期：2026-07-12

## 已验证范围

新增 Script、Storyboard、AssetPlan 的 Prisma hydration：

- Script 正文、opening/ending、时长、beat/quote trace、validation、semantic review、execution state、graph trace 和 runtime diagnostics。
- Storyboard plan、validation、execution state、graph trace 和 runtime diagnostics。
- AssetPlan plan、validation、execution state、graph trace 和 runtime diagnostics。

真实 SQLite + Prisma parity fixture 验证 JSON sidecar 在数据库往返后结构不变，并只加载当前 owner 可见项目下的记录。

## 状态推进风险

现有三个 run service 在生成开始时把 generating record 写入 active pointer；失败时把 active pointer 清空。这会覆盖生成前已有的有效 active record，不符合 Task 8.5-8 的失败安全要求。

writer 接入前必须冻结以下语义：

1. generating record 可以保存为历史/恢复记录，但不能覆盖 active pointer。
2. 只有最终 record 通过本地校验并完成状态推进时，才在同一事务更新 active pointer。
3. 失败只更新失败记录和项目失败/可重试状态，上一条有效 active pointer 保持不变。
4. Topic、Script、Storyboard、AssetPlan 的 projectId 链必须完全一致，跨项目引用在事务提交前拒绝。

下一步先写 repository 负向事务测试，再修改 run service；不得直接把现有 Map 更新顺序翻译成 Prisma 调用。
