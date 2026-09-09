# Task11C 创建不兼容时的项目级选择与原地恢复 审查记录

日期：2026-09-09。任务入口：`docs/plans/2026-09-05-narration-first-timing-implementation-plan.md` 任务 11C（323-333 行）与 2026-09-09 实施补记段。

## 结论

Task11C 已收敛。候选 f27a6c3a 经第4次两阶段终审通过：0 Critical / 0 Important，9 项验收全部"已修"（其中"ensureProject 复用 ID"与"in-flight 宿主强制关闭"两项为代码级验证、测试级缺口留档）。用户终审闸门保留；三入口真实浏览器验收按计划归 Task12。

## 事实

| 事实 | 值 |
|---|---|
| 审查级别 | T2（创建编排状态机、跨入口交互、费用边界的前端合同层） |
| 固定 TASK_BASE_SHA | 21f241d5（Task11B 收敛点） |
| 通过候选 | f27a6c3ad26e6333d1108db78c261a29cd599411 |
| 提交序列 | 8853ffab（主体）→ 12fb0904（整改1）→ e761e340（整改2）→ 535b832e（整改3）→ dfc21006（补记）→ d4509609（终审1整改）→ cd379528（计数回写）→ 1dce1525（终审2整改）→ fc3a9409（终审3整改）→ f27a6c3a（终审4整改） |
| 累计任务范围 | 12 文件（11 产品/测试 + 计划补记段），另有本机械记录 |
| 整改复审轮数 | 3（上限内用满） |
| 额外授权轮次 | 4（d4509609 / 1dce1525 / fc3a9409 / f27a6c3a），每次用户单独"同意授权" |
| 已执行 final 次数 | 4（每次两阶段；前三次各有 Important 判未通过，第四次通过） |

## 审查过程

| 阶段 | diff C/I/M | contract C/I/M | 结果 |
|---|---|---|---|
| 初始审查（8853ffab） | 0/2/3（等待期可切Tab重入、可关闭弹窗复活僵尸流程） | 0/2/6（关闭不终止待续、三入口测试不完整） | 整改1 |
| 第1轮（12fb0904） | 0/1/2（事件库等待期目标漂移） | 0/1/5（in-flight 关闭窗口挂起） | 整改2 |
| 第2轮（e761e340） | 1/0/4（飞行期跨入口重入未守卫） | 0/0/5 | 整改3 |
| 第3轮（535b832e） | 0/0/3 | 0/0/6 | 候选 dfc21006 |
| 终审1 | — | — | 0/1/0（重试在途取消后成功仍续发）→ 授权整改 d4509609 |
| 第4轮（d4509609） | 0/1/1（重试在途窗口 onCancelled 陈旧） | 0/0/4 | 授权整改 1dce1525 |
| 终审2 | — | — | 0/1/0（两入口集成用例缺失+补记表述过强）→ 授权整改 fc3a9409 |
| 第5轮（fc3a9409） | 0/0/2 | 0/0/3 | 双角色判 F-1 闭合、收敛 |
| 终审3 | — | — | 0/2/0（F1 面板层叠遮挡、F2 卸载无兜底）→ 授权整改 f27a6c3a |
| 第6轮（f27a6c3a） | 0/0/2 | 0/0/3 | 双角色判 F1/F2 闭合、收敛 |
| 终审4 | — | — | 0/0/0，9/9 已修，通过 |

各轮均按 R1 以固定 BASE 起累计 diff 全审；终审均两阶段（阶段一去叙事化、阶段二证据核对），每次终审判失败的候选按协议重开收敛后再次终审。

## 验收（终审标注）

| 项目 | 状态 | 证据 |
|---|---|---|
| 三入口保留输入+selection 重试+组件级测试 | 已修 | 提交时快照（事件 ID/角度/rawDigest/筛选）；三入口集成用例（事件库/自定义为真实子组件未 stub） |
| 取消/关闭/卸载零创建不续发（含在途窗口） | 已修 | cancelledDuringFlight 双路径消费；watch+onBeforeUnmount 双兜底；5 组在途/卸载用例；ensureProject 复用与 in-flight 强制关闭为代码级验证（留档） |
| 职责边界（composable 协调/回调 prop/不吞错/store 不引组件） | 已修 | composable 零组件引用；子组件仅静默 Cancelled、兼容错误冒泡 |
| 422/409/双击单重试/等待可操作+层叠 | 已修（代码级） | 409 续等、双击、z-index 1200>1100；浏览器命中归 Task12 |
| 开关关闭解释+防重入防关闭 | 已修 | 中文 reason、不建 legacy、重入守卫、Tab/关闭禁用 |
| 项目设置按模式禁用 | 已修 | tts 槽禁用+试听双保险+文案引导；非 narration 零变化 |
| 复用 2B DTO | 已修 | NarrationSelection 复用 shared；options 全部来自后端错误体 |
| 测试回跑+构建+新增测试文件 | 已修 | 32/32、143/143、build exit 0 |
| 边界（开关/默认/资格/fixture/不侵12） | 已修 | env 零触碰、全 fixture、Task12 文件零差异 |

## 验证

| 报告（harness/scripts/runtime/output/） | 实测 |
|---|---|
| narration-task11c-red.json | composable 缺失收集失败（红灯） |
| narration-task11c-targeted.json | 17/17 |
| narration-task11c-round2-targeted.json | 23/23 |
| narration-task11c-round3-targeted.json | 24/24 |
| narration-task11c-round4-targeted.json | 27/27 |
| narration-task11c-round5-targeted.json | 28/28 |
| narration-task11c-round7-targeted.json | 32/32 |
| narration-task11c-regression.json | 13 文件 143/143（含计划点名弹窗/设置/候选套件与 Task11A/B 前端全套） |

其余检查：vite build exit 0；backend tsc exit 0；project.ts 单文件严格 tsc 1 错误=基线 1（历史遗留，新增代码零新增）；git diff --check 干净。复审双方各自独立复跑过前端全量 37 文件 310 用例全绿。

## 留档 Minor（不阻塞、未改候选）

ProjectGenerationSettings 快照读取→props 接线无集成测试；新测试文件 6 处 strict-tsc 类型错误（无前端类型门）；在途取消后非 narration 错误到达时返回原始错误而非 Cancelled（无实际危害）；NarrationSelectionOption 与 shared NarrationQualifiedOption 字段重复；音色选择卡未禁（后端保存兜底）；tts 槽禁用视觉态不完整；409 后 optionIndex 依赖 v-if 重挂载复位；空闲 unmount 置标记由下轮入口重置；测试注入警告噪声。

## 停止与授权边界

前 3 轮在协议上限内完成。终审1/2/3 各发现 Important（重试在途取消续发、两入口集成用例缺失、层叠遮挡与卸载兜底），每次按"仍有 Critical/Important 即停"停止并向用户报告，用户四次"同意授权"分别限定第 4/5/6/7 轮整改（处方：取消分流、集成用例、层叠与卸载兜底）并要求复审后重开终审。第4次终审 0 Critical / 0 Important 通过，停止条款未再触发。发布开关保持 false；未进入 Task12。三入口真实浏览器验收（含事件库 422 层叠命中、宿主强制关闭真实路径）、真实后端 422/409 报文联调均属 Task12 声明边界。
