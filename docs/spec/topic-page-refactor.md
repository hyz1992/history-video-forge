# 选题页重构方案

> 将 `preview-workspace-topic.html` 的设计落地到 Vue 项目

---

## 1. 核心差异概览

| 维度 | 现有 TopicPanel.vue | 预览设计 | 改动方向 |
|------|---------------------|----------|----------|
| **色彩体系** | CSS 变量通用暗色 (`--bg-base`, `--accent-primary`) | 暖金铜色调 (`--accent-gold`, `--accent-copper`, `--accent-warm`) | CSS 变量体系扩展 |
| **组件库** | Element Plus（`el-tabs`, `el-select`, `el-button` 等） | 纯 HTML/CSS，无第三方 UI 库 | 逐步替换为自研组件 |
| **顶部 Tab** | `el-tabs` 切换系统推荐/事件库/自定义 | 已移除（在 CreateTopicModal 中完成选择） | 删除 TopicPanel 内 Tab 栏 |
| **顶部导航** | 侧边栏内项目信息 + 管线步骤 | Topbar 面包屑（未命名项目 › 🎯 选题） | 项目名由 ProjectWorkspace 的 header 或全局 topbar 承载 |
| **侧边栏** | WorkspaceSidebar：步骤列表 + 门禁 | Sidebar：Current Project 卡片 + 7 步骤（含 done/disabled 态） | 渲染方式微调，加入项目卡片 |
| **候选列表** | 带排名序号圆形标签 + 大内边距卡片 | 无序号、紧凑卡片、hover 右移 3px、激活态金色边框+渐起阴影 | 简化卡片结构 |
| **筛选器** | 在 TopicPanel 内展示 era/tension 选择器 | 已完全移除（在 CreateTopicModal 中已选择） | **删除 TopicPanel 内筛选器** |
| **详情卡片** | 4 个 section（核心冲突/传播切口/叙事张力/风险提示） | 3 个 section（核心冲突/传播切口/风险提示），header 中含 title+angle | 精简 |
| **历史轮次** | 独立区域，每个轮次一组 compact 卡片 | 与候选列表同一卡片区，折叠式展开 | 保留折叠交互，去除分类标签 |
| **底部操作栏** | 重新生成 / 换一批 / 确认选题 三个按钮 | "换一批" 移到候选历史同行右侧，"确认选题" 仅存在于详情卡片底部 | 精简到底 |
| **生成中态** | `StageGenerating` 组件（通用） | 居中全页（`.center-state`），脉冲动画 + 秒数计时 + 刷新按钮 | 保持 StageGenerating，优化视觉 |
| **错误态** | `el-alert` + 重试按钮 | 居中全页（`.center-state`），红色图标 + 标题 + 描述 + 操作按钮 | 改用自定义样式 |
| **空态** | 已在上轮从 preview 中移除 | 同样移除 | 保持移除 |

---

## 2. 改动清单

### 2.1 不改动的文件

| 文件 | 说明 |
|------|------|
| `stores/topic.ts` | Store 逻辑完整，无需修改 |
| `stores/workspace.ts` | PIPELINE_STEPS 定义不变 |
| `stores/project.ts` | 项目状态管理不变 |
| `composables/useStagePolling.ts` | 轮询逻辑不变 |
| `router/index.ts` | 路由结构不变 |
| `CreateTopicModal.vue` | 已完工，无需修改 |
| `ProjectWorkspace.vue` | 布局容器不变（`<component :is="currentPanel">`） |
| `WorkspaceSidebar.vue` | 可能需要微调样式以匹配预览 |

### 2.2 需要修改的文件

| 文件 | 改动量 | 说明 |
|------|--------|------|
| `TopicPanel.vue` | ★★★★★ | 核心重构目标，模板+样式几乎全改写 |
| `StageGenerating.vue` | ★★☆☆☆ | 优化视觉，添加秒数计时 |
| `WorkspaceSidebar.vue` | ★★☆☆☆ | 加入项目信息卡片，微调步骤样式 |
| `WorkspaceHeader.vue` | ★★☆☆☆ | 加入面包屑导航 |

### 2.3 全局 CSS 变量扩展

