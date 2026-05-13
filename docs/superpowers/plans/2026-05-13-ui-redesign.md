# UI 全面重构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking tracking.

**Goal:** 将前端 UI 从当前手写样式+多页面结构，全面重构为 Element Plus + 可折叠侧边栏向导式单页流，支持主题切换。

**Architecture:** 6 步流水线（选题→文案→分镜→资产规划→资产→合成视频）合并为一个 ProjectWorkspace 页面，左侧可折叠侧边栏导航步骤，右侧主工作区。所有视觉 token 通过三层 CSS 变量架构实现主题切换。

**Tech Stack:** Vue 3.5 + Element Plus + vue-router 4.5 + 手写 store (provide/inject) + CSS Variables 主题系统

---

## 文件结构总览

```
frontend/src/
  main.ts                              — 修改：注册 Element Plus + 主题初始化
  styles/
    theme-cinematic-dark.css            — 新建：暗色电影风主题 token 值
    theme-light-modern.css              — 新建：明亮现代风主题 token 值（预留）
    tokens.css                          — 新建：语义化变量声明层
    element-overrides.css               — 新建：Element Plus 变量映射
    main.css                            — 修改：精简为全局基础样式
  router/
    index.ts                            — 修改：新路由结构
  views/
    HomePage.vue                        — 修改：使用 Element Plus 重写
    ProjectsPage.vue                    — 修改：使用 Element Plus 重写
    ProjectWorkspace.vue                — 新建：核心工作区页面（合并向导）
  components/
    workspace/
      WorkspaceSidebar.vue              — 新建：可折叠侧边栏
      WorkspaceHeader.vue               — 新建：工作区顶部栏
      WorkspaceFooter.vue               — 新建：工作区底部导航
      ThemeToggle.vue                   — 新建：主题切换按钮
    topic/
      TopicPanel.vue                    — 新建：选题步骤面板
      TopicCandidateList.vue            — 修改：适配新主题
      TopicCandidateDrawer.vue          — 修改：适配新主题（或合并入 TopicPanel）
    script/
      ScriptPanel.vue                   — 新建：文案步骤面板
    storyboard/
      StoryboardPanel.vue               — 新建：分镜步骤面板
    asset-planning/
      AssetPlanningPanel.vue            — 新建：资产规划步骤面板
    asset/
      AssetPanel.vue                    — 新建：资产步骤面板（占位）
    compose/
      ComposePanel.vue                  — 新建：合成视频步骤面板（占位）
  stores/
    workspace.ts                        — 新建：工作区状态管理
    project.ts                          — 修改：增加 workspace 相关状态
  composables/
    useTheme.ts                         — 新建：主题切换 composable
```

**保留不变（不修改）的文件：**
- `stores/topic.ts`, `stores/script.ts`, `stores/storyboard.ts`, `stores/asset-planning.ts` — store 层不变
- `shared/` — 共享 schema 不变
- `backend/` — 后端不变

---

## 阶段一：基础设施（主题 + Element Plus）

