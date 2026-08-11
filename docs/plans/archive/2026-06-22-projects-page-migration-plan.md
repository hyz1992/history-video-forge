# ProjectsPage 重构迁移计划

> 将 `preview-my-projects.html`（chatgpt 优化版）的设计方案迁移到 Vue 项目中的 `src/views/ProjectsPage.vue`。

---

## Review Guide

审阅或实施本计划前，先阅读以下文件：

- `AGENTS.md`
- `frontend/preview/preview-my-projects.html`（设计源文件，1:1 移植基准）
- `frontend/src/views/ProjectsPage.vue`（当前项目列表页，移植目标）
- `frontend/src/styles/main.css`（全局样式入口）
- `frontend/src/styles/landing-page.css`（落地页样式，CSS 变量来源与样式作用域策略参考）
- `frontend/src/stores/project.ts`（项目 store，数据层）
- `docs/plans/2026-06-21-landing-page-1-to-1-porting-plan.md`（首页移植计划，样式策略与 testid 映射格式参考）

---

## 一、目标与边界

### 目标

1. 把 `frontend/preview/preview-my-projects.html` 中项目列表页的视觉与交互完整迁移为 `ProjectsPage.vue`。
2. 做到浏览器端视觉 1:1。
3. 保留现有 `ProjectsPage.vue` 中的路由/业务能力（新建项目→创建并跳转工作区、打开项目→跳转工作区、删除→乐观删除+失败回滚）。
4. 本页面内移除 Element Plus 的 `el-table`/`el-button`/`el-tag`/`el-input`/`el-radio-group` 依赖。

### 当前基线

#### 现有 ProjectsPage.vue

- 使用 Element Plus 组件（`el-table`、`el-button`、`el-tag`、`el-input`、`el-radio-group`）。
- 3 列：项目名称、状态（`el-tag`）、更新时间、操作（删除）。
- 搜索 + 3 状态过滤（全部/进行中/已完成）。
- 通过 `useRouter` + `projectStore.createProject` 实现"新建项目"跳转。
- 删除采用二次确认模式（先点删除 → 显示确认/取消 → 确认后乐观删除 + ElMessage 反馈）。

#### 现有 preview-my-projects.html

- 纯 HTML + CSS（内置 `<style>` 块，约 750 行）+ 内联 `<script>`。
- `<body>` 结构：
  - **Top Bar**：固定顶栏，含品牌图标 + "历史短视频工坊 / History Video Forge"文字 + "我的"按钮 + 设置按钮。
  - **Page Header**：面包屑（工坊控制台 › 我的项目）+ 页面标题 + 描述文字 + "新建项目"按钮。
  - **Workspace Card**：卡片式容器包裹整个表格区域。
    - **Toolbar**：搜索框 + 5 个过滤药片（全部/需处理/生成中/已完成/失败）+ 表元数据（当前显示 X / Y）。
    - **Table Wrap**：`table-layout: fixed` 表格（项目名称 45% / 朝代 12% / 状态 18% / 更新时间 17% / 操作 8%），含 CSS 缩略图（`.thumb`）、二级信息（选题类型 / 9:16 / 时长）、朝代标签、状态徽章、排序箭头、删除按钮。
    - **Footer Line**：底部统计行（共 X 个项目 / 默认按更新时间倒序排列）。
    - **Empty State**：空状态引导。
- 底部 `<script>`：18 条 mock 数据、过滤/排序/搜索逻辑。
- 样式带背景网格纹理（`body::before` 点阵）、深度阴影 (`box-shadow` inset)。
- **0 个 `data-testid` 属性**。

### 不改什么

