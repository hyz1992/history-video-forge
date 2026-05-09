# UI Workspace Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 `story-video-forge2` 建立统一、克制、具备产品质感的深色历史叙事工作台，完成 `Home / Projects / Topic / Script` 四个页面的视觉与交互重构。

**Architecture:** 先在 `frontend` 内建立一层共享视觉基础，包括 design tokens、workspace shell 与 card/button/badge 基础样式；随后按 `Home -> Projects -> Topic -> Script` 的顺序逐页重构，必要时调整共享组件的展示结构，但不改变 store、API 与路由语义。整个过程保持 `data-testid` 稳定，并在每个阶段回跑前端测试与 UI acceptance。

**Tech Stack:** Vue 3, TypeScript, scoped CSS + 新增全局样式入口, Vue Router, 现有 topic/script store, Vitest, Playwright-based UI acceptance harness

---

## 范围说明

本计划覆盖：

- 新增全局视觉样式入口
- 统一 design tokens 与 workspace shell
- `Home / Projects / Topic / Script` 四个页面的视觉重构
- `topic` 与 `script` 共享组件的必要结构与样式调整
- 相关前端测试更新
- 自动验收截图回归

本计划不覆盖：

- backend / API / store 逻辑改造
- prompt / provider / runtime 行为调整
- `storyboard / assets / compose`
- 选题或文案生成算法优化
- 移动端专项设计体系

## 推荐阅读顺序

1. `docs/plans/2026-04-22-ui-workspace-redesign-design.md`
2. `docs/records/2026-04-22-agent-led-ui-acceptance-review.md`
3. `frontend/src/views/HomePage.vue`
4. `frontend/src/views/ProjectsPage.vue`
5. `frontend/src/views/TopicPage.vue`
6. `frontend/src/views/ScriptPage.vue`
7. `frontend/src/components/topic/TopicCandidateList.vue`
8. `frontend/src/components/topic/TopicCandidateDrawer.vue`
9. `frontend/src/components/script/ScriptDraftPanel.vue`
10. `frontend/src/components/script/ScriptReviewPanel.vue`
11. `D:/myproject/story-video-forge/frontend/src/styles/main.css`
12. `D:/myproject/story-video-forge/frontend/src/views/Landing.vue`
13. `D:/myproject/story-video-forge/frontend/src/views/Dashboard.vue`

## 完成标准

完成时至少必须满足：

- `frontend` 已拥有统一的全局视觉基础样式
- 四个页面共享同一套深色工作台视觉语言
- `Topic` 候选不再呈现为简单按钮列表
- `Script` 文案阅读区成为明确主舞台
- 前端相关测试通过
- `npm run harness:ui-acceptance:smoke` 通过
- `npm run harness:ui-acceptance:full` 通过
- 最新 UI acceptance 截图明显脱离工程壳观感

---

### Task 1: 建立共享视觉底座与全局样式入口

**Files:**
- Create: `frontend/src/styles/main.css`
- Modify: `frontend/src/main.ts`
- Test: `tests/frontend/topic-page.spec.ts`
- Test: `tests/frontend/script-page.spec.ts`

**Step 1: Write the failing test**

至少覆盖：

- `frontend/src/main.ts` 引入全局样式入口
- 页面根容器具备统一工作台背景 class 或可识别样式挂点
- 不影响现有 `topic` / `script` 基础渲染

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/frontend/topic-page.spec.ts tests/frontend/script-page.spec.ts`
Expected: FAIL if the new global shell hooks are not present

**Step 3: Write minimal implementation**

- 新增 `frontend/src/styles/main.css`
- 定义 design tokens：背景、文本、强调色、阴影、圆角、间距、按钮、badge、panel
- 在 `frontend/src/main.ts` 引入全局样式
- 为页面级容器提供统一 workspace shell 基础

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/frontend/topic-page.spec.ts tests/frontend/script-page.spec.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add frontend/src/styles/main.css frontend/src/main.ts tests/frontend/topic-page.spec.ts tests/frontend/script-page.spec.ts
git commit -m "建立前端工作台共享视觉底座"
```

---

### Task 2: 重构 Home 页面为深色叙事首页

