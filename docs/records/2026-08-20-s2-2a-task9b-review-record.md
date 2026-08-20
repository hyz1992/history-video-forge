# S2-2A 任务 9B 审查记录（2026-08-20）

本文件记录任务 9B（接入 LLM 调用并记录 token 费用）的 T2 独立审查循环全过程与终审结论。数字均从实际运行输出重填（R6）。

## 审查对象与基准

- TASK_BASE_SHA：`de35539`（9A 终审后 HEAD）。
- 终审 HEAD：`10d853a`（6 个产品提交：f17b6b9 实现 / 4442205 轮1整改 / 74498bc R2整改 / 24f6ad9 闸门迁移 / 98f4620 终审 I-1/I-2 整改 / 10d853a 终审 I-3 整改；另 d8bbff1 纯注释修正）。
- 累计 diff：`git diff de35539..10d853a`（22 文件，+1879/-564）；未提交改动仅 `.claude/settings.local.json`（用户文件）。

## 编排与轮次总表

| 轮次 | 对象 SHA | 编排 | 结论 |
|---|---|---|---|
| 初始审查（0 轮） | f17b6b9 | diff + contract 并行 | 双审共识：diff I-1（4 条辅助入口漏闸门）、I-2（测试覆盖缺口）；contract I-1（interactionId 反查不成立）、I-2（5 条未接闸门入口，含 assets prompt-optimizer）；Minor 若干 |
| 轮 1 | 4442205 | diff + contract 复审 | I-1/I-2 整改闭环（regen 接提交协议、四辅助入口 409、interactionRunId 对齐、11 端点闸门测试）；diff 复审提出 R2-I-1（from-library 漏网）、R2-I-2（upgrade-video 漏网）、R2-I-3（regen interactionRunId 二次 generateId） |
| 轮 2 | 74498bc | diff 收敛确认；contract 判不收敛 | diff：R2 三项闭环、全入口扫描无漏网、**收敛**；contract：R1-I-1 未闭环（publish 闸门误放 publishUpdateController、cover 端点漏封） |
| 轮 3 | 24f6ad9 | contract 收敛确认 | 闸门迁移修复闭环（cover 端点补闸门、publishUpdateController 移除误加）；双审全部收敛 |
| final（两阶段+复检） | …10d853a | 阶段一独立 finding + 阶段二证据核对 + I-3 复检 | **通过**：验收 1-5 与 9A 补充合同延展全部已修；I-1（LLM overrun 语义）/I-2（正链路测试+范围决策）/I-3（LLM overrun 不禁用目录）闭环；4 Minor 留档 |

## 终审结论（SHA `de35539..10d853a`）

- **最终结论：通过。**
- 验收判定（final 逐项，附证据）：验收 1（真实 LLM operation 持 quote/snapshot/run；同 interaction/attempt 单条 usage；interactionId 可反查——模块 runId 前缀与日志目录锚点一致 + markdown 渲染 interaction_id 行）已修；验收 2（provider token 优先；缺失 null actual + estimate 不伪造）已修；验收 3（五主入口接受三字段复用 GenerationRunService；stub 免 quote 路径保留）已修；验收 4（中文提交/diff --check/不动 3 基线失败/live 不作门禁）已修；验收 5（任务边界：不动 9A 媒体语义、无前端越界）已修；9A 补充合同延展（12 个 LLM 触发入口全部封口：5 主入口提交协议 + 7 辅助入口 409）已修。
- final Important 闭环：I-1（LLM 记账纳入 overrun 语义——checkAndHandleOverrun 拆公共，媒体/LLM 共用累计口径）；I-2（补 topic.generate 正链路测试；storyboard/asset-plan/publish 三入口正链路经裁决接受留待浏览器验收阶段覆盖，须含付费部署路径）；I-3（LLM overrun 只留事件不禁用目录——授权是单次调用 budget，run 内多 interaction 累计超界属常规数量累计；媒体路径价格异常禁用语义保持）。
- Minor 留档（4 条）：M-1 topic 提交路径状态机无 generating/pending 过渡（仅显示影响）；M-2 isPaidLlmDispatchPossible 无引擎级兜底（与 9A M-7 同族，生产启动保证目录/provider 同源）；M-3 from-library 409 无自动化测试（Prisma 环境前置）；M-4 billing writer 计数器依赖单实例约定。
- 已知缺口登记：storyboard/asset-plan/publish 三入口 quote 正链路（浏览器验收阶段覆盖，须付费部署路径）；publish/cover/generate 直连 DashScope 媒体无闸门（9A 遗留，独立后续任务）；Prisma 态 LLM 记账端到端无测试；全量并行 flake 波动（单跑全过，非本 diff 引入）。

## 验证证据（R6：从实际运行输出重填，终审态 10d853a）

- 9B 测试：`npx vitest run --configLoader runner tests/backend/cost/llm-paid-generation-gate.test.ts` → 9 用例通过（闸门 11 端点、script 正链路、无 token、幂等、retry、tier 一致性、LLM overrun、topic 正链路、五入口 409）。
- 步骤 3 批次：llm-paid-generation-gate + usage-cost-recording + topic-api-runtime + script-generate-runtime + storyboard-api + asset-planning-api + publish-api → 7 文件 82 用例通过（final 复跑）。
- 9A 回归：assets-api + paid-generation-gate + usage-cost-recording + assets-run-service → 通过。
- 全量 tests/backend → 217 文件 / **2026 用例，2023 通过、3 失败**；3 失败单独复跑确认为基线预存在失败（remotion-local-quality-smoke、remotion-subtitle-still-smoke、upload-and-file-serve），与任务 8/9A 记录同一集合，diff 未触碰相关文件。
- `npx tsc -p backend/tsconfig.json --noEmit` 通过；`npm run build:backend` 通过；`git diff --check de35539..HEAD` 干净；提交信息全部中文（6+1 条）。

## 交付物状态

- 6 个产品提交在 dev 分支：提交协议公共化（submit-protocol）、五主入口提交协议 + 七辅助入口付费封口、五个 dispatch handler、token 记账（recordLlmUsage + billing writer + interactionId 反查）、LLM overrun 语义（媒体禁用/LLM 留痕分叉）、topic/publish 生成主体抽取共用 service。
- 后续建议：(a) storyboard/asset-plan/publish 三入口付费正链路随浏览器验收覆盖；(b) publish/cover/generate 媒体闸门独立任务收口；(c) M-8 设计文档 8.2 回写（随本记录落盘）；(d) 3 个基线 harness 失败仍为独立高优先级任务；(e) 真实付费 LLM live 核对属后续显式授权范围。
