# 资产 Tab 页实施计划

> 创建日期：2026-06-26
> 前置文档：[2026-06-26-asset-tab-ui-review.md](./2026-06-26-asset-tab-ui-review.md)
> 范围：全阶段 — 第一(P0) + 第二(P1) + 第三(P1-P2)

---

## 〇、总览

### 问题关联

P0 三项在实现上强耦合，必须作为一个整体交付：

| 编号 | 问题 | 依赖 |
|------|------|------|
| 2.9 | 状态机重构 | 无（基础设施） |
| 2.1 | 全屏阻塞生成体验 | 依赖 2.9 的状态模型 |
| 2.2 | 概览卡信息密度过高 | 依赖 2.9 + 2.1 后的非阻塞状态 |

### 改动文件

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `frontend/src/composables/useAssetTabPhase.ts` | **新增** | 显式阶段状态机 |
| `frontend/src/components/asset/AssetPanel.vue` | **重写** | 模板/脚本/样式重构 |
| `frontend/src/utils/asset-generating-view.ts` | **修改** | 修正 `blockPage` 逻辑 |
| `frontend/src/components/workspace/StageGenerating.vue` | **不改** | 保留作为规划生成全屏阻塞组件 |
| `tests/frontend/asset/asset-generating-view.test.ts` | **更新** | 适配新 `blockPage` 行为 |
| `tests/frontend/stores/asset-planning.test.ts` | **不改** | store 接口不变 |
| `tests/frontend/stores/assets.test.ts` | **不改** | store 接口不变 |

### 不改的范围

- `SegmentAssetCard.vue` — 本次不碰
- `asset-planning.ts` / `assets.ts` store — 接口签名不变
- 后端 API / schema — 不涉及
- CSS 变量定义 — 不涉及，复用现有变量

---

## 一、Step 1：新增 `useAssetTabPhase` composable

### 1.1 设计目标