当前项目使用的暗色主题变量（`--bg-base`, `--bg-card`, `--accent-primary` 等）需要扩展以支持预览的金色调。建议在基础主题之上叠加一个话题页专用 class 或在 component scoped 中覆写。

**新增 CSS 变量建议：**

```css
/* 预览设计中对应的变量 → 现有变量映射方案 */
--accent-gold: #c9a227;        /* → --accent-primary (值需调整) */
--accent-gold-light: #e4c26f;  /* → --accent-secondary */
--accent-copper: #b87333;      /* → 新增或映射至 --btn-primary-end */
--accent-warm: #d4a574;        /* → 新增 */
--text-dim: #4f4841;           /* → --text-muted (值需调整) */
--border-soft: rgba(201,162,39,0.13); /* 新增半透明边框变量 */
--border-active: rgba(201,162,39,0.34); /* 新增 */
--shadow-card: ...;            /* 新增卡片阴影变量 */
--shadow-heavy: ...;           /* 新增重阴影变量 */
--radius-xl: 24px;             /* 新增 */
--font-serif: "Noto Serif SC", "Songti SC", Georgia, serif; /* 新增衬线字体 */
```

> **决策点**：是全局修改 CSS 变量体系让整个应用统一金色，还是仅 topic 页面局部使用？建议以 `topic-panel` 容器为作用域，在 scoped style 中用 CSS 变量覆写方式实现，不动全局变量。

---

## 3. TopicPanel.vue 重构详细方案

### 3.1 状态管理（不变）

保留 5 种状态的判断逻辑，仅改渲染 UI：

```
loadError  → 错误态 → 改用自定义 .center-error 样式
!hasCandidates && (isGenerating || isSnapshotGenerating || isPolling) → 生成中 → StageGenerating
!hasCandidates && !isGenerating && !loadError → 正常展示有候选（实际项目流程中空态由 CreateTopicModal 覆盖）
hasCandidates → 双列布局
activeTab !== "system" → 占位面板
```

### 3.2 模板结构对比

#### 旧模板（简化）
```html
<div class="topic-panel">
  <div class="topic-action-bar">       <!-- el-tabs 切换 + 轮次 badge -->
  <div v-if="..." class="topic-error-card">
  <StageGenerating v-else-if="..." />
  <div v-else class="topic-content">
    <div class="topic-filters-bar">    <!-- 筛选器行：era + tension -->
    <div class="topic-columns">
      <div class="topic-left-col">     <!-- 候选列表 + 历史 -->
      <div class="topic-right-col">    <!-- 详情卡片 -->
    <div class="topic-bottom-actions"> <!-- 底部操作栏 -->
</div>
```

#### 新模板（目标）
```html
<div class="topic-panel">
  <h1 class="topic-page-title">请选择您喜欢的<em>选题</em></h1>

  <div class="topic-columns">
    <section class="topic-left-col panel-card">
      <div class="candidate-list">
        <!-- 候选卡片列表 -->
      </div>
      <div class="history-block">
        <div class="history-top">
          <button class="history-toggle"> ▶ 候选历史 </button>
          <button class="action-btn"> ↺ 换一批 </button>
        </div>
        <div class="history-rounds" v-if="historyOpen">...</div>
      </div>
    </section>

    <aside class="topic-right-col">
      <div class="detail-card">      <!-- 详情卡片 -->
        <div class="detail-header">
          <div class="detail-kicker">选题详情</div>
          <h2 class="detail-title">...</h2>
          <p class="detail-angle">...</p>
        </div>
        <div class="detail-tags">...</div>
        <div class="detail-sections">
          <section class="detail-section">⚔️ 核心冲突</section>
          <section class="detail-section">📡 传播切口</section>
          <section class="detail-section">⚠️ 风险提示</section>
        </div>
        <div class="detail-footer">
          <button class="confirm-btn">确认此选题，进入文案阶段</button>
        </div>
      </div>
    </aside>
  </div>
</div>
```

### 3.3 关键 CSS 类对照

