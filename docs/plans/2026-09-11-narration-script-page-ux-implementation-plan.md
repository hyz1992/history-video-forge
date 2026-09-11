# 口播前置文案页体验收敛实施计划

日期：2026-09-11。设计入口：[narration-script-page-ux-design](./2026-09-11-narration-script-page-ux-design.md)。

## 改动文件范围

- 新增：`frontend/src/components/script/NarrationEntryCard.vue`、`frontend/src/components/script/NarrationGenerateDialog.vue`
- 修改：`frontend/src/components/script/ScriptPanel.vue`
- 删除：`frontend/src/components/script/NarrationPanel.vue`
- 测试：改写 `tests/frontend/narration-panel.spec.ts`、`tests/frontend/narration-script-source.spec.ts`
- 验收脚本（如环境允许回归）：`harness/scripts/ui-acceptance/narration-browser-acceptance.ts`

不改：后端 API、`stores/narration.ts`、shared schema、legacy 文案页。

## 步骤（低耦合小步，每步可独立验证）

### 步骤 1：新增 `NarrationEntryCard.vue`

- props：`store: NarrationStore`。
- 单行布局：音频占位条（未生成虚线占位 / 已生成 `<audio>`）、状态文本、入口按钮。
- 状态映射：复用 NarrationPanel 的 labels 语义，入口按钮文案按状态流转（生成口播/生成中…/试听口播/查看口播）。
- emit `open`。
- 验证：新增 jsdom 用例断言各状态下的文案与按钮禁用态。

### 步骤 2：新增 `NarrationGenerateDialog.vue`

- props：`store`、`visible`（v-model）、`estimatedDurationSec`；emit `update:visible`、`proceed`。
- 打开时 `store.refresh()`；声音摘要用 `context.options` 的 `model`/`voice` 显示名。
- 折叠设置区（编辑口播设置/保存/取消/应用推荐，逻辑从旧 NarrationPanel 平移，含“使下游失效”提示）。
- 生成区：主按钮「生成整篇口播」→ 未确认正文先 `store.confirmScript()` 再 `store.generate()`；生成中「生成中…」+「取消生成」；失败原因就地显示 + 重新生成。
- 试听区：`detail.files.audio` 播放；`accept-duration` 勾选；「确认这版口播」→ 成功关闭弹窗。
- 验证：新增 jsdom 用例覆盖自动确认正文、生成→试听→确认、超时长接受、失败重试。

### 步骤 3：ScriptPanel 接线

- narration 模式渲染 `NarrationEntryCard` + `NarrationGenerateDialog`，移除旧挂载。
- 确认按钮区去掉 `!narrationMode` 条件；`handleConfirm` 分流：就绪跳转；未就绪弹引导 `ElMessageBox`（「去生成口播」打开弹窗/「取消」）。
- 验证：改写 `narration-script-source.spec.ts` 中受影响的集成断言；手动构建。

### 步骤 4：删除旧组件与测试收口

- 删除 `NarrationPanel.vue`；改写 `narration-panel.spec.ts` 指向新组件；全量 `tests/frontend/` 与 `npm run build:frontend` 通过。

### 步骤 5：浏览器验收脚本适配与回归

- `narration-browser-acceptance.ts` 主链步骤改为：确认文案按钮 → 引导提示 →「去生成口播」→ 弹窗生成 → 试听 → 确认 → 跳转；事件库/设置断言同步。
- 环境允许时全量回归；Playwright 不可用则逐项标注未验证。

## 提交策略

每步一提交（中文）；步骤 1-4 合并为前端交互实现后按“入口卡/弹窗/接线/删除旧组件”分 2-3 个低耦合提交；最终全量验证与浏览器验收单独收口。
