# UI 全面重构设计文档

**日期**: 2026-05-13
**状态**: 待实施
**目标**: 对前端 UI 进行全面重构，涵盖布局、视觉风格和交互体验

## 1. 设计决策摘要

| 决策项 | 选择 |
|--------|------|
| 视觉风格 | 暗色电影风（延续旧项目风格，更精致现代） |
| 流水线模式 | 向导式单页流（6步） |
| 布局方案 | 可折叠侧边栏 + 主工作区 |
| UI 组件库 | Element Plus（主题覆盖为暗色金调） |
| 字体 | Noto Sans SC（无衬线，替换当前衬线体） |
| 旧项目参考 | 向导布局 + 组件模式 + 视觉风格 |

## 2. 页面架构

### 2.1 路由结构

```
/                    → 首页（简洁欢迎页，引导进入项目列表）
/projects            → 项目列表页（虚拟滚动 + 搜索 + 筛选）
/projects/:id        → 项目工作区（核心页面，6步向导）
```

当前 4 个独立路由（topic / script / storyboard / asset-plan）合并为 `/projects/:id` 单页，通过侧边栏步骤切换替代路由跳转。

### 2.2 项目工作区结构

```
┌──────────────────────────────────────────────────┐
│  可折叠侧边栏  │         主工作区                    │
│  ┌──────────┐ │  ┌─────────────────────────────┐  │
│  │ 项目名称  │ │  │ 顶部：步骤标题 + 操作按钮    │  │
│  │ ──────── │ │  ├─────────────────────────────┤  │
│  │ 1. 选题   │ │  │                             │  │
│  │ 2. 文案   │ │  │    当前步骤内容区             │  │
│  │ 3. 分镜   │ │  │                             │  │
│  │ 4. 资产规划│ │  │                             │  │
│  │ 5. 资产   │ │  │                             │  │
│  │ 6. 合成视频│ │  ├─────────────────────────────┤  │
│  │          │ │  │ 底部：上一步 / 下一步 导航    │  │
│  │ ──────── │ │  └─────────────────────────────┘  │
│  │ ← 返回   │ │                                    │
│  └──────────┘ │                                    │
└──────────────────────────────────────────────────┘
```

**侧边栏**：
- 展开状态：~220px，显示步骤名称 + 状态文字
- 折叠状态：~60px，仅显示步骤编号图标
- 每个步骤带状态指示（已完成/进行中/待开始）
- 底部放"返回项目列表"入口

**主工作区**：
- 顶部：面包屑 + 当前步骤标题 + 步骤状态 + 操作按钮
- 中间：当前步骤的具体内容（根据步骤不同布局不同）
- 底部：上一步 / 下一步导航按钮

## 3. 流水线 6 步详细设计

### 3.1 步骤 1/6 — 选题

**布局**：双栏（左 1fr : 右 1.2fr）

- **顶部操作栏**：来源切换标签（系统推荐 / 事件库 / 自定义选题）+ 轮次指示
- **左栏 — 候选列表**：
  - 候选卡片列表，每个卡片显示：标题、切入角度、标签（话题族、范围）
  - 点击选中高亮，右侧联动显示详情
- **右栏 — 选题详情**：
  - 展示：切入角度、核心冲突、开头钩子、风险提示
  - 底部"确认此选题"按钮
- **底部操作**：重新生成 / 换一批 / 确认选题

### 3.2 步骤 2/6 — 文案

**布局**：双栏（左 1.5fr : 右 1fr）

- **左栏 — 文案正文**：
  - 分段展示（开头 / 正文 / 结尾），每段有小标签
  - 只读展示，不可编辑
- **右栏 — 审查 & 操作**：
  - 审查结果列表（结构完整性、开头吸引力、情感共鸣度、字数合规等），每项带通过/建议优化状态
  - 操作按钮：通过并继续 / 修补一次 / 重新生成
- **底部**：显示修补和重新生成的剩余次数

### 3.3 步骤 3/6 — 分镜

**布局**：卡片列表（全宽）

- **每个镜头卡片**（三列网格）：
  - 左列：镜头编号 + 时间范围
  - 中列：文案片段
  - 右列：画面意图 + 景别/运动方式标签
- 支持折叠/展开，避免长列表
- 底部：确认分镜 / 重新生成