- **不修改** `preview-my-projects.html`（保留为验证对照；与 landing page 计划一致）。
- **不修改** `HomePage.vue`、`ProjectWorkspace.vue`、以及所有 `components/` 子组件。
- **不修改** `tokens.css`、`theme-cinematic-dark.css`、`theme-light-modern.css`、`element-overrides.css`、`landing-page.css`——不触动项目共享主题变量。
- **不修改** `router/`、`stores/project.ts` 的 actions/API 实现。
- **不拆分组件**：所有内容内联在 `ProjectsPage.vue` 的 `<template>` 中，不创建 `components/projects/` 子目录。视觉 1:1 是第一优先级。
- **不修改** `ElMessage` 的保留/移除：当前 `confirmDeleteProject` 使用 `ElMessage.success()`/`ElMessage.error()` 做删除反馈。**本轮保留** `import { ElMessage } from "element-plus"`，因为：
  - Element Plus 已经是项目全局依赖（`main.ts` 已注册）。
  - `ElMessage` 是命令式 toast 工具，不依赖 DOM 组件树，与其他 el-* 组件的移除正交。
  - 后续如果要统一 toast 方案可以单独改，不纳入本轮。

---

## 二、颜色变量与样式策略

### 颜色变量来源

`preview-my-projects.html` 在 `<style>` 块中复用了与 `preview-landing.html` 相同的变量：

- `--bg-primary: #0d0d0d`
- `--bg-secondary: #171310`
- `--bg-panel: #1f1a16`
- `--bg-panel-soft: rgba(31,27,24,0.72)`
- `--accent-gold: #c9a227`
- `--accent-copper: #b87333`
- `--accent-bronze: #cd7f32`
- `--accent-warm: #d4a574`
- `--text-primary: #f5f0e8`
- `--text-secondary: #a89f94`
- `--text-muted: #6b635a`
- `--border-color: #3d3632`
- `--glow-gold: rgba(201,162,39,0.28)`
- `--glow-copper: rgba(184,115,51,0.35)`
- `--success/--warning/--danger/--info` 含 bg 变体

预览版变量与 `landing-page.css` 中的 `:root` 变量有重叠（同名但值可能微调）。

### 策略：独立 CSS 文件 + scope wrapper 前缀

与 `landing-page.css` 的做法完全一致：

1. **新建** `frontend/src/styles/projects-page.css`——把 `preview-my-projects.html` 的 `<style>` 块移植过来。
2. **所有选择器前加 `.projects-page-wrapper ` 前缀**（如 `.projects-page-wrapper .topbar`、`.projects-page-wrapper .brand`、`.projects-page-wrapper .btn` 等）。配合 `ProjectsPage.vue` 模板最外层的 `<div class="projects-page-wrapper">` wrapper，确保样式仅在项目列表页生效。
3. **`:root` 变量声明单独处理**：与 `landing-page.css` 的 `:root` 变量可能冲突的变量加 `--pp-*` 前缀（如 `--pp-bg-primary`），无冲突的保持原名（如 `--accent-gold: #c9a227` 与 landing-page.css 一致，可直接复用）。具体做法：
   - `projects-page.css` **不**重新声明 `:root` 中与 `landing-page.css` 完全相同的变量（`--accent-gold`、`--accent-copper` 等）——直接复用 landing-page.css 的 `:root` 声明。
   - `projects-page.css` 只声明独有的变量（如 `--success: #65a77a` 与 landing-page.css 不同时的差异变量）。
   - 所有 projects-page.css 中的选择器均加 `.projects-page-wrapper ` 前缀，变量引用不受 prefix 影响。
4. `body::before`（背景网格纹理）改为 `body.projects-page-bg::before`，在 `ProjectsPage.vue` 的 `onMounted` 中添加 class、`onUnmounted` 中移除。
5. `* { box-sizing ... }` / `html { scroll-behavior ... }` 不迁移（main.css 已有等价 reset）。
6. `body` 的 `background` 和 `font-family` 不迁移（保持与其他页面一致，避免触及其他页面的视觉）。
7. 在 `main.css` 末尾加 `@import "./projects-page.css";`（放在 `landing-page.css` 之后）。

### 命名冲突避让表

