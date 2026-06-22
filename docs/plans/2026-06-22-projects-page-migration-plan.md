# ProjectsPage 重构迁移计划

> 将 `preview-my-projects.html`（chatgpt 优化版）的设计方案迁移到 Vue 项目中的
> `src/views/ProjectsPage.vue`。

---

## 一、迁移原则

| 原则 | 说明 |
|------|------|
| **渐进替换** | 分步小步迁移，每一步可独立验证，不搞大爆炸重写 |
| **复用现有数据层** | 不改动 `projectStore` 的 state/actions/API，只扩展类型和消费方式 |
| **移除 Element Plus 依赖** | 本页面不再使用 `el-table/el-button/el-tag` 等组件，改为原生 HTML+CSS |
| **保持主题一致** | 复用 `landing-page.css` 中的暗色 gold/copper 主题变量（通过 CSS 自定义属性注入） |
| **保持路由和跳转逻辑不变** | `openProject`/`handleCreateProject` 等函数的行为不变 |

---

## 二、迁移步骤（共7步）

### 第1步：添加页面级样式表

**目标**：创建 `src/styles/projects-page.css`，将预览版中的 CSS 移植到项目样式系统中。

**改动文件**：
- 新建 `frontend/src/styles/projects-page.css`

**CSS 变量策略**：
- 直接在 `:root` 或页面 scoped `<style>` 中定义 `--pp-*` 前缀的变量
- 颜色值完全复用 `landing-page.css` 中的 `--accent-gold: #c9a227`、`--accent-copper: #b87333` 等值
- 或者，直接在 `projects-page.css` 中重新声明同名变量（因为 main.css 已导入 landing-page.css，变量可能作用域不同）

**移植内容**：
- Topbar 样式（`.topbar`, `.brand`, `.brand-mark`, `.brand-text` 等）
- 页面布局样式（`.page`, `.page-header`, `.breadcrumb`, `.page-title`）
- 工作区卡片（`.workspace-card`, `.toolbar`, `.filter-pills` 等）
- 表格样式（`.table-wrap`, `.projects-table`, `table-layout: fixed`, `colgroup`）
- 缩略图 CSS 艺术（`.thumb` 及其伪元素）
- 朝代标签、状态徽章、排序箭头、删除按钮、页脚行、空状态
- 响应式/背景网格纹理（`body::before` 点阵）
- `scrollbar-gutter: stable` 处理

**不改什么**：
- 不改动 `tokens.css`、`theme-cinematic-dark.css`、`landing-page.css`
- 不修改原有样式文件

**验证方式**：CSS 文件被 `main.css` @import 后，无编译错误即可。具体效果在后续步骤中逐步验证。

---

### 第2步：扩展 `ProjectListItem` 类型

**目标**：在 `ProjectListItem` 中增加预览设计所需的字段。

**改动文件**：
- `frontend/src/stores/project.ts`（仅类型定义部分）

**需要新增的字段**（均为可选，因为后端可能不返回）：

```typescript
export interface ProjectListItem extends ProjectSnapshot {
  display_name: string;
  is_draft: boolean;
  updated_at: string;
  // 预览设计新增字段
  dynasty?: string;          // 朝代（如"唐朝"）
  topic_type?: string;       // 选题类型（如"战争转折"）
  duration?: string;         // 时长（如"00:58"）
  aspect_ratio?: string;     // 宽高比（如"9:16"）
}
```

**notes**：这些字段当前后端可能不返回，前端做兼容处理（不显示或显示占位值）。

**不改什么**：
- 不修改 store 的任何 actions/API 实现
- 不修改 `ProjectSnapshot` 或其他类型

**验证方式**：TypeScript 编译无错误

---

### 第3步：改写 `<script setup>` 逻辑

**目标**：将 `ProjectsPage.vue` 的 `<script setup>` 部分从 Element Plus 模式改为原生模式。

**改动文件**：
- `frontend/src/views/ProjectsPage.vue`（仅 `<script setup>` 部分）