### 3.4 步骤 4/6 — 资产规划

**布局**：摘要卡片 + 任务列表（全宽）

- **顶部摘要卡片**（4列网格）：总镜头数、资产任务数、高风险项、预估时长
- **任务列表**：
  - 每行：来源镜头 | 任务描述 | 任务类型（图片生成/语音合成/背景音乐）| 风险等级
  - 可展开查看 prompt 草稿、参数、依赖项

### 3.5 步骤 5/6 — 资产

**布局**：进度面板 + 缩略图（全宽）

- **多阶段并行进度条**：封面生成、图片生成、语音合成、背景音乐，各自带进度百分比和状态
- **已生成资产缩略图**：网格排列，支持点击预览
- 实时更新（SSE 推送进度）

### 3.6 步骤 6/6 — 合成视频

**布局**：居中展示

- **16:9 视频预览区**：播放器
- **操作按钮**：开始合成 / 下载视频 / 下载封面
- 合成进度指示

## 4. 项目列表页

- **虚拟滚动列表**：使用 Element Plus el-table-v2 或自定义虚拟滚动，支持大量项目
- **搜索栏**：实时搜索项目名称
- **筛选器**：按状态筛选（进行中/已完成/全部）
- **操作**：创建新项目 / 删除项目 / 进入项目

## 5. 视觉系统

### 5.1 主题架构

所有视觉 token 通过 CSS 自定义属性（CSS Variables）定义，挂载在 `document.documentElement` 上。切换主题只需替换一组变量值，组件代码和样式表无需任何修改。

**切换机制：**
- `<html>` 标签上设置 `data-theme="cinematic-dark"` 属性标识当前主题
- 每个主题对应一个 CSS 文件（如 `theme-cinematic-dark.css`），通过 `[data-theme="cinematic-dark"]` 选择器定义变量
- 切换时修改 `data-theme` 属性值，所有 CSS 变量自动生效
- Element Plus 通过 CSS 变量覆盖（`--el-color-primary` 等）同步主题

**文件结构：**
```
frontend/src/styles/
  theme-cinematic-dark.css    — 默认主题：暗色电影风（当前设计）
  theme-light-modern.css      — 预留：明亮现代风（未来可选）
  tokens.css                  — 语义化变量声明（不带值的引用层）
  element-overrides.css       — Element Plus 变量 → 自定义 token 的映射
  main.css                    — 全局基础样式（使用变量，不硬编码色值）
```

**切换代码示例：**
```typescript
// 切换主题
function setTheme(name: string) {
  document.documentElement.setAttribute('data-theme', name)
  localStorage.setItem('theme', name)
}
// 恢复上次选择
const saved = localStorage.getItem('theme') || 'cinematic-dark'
setTheme(saved)
```

### 5.2 设计 Token 完整定义

所有组件和页面样式只引用语义化变量名，不直接使用色值。Token 分三层：

**第一层：语义化 Token（组件使用的变量）**
```css
/* 所有组件和页面样式只引用这些变量 */
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

  /* 状态色（语义化） */
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
}
```

**第二层：主题原始值（每个主题一份）**

**默认主题：cinematic-dark（暗色电影风）**
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

**预留主题：light-modern（明亮现代风）**
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

**第三层：Element Plus 变量映射**
```css
/* element-overrides.css — 将 Element Plus 变量桥接到自定义 token */
[data-theme] {
  --el-color-primary: var(--accent-primary);
  --el-color-primary-light-3: var(--accent-primary-light);
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
  --el-border-color-hover: var(--border-hover);
  --el-fill-color-blank: var(--bg-input);
  --el-border-radius-base: var(--radius-button);
  --el-font-family: var(--font-family);
  --el-mask-color: rgba(0, 0, 0, 0.5);
}
```

### 5.3 组件样式规范

**规则：所有组件样式只使用语义化变量，绝不硬编码色值。**

```css
/* 正确 ✅ */
.my-card {
  background: var(--bg-card);
  border: 1px solid var(--border-default);
  color: var(--text-body);
}

/* 错误 ❌ */
.my-card {
  background: #1a2332;
  border: 1px solid rgba(212, 163, 95, 0.15);
  color: #e0d8c8;
}
```

