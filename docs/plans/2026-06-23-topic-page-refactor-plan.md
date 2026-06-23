# 选题页重构：preview-workspace-topic.html → TopicPanel.vue

Date: 2026-06-23

## Review Guide

审阅或实施本计划前，先阅读以下文件：

- `AGENTS.md`
- `frontend/preview/preview-workspace-topic.html`（设计源文件，迁移基准）
- `frontend/src/components/topic/TopicPanel.vue`（当前选题面板，迁移目标）
- `frontend/src/components/topic/CreateTopicModal.vue`（已完成的新建项目弹窗，tab/筛选器已在此完成）
- `frontend/src/stores/topic.ts`（选题 store）
- `frontend/src/stores/workspace.ts`（管线步骤定义 + 侧边栏状态）
- `frontend/src/stores/project.ts`（项目状态）
- `frontend/src/composables/useStagePolling.ts`（生成轮询）
- `frontend/src/components/workspace/StageGenerating.vue`（生成中组件，已有 elapsedSeconds 计时）
- `frontend/src/components/workspace/WorkspaceHeader.vue`（已有 ElBreadcrumb 面包屑）
- `frontend/src/components/workspace/WorkspaceSidebar.vue`（侧边栏管线步骤）
- `frontend/src/views/ProjectWorkspace.vue`（工作区布局容器）
- `frontend/src/styles/tokens.css`（CSS 变量基准）
- `frontend/src/styles/theme-cinematic-dark.css`（暗色主题）
- `docs/plans/2026-06-21-landing-page-1-to-1-porting-plan.md`（前例：首页迁移计划，格式参照）
- `docs/plans/2026-06-22-projects-page-migration-plan.md`（前例：项目列表迁移计划）
- `docs/plans/README.md`（plans 状态与归档规则）

---

## 一、目标与边界

### 目标

1. 把 `preview-workspace-topic.html` 的视觉与交互迁移到 `TopicPanel.vue`。
2. 从 TopicPanel 中移除"自备"的筛选器/Tab 栏/空态——这些已在 `CreateTopicModal.vue` 中完成。
3. 保留所有现有业务逻辑（store 操作、轮询、F5 恢复、确认流程）。

### 当前基线（Current Baseline）

#### 现有 TopicPanel.vue

- 791 行（含 CSS），使用 Element Plus 组件（`el-tabs`、`el-select`、`el-button`、`el-tag`、`el-badge`、`el-alert`、`el-popconfirm`）。
- 模板包含 4 个 `data-testid`：两处 `candidate-item-${id}`（当前轮次候选卡片 L274 + 历史轮次 L312）、两处 `confirm-candidate`（详情卡片确认按钮 L374 + 底部操作栏 L411）。
- 顶部 `el-tabs` 切换"系统推荐 / 事件库 / 自定义选题"。
- 中间 `el-select` 筛选 era / tension。
- 空态 UI（大图标 + 说明文字 + 筛选器 + "开始生成选题"按钮）。
- 底部操作栏（"重新生成" / "换一批" / "确认选题"）。
- 生成中状态使用 `StageGenerating` 组件（含 elapsedSeconds 计时）。
- 左侧候选列表带圆形排名序号、右侧详情卡片 4 个 section（含"叙事张力"与 header angle 重复）。
- 通过 `provide/inject` 消费 `TopicStore`、`ProjectStore`、`WorkspaceStore`。

#### 现有 CreateTopicModal.vue（已完成）

- 3 Tab 切换（系统推荐 / 事件库 / 自定义选题）→ 已承担 Tab 选择职责。
- 历史时期 + 叙事偏好筛选（era / tension chip 组）→ 已承担筛选职责。
- 点击"开始生成选题"后 fire-and-forget 生成 + 关闭弹窗 + 跳转工作台。

#### 现有 StageGenerating.vue

- **已有** `elapsedSeconds` ref、`setInterval` 计时器、`title` prop（如"正在生成选题"）、含秒数的 `titleText` computed（如"正在生成选题...（42秒）"）、`hint` / `secondaryHint` props、`#action` slot。
- 缺少：预览中的脉冲光环动画（`::before`/`::after` rings）、底部装饰分隔线、全页居中布局。

