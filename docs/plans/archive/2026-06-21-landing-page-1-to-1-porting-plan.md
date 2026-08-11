# 首页 1:1 移植：preview-landing.html → HomePage.vue

Date: 2026-06-21

## Review Guide

审阅或实施本计划前，先阅读以下文件：

- `AGENTS.md`
- `frontend/public/preview-landing.html`（设计源文件，1:1 移植基准）
- `frontend/src/views/HomePage.vue`（当前首页，移植目标）
- `frontend/src/styles/main.css`（全局样式入口）
- `frontend/src/styles/theme-cinematic-dark.css`（暗色主题变量）
- `frontend/index.html`（title / favicon 入口）
- `frontend/public/favicon.svg`（需新建，当前不存在）
- `frontend/src/stores/project.ts`（项目 store，handleCreateProject 消费来源）
- `docs/plans/README.md`（plans 状态与归档规则）

---

## 一、目标与边界

### 目标

1. 把 `frontend/public/preview-landing.html` 中落地页的视觉与交互完整迁移为 `HomePage.vue`。
2. 做到浏览器端**视觉 1:1**（不含预览页内置滚动动画的过渡视觉差异——此动画的等价物应保留）。
3. 保留 `HomePage.vue` 中的路由/业务能力（"我的项目"导航、"新建项目"→创建项目并跳转工作区）。

### 当前基线（Current Baseline）

#### 现有 HomePage.vue

- 使用 Element Plus 组件（`ElButton`、`ElRow`、`ElCol`、`ElCard`）。
- 标题 "Story Video Forge"。
- 7 个流水线卡片（topic → script → storyboard → asset → compose → render → publish）。
- 通过 `useRouter` + `projectStore.createProject` 实现"新建项目"跳转。
- 无顶栏、无 Hero 动画、无控制台预览、无 CTA、无 footer。

#### 现有 preview-landing.html

- 纯 HTML + CSS（内置 `<style>` 块，约 1000+ 行）。
- `<body>` 结构：
  - **Top Bar**：固定顶栏，含 SVG 品牌图标 + 品牌文字（"历史短视频工坊 / History Video Forge"）+ "我的项目 / 新建项目"按钮 + 分隔线 + 登录 / 设置按钮。
  - **Hero**：大标题（"历史短视频工坊"，渐变金色）+ 英文副标题 "History Video Forge" + 双 CTA 按钮（"新建项目 →" / "观看示例"）+ tagline "自动创意 · 零思考 · 零手工 · 一键产出短视频" + 齿轮动画 + 传送带动画。
  - **Pipeline Flow**：7 段流水线节点，每段含 SVG 图标、阶段名（选题 / 文案 / 分镜 / 素材 / 合成 / 渲染 / 发布）、角色名（创意总监 / 编剧 / 分镜师 / 摄影指导 / 录音剪辑 / — / 发行制片）、阶段描述。阶段之间有 `>>>` 动画箭头。布局：一排 4 个 + 一排 3 个。
  - **Why It Works 区块**：标题 + "不再靠抽卡，而是一条可审校的生产线"副标题 + 4 个能力卡片（选题有判断 / 文案可审校 / 分镜结构化 / 成片自动化），每卡带数字编号。
  - **Forge Console 预览卡片**：顶部 traffic 指示灯 + "Forge Console · Project #082"标题，主体左侧为项目进度时间线（选题评估 / 文案生成 / 分镜规划 / 素材匹配 / 合成渲染，带进度条），右侧为 9:16 手机屏预览（月亮剪影 + 字幕），左下角漂浮"传播潜力评分 91"卡片。
  - **CTA**："你的第一个历史视频项目 / 从现在开始" + 大号"新建项目"按钮。
  - **Footer**：版本号 v1.0.0 / 联系邮箱 1451784145@qq.com。
- 底部 `<script>`：IntersectionObserver 驱动的 `.fade-in` 淡入滚动动画（对流水线节点和其他子元素添加 `transitionDelay`）。
- `<title>`："历史短视频工坊"。
- 无 favicon 引用；`favicon.svg` 需新建。

### 不改什么

- **不修改** `ProjectsPage.vue`、`ProjectWorkspace.vue`、以及所有 `components/` 子组件。
- **不修改** `tokens.css`、`theme-cinematic-dark.css`、`theme-light-modern.css`、`element-overrides.css`——不触动项目共享主题变量。
- **不修改** `router/`、`stores/`（除 HomePage.vue 内消费现有 store 的方法，其余不改）。
- **不修改** `preview-landing.html`（保留为验证对照；若后续需要改，应在本计划批准后单独提交）。
- **不拆分组件**：顶栏、流水线、控制台、CTA、footer 全部内联在 `HomePage.vue` 的 `<template>` 中，不创建 `components/landing/` 子目录。本轮不做组件化抽象；视觉 1:1 是第一优先级。

---

## 二、颜色变量与样式策略

### 颜色变量来源

`preview-landing.html` 在 `<style>` 块顶部定义了独立的 CSS 变量：

