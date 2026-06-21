# 前端 HTML 参照迁移 Harness Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现一套轻量的前端 HTML 参照迁移 harness，用于对照单文档 HTML 与 Vue route，输出截图、结构合同、交互 smoke、样式隔离检查和人工审查报告。

**Architecture:** 在现有 `harness/scripts/ui-acceptance/` 下新增 reference migration 子能力，复用 Playwright 与现有 UI acceptance 思路，但不改写 `smoke/full/report` 主链路。第一版以内置首页合同作为试点，输出报告到 `harness/scripts/runtime/output/ui-reference-migration/<run-id>/`。

**Tech Stack:** TypeScript、Playwright、Vite frontend、现有 harness runtime output 目录、Vitest。

---

## 0. 前置阅读

执行前先阅读：

- `AGENTS.md`
- `docs/plans/2026-06-21-frontend-html-reference-migration-harness-design.md`
- `harness/README.md`
- `harness/scripts/ui-acceptance/page-auditor.ts`
- `harness/scripts/ui-acceptance/page-rules.ts`
- `harness/scripts/ui-acceptance/dom-selectors.ts`
- `harness/scripts/ui-acceptance/browser-runner.ts`
- `frontend/public/preview-landing.html`
- `frontend/src/views/HomePage.vue`
- `package.json`

本计划只实现 harness，不迁移首页。

## 1. 文件结构

### 新增文件

- `harness/scripts/ui-acceptance/reference-migration-contracts.ts`
  - 定义合同类型。
  - 内置首页试点合同。
  - 提供按 id 查询合同的函数。

- `harness/scripts/ui-acceptance/reference-migration-model.ts`
  - 定义检查状态、检查结果、截图产物、报告 summary 的结构。
  - 提供 totals 汇总函数。

- `harness/scripts/ui-acceptance/reference-migration-runner.ts`
  - Playwright runner。
  - 打开参考页和目标页。
  - 捕获截图。
  - 执行 selector、viewport、交互和样式隔离检查。
  - 写入 `summary.json`、`summary.md`、合同快照和截图。

- `harness/scripts/ui-acceptance/reference-migration-report.ts`
  - 读取最近一次 `summary.json`。
  - 输出可读摘要。

- `tests/harness/ui-reference-migration-contracts.test.ts`
  - 测试合同定义、必需 selector、首页合同边界。

- `tests/harness/ui-reference-migration-model.test.ts`
  - 测试 summary totals、状态汇总、markdown 摘要基本结构。

### 修改文件

- `package.json`
  - 新增 `harness:ui-reference-migration`。
  - 新增 `harness:ui-reference-migration:report`。

- `harness/README.md`
  - 新增 UI reference migration 入口说明。

- `docs/plans/README.md`
  - 可选：在当前前端工作流方向处补一行当前 harness 计划索引。
  - 如果担心 README 编码或历史内容噪音，本任务可以不修改该文件。

## 2. 验证总命令

计划执行完成后至少运行：

```powershell
npx vitest run --configLoader runner tests/harness/ui-reference-migration-contracts.test.ts tests/harness/ui-reference-migration-model.test.ts
```

如果本机可以启动浏览器和前端服务，再显式运行：

```powershell
npm run harness:ui-reference-migration
npm run harness:ui-reference-migration:report
```

该显式运行会产出截图与报告，不应并入默认 `npm test`。

## Chunk 1: 合同与报告模型

### Task 1: 新增迁移合同模型和首页试点合同

**Files:**

- Create: `harness/scripts/ui-acceptance/reference-migration-contracts.ts`
- Test: `tests/harness/ui-reference-migration-contracts.test.ts`

- [ ] **Step 1: 写失败测试**

在 `tests/harness/ui-reference-migration-contracts.test.ts` 中新增：

