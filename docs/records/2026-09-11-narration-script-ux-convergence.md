# 口播前置文案页体验收敛记录

日期：2026-09-11。设计：[narration-script-page-ux-design](../plans/2026-09-11-narration-script-page-ux-design.md)；实施计划：[implementation-plan](../plans/2026-09-11-narration-script-page-ux-implementation-plan.md)。

## 结论

已收敛。口播前置文案页从“一级大面板”收敛为“轻量入口行 + 二级生成弹窗”，确认文案按钮恢复显示并按口播状态分流引导。前端全量 310/310 通过、构建通过；真实浏览器验收 22 项 PASS、零未处理拒绝。

## 交付

- `NarrationEntryCard.vue`（新增）：单行入口（音频占位/真实播放、状态文案、状态流转按钮），生成中自动轮询。
- `NarrationGenerateDialog.vue`（新增）：二级弹窗承载设置（默认折叠）、人类可读声音摘要（不暴露内部 ID）、生成前自动确认正文、试听、超时长接受与确认。
- `ScriptPanel.vue`：narration 模式改挂入口行+弹窗；「确认文案，进入分镜规划」恢复显示，口播未就绪时弹引导提示（「去生成口播」一键打开弹窗），就绪后正常跳分镜。
- 删除 `NarrationPanel.vue` 旧大面板；改写 `narration-panel.spec.ts` → `narration-entry-dialog.spec.ts`（19 用例：入口状态/弹窗流转/自动确认/超时长/失败/关闭）。
- 浏览器验收脚本主链适配新交互并全绿回归。

## 关键交互验证（真实浏览器）

- 未生成口播时点「确认文案」→ 引导提示出现，不静默不跳转；
- 「去生成口播」→ 弹窗打开 → 生成（自动确认正文）→ 音频出现 → 确认 → 弹窗关闭，入口行“口播已确认”；
- 再点「确认文案」→ 正常进入分镜规划；
- 深链门禁（未确认口播回文案 `reason=narration_required`）与 legacy 项目并存不受影响。

## 边界说明

- 候选切换（最新生成候选/已确认音频）未纳入本次弹窗 UI，属可后续补齐项。
- 设计文档 3.4 中“保留切换能力”表述以本记录为准：本轮未实现，不在主路径阻塞。
