# history-video-forge 技术栈规范

## 1. 目标

新项目延续旧项目成熟技术栈，减少无谓技术迁移成本，把主要精力放在内容流水线重建上。

本文档回答两个问题：

- 新项目在技术栈上应继承什么
- 哪些东西即使旧项目有，也不该在 greenfield 中原样带过来

## 2. 当前确认的技术栈方向

### Monorepo

- Node.js `>=18`
- npm workspaces
- 推荐继续采用 monorepo 组织

理由：

- 旧项目已经验证过 backend / frontend / video 共享 monorepo 的协作方式
- 新项目仍需要跨阶段共享类型、配置、脚本与验证能力

### Backend

沿用旧项目已验证方向：

- TypeScript
- Fastify
- LangGraph.js / LangChain 相关运行编排能力
- OpenAI / LLM 接入层
- Prisma
- Zod
- Remotion / FFmpeg 相关视频合成能力

后端方向重点：

- 继续使用 TypeScript 做结构化对象建模
- 尽量通过本地规则和 schema 降低 prompt 负担
- 保留 LLM orchestration 能力，但避免把状态机做得像旧项目一样重

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

## 3. 当前推荐的工程组织方式

建议继续采用：

- `backend/`：服务端、流水线调度、存储、校验、审校
- `frontend/`：任务页、主题页、script 页等交互
- `video/`：Remotion 组合与渲染
- `docs/`：正式规范、留档、路线图、todo
- `scripts/`：本地验证、检查、迁移、回归脚本

## 4. 技术栈层面的约束

- 不为“更现代”而引入新的平台层
- 不为了 topic/script 重建而重做前后端基础栈
- 不把风格系统做成难以维护的运行时 prompt 叠层
- 优先复用旧项目中已跑通的工程设施，而不是重做底层

## 5. 当前建议保留的旧技术能力

### 后端

- Fastify 路由组织方式
- Zod schema 化输入输出
- Prisma 数据访问方式
- 现有 LLM service / auto-fix / diagnostics 思路

### 前端

- Vue 3 + Pinia 的状态管理模式
- 基于页面级步骤的任务向导交互
- 抽屉与列表组合的交互模式

### 渲染

- Remotion 组合方式
- FFmpeg 工具链

## 6. 当前明确不要在技术层复制的东西

- 旧 topic/script/storyboard 状态机
- 旧 narrative 多层对象
- 旧系统推荐流程和旧 custom draft 编辑逻辑
- 依赖多层 prompt 套娃的写法
- 用 dist/历史状态兼容影响新目录语义

## 7. 明确未定项

以下内容尚未定版：

- 数据库具体部署方案
- 认证方式是否沿用旧项目实现
- 新项目的视频工作区与存储目录结构
- 运行环境区分（本地 / CI / 生产）

这些项在实现前需另行确认，但不影响当前主题阶段与 script 阶段文档收敛。
