# V2 数据基础收口验收记录

## 结论

Task 8.5-9 与 Task 8.5-10 已完成，可以把正式 V2 产品设计与开发交接给 Trae。当前收口只涉及 V1 风险修复和必要数据基础设施，没有实现用户系统、管理员权限、选题筛选、事件库、自定义选题、偏好设置或内容策略扩展。

## 数据与启动

- 正式 `startServer()` 要求数据库文件已经初始化；缺失时以 `database_not_initialized` 拒绝启动。
- 本地迁移 owner 为 `local-migration-owner`；它是认证系统上线前的过渡归属，不是永久隐式管理员。
- legacy snapshot 经显式清理、inspect、import、verify 和 activate 后迁移到 Prisma。
- 迁移清除了 12 条已删除项目的候选缓存、18 条重复 fingerprint 和 1 条失效 active publish 引用。
- 调试项目 `Prompt Test` 已从 Prisma 和项目目录删除；最终保留 10 个项目。
- `/readyz` 的 queryable、writable、migrations、pragmas、integrity、activation 六项检查全部通过。

## 文件与恢复

- render、cover 和 assets run 使用可识别 staging；校验后再移动到最终路径，数据库登记或激活失败时保留 staging，不覆盖旧 active。
- ProviderJob 的 submitted/running 状态在 Prisma hydration 后会持久化恢复为 `process_interrupted`，不会在重启后永久停留在运行态，也不会自动重复提交外部任务。
- 媒体文件仍保存在项目文件系统；数据库只保存稳定引用和元数据。
- SQLite 一致性备份通过；独立恢复副本 readiness 全绿。

## 自动化证据

2026-07-12 最终分组矩阵：

- backend-core：310/310
- backend-topic-script：137/137
- backend-video-pipeline：353/353
- frontend：73/73
- harness：135/135
- supporting：60/60
- 合计：197 个测试文件，1068/1068 用例通过
- 原始摘要：`.codex-run-logs/test-partitions/2026-07-12T15-36-51-189Z-summary.json`

`npm run typecheck:backend` 与 `npm run build` 通过。真实 Remotion smoke 生成 MP4，通过用时约 131 秒；该耗时是渲染成本，不是未退出句柄。

## 内置浏览器验收

- 项目列表刷新后显示 10/10，且不再出现 `Prompt Test`。
- 已验证选题、文案、分镜、资产、合成渲染与发布页面深链恢复。
- 完整项目 `79e37cd6-b612-422c-91b6-ce9b50f4c7bf` 的合成渲染页显示“渲染完成”、`1080x1920`，无加载失败。
- 未调用付费图片/视频/TTS Provider；这不属于本次基础设施收口验收。

## 剩余非阻断风险

- 本地 `storage/topic-candidate-library` 曾被旧测试污染并出现截断；测试现已强制使用 `STORAGE_ROOT_DIR` 隔离。该目录不再是正式项目数据真相源，后续可在停机备份后单独清理。
- 当前用户身份仍是迁移 owner。正式用户系统与管理员 RBAC 属于 V2 功能，必须重新设计，不得直接把迁移 owner 当成最终管理员模型。
- V2 改动若修改 Prisma schema、active pointer、文件 URI 或 ProviderJob 状态机，必须重新执行数据库 readiness、重启恢复和浏览器深链验收。
