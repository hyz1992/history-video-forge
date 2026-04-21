# UI Acceptance Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 `story-video-forge2` 建立一套仓库内正式维护的 UI 自动验收机制，自动启动前后端、用真实浏览器走完整 `topic + script` 主链路，并输出页面审查报告。

**Architecture:** 保留现有 `harness/scripts/runtime/` 作为 backend/runtime 验证层；新增基于 Playwright 的 `harness/scripts/ui-acceptance/` 作为浏览器验收层。第一版只覆盖 Chromium + 桌面端 + 单主链路，并用规则化方式判定页面是否达到最小可交付标准。

**Tech Stack:** Node.js 20+, npm workspaces, TypeScript, Playwright, tsx, 现有 backend/frontend dev server, 现有 harness output 目录治理

---

## 范围说明

本计划覆盖：

- Playwright 依赖与最小配置
- UI 验收输出目录与报告结构
- 自动启动和关闭 backend/frontend
- 真实浏览器主链路执行
- 关键页面截图与浏览器证据归档
- 页面结构规则与可交付最小规则
- `smoke / full / report` 三个正式命令入口

本计划不覆盖：

- 移动端
- 跨浏览器矩阵
- 像素 diff
- AI 视觉打分
- CI 强制 gate

## 推荐阅读顺序

1. `docs/plans/2026-04-21-ui-acceptance-design.md`
2. `docs/plans/2026-04-21-topic-script-phase-4-design.md`
3. `harness/README.md`
4. `harness/docs/harness-engineering-rules.md`
5. `harness/scripts/runtime/topic-script-live-check.ts`
6. `tests/harness/topic-script-live-check.test.ts`
7. `frontend/src/views/HomePage.vue`
8. `frontend/src/views/ProjectsPage.vue`
9. `frontend/src/views/TopicPage.vue`
10. `frontend/src/views/ScriptPage.vue`

## 完成标准

完成时至少必须满足：

- `playwright` 已接入仓库
- UI 验收器能自动启动和关闭前后端
- `smoke` 命令能走通单条完整项目主链路
- 关键页面截图、browser trace、summary 已落盘
- 页面结构规则可自动判定 PASS / WARN / FAIL
- `full` 命令能覆盖 `regen_once`、返回 topic、再次确认主题后的重新进入 script
- 脚本本身的纯逻辑测试通过

---

### Task 1: 建立 UI 验收输出骨架与报告模型

**Files:**
- Create: `harness/scripts/ui-acceptance/report-model.ts`
- Create: `harness/scripts/ui-acceptance/output-paths.ts`
- Create: `harness/scripts/runtime/output/ui-acceptance/.gitkeep`
- Test: `tests/harness/ui-acceptance-report.test.ts`

**Step 1: Write the failing test**

至少覆盖：

- 运行输出目录按 run id 规划
- `summary.json` 基础结构固定
- `PASS / WARN / FAIL` 汇总逻辑固定

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/harness/ui-acceptance-report.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

- 定义报告类型
- 定义输出目录生成规则
- 定义状态汇总函数

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/harness/ui-acceptance-report.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add harness/scripts/ui-acceptance/report-model.ts harness/scripts/ui-acceptance/output-paths.ts harness/scripts/runtime/output/ui-acceptance/.gitkeep tests/harness/ui-acceptance-report.test.ts
git commit -m "建立界面验收报告骨架"
```

---

### Task 2: 建立服务生命周期管理

**Files:**
- Create: `harness/scripts/ui-acceptance/service-manager.ts`
- Create: `harness/scripts/ui-acceptance/wait-for-ready.ts`
- Test: `tests/harness/ui-acceptance-service-manager.test.ts`

**Step 1: Write the failing test**

至少覆盖：

- backend / frontend 命令定义固定
- health / readiness 等待策略固定
- 清理逻辑在成功和失败路径都可执行

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/harness/ui-acceptance-service-manager.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

- 实现服务启动定义
- 实现轮询等待
- 实现进程清理

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/harness/ui-acceptance-service-manager.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add harness/scripts/ui-acceptance/service-manager.ts harness/scripts/ui-acceptance/wait-for-ready.ts tests/harness/ui-acceptance-service-manager.test.ts
git commit -m "建立界面验收服务管理器"
```

---

### Task 3: 接入 Playwright 与最小浏览器验收主链路

**Files:**
- Modify: `package.json`
- Create: `playwright.config.ts`
- Create: `harness/scripts/ui-acceptance/browser-runner.ts`
- Create: `harness/scripts/ui-acceptance/ui-acceptance-smoke.ts`
- Create: `harness/scripts/ui-acceptance/dom-selectors.ts`
- Test: `tests/harness/ui-acceptance-smoke.test.ts`

**Step 1: Write the failing test**

至少覆盖：