### Task 1: 安装依赖 + 配置 Vite

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/vite.config.ts`

- [ ] **Step 1: 安装 Element Plus 及相关依赖**

```bash
cd frontend
npm install element-plus @element-plus/icons-vue
```

- [ ] **Step 2: 验证安装成功**

```bash
cd frontend && npm ls element-plus
```
Expected: `element-plus@x.x.x` 列出

- [ ] **Step 3: 提交**

```bash
git add frontend/package.json frontend/package-lock.json
git commit -m "chore: 安装 element-plus 和 @element-plus/icons-vue"
```

---

### Task 2: 创建三层主题 Token 架构

**Files:**
- Create: `frontend/src/styles/tokens.css`
- Create: `frontend/src/styles/theme-cinematic-dark.css`
- Create: `frontend/src/styles/theme-light-modern.css`
- Create: `frontend/src/styles/element-overrides.css`

- [ ] **Step 1: 创建语义化变量声明层 `tokens.css`**

定义所有组件使用的语义化 CSS 变量。变量不带具体值，由主题文件赋值。

```css
/* tokens.css — 语义化变量声明 */
[data-theme] {
  /* 背景 */
  --bg-base: var(--t-bg-base);
  --bg-panel: var(--t-bg-panel);
  --bg-card: var(--t-bg-card);
  --bg-sidebar: var(--t-bg-sidebar);
  --bg-input: var(--t-bg-input);
  --bg-hover: var(--t-bg-hover);

  /* 强调色 */
  --accent-primary: var(--t-accent-primary);
  --accent-primary-light: var(--t-accent-primary-light);
  --accent-gradient: var(--t-accent-gradient);
  --accent-text: var(--t-accent-text);

  /* 文字 */
  --text-heading: var(--t-text-heading);
  --text-body: var(--t-text-body);
  --text-secondary: var(--t-text-secondary);
  --text-muted: var(--t-text-muted);
  --text-inverse: var(--t-text-inverse);

  /* 边框 */
  --border-default: var(--t-border-default);
  --border-active: var(--t-border-active);
  --border-hover: var(--t-border-hover);

  /* 状态色 */
  --color-info: var(--t-color-info);
  --color-success: var(--t-color-success);
  --color-warning: var(--t-color-warning);
  --color-danger: var(--t-color-danger);

  /* 阴影 */
  --shadow-card: var(--t-shadow-card);
  --shadow-elevated: var(--t-shadow-elevated);

  /* 间距 */
  --space-xs: 4px;
  --space-sm: 8px;
  --space-md: 16px;
  --space-lg: 24px;
  --space-xl: 32px;

  /* 圆角 */
  --radius-sm: 4px;
  --radius-button: 6px;
  --radius-card: 8px;
  --radius-panel: 10px;
  --radius-dialog: 12px;

  /* 字体 */
  --font-family: 'Noto Sans SC', 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  --font-heading: 700;
  --font-subheading: 600;
  --font-body: 400;

  /* 侧边栏 */
  --sidebar-expanded-width: 220px;
  --sidebar-collapsed-width: 60px;
}
```

- [ ] **Step 2: 创建暗色电影风主题 `theme-cinematic-dark.css`**

```css
[data-theme="cinematic-dark"] {
  --t-bg-base: #0a0f18;
  --t-bg-panel: #111827;
  --t-bg-card: #1a2332;
  --t-bg-sidebar: #0d1117;
  --t-bg-input: #111827;
  --t-bg-hover: rgba(212, 163, 95, 0.06);

  --t-accent-primary: #d4a35f;
  --t-accent-primary-light: #e8c88a;
  --t-accent-gradient: linear-gradient(135deg, #d4a35f, #c56b47);
  --t-accent-text: #d4a35f;

  --t-text-heading: #f4ebd7;
  --t-text-body: #e0d8c8;
  --t-text-secondary: #b7af9c;
  --t-text-muted: #857f73;
  --t-text-inverse: #0a0f18;

  --t-border-default: rgba(212, 163, 95, 0.15);
  --t-border-active: rgba(212, 163, 95, 0.25);
  --t-border-hover: rgba(212, 163, 95, 0.20);

  --t-color-info: #42a5f5;
  --t-color-success: #66bb6a;
  --t-color-warning: #ffa726;
  --t-color-danger: #ef5350;

  --t-shadow-card: 0 2px 8px rgba(0, 0, 0, 0.3);
  --t-shadow-elevated: 0 4px 16px rgba(0, 0, 0, 0.4);
}
```

- [ ] **Step 3: 创建明亮现代风主题 `theme-light-modern.css`**

```css
[data-theme="light-modern"] {
  --t-bg-base: #f5f5f5;
  --t-bg-panel: #ffffff;
  --t-bg-card: #ffffff;
  --t-bg-sidebar: #fafafa;
  --t-bg-input: #f0f0f0;
  --t-bg-hover: rgba(0, 0, 0, 0.04);

  --t-accent-primary: #c0392b;
  --t-accent-primary-light: #e74c3c;
  --t-accent-gradient: linear-gradient(135deg, #c0392b, #e74c3c);
  --t-accent-text: #c0392b;

  --t-text-heading: #1a1a1a;
  --t-text-body: #333333;
  --t-text-secondary: #666666;
  --t-text-muted: #999999;
  --t-text-inverse: #ffffff;

  --t-border-default: #e0e0e0;
  --t-border-active: #c0392b;
  --t-border-hover: #cccccc;

  --t-color-info: #2196f3;
  --t-color-success: #4caf50;
  --t-color-warning: #ff9800;
  --t-color-danger: #f44336;

  --t-shadow-card: 0 1px 4px rgba(0, 0, 0, 0.08);
  --t-shadow-elevated: 0 4px 12px rgba(0, 0, 0, 0.12);
}
```

- [ ] **Step 4: 创建 Element Plus 变量映射 `element-overrides.css`**

```css
[data-theme] {
  --el-color-primary: var(--accent-primary);
  --el-color-primary-light-3: var(--accent-primary-light);
  --el-color-primary-light-5: rgba(212, 163, 95, 0.5);
  --el-color-primary-light-7: rgba(212, 163, 95, 0.3);
  --el-color-primary-light-8: rgba(212, 163, 95, 0.2);
  --el-color-primary-light-9: rgba(212, 163, 95, 0.1);
  --el-color-primary-dark-2: #b8893f;
  --el-color-success: var(--color-success);
  --el-color-warning: var(--color-warning);
  --el-color-danger: var(--color-danger);
  --el-color-info: var(--color-info);
  --el-bg-color: var(--bg-base);
  --el-bg-color-overlay: var(--bg-panel);
  --el-bg-color-page: var(--bg-base);
  --el-text-color-primary: var(--text-heading);
  --el-text-color-regular: var(--text-body);
  --el-text-color-secondary: var(--text-secondary);
  --el-text-color-placeholder: var(--text-muted);
  --el-border-color: var(--border-default);
  --el-border-color-light: var(--border-default);
  --el-border-color-lighter: var(--border-default);
  --el-border-color-extra-light: var(--border-default);
  --el-border-color-hover: var(--border-hover);
  --el-fill-color-blank: var(--bg-input);
  --el-fill-color: var(--bg-card);
  --el-fill-color-light: var(--bg-panel);
  --el-fill-color-lighter: var(--bg-base);
  --el-border-radius-base: var(--radius-button);
  --el-font-family: var(--font-family);
  --el-mask-color: rgba(0, 0, 0, 0.6);
  --el-mask-color-extra-light: rgba(0, 0, 0, 0.3);
}
```

- [ ] **Step 5: 提交**

```bash
git add frontend/src/styles/
git commit -m "feat: 创建三层主题 token 架构（语义层 + 主题值 + EP映射）"
```

---

### Task 3: 重写 main.css + 注册 Element Plus

**Files:**
- Modify: `frontend/src/styles/main.css`
- Modify: `frontend/src/main.ts`
- Create: `frontend/src/composables/useTheme.ts`

- [ ] **Step 1: 重写 `main.css` 为使用变量的全局基础样式**

清空当前 `main.css` 的全部内容，替换为以下内容。不再硬编码任何色值，所有颜色通过 `var(--xxx)` 引用。

```css
/* main.css — 全局基础样式 */
@import "./tokens.css";
@import "./theme-cinematic-dark.css";
@import "./theme-light-modern.css";
@import "./element-overrides.css";

*,
*::before,
*::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html {
  font-family: var(--font-family);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

body {
  min-height: 100vh;
  background: var(--bg-base);
  color: var(--text-body);
}

a {
  color: var(--accent-primary);
  text-decoration: none;
}

a:hover {
  color: var(--accent-primary-light);
}

/* Element Plus 暗色组件补丁 */
.el-menu {
  background-color: var(--bg-sidebar) !important;
  border-right: none !important;
}

.el-menu-item {
  color: var(--text-secondary) !important;
}

.el-menu-item.is-active {
  color: var(--accent-primary) !important;
  background-color: var(--bg-hover) !important;
}

.el-dialog {
  background-color: var(--bg-panel) !important;
  border: 1px solid var(--border-default);
}

.el-drawer {
  background-color: var(--bg-panel) !important;
}

.el-table {
  --el-table-bg-color: var(--bg-panel);
  --el-table-tr-bg-color: var(--bg-panel);
  --el-table-header-bg-color: var(--bg-card);
  --el-table-row-hover-bg-color: var(--bg-hover);
  --el-table-border-color: var(--border-default);
  --el-table-text-color: var(--text-body);
  --el-table-header-text-color: var(--text-secondary);
}

.el-message-box {
  background-color: var(--bg-panel) !important;
  border: 1px solid var(--border-default) !important;
}

/* 全局过渡 */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
```

- [ ] **Step 2: 创建主题切换 composable `composables/useTheme.ts`**

```ts
import { ref, watch } from "vue";

export type ThemeName = "cinematic-dark" | "light-modern";

const STORAGE_KEY = "svf-theme";

const currentTheme = ref<ThemeName>(
  (localStorage.getItem(STORAGE_KEY) as ThemeName) || "cinematic-dark"
);

function applyTheme(name: ThemeName) {
  document.documentElement.setAttribute("data-theme", name);
  localStorage.setItem(STORAGE_KEY, name);
}

export function useTheme() {
  watch(currentTheme, (name) => applyTheme(name), { immediate: true });

  return {
    currentTheme,
    setTheme: (name: ThemeName) => {
      currentTheme.value = name;
    },
    toggleTheme: () => {
      currentTheme.value =
        currentTheme.value === "cinematic-dark" ? "light-modern" : "cinematic-dark";
    },
  };
}
```

- [ ] **Step 3: 修改 `main.ts` 注册 Element Plus**

```ts
import { createApp, h } from "vue";
import { RouterView } from "vue-router";
import ElementPlus from "element-plus";
import "element-plus/dist/index.css";
import "element-plus/theme-chalk/dark/css-vars.css";

import "./styles/main.css";
import { createAppRouter } from "./router";
import {
  createFetchProjectApi,
  createProjectStore,
  projectStoreKey,
} from "./stores/project";
import {
  createFetchScriptApi,
  createScriptStore,
  scriptStoreKey,
} from "./stores/script";
import {
  createFetchAssetPlanningApi,
  createAssetPlanningStore,
  assetPlanningStoreKey,
} from "./stores/asset-planning";
import {
  createFetchStoryboardApi,
  createStoryboardStore,
  storyboardStoreKey,
} from "./stores/storyboard";
import {
  createFetchTopicApi,
  createTopicStore,
  topicStoreKey,
} from "./stores/topic";

const router = createAppRouter("web");
const projectStore = createProjectStore(createFetchProjectApi());
const topicStore = createTopicStore({
  projectStore,
  api: createFetchTopicApi(),
});
const scriptStore = createScriptStore({
  projectStore,
  api: createFetchScriptApi(),
});
const storyboardStore = createStoryboardStore({
  projectStore,
  api: createFetchStoryboardApi(),
});
const assetPlanningStore = createAssetPlanningStore({
  projectStore,
  api: createFetchAssetPlanningApi(),
});

const app = createApp({
  render: () => h(RouterView),
});

app.use(router);
app.use(ElementPlus);
app.provide(projectStoreKey, projectStore);
app.provide(topicStoreKey, topicStore);
app.provide(scriptStoreKey, scriptStore);
app.provide(storyboardStoreKey, storyboardStore);
app.provide(assetPlanningStoreKey, assetPlanningStore);

if (typeof document !== "undefined") {
  app.mount("#app");
}
```

注意变化：新增 `import ElementPlus` 和 `app.use(ElementPlus)`，以及 Element Plus 的 CSS 导入。

- [ ] **Step 4: 在 index.html 的 html 标签上设置默认主题属性**

找到 `frontend/index.html`，在 `<html>` 标签上添加 `data-theme="cinematic-dark"` 和 `class="dark"`。

- [ ] **Step 5: 验证应用能启动**

```bash
cd frontend && npm run dev
```
Expected: 应用正常启动，Element Plus 组件可用，主题变量生效。

- [ ] **Step 6: 提交**

```bash
git add frontend/src/styles/main.css frontend/src/main.ts frontend/src/composables/useTheme.ts frontend/index.html
git commit -m "feat: 注册 Element Plus，重写 main.css 为变量驱动，添加主题切换 composable"
```

---

## 阶段二：工作区 Shell

### Task 4: 创建 WorkspaceStore

**Files:**
- Create: `frontend/src/stores/workspace.ts`

- [ ] **Step 1: 创建工作区状态管理 store**

此 store 管理当前激活的步骤索引和侧边栏折叠状态。遵循项目现有的工厂+provide/inject 模式。

```ts
import { type InjectionKey, type Ref, inject, reactive, readonly, ref } from "vue";

export type PipelineStep = "topic" | "script" | "storyboard" | "asset-planning" | "asset" | "compose";

export const PIPELINE_STEPS: { key: PipelineStep; label: string; index: number }[] = [
  { key: "topic", label: "选题", index: 0 },
  { key: "script", label: "文案", index: 1 },
  { key: "storyboard", label: "分镜", index: 2 },
  { key: "asset-planning", label: "资产规划", index: 3 },
  { key: "asset", label: "资产", index: 4 },
  { key: "compose", label: "合成视频", index: 5 },
];

export interface WorkspaceStoreState {
  currentStepIndex: number;
  sidebarCollapsed: boolean;
}

export interface WorkspaceStore {
  state: Readonly<Ref<WorkspaceStoreState>>;
  setCurrentStep: (index: number) => void;
  setCurrentStepByKey: (key: PipelineStep) => void;
  nextStep: () => void;
  prevStep: () => void;
  toggleSidebar: () => void;
  currentStepKey: () => PipelineStep;
  isLastStep: () => boolean;
  isFirstStep: () => boolean;
}

export const workspaceStoreKey: InjectionKey<WorkspaceStore> = Symbol("workspaceStore");

export function createWorkspaceStore(): WorkspaceStore {
  const state = ref<WorkspaceStoreState>({
    currentStepIndex: 0,
    sidebarCollapsed: false,
  });

  function setCurrentStep(index: number) {
    if (index >= 0 && index < PIPELINE_STEPS.length) {
      state.value = { ...state.value, currentStepIndex: index };
    }
  }

  function setCurrentStepByKey(key: PipelineStep) {
    const step = PIPELINE_STEPS.find((s) => s.key === key);
    if (step) setCurrentStep(step.index);
  }

  function nextStep() {
    setCurrentStep(state.value.currentStepIndex + 1);
  }

  function prevStep() {
    setCurrentStep(state.value.currentStepIndex - 1);
  }

  function toggleSidebar() {
    state.value = { ...state.value, sidebarCollapsed: !state.value.sidebarCollapsed };
  }

  function currentStepKey(): PipelineStep {
    return PIPELINE_STEPS[state.value.currentStepIndex].key;
  }

  function isLastStep(): boolean {
    return state.value.currentStepIndex === PIPELINE_STEPS.length - 1;
  }

  function isFirstStep(): boolean {
    return state.value.currentStepIndex === 0;
  }

  return {
    state: readonly(state),
    setCurrentStep,
    setCurrentStepByKey,
    nextStep,
    prevStep,
    toggleSidebar,
    currentStepKey,
    isLastStep,
    isFirstStep,
  };
}

export function useWorkspaceStore(): WorkspaceStore {
  const store = inject(workspaceStoreKey);
  if (!store) throw new Error("WorkspaceStore not provided");
  return store;
}
```

- [ ] **Step 2: 提交**

```bash
git add frontend/src/stores/workspace.ts
git commit -m "feat: 创建 WorkspaceStore 管理步骤索引和侧边栏状态"
```

---

### Task 5: 创建 WorkspaceSidebar

**Files:**
- Create: `frontend/src/components/workspace/WorkspaceSidebar.vue`

- [ ] **Step 1: 创建可折叠侧边栏组件**

该组件接收当前步骤索引和项目状态，显示 6 个步骤入口。使用 Element Plus 的 el-menu 组件。支持折叠/展开。

```vue
<script setup lang="ts">
import { computed } from "vue";
import { ElMenu, ElMenuItem, ElIcon, ElTooltip, ElButton } from "element-plus";
import {
  Edit,
  Document,
  Film,
  Box,
  PictureFilled,
  VideoCameraFilled,
  Fold,
  Expand,
  Back,
} from "@element-plus/icons-vue";
import {
  PIPELINE_STEPS,
  useWorkspaceStore,
} from "../../stores/workspace";
import { useProjectStore } from "../../stores/project";

const workspace = useWorkspaceStore();
const project = useProjectStore();

const stepIcons = [Edit, Document, Film, Box, PictureFilled, VideoCameraFilled];

const currentStepStatus = computed(() => {
  const status = project.state.value.currentStatus;
  // 根据项目状态判断哪些步骤已完成
  const statusOrder: string[] = [
    "topic_selected",
    "script_generated",
    "storyboard_generated",
    "asset_plan_generated",
    "assets_ready",
    "video_composed",
  ];
  const currentIdx = statusOrder.indexOf(status);
  return (stepIndex: number) => {
    if (stepIndex < currentIdx) return "completed" as const;
    if (stepIndex === currentIdx) return "active" as const;
    return "pending" as const;
  };
});

function getStepStatus(stepIndex: number) {
  return currentStepStatus.value(stepIndex);
}
</script>

<template>
  <aside
    class="workspace-sidebar"
    :class="{ 'workspace-sidebar--collapsed': workspace.state.value.sidebarCollapsed }"
  >
    <div class="sidebar-header">
      <span v-if="!workspace.state.value.sidebarCollapsed" class="sidebar-title">
        {{ project.state.value.projectId || 'StoryForge' }}
      </span>
      <el-button
        :icon="workspace.state.value.sidebarCollapsed ? Expand : Fold"
        text
        size="small"
        @click="workspace.toggleSidebar()"
      />
    </div>

    <el-menu
      :default-active="String(workspace.state.value.currentStepIndex)"
      :collapse="workspace.state.value.sidebarCollapsed"
      :collapse-transition="true"
      @select="(index: string) => workspace.setCurrentStep(Number(index))"
    >
      <el-tooltip
        v-for="(step, i) in PIPELINE_STEPS"
        :key="step.key"
        :content="step.label"
        placement="right"
        :disabled="!workspace.state.value.sidebarCollapsed"
      >
        <el-menu-item :index="String(i)">
          <el-icon><component :is="stepIcons[i]" /></el-icon>
          <template #title>
            <span>{{ step.label }}</span>
            <span v-if="getStepStatus(i) === 'completed'" class="step-check">✓</span>
          </template>
        </el-menu-item>
      </el-tooltip>
    </el-menu>

    <div class="sidebar-footer">
      <el-tooltip content="返回项目列表" placement="right" :disabled="!workspace.state.value.sidebarCollapsed">
        <el-button text @click="$router.push('/projects')">
          <el-icon><Back /></el-icon>
          <span v-if="!workspace.state.value.sidebarCollapsed">返回项目列表</span>
        </el-button>
      </el-tooltip>
    </div>
  </aside>
</template>

<style scoped>
.workspace-sidebar {
  width: var(--sidebar-expanded-width);
  background: var(--bg-sidebar);
  border-right: 1px solid var(--border-default);
  display: flex;
  flex-direction: column;
  transition: width 0.3s ease;
  overflow: hidden;
  flex-shrink: 0;
}

.workspace-sidebar--collapsed {
  width: var(--sidebar-collapsed-width);
}

.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 8px 12px 16px;
  border-bottom: 1px solid var(--border-default);
}

.sidebar-title {
  font-size: 14px;
  font-weight: var(--font-subheading);
  color: var(--text-heading);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.step-check {
  margin-left: 8px;
  color: var(--color-success);
  font-size: 12px;
}

.sidebar-footer {
  margin-top: auto;
  padding: 8px;
  border-top: 1px solid var(--border-default);
}
</style>
```

- [ ] **Step 2: 提交**

```bash
git add frontend/src/components/workspace/WorkspaceSidebar.vue
git commit -m "feat: 创建可折叠侧边栏组件 WorkspaceSidebar"
```

---

### Task 6: 创建 WorkspaceHeader + WorkspaceFooter + ThemeToggle

**Files:**
- Create: `frontend/src/components/workspace/WorkspaceHeader.vue`
- Create: `frontend/src/components/workspace/WorkspaceFooter.vue`
- Create: `frontend/src/components/workspace/ThemeToggle.vue`

- [ ] **Step 1: 创建 WorkspaceHeader**

顶部栏显示当前步骤标题和操作按钮。

```vue
<script setup lang="ts">
import { computed } from "vue";
import { ElBreadcrumb, ElBreadcrumbItem } from "element-plus";
import { PIPELINE_STEPS, useWorkspaceStore } from "../../stores/workspace";

const workspace = useWorkspaceStore();

const currentStep = computed(
  () => PIPELINE_STEPS[workspace.state.value.currentStepIndex]
);
</script>

<template>
  <header class="workspace-header">
    <el-breadcrumb separator="/">
      <el-breadcrumb-item>项目</el-breadcrumb-item>
      <el-breadcrumb-item>{{ currentStep.label }}</el-breadcrumb-item>
    </el-breadcrumb>
    <div class="header-right">
      <slot name="actions" />
    </div>
  </header>
</template>

<style scoped>
.workspace-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px var(--space-md);
  border-bottom: 1px solid var(--border-default);
  background: var(--bg-panel);
}
.header-right {
  display: flex;
  gap: var(--space-sm);
}
</style>
```

- [ ] **Step 2: 创建 WorkspaceFooter**

底部导航栏，显示上一步/下一步按钮。

```vue
<script setup lang="ts">
import { ElButton } from "element-plus";
import { ArrowLeft, ArrowRight } from "@element-plus/icons-vue";
import { PIPELINE_STEPS, useWorkspaceStore } from "../../stores/workspace";

const workspace = useWorkspaceStore();
</script>

<template>
  <footer class="workspace-footer">
    <el-button
      :icon="ArrowLeft"
      :disabled="workspace.isFirstStep()"
      @click="workspace.prevStep()"
    >
      {{ workspace.isFirstStep() ? '' : PIPELINE_STEPS[workspace.state.value.currentStepIndex - 1]?.label }}
    </el-button>

    <slot name="center" />

    <el-button
      type="primary"
      :disabled="workspace.isLastStep()"
      @click="workspace.nextStep()"
    >
      {{ workspace.isLastStep() ? '' : PIPELINE_STEPS[workspace.state.value.currentStepIndex + 1]?.label }}
      <el-icon class="el-icon--right"><ArrowRight /></el-icon>
    </el-button>
  </footer>
</template>

<style scoped>
.workspace-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px var(--space-md);
  border-top: 1px solid var(--border-default);
  background: var(--bg-panel);
}
</style>
```

- [ ] **Step 3: 创建 ThemeToggle**

```vue
<script setup lang="ts">
import { ElButton, ElIcon, ElTooltip } from "element-plus";
import { Sunny, Moon } from "@element-plus/icons-vue";
import { useTheme } from "../../composables/useTheme";

const { currentTheme, toggleTheme } = useTheme();
</script>

<template>
  <el-tooltip :content="currentTheme === 'cinematic-dark' ? '切换到明亮模式' : '切换到暗色模式'">
    <el-button circle :icon="currentTheme === 'cinematic-dark' ? Sunny : Moon" @click="toggleTheme()" />
  </el-tooltip>
</template>
```

- [ ] **Step 4: 提交**

```bash
git add frontend/src/components/workspace/WorkspaceHeader.vue frontend/src/components/workspace/WorkspaceFooter.vue frontend/src/components/workspace/ThemeToggle.vue
git commit -m "feat: 创建工作区 Header/Footer/主题切换组件"
```

---

### Task 7: 创建 ProjectWorkspace.vue（核心 Shell）

**Files:**
- Create: `frontend/src/views/ProjectWorkspace.vue`

这是最核心的页面——左侧侧边栏 + 右侧动态步骤内容。使用 `keep-alive` 缓存各步骤组件状态。

- [ ] **Step 1: 创建 ProjectWorkspace.vue**

```vue
<script setup lang="ts">
import { computed, onMounted, provide, watch } from "vue";
import { useRoute } from "vue-router";
import {
  createWorkspaceStore,
  workspaceStoreKey,
  type PipelineStep,
} from "../stores/workspace";
import { useProjectStore } from "../stores/project";
import WorkspaceSidebar from "../components/workspace/WorkspaceSidebar.vue";
import WorkspaceHeader from "../components/workspace/WorkspaceHeader.vue";
import WorkspaceFooter from "../components/workspace/WorkspaceFooter.vue";
import ThemeToggle from "../components/workspace/ThemeToggle.vue";
import TopicPanel from "../components/topic/TopicPanel.vue";
import ScriptPanel from "../components/script/ScriptPanel.vue";
import StoryboardPanel from "../components/storyboard/StoryboardPanel.vue";
import AssetPlanningPanel from "../components/asset-planning/AssetPlanningPanel.vue";
import AssetPanel from "../components/asset/AssetPanel.vue";
import ComposePanel from "../components/compose/ComposePanel.vue";

const route = useRoute();
const projectStore = useProjectStore();

const workspace = createWorkspaceStore();
provide(workspaceStoreKey, workspace);

const stepComponents: Record<PipelineStep, any> = {
  topic: TopicPanel,
  script: ScriptPanel,
  storyboard: StoryboardPanel,
  "asset-planning": AssetPlanningPanel,
  asset: AssetPanel,
  compose: ComposePanel,
};

const currentComponent = computed(
  () => stepComponents[workspace.currentStepKey()]
);

onMounted(async () => {
  const projectId = route.params.projectId as string;
  if (projectId) {
    await projectStore.syncProject(projectId);
  }
});
</script>

<template>
  <div class="workspace-layout">
    <WorkspaceSidebar />
    <div class="workspace-main">
      <WorkspaceHeader>
        <template #actions>
          <ThemeToggle />
        </template>
      </WorkspaceHeader>
      <main class="workspace-content">
        <Transition name="fade" mode="out-in">
          <component :is="currentComponent" :key="workspace.state.value.currentStepIndex" />
        </Transition>
      </main>
      <WorkspaceFooter />
    </div>
  </div>
</template>

<style scoped>
.workspace-layout {
  display: flex;
  height: 100vh;
  overflow: hidden;
  background: var(--bg-base);
}

.workspace-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
}

