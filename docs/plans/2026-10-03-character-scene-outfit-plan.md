# 入镜角色场景服饰补全实施计划

目标：让主角当前衣着进入分镜提示正文，以一次规划加一张图验证收益，完成后收口。

设计：[场景服饰补全](./2026-10-03-character-scene-outfit-design.md)。直接在 `dev` 执行一个低耦合任务，不新建分支或 worktree。

## 文件范围

- 修改 `prompts/asset-planning/segment-intent-planner.prompt.md` 及同名 `.changes.md`。
- 修改既有 `tests/backend/asset-planning/character-identity-prompt-contract.test.ts`。
- 本设计、计划、实测记录及 `docs/plans/README.md`、原整改验收记录的最新状态指针。
- `storage/acceptance-20261003/scene-outfit-*` 仅为不提交的隔离验收材料。

## 步骤

- [x] 先增加“每个入镜角色／主角衣着、遗漏时来源”的合同断言，单文件验证预期失败。
- [x] 扩展一处现有职责规则，分段 prompt 升 v1.6.0，更新变更记录。
- [x] 运行 identity、generation、compiler、harness character-sheet 四文件最小回归及 `npm run harness:check-prompts`。
- [x] 新 chunk_002 一次真实调用，冻结 global 与其余回放输入；maxAttempts 1、maxTokens 16384、单请求系统＋输入不超过 50000 字节、无结构修复调用。保存实际 request、usage、输出与 compiler 检查。
- [x] 人工审读文本；通过后复制隔离 QA 计划与 manifest，只替换 sb_004 原始 compiler 提示，保留 P1/P2、登基及其他素材／时间轴。
- [x] 内置浏览器生成一次 sb_004；核对 P1 实际注入 SHA、单任务账本／终态、完整图与浏览器预览、历史记录保护。
- [x] 逐项报告已修／部分修／未修／未验证，更新原 50 元累计账，自审并中文提交。文本或图失败则本批停止，不开启下一轮。

## 最小回归命令

`npx vitest run --configLoader runner --no-file-parallelism tests/backend/asset-planning/character-identity-prompt-contract.test.ts tests/backend/asset-planning/asset-planning-generation.test.ts tests/backend/asset-planning/asset-plan-intent-compiler.test.ts tests/harness/assets-character-sheet-smoke.test.ts`

## 实际结果

一次 chunk_002 与一张内置浏览器实图完成；主角换甲胄且面貌延续通过，宫门仍开，整镜部分通过。本批结束，累计估算 6.128911 元，剩余 43.871089 元，见[验收记录](../records/2026-10-03-character-scene-outfit-acceptance.md)。
