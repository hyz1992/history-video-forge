# 分镜候选切点修复实施计划

> 执行方式：superpowers:subagent-driven-development；当前 `dev` 主工作区串行任务，禁止分支/worktree。用户已批准最小修复及一次有界分镜；每项红绿验证、规格审查、质量审查、中文提交。不重复申请执行许可。

**目标**：修正候选句末与停顿判定，保留原生合法边界和旧投影。

**架构**：在现有粗筛内按标点范围选最靠后的合法边界，并由左右 token 求真实 gap；不改原生图或下游合同。

**技术**：TypeScript、现有 NarrationTimingMapV1、Vitest/runtime harness、一次受限 Flash 调用。

设计：[候选切点修复设计](./2026-10-05-storyboard-boundary-filter-fix-design.md)。

## 任务 0：设计与计划

- [x] 复核原始问题、代码、native token/schema 及旧错误测试；写本设计与计划。
- [x] 独立文档审查通过，补齐 UTF-16/连续标点测试与双层派发保护，随本计划中文提交。

## 任务 1：候选筛选修复（一个原子低耦合子任务）

修改：`backend/src/modules/storyboard/storyboard-timing-projector.ts`、`tests/backend/storyboard/storyboard-narration-timing.test.ts`、`docs/plans/2026-09-12-storyboard-coarse-candidates-design.md`。不改其他业务文件或正式 prompt。

- [ ] 在既有粗切点测试添加真实最小附着标点/长发声样例，修正旧400ms测试；补独立/前后附着标点、内部无合法点与零点/共享span边界保护，避免重复镜像测试。
- [ ] 执行 `npx vitest run --configLoader runner --no-file-parallelism tests/backend/storyboard/storyboard-narration-timing.test.ts`，确认新行为测试按预期失败，保存红灯证据。
- [ ] 实施最小代码：tokens ID Map；标点/空白连续范围与已有有序 boundaries 单向游标扫描，选每个含句末字符范围内最靠后的合法点；主循环首尾、句末Set或左右 gap ≥400 保留；不足三项回退与编号原样保持。
- [ ] 同步旧候选设计中正式算法说明，注明日期及本设计取代的两项具体判定。
- [ ] 最小三文件回归：`npx vitest run --configLoader runner --no-file-parallelism tests/backend/storyboard/storyboard-narration-timing.test.ts tests/backend/storyboard/storyboard-narration-prompt.test.ts tests/backend/storyboard/storyboard-generation.test.ts`。
- [ ] 按直接依赖选择 narration 相关合同测试与 `npm run typecheck:backend`（先检查 package.json 的实际命令），确认旧投影不变；不要顺手修已知全仓陈旧断言。
- [ ] 独立规格审查、再质量审查，根代理读diff并复核结果，中文提交。

## 任务 2：零费用原口播复核与单次 live

正式文档：新增 `docs/records/2026-10-05-storyboard-boundary-filter-acceptance.md`；更新本计划及 `docs/plans/README.md`。实验目录 `storage/storyboard-boundary-acceptance-20261005/` 不提交。

- [ ] 从原 timing 确定性生成新候选，原图哈希不变；记录旧68候选到新集合的对照、原始三个错误例子的去留、原文/口播与旧成片保护哈希。
- [ ] 新输入由正式 `buildStoryboardPlannerPromptInput` 生成；剔除新旧候选表后的规范序列化必须一致。三份prompt版本/hash原样。
- [ ] 编写单次运行保护：maxAttempts=1/max_tokens=8192、历史记录防重派、before-fetch预留、gateway第二次invoke拒绝和fetch第二网络调用拒绝、零数据库写；预检上界 ≤0.50，累计 ≤50，超出停止。
- [ ] 仅一次正式 `generateStoryboardPlan`；完整日志、正式投影及逐段根代理/独立人工语义审阅，失败不重试，不生成媒体。
- [ ] 回填费用、保护哈希与逐项已修/部分修/未修/未验证，区分候选缺陷修复与整体视觉效果。
- [ ] 最终独立审查、链接检查、中文提交验收记录；依仓库约定归档本批设计与计划，向用户给结果及下一步建议。

## 限制

当前未跟踪 storage/.zcode/q-tmp.mjs 与已修改 `.claude/settings.local.json` 均保留，不 stage。本批只验证一次分镜；原50元预算余额不代表可无限派发，0.50元上限及单次限制同时适用。