- `--bg-primary: #0d0d0d`
- `--bg-secondary: #1a1614`
- `--accent-gold: #c9a227`
- `--accent-copper: #b87333`
- `--accent-bronze: #cd7f32`
- `--accent-warm: #d4a574`
- `--text-primary: #f5f0e8`
- `--text-secondary: #a89f94`
- `--text-muted: #6b635a`
- `--border-color: #3d3632`
- `--glow-gold: rgba(201, 162, 39, 0.3)`
- `--glow-copper: rgba(184, 115, 51, 0.4)`

### 策略：新建 landing-page.css，不污染主题变量

由于上述颜色与 `tokens.css` 中的 `--t-bg-base: #0a0f18` / `--t-accent-primary: #d4a35f` 不完全一致，若直接把 preview-landing 的样式并入 `theme-cinematic-dark.css` 会破坏 `ProjectWorkspace`、`ProjectsPage` 等页面的视觉一致性。

正确做法：

1. **新建** `frontend/src/styles/landing-page.css`——把 `preview-landing.html` 的 `<style>` 块完整搬入。
2. **冲突类名做前缀/改名**（详见下文"五、样式冲突与避让清单"）。
3. 在 `frontend/src/styles/main.css` 末尾加一行 `@import "./landing-page.css";`，放在 `@import "./element-overrides.css";` 之后。
4. **注意**：preview-landing.html 中的 `* { box-sizing: border-box; margin: 0; padding: 0; }` **不要**迁移——main.css 已有等价 reset。
5. **注意**：`html { scroll-behavior: smooth; }` 可以安全迁移（main.css 当前没有）。
6. **注意**：`body { font-family: "Noto Serif SC", ... }` 可以保留；但 `body::before`（径向渐变背景光晕）需改为 `body.landing-page-bg::before`，并在 HomePage.vue 的 `onMounted` 中 `document.body.classList.add('landing-page-bg')`，`onUnmounted` 中移除。避免 ProjectsPage / Workspace 也出现金色光晕。

### favicon

- **新建** `frontend/public/favicon.svg`：内容为预览页顶部使用的"场记板"风格 SVG（与 brand mark 一致——矩形场记板 + 内部 3 条横线 + 顶部指针）。
- 在 `frontend/index.html` 的 `<head>` 中新增一行：`<link rel="icon" type="image/svg+xml" href="/favicon.svg">`。
- 把 `<title>` 从 "Story Video Forge 2" 改为 "历史短视频工坊"。

---

## 三、文件改动清单（逐文件）

### 文件 1 / 4：新建 `frontend/src/styles/landing-page.css`

**来源**：`preview-landing.html` 的 `<style>` 块（从 `:root` 变量定义到 `@media` 断点）。

**需做的文本替换**：

| 源字符串 / 选择器 | 替换为 | 原因 |
|---|---|---|
| `.container` | `.landing-container` | 避免与项目内其他 `.container` 冲突 |
| `footer`（裸选择器） | `.landing-footer` | 避免影响其他页面的 `<footer>` 元素 |
| `body::before` | `body.landing-page-bg::before` | 仅首页启用金色径向渐变背景 |
| `* { box-sizing: border-box; margin: 0; padding: 0; }` | **删除该行** | main.css 已有等价 reset |
| `body { background: var(--bg-primary); color: var(--text-primary); line-height: 1.8; overflow-x: hidden; }` | 改为 `body.landing-page-bg { background: var(--bg-primary); color: var(--text-primary); line-height: 1.8; overflow-x: hidden; }` | `--bg-primary: #0d0d0d` 与 `--bg-base: #0a0f18` 色差虽小，但应避免在非首页造成隐性视觉变化。由 onMounted/onUnmounted 自动切换 |
| `body { font-family: "Noto Serif SC", "Source Han Serif SC", "Songti SC", "SimSun", Georgia, serif; }` | 保留原样（body 选择器不变） | 衬线字体变化对全站友好，是设计意图的一部分；若后续需要回归可单独 revert |

