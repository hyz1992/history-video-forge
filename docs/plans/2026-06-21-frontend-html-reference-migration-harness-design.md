# 前端 HTML 参照迁移 Harness 设计

日期：2026-06-21

## 一、任务背景

后续前端页面重构很可能反复采用同一种工作方式：先由单文档 HTML 提供视觉参照，再把该页面移植到 Vue 页面或组件中。当前已有 `harness/scripts/ui-acceptance/` 可以检查首页、项目页、topic、script 等页面的结构钩子和主链路 smoke，但它不负责回答下面这些迁移问题：

- 目标 Vue 页面是否仍然接近参考 HTML。
- 从单文档 HTML 搬来的全局 CSS 是否污染其他页面。
- 原页面已有 `data-testid`、路由入口、创建项目等产品行为是否被保留。
- 桌面与移动端截图是否足够接近参考稿，是否存在明显溢出、遮挡、首屏 CTA 丢失。
- 审查者能否快速拿到参考页与目标页的同视口截图、合同结果和待人工判断项。

因此需要先设计一套轻量的“HTML 参照迁移 harness”。它不是新的 UI 测试平台，而是在现有 UI acceptance 之上补一层专门服务重构迁移的合同、截图和报告能力。

## 二、目标

### 2.1 直接目标

1. 为“单文档 HTML -> Vue 页面”迁移建立统一验收合同。
2. 对每个迁移页面产出可审查的报告包：参考页截图、目标页截图、结构合同、交互 smoke、样式隔离检查、剩余人工判断项。
3. 首页落地页迁移作为第一批试点，先覆盖 `frontend/public/preview-landing.html` 到 `/` 的迁移。
4. 后续项目页、工作台页、render/export 预览页、发布流、人工审稿流可以复用同一套合同模型。

### 2.2 非目标

1. 不自动把 HTML 转 Vue。
2. 不把严格 pixel diff 作为第一版硬门禁。
3. 不重写现有 `ui-acceptance-smoke/full/report` 主链路。
4. 不默认启动真实后端生成链路，不触发真实 LLM、TTS、图生视频或发布流。
5. 不把参考 HTML 当成新的产品真相源；产品行为仍以当前 Vue route、store、API 合同和正式文档为准。
6. 不在本轮实现首页迁移，也不修改 `frontend/src/views/HomePage.vue`。

## 三、设计原则

1. **合同先于截图**：先声明页面必须保留的结构、行为、禁止项，再做视觉对照。
2. **报告优先，硬门禁克制**：第一版自动化只卡确定性风险；视觉 1:1 由报告辅助人工审查。
3. **复用现有 UI acceptance**：页面可见性、首屏 CTA、主链路 selector 尽量沿用 `harness/scripts/ui-acceptance/`。
4. **不污染业务实现**：harness 放在 `harness/scripts/ui-acceptance/`，测试放在 `tests/harness/`，不要求业务页面引入专用测试逻辑。
5. **低耦合试点**：首页试点只验证 `/`、`/projects` 和一个工作台路由是否被样式污染，不进入 topic/script 生成主链路。
6. **人工审查友好**：输出必须能被 Claude Code 或人工审查者直接阅读，报告中明确“自动通过”和“需要人工看图判断”的范围。

## 四、核心概念

### 4.1 迁移合同

每个迁移页面声明一份 `ReferenceMigrationContract`。合同描述参考 HTML、目标路由、截图视口、结构钩子、交互动作、样式隔离规则和人工审查项。

示例字段：

```ts
interface ReferenceMigrationContract {
  id: string;
  title: string;
  referencePath: string;
  targetRoute: string;
  outputName: string;
  viewports: Array<{
    name: "desktop" | "mobile";
    width: number;
    height: number;
  }>;
  requiredSelectors: Array<{
    key: string;
    selector: string;
    mustBeInViewport?: boolean;
  }>;
  interactionChecks: Array<{
    key: string;
    selector: string;
    action: "click";
    expectRoute?: string;
  }>;
  styleIsolation: {
    forbiddenGlobalSelectors: string[];
    sentinelRoutes: string[];
    forbiddenBodyClasses?: string[];
    forbiddenVisibleSelectors?: string[];
    reviewedGlobalSelectors?: string[];
  };
  manualReviewItems: string[];
}
```

