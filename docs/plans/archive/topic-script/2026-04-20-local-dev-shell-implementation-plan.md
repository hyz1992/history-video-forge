# Local Dev Shell Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为当前仓库补齐最小可运行的本地前后端联调壳，让主题推荐到脚本文案链路能在 VS Code 中真实启动和手动调试。

**Architecture:** 保持现有 `buildApp()` 业务内核不变，只在外层补一层 Node HTTP 监听入口。前端继续使用现有 Vue 页面与 store，新增 Vite 浏览器入口并通过 `/api` 代理到 backend。开发便利性仅补 `.vscode/launch.json` 与 `kill_ports.py`，不改 topic/script 业务职责。

**Tech Stack:** TypeScript, Node `http`, Vue 3, Vite, VS Code launch configs, Vitest

---

### Task 1: Backend HTTP Server Shell

**Files:**
- Create: `backend/src/server.ts`
- Test: `tests/backend/server-http.test.ts`

**Step 1: Write the failing test**

- 校验 `createHttpServer()` 能监听真实 HTTP 请求。
- 覆盖 `GET /healthz` 与 `POST /api/projects` 两条最小链路。

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/backend/server-http.test.ts`
Expected: FAIL with missing `backend/src/server.js`

**Step 3: Write minimal implementation**

- 将 Node `IncomingMessage` 映射到现有 `app.inject(...)`
- 解析 JSON body
- 暴露 `createHttpServer()` 与 `startServer()`

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/backend/server-http.test.ts`
Expected: PASS

### Task 2: Frontend Browser Entry and Dev Scripts

**Files:**
- Create: `frontend/index.html`
- Create: `frontend/vite.config.ts`
- Modify: `frontend/src/router/index.ts`
- Modify: `frontend/src/main.ts`
- Modify: `package.json`
- Test: `tests/workspace/workspace-layout.test.ts`

**Step 1: Write the failing test**

- 校验前端浏览器入口、Vite 配置、根脚本存在
- 校验 `.vscode/launch.json` 与 `kill_ports.py` 将被纳入工作区布局

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/workspace/workspace-layout.test.ts`
Expected: FAIL with missing `frontend/index.html` and dev shell files

**Step 3: Write minimal implementation**

- 新增 `index.html`
- 新增 Vite 配置并将 `/api` 代理到 `http://127.0.0.1:3000`
- 让 router 支持 `web` 模式用于真实浏览器入口
- 在根 `package.json` 增加 `dev:backend`、`dev:frontend`

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/workspace/workspace-layout.test.ts`
Expected: PASS

### Task 3: VS Code Debug Convenience

**Files:**
- Create: `.vscode/launch.json`
- Create: `kill_ports.py`
- Test: `tests/workspace/workspace-layout.test.ts`

**Step 1: Write the failing test**

- 复用 Task 2 的布局测试，确保 `.vscode/launch.json` 与 `kill_ports.py` 被要求存在

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/workspace/workspace-layout.test.ts`
Expected: FAIL until files are added

**Step 3: Write minimal implementation**

- 复制并收敛旧项目端口清理脚本，保留 `3000/5173`
- 新增 VS Code backend/frontend/full-stack 启动配置

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/workspace/workspace-layout.test.ts`
Expected: PASS

### Task 4: Integrated Verification

**Files:**
- Verify only

**Step 1: Run targeted tests**

Run: `npm test -- tests/backend/server-http.test.ts tests/workspace/workspace-layout.test.ts`
Expected: PASS

**Step 2: Run affected regression**

Run: `npm test`
Expected: PASS

**Step 3: Run real startup smoke**

Run:
- `npm run dev:backend`
- `npm run dev:frontend`

Expected:
- backend listens on `http://127.0.0.1:3000`
- frontend serves on `http://127.0.0.1:5173`
- browser can hit `/topic` and route to `/script`