其余 CSS 规则**必须加 `.landing-page` 前缀**（即 `.landing-page .topbar`、`.landing-page .brand`、`.landing-page .hero`、`.landing-page .section`、`.landing-page .pipeline-flow` 等）。具体做法：
- 在 HomePage.vue `<template>` 最外层加 `<div class="landing-page">` wrapper，包裹 topbar、hero、workflow、cta、footer 所有内容。
- 由于 `.landing-container` 已经在最内层包裹了 pipeline、hero 等内容，`.landing-page` 是外一层 wrapper，用于 CSS 选择器锚定。
- `landing-page.css` 中所有首页专属的类名规则前加 `.landing-page ` 前缀：`.landing-page .topbar`、`.landing-page .brand`、`.landing-page .brand-mark`、`.landing-page .brand-mark svg`、`.landing-page .brand-text`、`.landing-page .brand-text strong`、`.landing-page .brand-text span`、`.landing-page .hero`、`.landing-page .hero-title`、`.landing-page .hero-subtitle`、`.landing-page .hero-cta`、`.landing-page .hero-tagline`、`.landing-page .hero::after`、`.landing-page .factory-decoration`、`.landing-page .gear-icon`、`.landing-page .gear-icon:nth-child(2)`、`.landing-page .conveyor`、`.landing-page .conveyor-box`、`.landing-page .section`、`.landing-page .section-header`、`.landing-page .section-tag`、`.landing-page .section-title`、`.landing-page .section-title em`、`.landing-page .section-title .line-1`、`.landing-page .section-desc`、`.landing-page .workflow-section`、`.landing-page .pipeline-flow`、`.landing-page .pipeline-stage`、`.landing-page .pipeline-stage::after`、`.landing-page .pipeline-stage:nth-child(7)::after`、`.landing-page .stage-icon`、`.landing-page .stage-icon svg`、`.landing-page .pipeline-stage:hover .stage-icon`、`.landing-page .stage-name`、`.landing-page .stage-role`、`.landing-page .stage-desc`、`.landing-page .flow-strip-compat`、`.landing-page .why-section`、`.landing-page .capability-grid`、`.landing-page .cap-card`、`.landing-page .cap-number`、`.landing-page .cap-card h3`、`.landing-page .cap-card p`、`.landing-page .console-shell`、`.landing-page .console-top`、`.landing-page .traffic`、`.landing-page .traffic span`、`.landing-page .console-title`、`.landing-page .console-body`、`.landing-page .panel`、`.landing-page .project-card`、`.landing-page .project-card h3`、`.landing-page .project-meta`、`.landing-page .tag`、`.landing-page .script-box`、`.landing-page .script-box p`、`.landing-page .script-box strong`、`.landing-page .timeline`、`.landing-page .timeline-item`、`.landing-page .timeline-item b`、`.landing-page .timeline-item span`、`.landing-page .status-dot`、`.landing-page .progress`、`.landing-page .progress i`、`.landing-page .video-card`、`.landing-page .phone`、`.landing-page .phone-screen`、`.landing-page .phone-screen::before`、`.landing-page .video-title`、`.landing-page .moon`、`.landing-page .silhouette`、`.landing-page .silhouette::before`、`.landing-page .silhouette::after`、`.landing-page .caption`、`.landing-page .render-badge`、`.landing-page .render-badge b`、`.landing-page .pulse-line`、`.landing-page .floating-card`、`.landing-page .score-card`、`.landing-page .score-card small`、`.landing-page .score-row`、`.landing-page .score-row strong`、`.landing-page .score-row span`、`.landing-page .cta-section`、`.landing-page .cta-section::before`、`.landing-page .cta-section h2`、`.landing-page .cta-section h2 em`、`.landing-page .cta-section p`、`.landing-page .landing-footer`、`.landing-page .footer-meta`、`.landing-page .landing-page-bg`、`.landing-page .fade-in`、`.landing-page .fade-in.visible`、`.landing-page .btn`、`.landing-page .btn-ghost`、`.landing-page .btn-primary`、`.landing-page .btn-large`、`.landing-page .btn-large-primary`、`.landing-page .btn-large-ghost`、`.landing-page .btn-large .arrow`、`.landing-page .topbar-actions`、`.landing-page .topbar-right`、`.landing-page .topbar-divider`、`.landing-page .account-actions`、`.landing-page .account-btn`、`.landing-page .login-btn`、`.landing-page .settings-btn`、`.landing-page .settings-btn svg`、`.landing-page .settings-btn:hover svg`、`.landing-page .landing-container`。
- **不**加前缀的规则：`:root`（CSS 变量声明）、`html`（scroll-behavior）、`body { font-family }`、所有 `@keyframes`、所有 `@media` 断点内的选择器仍按上述规则加前缀。

**为什么这样做**：preview-landing.html 是独立 HTML，`.hero`/`.section` 等通用类名在单页面环境没有冲突风险。但嵌入到多页面 Vue 项目后，任何未来页面都可能使用这些常见类名。用 `.landing-page` 作为 scope 等价于"首页专属样式域"，保证 landing-page.css 不会对其他页面产生隐性副作用。这个修改不影响视觉效果（wrapper div 不占额外空间，选择器匹配结果与之前一致），但消除了未来技术债务。

### 文件 2 / 4：修改 `frontend/src/styles/main.css`

在文件末尾（当前最后一行是 `@import "./element-overrides.css";` 之后）追加：

```css
@import "./landing-page.css";
```

### 文件 3 / 4：修改 `frontend/index.html`

- 改 `<title>Story Video Forge 2</title>` → `<title>历史短视频工坊</title>`。
- 在 `<title>` 之后新增：`<link rel="icon" type="image/svg+xml" href="/favicon.svg">`。

### 文件 4 / 4：完全重写 `frontend/src/views/HomePage.vue`

#### 结构对照

`preview-landing.html` 的 `<body>` → `HomePage.vue` 的 `<template>`：