.workspace-content {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-md);
}
</style>
```

- [ ] **Step 2: 提交**

```bash
git add frontend/src/views/ProjectWorkspace.vue
git commit -m "feat: 创建项目工作区 Shell 页面 ProjectWorkspace"
```

---

### Task 8: 更新路由

**Files:**
- Modify: `frontend/src/router/index.ts`

- [ ] **Step 1: 添加新路由，保留旧路由暂时不删**

添加 `/projects/:projectId` 路由指向 ProjectWorkspace。旧的步骤路由暂时保留，确保迁移期间旧页面仍可访问。

```ts
import { createMemoryHistory, createRouter, createWebHistory } from "vue-router";

import AssetPlanningPage from "../views/AssetPlanningPage.vue";
import HomePage from "../views/HomePage.vue";
import ProjectsPage from "../views/ProjectsPage.vue";
import ProjectWorkspace from "../views/ProjectWorkspace.vue";
import ScriptPage from "../views/ScriptPage.vue";
import StoryboardPage from "../views/StoryboardPage.vue";
import TopicPage from "../views/TopicPage.vue";

export function createAppRouter(mode: "memory" | "web" = "memory") {
  return createRouter({
    history: mode === "web" ? createWebHistory() : createMemoryHistory(),
    routes: [
      { path: "/", component: HomePage },
      { path: "/projects", component: ProjectsPage },
      { path: "/projects/:projectId", component: ProjectWorkspace },
      // 旧路由（迁移完成后删除）
      { path: "/projects/:projectId/topic", component: TopicPage },
      { path: "/projects/:projectId/script", component: ScriptPage },
      { path: "/projects/:projectId/storyboard", component: StoryboardPage },
      { path: "/projects/:projectId/asset-plan", component: AssetPlanningPage },
      { path: "/topic", redirect: "/projects" },
      { path: "/script", redirect: "/projects" },
    ],
  });
}
```

注意：`/projects/:projectId` 必须在 `/projects/:projectId/topic` 之前定义，否则后者会优先匹配。

- [ ] **Step 2: 验证路由生效**

```bash
cd frontend && npm run dev
```
访问 `http://localhost:5173/projects/some-id`，应看到工作区 shell（侧边栏 + 空内容区）。