#### 现有 WorkspaceHeader.vue

- **已有** `ElBreadcrumb` 渲染 `projectName › currentStepLabel` 面包屑。
- 缺少：emoji 阶段图标、自定义暗金样式。

### 不改什么

- **不修改** `stores/topic.ts`、`stores/workspace.ts`、`stores/project.ts`。
- **不修改** `composables/useStagePolling.ts`。
- **不修改** `router/index.ts`。
- **不修改** `CreateTopicModal.vue`（已完工）。
- **不修改** `ProjectWorkspace.vue`（布局容器不变）。
- **不修改** `preview-workspace-topic.html`（保留为验证对照）。
- **不修改** `tokens.css`、`theme-cinematic-dark.css`——不动项目共享主题变量。

---

## 二、CSS 变量策略（已决策）

### 策略：TopicPanel scoped 内局部覆写，不动全局变量

`preview-workspace-topic.html` 使用独立的暖金铜色变量体系（`--accent-gold`、`--accent-copper`、`--accent-warm` 等），与项目全局的 `--accent-primary`（`#d4a35f`）有色值差异。参照首页迁移方案的样式隔离策略（新建 `landing-page.css` 而非修改 `theme-cinematic-dark.css`）：

1. **在 TopicPanel.vue 的 `<style scoped>` 中覆写**：将预览中的 CSS 变量复制到 scoped 的 `:root` 等价选择器——实际上 Vue scoped 不支持 block 级 CSS 变量覆写，因此改用 `.topic-panel { --accent-gold: #c9a227; --accent-copper: #b87333; ... }` 在容器内定义变量，子元素通过 `var()` 继承。
2. **从 `theme-cinematic-dark.css` 继承全局变量**：`--bg-base`、`--bg-card` 等通用变量继续使用项目值，仅暖金色系变量在 scoped 内覆写。
3. **不污染全局**：不含 `.topic-panel` 包裹的选择器不会受到这些变量覆写的影响。

### 色值差异对照

| 变量名 | 预览值 | 现有全局值 | 策略 |
|--------|--------|-----------|------|
| `--bg-primary` | `#0d0d0d` | `--t-bg-base: #0a0f18` | 使用现有变量 |
| `--text-primary` | `#f5f0e8` | `--t-text-heading: #e8e4df` | 使用现有变量 |
| `--accent-gold` | `#c9a227` | `--t-accent-primary: #d4a35f` | scoped 覆写 |
| `--accent-copper` | `#b87333` | —（无对应） | scoped 新增 |
| `--accent-warm` | `#d4a574` | —（无对应） | scoped 新增 |
| `--border-soft` | `rgba(201,162,39,0.13)` | `--t-border-default` | scoped 新增 |
| `--shadow-card` | 多层 offset 阴影 | —（无对应） | scoped 新增 |

---

## 三、data-testid 保留与映射方案

当前 TopicPanel 有 4 个 `data-testid`，在新模板中按以下方式保留：

| 现有位置 | data-testid 值 | 新模板中的位置 |
|----------|---------------|---------------|
| 当前轮次候选卡片（L274） | `candidate-item-${candidate.candidate_id}` | `.candidate-card` 元素上，同现有写法 |
| 历史轮次候选卡片（L312） | `candidate-item-${candidate.candidate_id}` | 历史轮次 `.candidate-card` 元素上，同现有写法 |
| 详情卡片确认按钮（L374） | `confirm-candidate` | `.detail-footer` 内的 `.confirm-btn` 上 |
| 底部操作栏确认按钮（L411） | `confirm-candidate` | **删除**——新模板底部操作栏已移除，仅保留详情卡片中的确认按钮 |

> 注意：新模板中同一页面仅一处 `confirm-candidate`，不再有重复。

---

## 四、核心差异概览