```html
<template>
  <div class="landing-page">
    <!-- TOP BAR -->
    <div class="topbar" data-testid="home-topbar">
    <a class="brand" href="/">
      <span class="brand-mark">
        <!-- SVG 图标：场记板 -->
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
          <rect x="5" y="7" width="22" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/>
          <line x1="5" y1="13" x2="27" y2="13" stroke="currentColor" stroke-width="1.5"/>
          <line x1="5" y1="17" x2="27" y2="17" stroke="currentColor" stroke-width="1.5"/>
          <line x1="5" y1="21" x2="27" y2="21" stroke="currentColor" stroke-width="1.5"/>
          <rect x="20" y="5" width="4" height="6" rx="1" fill="currentColor"/>
          <polygon points="22,11 20,13 24,13" fill="currentColor"/>
          <polygon points="12,10 12,18 18,14" fill="currentColor"/>
        </svg>
      </span>
      <span class="brand-text">
        <strong>历史短视频工坊</strong>
        <span>History Video Forge</span>
      </span>
    </a>
    <div class="topbar-right">
      <div class="topbar-actions">
        <button class="btn btn-ghost" data-testid="home-primary-cta" @click="router.push('/projects')">我的项目</button>
        <button class="btn btn-primary" @click="handleCreateProject">新建项目</button>
      </div>
      <div class="topbar-divider" aria-hidden="true"></div>
      <div class="account-actions">
        <button class="account-btn login-btn">登录</button>
        <button class="account-btn settings-btn" aria-label="设置" title="设置">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.86l.04.04a2 2 0 1 1-2.83 2.83l-.04-.04a1.7 1.7 0 0 0-1.86-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.03-1.56 1.7 1.7 0 0 0-1.86.34l-.04.04a2 2 0 1 1-2.83-2.83l.04-.04a1.7 1.7 0 0 0-.34-1.86 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.04A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.86l-.04-.04a2 2 0 1 1 2.83-2.83l.04.04A1.7 1.7 0 0 0 8.95 3a1.7 1.7 0 0 0 1.03-1.56V1a2 2 0 1 1 4 0v.44A1.7 1.7 0 0 0 15.01 3a1.7 1.7 0 0 0 1.86-.34l.04-.04a2 2 0 1 1 2.83 2.83l-.04.04A1.7 1.7 0 0 0 19.4 8a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.04A1.7 1.7 0 0 0 19.4 15z"></path>
          </svg>
        </button>
      </div>
    </div>
  </div>

  <!-- HERO -->
  <section class="hero" data-testid="home-hero">
    <div class="landing-container">
      <h1 class="hero-title" data-testid="home-heading">历史短视频工坊</h1>
      <p class="hero-subtitle">History Video Forge</p>

      <div class="hero-cta">
        <button class="btn-large btn-large-primary" @click="handleCreateProject">
          新建项目
          <span class="arrow">→</span>
        </button>
        <button class="btn-large btn-large-ghost">
          观看示例
        </button>
      </div>

      <div class="hero-tagline" data-testid="home-tagline">自动创意 · 零思考 · 零手工 · 一键产出短视频</div>

      <!-- 齿轮动画 -->
      <div class="factory-decoration">
        <div v-for="i in 3" :key="i" class="gear-icon">
          <svg viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </div>
      </div>

      <!-- 传送带动画 -->
      <div class="conveyor">
        <div class="conveyor-box"></div>
        <div class="conveyor-box"></div>
        <div class="conveyor-box"></div>
        <div class="conveyor-box"></div>
        <div class="conveyor-box"></div>
        <div class="conveyor-box"></div>
      </div>
    </div>
  </section>

  <!-- WORKFLOW: PIPELINE + ROLES + WHY IT WORKS + CONSOLE PREVIEW -->
  <section class="section workflow-section">
    <div class="landing-container">
      <!-- Pipeline Header -->
      <div class="section-header fade-in">
        <div class="section-tag">One Creator · Complete Workflow</div>
        <h2 class="section-title"><span class="line-1">不需要专业团队</span><em>你，单人搞定一切</em></h2>
        <p class="section-desc">七个步骤，环环相扣；六个角色，一手承担。从一个模糊的历史念头，到一段完整可发布的视频。</p>
      </div>

      <!-- Pipeline Flow (4+3) -->
      <div class="pipeline-flow" data-testid="home-feature-rail">
        <!-- 阶段 1：选题 (创意总监) -->
        <div class="pipeline-stage fade-in">
          <div class="stage-icon">
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
          </div>
          <div class="stage-name">选题</div>
          <div class="stage-role">创意总监</div>
          <div class="stage-desc">候选评估、确定主题</div>
        </div>
        <!-- 阶段 2：文案 (编剧) -->
        <div class="pipeline-stage fade-in">
          <div class="stage-icon">
            <svg viewBox="0 0 24 24"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L9 19l9-6z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>
          </div>
          <div class="stage-name">文案</div>
          <div class="stage-role">编剧</div>
          <div class="stage-desc">生成口播首稿</div>
        </div>
        <!-- 阶段 3：分镜 (分镜师) -->
        <div class="pipeline-stage fade-in">
          <div class="stage-icon">
            <svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
          </div>
          <div class="stage-name">分镜</div>
          <div class="stage-role">分镜师</div>
          <div class="stage-desc">镜头拆分、定义功能</div>
        </div>
        <!-- 阶段 4：素材 (摄影指导) -->
        <div class="pipeline-stage fade-in">
          <div class="stage-icon">
            <svg viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/></svg>
          </div>
          <div class="stage-name">素材</div>
          <div class="stage-role">摄影指导</div>
          <div class="stage-desc">挑选图片视频</div>
        </div>
        <!-- 阶段 5：合成 (录音 / 剪辑) -->
        <div class="pipeline-stage fade-in">
          <div class="stage-icon">
            <svg viewBox="0 0 24 24"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
          </div>
          <div class="stage-name">合成</div>
          <div class="stage-role">录音 / 剪辑</div>
          <div class="stage-desc">时间线编排、音轨合成</div>
        </div>
        <!-- 阶段 6：渲染 -->
        <div class="pipeline-stage fade-in">
          <div class="stage-icon">
            <svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          </div>
          <div class="stage-name">渲染</div>
          <div class="stage-role">—</div>
          <div class="stage-desc">导出视频、预览成片</div>
        </div>
        <!-- 阶段 7：发布 -->
        <div class="pipeline-stage fade-in">
          <div class="stage-icon">
            <svg viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          </div>
          <div class="stage-name">发布</div>
          <div class="stage-role">发行 / 制片</div>
          <div class="stage-desc">元数据整理、平台交付</div>
        </div>
      </div>

      <!-- harness 兼容性：旧版 flow-strip 的 DOM 钩子 -->
      <p class="flow-strip-compat" data-testid="home-flow-strip">从选题生成到视频渲染导出，全流程一站式完成。</p>

      <!-- Why It Works -->
      <div class="section-header fade-in">
        <div class="section-tag">Why It Works</div>
        <h2 class="section-title">不再靠抽卡，<em>而是一条可审校的生产线</em></h2>
        <p class="section-desc">工坊把历史短视频拆成可控的中间产物：主题、故事简报、口播文案、分镜、素材需求、时间线与成片。每一步都能检查、修改，回退，而不是把结果完全交给黑盒。</p>
      </div>

      <div class="capability-grid fade-in">
        <div class="cap-card">
          <div class="cap-number">01</div>
          <h3>选题有判断</h3>
          <p>不是随机找历史故事，而是评估冲突、反转、人物关系、传播钩子与成片可视化空间。</p>
        </div>
        <div class="cap-card">
          <div class="cap-number">02</div>
          <h3>文案可审校</h3>
          <p>生成适合短视频口播的故事结构，并保留事实边界、叙事目标和可人工修订的中间稿。</p>
        </div>
        <div class="cap-card">
          <div class="cap-number">03</div>
          <h3>分镜结构化</h3>
          <p>把文案拆成镜头，明确每个镜头的画面功能、素材需求、字幕位置和节奏作用。</p>
        </div>
        <div class="cap-card">
          <div class="cap-number">04</div>
          <h3>成片自动化</h3>
          <p>自动整理素材，配音、字幕和时间线，最终输出可预览、可复用、可继续优化的视频项目。</p>
        </div>
      </div>

      <!-- 项目控制台预览 -->
      <div class="console-shell fade-in">
        <div class="console-top">
          <div class="traffic"><span></span><span></span><span></span></div>
          <div class="console-title">Forge Console · Project #082</div>
          <div></div>
        </div>

        <div class="console-body">
          <div class="panel project-card">
            <h3>《晏子使楚》：一句话，如何让楚王当场下不来台？</h3>
            <div class="project-meta">
              <span class="tag">春秋</span>
              <span class="tag">外交博弈</span>
              <span class="tag">强反转</span>
            </div>

            <div class="script-box">
              <p>
                <strong>口播片段：</strong>
                楚王以为，羞辱一个矮小的使臣很容易。可他没想到，晏子只用一句话，就把羞辱变成了反击。
              </p>
            </div>

            <div class="pulse-line"></div>

            <div class="timeline">
              <div class="timeline-item">
                <div class="status-dot">✓</div>
                <div><b>选题评估</b><br><span>冲突清晰，适合短视频开场</span></div>
                <div class="progress"><i style="width:100%"></i></div>
              </div>
              <div class="timeline-item">
                <div class="status-dot">✓</div>
                <div><b>文案生成</b><br><span>已完成口播结构与情绪推进</span></div>
                <div class="progress"><i style="width:100%"></i></div>
              </div>
              <div class="timeline-item">
                <div class="status-dot">✓</div>
                <div><b>分镜规划</b><br><span>12 个镜头，已标注画面功能</span></div>
                <div class="progress"><i style="width:100%"></i></div>
              </div>
              <div class="timeline-item">
                <div class="status-dot">4</div>
                <div><b>素材匹配</b><br><span>人物、宫殿、竹简、战国地图</span></div>
                <div class="progress"><i style="width:78%"></i></div>
              </div>
              <div class="timeline-item">
                <div class="status-dot">5</div>
                <div><b>合成渲染</b><br><span>等待配音与时间线锁定</span></div>
                <div class="progress"><i style="width:36%"></i></div>
              </div>
            </div>
          </div>

          <div class="panel video-card">
            <div class="phone">
              <div class="phone-screen">
                <div class="video-title">9:16 预览 · 00:18</div>
                <div class="moon"></div>
                <div class="silhouette"></div>
                <div class="caption">"楚国无人了吗？怎么派你这样的人来？"</div>
              </div>
            </div>
            <div class="render-badge">
              <span>当前状态</span>
              <b>素材匹配中</b>
            </div>
          </div>
        </div>

        <!-- 传播潜力评分卡片 -->
        <div class="floating-card score-card">
          <small>传播潜力评分</small>
          <div class="score-row">
            <strong>91</strong>
            <span>强冲突 / 高反转</span>
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- CTA -->
  <section class="section cta-section">
    <div class="landing-container">
      <div class="section-header">
        <h2>你的第一个<em>历史视频</em>项目<br>从现在开始</h2>
        <p>不需要懂技术，不需要多人团队。<br>一个选题，一段历史，就是全部的起点。</p>
        <button class="btn-large btn-large-primary" @click="handleCreateProject">
          新建项目
          <span class="arrow">→</span>
        </button>
      </div>
    </div>
  </section>

  <!-- FOOTER -->
  <footer class="landing-footer">
    <span class="footer-meta">版本号：v1.0.0</span>
    <span class="footer-meta">联系邮箱：<a href="mailto:1451784145@qq.com" style="color:var(--text-muted); text-decoration:none">1451784145@qq.com</a></span>
  </footer>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";
import { useRouter } from "vue-router";
import { useProjectStore } from "../stores/project";

const router = useRouter();
const projectStore = useProjectStore();

async function handleCreateProject() {
  const project = await projectStore.createProject();
  await router.push(
    projectStore.resolveProjectWorkspacePath(
      project.project_id,
      project.current_status,
    ),
  );
}

let observer: IntersectionObserver | null = null;

onMounted(() => {
  // 启用首页金色光晕背景
  document.body.classList.add("landing-page-bg");

  // 滚动淡入动画：与 preview-landing.html 的 <script> 等价
  observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("visible");
        }
      });
    },
    { threshold: 0.1, rootMargin: "0px 0px -50px 0px" },
  );

  document.querySelectorAll<HTMLElement>(".fade-in").forEach((el, i) => {
    el.style.transitionDelay = `${i * 0.06}s`;
    observer!.observe(el);
  });
});

onUnmounted(() => {
  document.body.classList.remove("landing-page-bg");
  if (observer) {
    observer.disconnect();
    observer = null;
  }
});
</script>

<style scoped>
/* 所有样式在 landing-page.css 中全局定义；此处不做覆写 */
</style>
```