```ts
import {
  getReferenceMigrationContract,
  listReferenceMigrationContracts,
} from "../../harness/scripts/ui-acceptance/reference-migration-contracts";

describe("reference migration contracts", () => {
  it("exposes the landing home contract", () => {
    const contracts = listReferenceMigrationContracts();
    expect(contracts.map((contract) => contract.id)).toContain("home-preview-landing");
  });

  it("keeps the home contract scoped to preview-landing and /", () => {
    const contract = getReferenceMigrationContract("home-preview-landing");

    expect(contract.referencePath).toBe("frontend/public/preview-landing.html");
    expect(contract.targetRoute).toBe("/");
    expect(contract.viewports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "desktop", width: 1440, height: 900 }),
        expect.objectContaining({ name: "mobile", width: 390, height: 844 }),
      ]),
    );
  });

  it("requires the existing home ui-acceptance hooks", () => {
    const contract = getReferenceMigrationContract("home-preview-landing");
    const selectors = contract.requiredSelectors.map((item) => item.selector);

    expect(selectors).toEqual(
      expect.arrayContaining([
        "[data-testid='home-hero']",
        "[data-testid='home-heading']",
        "[data-testid='home-tagline']",
        "[data-testid='home-primary-cta']",
        "[data-testid='home-feature-rail']",
        "[data-testid='home-flow-strip']",
      ]),
    );
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
npx vitest run --configLoader runner tests/harness/ui-reference-migration-contracts.test.ts
```

Expected: FAIL，提示找不到 `reference-migration-contracts`。

- [ ] **Step 3: 实现合同文件**

在 `harness/scripts/ui-acceptance/reference-migration-contracts.ts` 中实现：

```ts
export type ReferenceMigrationViewportName = "desktop" | "mobile";

export interface ReferenceMigrationViewport {
  name: ReferenceMigrationViewportName;
  width: number;
  height: number;
}

export interface ReferenceMigrationRequiredSelector {
  key: string;
  selector: string;
  mustBeInViewport?: boolean;
}

export interface ReferenceMigrationInteractionCheck {
  key: string;
  selector: string;
  action: "click";
  expectRoute?: string;
}

export interface ReferenceMigrationStyleIsolation {
  forbiddenGlobalSelectors: string[];
  sentinelRoutes: string[];
  forbiddenBodyClasses?: string[];
  forbiddenVisibleSelectors?: string[];
}

export interface ReferenceMigrationContract {
  id: string;
  title: string;
  referencePath: string;
  targetRoute: string;
  outputName: string;
  viewports: ReferenceMigrationViewport[];
  requiredSelectors: ReferenceMigrationRequiredSelector[];
  interactionChecks: ReferenceMigrationInteractionCheck[];
  styleIsolation: ReferenceMigrationStyleIsolation;
  manualReviewItems: string[];
}

const contracts: ReferenceMigrationContract[] = [
  {
    id: "home-preview-landing",
    title: "首页 preview-landing.html 到 HomePage.vue 迁移",
    referencePath: "frontend/public/preview-landing.html",
    targetRoute: "/",
    outputName: "home-preview-landing",
    viewports: [
      { name: "desktop", width: 1440, height: 900 },
      { name: "mobile", width: 390, height: 844 },
    ],
    requiredSelectors: [
      { key: "homeHero", selector: "[data-testid='home-hero']" },
      { key: "homeHeading", selector: "[data-testid='home-heading']", mustBeInViewport: true },
      { key: "homeTagline", selector: "[data-testid='home-tagline']" },
      { key: "homePrimaryCta", selector: "[data-testid='home-primary-cta']", mustBeInViewport: true },
      { key: "homeFeatureRail", selector: "[data-testid='home-feature-rail']" },
      { key: "homeFlowStrip", selector: "[data-testid='home-flow-strip']" },
    ],
    interactionChecks: [
      {
        key: "homePrimaryCtaRoute",
        selector: "[data-testid='home-primary-cta']",
        action: "click",
        expectRoute: "/projects",
      },
    ],
    styleIsolation: {
      forbiddenGlobalSelectors: ["body::before", "footer", ".container"],
      sentinelRoutes: ["/projects"],
      forbiddenBodyClasses: ["landing-page-bg"],
      forbiddenVisibleSelectors: [".topbar"],
    },
    manualReviewItems: [
      "桌面截图是否接近参考 HTML",
      "移动端截图是否接近参考 HTML",
      "字体差异是否可接受",
      "滚动淡入、齿轮、传送带等动画是否等价",
      "CTA、控制台预览、流水线节点是否视觉跑偏",
    ],
  },
];

export function listReferenceMigrationContracts() {
  return contracts;
}

export function getReferenceMigrationContract(id: string) {
  const contract = contracts.find((item) => item.id === id);
  if (!contract) {
    throw new Error(`unknown_reference_migration_contract:${id}`);
  }
  return contract;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run:

```powershell
npx vitest run --configLoader runner tests/harness/ui-reference-migration-contracts.test.ts
```

Expected: PASS。

- [ ] **Step 5: 提交**

```powershell
git add harness/scripts/ui-acceptance/reference-migration-contracts.ts tests/harness/ui-reference-migration-contracts.test.ts
git commit -m "新增前端参照迁移合同"
```

### Task 2: 新增报告模型

**Files:**

- Create: `harness/scripts/ui-acceptance/reference-migration-model.ts`
- Test: `tests/harness/ui-reference-migration-model.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import {
  createReferenceMigrationSummaryMarkdown,
  summarizeReferenceMigrationChecks,
  type ReferenceMigrationCheck,
} from "../../harness/scripts/ui-acceptance/reference-migration-model";

