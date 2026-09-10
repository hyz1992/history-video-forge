# AGENTS.md

本文件面向 Claude Code、Codex、GLM-5、Opus 等通用 coding agent。

适用项目：`history-video-forge`

---

## 当前状态入口

`AGENTS.md` 只保留稳定的 agent 工作契约、验证规则、提交规范、prompt 规则和高风险边界；不维护易过期的项目阶段事实。

项目阶段、当前主流程、待补事项和已过时计划说明，以以下文档和当前代码/运行结果为准：

1. `docs/README.md`
2. `docs/plans/README.md`
3. `docs/todos/roadmap-todo.md`

若本文件与上述状态文档或当前运行结果冲突，以状态文档、正式架构文档和实际代码/接口/浏览器验证结果为准。

---

## 推荐阅读顺序

1. `docs/requirements/product-requirements.md`
2. `docs/README.md`
3. `docs/architecture/pipeline-io-spec.md`
4. `docs/architecture/downstream-stage-high-level-design.md`
5. `docs/architecture/topic-stage-design.md`
6. `docs/architecture/script-stage-design.md`
7. `docs/architecture/script-validation-spec.md`
8. `docs/data/field-design.md`
9. `docs/data/schema-design.md`
10. `docs/architecture/api-design.md`
11. `harness/README.md`
12. `docs/records/2026-05-01-follow-up-backlog.md`
13. `docs/records/2026-05-09-video-pipeline-engineering-notes.md`（asset planning / assets / compose 阶段设计前必读；记录口播音频、字幕、分镜图/视频的工程约束与已知问题清单）
14. `docs/records/2026-09-10-narration-task12c-acceptance-matrix.md`（口播前置/真实时间轴的验收现状与 A1–A10 逐项证据；设计真相源为 `docs/plans/2026-09-05-narration-first-timing-design.md`；2026-09-10 起新建项目一律走口播前置，发布开关与演示模式已移除）
15. `docs/plans/README.md`

说明：

- `docs/plans/archive/` 中的文件是历史设计与实施证据，不是当前任务入口。
- `docs/records/` 中的文件分两类：
  - 历史运行、质量检查与恢复记录（不作为当前设计真相源）
  - 工程经验参考文档（如 `video-pipeline-engineering-notes.md`，是 downstream 阶段设计的输入约束，进入相关阶段设计前应主动阅读）
- 若历史计划与 `AGENTS.md`、`docs/README.md`、`docs/architecture/` 或 `harness/README.md` 冲突，以当前入口文档和正式架构文档为准。

---

## Agent 工作契约

- 本项目默认直接在 `dev` 分支的主工作区修改和提交。
- 未经用户明确同意，不得自动创建或切换功能分支、Git worktree；通用工作流或 skill 对 worktree 的推荐不覆盖本项目规则。
- 如果任务确实无法安全地直接在 `dev` 上执行，必须先说明具体冲突或隔离理由并取得用户同意，不能自行改用 worktree。
- 一次只执行一个低耦合子任务。
- 先读相关文档，再读相关代码，再动手。
- 必须限制改动文件范围。
- 输出必须结构化，不能只给口头描述。
- 先分析、再执行、再验证、再自审。
- 优先做小步、可验证、可提交的演进，不做大爆炸重写。
- 涉及重要质量优化时，先写 design + implementation plan，再进入实现。
- 所有新的正式设计文档和实施计划必须使用中文；历史英文计划可以保留，但新建或重写时必须改为中文。
- 对 prompt、validator、reviewer、writer 的改动必须拆成低耦合任务逐步验证。

---

## 结构化输出要求

每次开始执行前，先输出：

- `任务`
- `目标`
- `本次改动文件`
- `不改什么`
- `验证方式`

每次结束时，输出：

- `实际改动`
- `验证结果`
- `自审结论`
- `剩余风险`
- `下一步建议`

---

## 审查与验收规则

- 审查整改或验收修复时，必须先从用户原始请求中提取验收清单，不得只沿用提交说明、执行者总结或 PR 描述作为审查范围。
- 验收清单必须逐项标注 `已修`、`部分修`、`未修` 或 `未验证`，并说明证据来源（代码位置、测试命令、浏览器实测或接口输出）。
- 若提交只修了清单中的一部分，只能声明“该部分通过”，不得把局部通过表述为整体通过。
- 对用户明确点名的 UI/交互问题，必须回到真实页面或等价浏览器验证；只读 diff 不能替代体验验收。
- 如果浏览器、服务或测试环境无法验证某项，必须把该项标为 `未验证`，不能默认为通过。
- 审查结论必须区分“实现者声称已修”的范围和“用户原始要求”的范围；两者不一致时，以用户原始要求为准。

---

## 阶段闸门规则