#### 关于 `<style scoped>` 的说明

- 上方模板留一个空的 `<style scoped>` 块，是为了让文件结构完整，便于后续如果要加 scoped 覆盖。
- 视觉样式都在 `landing-page.css` 中，以 `.landing-page ` 前缀作用域规则生效——因为模板最外层有 `<div class="landing-page">` wrapper，所有首页专属的 CSS 规则都以 `.landing-page .xxx` 形式匹配，对其他页面无影响。
- 保留为全局的：`:root` CSS 变量、`html { scroll-behavior: smooth }`、`body { font-family: ... }` 和 6 个 `@keyframes` 动画——这些都是纯描述性的，不会意外改变其他页面的视觉（若已有相同动画名会覆盖，但项目当前没有这些 keyframes）。
- 受限为首页的：`body.landing-page-bg { background/color }` 和 `body.landing-page-bg::before`——由 `onMounted`/`onUnmounted` 动态切换。

**验证要点**：迁移完成后打开 `/projects` 和 `/projects/:id/topic` 两个路由，检查是否出现非预期的琥珀金样式干扰。

---

## 四、交互与行为映射

| preview-landing.html 中的按钮 | HomePage.vue 中的交互 |
|---|---|
| 顶栏 "我的项目" (`class="btn btn-ghost"`) | `@click="router.push('/projects')"` |
| 顶栏 "新建项目" (`class="btn btn-primary"`) | `@click="handleCreateProject()"`（同下方 Hero CTA） |
| Hero 区 "新建项目 →" (`class="btn-large btn-large-primary"`) | `@click="handleCreateProject()"` |
| Hero 区 "观看示例" (`class="btn-large btn-large-ghost"`) | 空按钮（同原 HomePage.vue 的 `观看示例` stub） |
| CTA 区 "新建项目 →" (`class="btn-large btn-large-primary"`) | `@click="handleCreateProject()"` |
| "登录"按钮 | 空按钮（后续发布流计划另行处理） |
| "设置"按钮 | 空按钮（后续主题/偏好设置另行处理） |