describe("reference migration model", () => {
  it("summarizes fail over warn and pass", () => {
    const checks: ReferenceMigrationCheck[] = [
      { code: "a", status: "PASS", message: "a passed" },
      { code: "b", status: "WARN", message: "b warned" },
      { code: "c", status: "FAIL", message: "c failed" },
    ];

    expect(summarizeReferenceMigrationChecks(checks)).toMatchObject({
      status: "FAIL",
      totals: { pass: 1, warn: 1, fail: 1, skipped: 0 },
    });
  });

  it("renders markdown with automatic and manual review sections", () => {
    const markdown = createReferenceMigrationSummaryMarkdown({
      run_id: "run-1",
      status: "WARN",
      generated_at: "2026-06-21T00:00:00.000Z",
      contracts: [
        {
          contract_id: "home-preview-landing",
          title: "首页",
          status: "WARN",
          checks: [{ code: "visual-review", status: "WARN", message: "needs review" }],
          screenshots: [{ viewport: "desktop", reference: "a.png", target: "b.png" }],
          manual_review_items: ["检查桌面截图"],
        },
      ],
      totals: { pass: 0, warn: 1, fail: 0, skipped: 0 },
    });

    expect(markdown).toContain("# UI Reference Migration Report");
    expect(markdown).toContain("home-preview-landing");
    expect(markdown).toContain("检查桌面截图");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
npx vitest run --configLoader runner tests/harness/ui-reference-migration-model.test.ts
```

Expected: FAIL。

- [ ] **Step 3: 实现报告模型**

实现状态类型 `PASS | WARN | FAIL | SKIPPED`、`ReferenceMigrationCheck`、`ReferenceMigrationRunSummary`、`summarizeReferenceMigrationChecks`、`createReferenceMigrationSummaryMarkdown`。

状态汇总规则：

```text
任一 FAIL -> FAIL
否则任一 WARN -> WARN
否则全 SKIPPED -> SKIPPED
否则 PASS
```

- [ ] **Step 4: 跑测试确认通过**

Run:

```powershell
npx vitest run --configLoader runner tests/harness/ui-reference-migration-model.test.ts
```

Expected: PASS。

- [ ] **Step 5: 提交**

```powershell
git add harness/scripts/ui-acceptance/reference-migration-model.ts tests/harness/ui-reference-migration-model.test.ts
git commit -m "新增前端参照迁移报告模型"
```

## Chunk 2: Runner 与报告入口

### Task 3: 实现 Playwright 迁移 runner

**Files:**

- Create: `harness/scripts/ui-acceptance/reference-migration-runner.ts`
- Modify: `package.json`

- [ ] **Step 1: 添加 runner 骨架**

实现能力：

1. 读取合同列表。
2. 自动生成 `runId`。
3. 创建输出目录。
4. 启动 Chromium。
5. 对每个合同和每个 viewport：
   - 打开参考页：`file://<repo-root>/<referencePath>`。
   - 打开目标页：`http://127.0.0.1:<frontend-port><targetRoute>`。
   - 截图到 `screenshots/<contract-id>/reference-<viewport>.png` 与 `target-<viewport>.png`。
6. 执行 selector 与 viewport 检查。
7. 执行交互检查。
8. 执行哨兵 route 检查。
9. 写 `summary.json` 与 `summary.md`。

第一版端口策略：

```text
默认 frontend base url: http://127.0.0.1:5173
允许环境变量 UI_REFERENCE_BASE_URL 覆盖
```

如果前端未启动，runner 直接 FAIL，并在报告中说明。不要在第一版自动启动 backend/frontend，降低复杂度。

- [ ] **Step 2: 添加 package script**

在根 `package.json` 新增：

```json
"harness:ui-reference-migration": "tsx harness/scripts/ui-acceptance/reference-migration-runner.ts"
```

- [ ] **Step 3: 手动验证静态失败路径**

不启动前端时运行：

```powershell
npm run harness:ui-reference-migration
```

Expected:

- 命令退出非 0。
- 生成 `harness/scripts/runtime/output/ui-reference-migration/<run-id>/summary.json`。
- summary 中记录目标 route 无法打开。

- [ ] **Step 4: 启动前端后验证成功产物**

一个终端运行：

```powershell
npm run dev:frontend
```

另一个终端运行：

```powershell
npm run harness:ui-reference-migration
```

Expected:

- 生成 reference 与 target 桌面/移动截图。
- 当前首页还未迁移时，结构检查可能 PASS 或 FAIL 取决于现状；视觉人工项应为 WARN。
- 命令退出码应根据自动检查决定：有 FAIL 则非 0，只有 WARN/PASS 则 0。第一版建议 `WARN` 不导致非 0。

- [ ] **Step 5: 提交**

```powershell
git add harness/scripts/ui-acceptance/reference-migration-runner.ts package.json package-lock.json
git commit -m "实现前端参照迁移截图检查入口"
```

### Task 4: 实现报告读取入口

**Files:**

- Create: `harness/scripts/ui-acceptance/reference-migration-report.ts`
- Modify: `package.json`

- [ ] **Step 1: 添加 report 脚本**

实现：

1. 默认读取 `harness/scripts/runtime/output/ui-reference-migration/` 下最新目录。
2. 支持 `--run-id <id>`。
3. 打印 `summary.md`。
4. 如果找不到报告，退出非 0 并提示先运行 `npm run harness:ui-reference-migration`。

- [ ] **Step 2: 添加 package script**

```json
"harness:ui-reference-migration:report": "tsx harness/scripts/ui-acceptance/reference-migration-report.ts"
```

- [ ] **Step 3: 验证**

Run:

```powershell
npm run harness:ui-reference-migration:report
```

Expected:

- 如果有最近报告，输出 markdown 摘要。
- 如果没有报告，给出清晰错误。

- [ ] **Step 4: 提交**

```powershell
git add harness/scripts/ui-acceptance/reference-migration-report.ts package.json package-lock.json
git commit -m "新增前端参照迁移报告入口"
```

## Chunk 3: 文档、边界和最终验证

### Task 5: 补充 harness README

**Files:**

- Modify: `harness/README.md`

- [ ] **Step 1: 在 UI Acceptance Entry 后增加说明**

新增小节：

```markdown
## UI Reference Migration Entry

- `npm run harness:ui-reference-migration`
  - 对单文档 HTML 参考页与 Vue 目标 route 做迁移对照检查。
  - 第一版内置首页试点：`frontend/public/preview-landing.html` -> `/`。
  - 输出截图、合同结果和人工审查清单到 `harness/scripts/runtime/output/ui-reference-migration/<run-id>/`。
- `npm run harness:ui-reference-migration:report`
  - 读取最近一次 reference migration summary，并打印可读报告。

边界：
- 该入口不自动把 HTML 转 Vue。
- 该入口不替代 `harness:ui-acceptance:smoke/full`。
- 视觉 1:1 第一版是人工审图项，不是 pixel diff 硬门禁。
- 如果要新增页面合同，先补对应 design / implementation plan 或在当前计划范围内明确试点页面。
```

- [ ] **Step 2: 验证 README 没有误导默认 gate**

检查文案必须明确：该入口是显式运行，不进入默认自动化门。

- [ ] **Step 3: 提交**

```powershell
git add harness/README.md
git commit -m "记录前端参照迁移 harness 入口"
```

### Task 6: 最终验证与收口

**Files:**

- No code changes unless fixing previous tasks.

- [ ] **Step 1: 运行模型与合同测试**

Run:

```powershell
npx vitest run --configLoader runner tests/harness/ui-reference-migration-contracts.test.ts tests/harness/ui-reference-migration-model.test.ts
```

Expected: PASS。

- [ ] **Step 2: 运行显式报告命令**

如果前端可启动：

```powershell
npm run dev:frontend
npm run harness:ui-reference-migration
npm run harness:ui-reference-migration:report
```

Expected:

- 输出目录存在。
- `summary.json` 与 `summary.md` 存在。
- 截图文件存在。
- 首页未迁移导致的差异只应体现在报告结果中，不应让 runner 崩溃。

如果前端无法启动，把该项标记为 `未验证`，并记录原因。

- [ ] **Step 3: 检查工作区**

Run:

```powershell
git status --short
git diff --stat
```

Expected:

- 只包含本计划允许的文件。
- 不包含 `storage/topic-candidate-library/`。
- 不包含首页迁移代码。

- [ ] **Step 4: 最终提交**

如果还有收尾修正：

```powershell
git add <changed-files>
git commit -m "完善前端参照迁移 harness 验证"
```

## 审查清单

给 Claude Code 或人工审查时，逐项检查：

- [ ] 是否只实现了 reference migration harness，没有迁移首页。
- [ ] 是否保留现有 `ui-acceptance` 主链路，不改写 smoke/full。
- [ ] 首页合同是否指向 `frontend/public/preview-landing.html` 和 `/`。
- [ ] 首页合同是否保留现有 `home-*` 测试锚点。
- [ ] 输出目录是否在 `harness/scripts/runtime/output/ui-reference-migration/`。
- [ ] 截图是否同时包含 reference 与 target、desktop 与 mobile。
- [ ] `summary.md` 是否明确列出人工审图项。
- [ ] `WARN` 是否不会误称整体通过。
- [ ] 样式隔离检查是否覆盖 `/projects` 哨兵 route。
- [ ] 文档是否明确该 harness 不替代 UI acceptance smoke/full。

## 后续扩展规则

新增其他页面合同时遵循：

1. 先新增合同测试。
2. 再新增合同定义。
3. 每个合同必须声明参考 HTML、目标 route、关键 selector、哨兵 route 和人工审查项。
4. 不允许把页面特定判断写死在 runner 主流程里；页面差异只进合同。
5. 新页面如果需要真实数据，必须显式声明 fixture 或跳过规则，不能默默依赖本地运行状态。
