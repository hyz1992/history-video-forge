# history-video-forge 技术栈规范

截至 2026-10-10，以下以 package.json、锁文件和当前源码为依据；旧项目的框架选型只作迁移背景。

## 当前实现

| 层 | 实际技术与位置 |
| --- | --- |
| Monorepo | npm workspaces：backend / frontend / shared / renderer；TypeScript 5 |
| Node.js | 根 package.json 声明 >=20；锁定 Vite 7 / Prisma 7 的实际要求为 20.19+（20.x）、22.12+（22.x）或 24+ |
| HTTP | Node 原生 node:http，backend/src/server.ts；AppInstance 本地路由注册，JSON/multipart/文件路由 |
| 内容编排 | LangGraph / LangChain 用于 topic + script graph；下游独立 service，OpenAI-compatible gateway 与 tier 路由 |
| 数据与合同 | Prisma 7、better-sqlite3 adapter、SQLite（WAL）；shared/ 使用 Zod 3 |
| 认证 | Argon2 密码散列、数据库会话 Cookie、owner 授权、管理员审计 |
| 前端 | Vue 3、Vue Router 4、Vite 7、Element Plus；reactive + provide/inject stores，apiFetch 封装 fetch |
| 视频 | renderer/ 内 React 19 / Remotion 4；后端 Remotion bundler/renderer；FFmpeg/ffprobe 用于媒体处理和探测 |
| 检查 | Vitest 3、Vue Test Utils/jsdom、Playwright；runtime harness 和 prompt 治理脚本 |
| 开发/部署 | tsx、Python 开发启动器、Node 生产启动脚本；Windows 可使用 NSSM 服务 |

当前 HTTP 服务未采用 Fastify，前端未采用 Pinia/Axios；不要据旧项目方向在实现中假定这些依赖存在。shared/ 的 Zod 为实际 schema 来源，Prisma 模型与 migrations 为数据库来源。

## 工程组织

- backend/：服务、阶段编排、provider、存储、认证与 CLI。
- frontend/：六步工作区、用户设置与管理页面。
- shared/：跨阶段类型、schema、配置与投影。
- renderer/：Remotion 组合（旧设计中的 video/ 已由此目录承载）。
- prompts/：正式中文 prompt 与变更记录。
- harness/：执行规范、回归、显式 live/browser 检查。
- scripts/：构建、启动和分区测试。
- storage/：SQLite 主库、媒体和 trace；JSON 快照为历史导入材料。

## 约束与验证

- 不为框架迁移扩大本次任务，也不复刻旧项目的多层 narrative 合同和重试状态机。
- 生成配置与模型选择按冻结运行快照执行；semantic reviewer 保持 shadow-only。
- npm run typecheck:backend 做后端 TS 检查；npm run build:frontend 只做 Vite 构建，前端独立 TS 检查闸门仍待补。
- 后端/harness Vitest 使用 --configLoader runner；写候选库与渲染相关多文件测试优先串行。

启动、数据库准备与生产部署分别见 [项目 README](../../README.md) 和 [部署指南](../../DEPLOY_WINDOWS_SERVER.md)。现有 SQLite/认证/存储布局已落地；生产扩容、CI 和独立前端类型检查仍需单独设计。