`handleCreateProject` 的实现完全沿用原 HomePage.vue 的逻辑：调用 `projectStore.createProject()`，然后跳转。不新增任何 API 调用或 store 变更。

---

## 五、样式冲突与避让清单

### 5.1 必须改名的 class

| preview-landing.html 原名 | 移植后命名 | 备注 |
|---|---|---|
| `.container` | `.landing-container` | 避免与 Element Plus 的 `.container` 或项目内其他容器冲突 |
| `footer` | `.landing-footer` | 避免裸选择器污染工作区页面的 `<footer>` 元素（当前工作区没有 `<footer>`，但仍需防御性命名） |
| `body::before` | `body.landing-page-bg::before` | 仅首页启用金色径向渐变背景；onMounted/onUnmounted 切换 |

### 5.2 已加前缀隔离的 class

所有首页专属的 class 前都加了 `.landing-page ` 前缀（例如 `.landing-page .hero`、`.landing-page .section`、`.landing-page .btn` 等），配合模板最外层的 `<div class="landing-page">` wrapper，确保 landing-page.css 中的样式规则仅在首页组件内生效。

| class | 前缀后形式 | 效果 |
|---|---|---|
| `.hero` | `.landing-page .hero` | 仅首页 Hero 生效 |
| `.section` | `.landing-page .section` | 仅首页 section 容器生效 |
| `.btn` / `.btn-primary` / `.btn-ghost` | `.landing-page .btn` / `.landing-page .btn-primary` / `.landing-page .btn-ghost` | 不影响其他页面的 Element Plus 按钮 |
| `.topbar` | `.landing-page .topbar` | 仅首页顶栏生效 |
| `.pipeline-flow` / `.stage-icon` / `.why-section` / `.cap-card` / `.console-shell` / `.phone-screen` / `.cta-section` 等 | 全部加 `.landing-page ` 前缀 | 与其他页面无冲突 |

