# CLAUDE.md — Story Video Forge 2

## 项目概述

历史叙事短视频生产工作台。流水线：选题 → 文案 → 分镜 → 资产 → 合成视频（5 步）。
前端 SPA + 后端 REST API，monorepo 结构（npm workspaces）。

## 开发命令

```bash
npm run dev:backend   # Node.js 后端，127.0.0.1:3000
npm run dev:frontend  # Vite 前端，127.0.0.1:5173（/api 自动代理到后端）
npm run test          # Vitest 测试
```

前后端需同时运行。后端用 tsx 直接运行 TS，不编译。

## 技术栈

| 层 | 选型 |
|---|---|
| 前端 | Vue 3.5 + TypeScript 5.8 + Element Plus + Vue Router 4 |
| 后端 | Node.js (ESM) + 原生 node:http 自建路由 + LangChain/LangGraph |
| 共享 | Zod schema（shared/src） |
| 数据库 | Prisma schema 定义但当前用内存 Map（db/client.ts） |
| 构建 | Vite 7（前端），无构建（后端 tsx 直跑） |
| LLM | OpenAI-compatible provider，默认 GLM-5.1 |

## 目录结构

```
frontend/src/
  main.ts              # 入口：注册 Element Plus，创建并 provide 所有 store
  router/index.ts      # 路由：/ → /projects → /projects/:projectId
  views/               # 页面级组件（HomePage, ProjectsPage, ProjectWorkspace）
  components/
    workspace/         # 工作区框架（Header, Sidebar）
    topic/             # 选题面板
    script/            # 文案面板
    storyboard/        # 分镜面板
    asset/             # 资产面板（AssetPanel + SegmentAssetCard）
    compose/           # 合成面板
  stores/              # 自定义 store（project, topic, script, storyboard, asset-planning, workspace）
  composables/         # useTheme 等
  styles/              # CSS 变量主题系统（tokens.css + 两套主题）

backend/src/
  server.ts            # HTTP 服务器
  app.ts               # 自建路由框架（buildApp + inject）
  db/client.ts         # 内存 Map 数据层
  modules/             # 按领域拆分：projects, topic, script, storyboard, asset-planning
    <module>/
      *.routes.ts      # 路由注册
      *.controller.ts  # 控制器
      *.repository.ts  # 数据访问
      *.service.ts     # 业务逻辑
  runtime/
    llm/               # LLM Gateway、provider、structured output
    orchestration/     # LangGraph 图与节点
    prompts/           # Prompt 注册表

shared/src/            # 前后端共享 Zod schema
```

## 核心架构模式

### Store 模式（无 Pinia）

每个 store 文件导出三部分：

```ts
export const xxxStoreKey: InjectionKey<XxxStore> = Symbol("xxx-store");
export function createXxxStore(deps): XxxStore { ... }  // reactive + readonly state
export function useXxxStore(): XxxStore { ... }          // inject wrapper
```

- `createXxxStore()` 在 main.ts 中调用，通过 `app.provide()` 注入
- 组件中用 `useXxxStore()` 获取（内部 inject）
- API 层分离：`createFetchXxxApi()` 返回 fetch 实现，作为 store 的依赖传入
- Store 间依赖通过构造参数注入（如 topic store 接收 projectStore）

### 工作区面板渲染

`ProjectWorkspace.vue` 用 `panelMap: Record<PipelineStep, Component>` 映射步骤到面板组件，
`<component :is="currentPanel" :key="stepKey" />` 动态渲染，步骤切换时组件销毁重建。

### CSS 主题

双层变量系统：`--t-*`（theme 原始值）→ `--bg-* / --text-* / --border-* / --accent-*`（语义变量）。
两套主题：`cinematic-dark`（深色金色）和 `light-modern`（浅色红色）。
所有组件使用语义变量，不直接引用 `--t-*`。

### 后端路由

自建轻量框架，`app.addRoute(method, pattern, handler)` 注册。
handler 接收 `{ app, params, payload }`，返回 `{ statusCode, body }`。
路由匹配支持 `:param` 占位符。

## 关键约定

- Git 提交信息必须使用中文
- UI 文案全部中文硬编码
- 正式 LLM prompt 必须中文，存放在 `harness/prompts/`
- 共享类型和 schema 放在 `shared/src`，用 Zod 定义
- 后端模块按 `<domain>.routes/controller/repository/service` 四层拆分
- `storage/` 目录是运行时生成数据，不提交
- Element Plus 组件直接导入使用（全局注册），CSS 变量覆盖在 `element-overrides.css`

## 当前阶段

topic + script 已冻结稳定，storyboard/asset/compose 已进入前端实现阶段。
详细工作契约和阶段闸门规则见 `AGENTS.md`。