**保留不变的部分**：
- `projectStore` 引用和 `useRouter()`
- `onMounted` 中调用 `loadProjects()`
- `handleCreateProject()` 函数（创建项目后跳转工作区）
- `openProject()` 函数（同步 store + 跳转工作区）
- `requestDeleteProject` / `cancelDeleteProject` / `confirmDeleteProject` 删除逻辑
- `isLoading` / `searchQuery` / `statusFilter` / `confirmingDeleteProjectId` 等响应式状态

**需要新增/修改的部分**：

1. **sortBy / sortOrder**（新增）：
   ```typescript
   const sortBy = ref("time");
   const sortOrder = ref<"asc" | "desc">("desc");
   ```

2. **过滤条件扩展**（修改 `statusFilter`）：
   - 从 `"all" | "active" | "completed"` 扩展为 `"all" | "todo" | "generating" | "completed" | "failed"`
   - 或保持3选项不变，按用户需求

3. **`filteredProjects` computed**（重写）：
   - 加入 `dynasty` 和 `topicType` 的搜索范围
   - 加入扩展的过滤条件
   - 加入排序逻辑（按 name / dynasty / time）

4. **helper 函数**（复用）：
   - `isCompletedStatus` / `isFailedStatus` / `isGeneratingStatus` / `isTodoStatus` / `getStatusClass`
   - 从 Element Plus 的 `getStatusTagType` 改为返回 CSS class 字符串（如 `status-success`）

5. **移除 Element Plus 依赖**：
   - 移除 `import { ElMessage } from "element-plus"`（删除确认用自定义 UI 反馈或用原生 alert）
   - 或保留 ElMessage 用于操作反馈

6. **formatDateTime**：保持原样

7. **getCounts**：新增函数，计算各过滤状态的计数

**不改什么**：
- 不修改 store 的任何方法
- 不修改路由行为

**验证方式**：TypeScript 编译无错误，`computed` 逻辑可通过 Vue DevTools 初步验证

---

### 第4步：改写 `<template>` 结构

**目标**：将模板从 Element Plus 组件替换为原生的预览设计 HTML 结构。

**改动文件**：
- `frontend/src/views/ProjectsPage.vue`（仅 `<template>` 部分）

**顶层结构映射**：

| 旧设计（Element Plus） | 新设计（预览版） |
|---|---|
| `<section class="projects-page">` | `<main class="page">` |
| `<div class="projects-container">` | 去掉，内容直接在 page 内 |
| `<header class="projects-header">` | `<section class="page-header">` |
| `<h1>` + `<p>` | `<div class="breadcrumb">` + `<h1>` + `<p class="page-desc">` |
| `<el-button>` 新建项目 | `<div class="header-actions">` + `<button class="btn btn-primary">` |
| `<el-input>` 搜索 | `<div class="search-box">` + `<svg class="search-icon">` + `<input>` |
| `<el-radio-group>` 过滤器 | `<div class="filter-pills">` + 动态按钮 |
| `<el-table>` + `<el-table-column>` | `<table class="projects-table">` + `<colgroup>` |
| `<el-tag>` 状态标签 | `<span class="status-badge">` + `<span class="status-dot">` |
| `<el-empty>` 空状态 | `<div class="empty-state">` |
| 无 | `<div class="footer-line">` 底部统计行 |
| 无 | `<div class="thumb">` CSS 缩略图 |

**Topbar 处理**：
- 预览版的 topbar（固定导航栏）在当前 Vue 项目中**不迁移**到 ProjectsPage 内
- 因为 topbar 属于框架级布局，应该作为 App.vue 或 layout 层的共享组件
- 当前阶段，ProjectsPage 保持无 topbar 状态，后续再统一布局

**数据绑定要点**：
- 搜索：`<input :value="searchQuery" @input="searchQuery = $event.target.value">` 或直接 `v-model`
- 点击行：`<tr @click="openProject(row)">`
- 过滤按钮：`@click="setFilter('todo')"` + `:class="{ active: statusFilter === 'todo' }"`
- 排序表头：`@click="sortTable('name')"` + 动态 `↓/↑` 箭头

**不改什么**：
- 不创建新组件，所有内容在 ProjectsPage.vue 内
- 不修改路由配置