- [ ] **Step 3: 提交**

```bash
git add frontend/src/router/index.ts
git commit -m "feat: 添加 ProjectWorkspace 路由，保留旧路由用于迁移过渡"
```

---

## 阶段三：步骤面板组件

> 以下每个 Task 创建一个步骤面板组件，内容从对应的旧 view 迁移而来。使用 Element Plus 组件替换手写样式。各面板通过 inject 获取对应的 store。

### Task 9: 创建 TopicPanel

**Files:**
- Create: `frontend/src/components/topic/TopicPanel.vue`

- [ ] **Step 1: 创建选题步骤面板**

从 `TopicPage.vue` 迁移核心逻辑，使用 Element Plus 组件。布局为双栏（左候选列表 : 右详情）。核心功能：来源切换（el-tabs）、候选卡片列表、选题详情展示、确认/重新生成操作。

组件需要：
- inject `topicStore` 和 `projectStore`
- el-tabs 切换来源（系统推荐/事件库/自定义）
- 左栏：el-card 列表显示候选选题，点击选中
- 右栏：选中选题的详情（角度、冲突、钩子、风险）
- el-button 操作（确认选题、重新生成）
- el-skeleton 加载态
- 错误状态卡片（生成失败时）
- el-popconfirm 二次确认（重新生成）