| 维度 | 现有 TopicPanel.vue | 预览设计 | 改动方向 |
|------|---------------------|----------|----------|
| **色彩体系** | CSS 变量通用暗色 | 暖金铜色调 | TopicPanel scoped 内覆写 |
| **顶部 Tab** | `el-tabs` 切换 | 已移除 | 删除 |
| **筛选器** | era/tension `el-select` | 已移除 | 删除 |
| **空态 UI** | 大图标 + 说明 + 筛选器 | 已移除 | 删除 |
| **候选卡片** | 圆形序号 + el-tag | 无序号、紧凑、hover 右移 | 简化 |
| **详情卡片** | 4 个 section | 3 个 section（去重） | 精简 |
| **底部操作栏** | 重新生成/换一批/确认 | "换一批"→历史行；确认仅详情卡片底部 | 精简到底 |
| **生成中态** | StageGenerating | 加脉冲动画+分隔线 | 升级视觉 |
| **面包屑** | ElBreadcrumb 已有 | 加 emoji 图标+暗金样式 | 升级视觉 |
| **侧边栏** | 仅步骤列表 | 加项目信息卡片 + emoji 图标 | 微调 |

---

## 五、逐文件改动详情

### 组件分类

本方案涉及的 4 个文件分为两类：

| 类型 | 文件 | 影响范围 |
|------|------|----------|
| **共享布局** | `WorkspaceHeader.vue` | 选题 / 文案 / 分镜 / 资产 / 合成 / 渲染 / 发布 全部 7 阶段 |
| **共享布局** | `WorkspaceSidebar.vue` | 同上，全部 7 阶段 |
| **阶段面板** | `TopicPanel.vue` | 仅选题阶段 |
| **阶段面板** | `StageGenerating.vue` | 所有使用它的阶段（目前仅选题） |

> `ProjectWorkspace.vue` 的布局结构已天然分离 —— `<WorkspaceSidebar />` + `<WorkspaceHeader />` 为共享壳层，`<component :is="currentPanel" />` 动态渲染阶段面板。共享组件的改动在选题重构中一并完成，其他 6 个阶段将自动受益。

### 5.1 TopicPanel.vue — 核心重构

#### 5.1.1 模板改动

**删除的模板块**：
- `.topic-action-bar` — 整个 `el-tabs` + `el-badge` 区域
- `.topic-filters-bar` — `el-select` 筛选器行
- `.topic-bottom-actions` — 底部操作栏（重新生成 / 换一批 / 确认）
- `.topic-empty-state` — 空态 UI
- `.topic-col-heading` / `.topic-col-subtitle` — 左列标题/副标题（改用 h1 页面标题替代）

**新增/重写的模板块**：