用 discriminated union 替代 [AssetPanel.vue:L76-L79](file://d:/ai_learn/history-video-forge/frontend/src/components/asset/AssetPanel.vue#L76-L79) 的 4 个 boolean ref，将阶段推导集中到单一 computed。

### 1.2 类型定义

```ts
// frontend/src/composables/useAssetTabPhase.ts

import { computed, type ComputedRef } from "vue";
import type { AssetPlanningStore } from "../stores/asset-planning";
import type { AssetsStore } from "../stores/assets";

export type AssetTabPhase =
  | { kind: "loading" }
  | { kind: "no_plan" }
  | { kind: "error"; message: string }
  | { kind: "plan_generating" }
  | { kind: "plan_ready_no_manifest" }
  | { kind: "basic_assets_generating" }
  | { kind: "basic_assets_failed"; error: string }
  | { kind: "ready" }
```

### 1.3 阶段判定规则

| 条件 | phase |
|------|-------|
| 初始加载尚未完成 | `loading` |
| `planSnap.loadError` 非空 or `assetsSnap.loadError` 非空（非生成态） | `error` |
| `!active_asset_plan` 且不在生成中 | `no_plan` |
| `plan_generating` 状态 | `plan_generating` |
| `active_asset_plan` 存在 且 `!active_assets.manifest` 且不在资产生成中 | `plan_ready_no_manifest` |
| 基础资产生成中（`active_asset_plan` 存在 且 `!manifest` 且资产生成中） | `basic_assets_generating` |
| 基础资产生成失败（`loadError` 非空 且 `!manifest`） | `basic_assets_failed` |
| `manifest` 存在 | `ready` |

**核心原则**：phase 是纯 computed 派生值，不包含任何 `ref` 手动写入。`autoStartBasicAssets` 改为用户显式触发的按钮 action。

### 1.4 函数签名

```ts
export interface UseAssetTabPhaseInput {
  assetPlanningStore: AssetPlanningStore;
  assetsStore: AssetsStore;
  /** 首次快照加载是否完成 */
  initialLoadDone: ComputedRef<boolean>;
}

export interface UseAssetTabPhaseReturn {
  phase: ComputedRef<AssetTabPhase>;
}
```

### 1.5 实现要点

- `phase` 是只读 computed，从 store 状态直接派生
- `initialLoadDone` 由 `AssetPanel` 的 `onMounted` 控制：开始加载前为 `false`，`finally` 中置为 `true`
- `plan_generating` 的判定复用 `isAssetPlanSnapshotGenerating()`（[asset-planning.ts:L161-L175](file://d:/ai_learn/history-video-forge/frontend/src/stores/asset-planning.ts#L161-L175)）
- `basic_assets_generating` 判定：`active_asset_plan` 存在 且 `!manifest` 且 (`assetsStore.state.isGenerating` 或 `assetsSnap.execution_state.generating === true`)

### 1.6 测试策略

新增 `tests/frontend/asset/useAssetTabPhase.test.ts`：

| 测试用例 | 输入条件 | 期望 phase |
|----------|----------|------------|
| 初始加载未完成 | `initialLoadDone=false` | `loading` |
| 无规划且不生成中 | `!active_asset_plan`, `current_status=storyboard_ready` | `no_plan` |
| 加载失败 | `loadError` 非空且不在生成中 | `error` |
| 规划生成中 | `current_status=asset_plan_generating` | `plan_generating` |
| 规划就绪无manifest | `active_asset_plan` 存在, `!manifest`, 不生成中 | `plan_ready_no_manifest` |
| 基础资产生成中 | `active_asset_plan` 存在, `!manifest`, `isGenerating=true` | `basic_assets_generating` |
| 基础资产失败 | `loadError` 非空, `!manifest`, 不在生成中 | `basic_assets_failed` |
| manifest 就绪 | `manifest` 存在 | `ready` |

---

## 二、Step 2：修正 `asset-generating-view.ts` 的 `blockPage` 逻辑

### 2.1 当前 bug

[asset-generating-view.ts:L54-L65](file://d:/ai_learn/history-video-forge/frontend/src/utils/asset-generating-view.ts#L54-L65) 的第一个条件：

```ts
if (input.hasAssetPlan && !input.hasManifest && !input.isAssetsGenerating) {
  return {
    kind: "asset_plan",
    title: "正在生成资产规划",  // ← 规划已就绪时标题错误
    blockPage: true,             // ← 应该为 false
    ...
  };
}
```

当 `hasAssetPlan=true, hasManifest=false, isAssetsGenerating=false` 时，它返回"正在生成资产规划"并阻塞页面——但此时规划已经完成，应该展示规划概览而非阻塞。

已有测试 [asset-generating-view.test.ts:L78-L88](file://d:/ai_learn/history-video-forge/tests/frontend/asset/asset-generating-view.test.ts#L78-L88) 期望为此情况返回 `null`，但当前代码返回非 null。

### 2.2 修正方案

```ts
export function getAssetGeneratingView(
  input: AssetGeneratingViewInput,
): AssetGeneratingView | null {
  // 规划生成中：需要阻塞（此时连 segment 结构都没有）
  if (input.isPlanGenerating && !input.hasAssetPlan && !input.hasManifest) {
    return {
      kind: "asset_plan",
      title: "正在生成资产规划",
      hint: "正在调用大模型分析分镜并规划素材，可能需要 1-5 分钟。",
      blockPage: true,
      progress: input.planProgress ?? undefined,
    };
  }

  // 资产生成中
  if (input.isAssetsGenerating) {
    return {
      kind: "assets",
      title: input.hasAssetPlan && !input.hasManifest
        ? "正在生成基础资源"
        : "正在生成资产",
      hint: "正在生成或补齐素材，已有内容会保留在页面中，完成后状态会自动更新。",
      blockPage: false,  // ← 不再阻塞，改为内联进度
    };
  }

  return null;
}
```

**关键变更**：
1. 第一个条件增加 `input.isPlanGenerating && !input.hasAssetPlan` 守卫 — 只有真正在生成规划时才阻塞
2. `blockPage` 统一改为 `false`（非规划生成阶段一律不阻塞）
3. 规划就绪但无 manifest 的情况 → 返回 `null`，页面正常展示规划概览

### 2.3 不再需要的导出

`shouldShowAssetGeneratingView` 函数及其类型 `AssetGeneratingVisibilityInput` 在新 phase 模型下不再需要（phase 已经包含所有信息）。保留但标记为 deprecated，后续清理。

### 2.4 测试更新

- 保留 [asset-generating-view.test.ts:L78-L88](file://d:/ai_learn/history-video-forge/tests/frontend/asset/asset-generating-view.test.ts#L78-L88) 不变（已正确预期）
- 更新"规划生成中"相关用例以匹配新的 `blockPage` 条件
- 更新"基础资源生成中"用例以匹配 `blockPage: false`

---

## 三、Step 3：AssetPanel.vue 脚本重构

### 3.1 删除的 state

```diff
- const basicAssetsAutoStarted = ref(false);
- const canAutoStartBasicAssets = ref(false);
- const basicAssetsGenerationFailed = ref(false);
- const isInitialAssetSnapshotLoading = ref(true);
```

替代为：

```ts
const initialLoadDone = ref(false);
const { phase } = useAssetTabPhase({
  assetPlanningStore,
  assetsStore,
  initialLoadDone: computed(() => initialLoadDone.value),
});
```

### 3.2 不再需要的 computed

以下 computed 在 phase 模型下不再需要（被 phase 判定替代）：

- `shouldShowGeneratingView` — 删除，改用 phase+kind 判定
- `shouldShowAssetSkeleton` — 简化为 `phase.kind === "loading"`
- `generatingView` — 保留但只用于 `plan_generating` 阶段的标题文本

### 3.3 简化 onMounted

```ts
onMounted(async () => {
  initialLoadDone.value = false;
  try {
    await storyboardStore.loadActiveStoryboardSnapshot();
    await assetPlanningStore.loadActiveAssetPlanSnapshot();
    scriptStore.loadActiveScriptSnapshot();

    const planSnap = assetPlanningStore.state.snapshot;

    // 规划生成中 → 启动轮询，等待完成
    if (isAssetPlanSnapshotGenerating(planSnap)) {
      startAssetPolling();
      return;
    }

    // 从 storyboard 确认后进入 → 自动开始规划生成
    if (
      planSnap &&
      !planSnap.active_asset_plan &&
      (planSnap.current_status === "storyboard_ready" ||
        planSnap.current_status === "asset_plan_ready")
    ) {
      startAssetPolling();
      await assetPlanningStore.generateAssetPlan();
      startAssetPolling();
      return;
    }

    // 规划就绪 → 加载 assets 快照，不做 auto-start
    await assetsStore.loadProject();
    const assetsGen = assetsStore.state.snapshot?.active_assets?.execution_state?.generating;
    if (assetsGen) {
      startAssetPolling();
    }
  } finally {
    initialLoadDone.value = true;
  }
});
```

### 3.4 handleGenerateBasic 改为显式按钮触发

```ts
async function handleGenerateBasic() {
  if (isAssetsBusy.value) return;
  startAssetPolling();
  await assetsStore.generateAssets({ enabledProviderTypes: ["tts", "sfx", "bgm"] });
  // 不再需要 set failed flags — phase 从 store state 自动派生
}
```

### 3.5 不再需要 autoStartBasicAssets 函数和 watch

- 删除 `autoStartBasicAssets()` 函数
- 删除监听 5 个响应式值的 `watch` ([AssetPanel.vue:L561-L583](file://d:/ai_learn/history-video-forge/frontend/src/components/asset/AssetPanel.vue#L561-L583))
- 用户进入 `plan_ready_no_manifest` 阶段后看到「生成基础资产」按钮，点击才触发生成

### 3.6 handleRefreshGeneratingStatus 简化

```ts
async function handleRefreshGeneratingStatus() {
  await loadAssetSnapshot();
}
```

不再需要重试逻辑 — 失败状态由 phase 自动反映。

---

## 四、Step 4：AssetPanel.vue 模板重构

### 4.1 新的模板分支（按 phase.disriminated）

```
template v-if="phase.kind === 'plan_generating'"
  → StageGenerating（全屏阻塞，仅规划生成）

template v-else-if="phase.kind === 'loading'"
  → 骨架屏

template v-else-if="phase.kind === 'error'"
  → 错误卡片 + 重试

template v-else-if="phase.kind === 'no_plan'"
  → 「开始生成资产规划」按钮

template v-else-if="phase.kind === 'plan_ready_no_manifest'"
  → 规划概览卡 + 「生成基础资产」按钮

template v-else-if="phase.kind === 'basic_assets_generating'"
  → 规划概览卡 + 内联生成进度 + 「生成基础资产」按钮(loading)

template v-else-if="phase.kind === 'basic_assets_failed'"
  → 规划概览卡 + 错误提示 + 「重试生成基础资产」按钮

template v-else  (phase.kind === 'ready')
  → 完整正文区（全局设置 + 概览卡 + 口播音频 + 分镜列表 + 粘性底栏）
```

### 4.2 对比旧模板

| 旧条件 | 新条件 |
|--------|--------|
| `shouldShowGeneratingView && generatingView` | `phase.kind === 'plan_generating'` |
| `shouldShowAssetSkeleton` | `phase.kind === 'loading'` |
| `assetLoadError` | `phase.kind === 'error'` |
| `!activeAssetPlan && !hasManifest` | `phase.kind === 'no_plan'` |
| `!hasManifest && planSummary.length > 0` | `phase.kind === 'plan_ready_no_manifest'` 或 `'basic_assets_generating'` 或 `'basic_assets_failed'` |
| `v-else` (has plan → main content) | `phase.kind === 'ready'` 或 `'basic_assets_generating'` 的 fallback |

### 4.3 规划概览卡调整

当前规划概览卡（[AssetPanel.vue:L820-L852](file://d:/ai_learn/history-video-forge/frontend/src/components/asset/AssetPanel.vue#L820-L852)）在 `plan_ready_no_manifest`、`basic_assets_generating`、`basic_assets_failed` 三种 phase 下展示。三种状态的差异：

| phase | 操作按钮 | 进度提示 |
|-------|----------|----------|
| `plan_ready_no_manifest` | 「生成基础资产」 | 费用预估文字（现有） |
| `basic_assets_generating` | 「生成基础资产」(loading+disabled) | 内联进度条 `当前 N/M 已完成` |
| `basic_assets_failed` | 「重试生成基础资产」 | 错误提示 |

### 4.4 新增：内联生成进度组件

在 `basic_assets_generating` 阶段，规划概览卡内显示紧凑进度条：

```
┌─ 资产规划概览 ─────────────────────────────────┐
│ 任务统计：分镜图 8 项 · 视频 2 项 · 口播 1 项  │
│                                                  │
│ ⏳ 正在生成基础资产（口播、字幕、音效、配乐）    │
│ [████████░░░░░░] 3/8 已完成                     │
│ 系统每 5 秒自动刷新状态                          │
│                                                  │
│ [生成基础资产 (处理中...)] ← 禁用态              │
└──────────────────────────────────────────────────┘

> 注：`plan_ready_no_manifest` 和 `basic_assets_generating` 阶段均展示分镜卡片骨架（见 4.6），
> 基础资产完成后自动切换为真实分镜卡片。
```

### 4.5 概览卡精简（2.2）

**现状**：资产生成概览卡（[AssetPanel.vue:L886-L998](file://d:/ai_learn/history-video-forge/frontend/src/components/asset/AssetPanel.vue#L886-L998)）纵向过长，约 7 个子区域。

**目标结构**（`ready` 阶段）：

```
┌─ 资产状态栏（始终可见）─────────────────────────┐
│ ████████████░░░  8/12 已完成                     │
│ 3 张分镜图待生成，1 个视频待生成                  │
│ [批量生成剩余]  [展开详情 ▼]                     │
└──────────────────────────────────────────────────┘

┌─ 详情区（默认折叠）─────────────────────────────┐
│ 完成度：分镜图 5/8 · 视频 1/2 · 口播 ✓ · ...   │
│ 待处理项：[#3 分镜图 待生成] [#5 视频 待生成]    │
│ 成本：图片 ¥1.00 · 视频 ¥3.00 · 口播 ¥0.08     │
│ 合计 ¥4.08                                       │
│ [重新生成全部资产]                               │
└──────────────────────────────────────────────────┘
```

**实现要点**：

1. **状态栏**：紧凑一行（移动端可换行），包含进度条 + 摘要 + 主操作按钮
2. **详情区**：使用 `<details>` 元素（与现有"全局设置"风格一致），默认折叠
3. **`allTypeBreakdown` 过滤**：只展示 `total > 0` 的类型，隐藏"无需"项
4. **成本信息**：从主视区移到详情区，仅生成完成后通过 toast 提示单次费用
5. **「重新生成全部资产」**：移到详情区内，降低误触风险

### 4.6 分镜卡片骨架态（plan_ready_no_manifest 与 basic_assets_generating 阶段）

当 `phase === 'plan_ready_no_manifest'` 或 `phase === 'basic_assets_generating'` 时，规划概览卡下方显示分镜卡片骨架：

```html
<div v-if="segments.length > 0" class="asset-segments">
  <div
    v-for="(segment, index) in segments"
    :key="segment.segment_id"
    class="segment-card-skeleton"
  >
    <div class="skeleton-header">
      <span class="skeleton-badge">#{{ index + 1 }}</span>
      <span class="skeleton-text-short"></span>
    </div>
    <div class="skeleton-body">
      <div class="skeleton-media"></div>
      <div class="skeleton-info">
        <div class="skeleton-line"></div>
        <div class="skeleton-line skeleton-line--short"></div>
      </div>
    </div>
  </div>
</div>
```

使用纯 CSS 骨架动画（`skeleton-pulse`），不引入新依赖。

---

## 五、CSS 变更概要

### 5.1 新增样式

| 选择器 | 用途 |
|--------|------|
| `.asset-status-bar` | 紧凑状态栏容器（flex + 进度 + 操作） |
| `.asset-status-bar--collapsed` | 折叠态变体 |
| `.asset-status-summary` | 状态摘要文字 |
| `.asset-status-actions` | 右侧操作按钮组 |
| `.asset-inline-progress` | 内联进度条（规划概览卡内） |
| `.segment-card-skeleton` | 分镜卡片骨架 |
| `.segment-card-skeleton` 子元素 | 骨架各区域占位 |
| `.skeleton-pulse` 动画 | 骨架闪烁动画 |

### 5.2 删除的样式

| 选择器 | 原因 |
|--------|------|
| `.asset-overview-blocked` | 整合到详情区 |
| `.asset-blocked-chips` | 整合到详情区 |
| `.asset-overview-cost`（部分） | 移到详情区，样式保留 |
| `.asset-plan-auto-generating` | 替换为 `.asset-inline-progress` |
| `.asset-plan-overview-actions` | 替换为状态栏 action 区 |

### 5.3 保留的样式

- `.asset-overview-card` 重命名为 `.asset-status-card`
- `.asset-generating-progress` 用于内联进度文字
- `.asset-overview-title` 保留（详情区标题复用）
- `.asset-overview-types-v2` 保留但增加过滤逻辑

---

## 六、验收标准

### 6.1 功能验收

| 验收项 | 验证方式 |
|--------|----------|
| 从 storyboard 确认后进入，自动启动规划生成 | 浏览器测试 |
| 规划生成中显示全屏阻塞层 | 浏览器测试 |
| 规划完成后不自动开始基础资产 | 浏览器测试 |
| 规划概览卡显示「生成基础资产」按钮 | 浏览器测试 |
| 点击后开始生成基础资产，显示内联进度 | 浏览器测试 |
| 基础资产生成中不阻塞页面交互 | 浏览器测试 |
| 基础资产完成后自动展示 manifest 正文 | 浏览器测试 |
| 概览状态栏紧凑布局，详情区默认折叠 | 浏览器测试 |
| 「批量生成剩余资产」正常工作 | 浏览器测试 |
| 「确认并进入合成」正常工作 | 浏览器测试 |
| 页面刷新后正确恢复各阶段状态 | 浏览器测试 |
| 规划生成中刷新 → 恢复轮询 | 浏览器测试 |
| 基础资产生成中刷新 → 恢复轮询 | 浏览器测试 |

### 6.2 测试验收

```bash
# 运行 asset-generating-view 测试
npx vitest run --configLoader runner tests/frontend/asset/asset-generating-view.test.ts

# 运行新增的 useAssetTabPhase 测试
npx vitest run --configLoader runner tests/frontend/asset/useAssetTabPhase.test.ts

# 运行 store 测试（确保未引入回归）
npx vitest run --configLoader runner tests/frontend/stores/
```

### 6.3 回归检查

```bash
# 检查 TypeScript 编译
npx vue-tsc --noEmit

# 检查 lint
npm run lint
```

---

## 七、实施步骤

按依赖关系，建议 3 次提交：

### 提交 1：基础设施（新增 + 修正）

1. 新增 `frontend/src/composables/useAssetTabPhase.ts`
2. 新增 `tests/frontend/asset/useAssetTabPhase.test.ts`
3. 修正 `frontend/src/utils/asset-generating-view.ts` 的 `blockPage` 逻辑
4. 更新 `tests/frontend/asset/asset-generating-view.test.ts`

验证：`npx vitest run --configLoader runner tests/frontend/asset/`

### 提交 2：AssetPanel.vue 脚本重构

1. 引入 `useAssetTabPhase`，删除 4 个 boolean ref
2. 简化 `onMounted` 和 `watch`
3. 删除 `autoStartBasicAssets` 函数
4. `handleGenerateBasic` 改为显式触发
5. 简化其他 handler 中的 flag 引用

验证：`npx vue-tsc --noEmit` + 浏览器功能测试

### 提交 3：AssetPanel.vue 模板 + 样式重构

1. 模板分支改为 `phase.kind` 判定
2. 规划概览卡增加内联进度态
3. 概览卡拆分为状态栏 + 可折叠详情
4. 新增分镜卡片骨架
5. 新增/删除对应 CSS

验证：全部验收标准

---

## 八、风险与缓解

| 风险 | 概率 | 缓解措施 |
|------|------|----------|
| `useAssetTabPhase` phase 派生错误导致页面白屏 | 中 | 充分单元测试覆盖所有 phase 转换路径 |
| 浏览器测试覆盖不全的边界状态（如生成中刷新） | 中 | 对照旧代码逐路径验证 |
| 模板混用 `v-if/v-else-if` 链遗漏某 phase | 低 | TypeScript exhaustiveness check (`phase.kind` never 类型守卫) |
| CSS 重构导致图表/布局偏移 | 低 | 逐步替换 + 浏览器实时对比 |
| `SegmentAssetCard` 在 manifest 未就绪时收到空 props 报错 | 低 | 卡片已有空值守卫（如 `activeTasks.length === 0`），骨架态不渲染真实卡片 |

---

## 九、自审清单

实施完成后逐项打勾：

- [ ] `asset-generating-view.test.ts` 全部通过（含已修复的边界用例）
- [ ] `useAssetTabPhase.test.ts` 全部通过（8 种 phase）
- [ ] `stores/asset-planning.test.ts` 全部通过（无回归）
- [ ] `stores/assets.test.ts` 全部通过（无回归）
- [ ] `vue-tsc --noEmit` 零错误
- [ ] 浏览器：规划生成中全屏阻塞正常
- [ ] 浏览器：规划完成后显示「生成基础资产」按钮
- [ ] 浏览器：基础资产生成中不阻塞页面
- [ ] 浏览器：基础资产完成 → manifest 正文
- [ ] 浏览器：概览状态栏紧凑布局
- [ ] 浏览器：详情区默认折叠
- [ ] 浏览器：「确认并进入合成」正常
- [ ] 浏览器：页面刷新恢复各阶段正确

---

# 第二阶段：P1 生成控制与反馈优化

> 前置：第一阶段完成（状态机重构 + 去阻塞 + 概览卡精简）
> 范围：2.3（批量生成粒度）+ 2.5（生成状态反馈）+ 2.10（错误处理）

---

## Step 5：概览卡/粘性底栏锁粒度改为任务级

### 5.1 当前问题

[SegmentAssetCard.vue:L149](file://d:/ai_learn/history-video-forge/frontend/src/components/asset/SegmentAssetCard.vue#L149) 的 `isGloballyLocked` 由 `assetsStore.state.isGenerating` 派生，阻止所有卡片的生成/重新生成/上传/替换按钮。实际上是 [AssetPanel.vue:L111](file://d:/ai_learn/history-video-forge/frontend/src/components/asset/AssetPanel.vue#L111) 的 `isAssetsBusy` 通过 prop 链传入。

### 5.2 改动方案

**assets.ts store 扩展**：`isGenerating` 本身不变（用于概览卡状态条），新增 `generatingTaskIds: Set<string>` 跟踪正在执行的任务。

```ts
// assets.ts — 新增字段
export interface AssetsStoreState {
  isLoading: boolean;
  isGenerating: boolean;
  generatingTaskIds: Set<string>;  // ← 新增
  isUploading: string | null;
  generatingTaskId: string | null;
  loadError: string | null;
  snapshot: AssetsSnapshot | null;
}
```

**SegmentAssetCard 改动**：
- `isGloballyLocked` 不再阻塞所有按钮，改为只对 `generatingTaskIds` 中包含的 task 禁用
- 未在执行中的卡片允许：查看提示词、上传/替换已完成项、触发新任务生成
- 已在执行中的卡片按钮变为 loading 态 + 显示 `⏳ 生成中...` 内联文本

**AssetPanel 改动**：
- `isAssetsBusy` 继续用于概览卡状态条和批量操作按钮的全局 loading
- 向 `SegmentAssetCard` 新增 prop `generatingTaskIds: Set<string>`，替代全局 lock 判断。当前 `SegmentAssetCard` 的 `isGloballyLocked` 由父组件通过 `isAssetsBusy` 隐式传递（见 [SegmentAssetCard.vue:L149](file://d:/ai_learn/history-video-forge/frontend/src/components/asset/SegmentAssetCard.vue#L149)），需改为显式 prop：
  ```ts
  // SegmentAssetCard.vue — 新增 prop，删除 isGloballyLocked computed
  const props = defineProps<{
    // ... 现有 props 不变
    generatingTaskIds: Set<string>;
  }>();

  // 替代旧逻辑
  const isTaskLocked = computed(() =>
    props.generatingTaskIds.has(currentTask.value?.task_id ?? ""),
  );
  ```

### 5.3 概览卡进度条分段

将 `el-progress` 替换为分段进度条：

```html
<div class="asset-segmented-progress">
  <div v-for="seg in segmentedProgress" :key="seg.label"
       class="asset-progress-seg"
       :class="seg.status"
       :style="{ flex: seg.count }"
       :title="`${seg.label}: ${seg.done}/${seg.count}`"
  />
</div>
```

`segmentedProgress` computed 按 `task_type` 分组：

```ts
const segmentedProgress = computed(() => {
  // 按 task_type 分组统计，每组返回 { label, count, done, status }
  // status: "done" | "running" | "pending" | "failed"
});
```

CSS：分段色条，`done` 为绿色，`running` 为蓝色脉冲动画，`pending` 为灰色，`failed` 为红色。

### 5.4 改动文件

| 文件 | 改动 |
|------|------|
| `frontend/src/stores/assets.ts` | 新增 `generatingTaskIds`，在 `generateSingleTask`/`generateAssets` 中维护 |
| `frontend/src/components/asset/AssetPanel.vue` | 传递 `generatingTaskIds`，进度条改为分段 |
| `frontend/src/components/asset/SegmentAssetCard.vue` | 锁粒度改为任务级 + 内联 `⏳ 生成中...` |

### 5.5 验证

- 单任务生成中：其他卡片按钮未被禁用
- 生成中的卡片：按钮 loading 态
- 批量生成中：所有待生成卡片按钮不可点击，但已完成卡片的「上传/替换」可用
- 分段进度条颜色正确

---

## Step 6：批量生成粒度控制

### 6.1 改动方案

**分类型批量按钮**（详情区 actions 内）：

```html
<div class="asset-bulk-actions">
  <el-button v-if="missingImageCount > 0"
    @click="handleGenerateByType('image_still')"
    :loading="isAssetsBusy && generatingType === 'image_still'">
    生成全部图片（{{ missingImageCount }} 张，约 ¥{{ missingImageCost.toFixed(2) }}）
  </el-button>
  <el-button v-if="missingVideoCount > 0"
    @click="handleGenerateByType('video_clip')"
    :loading="isAssetsBusy && generatingType === 'video_clip'">
    生成全部视频（{{ missingVideoCount }} 段，约 ¥{{ missingVideoCost.toFixed(2) }}）
  </el-button>
  <el-button v-if="blockedItems.length > 0"
    @click="handleGenerateMissing"
    :loading="isAssetsBusy && generatingType === 'all'">
    生成全部剩余（{{ blockedItems.length }} 项）
  </el-button>
</div>
```

**待处理项复选框**：待处理项 chip 前面加 `<el-checkbox>`，选中项存入 `selectedBlockedIds: ref<string[]>([])`。操作区增加「生成选中项（N）」按钮。

### 6.2 新增 computed

```ts
const missingImageCount = computed(() =>
  blockedItems.value.filter(i => i.type === "分镜图").length
);
const missingVideoCount = computed(() =>
  blockedItems.value.filter(i => i.type === "分镜视频").length
);
const selectedBlockedIds = ref<string[]>([]);
// 操作时必须通过赋值触发响应式：selectedBlockedIds.value = [...selectedBlockedIds.value, id];
```

### 6.3 handleGenerateByType

```ts
async function handleGenerateByType(taskType: string) {
  const taskIds = blockedItems.value
    .filter(i => taskTypeLabels[i.type] === taskType)
    .map(i => i.taskId);
  const label = taskType === "image_still" ? "分镜图" : "分镜视频";
  // 复用现有 generateAssets 的 taskIds 参数
  await assetsStore.generateAssets({ mode: "selected", taskIds });
}
```

### 6.4 改动文件

| 文件 | 改动 |
|------|------|
| `frontend/src/components/asset/AssetPanel.vue` | 分类型按钮 + 复选框 + `handleGenerateByType` + 新增 computed |

### 6.5 验证

- 「生成全部图片」仅对 `image_still` 未完成任务发送请求
- 「生成全部视频」仅对 `video_clip` 未完成任务发送请求
- 复选框选中后「生成选中项」仅提交选中项
- 确认对话框显示分项费用明细

---

## Step 7：错误分级处理

### 7.1 前端错误模型

```ts
// frontend/src/utils/asset-errors.ts (新增)

export type AssetErrorSeverity = "fatal" | "transient" | "partial";

export interface AssetError {
  severity: AssetErrorSeverity;
  code: string;
  message: string;
  recoverable: boolean;
}

export function classifyError(error: string | AssetError): AssetError {
  if (typeof error !== "string") return error;
  // 从现有 error string 提取分类
  if (error.includes("network") || error.includes("fetch")) {
    return { severity: "transient", code: "NETWORK", message: error, recoverable: true };
  }
  if (error.includes("timeout") || error.includes("超时")) {
    return { severity: "transient", code: "TIMEOUT", message: error, recoverable: true };
  }
  if (error.includes("permission") || error.includes("权限") || error.includes("401") || error.includes("403")) {
    return { severity: "fatal", code: "AUTH", message: error, recoverable: false };
  }
  return { severity: "fatal", code: "UNKNOWN", message: error, recoverable: true };
}
```

### 7.2 UI 分级展示

**`error` phase（severity=fatal）**：全页错误卡片（现有行为，增加错误码显示）

**`basic_assets_failed` phase**：规划概览卡内错误提示 + 重试按钮

**任务级失败**：
- manifest 中 `task_execution.status === "failed"` → 概览卡待处理项显示红色 `生成失败` + 鼠标悬停显示错误原因
- 分镜卡片对应任务显示 `❌ 生成失败` + 错误原因 tooltip
- 新增「重试失败项（N）」按钮，区别于「批量生成剩余」

**轮询错误**（`useStagePolling`）：
- 连续 3 次失败 → 不停止轮询，而是在概览卡顶部显示持久警告条：
  `⚠️ 无法获取最新状态，正在重试...（已重试 3 次）[手动刷新]`

### 7.3 改动文件

| 文件 | 改动 |
|------|------|
| `frontend/src/utils/asset-errors.ts` | **新增**：错误分类函数 |
| `frontend/src/components/asset/AssetPanel.vue` | 错误分级 UI + 重试失败项按钮 |
| `frontend/src/components/asset/SegmentAssetCard.vue` | 任务失败原因 tooltip |
| `frontend/src/composables/useStagePolling.ts` | 轮询失败不停止，持久警告 |

### 7.4 验证

- 网络断开 → 全页错误卡片 + 错误码
- 部分任务失败 → 概览卡红标记 + 重试失败项按钮
- 轮询失败 → 警告条持续显示，不中断轮询

---

## 第二阶段自审清单

- [ ] `generatingTaskIds` 正确跟踪进行中任务
- [ ] 单任务生成中不锁其他卡片
- [ ] 分段进度条颜色正确
- [ ] 分类型批量按钮调用正确 taskIds
- [ ] 复选框选中 → 生成选中项正确
- [ ] 错误分级 UI 正确展示
- [ ] `vue-tsc --noEmit` 零错误
- [ ] 现有测试无回归

---

# 第三阶段：P1-P2 交互体验打磨

> 前置：前两阶段完成
> 范围：2.4（分镜导航）+ 2.6（提示词编辑）+ 2.7（预览体验）+ 2.8（升级视频入口）+ 2.11（审稿确认）+ 2.12（口播音频）+ 2.13（移动端）

---

## Step 8：分镜卡片侧边导航

### 8.1 设计

```
┌──┬─────────────────────────────┐
│ ●│ 资产状态栏                   │
│ ●│ ...                         │
│ ●│                              │
│ ○│ ┌─ #1 SegmentAssetCard ───┐ │
│ ●│ │ ...                      │ │
│ ○│ └──────────────────────────┘ │
│ ○│ ┌─ #2 SegmentAssetCard ───┐ │
│  │ │ ...                      │ │
│  │ └──────────────────────────┘ │
└──┴─────────────────────────────┘
 侧边导航（40px宽，仅桌面端）
 ● = 有待处理任务
 ○ = 无任务 / 全部完成
 ✕ = 有失败任务
```

### 8.2 实现

在 `AssetPanel.vue` 内联实现（不单独抽组件，体量小）：

```html
<nav v-if="segments.length > 0" class="asset-segment-nav" aria-label="分镜导航">
  <button
    v-for="(seg, i) in segments"
    :key="seg.segment_id"
    class="asset-segment-nav-dot"
    :class="navDotClass(seg.segment_id)"
    :title="`#${i + 1}${navDotTooltip(seg.segment_id)}`"
    @click="scrollToSegment(seg.segment_id)"
  >
    {{ i + 1 }}
  </button>
</nav>
```

```ts
function navDotClass(segId: string) {
  const items = blockedItems.value.filter(i => {
    const t = assetTasks.value.find(at => at.task_id === i.taskId);
    return t?.source_segment_id === segId;
  });
  if (items.some(i => i.reason === "生成失败")) return "dot--failed";
  if (items.length > 0) return "dot--pending";
  const segTasks = assetTasks.value.filter(t => t.source_segment_id === segId);
  if (segTasks.length === 0) return "dot--empty";
  return "dot--done";
}
```

CSS: `position: fixed; left: calc((100vw - 1200px) / 2 - 48px); top: 120px;` 桌面端固定，小屏 `display: none`。

### 8.3 键盘导航

```ts
function onKeyDown(e: KeyboardEvent) {
  if (e.key === "j" || e.key === "ArrowDown") {
    e.preventDefault();
    activeSegmentIndex.value = Math.min(activeSegmentIndex.value + 1, segments.value.length - 1);
    scrollToSegment(segments.value[activeSegmentIndex.value].segment_id);
  } else if (e.key === "k" || e.key === "ArrowUp") {
    e.preventDefault();
    activeSegmentIndex.value = Math.max(activeSegmentIndex.value - 1, 0);
    scrollToSegment(segments.value[activeSegmentIndex.value].segment_id);
  }
}
```

仅在 `ready` phase 激活，不与输入框冲突（`e.target` 非 `INPUT/TEXTAREA` 时响应）。

### 8.4 改动文件

| 文件 | 改动 |
|------|------|
| `frontend/src/components/asset/AssetPanel.vue` | 侧边导航 HTML + JS + CSS + 键盘事件 |

---

## Step 9：提示词内联编辑 + 一键优化

### 9.1 改动方案

**提示词区域可点击编辑**：

```html
<!-- SegmentAssetCard.vue 模板改动 -->
<div class="segment-info-prompt">
  <div class="segment-info-prompt-header">...</div>

  <!-- 编辑态 -->
  <textarea
    v-if="isEditingPrompt"
    ref="promptEditRef"
    v-model="editDraft"
    class="segment-prompt-textarea"
    rows="4"
    @keydown.ctrl.enter="handleSaveInlineEdit"
    @blur="handleSaveInlineEdit"
  />
  <!-- 只读态 -->
  <p v-else ref="promptTextRef" class="segment-info-prompt-text"
     @dblclick="handleStartInlineEdit"
     title="双击编辑提示词">
    {{ activePromptText }}
  </p>
</div>
```

**一键优化按钮**：在「智能优化」按钮旁边新增「⚡ 快速优化」按钮：

```ts
async function handleQuickOptimize() {
  const task = currentTask.value;
  if (!task?.prompt_draft) return;
  optimizing.value = true;
  try {
    const res = await fetch(`/api/projects/${props.projectId}/assets/tasks/${task.task_id}/prompt/optimize`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        current_prompt: task.prompt_draft,
        task_type: activeTab.value === "video" ? "video_clip" : "image_still",
        segment_id: props.segment.segment_id,
      }),
    });
    const data = await res.json() as { optimized_prompt: string };
    await savePromptDraft(task.task_id, data.optimized_prompt);
    await assetPlanningStore.loadActiveAssetPlanSnapshot();
    // 高亮提示词区域 2s
    highlightPrompt.value = true;
    setTimeout(() => { highlightPrompt.value = false; }, 2000);
    ElMessage.success("提示词已优化");
  } catch (e) {
    ElMessage.error("快速优化失败：" + (e instanceof Error ? e.message : "未知错误"));
  } finally {
    optimizing.value = false;
  }
}
```

**优化历史**：每个提示词在组件内维护 `previousPrompt: string | null`，`savePromptDraft` 前将旧值存入。提供「撤销」按钮（仅在刚优化/编辑后 30s 内可见）。

### 9.2 改动文件

| 文件 | 改动 |
|------|------|
| `frontend/src/components/asset/SegmentAssetCard.vue` | 内联编辑 + 快速优化 + 撤销 |

### 9.3 验证

- 双击提示词文本 → textarea 出现，Ctrl+Enter 保存
- 「⚡ 快速优化」点击 → 按钮 loading → toast 提示已完成
- 撤销按钮在操作后 30s 内可见 → 点击恢复旧值

---

## Step 10：分镜图预览体验优化

### 10.1 改动方案

**卡片布局**：媒体区从 220px → 260px：

```css
/* SegmentAssetCard.vue grid 调整 */
.segment-asset-card {
  grid-template-columns: 260px 1fr;  /* was 220px */
}
```

**轮播指示器增大**：圆点 6px → 10px：

```css
.segment-media-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}
```

**缩略图条**（多图任务，`activeTasks.length > 1`）：在预览区下方增加 36×64px 缩略图条：

```html
<div v-if="activeTasks.length > 1" class="segment-thumb-strip">
  <div v-for="(t, i) in activeTasks" :key="t.task_id"
       class="segment-thumb"
       :class="{ active: i === activeMediaIndex }"
       @click="activeMediaIndex = i">
    <img v-if="getArtifactForTask(t.task_id)"
         :src="artifactUrl(getArtifactForTask(t.task_id).artifact_id)"
         class="segment-thumb-img" />
    <span v-else class="segment-thumb-placeholder">{{ i + 1 }}</span>
  </div>
</div>
```

**全屏预览预加载**：切换到 `ready` phase 后，预设 `Image` 对象预加载所有已生成图片。

### 10.2 改动文件

| 文件 | 改动 |
|------|------|
| `frontend/src/components/asset/SegmentAssetCard.vue` | grid 调整 + 轮播指示器 + 缩略图条 + 预加载 |

---

## Step 11：升级 API 视频入口优化

### 11.1 改动方案

**图片预览区浮动按钮**：当 `videoTasks.length === 0` 且已有图片 artifact 时，预览区右上角显示浮动按钮：

```html
<div v-if="hasGeneratedMedia && currentArtifact?.artifact_type === 'image' && videoTasks.length === 0"
     class="segment-media-upgrade-badge"
     @click="emit('upgrade-video', segment.segment_id)">
  🎬 升级视频
</div>
```

样式：`position: absolute; top: 6px; right: 6px; z-index: 1;`，半透明背景 + hover 加深。

**视频 Tab 标签优化**：

```html
<button class="segment-media-tab" :class="{ active: activeTab === 'video' }" @click="activeTab = 'video'">
  视频
  <span class="segment-media-tag">
    {{ videoTasks.length > 0 ? 'API' : '运镜' }}
  </span>
</button>
```

**概览卡批量升级**：详情区内增加：

```html
<el-button v-if="upgradableSegments.length > 0"
  size="small" plain type="primary"
  @click="handleBatchUpgrade">
  将 {{ upgradableSegments.length }} 个分镜升级为 API 视频
</el-button>
```

`upgradableSegments` computed：已有的分镜图已完成、无视频任务、且 `narrative_role` 为 `turn` 或 `peak` 的分镜。

### 11.2 改动文件

| 文件 | 改动 |
|------|------|
| `frontend/src/components/asset/SegmentAssetCard.vue` | 浮动按钮 + Tab 标签 |
| `frontend/src/components/asset/AssetPanel.vue` | 批量升级按钮 + `upgradableSegments` computed |

---

## Step 12：人工审稿确认

### 12.1 改动方案

**分镜卡片确认按钮**：Header 区域右侧增加 ✓ 确认按钮：

```html
<div class="segment-header-row">
  <span class="segment-header-number">#{{ segmentIndex + 1 }}</span>
  ...
  <el-button
    size="small"
    :type="isSegmentAccepted ? 'success' : 'default'"
    :icon="isSegmentAccepted ? 'Check' : undefined"
    circle
    @click="toggleAcceptSegment"
    :title="isSegmentAccepted ? '取消确认' : '确认分镜'"
  />
</div>
```

```ts
const isSegmentAccepted = computed(() => {
  const segTasks = [...props.imageTasks, ...props.videoTasks];
  if (segTasks.length === 0) return true; // 无任务的分镜自动确认
  return segTasks.every(t => {
    const exec = props.executionsByTaskId.get(t.task_id);
    return exec?.status === "accepted" || exec?.status === "completed";
  });
});

async function toggleAcceptSegment() {
  for (const task of [...props.imageTasks, ...props.videoTasks]) {
    const exec = props.executionsByTaskId.get(task.task_id);
    if (exec?.output_artifact_ids?.[0]) {
      await assetsStore.acceptArtifact(task.task_id, exec.output_artifact_ids[0]);
    }
  }
  await assetsStore.loadProject();
}
```

**概览卡确认进度**：状态栏增加确认计数：

```html
<span v-if="acceptedCount > 0" class="asset-status-confirmed">
  已确认 {{ acceptedCount }}/{{ segmentCount }} 分镜
</span>
```

**进入合成前检查**：

```ts
function handleConfirm() {
  if (!canCompose.value) {
    ElMessage.warning(blockedReasonText.value);
    return;
  }
  if (unacceptedSegments.value.length > 0) {
    ElMessageBox.confirm(
      `还有 ${unacceptedSegments.value.length} 个分镜未确认，确定进入合成？`,
      "确认进入合成",
      { confirmButtonText: "确定进入", cancelButtonText: "返回确认", type: "warning" },
    ).then(() => doConfirm()).catch(() => {});
  } else {
    doConfirm();
  }
}
```

### 12.2 改动文件

| 文件 | 改动 |
|------|------|
| `frontend/src/components/asset/SegmentAssetCard.vue` | 确认按钮 + `isSegmentAccepted` |
| `frontend/src/components/asset/AssetPanel.vue` | 确认进度统计 + 进入合成前检查 |

---

## Step 13：口播音频卡片 + 移动端适配

### 13.1 口播音频卡片

改为可折叠 audio bar：

```html
<details v-if="narrationArtifact && narrationAudioUrl" class="asset-narration-bar" :open="false">
  <summary class="asset-narration-bar-header">
    <span>🔊 口播音频</span>
    <span class="asset-narration-bar-meta">
      <span v-if="narrationDuration !== null">{{ narrationDuration.toFixed(1) }}s</span>
      <span>¥{{ costBreakdown.tts.total.toFixed(2) }}</span>
    </span>
  </summary>
  <div class="asset-narration-bar-body">
    <audio controls :src="narrationAudioUrl" class="asset-narration-audio" />
    <p class="asset-narration-script-text" :class="{ 'asset-narration-script-text--collapsed': !narrationScriptExpanded }">
      {{ fullScriptText }}
    </p>
  </div>
</details>
```

默认折叠，点击 summary 展开。去掉独立的 `asset-narration-card` 卡片。

### 13.2 移动端适配

| 断点 | 调整 |
|------|------|
| `< 960px` | 侧边导航隐藏 |
| `< 768px` | `SegmentAssetCard` 切换为单列布局（已有） |
| `< 640px` | 状态栏换行（进度条单独一行，按钮单独一行） |
| `< 480px` | 媒体区宽度 100%（去掉 grid，stack 布局） |

关键 CSS 调整：

```css
@media (max-width: 960px) {
  .asset-segment-nav { display: none; }
}

@media (max-width: 640px) {
  .asset-status-bar {
    flex-direction: column;
    align-items: stretch;
    gap: var(--space-sm);
  }
  .asset-status-actions {
    justify-content: flex-end;
  }
}
```

### 13.3 改动文件

| 文件 | 改动 |
|------|------|
| `frontend/src/components/asset/AssetPanel.vue` | 口播音频改为 details + 响应式 CSS |
| `frontend/src/components/asset/SegmentAssetCard.vue` | 已有响应式，无需改动 |

---

## 第三阶段自审清单

- [ ] 侧边导航圆点颜色与分镜状态一致
- [ ] 侧边导航点击跳转正确
- [ ] 侧边导航在 `< 960px` 自动隐藏
- [ ] 键盘 `j/k` 在分镜卡片间切换
- [ ] 提示词双击 → 内联编辑 → Ctrl+Enter 保存
- [ ] 快速优化 → 结果自动应用 → 高亮 2s
- [ ] 撤销按钮在操作后可见
- [ ] 媒体区 260px + 缩略图条展示正常
- [ ] 全屏预览无性能退化
- [ ] 图片预览区「🎬 升级视频」浮动按钮
- [ ] 视频 Tab 标签显示「运镜」或「API」
- [ ] 分镜卡片 ✓ 确认按钮功能正常
- [ ] 未确认分镜 → 进入合成弹窗提示
- [ ] 口播音频默认折叠，展开正常
- [ ] 移动端各断点布局正常
- [ ] `vue-tsc --noEmit` 零错误

---

# 全阶段文件改动汇总

| 文件 | 阶段 | 改动类型 |
|------|------|----------|
| `frontend/src/composables/useAssetTabPhase.ts` | 1 | 新增 |
| `tests/frontend/asset/useAssetTabPhase.test.ts` | 1 | 新增 |
| `frontend/src/utils/asset-generating-view.ts` | 1 | 修改 blockPage 逻辑 |
| `tests/frontend/asset/asset-generating-view.test.ts` | 1 | 适配新行为 |
| `frontend/src/components/asset/AssetPanel.vue` | 1+2+3 | 脚本/模板/样式重构 |
| `frontend/src/components/asset/SegmentAssetCard.vue` | 2+3 | 锁粒度/进度/编辑/预览/确认 |
| `frontend/src/stores/assets.ts` | 2 | 新增 generatingTaskIds |
| `frontend/src/composables/useStagePolling.ts` | 2 | 轮询失败不停止 |
| `frontend/src/utils/asset-errors.ts` | 2 | 新增 |

**不改的**：`asset-planning.ts` store、`workspace.ts` store、`StageGenerating.vue`、后端 API、schema。
