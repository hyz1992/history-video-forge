# Topic + Script 第四阶段收口记录

## Task 8 / Step 1：全量自动化验证

- 运行时间：2026-04-21
- 命令：`npm test`
- 结果：通过
- 汇总：`36` 个测试文件、`103` 个测试全部通过

- 运行时间：2026-04-21
- 命令：`npm run harness:topic-script-live-check`
- 结果：通过
- 汇总：`total_samples=2`、`passed_samples=2`、`failed_samples=0`

## Task 8 / Step 2：正式手动联调

- 运行时间：2026-04-21
- 联调链路：
  - 首页
  - 我的项目
  - 新建项目
  - 连续生成多轮候选
  - 从历史轮确认主题
  - 自动进入 script 并开始生成
  - 执行一次 `regen_once`
  - 返回 topic 重选并再次确认
  - 再次自动进入 script
  - 检查项目级 trace 与可读目录

### Step 2 初次联调暴露的阻塞

1. live run 下 `patch_once / regen_once` 入口不可达
2. 从 script 返回 topic 后，第二次确认主题没有重新自动进入 script
3. snapshot 虽然返回了可读目录路径，但真实磁盘目录与项目级 trace 未落盘

## Task 8 / Step 3：最小修补结果

本轮只修补阻碍第四阶段收口的最小问题：

1. Topic 页面新增基于 `confirmedTopicPackageId` 的回跳逻辑
   - 二次确认主题后，即使项目状态字段没有再次变化，也会重新跳入 `/projects/:projectId/script`
   - Script 页面会重新触发首轮 generate

2. Script 工作区新增显式手动 `regen_once`
   - `regen_once` 入口不再依赖语义审校先给出 `regen_once`
   - 手动点击后会执行一次真实 regenerate，并继续遵守单次机会约束

3. 项目级 trace 与可读目录真实落盘
   - topic/script 最新 run trace 摘要挂到项目级 snapshot
   - `storage/projects/<date>/<中文名 + 短稳定标识>/trace/topic-runs/*`
   - `storage/projects/<date>/<中文名 + 短稳定标识>/trace/script-runs/*`
   - 每个 run 目录写入 `graph-trace-summary.json` 和 `runtime-diagnostics.json`

## Task 8 / Step 4：最终复验

- 运行时间：2026-04-21
- 命令：`npm test`
- 结果：通过
- 汇总：`36` 个测试文件、`107` 个测试全部通过

- 运行时间：2026-04-21
- 命令：`npm run harness:topic-script-live-check`
- 结果：通过
- 汇总：`total_samples=2`、`passed_samples=2`、`failed_samples=0`

- 运行时间：2026-04-21
- 手动联调结果：通过
- 手动联调项目：`264e0ef7-fc0d-4a48-ac5f-157033e3a9eb`
- 手动联调确认项：
  - 首页、项目列表、新建项目流程可用
  - topic 多轮候选与历史轮确认可用
  - 首轮 script 自动生成可用
  - 手动 `regen_once` 可执行
  - 返回 topic 后再次确认主题可重新自动进入 script
  - 项目级 trace 摘要与可读目录真实落盘

## 第四阶段结论

- 第四阶段的项目驱动 `topic + script` 工作区已完成收口验证
- 自动化测试、live check、正式手动联调三条验证链路均已通过
- 当前正式范围内已经具备：
  - 首页 / 我的项目 / 项目工作区三层客户端结构
  - 项目级 topic/script 主链路闭环
  - topic 多轮候选历史与任意轮确认
  - confirm 后自动 script generate
  - script 状态机、历史归档、重选题闭环
  - 项目级 / run 级 / step 级 trace
  - 中文可读目录与一次性目录迁移

- 当前不进入：
  - `storyboard`
  - `assets`
  - `compose`