**Files:**
- Modify: `frontend/src/views/HomePage.vue`
- Test: `tests/frontend/topic-page.spec.ts`
- Test: `tests/harness/ui-acceptance-page-rules.test.ts`

**Step 1: Write the failing test**

至少覆盖：

- `Home` 仍保留主标题、主 CTA、能力区、流程说明
- 首页新增 hero/能力卡等结构挂点
- 现有 `data-testid` 保持可用

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/frontend/topic-page.spec.ts tests/harness/ui-acceptance-page-rules.test.ts`
Expected: FAIL because the new `Home` structure hooks are missing

**Step 3: Write minimal implementation**

- 把首页改为深色 hero + 能力卡 + 流程带结构
- CTA 改为真正的主按钮与次按钮
- 保留原有文案语义与验收所需节点

**Step 4: Run test and smoke verification**

Run: `npm test -- tests/frontend/topic-page.spec.ts tests/harness/ui-acceptance-page-rules.test.ts`
Expected: PASS

Run: `npm run harness:ui-acceptance:smoke`
Expected: PASS with updated home screenshot

**Step 5: Commit**

```bash
git add frontend/src/views/HomePage.vue tests/frontend/topic-page.spec.ts tests/harness/ui-acceptance-page-rules.test.ts
git commit -m "重构首页为叙事工作台入口"
```

---

### Task 3: 重构 Projects 页面为项目仪表盘

**Files:**
- Modify: `frontend/src/views/ProjectsPage.vue`
- Test: `tests/frontend/topic-page.spec.ts`
- Test: `tests/harness/ui-acceptance-page-rules.test.ts`

**Step 1: Write the failing test**

至少覆盖：

- 搜索、新建、正式项目区、草稿项目区仍存在
- 项目卡片具有稳定结构挂点
- 现有 `data-testid` 保持稳定

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/frontend/topic-page.spec.ts tests/harness/ui-acceptance-page-rules.test.ts`
Expected: FAIL because the new dashboard structure hooks are missing

**Step 3: Write minimal implementation**

- 改造 `Projects` 为深色卡片化仪表盘
- 强化 header、toolbar、项目卡 hover、状态 badge
- 区分正式项目与草稿项目的视觉权重

**Step 4: Run test and smoke verification**

Run: `npm test -- tests/frontend/topic-page.spec.ts tests/harness/ui-acceptance-page-rules.test.ts`
Expected: PASS

Run: `npm run harness:ui-acceptance:smoke`
Expected: PASS with updated projects screenshot

**Step 5: Commit**

```bash
git add frontend/src/views/ProjectsPage.vue tests/frontend/topic-page.spec.ts tests/harness/ui-acceptance-page-rules.test.ts
git commit -m "重构项目页为项目仪表盘"
```

---

### Task 4: 重构 Topic 页面与候选组件

**Files:**
- Modify: `frontend/src/views/TopicPage.vue`
- Modify: `frontend/src/components/topic/TopicCandidateList.vue`
- Modify: `frontend/src/components/topic/TopicCandidateDrawer.vue`
- Modify: `frontend/src/components/topic/TopicTabs.vue`
- Test: `tests/frontend/topic-page.spec.ts`
- Test: `tests/frontend/topic-to-script-flow.spec.ts`
- Test: `tests/harness/ui-acceptance-page-rules.test.ts`

**Step 1: Write the failing test**

至少覆盖：