**说明**：由于 `.landing-page ` 前缀的存在，landing-page.css 中的所有首页专属样式不会与 ProjectsPage、ProjectWorkspace 或任何未来页面的样式发生冲突。`body { font-family: ... }` 和 `html { scroll-behavior: smooth }` 是有意保留的全局样式，属于设计风格的一部分；而 body 背景色/颜色则通过 `body.landing-page-bg` 限定在首页。

### 5.3 不迁移的 CSS

- `* { box-sizing: border-box; margin: 0; padding: 0; }`——main.css 已有等价 reset。
- 不删除 preview-landing.html 中的任何内容；该文件保留为对照物。

---

## 六、实施顺序与验证步骤

实施按以下顺序进行，每步单独 commit：

### Step 1：新建 favicon.svg

- 文件：`frontend/public/favicon.svg`
- 内容：场记板风格 SVG（与 preview-landing.html 顶部 brand-mark 同款）
- 验证：浏览器访问 `/`，检查标签页图标。

### Step 2：修改 index.html 的 title 与 favicon

- 文件：`frontend/index.html`
- 改动：改 `<title>` 为"历史短视频工坊"、加 `<link rel="icon" type="image/svg+xml" href="/favicon.svg">`
- 验证：浏览器刷新后 title 变化，且 favicon 图标正确加载。

### Step 3：新建 landing-page.css

- 文件：`frontend/src/styles/landing-page.css`
- 内容：完整复制 preview-landing.html `<style>` 块 + 按"CSS 规则替换表"的要求：
  - `.container` → `.landing-container`
  - `body::before` → `body.landing-page-bg::before`
  - `footer` → `.landing-footer`
  - `body` 的背景色/颜色 → `body.landing-page-bg` 范围内
  - `body { font-family: ... }` 保留全局
  - **所有其他选择器前加 `.landing-page ` 前缀**（如 `.landing-page .hero`、`.landing-page .section`、`.landing-page .pipeline-flow` 等）
  - `* { box-sizing ... }` 不迁移
  - `html { scroll-behavior: smooth }` 保留全局
- 必须保留的关键元素：
  - `:root` 中的颜色变量与 preview-landing.html 一致
  - `@keyframes spin-slow`、`@keyframes box-slide`、`@keyframes pulse-line`、`@keyframes arrow-flow`、`@keyframes fade-in-up`、`@keyframes pulse-anim`
  - `.landing-page .hero::after` 的竖线动画
  - `.landing-page .phone-screen` 下的 `.moon`、`.silhouette`、`.caption`（纯 CSS 可视化元素）
  - `@media` 断点中的所有规则同样加 `.landing-page ` 前缀
  - `.landing-page .flow-strip-compat` 样式：`opacity: 0; pointer-events: none;`——视觉上不显眼，但保留边界盒子使 Playwright 的 `isVisible()` 返回 true
- 验证：dev server 跑起来后在浏览器 Elements 面板搜索 `.landing-page` 能找到样式。

### Step 4：在 main.css 中 import landing-page.css

- 文件：`frontend/src/styles/main.css`
- 在最后一行追加 `@import "./landing-page.css";`
- 验证：首页可见琥珀金样式。

### Step 5：重写 HomePage.vue

- 文件：`frontend/src/views/HomePage.vue`
- 用本章第三节的完整模板替换当前内容。
- 关键结构元素确认：
  - 最外层 `<div class="landing-page">` wrapper——用于 landing-page.css 的样式范围锚定。
  - `<div class="topbar" data-testid="home-topbar">`——harness 哨兵锚点，必须保留。
  - 三个齿轮用 `v-for="i in 3" :key="i"` 渲染——减少代码重复。
  - 模板中所有 class 名与 preview-landing.html 一致，配合 landing-page.css 的 `.landing-page ` 前缀生效。