- 上一个任务的最小验证未通过，不得进入下一个任务。
- 如果回改 shared schema / API / prompt 规则，必须回跑相关最小验证。
- `topic` 合同未冻结，不得进入 `script` 生成。
- `script` 本地硬校验未通过，不得宣称首稿链路完成。
- semantic reviewer 当前只作为 shadow-only 量尺；不得把 reviewer 输出升级成自动门禁或主链路动作。
- runtime harness 是核心验证层；应按受影响阶段选择最小验证、显式 live check、浏览器验收或成品验收入口。
- 真实 live check 不作为默认自动化门；需要显式运行并记录输出。
- 涉及 `storage/topic-candidate-library/` 写入的测试要优先串行运行，避免并行写同一生成态 JSON。

---

## Prompt 规则

- 所有正式 LLM prompt **必须使用中文**。
- 所有正式 prompt **必须存放在** `prompts/`。
- prompt 的元数据必须显式声明 `language: zh-CN`。
- 不允许把正式 prompt 散落在业务代码、临时 notes 或多个重复文档中。
- 设计或调整 prompt 约束时，必须优先避免 prompt 冗余；新增约束前要先确认不会与现有约束打架、重复表达或相互抵消。
- script writer prompt 的目标不是写结构摘要，而是生成可口播的历史故事首稿；必须关注开头留存、场景密度、叙事推进、动作/对话、口播节奏与结尾余震。
- prompt 质量约束要短而明确，不允许靠堆叠重复口号制造“爆款感”。
- Prompt Registry 的正式规范位于 `harness/docs/prompt-registry-spec.md`。

---

## Script 首稿质量原则

当前 script 阶段的质量分层：

- `可用线`：不跑题，覆盖 `must_include_beats`，本地校验 pass，无模板污染，semantic reviewer shadow 不出现严重偏离。
- `爆款首稿线`：在可用线之上，具备能留人的 opening、可视化强场面、动作/对话/压力升级、适合口播的节奏、能留下判断或代价的结尾。
- `发布线`：不属于当前自动生成首稿目标，需要事实核查、人工审稿、镜头/画面匹配和最终口播打磨。

判断 script 质量时，不允许只机械看结构字段是否完整；必须从整体口播效果评估：

- 开头是否把观众拖进危险、羞辱、选择、杀机或反常识局面。
- 核心冲突是否具体到人、动作、场景和压力源。
- 每个 beat 是否推动局面升级，而不是只被点名。
- 是否有对话、转述、动作、反应或可视化细节。
- 结尾是否有余震，而不是空泛说“改变历史”“展现智慧”。

本地 validator 只能做结构性质量下限，例如体量明显过短、句子数不足、时长与正文体量严重不匹配；不得用本地字符串规则判断“是否爆款”。

---

## 提交规范

- 所有 git 提交信息**必须使用中文**。
- 每次完成一个可验证任务后，必须及时使用中文提交；除非用户明确要求暂不提交或当前任务只是只读分析。
- 每次提交只解决一个清晰问题。
- 如果包含文档、schema、API 或脚本，优先保证它们表达同一套约束。

---

## 禁止事项

- 不新增阶段去重写当前稳定链路。
- 不恢复多稿竞赛、多头审校、无限重试。
- 不让 prompt 漫游到业务代码里。
- 不在本地后处理中抢做只有 LLM 才能完成的语义判断；本地逻辑只允许做结构、缓存、去重、排序、疲劳惩罚、合同与运行时编排相关工作。
- 不允许用字符串匹配、关键词黑名单或类似糊弄方式冒充正式语义校验。
- 不允许把 semantic reviewer 的 `patch_once/lift` 直接接入主链路。
- 不允许为了迎合 reviewer 单次反馈而牺牲整体稿件质量。
- 不允许继续用跨题材固定模板句污染 `TopicPackage` 或 script 正文。
- 不在未定阶段顺手发明 downstream 对象。
- 不在没有验证的情况下声称完成。

---

## 高风险边界与本地注意事项

- `Topic Package` 是 script 阶段唯一正式上游。
- `Topic Delivery Pack` 只能微调交付方式，不能改 narrative 合同。
- `narrative_tension_map` 属于 `Topic Package`，不是 delivery 层。
- `viral_rubric / narrative_tension_map / patch_intent=lift` 已进入正式设计，不得在实现时随意改语义。
- `patch_intent=lift` 当前只用于 reviewer shadow 量尺和后续设计参考，不是自动 patch 动作。
- `storage/topic-candidate-library/` 当前可能是未跟踪生成态数据；除非任务明确要求，不要 stage 或提交它。
- 在当前 Node/Vite 组合下，后端/harness Vitest 建议使用 `npx vitest run --configLoader runner ...`；涉及 topic runtime 写库的多文件测试建议加 `--no-file-parallelism`。