- 当前轮候选区、历史区、确认入口仍存在
- 候选项从简单按钮列表变为可识别卡片结构
- 选中态与详情区存在稳定 DOM 挂点

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/frontend/topic-page.spec.ts tests/frontend/topic-to-script-flow.spec.ts tests/harness/ui-acceptance-page-rules.test.ts`
Expected: FAIL because the new topic card/detail shell hooks are missing

**Step 3: Write minimal implementation**

- 重构 `Topic` 为主区 + 辅助区 + 详情区布局
- 候选项卡片化，并引入 selected/hover/focus 状态
- 历史区降级为辅助视觉权重
- 确认按钮提升为高优先级主动作

**Step 4: Run test and smoke verification**

Run: `npm test -- tests/frontend/topic-page.spec.ts tests/frontend/topic-to-script-flow.spec.ts tests/harness/ui-acceptance-page-rules.test.ts`
Expected: PASS

Run: `npm run harness:ui-acceptance:smoke`
Expected: PASS with improved topic screenshot

**Step 5: Commit**

```bash
git add frontend/src/views/TopicPage.vue frontend/src/components/topic/TopicCandidateList.vue frontend/src/components/topic/TopicCandidateDrawer.vue frontend/src/components/topic/TopicTabs.vue tests/frontend/topic-page.spec.ts tests/frontend/topic-to-script-flow.spec.ts tests/harness/ui-acceptance-page-rules.test.ts
git commit -m "重构选题页为候选审阅工作台"
```

---

### Task 5: 重构 Script 页面与文案阅读区

**Files:**
- Modify: `frontend/src/views/ScriptPage.vue`
- Modify: `frontend/src/components/script/ScriptDraftPanel.vue`
- Modify: `frontend/src/components/script/ScriptHistoryPanel.vue`
- Modify: `frontend/src/components/script/ScriptReviewPanel.vue`
- Modify: `frontend/src/components/script/ScriptStatusPanel.vue`
- Modify: `frontend/src/components/script/ScriptTracePanel.vue`
- Test: `tests/frontend/script-page.spec.ts`
- Test: `tests/frontend/script-workspace.spec.ts`
- Test: `tests/harness/ui-acceptance-page-rules.test.ts`

**Step 1: Write the failing test**

至少覆盖：

- 文案主区、动作区、trace 入口、历史版本仍存在
- 当前文案区成为主舞台，辅助区具备稳定挂点
- `regen_once` / 返回选题按钮语义不变

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/frontend/script-page.spec.ts tests/frontend/script-workspace.spec.ts tests/harness/ui-acceptance-page-rules.test.ts`
Expected: FAIL because the new script workspace shell hooks are missing

**Step 3: Write minimal implementation**

- 把 `Script` 改为双栏工作区
- 当前文案正文做阅读优化：字号、行距、段落、主次层级
- 审校、风险、trace 和历史版本改为辅助卡片/时间线式信息
- 保持现有动作逻辑不变

**Step 4: Run test and smoke verification**

Run: `npm test -- tests/frontend/script-page.spec.ts tests/frontend/script-workspace.spec.ts tests/harness/ui-acceptance-page-rules.test.ts`
Expected: PASS

Run: `npm run harness:ui-acceptance:smoke`
Expected: PASS with improved script screenshot

**Step 5: Commit**

```bash
git add frontend/src/views/ScriptPage.vue frontend/src/components/script/ScriptDraftPanel.vue frontend/src/components/script/ScriptHistoryPanel.vue frontend/src/components/script/ScriptReviewPanel.vue frontend/src/components/script/ScriptStatusPanel.vue frontend/src/components/script/ScriptTracePanel.vue tests/frontend/script-page.spec.ts tests/frontend/script-workspace.spec.ts tests/harness/ui-acceptance-page-rules.test.ts
git commit -m "重构文案页为深色文案工作台"
```

---

### Task 6: 最终截图验收与文档收口

**Files:**
- Modify: `docs/records/2026-04-22-agent-led-ui-acceptance-review.md`
- Create: `docs/records/2026-04-22-ui-workspace-redesign-conclusions.md`

**Step 1: Update review docs**

- 用最新截图与 agent 审查更新工作台结论
- 记录新旧 UI 的关键差异

**Step 2: Run final verification**

Run: `npm test`
Expected: PASS

Run: `npm run harness:ui-acceptance:smoke`
Expected: PASS

Run: `npm run harness:ui-acceptance:full`
Expected: PASS

**Step 3: Agent screenshot review**

- 对比 `Home / Projects / Topic / Script` 最新截图
- 判断是否仍像工程壳
- 若仍明显不达标，禁止宣称完成

**Step 4: Commit**

```bash
git add docs/records/2026-04-22-agent-led-ui-acceptance-review.md docs/records/2026-04-22-ui-workspace-redesign-conclusions.md
git commit -m "完成前端工作台视觉重构收口"
```