```html
<template>
  <div class="topic-panel">
    <!-- 错误态 -->
    <div v-if="hasLoadError" class="center-state">
      <div class="center-state-inner">
        <div class="center-error-icon">!</div>
        <h2 class="center-state-title">选题生成失败</h2>
        <p class="center-state-desc">...</p>
        <div class="center-state-line"></div>
        <div class="center-state-actions">
          <button class="btn btn-ghost" @click="goBack">返回项目列表</button>
          <button class="btn btn-primary" @click="handleRegenerate">重新生成</button>
        </div>
      </div>
    </div>

    <!-- 生成中 -->
    <StageGenerating
      v-else-if="isGeneratingState"
      title="正在生成选题"
      hint="正在调用大模型生成选题推荐，可能需要 1-3 分钟。"
      secondary-hint="生成完成后结果会自动出现，无需手动刷新。"
    >
      <template #action>
        <button class="btn btn-ghost" @click="handleRefreshStatus">刷新状态</button>
      </template>
    </StageGenerating>

    <!-- 有候选 -->
    <template v-else-if="hasCandidates">
      <h1 class="topic-page-title">请选择您喜欢的<em>选题</em></h1>

      <div class="topic-columns">
        <section class="topic-left-col panel-card">
          <div class="candidate-list">
            <div
              v-for="candidate in currentCandidates"
              :key="candidate.candidate_id"
              :data-testid="`candidate-item-${candidate.candidate_id}`"
              class="candidate-card"
              :class="{ active: selectedCandidateId === candidate.candidate_id }"
              @click="selectCandidate(candidate)"
            >
              <div class="candidate-body">
                <div class="candidate-title">{{ candidate.title }}</div>
                <div class="candidate-angle">{{ candidate.one_line_angle }}</div>
                <div class="candidate-tags">
                  <span class="candidate-tag">{{ candidate.family_label }}</span>
                  <span class="candidate-tag">{{ candidate.scope_label }}</span>
                </div>
              </div>
            </div>
          </div>

          <div class="history-block" v-if="historyRounds.length">
            <div class="history-top">
              <button class="history-toggle" @click="toggleHistory">
                <span class="toggle-arrow" :class="{ open: historyOpen }">▶</span>
                候选历史
              </button>
              <button class="action-btn" @click="handleRefreshBatch">↺ 换一批</button>
            </div>
            <div class="history-rounds" v-if="historyOpen">
              <div v-for="round in historyRounds" :key="round.round_id">
                <div class="history-label">{{ roundLabel(round) }}</div>
                <div class="history-round">
                  <div
                    v-for="candidate in round.candidates"
                    :key="candidate.candidate_id"
                    :data-testid="`candidate-item-${candidate.candidate_id}`"
                    class="candidate-card"
                    :class="{ active: selectedCandidateId === candidate.candidate_id }"
                    @click="selectCandidate(candidate)"
                  >
                    <div class="candidate-body">
                      <div class="candidate-title">{{ candidate.title }}</div>
                      <div class="candidate-angle">{{ candidate.one_line_angle }}</div>
                      <div class="candidate-tags">
                        <span class="candidate-tag">{{ candidate.family_label }}</span>
                        <span class="candidate-tag">{{ candidate.scope_label }}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <aside class="topic-right-col">
          <div v-if="selectedCandidate" class="detail-card">
            <div class="detail-header">
              <div class="detail-kicker">选题详情</div>
              <h2 class="detail-title">{{ selectedCandidate.title }}</h2>
              <p class="detail-angle">{{ selectedCandidate.one_line_angle }}</p>
            </div>
            <div class="detail-tags">
              <span class="detail-tag">{{ selectedCandidate.family_label }}</span>
              <span class="detail-tag">{{ selectedCandidate.scope_label }}</span>
            </div>
            <div class="detail-sections">
              <section class="detail-section">
                <div class="detail-icon">⚔️</div>
                <div>
                  <div class="detail-section-label">核心冲突</div>
                  <div class="detail-section-text">{{ selectedCandidate.strong_scene }}</div>
                </div>
              </section>
              <section class="detail-section">
                <div class="detail-icon">📡</div>
                <div>
                  <div class="detail-section-label">传播切口</div>
                  <div class="detail-section-text">{{ selectedCandidate.why_this_now }}</div>
                </div>
              </section>
              <section class="detail-section">
                <div class="detail-icon">⚠️</div>
                <div>
                  <div class="detail-section-label">风险提示</div>
                  <ul class="risk-list">
                    <li class="risk-item" v-for="(risk, i) in selectedCandidate.risk_hints" :key="i">{{ risk }}</li>
                  </ul>
                </div>
              </section>
            </div>
            <div class="detail-footer">
              <button
                class="confirm-btn"
                data-testid="confirm-candidate"
                :disabled="topicStore.state.isConfirming"
                @click="confirmCandidate"
              >确认此选题，进入文案阶段</button>
            </div>
          </div>
          <div v-else class="panel-card detail-empty">
            点击左侧候选卡片查看选题详情
          </div>
        </aside>
      </div>
    </template>

    <!-- 事件库 / 自定义占位 -->
    <div v-else class="topic-alt-panel">
      事件库 / 自定义主题入口将在后续接入
    </div>
  </div>
</template>
```

#### 5.1.2 Script 改动

**删除**：
- `eraFilter`、`tensionFilter` ref
- `selectCandidateFromRound()`（如果仅用于旧筛选逻辑）
- `el-tabs`、`el-select`、`el-badge`、`el-alert`、`el-popconfirm` 相关 import
- `TopicRecommendationFilters` type import（不再需要）