布局参考设计文档 3.1 节。

- [ ] **Step 2: 验证功能**

访问工作区，切换到选题步骤，确认：
- 候选列表正常显示
- 点击候选可查看详情
- 生成按钮触发 loading 态
- 确认选题可正常操作

- [ ] **Step 3: 提交**

```bash
git add frontend/src/components/topic/TopicPanel.vue
git commit -m "feat: 创建选题步骤面板 TopicPanel"
```

---

### Task 10: 创建 ScriptPanel

**Files:**
- Create: `frontend/src/components/script/ScriptPanel.vue`

- [ ] **Step 1: 创建文案步骤面板**

从 `ScriptPage.vue` 迁移，使用 Element Plus。布局为双栏（左文案正文 : 右审查+操作）。核心功能：
- 左栏：分段展示文案（开头/正文/结尾）
- 右栏：审查结果列表（el-tag 标记通过/建议优化）+ 操作按钮
- 底部显示修补/重新生成剩余次数
- el-skeleton / 错误状态

布局参考设计文档 3.2 节。

- [ ] **Step 2: 验证功能**
- [ ] **Step 3: 提交**

```bash
git commit -m "feat: 创建文案步骤面板 ScriptPanel"
```

---

### Task 11: 创建 StoryboardPanel

**Files:**
- Create: `frontend/src/components/storyboard/StoryboardPanel.vue`

