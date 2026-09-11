# 口播前置文案页体验收敛设计（narration-first script page UX）

日期：2026-09-11。目标：在**不破坏既有文案页布局**的前提下，把口播前置（narration-first）的文案页交互从“一级大面板”收敛为“轻量入口 + 二级生成弹窗”，并补齐门禁引导。

## 1. 现状与问题

当前 narration 模式下文案页把整个 `NarrationPanel`（准备口播大面板）作为一级模块平铺在审校卡下方，存在以下体验问题：

1. 技术术语裸奔：直接展示 `provider_model_id`/`voice_profile_id` 等内部 ID（如 `tts.synthesize.dashscope.cn-beijing.qwen-audio-3.0-tts-plus`）。
2. 操作层级混乱：编辑设置区与主操作（确认正文/生成口播/刷新状态/进入分镜规划）全部平铺，无主次。
3. 顺序是谜题：按钮各自为政，「生成口播」灰置不解释原因，「进入分镜规划」恒禁用。
4. 「确认文案，进入分镜规划」在 narration 模式下被整体隐藏（模板 `v-if="!narrationMode"`），用户失去唯一熟悉的主操作入口；`handleConfirm` 里 `canProceed()` 不通过时静默 return，点击无任何反馈。
5. 无引导：用户不知道下一步该做什么、会花多少钱、做完会发生什么。

## 2. 设计目标

- 文案页原有布局（正文卡/审校卡/操作按钮）保持不动。
- 口播交互收敛为：**一行轻量入口 + 一个二级生成弹窗**。
- 「确认文案，进入分镜规划」按钮在 narration 模式下**恢复显示**，并按口播状态分流给出引导。
- 用户从头到尾主路径最多三次点击：确认文案（或自动）→ 生成口播 → 确认这版口播。

## 3. 方案

### 3.1 入口行组件 `NarrationEntryCard.vue`（新增）

挂在审校卡与操作按钮区之间（narration 模式），单行轻量：

- 左侧：**音频预览占位条**。未生成时为虚线占位（文案“尚未生成口播”）；已生成时显示真实 `<audio>` 播放控件。
- 中间：状态文本（尚未生成/生成中/可试听/已确认/生成失败/已过期，复用现有 labels 语义，去掉“刷新状态”等工程词）。
- 右侧：主入口按钮，按状态流转文案：
  - 未生成/已过期 → 「生成口播」；
  - 生成中 → 「生成中…」（禁用，显示轮询提示）；
  - 可试听 → 「试听口播」；
  - 已确认 → 「查看口播」。
- 点击入口 → 打开二级弹窗（emit `open`，弹窗状态由 ScriptPanel 持有）。

### 3.2 二级生成弹窗 `NarrationGenerateDialog.vue`（新增）

ElDialog（或项目既有 modal 风格）承载全部口播操作，页面主体不再出现任何口播设置细节：

- **声音摘要**（人类可读）：「龙翼暮凌 · 中性 · 1 倍速」——展示目录项 displayName 与音色名，不展示内部 ID。
- **设置折叠区**：默认收起，点「编辑口播设置」展开（模型与音色/情感/语速，复用现有 store `saveSettings` 与 context.options 资格过滤；保存前提示“会使用已确认口播与下游失效”）。
- **生成区**：大按钮「生成整篇口播」：
  - 点击时若正文未确认（`snapshot.script_confirmation` 为空），**先自动确认正文**（调 `store.confirmScript()`）再生成——用户无感知；
  - 生成前提示费用口径：“按实际字数计费，计入项目费用清单”；
  - 生成中按钮变「生成中…（约 1-2 分钟）」，可「取消生成」。
- **试听区**：生成完成后显示 `<audio>` 播放；超时长带外显示勾选「我接受本次超区间时长」。
- **确认区**：「确认这版口播」→ 成功关闭弹窗，入口行变“已确认”；失败/未知原因就地显示，可「重新生成」。
- 弹窗打开时自动 `store.refresh()` 保证状态最新。

### 3.3 ScriptPanel 接线

- narration 模式：移除 `<NarrationPanel>` 挂载，改为 `<NarrationEntryCard :store @open>` + `<NarrationGenerateDialog v-model:visible @proceed>`。
- 「确认文案，进入分镜规划」按钮区：narration 模式**同样渲染**（去掉 `!narrationMode` 条件）。点击分流：
  - `canProceed()` 为真 → 原逻辑跳转分镜；
  - 否则 → `ElMessageBox` 引导提示：“分镜规划需要先确认整篇口播，真实时长将驱动分镜切点”，带「去生成口播」（打开弹窗）与「取消」两个动作；未确认正文时提示文案补充“将先确认文案”。
- 深链门禁（`reason=narration_required` 回文案）保持不变，属后端行为不受影响。

### 3.4 旧组件处置

- `NarrationPanel.vue` 不再被任何页面引用 → 删除。
- 依赖它的测试改写：
  - `tests/frontend/narration-panel.spec.ts` → 改写为 `NarrationEntryCard` + `NarrationGenerateDialog` 的组件测试（状态文案、入口流转、弹窗生成→试听→确认、自动确认正文、确认按钮分流引导）。
  - `tests/frontend/narration-script-source.spec.ts` → 视其断言的 ScriptPanel 集成行为同步调整。

### 3.5 状态与数据

- 复用现有 `stores/narration.ts`（refresh/context/snapshot/detail/generate/confirmScript/confirm/cancel/saveSettings/canProceed），**store 与后端 API 零改动**。
- 弹窗关闭后入口行与弹窗共享同一 store，状态自动一致；生成/确认成功后由 store 内部 `perform()` 自动 `refresh()`。

## 4. 非目标

- 不改后端 API、不改 store 合同。
- 不改 legacy 模式文案页。
- 不做多候选试听竞品级功能（保留“最新候选/已确认”切换能力即可，弹窗内折叠）。
- 不引入新的费用预估协议（仅文案口径提示）。

## 5. 验收

- jsdom 组件测试覆盖 3.1/3.2/3.3 的全部交互分支。
- `tests/frontend/` 全量、`npm run build:frontend` 通过。
- 浏览器验收脚本主链步骤适配新交互并回归（Playwright 环境可用时执行；不可用则标注未验证）。
