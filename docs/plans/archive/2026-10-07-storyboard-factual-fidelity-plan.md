# 分镜事实忠实边界实施计划

> 本有限批已停止并归档，不作为续跑清单。见[验收记录](../../records/2026-10-07-storyboard-factual-fidelity-acceptance.md)：正式合同与91项回归通过，自动稿仍未整体通过，零费用人工候选文字通过，视频未验收。

> 执行方式：superpowers:subagent-driven-development；每个原子任务用fresh implementer，规格后质量审查，根代理复跑及中文提交。遵从项目直接dev规则；用户当前“按建议继续”批准此方向，不重复请求同一许可。

**目标**：收紧现有planner事实表达合同，保持普通视觉还原自由，再验证一次真实分镜。

**架构**：只细化一份正式中文prompt的两个已有位置，输入、schema、候选、正式投影及生产编排保持；语义验收继续人工。

**技术**：Prompt Registry、既有Vitest与fake runtime harness、一次有界Flash调用。

设计：[事实边界设计](./2026-10-07-storyboard-factual-fidelity-design.md)。

## 任务0：只读证据、设计与计划

- [x] 核对当前入口、AGENTS、正式边界、前批实际工件；四文件91项基线退出0，原有settings改动保留。
- [x] 对照负例距离误解/流沙险情与正例风沙/饮水/行囊，不新增本地语义判断。
- [x] 独立文档审查并提交本设计、计划、docs/plans/README.md当前入口。

## 任务1：一份planner合同原子修改

仅三文件：`prompts/storyboard/storyboard-planner.prompt.md`、`prompts/storyboard/storyboard-planner.changes.md`、`tests/backend/storyboard/storyboard-narration-prompt.test.ts`。

- [x] 在原“两份正式prompt中文元数据和v2边界说明同步”用例扩展简短通用合同断言：事实关系原意、过程/剩余条件、推想/目标与已见事实区分、普通环境/器物/身体服装许可、新增危险/关键行动/结局限制、视觉字段与risk_notes相容；版本预期v1.8.0。不要写题材特例、关键词语义黑名单或fixture输出分类器。
- [x] `npx vitest run --configLoader runner --no-file-parallelism tests/backend/storyboard/storyboard-narration-prompt.test.ts`：实际1失败/14通过，首先缺新事实关系断言，不是仅版本失败。
- [x] 最小修改planner：顶部正文来源条目细化事实关系；质量区首条细化普通还原自由及边界、相容性，保留当前事件/顺序原约束。正式中文metadata升v1.8.0，其他合同保持；措辞只写prompts。
- [x] changes记录2026-10-07的通用事实边界、正例自由与独立真实验收需求，链接设计；无业务代码或其他prompt变更。
- [x] 目标绿灯15/15；三个storyboard回归88/88；fake runtime smoke3/3及guard保持；治理与diff退出0。
- [x] 顺序独立规格/质量审查通过；根代理读diff并复跑四文件91项及治理，通过后仅stage三文件，提交`c6dfa3ca`。

## 任务2：原输入一次live与收口

新记录：`docs/records/2026-10-07-storyboard-factual-fidelity-acceptance.md`；实验目录不提交。

- [x] 零费用prepare：builder输入与上批a251...相同，11,395字节；24候选/276范围、完整map/ref、旧6段实验投影一致；17份保护SHA及三份prompt冻结。
- [x] 核对官方价、请求模型与端点；0.50新增/总50/8192预检，预留0.11186元；一gateway/一HTTP/排他lock，无DB或后续阶段。
- [x] 正式generateStoryboardPlan一次，完整返回11段，保存request/interaction/echo/result/usage；不重试、不修改原项目。
- [x] 零网络结构/来源/全文/预算复核通过；独立逐段文字审阅：自动稿Important1/Minor1，未整体通过。另附五字段人工修订候选，结构与独立11镜文字通过，原自动稿保留；没有新LLM、自动patch或激活。
- [x] 中文验收记录回填原用户要求；新增保守估算0.036706元，累计含预留48.0031235元；文字与媒体未验区分，有限批停止。
- [x] 最终独立事实/链接审查通过；唯一入口措辞Minor对照旧JSON修正。归档设计/计划并更新入口，12本地链接全存在，diff检查通过；本收口文档与中文提交一并交付，报告费用及下一步建议。

## 执行边界

保留`.claude/settings.local.json`、`.zcode/`、`q-tmp.mjs`及其他既有杂项；生成态和topic library不stage。上一批有限验收已结束，不运行旧live或把旧计划作为续跑清单。没有业务代码/schema/UI改动，无需前端build/typecheck或新增自动语义门禁；若范围改变须重新定义任务与最小验证。
