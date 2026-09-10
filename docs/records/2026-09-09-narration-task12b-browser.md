# Task12-B 口播前置浏览器验收记录（进行中）

日期：2026-09-09。任务入口：实施计划任务 12 checklist 第 3 条（浏览器验收）的 11A/11B/11C 相关子集。

## 状态：进行中（部分通过，主链后段被环境问题阻塞）

脚本：`harness/scripts/ui-acceptance/narration-browser-acceptance.ts`（Playwright + 真实 Edge/Chromium + 临时 SQLite + Prisma 激活态 + 真实路由 + synthetic 口播 provider + fake 媒体 + stub LLM，零真实供应商调用）。

## 已通过（真实浏览器，Edge）

| 步骤 | 结果 |
|---|---|
| 登录 → 首页 → 打开新建项目弹窗 | PASS |
| 系统推荐入口：提交后 422 资格拒绝 → 原地选择面板出现 | PASS |
| 选择合格组合 → 确认 → 带 narration_selection 重试成功 → 进入项目 topic 页 | PASS |
| 单项目创建（无重复创建） | PASS（projects=1） |
| legacy 项目经普通创建成功且分镜页不被口播门禁拦截 | PASS |

## 被阻塞（本轮未完成）

- 事件库/自定义入口的 422→面板→确认→重试链（面板挂载逻辑同系统入口，组件级已覆盖；浏览器层因下述环境问题未跑到）
- NarrationPanel 确认正文→生成口播→确认口播的浏览器主链（需先经 topic 确认+script 生成，见阻塞）
- 事件库 422 选择面板层叠命中（Task11C F1 的 z-index 修复需真实浏览器命中验证）

## 阻塞与环境问题（诚实记录）

1. **项目快照 GET 500「Cannot open database because the directory does not exist」**：进入 topic/script 页后，前端拉项目快照时后端 better-sqlite3 打开失败（Prisma better-sqlite3 adapter 连接层）。验收后端 DATABASE_URL 指向临时目录（存在），此前创建/登录请求均正常；该错误在快照类 GET 上出现，属验收环境装配问题（疑似 backend 内某处仍按 cwd/storage 相对路径打开 sqlite），非 11A/11B/11C 代码缺陷。
2. **topic 页候选不自动出现**：系统入口成功后 generateSystemRecommendations 已触发，但整页跳转后 TopicPanel 不显示 confirm-candidate（与快照 500 同源疑似）。候选缺失时脚本尝试点「生成选题」按钮，该按钮在当前页面状态下 count=0。
3. 事件库入口层叠修复（z-index 1200>1100）为代码级+堆叠上下文推理闭合，真实命中验证待上两项解除后执行。

## 补充调试（同日）

- 用 vitest 诊断测试复现：Prisma 模式下 catalog 表对 capability 有唯一约束，WS 口播目录行无法与 HTTP tts 行同时 active —— 生产 bootstrap（无 dashscope 凭据）会将 WS 行禁用，创建带 selection 时后端按合同 422（fail-closed，属设计行为）。浏览器验收环境需显式回种 WS 行为 active 才能走通重试；已回种后首次 422 面板正常，重试仍 422「组合未通过资格」，根因疑为 WS 音色档案在隔离库中的 owner 可见性/状态不满足 compat 过滤。该调试需继续（下一轮）。

## 处置

- Task11C 候选 f27a6c3a 的层叠修复（代码级）维持已修判定；浏览器命中验证标注为未验证，归 Task12 后续。
- Task12-A 冒烟（narration-first-runtime-smoke）不受影响，已收敛。
- 需要后续单独授权一轮「浏览器验收环境调试」：定位快照 GET 500 的 sqlite 打开路径（嫌疑：backend 内残留 cwd 相对 sqlite 打开点，或 acceptance 进程 VITEST=1 与 server.ts 装配交互），补事件库/自定义入口的完整浏览器链。

## 未验证边界（延续）

真实供应商音质/时间精度/成片；历史字幕预设浏览器专项；导出专项。