- [ ] **Step 1: 创建分镜步骤面板**

从 `StoryboardPage.vue` 迁移。布局为全宽卡片列表。核心功能：
- 每个镜头为三列卡片（编号+时长 | 文案片段 | 画面意图+标签）
- el-collapse 折叠/展开
- 验证结果显示
- 重新生成按钮

布局参考设计文档 3.3 节。

- [ ] **Step 2: 验证功能**
- [ ] **Step 3: 提交**

```bash
git commit -m "feat: 创建分镜步骤面板 StoryboardPanel"
```

---

### Task 12: 创建 AssetPlanningPanel

**Files:**
- Create: `frontend/src/components/asset-planning/AssetPlanningPanel.vue`

- [ ] **Step 1: 创建资产规划步骤面板**

从 `AssetPlanningPage.vue` 迁移。布局为摘要卡片+任务列表。核心功能：
- 顶部 4 个 el-statistic 摘要卡片
- 任务列表（el-table 或卡片列表）
- 可展开查看详情
- 重新生成按钮

布局参考设计文档 3.4 节。

- [ ] **Step 2: 验证功能**
- [ ] **Step 3: 提交**

```bash
git commit -m "feat: 创建资产规划步骤面板 AssetPlanningPanel"
```

---

### Task 13: 创建 AssetPanel（占位）