| preview HTML 原名 | 移植后 | 备注 |
|---|---|---|
| `.page` | `.projects-page-wrapper .page` | 避免与其他页面的 `.page` 冲突 |
| `.btn` / `.btn-primary` / `.btn-ghost` | `.projects-page-wrapper .btn` / `.projects-page-wrapper .btn-primary` / `.projects-page-wrapper .btn-ghost` | 不影响其他页面的 Element Plus 按钮 |
| `.topbar` | `.projects-page-wrapper .topbar` | 仅项目列表页顶栏生效 |
| `.toolbar` / `.filter-pills` / `.search-box` | `.projects-page-wrapper .toolbar` 等 | 通用类名前缀隔离 |
| `.projects-table` / `.table-wrap` | `.projects-page-wrapper .projects-table` 等 | 前缀隔离 |
| `body::before` | `body.projects-page-bg::before` | onMounted/onUnmounted 切换 |
| `body` 的 `min-width`/`min-height` | `.projects-page-wrapper .page` 内处理 | 不做全局 body 覆盖 |
| `:root` 独有变量 | 单独写在 `projects-page.css` 顶部 | 与 landing-page.css 的 `:root` 无冲突 |

### 不迁移的 CSS

- `* { box-sizing: border-box; margin: 0; padding: 0; }`——main.css 已有等价 reset。
- `html { scroll-behavior: smooth; }`——main.css 已在 landing-page.css import 前声明。
- `button, input { font-family: inherit; }`——main.css 有等价规则。
- `button { border: none; }`——不全局删除按钮边框，在 `.projects-page-wrapper button` 中处理。
- `a { color: inherit; text-decoration: none; }`——已在 main.css 中有等价规则。

---

## 三、`data-testid` 映射表（P1 修复）

当前 `ProjectsPage.vue` 有 8 个 `data-testid` 属性，必须在新生模板中逐项映射：

| # | 当前 testid | 当前位置 | 新模板位置 | 说明 |
|---|---|---|---|---|
| 1 | `projects-heading` | `<h1>` 标题 | `<h1 class="page-title">` | 页面主标题 |
| 2 | `create-project` | 新建项目按钮 | `<button class="btn btn-primary" @click="handleCreateProject">` | 新建项目按钮（page-header 区域） |
| 3 | `projects-search` | `<el-input>` 搜索框 | `<input id="searchInput" class="search-input">` | 搜索输入框 |
| 4 | `projects-status-filter` | `<el-radio-group>` 过滤按钮组 | `<div class="filter-pills">` | 过滤药片按钮组 |
| 5 | `open-project-${id}` | 行内项目名 `<span>` | `<tr>` 或行内第一个 `<td>` | 点击行进入工作区；保留在项目名称列 |
| 6 | `project-stage-${id}` | `<el-tag>` 状态标签 | `<span class="status-badge">` | 状态徽章 |
| 7 | `delete-project-${id}` | 删除按钮 | `<button class="delete-btn">` | 删除按钮 |
| 8 | `confirm-delete-project-${id}` | 确认删除按钮 | 删除确认模式保留（inline 确认/取消按钮） | 确认删除按钮 |
| 9 | `create-first-project` | 空状态"创建第一个项目"按钮 | `<button class="btn btn-primary" @click="handleCreateProject">` | 空状态中的创建按钮 |

**关键原则**：第 5 项 `open-project-${id}` 在旧模板中位于项目名 `<span>` 上。若新模板中项目名变为纯 `<td>` 内的文字，则可将 `data-testid` 放在该 `<td>` 上；但为了 harness selector 兼容，**优先放在行内第一个 `<td>` 或保持在一个 `<span>` 上**。

---

## 四、样式冲突与避让清单

