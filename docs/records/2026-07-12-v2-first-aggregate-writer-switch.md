# V2 第一批聚合 writer 切换记录

日期：2026-07-12

## 已切换范围

Project、Event Registry、Candidate Cache、Recommendation Round/Exposure、Topic Package 与 Project active topic 的真实写入已接入 Prisma。内存 Map 仅作为当前进程读模型，并可从 Prisma hydration 重建。

选题确认使用单一事务创建 Topic Package 并更新 Project name/status/activeTopicPackageId。事件新增与已有事件锚句合并均使用 upsert。项目删除在 Prisma 中记录 archivedAt，不物理破坏流水线历史。

## 过渡 owner

认证系统尚未实现，因此启动 Prisma writer 必须显式配置 `LOCAL_PROJECT_OWNER_ID`。启动会验证该用户存在且为 ACTIVE；缺失、禁用或不存在均 fail-closed。运维 CLI 新增 `owner-init`，只允许数据库没有 ACTIVE 用户时创建不可登录的 migration owner。

## 单一 writer

`buildApp()` 配置 Prisma writer 后：

- 不加载 JSON snapshot。
- mutation 后的 `persist()` 返回成功但不调用 `saveDbSnapshot()`。
- persistence health 以 Prisma primary 标记为 loaded。
- 服务启动完成前从 Prisma hydration 第一批聚合。

## 已验证

- HTTP 创建项目写入 Prisma。
- 事件新增及已有事件锚句合并可重启恢复。
- 候选缓存、推荐轮次、完整候选卡和 Topic Package 可重启恢复。
- 选题确认后 Project 为 script_ready 且 active topic 存在。
- Prisma 模式不会创建 db-snapshot.json。
- 缺失显式 owner 被拒绝。

## 尚未关闭

Task 8.5-7 还需完成三轮真实推荐、确认、后端重启和浏览器验收。Script 及后续聚合尚未切换；在 Task 8.5-8 至 8.5-10 完成前，不能把当前中间态当成整体生产切换完成。
