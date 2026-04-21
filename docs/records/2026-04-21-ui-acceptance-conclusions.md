# UI Acceptance 收口记录

## Task 6 / Step 1：文档入口收口

- 在 `harness/README.md` 中新增 UI acceptance 入口说明：
  - `harness:ui-acceptance:smoke`
  - `harness:ui-acceptance:full`
  - `harness:ui-acceptance:report`
- 明确 UI acceptance 输出目录、关键产物，以及当前已知失败项需要如实记录，而不是伪装为全绿。

## Task 6 / Step 2：最终验证

- 运行时间：2026-04-21
- 命令：`npm test`
- 结果：通过
- 汇总：`41` 个测试文件、`129` 个测试全部通过

- 运行时间：2026-04-21
- 命令：`npm run harness:ui-acceptance:smoke`
- 命令结果：执行成功
- run id：`2026-04-21T15-16-01-710Z-smoke`
- 项目：`7919711e-d5b9-4b4e-872c-9080811815f0`
- 最终路由：`/projects/7919711e-d5b9-4b4e-872c-9080811815f0/script`
- 验收结论：`FAIL`
- 汇总：`pass=26`、`warn=0`、`fail=1`
- 失败项：
  - `topic-history-section`

- 运行时间：2026-04-21
- 命令：`npm run harness:ui-acceptance:full`
- 命令结果：执行成功
- run id：`2026-04-21T15-16-47-974Z-full`
- 项目：`2b79849e-9375-4e16-ab23-33b601418bec`
- 最终路由：`/projects/2b79849e-9375-4e16-ab23-33b601418bec/script`
- 验收结论：`FAIL`
- 汇总：`pass=40`、`warn=0`、`fail=2`
- 失败项：
  - `topic-history-section`
  - `topic-history-section`

- 运行时间：2026-04-21
- 命令：`npm run harness:ui-acceptance:report`
- 结果：通过
- 摘要输出：
  - 最新 run：`2026-04-21T15-16-47-974Z-full`
  - `Mode=full`
  - `Status=FAIL`
  - 已对重复失败项做去重展示

## 当前机制结论

- 仓库内正式 UI acceptance 入口已完成：
  - `smoke`
  - `full`
  - `report`
- 前后端服务能够由验收器自动启动与回收。
- Chromium 桌面端真实链路可自动执行并生成：
  - `summary.json`
  - 关键页面截图
  - `trace.zip`
  - `console-summary.json`
  - `network-summary.json`
- 页面结构规则与最小可交付规则已接入正式 summary。
- `report` 已能读取最近一次结果并输出可读摘要。

## 当前未收口项

- 当前 UI acceptance 机制**已完成**，但当前页面结果**未全部达标**。
- 最新 `smoke` 与 `full` 的共同阻塞是：
  - `topic-history-section`
- 该失败项说明当前 topic 页面在真实首轮/重返 topic 场景下，没有稳定展示“候选历史区”这一正式结构要求。
- 本轮按约束不重做业务页面，只让验收器证明问题并把问题写入正式记录。

## 收口判断

- 从“机制是否落地”看：已完成。
- 从“当前页面是否通过验收”看：未通过。
- 因此本轮收口结论是：
  - UI acceptance 机制完成接入
  - 当前页面验收结果仍有已知 FAIL，需要后续页面修补任务处理