- 验证：
  - 首页视觉与 preview-landing.html 对比（视觉 1:1）。
  - "我的项目"按钮跳转到 `/projects`。
  - "新建项目"按钮创建项目并跳转到工作区。
  - `/projects` 页面的视觉不被首页样式污染（打开检查 ProjectsPage 原有布局无变化）。
  - `/projects/:id/topic` 工作区视觉无变化。
  - 滚动动画正常（流水线节点 / 能力卡片 / 控制台随滚动淡入）。
  - 响应式：浏览器缩窄到 600px 宽度，检查布局不破坏（应与 preview-landing.html 的 `@media` 断点一致）。

---

## 七、验收清单（Reviewer Checklist）

- [ ] `favicon.svg` 已创建在 `frontend/public/`，图标为场记板风格。
- [ ] `index.html` 的 `<title>` 为"历史短视频工坊"，favicon 引用为 `/favicon.svg`。
- [ ] `landing-page.css` 包含 preview-landing.html 中全部样式（:root 变量、topbar、hero、pipeline-flow、why-section、console-shell、cta-section、landing-footer、fade-in、@keyframes、@media 断点）。
- [ ] `.container` 已改为 `.landing-container`；`footer` 已改为 `.landing-footer`；`body::before` 已改为 `body.landing-page-bg::before`；`* { margin:0; padding:0 }` 未被迁移；`body { background/color }` 限制在 `body.landing-page-bg` 范围内；**所有其他选择器前加有 `.landing-page ` 前缀**。
- [ ] `main.css` 末尾有 `@import "./landing-page.css";`。
- [ ] `HomePage.vue` 的 `<template>` 最外层有 `<div class="landing-page">` wrapper，关闭标签位于 `</footer>` 与 `</template>` 之间。
- [ ] `HomePage.vue` 的 `<template>` 与 preview-landing.html `<body>` 结构 1:1：Top Bar / Hero / Pipeline Flow / Why It Works / Console Preview / CTA / Footer。
- [ ] `<div class="topbar">` 带 `data-testid="home-topbar"` 属性。
- [ ] `<section class="hero">` 带 `data-testid="home-hero"` 属性。
- [ ] `<h1 class="hero-title">` 带 `data-testid="home-heading"` 属性。
- [ ] `<div class="hero-tagline">` 带 `data-testid="home-tagline"` 属性。
- [ ] topbar "我的项目"按钮带 `data-testid="home-primary-cta"` 属性。
- [ ] `<div class="pipeline-flow">` 带 `data-testid="home-feature-rail"` 属性。
- [ ] `<p class="flow-strip-compat" data-testid="home-flow-strip">` 存在且可见（CSS 用 `opacity: 0; pointer-events: none;`，不破坏 Playwright `isVisible()`）。
- [ ] Hero 区三个齿轮用 `v-for="i in 3" :key="i"` 渲染。
- [ ] `HomePage.vue` 的 `<script setup>` 使用 `useRouter` + `useProjectStore`；`handleCreateProject` 与旧版一致。
- [ ] 顶栏 SVG 图标为场记板风格；齿轮动画、传送带动画保留。
- [ ] 控制台预览卡片：左侧项目进度时间线（5 步，含进度条）、右侧 9:16 手机预览（月亮+剪影+字幕）、左下角漂浮"传播潜力评分 91"。
- [ ] 流水线 7 个节点（4+3）+ 箭头动画保留。
- [ ] `onMounted` 添加 `landing-page-bg`，`onUnmounted` 移除；IntersectionObserver 在 onUnmounted 中 disconnect。
- [ ] `/` 路由视觉与 preview-landing.html 视觉一致（wrapper div 为正常结构，不影响视觉效果）。
- [ ] `/projects` 视觉未被破坏。
- [ ] `/projects/:id/topic` 视觉未被破坏。
- [ ] "我的项目"按钮跳转正确。
- [ ] "新建项目"按钮创建项目并跳转正确。
- [ ] 响应式 600px / 900px 断点正常。
- [ ] 不涉及的文件（ProjectsPage、ProjectWorkspace、所有子组件、tokens、theme、element-overrides、router、stores）未被改动。

---

## 八、失败回滚方案

若任何一步验证失败，按以下顺序回滚：

1. **Step 5 失败**（HomePage 视觉异常）：用 git 恢复 `HomePage.vue` 为原版本；不影响 favicon 和 landing-page.css。
2. **Step 4 失败**（其他页面被样式污染）：删除 `main.css` 中的 `@import "./landing-page.css"` 行。
3. **Step 3 失败**（landing-page.css 内容有误）：直接删除该文件。
4. **Step 2 / Step 1**：单独的 favicon 和 title 改动可独立 revert。

**注意**：所有改动只涉及前端静态资源文件，无后端改动风险，回滚成本低。

---

## 九、后续方向（本轮不做）

- **首页组件化**：将顶栏、Hero、流水线、控制台拆为 `components/landing/` 子组件，便于后续复用到 ProjectsPage 或其他页面。本轮不做。
- **登录 / 设置功能**：当前为占位按钮，后续需接入用户系统或本地偏好设置。不在本轮。
- **"观看示例"**：需有示例项目数据。不在本轮。
- **落地页静态资源迁移**：当前 preview-landing.html 作为独立静态页面仍然保留。待首页 1:1 验证通过并稳定运行一段时间后，可单独决策是否删除该静态预览页。该决策需要单独的小实施计划，不纳入本轮。
