# story-video-forge2 技术栈规范

## 1. 目标

新项目延续旧项目成熟技术栈，减少无谓技术迁移成本，把主要精力放在内容流水线重建上。

## 2. 当前确认的技术栈方向

### Monorepo

- Node.js `>=18`
- npm workspaces
- 推荐继续采用 monorepo 组织

### Backend

沿用旧项目已验证方向：

- TypeScript
- Fastify
- LangGraph.js / LangChain 相关运行编排能力
- OpenAI / LLM 接入层
- Prisma
- Zod
- Remotion / FFmpeg 相关视频合成能力

### Frontend

沿用旧项目已验证方向：

- Vue 3
- Vite
- Pinia
- Vue Router
- Axios

### Video / Rendering

- Remotion
- FFmpeg

## 3. 技术栈层面的约束

- 不为“更现代”而引入新的平台层
- 不为了 topic/script 重建而重做前后端基础栈
- 不把风格系统做成难以维护的运行时 prompt 叠层
- 优先复用旧项目中已跑通的工程设施，而不是重做底层

## 4. 推荐目录方向

`TBD`：待实施前结合新仓库实际目录定版。

当前建议的一级结构：

- `backend/`
- `frontend/`
- `video/`
- `docs/`
- `scripts/`

## 5. 明确未定项

以下内容尚未定版：

- 数据库具体部署方案
- 认证方式是否沿用旧项目实现
- 新项目的视频工作区与存储目录结构
- 运行环境区分（本地 / CI / 生产）

这些项在实现前需另行确认，但不影响当前主题阶段与 script 阶段文档收敛。