### 4.2 参考页

参考页是 `frontend/public/*.html` 或后续设计预览 HTML。harness 只把它作为视觉参照和迁移输入，不把它作为产品行为真相源。

首页试点参考页：

- `frontend/public/preview-landing.html`

### 4.3 目标页

目标页是 Vite/Vue 应用中的 route。首页试点目标页：

- `/`

目标页必须保留现有产品入口：

- 进入项目列表。
- 创建项目并跳转工作台。
- 保留当前 UI acceptance 所需关键 `data-testid`，或者在合同中显式记录替换方案。

### 4.4 报告包

每次运行输出到：

```text
harness/scripts/runtime/output/ui-reference-migration/<run-id>/
```

目录结构：

```text
summary.json
summary.md
contracts/<contract-id>.json
screenshots/<contract-id>/reference-desktop.png
screenshots/<contract-id>/target-desktop.png
screenshots/<contract-id>/reference-mobile.png
screenshots/<contract-id>/target-mobile.png
screenshots/<contract-id>/sentinel-projects.png
console-summary.json
network-summary.json
```

`summary.md` 是给人工与 Claude Code 审查的主要入口；`summary.json` 给自动脚本和后续报告读取。

## 五、首页试点合同

### 5.1 合同范围

首页试点只覆盖：

- 参考 HTML：`frontend/public/preview-landing.html`
- 目标 route：`/`
- 哨兵 route：`/projects`
- 可选哨兵 route：`/projects/:projectId/topic`，第一版如果没有可用项目可标记为 `SKIPPED`

### 5.2 必须保留的结构钩子

首页目标页需要保留或显式映射以下钩子：

```text
[data-testid='home-hero']
[data-testid='home-heading']
[data-testid='home-tagline']
[data-testid='home-primary-cta']
[data-testid='home-feature-rail']
[data-testid='home-flow-strip']
```

如果设计稿结构中没有完全对应的 DOM，也应在迁移时把这些 `data-testid` 挂到语义最接近的元素上。这样现有 `ui-acceptance` 不需要因为视觉重构而失去主锚点。

首页迁移还应新增迁移专用锚点：

```text
[data-testid='home-topbar']
```

该锚点用于样式污染哨兵检查，避免用 `.topbar` 这类通用类名判断其他页面是否被首页样式污染。若实现选择使用类名，也应使用 `.landing-topbar` 这类页面专属类名，而不是裸 `.topbar`。

### 5.3 自动检查

首页试点自动检查包括：

1. 参考页和目标页在桌面、移动视口均能截图。
2. 目标页主标题和主 CTA 在首屏 viewport 内。
3. 必须 selector 可见。
4. 点击目标页主 CTA 后仍能到达预期 route。
5. 打开 `/projects` 后不出现首页专属背景类、首页专属固定 topbar 或明显 DOM 泄漏。
6. 页面 body 不为空，不出现 `todo`、`debug`、`placeholder` 等开发壳文案。

### 5.4 人工判断项

第一版不自动判定这些项目，只在报告中列出并配图：

1. 桌面截图是否接近 1:1。
2. 移动截图是否接近 1:1。
3. 字体差异是否可接受。
4. 动画效果是否与参考页等价。
5. 视觉层级、留白、按钮尺寸是否明显跑偏。
6. 参考页中的占位功能按钮是否在目标页中保持合理占位或明确禁用。

## 六、样式隔离策略

单文档 HTML 最大风险是把 `body`、`:root`、`.container`、`.btn`、`.panel`、`.tag`、`footer` 等选择器直接搬入 Vue 项目。harness 第一版不解析完整 CSS AST，但应做确定性文本检查和浏览器哨兵检查。

建议规则：