**新增**：
- `historyOpen` ref（`ref(false)`）
- `toggleHistory()` 函数

**保留不动**：
- `selectCandidate()`、`confirmCandidate()`、`handleRegenerate()`、`handleRefreshBatch()`
- `useStagePolling` 配置
- `onMounted` F5 恢复逻辑
- `isGeneratingState`、`hasCandidates`、`hasLoadError` 等 computed
- `currentCandidates`、`historyRounds`、`selectedCandidate` 等数据 computed

#### 5.1.3 CSS 改动

**全部重写** `<style scoped>` 块。从预览中复制的完整 CSS 约 600 行，组织如下：

```
.topic-panel { --accent-gold: ...; --accent-copper: ...; ... }  ← CSS 变量覆写
.topic-page-title              ← h1 衬线标题
.topic-columns                 ← 双列 grid: 455px 1fr
.panel-card                    ← 统一卡片容器
.candidate-list / .candidate-card / .candidate-card.active / .candidate-body / .candidate-title / .candidate-angle / .candidate-tags / .candidate-tag
.history-block / .history-top / .history-toggle / .toggle-arrow / .history-rounds / .history-label / .history-round
.detail-card / .detail-header / .detail-kicker / .detail-title / .detail-angle / .detail-tags / .detail-tag
.detail-sections / .detail-section / .detail-icon / .detail-section-label / .detail-section-text / .risk-list / .risk-item
.detail-footer / .confirm-btn
.action-btn                    ← 小按钮（换一批 等）
.center-state                  ← 错误态 / 生成中全页居中
.center-state-inner / .center-pulse / .center-error-icon / .center-state-title / .center-state-desc / .center-state-line / .center-state-actions
.topic-alt-panel               ← 占位面板
@media (max-width: 819px)      ← 响应式单列
```

**删除的旧 CSS**：约 300 行（`.topic-action-bar`、`.topic-filters-bar`、`.topic-empty-state`、`.topic-bottom-actions` 等全部移除）。

### 5.2 StageGenerating.vue — 视觉升级

**已有**：`elapsedSeconds` 计时器、`titleText` computed with seconds、`#action` slot。

**只需新增**：

1. **脉冲光环动画**（`.center-pulse` 的 `::before`/`::after` ring pulses）——加在 scoped CSS。
2. **底部装饰分隔线**（`.center-state-line`）。
3. **布局改为全页居中**（`min-height: calc(100vh - 72px)`）。

Props 不变，Slot 不变。仅 CSS 升级。

### 5.3 WorkspaceHeader.vue — 面包屑视觉升级

**已有**：`ElBreadcrumb` 渲染 `projectName › currentStepLabel`。

**只需修改**：

1. 将 `ElBreadcrumb` 替换为自定义 HTML（`<span>未命名项目</span><span>›</span><span>🎯 选题</span>`），去掉 Element Plus 依赖。
2. 或在保持 `ElBreadcrumb` 的前提下，给阶段标签加 emoji 映射：`currentStepLabel` 前插入对应图标。

建议方案：保持 `ElBreadcrumb`（稳定），在 computed 中追加 emoji 图标映射：
```typescript
const stepEmojiMap: Record<string, string> = {
  topic: '🎯', script: '📝', storyboard: '🎬', asset: '🖼️',
  compose: '🎞️', render: '🎥', publish: '🚀',
};
const currentStepLabelWithIcon = computed(() => {
  const step = PIPELINE_STEPS[workspaceStore.state.value.currentStepIndex];
  return `${stepEmojiMap[step.key] ?? ''} ${step.label}`;
});
```

### 5.4 WorkspaceSidebar.vue — 加入项目信息卡片

**只需修改 template**：在步骤列表 `<nav>` 上方新增一个项目信息块：