| 预览类名 | 现有类名 | 改动 |
|----------|----------|------|
| `.topic-panel` | `.topic-panel` | 完全重写，移除 gap-md 等旧属性 |
| `.topic-page-title` (h1) | — | **新增**，28px 衬线标题 |
| `.panel-card` | — | **新增**，统一卡片容器样式 |
| `.topic-columns` | `.topic-columns` | 改用固定左列 455px |
| `.topic-left-col` | `.topic-left-col` | 去除多余 header |
| `.topic-right-col` | `.topic-right-col` | sticky 位置微调 |
| `.candidate-list` | `.topic-candidate-list` | **重命名**，新样式 |
| `.candidate-card` | `.topic-candidate-card` | **重命名**，新 hover/active 样式 |
| `.candidate-body` | `.topic-candidate-card-body` | 精简 |
| `.candidate-title` | `.topic-candidate-title` | 微调字号颜色 |
| `.candidate-angle` | `.topic-candidate-angle` | -2行截断 |
| `.candidate-tags` / `.candidate-tag` | `.topic-candidate-tags` | 金色边框 |
| `.history-block` | `.topic-history` | **重命名+重写** |
| `.history-top` | — | **新增**，flex space-between |
| `.history-toggle` | `.topic-history-toggle` | **重命名** |
| `.history-rounds` | `.topic-history-round` | **重命名** |
| `.detail-card` | `.topic-detail-card` | **重命名** |
| `.detail-header` | `.topic-detail-header` | **完全重写** |
| `.detail-kicker` | `.topic-detail-kicker` | 微调 |
| `.detail-tags` | `.topic-detail-tags` | 微调 |
| `.detail-sections` | — | **新增**容器 |
| `.detail-section` | `.topic-detail-section` | **重写** |
| `.detail-icon` | — | **新增**，图标容器 |
| `.detail-section-label` | `.topic-detail-section-title` | **重命名** |
| `.detail-section-text` | `.topic-detail-section-text` | 微调 |
| `.detail-footer` | — | **新增** |
| `.confirm-btn` | `.topic-detail-confirm-btn` | **重命名+重写** |
| `.action-btn` | — | **新增**小按钮样式 |
| — 删除 — | `.topic-action-bar` | 移除整个顶部 tab 栏 |
| — 删除 — | `.topic-filters-bar` | 移除筛选器行 |
| — 删除 — | `.topic-bottom-actions` | 移除底部操作栏 |
| — 删除 — | `.topic-empty-state` | 移除空态 |

### 3.4 需要删除的代码清单

| 项目 | 描述 |
|------|------|
| `.topic-action-bar` 模板块 | 整个 el-tabs + el-badge 区域 |
| `.topic-filters-bar` 模板块 | el-select 筛选器 |
| `.topic-bottom-actions` 模板块 | 重新生成/换一批/确认按钮行 |
| `.topic-empty-state` 模板块 | 空态 UI |
| 所有 `el-tabs` / `el-select` 相关 import 和逻辑 | 不再使用 |
| `eraFilter` / `tensionFilter` 本地状态 | 已在 CreateTopicModal 中处理 |
| 旧 CSS ~300 行 | 几乎全部重写 |

### 3.5 保留的功能逻辑

| 功能 | 状态 | 说明 |
|------|------|------|
| `selectCandidate()` | 保留 | 点击卡片更新 `selectedCandidate` |
| `confirmCandidate()` | 保留 | 确认选题→跳转 script 步骤 |
| `handleRegenerate()` | 保留 | 重新生成 + 旧轮次进历史 |
| `handleRefreshBatch()` | 保留 | 换一批（映射到重新生成） |
| `toggleHistory()` | **新增** | 折叠/展开历史轮次 |
| `useStagePolling` | 保留 | F5 恢复 + 后台轮询 |
| `loadExistingTopic()` | 保留 | 从后端快照恢复 |
| `generateRecommendations()` | 保留 | 调用 store 生成 |

---

## 4. StageGenerating.vue 优化

### 4.1 当前样式
```html
<div class="stage-generating">
  <h2 class="stage-generating-title">...</h2>
  <p class="stage-generating-hint">...</p>
  <slot name="action" />
</div>
```