**Element Plus 暗色补丁：**
Element Plus 默认不适配深色背景，需额外覆盖以下组件：
- el-menu、el-tabs、el-table：背景色/文字色/选中态
- el-dialog、el-drawer：overlay 和面板背景
- el-message、el-notification：浮层背景
- el-input、el-select：输入框背景和边框色

### 5.4 字体

- **字体栈**: `var(--font-family)` → `'Noto Sans SC', 'Inter', -apple-system, BlinkMacSystemFont, sans-serif`
- **字号层级**: 20px(页面标题) / 14px(区域标题) / 12px(正文) / 10px(辅助)
- **字重**: var(--font-heading)=700 / var(--font-subheading)=600 / var(--font-body)=400

### 5.5 主题切换入口

- 侧边栏底部（或工作区右上角）放一个主题切换按钮
- 点击切换 cinematic-dark ↔ light-modern（未来可扩展更多主题）
- 切换时全局 CSS 变量瞬间生效，无需重新加载
- 当前主题持久化到 localStorage

## 6. 交互模式

### 6.1 步骤流转

- 已完成步骤：侧边栏显示 ✓ 图标，可点击回看（只读）
- 当前步骤：高亮显示，可操作
- 未来步骤：灰色，不可点击
- 步骤间通过底部"上一步/下一步"按钮或侧边栏点击（已完成步骤）切换
- 步骤切换时带 fade/slide 过渡动画（~200ms），避免突兀跳变

### 6.2 加载状态（按场景分级）

**场景 A：首次进入步骤（等待快照加载）**
- 内容区显示 el-skeleton 骨架屏，模拟最终布局结构
- 骨架屏使用卡片背景色 `#1a2332` + 金色半透明条纹动画
- 超过 5 秒未返回：底部显示"加载时间较长，请耐心等待"提示

**场景 B：触发生成操作（选题/文案/分镜等）**
- 触发按钮进入 loading 态（el-button loading），旋转图标 + 文字变为"生成中..."
- 同时禁用该步骤内的所有其他操作按钮，防止重复触发
- 内容区保留已有内容，不替换为骨架屏（用户可继续查看当前内容）
- 按钮旁显示经过时间计数器（如"已等待 12s"）

**场景 C：长时间异步操作（资产生成、视频合成）**
- 显示专用进度面板：每个子任务独立进度条 + 状态图标
- 进度条使用 el-progress，带百分比文字
- 每个子任务完成时触发 el-message 轻提示（如"封面图已生成"）
- 整体进度汇总在顶部（如"3/6 项已完成"）
- 支持中途取消（"取消生成"按钮 → el-popconfirm 确认）

**场景 D：页面/列表加载**
- 项目列表页：使用 el-table-v2 内置的 loading 效果
- 首次加载时表格区域显示加载动画
- 搜索/筛选切换时，列表区域显示轻量 overlay + loading spinner

### 6.3 错误处理

**错误分类与对应 UI：**

| 错误类型 | 示例 | UI 响应 |
|----------|------|---------|
| 网络错误 | 请求超时、断网 | el-notification（error）+ "重试"按钮 |
| 服务端错误 | 500、LLM 服务不可用 | el-notification（error）+ 错误详情 + "重试"按钮 |
| 业务逻辑错误 | 状态冲突、步骤前置条件未满足 | el-message（warning）+ 内联提示文字 |
| 验证错误 | 输入参数不合法 | el-form 内联校验，红色文字标注具体字段 |
| 生成失败 | LLM 输出格式异常 | 内容区显示错误状态卡片 + "重试"按钮 |
| 部分失败 | 6张图生成4张成功、2张失败 | 进度面板中失败项标红 + 单独"重试"按钮 |

**错误提示设计原则：**
- 错误信息必须用中文，不用技术术语（不说"500 Internal Server Error"，而说"服务暂时不可用，请稍后重试"）
- 可重试的错误始终提供"重试"按钮，不要求用户刷新页面
- 错误状态使用 `#ef5350` 红色系，搭配半透明红色背景（不用刺眼的纯红）
- el-notification 默认 5 秒自动关闭，用户可手动关闭
- el-message 默认 3 秒自动关闭

