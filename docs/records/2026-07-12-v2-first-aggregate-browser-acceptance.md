# V2 第一批聚合真实浏览器验收记录

日期：2026-07-12

## 验收环境

- 独立临时 SQLite 数据库，不使用真实项目数据。
- 通过统一 CLI 执行 init、owner-init、fresh activate。
- production-like 单端口服务 `127.0.0.1:3011`，前端使用 production build。
- `LOCAL_PROJECT_OWNER_ID=acceptance-owner`，LLM 使用 stub，不产生 API 成本。
- 使用 Codex 内置浏览器完成真实页面交互。

## 原始验收清单

| 验收项 | 状态 | 证据 |
| --- | --- | --- |
| 新建项目 | 已完成 | 项目页创建后进入选题页；HTTP writer 集成测试同时确认 Project 入库 |
| 连续三轮推荐 | 已完成 | 页面连续点击两次“换一批”；数据库为 3 个 RecommendationRound、9 个 Exposure |
| 确认选题 | 已完成 | 页面进入文案阶段；数据库为 1 个 TopicPackage，Project.status=`script_ready` 且 activeTopicPackageId 非空 |
| 后端重启 | 已完成 | 停止并重新启动同一隔离服务，`/readyz` 返回 200 |
| 项目状态恢复 | 已完成 | 项目列表仍显示 1 个项目，名称为已确认选题；选题步骤显示完成标记 |
| 三轮候选恢复 | 已完成 | 项目快照返回 3 个完整 candidate_round；浏览器选题页恢复当前轮和历史入口 |
| 候选详情无损 | 已完成（修复后） | 首次复验发现确认候选使用骨架 Topic Package，详情显示“暂无”；修复 store 匹配后，叙事节拍、核心冲突和传播评分均恢复 |
| JSON writer 冻结 | 已完成 | Prisma writer 集成测试确认不创建 `db-snapshot.json` |

## 验收中发现并修复的问题

前端 `loadExistingTopic()` 先用 active Topic Package 构造字段不完整的 selected candidate，随后虽然恢复了三轮完整 candidates，却在已确认状态下没有把 selected candidate 替换为匹配的完整候选。因此列表正确、详情抽屉却退化。

修复方式：按 `canonical_title + selected_angle` 从最后一轮恢复候选中匹配已确认项，并将其设为 selected candidate。增加 frontend topic store 回归测试，8 项通过；production frontend build 通过，浏览器刷新复验通过。

## 已知后续边界

确认选题后页面会继续生成 Script。Script 尚属 Task 8.5-8，当前不会写入 Prisma；后端重启后 Project 从数据库恢复为 `script_ready`，文案页会重新触发生成。这不是第一批聚合数据丢失，但在 Task 8.5-8 完成前不能把 script 重启恢复声明为已完成。

本次隔离服务、数据库和日志在验收结束后删除；未修改真实项目数据库。
