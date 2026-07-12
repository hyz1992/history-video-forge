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

## Writer 与状态推进处理结果

- 三个 repository 的 save/upsert 只保存 record，不更新 active pointer。
- 最终 Script/Storyboard/AssetPlan 分别通过独立 activation 事务校验 owner、project、Topic、Script、Storyboard 归属后更新 Project。
- generating 阶段只更新项目状态，active pointer 保持生成前值。
- 校验失败、stale source 或异常时，内存项目恢复生成前 active pointer；数据库从未被 generating record 覆盖，并同步恢复后的状态。
- 新的 Script/Storyboard/AssetPlan 激活会按既有业务语义清空对应下游 active pointer 和 trace。

负向测试确认：旧 Script 保持 active 直到新 Script 最终激活；跨项目 Storyboard activation 被拒绝且 Project active 链不变；合法 Storyboard 和 AssetPlan 可顺序原子激活。

## 真实浏览器与重启复验

- 隔离 SQLite、production build、`LOCAL_PROJECT_OWNER_ID=acceptance-owner-2`、`LLM_PROVIDER=stub` 下，从新建项目真实走到 Script 和 Storyboard。
- 首轮分镜生成发现 deterministic stub 合并句子时删除换行，导致 `storyboard_excerpt_not_in_script`；修复为保留原文分隔空白，并增加含换行回归测试。
- 修复后页面生成 8 段 Storyboard；重启后 API 仍返回原 Script record 和 8 段 active Storyboard，浏览器深链恢复到分镜审阅页。
- AssetPlan 浏览器生成未通过：生产 stub 按既有安全边界返回 `asset_planning_stub_provider_requires_test_gateway:asset-planning.planner`。Writer 原子激活已有真实 SQLite 自动化测试，但浏览器端到端仍标记为未验证，不能据此关闭 Task 8.5-8。