### 4.2 目标样式
参考预览的 `.center-state` 设计：
- 居中布局，`min-height: calc(100vh - 72px)`
- 脉冲动画图标（`.center-pulse` with `::before`/`::after` rings）
- 带秒数计时文字 "已等待 **N** 秒"
- 底部装饰分隔线
- 刷新按钮居中

### 4.3 改动
- 新增 `elapsedSeconds` prop 或内部计时
- 新增 `.stage-generating` → 全屏居中
- 新增 pulse ring CSS 动画
- 保持 `#action` slot 不变

---

## 5. WorkspaceSidebar.vue 微调

### 5.1 预览中的侧边栏结构
```
Current Project
┌────────────────────┐
│ 未命名项目           │
│ 选题阶段 · 自动推荐   │
└────────────────────┘

🎯 选题        ✓
📝 文案          (disabled)
🎬 分镜          (disabled)
🖼️ 素材          (disabled)
🎞️ 合成          (disabled)
🎥 渲染          (disabled)
🚀 发布          (disabled)
```

### 5.2 现有 WorkspaceSidebar 结构
- 只有步骤列表（el-menu-item）
- 通过 `projectStore.state.name` 获取项目名
- 通过前缀匹配判断 done/disabled

### 5.3 改动
- 在步骤列表上方新增项目信息卡片（`.project-mini`）
- 步骤图标使用 emoji 匹配（与预览一致：🎯 📝 🎬 🖼️ 🎞️ 🎥 🚀）
- 当前步骤高亮金色
- `done` 态显示绿色 ✓

---

## 6. WorkspaceHeader.vue 新增面包屑

当前 WorkspaceHeader 可能只展示标题/返回按钮。需要在其中加入面包屑导航：

```
未命名项目 › 🎯 选题      [返回项目列表]
```

数据来源：
- 项目名：`projectStore.state.name ?? '未命名项目'`
- 当前步骤：`workspaceStore.currentStepKey` → 映射中文标签

---

## 7. 实施计划

### Phase 1：CSS 变量 & 基础样式
- [ ] 确认 CSS 变量策略（全局 vs 局部覆写）
- [ ] 在 TopicPanel 中引入所有新 CSS 变量
- [ ] 编写 `.panel-card` / `.candidate-card` / `.detail-card` 等核心 class

### Phase 2：TopicPanel 模板重构
- [ ] 移除旧 Template 中不再需要的区块
- [ ] 编写新 Template 结构
- [ ] 更新 script 中的 computed（删除不再引用的）
- [ ] 单元功能验证（候选列表/详情/历史/确认）

### Phase 3：StageGenerating 升级
- [ ] 添加脉冲动画 + 计时
- [ ] 修改组件 props

### Phase 4：侧边栏 & 顶部栏
- [ ] WorkspaceSidebar 加入项目信息卡片
- [ ] 步骤图标改为 emoji
- [ ] WorkspaceHeader 加入面包屑

### Phase 5：清理 & 验证
- [ ] 删除旧 CSS（约 300 行）
- [ ] 删除不再使用的 Element Plus 组件导入
- [ ] 端到端验证完整流程

---

## 8. 风险 & 注意事项

1. **CSS 变量体系**：当前项目可能在其他页面也使用了 `--accent-primary` 等变量。如果全局修改变量值会影响其他页面。建议在 TopicPanel scoped 中局部覆写，或为 topic 相关组件创建专用 CSS class 命名空间。

2. **Element Plus 依赖**：TopicPanel 中使用了 `el-tabs`、`el-select`、`el-button`、`el-tag`、`el-badge`、`el-alert`、`el-popconfirm`。重构后大部分可移除，但 `el-button` 可能在其他子组件中仍需要。逐个确认后移除 import。

3. **响应式**：预览设计未包含完整响应式。需保留原有的 `@media (max-width: 819px)` 断点逻辑。

4. **F5 恢复**：轮询逻辑和 `loadExistingTopic()` 不受影响，但需确认新 UI 状态下渲染路径正确。

5. **事件库/自定义选题 Tab**：预览中已移除这两个 Tab 的渲染（仅在 CreateTopicModal 中可选）。确认 TopicPanel 中也不再需要 `activeTab` 的条件渲染。
