# 分镜原文区间展示与输入精简实施计划

状态：原子实现及单次有限live已结束，设计/计划归档；[验收记录](../../records/2026-10-06-storyboard-readable-input-acceptance.md)为结果入口。文本范围改善，新增距离误解及流沙险情未修，停止本批，不重试或生成媒体。

> 执行方式：superpowers:subagent-driven-development；当前 dev 主工作区串行实施，禁止分支/worktree。用户已批准上一轮建议，按本设计落实，不重复申请同一许可。每个原子任务红绿验证、规格审查、质量审查、中文提交。

**目标**：让模型直接读取合法候选间的当前原文，精简不参与选择的 native 明细，验证事件对应及费用。

**架构**：完整时间图校验后投影为 LLM 白名单视图；候选 text_to_next 是既有 source slice，模型输出合同及正式投影保持。

**技术**：TypeScript、现有 narration 合同、Prompt Registry、Vitest/runtime harness、一次有界 Flash 调用。

设计：[输入展示设计](./2026-10-06-storyboard-readable-input-design.md)。

## 任务 0：证据、设计及审查

- [x] 读当前入口、正式文档、原候选与上一批真实结果，测量旧 177,916 字节输入；当前 84 项 storyboard 基线通过。
- [x] 独立审查本设计和计划，补缺漏，中文提交。

## 任务 1：原子输入展示合同

仅五文件：`backend/src/modules/storyboard/storyboard-generation.service.ts`、`tests/backend/storyboard/storyboard-narration-prompt.test.ts`、`prompts/storyboard/storyboard-planner.prompt.md`、`prompts/storyboard/storyboard-planner.changes.md`、`docs/plans/2026-09-12-storyboard-coarse-candidates-design.md`。只一个 planner prompt，不改 validator/reviewer/writer/schema/投影。

- [x] 先添加行为测试：精确三字段 timingMap；每行保持四值及 text_to_next；完整连接与子范围连接；重复句/代理对/共享数字来源；原图不变；长稿展示字节显著少于旧结构。多候选范围至少含非首起点，直接对照 projectStoryboardTiming 派生摘录。复用既有 legacy/stub/regen/来源/投影测试，不堆实现镜像。
- [x] 跑 `npx vitest run --configLoader runner --no-file-parallelism tests/backend/storyboard/storyboard-narration-prompt.test.ts`，确认缺白名单/原文区间/prompt 说明的预期红灯。
- [x] 在原 IIFE 中先 verify，再计算既有候选，映射第五字段 `text_to_next: sourceText.slice(current.source_offset,next.source_offset)`，末项 `""`；构造 `{sourceText,durationMs,boundary_candidates}` 白名单。候选四字段函数不改，不 mutate 原图。
- [x] stub 从同一已知展示候选表读 entries，不强转完整图或回落不存在的 boundaries；必要移除该文件不再使用的类型 import，不重构其他路径。
- [x] planner 升 v1.7.0，替换 native 明细已给出的陈述，解释 text_to_next 和含起点/不含终点；既有事件/合法候选/字段/来源/trace/枚举/重生规则保留。同步 changes 和旧算法文档的展示合同。
- [x] 三文件最小回归：`npx vitest run --configLoader runner --no-file-parallelism tests/backend/storyboard/storyboard-narration-prompt.test.ts tests/backend/storyboard/storyboard-narration-timing.test.ts tests/backend/storyboard/storyboard-generation.test.ts`。
- [x] `tests/harness/narration-first-runtime-smoke.test.ts` 仅 fake 运行（原 guard 必须有效，不移除真实凭据拒绝）；`npm run typecheck:backend`；`npm run harness:check-prompts`；`git diff --check`。
- [x] 独立规格审查，再质量审查；根代理读实际 diff 并复跑，中文原子提交，确保五文件同一合同。

## 任务 2：零费用复核与一次 live

正式记录 `docs/records/2026-10-06-storyboard-readable-input-acceptance.md`，更新本计划与 `docs/plans/README.md`，实验目录不提交。

- [x] 正式构建新输入：去掉 timingMap 后其余部分与上一批规范序列化完全一致；候选四值一致，text_to_next 按原 offset 精确可重建，完整/子范围等于原文；原 timing hash 与旧实验投影不变。测量新旧实际 UTF-8 字节，记录版本/新 hash。
- [x] 冻结原保护文件加上一批协议/input/result/budget 的 SHA，核验模型及当前官方价。0.50 元/总50元/输出8192的预检、一次 gateway/一次 fetch、防重派及派发前失败预留同时满足。
- [x] 一次正式 generateStoryboardPlan，完整请求/interaction/result/usage 留档；失败不重试，无项目/DB激活、global/segment/TTS/image/H3。
- [x] 正式结构、来源、真实时间轴与全文覆盖，根代理/独立审查逐段语义；成本按真实 usage 保守复算，不将压缩率或结构通过冒作视觉通过。
- [x] 回填用户原始负载/光鲜/困顿/摆拍/音轨等逐项已修/部分修/未修/未验证；新增有限验收记录。
- [x] 最终独立事实审查、相关链接与 diff 检查、中文提交；归档本批设计/计划，向用户给结果及下一步建议。

## 执行边界

现有 `.claude/settings.local.json`、`.zcode/`、`q-tmp.mjs` 及所有其他生成态杂项保留，不 stage。本批不恢复全量候选、语义关键词门禁、多稿/无限重试或新增阶段。既有全仓陈旧断言只记录，不顺手扩范围。