```html
<div class="project-mini">
  <div class="project-mini-label">当前项目</div>
  <div class="project-mini-title">
    <strong>{{ projectStore.state.name ?? '未命名项目' }}</strong>
    <span>{{ projectStageDescription }}</span>
  </div>
</div>
```

**步骤图标改用 emoji**：将当前可能使用的 SVG 图标替换为每一步的 emoji（🎯 📝 🎬 🖼️ 🎞️ 🎥 🚀）。

**当前步骤高亮**：`.step.active` 使用金色 highlight（`background: rgba(201,162,39,.10)`）。

**done 态**：`.step.done` 显示绿色 ✓。

---

## 六、data-testid 汇总

| data-testid | 现有位置 | 新位置 | 说明 |
|-------------|---------|--------|------|
| `candidate-item-${id}` | 当前轮次卡片 (L274) | 当前轮次 `.candidate-card` | 不变 |
| `candidate-item-${id}` | 历史轮次卡片 (L312) | 历史轮次 `.candidate-card` | 不变 |
| `confirm-candidate` | 详情卡片确认按钮 (L374) | 详情卡片 `.confirm-btn` | 保留 |
| `confirm-candidate` | 底部操作栏 (L411) | — | **删除**（底部操作栏已移除） |

---

## 七、实施计划

### Phase 1：TopicPanel CSS 全量替换
- [ ] 在 `<style scoped>` 中写入所有新 CSS（约 600 行）
- [ ] `.topic-panel` 内定义 CSS 变量覆写块
- [ ] 编译通过验证

### Phase 2：TopicPanel 模板重构
- [ ] 按 5.1.1 新模板重写 `<template>`
- [ ] 更新 script（删除不再引用的 import/ref/computed，新增 `historyOpen`）
- [ ] 保留全部 `data-testid`
- [ ] 编译通过 + 状态切换正常

### Phase 3：StageGenerating 视觉升级
- [ ] 添加 pulse ring CSS 动画
- [ ] 添加装饰分隔线
- [ ] 改为全页居中布局
- [ ] 编译通过

### Phase 4：WorkspaceHeader + WorkspaceSidebar
- [ ] WorkspaceHeader 加 emoji 图标映射
- [ ] WorkspaceSidebar 加项目信息卡片 + emoji 步骤图标
- [ ] 编译通过

### Phase 5：清理 & 验证
- [ ] 删除 TopicPanel 中不再引用的 Element Plus import
- [ ] 删除旧 CSS 残留
- [ ] 端到端验证：CreateTopicModal → 生成 → 候选列表 → 详情 → 确认选题 → 跳转 script
- [ ] 验证 F5 刷新恢复
- [ ] 验证响应式 `< 819px` 单列
- [ ] 与 `preview-workspace-topic.html` 并排对照截图

---

## 八、回滚方案

如果在 Phase 1–3 实施中遇到不可解决的编译/运行时问题：

1. `git stash` 或 `git reset --hard HEAD` 回到实施前 commit。
2. 保留 `docs/plans/2026-06-23-topic-page-refactor-plan.md` 文档（已提交），供后续修复后重试。
3. 不需要恢复 `docs/spec/` 目录（该目录已删除，文件已移至 `docs/plans/`）。

---

## 九、风险 & 注意事项

1. **CSS 体积**：新 CSS 约 600 行，全部在 `<style scoped>` 中，不增加全局样式文件，不影响其他页面。
2. **Element Plus 依赖清理**：移除 `el-tabs`、`el-select`、`el-badge`、`el-alert`、`el-popconfirm`。`el-button` / `el-tag` 在新模板中不再使用（改为原生 `<button>` / `<span>`），一并移除。
3. **响应式**：保留原有 `@media (max-width: 819px)` 断点逻辑，预览设计的 grid 值需映射到新断点。
4. **F5 恢复**：轮询逻辑和 `loadExistingTopic()` 不修改，但需确认新模板路径中 `isGeneratingState` computed 判断正确触发 StageGenerating。
5. **事件库/自定义选题 Tab**：新模板中仅保留占位面板，这两个 tab 在 `CreateTopicModal` 中可选但仍是占位态，保持与现有行为一致。