**内联错误状态卡片示例（生成失败时）：**
```
┌─────────────────────────────────────┐
│  ⚠ 选题生成失败                      │
│  服务暂时不可用，请稍后重试            │
│                                     │
│  [重试]  [查看详情 ▾]                │
└─────────────────────────────────────┘
```
"查看详情"展开后显示技术错误信息（供调试用），默认折叠。

### 6.4 操作确认与反馈

**二次确认操作（el-popconfirm）：**
- 删除项目："删除后无法恢复，确认删除？"
- 重新生成："重新生成将覆盖当前内容，确认继续？"
- 取消正在进行的生成操作："取消后将丢失当前进度，确认取消？"

**一次确认操作（无需弹窗，直接执行）：**
- 确认选题、确认分镜、确认资产规划
- 修补一次
- 切换步骤查看

**成功反馈分级：**
- 短操作（确认、保存）：el-message success，1.5 秒自动消失
- 长操作完成（生成完成）：el-notification success，带简要摘要（如"已生成 4 个候选选题"），3 秒自动关闭

### 6.5 空状态

| 场景 | 展示内容 |
|------|---------|
| 项目列表为空 | 插画图标 + "还没有项目" + "创建第一个项目"主按钮 |
| 候选选题为空（未生成） | 引导文案 + "开始生成选题"主按钮 |
| 候选选题为空（已生成但无结果） | "未找到匹配的选题，请调整条件或重试" + "重试"按钮 |
| 文案未生成 | 引导文案 + "开始生成文案"主按钮 |
| 历史版本为空 | "暂无历史版本" |

### 6.6 详情展示

- 选题详情：右侧栏内直接展示（非抽屉）
- 其他详情（如资产任务展开）：el-collapse 或 el-drawer（右侧滑出）
- 所有展开/折叠操作带 smooth 过渡动画（~300ms）

### 6.7 防误操作机制

- 生成进行中：禁用所有可能冲突的操作按钮（非仅禁用触发按钮）
- 步骤未完成：下一步按钮灰色不可点击（除非当前步骤状态为已完成）
- 浏览器关闭/刷新：当有操作进行中时，拦截 beforeunload 提示用户"有操作正在进行中，确认离开？"

## 7. 技术实施方案

### 7.1 依赖变更

**新增**:
- `element-plus` — UI 组件库
- `@element-plus/icons-vue` — 图标库

**移除**:
- 无（保留所有现有依赖，逐步替换自定义组件）

### 7.2 文件结构变更

```
frontend/src/
  main.ts                    — 注册 Element Plus + 主题初始化
  styles/
    theme-cinematic-dark.css — 默认主题：暗色电影风 token 值
    theme-light-modern.css   — 预留主题：明亮现代风 token 值
    tokens.css               — 语义化变量声明（组件使用的变量层）
    element-overrides.css    — Element Plus 变量 → 自定义 token 映射
    main.css                 — 全局基础样式（使用变量，不硬编码色值）
  views/
    HomePage.vue             — 简洁欢迎页
    ProjectsPage.vue         — 项目列表（虚拟滚动）
    ProjectWorkspace.vue     — 项目工作区（新增，合并向导）
  components/
    workspace/
      WorkspaceSidebar.vue   — 可折叠侧边栏
      WorkspaceHeader.vue    — 工作区顶部栏
      WorkspaceFooter.vue    — 工作区底部导航
    topic/
      TopicPanel.vue         — 选题步骤内容（替代原 TopicTabs + List + Drawer）
    script/
      ScriptPanel.vue        — 文案步骤内容（合并多个面板）
    storyboard/
      StoryboardPanel.vue    — 分镜步骤内容
    asset-planning/
      AssetPlanningPanel.vue — 资产规划步骤内容
    asset/
      AssetPanel.vue         — 资产生成步骤内容（新增）
    compose/
      ComposePanel.vue       — 合成视频步骤内容（新增）
```

### 7.3 Store 变更

- 各步骤 store 保持不变，仅调整 view 层的调用方式
- 新增 `useWorkspaceStore` 管理当前步骤索引、侧边栏折叠状态
- ProjectStore 增加 workspace 相关状态

### 7.4 路由变更

```typescript
// 新路由结构
{ path: '/', component: HomePage }
{ path: '/projects', component: ProjectsPage }
{ path: '/projects/:id', component: ProjectWorkspace }  // 合并所有步骤
// 移除: /projects/:id/topic, /projects/:id/script, etc.
```