1. 迁移后的页面样式必须存在页面根类，例如 `.landing-page` 或 `.reference-landing-page`。
2. 新增页面专属 CSS 文件时，禁止裸 `body::before`、裸 `footer`、裸 `.container` 这类高污染选择器。
3. 如果必须使用 `body` 类背景，必须通过 route 生命周期添加和移除，例如 `document.body.classList.add("landing-page-bg")` 与 `remove` 成对出现。
4. 目标页面卸载后，哨兵 route 截图中不得仍显示首页专属背景、固定 topbar 或首屏装饰。

第一版样式隔离检查分两层：

1. 静态文本检查：只扫描 `frontend/src/**/*.css` 与 `frontend/src/**/*.vue`，不扫描 `frontend/public/*.html` 参考文件；发现合同里的 `forbiddenGlobalSelectors` 时直接 FAIL，除非该 selector 被显式列入 `reviewedGlobalSelectors` 并在报告中作为人工审查项展示。
2. 浏览器哨兵检查：打开合同声明的 `sentinelRoutes`，检查 `forbiddenBodyClasses` 没有残留，且 `forbiddenVisibleSelectors` 不可见；首页试点必须使用 `[data-testid='home-topbar']` 或 `.landing-topbar` 这类页面专属 selector，不能使用裸 `.topbar`。

第一版允许 `body`、`html` 的少量全局基础属性调整，但必须在合同报告中列出，供审查者确认。

## 七、与现有 UI Acceptance 的关系

现有 UI acceptance 继续负责完整主链路：

- `npm run harness:ui-acceptance:smoke`
- `npm run harness:ui-acceptance:full`
- `npm run harness:ui-acceptance:report`

新增 reference migration harness 只负责“视觉参照迁移”：

```powershell
npm run harness:ui-reference-migration
npm run harness:ui-reference-migration:report
```

两者关系：

1. reference migration 先验证页面迁移不跑偏。
2. ui acceptance 再验证产品主链路仍可跑通。
3. 首页迁移完成前，不用把 reference migration 加入默认 `npm test`。
4. 当多页迁移稳定后，再决定是否把轻量合同检查并入默认 gate；截图对比仍保持显式运行。

## 八、失败分级

### 8.1 FAIL

以下问题应直接失败：

- 参考页无法打开或目标页无法打开。
- 目标页关键 selector 缺失。
- 主 CTA 不在首屏。
- 主 CTA 行为断裂。
- 哨兵 route 明显被首页样式污染。
- 报告无法生成。

### 8.2 WARN

以下问题应警告，不阻塞第一版：

- 截图存在明显视觉差异，但需要人工判断。
- 字体渲染差异。
- 动画时序差异。
- mobile 截图中低优先级装饰位置略有偏移。
- 参考页本身存在占位按钮或未接入功能。

### 8.3 SKIPPED

以下情况可以跳过并记录：

- 没有可用项目时跳过 `/projects/:projectId/topic` 哨兵 route。
- 没有后端服务时跳过创建项目交互，只保留静态 selector 与截图检查。

## 九、实施边界

第一版实施只允许触碰：

- `harness/scripts/ui-acceptance/`
- `tests/harness/`
- `package.json`
- `harness/README.md`
- 必要时补充 `docs/plans/README.md`

第一版不允许触碰：

- `frontend/src/views/HomePage.vue`
- `frontend/src/views/ProjectsPage.vue`
- `frontend/src/components/`
- `frontend/src/stores/`
- `backend/`
- `shared/`
- `renderer/`
- `harness/prompts/`

## 十、完成标准

1. 已有首页试点合同。
2. 能打开参考 HTML 与目标 route，并输出桌面/移动截图。
3. 能执行 selector、viewport、CTA、样式污染哨兵检查。
4. 能输出 `summary.json` 与 `summary.md`。
5. 文档中明确哪些结果是自动验收，哪些结果仍需人工审图。
6. 现有 UI acceptance smoke/full 不被改写。
7. 所有新增文档和提交信息使用中文。