**验证方式**：
- 页面能正常渲染，无 Vite 编译错误
- 打开 `/projects` 能看到正确的布局

---

### 第5步：添加 `<style>` 样式

**目标**：确保 ProjectsPage.vue 的 `<style>` 正确引用设计系统并覆盖必要样式。

**改动文件**：
- `frontend/src/views/ProjectsPage.vue`（`<style>` 部分）

**样式等级**：
- 主样式放在 `src/styles/projects-page.css`（全局，无 scoped）
- ProjectsPage.vue 中的 `<style scoped>` 只放页面特有的布局调整
- 如果全部 CSS 已在 `projects-page.css` 中，则 ProjectsPage.vue 中不需要 scoped style

**关键样式注意**：
- `table-layout: fixed` 配合 `colgroup` 保证列宽一致
- `scrollbar-gutter: stable` 保证有无滚动条时表格宽度不变
- sticky 表头：`th { position: sticky; top: 0; z-index: 2; }`
- 状态颜色使用 `--success/--warning/--danger/--info` CSS 变量

**不改什么**：
- 不改动其他页面的样式
- 不修改 tokens.css 或主题 CSS

**验证方式**：
- 浏览器中打开 `/projects`，视觉与预览版一致
- 滚动条出现/消失时表格宽度不变

---

### 第6步：验证和打磨

**目标**：端到端测试所有功能和交互。

**验证清单**：

| # | 项目 | 验证方法 |
|---|---|---|
| 1 | 页面加载时正确显示项目列表 | 访问 `/projects` |
| 2 | 搜索过滤功能正常 | 输入文字后列表实时过滤 |
| 3 | 过滤药片按钮切换正常 | 点击各状态按钮，计数和列表更新 |
| 4 | 新建项目按钮可用 | 点击后创建项目并跳转工作区 |
| 5 | 行点击跳转工作区正确 | 点击任意项目行跳转到正确管线阶段 |
| 6 | 删除确认流程正常 | 点击删除 → 二次确认 → 成功后消失 |
| 7 | 空状态显示正确 | 没有项目时显示空状态引导 |
| 8 | 排序功能正确 | 点击朝代/名称/时间表头可排序 |
| 9 | 滚动条不影响表格宽度 | 有无滚动条时列宽一致 |
| 10 | 淘汰 Element Plus 引用 | Grep 确认无 `el-table`, `el-button`, `el-tag` 等引用 |

**改动文件**：
- 可能微调 `projects-page.css` 或 `ProjectsPage.vue`

**验证方式**：
- `npx vue-tsc --noEmit` 类型检查
- 浏览器手动测试

---

### 第7步：清理

**目标**：删掉不再需要的代码和文件。

**改动文件**：
- 确认 `ProjectsPage.vue` 中不再有 Element Plus 的 import
- 移除 `preview-my-projects.html`（因为已迁移到 Vue）

**不改什么**：
- 保留 `element-overrides.css`（其他页面仍使用 Element Plus）
- 保留 Element Plus 的 main.ts 注册（其他页面仍使用）

**验证方式**：
- 全量 `npx vue-tsc --noEmit` 无错误
- `npm run dev` 无编译警告

---

## 三、风险提示

| 风险 | 缓解措施 |
|------|----------|
| CSS 变量冲突 | 使用 `--pp-*` 前缀或 scoped 隔离 |
| 后台缺失 dynasty/topicType 字段 | 字段设为可选，缺失时显示 `—` 占位 |
| 移除 Element Plus 后影响其他页面 | ProjectsPage 是独立页面，不影响其他页面的 el-* 组件使用 |
| landing-page.css 的变量作用域 | 检查 `main.css` 的 @import 顺序，确保变量可用 |

---

## 四、文件改动汇总

| 文件 | 操作 | 改动范围 |
|------|------|----------|
| `src/styles/projects-page.css` | **新建** | 移植预览版全部 CSS |
| `src/styles/main.css` | 修改 | 添加 `@import "./projects-page.css"` |
| `src/stores/project.ts` | 修改 | `ProjectListItem` 增加可选字段 |
| `src/views/ProjectsPage.vue` | **重写** | `<script>` + `<template>` + `<style>` 全面重写 |