- smoke 运行计划包含首页、项目列表、topic、script 关键节点
- 主链路步骤定义固定
- 关键截图点名称固定

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/harness/ui-acceptance-smoke.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

- 在 `package.json` 增加 Playwright 依赖与 `harness:ui-acceptance:smoke` 命令
- 增加最小 Playwright 配置
- 实现真实浏览器 smoke 运行器
- 输出截图、trace 与基础 summary

**Step 4: Run tests and smoke verification**

Run: `npm test -- tests/harness/ui-acceptance-smoke.test.ts`
Expected: PASS

Run: `npm run harness:ui-acceptance:smoke`
Expected: PASS with screenshots and summary

**Step 5: Commit**

```bash
git add package.json playwright.config.ts harness/scripts/ui-acceptance/browser-runner.ts harness/scripts/ui-acceptance/ui-acceptance-smoke.ts harness/scripts/ui-acceptance/dom-selectors.ts tests/harness/ui-acceptance-smoke.test.ts
git commit -m "接入界面验收浏览器冒烟链路"
```

---

### Task 4: 建立页面结构规则与最小可交付判定

**Files:**
- Create: `harness/scripts/ui-acceptance/page-rules.ts`
- Create: `harness/scripts/ui-acceptance/page-auditor.ts`
- Test: `tests/harness/ui-acceptance-page-rules.test.ts`

**Step 1: Write the failing test**

至少覆盖：

- 首页主标题、主 CTA、主说明规则
- 项目页正式项目 / 草稿项目分区规则
- topic 工作区当前轮 / 历史轮 / 确认入口规则
- script 工作区动作区、`regen_once`、trace 入口规则
- 开发壳文案、空白区、只有 loading 的失败判定

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/harness/ui-acceptance-page-rules.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

- 建立页面规则函数
- 建立 PASS / WARN / FAIL 判定
- 将规则结果写入 summary

**Step 4: Run tests and smoke verification**

Run: `npm test -- tests/harness/ui-acceptance-page-rules.test.ts`
Expected: PASS

Run: `npm run harness:ui-acceptance:smoke`
Expected: PASS with rule results in summary

**Step 5: Commit**

```bash
git add harness/scripts/ui-acceptance/page-rules.ts harness/scripts/ui-acceptance/page-auditor.ts tests/harness/ui-acceptance-page-rules.test.ts
git commit -m "建立界面验收页面规则"
```

---

### Task 5: 扩展 full 链路与正式报告入口

**Files:**
- Modify: `package.json`
- Create: `harness/scripts/ui-acceptance/ui-acceptance-full.ts`
- Create: `harness/scripts/ui-acceptance/ui-acceptance-report.ts`
- Modify: `harness/scripts/ui-acceptance/browser-runner.ts`
- Test: `tests/harness/ui-acceptance-full.test.ts`

**Step 1: Write the failing test**

至少覆盖：

- `full` 运行计划包含 `regen_once`
- `full` 运行计划包含返回 topic 与再次确认
- `report` 能读取最近一次 summary 并输出摘要

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/harness/ui-acceptance-full.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

- 增加 `harness:ui-acceptance:full`
- 增加 `harness:ui-acceptance:report`
- 扩展浏览器运行器支持完整主链路
- 从产物目录读取最近一次结果

**Step 4: Run tests and full verification**

Run: `npm test -- tests/harness/ui-acceptance-full.test.ts`
Expected: PASS

Run: `npm run harness:ui-acceptance:full`
Expected: PASS with full-chain screenshots and summary

Run: `npm run harness:ui-acceptance:report`
Expected: PASS with readable summary output

**Step 5: Commit**

```bash
git add package.json harness/scripts/ui-acceptance/ui-acceptance-full.ts harness/scripts/ui-acceptance/ui-acceptance-report.ts harness/scripts/ui-acceptance/browser-runner.ts tests/harness/ui-acceptance-full.test.ts
git commit -m "补齐界面验收完整链路与报告"
```

---

### Task 6: 收口文档与最终验证

**Files:**
- Modify: `harness/README.md`
- Create: `docs/records/2026-04-21-ui-acceptance-conclusions.md`

**Step 1: Update docs**

- 在 `harness/README.md` 增加 UI 验收入口说明
- 写收口记录，记载 `smoke / full / report` 的运行结果与样本

**Step 2: Run final verification**

Run: `npm test`
Expected: PASS

Run: `npm run harness:ui-acceptance:smoke`
Expected: PASS

Run: `npm run harness:ui-acceptance:full`
Expected: PASS

Run: `npm run harness:ui-acceptance:report`
Expected: PASS

**Step 3: Commit**

```bash
git add harness/README.md docs/records/2026-04-21-ui-acceptance-conclusions.md
git commit -m "完成界面验收机制收口"
```