**Files:**
- Create: `frontend/src/components/asset/AssetPanel.vue`

- [ ] **Step 1: 创建资产生成步骤面板（占位）**

由于后端资产生成功能尚未实现，此面板为占位设计。展示预期的布局结构：
- 多阶段并行进度条（封面/图片/语音/BGM）
- 已生成资产缩略图网格
- 参考设计文档 3.5 节

```vue
<script setup lang="ts">
import { ElEmpty, ElProgress, ElCard, ElRow, ElCol } from "element-plus";
</script>

<template>
  <div class="asset-panel">
    <ElEmpty description="资产生成功能开发中，请先完成资产规划步骤" />
  </div>
</template>

<style scoped>
.asset-panel {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 400px;
}
</style>
```

- [ ] **Step 2: 提交**

```bash
git add frontend/src/components/asset/AssetPanel.vue
git commit -m "feat: 创建资产生成步骤面板占位组件"
```

---

### Task 14: 创建 ComposePanel（占位）

**Files:**
- Create: `frontend/src/components/compose/ComposePanel.vue`

- [ ] **Step 1: 创建合成视频步骤面板（占位）**

```vue
<script setup lang="ts">
import { ElEmpty } from "element-plus";
</script>

<template>
  <div class="compose-panel">
    <ElEmpty description="视频合成功能开发中" />
  </div>
</template>

<style scoped>
.compose-panel {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 400px;
}
</style>
```

