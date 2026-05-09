# AGENTS.md

本文件面向 Claude Code、Codex、GLM-5、Opus 等通用 coding agent。

适用项目：`D:\myproject\story-video-forge2`

---

## 当前阶段目标

- 当前项目处于 `greenfield-first` 模式。
- `topic + script` 第一阶段已达到当前及格标准，可以暂时冻结。
- 当前优先事项：
  - 保持 `topic -> script` 首稿链路稳定，不主动重开已冻结范围
  - 在开启视频流水线下一步前，先补必要的文档治理与阶段边界说明
  - 下一步视频流水线只能先进入设计与 implementation plan，不得顺手实现未设计的 downstream 详细阶段

当前已完成的关键恢复：

- fake semantic review 已收掉；无真实 reviewer 时允许 `skipped`，不得冒充语义审校。
- `TopicPackage` 模板污染已收掉，不再向 script 注入跨题材固定句。
- script 首稿链路、local validation、semantic reviewer shadow、扩展 smoke 已恢复稳定。
- 当前 `topic` 自动推荐与 `script` 首稿已达到“可用线”，可以作为视频流水线下一步的上游基础。
- 第 3 项 follow-up backlog（项目内持久化候选池与受控 fallback 复用）主体已完成；剩余为后续运营生命周期尾项。

---

## 当前可实施边界

当前允许进入实现的范围：

- 文档治理、阶段冻结说明、旧计划归档
- 视频流水线下一步的设计文档与 implementation plan
- `topic + script` 冻结后的必要维护、回归修复、观测记录
- 明确获得执行指令后的低风险 harness 验证补强

当前**不允许**顺手实现的范围：

- `storyboard`
- `asset planning`
- `assets`
- `compose`
- 任何未正式设计并通过 implementation plan 收口的 downstream 结构
- patch integration 主路径，除非先完成单独设计计划并获得明确执行指令
- 为了下一阶段方便而回改已冻结的 topic/script prompt、schema 或 API，除非问题被明确定位为阻塞或回归

---

## 推荐阅读顺序

1. `D:/myproject/story-video-forge2/docs/requirements/product-requirements.md`
2. `D:/myproject/story-video-forge2/docs/README.md`
3. `D:/myproject/story-video-forge2/docs/architecture/pipeline-io-spec.md`
4. `D:/myproject/story-video-forge2/docs/architecture/downstream-stage-high-level-design.md`
5. `D:/myproject/story-video-forge2/docs/architecture/topic-stage-design.md`
6. `D:/myproject/story-video-forge2/docs/architecture/script-stage-design.md`
7. `D:/myproject/story-video-forge2/docs/architecture/script-validation-spec.md`
8. `D:/myproject/story-video-forge2/docs/data/field-design.md`
9. `D:/myproject/story-video-forge2/docs/data/schema-design.md`
10. `D:/myproject/story-video-forge2/docs/architecture/api-design.md`
11. `D:/myproject/story-video-forge2/harness/README.md`
12. `D:/myproject/story-video-forge2/docs/records/2026-05-01-follow-up-backlog.md`
13. `D:/myproject/story-video-forge2/docs/records/2026-05-09-video-pipeline-engineering-notes.md`（asset planning / assets / compose 阶段设计前必读；记录口播音频、字幕、分镜图/视频的工程约束与已知问题清单）
14. `D:/myproject/story-video-forge2/docs/plans/README.md`

说明：

- `docs/plans/archive/` 中的文件是历史设计与实施证据，不是当前任务入口。
- `docs/records/` 中的文件分两类：
  - 历史运行、质量检查与恢复记录（不作为当前设计真相源）
  - 工程经验参考文档（如 `video-pipeline-engineering-notes.md`，是 downstream 阶段设计的输入约束，进入相关阶段设计前应主动阅读）
- 若历史计划与 `AGENTS.md`、`docs/README.md`、`docs/architecture/` 或 `harness/README.md` 冲突，以当前入口文档和正式架构文档为准。

---

## Agent 工作契约

- 一次只执行一个低耦合子任务。
- 先读相关文档，再读相关代码，再动手。
- 必须限制改动文件范围。
- 输出必须结构化，不能只给口头描述。
- 先分析、再执行、再验证、再自审。
- 优先做小步、可验证、可提交的演进，不做大爆炸重写。
- 涉及重要质量优化时，先写 design + implementation plan，再进入实现。
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

---

## 阶段闸门规则

- 上一个任务的最小验证未通过，不得进入下一个任务。
- 如果回改 shared schema / API / prompt 规则，必须回跑相关最小验证。
- `topic` 合同未冻结，不得进入 `script` 生成。
- `script` 本地硬校验未通过，不得宣称首稿链路完成。
- semantic reviewer 当前只作为 shadow-only 量尺；不得把 reviewer 输出升级成自动门禁或主链路动作。
- runtime harness 是当前阶段的 P0 保障；在 `topic + script` 第一阶段，必须尽早建立并持续可运行。
- 真实 live check 不作为默认自动化门；需要显式运行并记录输出。
- 涉及 `storage/topic-candidate-library/` 写入的测试要优先串行运行，避免并行写同一生成态 JSON。

---

## Prompt 规则

- 所有正式 LLM prompt **必须使用中文**。
- 所有正式 prompt **必须存放在** `D:/myproject/story-video-forge2/harness/prompts/`。
- prompt 的元数据必须显式声明 `language: zh-CN`。
- 不允许把正式 prompt 散落在业务代码、临时 notes 或多个重复文档中。
- 设计或调整 prompt 约束时，必须优先避免 prompt 冗余；新增约束前要先确认不会与现有约束打架、重复表达或相互抵消。
- script writer prompt 的目标不是写结构摘要，而是生成可口播的历史故事首稿；必须关注开头留存、场景密度、叙事推进、动作/对话、口播节奏与结尾余震。
- prompt 质量约束要短而明确，不允许靠堆叠重复口号制造“爆款感”。
- Prompt Registry 的正式规范位于 `D:/myproject/story-video-forge2/harness/docs/prompt-registry-spec.md`。

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

## 当前特别注意

- `Topic Package` 是 script 阶段唯一正式上游。
- `Topic Delivery Pack` 只能微调交付方式，不能改 narrative 合同。
- `narrative_tension_map` 属于 `Topic Package`，不是 delivery 层。
- `viral_rubric / narrative_tension_map / patch_intent=lift` 已进入正式设计，不得在实现时随意改语义。
- `patch_intent=lift` 当前只用于 reviewer shadow 量尺和后续设计参考，不是自动 patch 动作。
- `storage/topic-candidate-library/` 当前可能是未跟踪生成态数据；除非任务明确要求，不要 stage 或提交它。
- 在当前 Node/Vite 组合下，后端/harness Vitest 建议使用 `npx vitest run --configLoader runner ...`；涉及 topic runtime 写库的多文件测试建议加 `--no-file-parallelism`。