与 [landing-page.css 的第 5 节](file:///d:/ai_learn/history-video-forge/docs/plans/archive/2026-06-21-landing-page-1-to-1-porting-plan.md#L529) 格式一致：

### 4.1 已加前缀隔离的 class

所有项目列表页专属 class 前加 `.projects-page-wrapper ` 前缀，配合模板最外层的 `<div class="projects-page-wrapper">` wrapper：

| class | 前缀后形式 | 效果 |
|---|---|---|
| `.topbar` | `.projects-page-wrapper .topbar` | 仅项目列表页顶栏生效 |
| `.brand` / `.brand-mark` / `.brand-text` | `.projects-page-wrapper .brand` 等 | 仅顶栏品牌区生效 |
| `.brand-text strong` | `.projects-page-wrapper .brand-text strong` | 标题字号 |
| `.btn` / `.btn-primary` / `.btn-ghost` / `.btn-subtle` | `.projects-page-wrapper .btn` 等 | 不影响其他页面的 Element Plus 按钮 |
| `.page` / `.page-header` / `.breadcrumb` | `.projects-page-wrapper .page` 等 | 业务页面布局 |
| `.workspace-card` / `.toolbar` / `.toolbar-left` | `.projects-page-wrapper .workspace-card` 等 | 工作区卡片容器 |
| `.search-box` / `.search-input` / `.search-icon` | `.projects-page-wrapper .search-box` 等 | 搜索组件 |
| `.filter-pills` / `.filter-pill` / `.filter-count` | `.projects-page-wrapper .filter-pills` 等 | 过滤药片 |
| `.table-wrap` / `.projects-table` | `.projects-page-wrapper .table-wrap` 等 | 表格容器 |
| `.project-cell` / `.thumb` / `.project-main` | `.projects-page-wrapper .project-cell` 等 | 项目行单元格 |
| `.dynasty-tag` / `.status-badge` / `.status-dot` | `.projects-page-wrapper .dynasty-tag` 等 | 标签和徽章 |
| `.time` / `.action-cell` / `.delete-btn` | `.projects-page-wrapper .time` 等 | 时间和操作 |
| `.footer-line` / `.empty-state` / `.empty-icon` | `.projects-page-wrapper .footer-line` 等 | 底部和空状态 |

### 4.2 全局保留的规则

| 规则 | 保留原因 |
|---|---|
| `:root` 中的颜色变量 | 纯描述性变量声明，不影响视觉 |
| `@keyframes pulse-dot` | 动画定义，不会与其他页面的动画冲突 |
| `@media` 断点内的规则（加 `.projects-page-wrapper ` 前缀后） | 响应式断点 |

---

## 五、实施顺序与验证步骤

实施按以下顺序进行，每步单独 commit：

### Step 1：新建 `projects-page.css`

- **文件**：`frontend/src/styles/projects-page.css`
- **内容**：完整移植 `preview-my-projects.html` 的 `<style>` 块，按以下规则修改：
  - 所有选择器前加 `.projects-page-wrapper ` 前缀（详见"四、样式冲突与避让清单"）。
  - `body::before` → `body.projects-page-bg::before`。
  - 移除 `* { box-sizing }`、`html { scroll-behavior }`、`button { border: none }`、`a { color: inherit }`。
  - 保留 `:root` 中与 `landing-page.css` 不重复的变量（并加 `--pp-*` 前缀标记 items-page 专有变量）。
- **不改什么**：`main.css` 暂不 import（Step 4 再做）。
- **验证**：Vite dev 无编译错误。

### Step 2：扩展 `ProjectListItem` 类型

- **文件**：`frontend/src/stores/project.ts`（仅类型定义部分）
- **改动**：在 `ProjectListItem` 接口中新增如下可选字段：

```typescript
export interface ProjectListItem extends ProjectSnapshot {
  display_name: string;
  is_draft: boolean;
  updated_at: string;
  // 预览设计新增字段（均为可选，后端可能不返回）
  dynasty?: string;          // 朝代（如"唐朝"）
  topic_type?: string;       // 选题类型（如"战争转折"）
  duration?: string;         // 时长（如"00:58"）
  aspect_ratio?: string;     // 宽高比，默认 "9:16"
}
```

- **不改什么**：不修改 store 的任何 actions/API 实现、不修改 `ProjectSnapshot`。
- **验证**：`npx vue-tsc --noEmit` 无错误。

### Step 3：改写 `ProjectsPage.vue` 的 `<script setup>`

- **文件**：`frontend/src/views/ProjectsPage.vue`（仅 `<script setup>` 部分）
- **保留**：
  - `useProjectStore`、`useRouter` 引用
  - `onMounted` → `loadProjects()`
  - `handleCreateProject()`（创建项目→跳转工作区）
  - `openProject()`（同步 store→跳转工作区）
  - `requestDeleteProject` / `cancelDeleteProject` / `confirmDeleteProject`（完整删除逻辑，含乐观删除+失败回滚+ElMessage 反馈）
  - `isLoading` / `searchQuery` / `statusFilter` / `confirmingDeleteProjectId` 等响应式状态
  - `formatDateTime`
  - `import { ElMessage } from "element-plus"`——保留用于删除反馈
- **新增**：
  - `sortBy` / `sortOrder` ref
  - 扩展 `statusFilter` 为 5 选项（`"all" | "todo" | "generating" | "completed" | "failed"`）
  - 5 项过滤常量 `STATUS_FILTERS`
  - `getCounts()` 函数
  - `isCompletedStatus` / `isFailedStatus` / `isGeneratingStatus` / `isTodoStatus` / `getStatusClass` helper 函数
  - `sortTable(column)` 函数
  - `setFilter(filter)` 函数
  - `handleSearch(value)` 函数
  - `handleGoHome()` 函数（导航到 `/`）
  - `onMounted` 中 `document.body.classList.add("projects-page-bg")`
  - `onUnmounted` 中 `document.body.classList.remove("projects-page-bg")`
- **重写**：`filteredProjects` computed——加入 dynasty/topicType 搜索、5 项过滤、多字段排序
- **移除**：
  - `tableRenderVersion` ref（表不再用 `:key` 强制重渲染，因为原生 HTML table，DOM 直接响应式更新）
  - Element Plus 相关的类型引用（`getStatusTagType` 改成返回 CSS class 字符串）
- **不改什么**：不修改 store 方法、不修改路由行为。
- **验证**：`npx vue-tsc --noEmit` 无错误。先不改 `<template>`（Step 4 做）。

### Step 4：改写 `ProjectsPage.vue` 的 `<template>`

- **文件**：`frontend/src/views/ProjectsPage.vue`（`<template>` 部分完全重写）
- **顶层结构**：

```html
<template>
  <div class="projects-page-wrapper">
    <!-- Top Bar -->
    <header class="topbar">
      <a class="brand" @click="router.push('/')">
        <!-- SVG 图标 + 品牌文字（复用 landing page 同款） -->
      </a>
      <div class="topbar-right">
        <div class="account-actions">
          <button class="btn btn-subtle">我的</button>
          <button class="btn btn-subtle icon-btn">⚙</button>
        </div>
      </div>
    </header>

    <main class="page">
      <!-- Page Header（面包屑 + 标题 + 描述 + 新建项目按钮） -->
      <section class="page-header">...</section>

      <!-- Workspace Card -->
      <section class="workspace-card">
        <!-- Toolbar（搜索 + 过滤药片 + 表元数据） -->
        <div class="toolbar">...</div>

        <!-- Table（colgroup + sticky header） -->
        <div class="table-wrap">
          <table class="projects-table">...</table>
        </div>

        <!-- Empty State -->
        <div class="empty-state">...</div>

        <!-- Footer Line -->
        <div class="footer-line">...</div>
      </section>
    </main>
  </div>
</template>
```

- **需保留的 `data-testid` 属性**（按映射表逐一标注）：

| 映射位置 | data-testid 属性 |
|---|---|
| `<h1 class="page-title">` | `data-testid="projects-heading"` |
| page-header 新建按钮 | `data-testid="create-project"` |
| `<input id="searchInput">` | `data-testid="projects-search"` |
| `<div class="filter-pills">` | `data-testid="projects-status-filter"` |
| 行内第一个 `<td>` 或项目名 `<span>` | `:data-testid="'open-project-' + row.project_id"` |
| `<span class="status-badge">` | `:data-testid="'project-stage-' + row.project_id"` |
| `<button class="delete-btn">` | `:data-testid="'delete-project-' + row.project_id"` |
| 删除确认按钮 | `:data-testid="'confirm-delete-project-' + row.project_id"` |
| 空状态创建按钮 | `data-testid="create-first-project"` |

- **数据绑定**：
  - 搜索：`<input :value="searchQuery" @input="searchQuery = ($event.target as HTMLInputElement).value">`（Vue 已支持 `v-model`，可直接使用）
  - 行点击：`<tr @click="openProject(row)">`
  - 过滤按钮：`@click="setFilter(f.key)"` + `:class="{ active: statusFilter === f.key }"`
  - 排序表头：`@click="sortTable('name')"` + 动态 `↓/↑` 箭头
  - 删除按钮：`@click.stop="requestDeleteProject(row.project_id)"`

- **不改什么**：不修改路由配置、不创建新组件。
- **验证**：
  - `npx vue-tsc --noEmit` 无错误。
  - `npm run dev` 启动后在浏览器访问 `/projects`，能看到新布局。

### Step 5：在 `main.css` 中 import

- **文件**：`frontend/src/styles/main.css`
- **改动**：在 `@import "./landing-page.css";` 之后新增一行 `@import "./projects-page.css";`
- **验证**：刷新 `/projects` 后视觉与预览版一致。

### Step 6：验收集成

逐项验证：

| # | 验证项 | 方法 |
|---|---|---|
| 1 | `npx vue-tsc --noEmit` 通过 | 终端执行 |
| 2 | 页面加载时正确显示项目列表 | 浏览器访问 `/projects` |
| 3 | searchQuery 输入后列表实时过滤 | 输入"唐朝"→仅唐朝项目显示 |
| 4 | 5 个过滤药片切换正常，计数更新 | 逐个点击各状态按钮 |
| 5 | 新建项目按钮创建项目并跳转工作区 | 点击新建→跳转 `/projects/:id/topic` |
| 6 | 行点击跳转工作区正确 | 点击行→跳转对应步骤 |
| 7 | 删除确认流程：点删除→显示确认/取消→确认后 ElMessage.success | 完整流程测试 |
| 8 | 空状态正确显示（无项目或过滤无结果时） | 清空搜索或过滤到空结果 |
| 9 | 排序功能正常（朝代/名称/时间） | 点击表头，箭头切换，数据重排 |
| 10 | 滚动条不影响表格宽度 | 数据 >13 条时滚动条出现，列宽不变 |
| 11 | 9 个 `data-testid` 属性全部存在 | `document.querySelector('[data-testid="projects-heading"]')` 等全部不为 null |
| 12 | `/` 首页视觉未被破坏 | 浏览器访问首页对比 |
| 13 | `/projects/:id/topic` 工作区视觉无变化 | 打开任意项目工作区 |

### Step 7：清理

- **改动文件**：`ProjectsPage.vue`
- **确认**：不再有 `el-table`、`el-button`（Element Plus button 组件）、`el-tag`、`el-input`（Element Plus input 组件）、`el-radio-group` 的 import 或使用。
- **保留**：`import { ElMessage } from "element-plus"`（删除反馈 toast）。
- **保留**：`preview-my-projects.html`（与 landing page 计划一致——保留为验证对照，不删除）。
- **不改什么**：`element-overrides.css`、Element Plus 的 `main.ts` 注册——其他页面仍使用 Element Plus。
- **验证**：Grep `ProjectsPage.vue` 中无 `el-table`、`el-button`、`el-tag`、`el-input`、`el-radio-group` 引用。

---

## 六、验证清单（Reviewer Checklist）

- [ ] `projects-page.css` 创建完成，所有选择器带 `.projects-page-wrapper ` 前缀。
- [ ] `body::before` 改为 `body.projects-page-bg::before`。
- [ ] `main.css` 末尾有 `@import "./projects-page.css";`。
- [ ] `ProjectListItem` 类型新增 4 个可选字段：`dynasty?`、`topic_type?`、`duration?`、`aspect_ratio?`。
- [ ] `ProjectsPage.vue` 的 `<template>` 最外层有 `<div class="projects-page-wrapper">` wrapper。
- [ ] `ProjectsPage.vue` 的 `<template>` 与 `preview-my-projects.html` `<body>` 结构 1:1：Top Bar / Page Header / Workspace Card / Toolbar / Table / Empty State / Footer Line。
- [ ] 9 个 `data-testid` 属性全部就位：
  - [ ] `projects-heading`（页面标题）
  - [ ] `create-project`（新建项目按钮 in page-header）
  - [ ] `projects-search`（搜索输入框）
  - [ ] `projects-status-filter`（过滤药片按钮组）
  - [ ] `open-project-${id}`（项目行）
  - [ ] `project-stage-${id}`（状态徽章）
  - [ ] `delete-project-${id}`（删除按钮）
  - [ ] `confirm-delete-project-${id}`（确认删除按钮）
  - [ ] `create-first-project`（空状态创建按钮）
- [ ] `handleCreateProject` / `openProject` / `requestDeleteProject` / `cancelDeleteProject` / `confirmDeleteProject` 逻辑与原版一致。
- [ ] `confirmDeleteProject` 使用 `ElMessage.success()`/`ElMessage.error()` 反馈。
- [ ] `onMounted` 添加 `projects-page-bg` class，`onUnmounted` 移除。
- [ ] `filteredProjects` computed 支持 `dynasty`/`topicType` 搜索 + 5 项过滤 + 排序。
- [ ] 样式 scope：`/` 和 `/projects/:id/topic` 视觉未被新版 `projects-page.css` 污染。
- [ ] `npx vue-tsc --noEmit` 通过。
- [ ] `ProjectsPage.vue` 中无 `el-table`/`el-button`/`el-tag`/`el-input`/`el-radio-group` 引用。
- [ ] `preview-my-projects.html` 未被删除（保留为验证对照）。
- [ ] 不涉及的文件（HomePage、Workspace、所有子组件、tokens、theme、element-overrides、router、stores actions）未被修改。

---

## 七、失败回滚方案

1. **Step 5 失败**（其他页面被样式污染）：删除 `main.css` 中的 `@import "./projects-page.css;"` 行。
2. **Step 4 失败**（模板渲染异常）：用 git 恢复 `ProjectsPage.vue` 为原版本；projects-page.css 保留无影响。
3. **Step 3 失败**（TypeScript 编译错误）：恢复 `ProjectsPage.vue` 中旧的 `<script setup>`；`ProjectListItem` 类型扩展可保留（可选字段不影响现有消费）。
4. **Step 2 失败**（类型冲突）：revert `stores/project.ts`。
5. **Step 1 失败**（CSS 语法错误）：删除 `projects-page.css`。

---

## 八、文件改动汇总

| 文件 | 操作 | 改动范围 |
|------|------|----------|
| `src/styles/projects-page.css` | **新建** | 移植预览版全部 CSS，所有选择器加 `.projects-page-wrapper ` 前缀 |
| `src/styles/main.css` | 修改 | 添加 `@import "./projects-page.css";`（1 行） |
| `src/stores/project.ts` | 修改 | `ProjectListItem` 接口新增 4 个可选字段 |
| `src/views/ProjectsPage.vue` | **重写** | `<script setup>` + `<template>` 全面重写，`<style scoped>` 留空 |
| `frontend/preview/preview-my-projects.html` | **不改** | 保留为验证对照 |

---

## 九、后续方向（本轮不做）

- **Topbar 组件化**：与 `HomePage.vue` 的顶栏合并为共享 layout 组件。
- **"我的"按钮功能**：接入用户个人信息入口（需 user system）。
- **后端 dynasty/topicType/duration 字段落地**：当前依赖前端 mock/可选字段兜底。
- **toast 统一方案**：`ElMessage` 替换为项目级 toast composable（多个页面都用 ElMessage）。
- **harness 自动化验收**：添加 `npm run harness:projects-reference` 命令做视觉对照。