- [ ] **Step 2: 提交**

```bash
git add frontend/src/components/compose/ComposePanel.vue
git commit -m "feat: 创建合成视频步骤面板占位组件"
```

---

## 阶段四：其他页面迁移

### Task 15: 重写 HomePage

**Files:**
- Modify: `frontend/src/views/HomePage.vue`

- [ ] **Step 1: 使用 Element Plus 重写首页**

保留首页的功能（导航到项目列表、创建新项目），用 Element Plus 组件替换手写样式。使用主题变量。

- [ ] **Step 2: 验证首页显示正常**
- [ ] **Step 3: 提交**

```bash
git commit -m "feat: 使用 Element Plus 重写首页"
```

---

### Task 16: 重写 ProjectsPage

**Files:**
- Modify: `frontend/src/views/ProjectsPage.vue`

- [ ] **Step 1: 使用 Element Plus 重写项目列表页**

这是最大的单文件迁移（当前 983 行）。核心功能：
- 虚拟滚动列表 → 考虑使用 el-table-v2 或保留自定义虚拟滚动
- 搜索栏 → el-input + search 图标
- 筛选器 → el-select / el-radio-group
- 创建项目 → el-button + el-dialog
- 删除项目 → el-popconfirm
- 进入项目 → 路由到 `/projects/:id`（新路由）

关键变化：进入项目时导航到 `/projects/:id` 而非 `/projects/:id/topic`。

- [ ] **Step 2: 验证项目列表功能完整**
- [ ] **Step 3: 提交**

```bash
git commit -m "feat: 使用 Element Plus 重写项目列表页"
```

---

## 阶段五：清理与收尾

### Task 17: 清理旧文件和旧路由

**Files:**
- Modify: `frontend/src/router/index.ts`
- Delete: `frontend/src/components/topic/TopicTabs.vue`（如果不再使用）
- Delete/Archive: 旧 view 文件（TopicPage, ScriptPage, StoryboardPage, AssetPlanningPage）
- Delete/Archive: 旧 components 中被替换的子组件

- [ ] **Step 1: 移除旧路由**

从 router 中删除 `/projects/:projectId/topic`、`/projects/:projectId/script`、`/projects/:projectId/storyboard`、`/projects/:projectId/asset-plan`。

- [ ] **Step 2: 移除不再使用的旧组件**

确认所有功能已迁移到新面板后，删除：
- `views/TopicPage.vue`
- `views/ScriptPage.vue`
- `views/StoryboardPage.vue`
- `views/AssetPlanningPage.vue`
- `components/topic/TopicTabs.vue`（被 WorkspaceSidebar 替代）
- `components/topic/TopicCandidateList.vue`（合并入 TopicPanel）
- `components/topic/TopicCandidateDrawer.vue`（合并入 TopicPanel）
- `components/script/ScriptDraftPanel.vue`、`ScriptStatusPanel.vue`、`ScriptReviewPanel.vue`、`ScriptTracePanel.vue`、`ScriptHistoryPanel.vue`（合并入 ScriptPanel）
- `components/storyboard/StoryboardSegmentList.vue`（合并入 StoryboardPanel）
- `components/asset-planning/AssetPlanSummary.vue`、`AssetTaskList.vue`（合并入 AssetPlanningPanel）

- [ ] **Step 3: 验证应用正常运行**

完整走一遍流程：首页 → 项目列表 → 创建项目 → 进入工作区 → 各步骤操作。

- [ ] **Step 4: 提交**

```bash
git commit -m "refactor: 清理旧路由和已替换的组件文件"
```

---

### Task 18: 最终验证与修复

**Files:**
- 可能涉及多个文件的微调

- [ ] **Step 1: 全流程手动测试**

在浏览器中完整测试以下流程：
1. 首页正常展示
2. 项目列表：搜索、筛选、创建、删除
3. 进入项目工作区：侧边栏折叠/展开
4. 选题步骤：生成候选、查看详情、确认
5. 文案步骤：查看文案、审查结果、修补/重新生成
6. 分镜步骤：查看镜头列表、确认
7. 资产规划步骤：查看摘要和任务列表、确认
8. 资产/合成步骤：占位页面正常
9. 主题切换：暗色↔明亮正常生效
10. 响应式：窄屏下侧边栏自动折叠

- [ ] **Step 2: 修复发现的问题**

- [ ] **Step 3: 最终提交**

```bash
git commit -m "fix: 最终验证修复"
```
