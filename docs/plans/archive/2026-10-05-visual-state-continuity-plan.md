# 分镜语义对应与视觉状态连续性实施计划

> 执行方式：使用 superpowers:subagent-driven-development，在当前 `dev` 主工作区按任务串行实施；不创建分支或 worktree。每个任务先合同验证、再实现、最小回归、独立规格及质量审查、中文提交。用户已批准方案和最多 2 元实测，不重复请求实施确认。

目标：让当前口播事件、状态变化及可见证据在既有分镜和资产规划链中保持一致。

架构：只改三处正式 prompt；冻结全局状态通过既有 `art_bible.consistency_notes` 传给分段意图。来源/时间/路由/身份字段职责和 shadow-only 边界不变。

技术：中文 Prompt Registry、Vitest、现有 TypeScript runtime 与 provider、内置浏览器素材预览。

设计：[视觉状态连续性设计](./2026-10-05-visual-state-continuity-design.md)。

归档结果：T1–T3 规则合同完成，218 项回归与治理通过；T4 一次真实分镜结构通过、语义未过，执行停止条件，无后续媒体。新增估算 0.126762 元，累计含历史预留 47.8204155 元。见[验收记录](../../records/2026-10-05-visual-state-continuity-acceptance.md)。本批已停止，不复跑派发，不据此宣称整体视觉问题解决。

## 任务 0：设计与计划

- [x] 从用户原始视觉批评与已批准建议提取范围、质量清单及预算。
- [x] 完成独立设计/计划审查，补齐实验 provider 上下文、实际参考图注入、v2 实际时长计价及原音轨听审；中文提交文档。

## 任务 1：当前口播事件与分镜对应

文件：`prompts/storyboard/storyboard-planner.prompt.md`、同名 `.changes.md`、`tests/backend/storyboard/storyboard-narration-prompt.test.ts`。

- [x] 在既有合同测试中先增加当前事件、结果首次出现和合法语义边界的断言，确认预期失败；断言只证明规则存在，不宣称语义通过。
- [x] 在既有质量边界补短规则，版本升 v1.6.0，记录变更，不扩展候选或时间逻辑。
- [x] 运行 `npx vitest run --configLoader runner --no-file-parallelism tests/backend/storyboard/storyboard-narration-prompt.test.ts tests/backend/storyboard/storyboard-narration-timing.test.ts tests/backend/storyboard/storyboard-generation.test.ts`，71 项通过。
- [x] 运行 `npm run harness:check-prompts`，独立规格与质量审查后中文提交 `e41a2d4d`。

## 任务 2：全局状态安排

文件：`prompts/asset-planning/asset-planner.prompt.md`、同名 `.changes.md`、`tests/backend/asset-planning/character-identity-prompt-contract.test.ts`。

- [x] 增加顶层 consistency_notes 的分镜绑定、状态延续、普通器物及推断边界合同断言，确认预期失败。
- [x] 补充全局职责，版本升 v1.7.0；不把动态状态放入身份或全片统一前缀，不更改 JSON 骨架。
- [x] 运行 identity 合同、asset-planning-generation、asset-plan-intent-compiler 及 harness assets-character-sheet-smoke 四文件回归 135 项通过，prompt 治理通过。
- [x] 独立规格与质量审查后中文提交 `c2f3c06e`。

## 任务 3：分段消费与可见证据

文件：`prompts/asset-planning/segment-intent-planner.prompt.md`、同名 `.changes.md`、上述 character-identity-prompt-contract 测试。

- [x] 增加按当前 ID 消费全局状态、入画证据和同镜视频延续合同断言，确认预期失败。
- [x] 以短规则扩展现有职责，版本升 v1.7.0；保留主角衣着、动作定格、多人职责、路线与五类字段白名单。
- [x] 回跑上述四文件以及分段 prompt input 测试 147 项通过，确认顶层美术说明已通过现有通路传递；无需镜像实现的额外测试。
- [x] prompt 治理、独立规格与质量审查后中文提交 `0f917069`。

## 任务 4：最多 2 元有限真实验证与收口

文件：新增 `docs/records/2026-10-05-visual-state-continuity-acceptance.md`；更新本计划及 `docs/plans/README.md`。运行证据放 `storage/visual-state-acceptance-20261005/`，不提交生成态文件。

- [x] 以旧合格文案和原真实口播构造实验输入，记录三份新 prompt 版本/hash与旧来源；检查旧项目、口播和费用基线。
- [x] 有限 runtime 入口只写实验目录，每次派发前记录费用预留；maxAttempts=1，禁止二次网络调用和结构重生，不生成新口播。唯一分镜预留 0.457278 元。
- [x] 一次新分镜，正式投影通过，逐段根代理及独立人工语义评审未通过；已执行停止后续实测条件。
- [x] 全局设定及三个单段意图因上游未过而取消、未派发；此项实际效果未验证。
- [x] 三张关键图因上游未过而取消、未派发；参考图 payload 与内置浏览器实图质量未验证。
- [x] H3 及原音轨/静音路径检查因上游未过而取消、未派发；只读范围检查发现最短 5,440ms，也不满足本批 ≤5 秒条件。未调用 prepare 或修改口播范围。
- [x] 将用户验收清单逐项标记已修/部分修/未修/未验证；记录新增及总累计费用、未核验账单边界，禁止以局部成功宣称全片通过。
- [x] 完成最终独立审查、自审并随本记录中文提交；展示验收文字记录。没有生成的阶段已明确取消原因，不额外返工。修正归档后的 prompt changelog 设计链接。

## 既有失败与保护

`tests/backend/runtime/prompt-runtime.test.ts` 有已登记的陈旧 writer 及 storyboard 断言，不在本轮顺手修复整文件。受影响的新版合同使用上述专属测试，旧失败需如实记录。所有 stage 仅限本任务文件；用户已有 `.claude/settings.local.json` 及 storage 数据不进入提交。
