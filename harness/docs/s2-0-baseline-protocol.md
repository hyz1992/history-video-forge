# S2-0 基线盲评与验收记录

> 本协议用于 S2-0b 优化前后的人工内容质量对比。
> 评分者不应看到模型名称、thinking 状态或策略参数。

## 盲评规则

1. current（当前配置）和 candidate（候选策略）输出随机编号 A/B。
2. 评分者只看到编号标签和完整输出。
3. 不得通过输出长度、用词偏好或结构细节推断模型身份。
4. topic 与 script 使用各自独立 rubric。
5. semantic reviewer 结果只作为 shadow 附件，不参与评分。
6. JSON 通过率不等于内容通过。

## Topic 验收 rubric

对每个 topic 候选逐一评估：

- 角度是否闭环（有 stakes、有选择、有后果）
- 核心冲突和 stakes 是否具体（不是抽象"外交智慧"）
- must-include beats 是否有叙事推进价值（不是枚举标签）
- 是否出现跨题材模板污染
- 是否出现事实边界风险

每项评：**优于基线 / 不劣于基线 / 存在差异 / 退化**

## Script 验收 rubric

从整体口播效果评估：

- opening 是否立即建立危险、羞辱、选择、杀机或反常识局面
- 场景密度和 beat 推进是否充足（不是分段摘要）
- 动作、对话、反应和压力升级是否具体
- 是否适合自然口播（句子长短、节奏、转折）
- ending 是否有判断、代价和余震（不是空泛说"改变历史"）
- 是否覆盖上游 Topic Package 且无模板污染

每项评：**优于基线 / 不劣于基线 / 存在差异 / 退化**

## Semantic reviewer 附件规则

- reviewer 结果只作为 shadow 量尺
- 评分者可以先看输出再对照 reviewer shadow 判断
- reviewer shadow 不能作为取舍依据（不使用 reviewer 自动门禁）

## 原始输出管理

- 原始模型输出写入 `harness/scripts/runtime/output/llm-s2-baseline/<timestamp>/`
- 不得将原始输出提交到 Git
- 脱敏样本（manifest）允许提交，但不能包含真实用户数据或 API key

## 结论声明

- 任何核心样本明显退化时必须回退对应 operation policy
- 不得为了速度强行通过质量验收
- 不从小样本（3 份）声称稳定 P95
- 不把 semantic reviewer 变成自动验收门

## 2026-07-15 Task 11 固定样本结论（后续真实页面发现覆盖缺口）

### 运行边界

- 报告：`harness/scripts/runtime/output/llm-s2-baseline/2026-07-15T224114/baseline-report.json`（raw output 只保存在忽略目录，不提交）。
- 用户明确授权后执行；沿用人民币 10 元人工上限、仓库脱敏 manifest，不执行 capability probe。
- 请求矩阵：current 3 次、candidate 3 次，共 6 次；全部 attempt 1 成功，未 retry、repair 或 full regeneration。
- TTFT 仍为 `unobservable_non_streaming`；runner 仍为 `cost_enforcement=unavailable`，不能声称程序已核验实际人民币费用。

### 延迟与结构结果

| profile / operation | model | effective strategy | duration | reasoning tokens | 结构结果 |
| --- | --- | --- | ---: | ---: | --- |
| current topic.selector | glm-4 | tool call / auto / provider default thinking | 3.997 秒 | unavailable | Zod 首次通过 |
| current script.writer | glm-5.1 | JSON mode / thinking disabled | 14.624 秒 | 0 | Zod + validator 首次通过 |
| current storyboard.planner | glm-5.1 | JSON mode / thinking disabled | 29.128 秒 | 0 | Zod + validator 首次通过 |
| candidate topic.selector | glm-5.2 | target function / provider default thinking | 24.275 秒 | 549 | Zod 首次通过 |
| candidate script.writer | glm-5.2 | JSON mode / thinking disabled | 15.490 秒 | 0 | Zod + validator 首次通过 |
| candidate storyboard.planner | glm-5.2 | JSON mode / thinking disabled | 33.057 秒 | 0 | Zod + validator 首次通过 |

- 优化后 current 三项合计 47.749 秒；相对优化前同样本 135.231 秒下降 64.7%。
- 优化后 candidate 三项合计 72.822 秒；相对 provider-default thinking 的旧候选同样本 353.833 秒下降 79.4%。
- 不能从这些固定单样本数字推断稳定 P95。

### Topic harness 限制

Task 11 harness 的 topic 样本直连 strict gateway，不经过 `invokeTopicSelector()` 生产 service；本轮未显式传 `candidateThinking`，所以 candidate topic 实际记录为 `thinking=provider_default`，不能把 24.275 秒解释成生产 service 的 `target_function + thinking=disabled` 最终耗时。

生产 service 已由代码与非 live 测试确认显式发送 `thinking=disabled` 和 `toolChoice=target_function`；此前独立授权的同输入候选诊断曾验证该组合可用。本限制必须保留在记录中，后续不得用本轮 topic 数字伪装精确生产耗时。

### 按盲评 rubric 完成的人工质量对照

- topic：GLM-5.2 对经典题材疲劳、切口新鲜度、场景数量与结尾余震的判断更具体，结论为优于当前输出。
- script：GLM-5.2 三轮压力、动作、对话和结尾收束完整，整体不劣；存在 `opening_span` 与正文首句重复的轻微合同偏差，保留为后续样本观察项，不用本地关键词规则自动门禁。
- storyboard：GLM-5.2 生成 8 个连续段落，画面层次和攻守转换比 current 的 7 段更细，结论为不劣且局部更优。
- semantic reviewer 仍保持 shadow-only，没有升级为自动门禁。

### 决策

- 批准 GLM-5.2 作为当前 main 与 structured 配置模型；升级与回退只修改环境配置，不在业务 service 中硬编码模型名。
- 保留 `script.writer`、`storyboard.planner` 的精确 `thinking=disabled` operation policy。
- 保留 topic strict 的 `thinking=disabled + target_function` 生产策略和受控 structured fallback。
- 任一后续真实题材出现明显语义退化时，只回退对应 operation policy 或模型配置，不回退观测能力和 timeout 不原样重试规则。

### 真实页面纠偏

Task 11 之后的真实页面项目 `84ed173e-529b-4a19-bc6d-092257432b3e` 证明，完整 topic 链路还包含未被固定样本覆盖的 `topic.candidate-builder`：该 operation 使用 GLM-5.2、provider-default thinking，attempt 1 即耗时 159.954 秒并产生 4741 reasoning tokens；随后生产 selector 另耗时 33.939 秒，完整等待约 193.893 秒。

因此本节只证明原固定样本中 script、storyboard 和 selector 的局部结论，不再作为“S2-0 整体完成”的证据。S2-0 必须在 builder 精确策略、8 候选质量对照和真实页面端到端验收通过后才能重新收口。

## 2026-07-15 Task 13 真实页面对照（未通过整体闸门）

### 运行边界与证据

- 用户授权模型 GLM-5.2、同一“魏晋至唐宋·高张力历史事件推荐”输入、最多 2 次请求与人民币 10 元人工上限；不执行 capability probe。
- 真实浏览器项目：`e478735a-6b92-4483-8923-e5e2a48e9b4d`；topic run：`topic_run_169338b0-1bce-44f8-9204-8c6c96b78e3e`。
- raw output 与 interaction log 只保存在 `storage/projects/` 忽略目录，不提交。
- 首次 builder 在 49.386 秒后返回供应商 `1301` 内容过滤；topic service 自动追加 `safety_retry_context` 并完整重生成一次，之后再调用 selector。因此实际 provider 请求为 3 次，超出授权的 2 次上限；发现后停止，没有继续请求。代码已有同一 provider 实例共享的 `RequestBudget`，但本次 backend 沿用默认 20，没有显式应用授权值 2；后续 live 必须以显式预算启动。
- 当前日志不能自动核验人民币费用，首次 400 响应也没有 usage；不得声称程序已证明费用低于上限。

### 延迟、usage 与结构结果

| 环节 | 优化前真实页面 | Task 13 | 对照结论 |
| --- | ---: | ---: | --- |
| builder 首次失败 | 无 | 49.386 秒，1301 content filter | 新增一次 service-level 完整重生成 |
| builder 成功调用 | 159.954 秒，reasoning 4741 | 84.484 秒，reasoning 0 | 成功调用耗时下降 47.2%，thinking override 生效 |
| builder 完整阶段 | 159.954 秒 | 133.915 秒 | 被内容过滤重生成抵消大部分收益 |
| selector | 33.939 秒 | 28.449 秒，reasoning 0 | 单样本下降 16.2% |
| provider 总等待 | 193.893 秒 | 162.319 秒 | 单样本下降 16.3%，仍约 2 分 42 秒 |

- builder 成功调用 usage：`prompt_tokens=2623`、`completion_tokens=3988`、`reasoning_tokens=0`；selector：`prompt_tokens=5301`、`completion_tokens=1524`、`reasoning_tokens=0`。
- 第一个可用 builder 响应直接通过结构和业务检查并交付 8 个候选，selector 交付最终 4 个；没有本地 repair。
- 1301 safety retry 是修改输入后的第二次完整 builder generation，必须计为 full regeneration；不能因为两份 interaction log 的 attempt 都是 1 就记成“一次请求”。
- 浏览器在开始后 174.730 秒的下一次观察中已展示结果；精确 provider 结束点约为 162.450 秒。TTFT 仍为非流式不可观测。

### 人工质量对照

- 改善：候选包含南霁云睢阳求援、石勒擒王衍、庆历党议等相对少见事件，题材多样性与新鲜度优于旧样本中较集中的高频事件池；8 个候选均在魏晋至唐宋范围，冲突、场景与三段推进完整。
- 明确缺陷：标题“李世民玄武门射杀建成元吉”把元吉之死归到李世民，正文却写尉迟敬德追斩元吉；标题“石勒夜营焚杀王衍”写“焚杀”，正文却写推倒营墙压死。标题与正文的行为主体/死因自相矛盾，属于语义质量问题，不是 JSON/Zod 能发现的结构问题。
- 结论：局部新鲜度有提升，但存在两处明确内部一致性缺陷，不能判定“不劣于基线”。本结论来自人工整体阅读，不使用关键词、字符串规则或本地启发式作为语义门禁。
- semantic reviewer 保持 shadow-only，没有接入主链路或自动门禁。

### 阶段结论

- Task 13 已完成一次真实页面诊断，但“质量不劣且等待显著改善”的整体闸门未通过，S2-0 继续保持打开。
- 暂不回退 `topic.candidate-builder` 的 thinking override：成功调用的 0 reasoning 与 47.2% 耗时下降已证明该精确策略有价值；当前新增主因是 1301 后的 service-level 完整重生成。下一窄任务应前置首次安全表达、显式应用既有请求预算并补充 selector 语义一致性保护，再决定是否保留或回退该 override。
- 不从此单样本推断 P95，不进入 S2-1，不在本记录中修改 prompt/schema 或候选数量。

## 2026-07-16 Task 14 非 live 实施记录（等待真实页面复验）

### 实施边界

- `topic.candidate-builder` 正式中文 prompt 前置供应商安全表达：保留具体人物、对抗力量、关键动作、明确赌注和故事余震，同时避免展开血腥、尸体、酷刑、肢体伤害或猎奇处决细节。
- 1301 内容过滤后的受控重试仍只允许一次，但 service 只追加 `reason=provider_content_filter` 与 `mode=strict_neutral_historical_planning`，不再在业务代码散落英文自然语言正式指令。
- `topic.selector` 使用现有 `source_or_scope_risk` 对标题、切口、冲突、场景和 beats 的行为主体、关键动作、因果与结果矛盾做语义扣分；不得改写候选，不新增 schema 或本地字符串语义门禁。
- 8 个原始候选、4 个展示候选、模型、thinking、timeout、provider retry、API 与 semantic reviewer shadow-only 边界均未改变；builder 输出瘦身不在本任务范围。

### 非 live 证据

- builder TDD 红灯分别证明首次 prompt 缺少安全表达边界、retry context 缺少结构化 mode 且仍带英文 instruction；最小实现后的 prompt/API focused 回归为 55/55 通过。
- selector TDD 红灯证明缺少跨字段一致性合同；最小 prompt 修改后的 prompt/topic focused 回归为 99/99 通过。
- 普通 structured 与 strict 路径共享同一 `RequestBudget` 的 provider 特征测试首次即通过；provider/env focused 回归为 37/37 通过。真实页面的请求上限必须在启动 backend 前用 `LLM_REQUEST_BUDGET_MAX_REQUESTS` 显式设置，harness 的 `--max-requests` 不能约束另一个后端进程。
- 完整非 live 矩阵按当前真实路径覆盖 15 个文件、255 项测试，255/255 通过；backend typecheck 通过。验证未调用网络 provider。

### 当前结论与下一闸门

- Task 14 的代码、prompt、测试与验收入口已完成非 live 实施，但没有真实数据证明首次 1301 已消失、等待时间已进一步下降或候选内部一致性已改善。
- S2-0 继续保持打开，不从非 live 结果声明性能优化成功，也不进入 S2-1。
- 下一次真实页面对照必须独立授权模型、样本、最大请求数、人民币费用上限和 raw output 保存边界；启动 backend 时显式应用同一最大请求数。对照至少记录 builder 首次是否通过、builder/selector/端到端耗时、request 数、reasoning usage、结构通过情况和人工整体质量判断。

## 2026-07-16 Task 14 真实页面复验（延迟部分改善，质量闸门未通过）

### 运行边界与证据

- 用户同意沿用上一轮真实验收边界：模型 GLM-5.2、同一“魏晋至唐宋·高张力历史事件推荐”输入、最多 2 次 provider 请求、人民币 10 元人工费用上限、hyz 账号测试项目、raw output 允许保存但不提交；未执行 capability probe。
- 启动 backend 前显式设置 `LLM_REQUEST_BUDGET_MAX_REQUESTS=2`；主模型与 structured 模型均为 GLM-5.2。
- 真实页面项目：`f1cf8009-325d-4acd-86ff-31cbf8c3b504`；topic run：`topic_run_55815d60-5ea7-4ef8-900f-b6d456d89d63`。
- raw output 与 interaction log 只保存在 `storage/projects/` 忽略目录，不提交。日志共 2 个 interaction，证明本轮只发生 builder 与 selector 两次 provider 请求。
- 当前日志仍不能按人民币价格机器核验费用；不得把请求次数和 token usage 换算成已经程序验证的实际人民币费用。

### 延迟、请求与 usage

| 环节 | Task 13 | Task 14 | 对照结论 |
| --- | ---: | ---: | --- |
| builder 首次失败 | 49.386 秒，1301 | 无 | 单样本首次安全表达未触发内容过滤 |
| builder 成功调用 | 84.484 秒 | 105.288 秒 | 变慢 24.6%，两轮均 reasoning 0 |
| builder 完整阶段 | 133.915 秒 | 105.288 秒 | 因消除一次 full regeneration，下降 21.4% |
| selector | 28.449 秒 | 34.414 秒 | 变慢 21.0%，reasoning 0 |
| provider 总等待 | 162.319 秒 | 139.702 秒 | 下降 13.9%，但仍约 2 分 20 秒 |
| provider 请求数 | 3 | 2 | 下降 33.3%，两次均 attempt 1 成功 |

- builder：`prompt_tokens=2704`、`completion_tokens=4595`、`reasoning_tokens=0`、`finish_reason=stop`；selector：`prompt_tokens=5932`、`completion_tokens=1677`、`reasoning_tokens=0`、`finish_reason=tool_calls`。
- 两个 operation 合计 14908 tokens，相对 Task 13 的 13436 tokens 增长 11.0%；其中 builder completion 由 3988 增至 4595，是成功 builder 变慢的直接可观测线索之一，但单样本不能证明唯一因果。
- 从页面提交到 selector interaction 完成约 139.829 秒；浏览器按间隔观察，在 161.061 秒时首次确认页面已展示结果，因此不能把 161.061 秒当成精确后端耗时。TTFT 仍为非流式不可观测。
- builder 首次结构与业务检查通过并交付 8 个候选，selector strict tool call 交付 4 个展示候选；没有 provider retry、本地 repair 或业务层 full regeneration。

### 人工质量对照

- 改善：Task 13 中“李世民射杀建成元吉”的明确主体错误没有复现；本轮玄武门候选标题只写李世民亲手射杀长兄，正文则明确李世民射杀建成、尉迟敬德射杀元吉，内部关系一致。
- 改善：8 个候选均在魏晋至唐宋范围，事件、冲突、具体场景与三段叙事推进完整；首次安全表达没有把高张力内容压扁成抽象主题。
- 明确缺陷一：“司马懿诈病夺权：曹爽陪小皇帝出城后遭遇关门伏杀”暗示曹爽返程时遭伏杀，但正文写曹爽交出兵权后仍被夷三族；标题动作与正文因果不一致。selector 只对史源差异扣分，仍将其排第 2，没有识别该矛盾。
- 明确缺陷二：“宋钦宗亲赴金营被扣：一个皇帝亲手交出城门后连自己也赔进去的末日”把交出城门归给宋钦宗，正文却写郭京大开城门出战导致城防崩溃；selector 将其排第 6，但扣分中没有指出主体不一致。
- 另有风险：“唐文宗设局诛宦官反被围杀”容易被理解为唐文宗本人被围杀，正文实际是文宗被劫持、李训等朝臣被杀；该候选仍被 selector 排第 1。标题压缩造成的主语歧义没有进入 `source_or_scope_risk`。
- 结论：selector 新规则对一般史源、范围、敏感内容和叙事质量给出了细致扣分，但没有守住本任务最关键的标题—正文主体/动作/因果一致性。质量较 Task 13 局部改善，但整体闸门仍未通过。本判断来自人工整体阅读，不使用本地字符串或关键词门禁。
- semantic reviewer 继续保持 shadow-only，没有接入主链路或自动门禁。

### 阶段结论

- Task 14 在单样本中消除了 1301 引发的完整重生成，把 provider 总等待再降低 13.9%；这证明首次安全表达具有局部价值，但 139.702 秒仍不能直接宣称达到用户可接受区间。
- 成功 builder、selector 与总 token 均反向增长，说明下一轮高性价比方向应优先复核 builder 输出体量和 selector 输入体量；是否瘦身、瘦哪些字段、如何保持 8/4 质量合同，必须先形成独立设计，不能直接删字段或改 schema。
- selector 语义一致性 prompt 只有部分效果，不能作为已解决质量问题的证据；下一设计需比较“builder 自检收敛”“selector 更聚焦的只读一致性复核”与独立后处理等方案，但不得使用本地关键词规则，也不得把 semantic reviewer 升级为自动门禁。
- S2-0 继续保持打开，不进入 S2-1；本轮完成报告后停止，不自动实施下一轮优化。

## 2026-07-16 Task 15 非 live 实施记录（等待真实页面诊断）

### 实施边界

- 新增纯函数 `projectTopicSelectorPool()`，真实 `topic.selector` 请求保留全部候选、顺序、事件身份、标题、切口、family/scope、冲突、场景、三段 preview、风险与 fatigue score；删除仅供本地去重的 normalized identity、重复的 recently seen 和 builder 自评 viral rubric。
- 完整 `SelectorPoolCandidate` 继续用于本地去重、疲劳排序、candidate library、诊断和持久化；投影只影响发送给 LLM 的请求，不截断、不改写、不排序、不做语义判断。
- `topic.candidate-builder` 保持 8 个完整 `TopicCandidateCard`，加入字段软预算和输出前主体/动作/因果/结果自检；软预算不是 schema、validator、repair 或本地截断规则。
- `topic.selector` 仍强制目标工具并排序全部候选，先检查内部一致性，再做叙事质量与疲劳排序；deductions 通常收敛到最重要的 0–2 条，但 strict schema 的最多 4 条兼容上限不变。
- GLM-5.2、8/4 合同、两次正常调用、shared schema、API、thinking、timeout、retry、repair、request budget 和 semantic reviewer shadow-only 边界均未改变。

### 静态规模证据

| 对象 | 修改前 | 修改后 | 静态变化 |
| --- | ---: | ---: | ---: |
| builder prompt | 4933 字符 / 152 行 | 3969 字符 / 122 行 | 字符下降 19.5%，行数下降 19.7% |
| selector prompt | 2259 字符 / 74 行 | 2102 字符 / 63 行 | 字符下降 6.9%，行数下降 14.9% |
| Task 14 同一真实 selector pool 紧凑 JSON | 6882 字符 | 5384 字符 | 下降 1498 字符，21.8% |

selector pool 对照只读取 Task 14 已保存的本地 interaction input，并按新纯投影计算；没有重新请求 provider，也没有提交 raw output。静态字符下降不能直接等同于 token 或 latency 下降。

### TDD 与非 live 证据

- 投影 helper 先经历模块缺失红灯，再用只抛 `not implemented` 的脚手架得到行为红灯，最小实现后 2/2 通过；测试证明字段边界、候选顺序、疲劳候选保留、原对象不变且固定 fixture 更短。
- 真实 strict selector 路由测试先因仍含三个待删除字段而失败，接入投影后与完整 topic runtime 合计 52/52 通过，证明不是只测试未接线 helper。
- Builder 与 Selector prompt 各自先新增两项失败合同测试，再做最小 prompt 重组；focused 回归分别为 76/76 与 156/156 通过。
- 完整受影响矩阵覆盖 16 个文件、260 项测试，260/260 通过；`npm run typecheck:backend` 通过，prompt language 检查通过。测试没有调用真实网络 provider。

### 当前结论与下一闸门

- Task 15 已完成非 live 代码、prompt、测试和静态规模收口，但没有真实证据证明 GLM-5.2 duration、token usage 或人工语义质量已经改善。
- S2-0 继续保持打开，不从静态字符下降声明用户等待已达标，也不进入 S2-1。
- 下一步只能在新的明确授权下复用“魏晋至唐宋·高张力历史事件推荐”做一个新项目、最多 2 次请求的真实页面诊断；需记录 builder/selector/页面耗时、token、attempt、repair/retry/fallback、结构首次通过与人工整体质量。TTFT 仍为非流式不可观测。

## 2026-07-16 Task 15 首轮真实页面诊断（性能通过，质量仍需扩大验证）

### 运行边界与证据

- 用户明确授权模型 GLM-5.2、固定输入“魏晋至唐宋·高张力历史事件推荐”、最多 2 次 provider 请求、不执行 capability probe、人民币 10 元人工费用上限、现有测试账号新项目，raw output 允许保存但不提交。
- backend 启动前显式设置 `LLM_REQUEST_BUDGET_MAX_REQUESTS=2`，主模型与 structured 模型均为 GLM-5.2。
- 真实页面项目：`465fa681-f6b6-43b9-b028-b68df45039c6`；topic run：`topic_run_e934fc08-da55-4f1f-8bb6-0e59a4d989b3`。
- raw output 与 interaction log 只保存在 `storage/projects/` 忽略目录，不提交；共 2 个 interaction，正好是 builder 与 selector，没有 capability probe 或第三次请求。
- 当前日志不能按人民币价格机器核验费用；TTFT 在非流式接口下仍不可观测。

### 延迟、文本规模与 usage

| 指标 | Task 14 | Task 15 | 单样本变化 |
| --- | ---: | ---: | ---: |
| builder | 105.288 秒 | 53.417 秒 | 下降 49.3% |
| selector | 34.414 秒 | 20.297 秒 | 下降 41.0% |
| provider 合计 | 139.702 秒 | 73.714 秒 | 下降 47.2% |
| 总 token | 14908 | 10802 | 下降 27.5% |
| builder raw output | 7570 字符 | 5497 字符 | 下降 27.4% |
| selector 实际投影 | 7466 字符 | 4426 字符 | 下降 40.7% |
| selector tool arguments | 3739 字符 | 3300 字符 | 下降 11.7% |

- 页面从点击生成到首次确认 4 个结果可见约 80 秒；selector interaction 在点击后约 73.845 秒结束。页面观察存在轮询粒度，因此 80 秒只作为用户等待近似值，不伪装为精确后端耗时。
- builder：`prompt_tokens=2152`、`completion_tokens=3198`、`reasoning_tokens=0`、`finish_reason=stop`；selector：`prompt_tokens=4072`、`completion_tokens=1380`、`reasoning_tokens=0`、`finish_reason=tool_calls`。
- 两次调用均为 attempt 1 成功；builder 普通 JSON 首次解析并交付 8 个候选，selector strict target tool 首次交付 4 个候选。未发生 provider retry、本地 repair、structured fallback、业务 full regeneration 或请求预算阻断。
- selector 实际投影下降同时包含“删除重复字段”和“本轮候选正文更短”两种影响，不能把 40.7% 全部归因为投影代码；但 prompt token、completion token、文本规模和耗时在本样本中同向下降。

### 人工质量对照

- 明确改善：Task 14 的两项明确标题—正文主体/动作矛盾没有复现；对应候选本轮三段 preview 的主体、动作、因果和结果一致。完整候选的 family label 由 Task 14 的 2 类扩展为 7 类，表面多样性改善。
- builder 缺陷：8 个原始候选中有 1 项属于秦朝，违反“魏晋至唐宋”时代边界。selector 正确把它排到第 8、扣除范围分并排除出最终 4 项，说明用户可见结果被保护，但 builder 的硬约束并未做到首轮全通过。
- selector 遗留：最终第 1 候选的短切口仍容易把“被杀”结果错误关联到前置的皇帝主体，正文实际是皇帝被劫持、参与朝臣被诛。selector 没有指出该主语歧义，Task 14 的同类风险尚未消失。
- 其余候选没有发现标题与三段 preview 的明显自相矛盾；selector 能指出兵力数字的史源风险、预谋争议、改革题材的画面与展开风险、长跨度人物题材的归因风险，并把这些风险较高项降序处理。
- 最终 4 项均在指定时代范围，且具备清晰冲突、三段推进与可口播强场面；但其中 3 项属于政变/宫廷权力翻转，最终组合仍偏同质。semantic reviewer 继续保持 shadow-only，没有接入主链路或自动门禁。
- 总体判断：相对 Task 14，用户可见质量和完整池质量均有改善，但“时代硬约束首轮漏项”和“标题压缩造成的主体歧义”证明质量保护尚未完全收口。本结论来自人工整体阅读，不使用关键词或本地启发式门禁。

### 阶段结论

- Task 15 首轮真实样本满足“token、文本规模与耗时同向下降”，provider 等待从约 2 分 20 秒降至约 1 分 14 秒，证明本轮编排与合同瘦身具有显著单样本收益。
- 单样本不能证明通用延迟分布，也不能证明语义一致性规则已稳定生效；尤其 builder 范围漏项与 selector 主语歧义仍需保留为后续诊断问题。
- S2-0 继续保持打开，不进入 S2-1。下一步应先在新的明确授权下扩大一个小型固定样本组，确认速度收益可重复、最终候选质量不退化，再决定是否继续做窄质量优化或正式收口；不得从本次单样本直接声明全部优化完成。

## 2026-07-16 Task 15 小型固定样本扩展（性能收益可重复，质量缺陷稳定复现）

### 授权边界与样本

- 用户明确授权继续使用 GLM-5.2，新建 2 个测试项目、合计最多 4 次 provider 请求、不执行 capability probe、人民币 20 元人工费用上限；允许保存但不提交 raw output。
- 样本一复用“魏晋至唐宋·高张力历史事件推荐”：项目 `c90d303c-a7d6-468b-8bc6-42b77653f9a0`，run `topic_run_1148d047-08f3-4153-99cd-f81893cdf587`。
- 样本二使用“先秦至两汉·均衡叙事历史事件推荐”：项目 `55528914-06fc-46b1-888e-6e330478d789`，run `topic_run_b05a85fe-d161-4130-a468-b3c69fd524b4`。
- backend 启动前显式设置 `LLM_REQUEST_BUDGET_MAX_REQUESTS=4`。新增项目共生成 4 个 interaction，正好是两个 builder 与两个 selector；raw output 只保存在忽略目录。
- 当前日志仍不能按人民币价格机器核验费用；TTFT 在非流式接口下仍不可观测。

### 三样本速度与规模聚合

本节把首轮 Task 15 与本次两个新增项目合并为 3 个样本；Task 14 只作为优化前对照，不计入分布。

| 指标 | Task 14 | Task 15 三样本范围 | Task 15 中位数 | 结论 |
| --- | ---: | ---: | ---: | --- |
| builder | 105.288 秒 | 52.585–74.207 秒 | 53.417 秒 | 最慢样本仍下降 29.5% |
| selector | 34.414 秒 | 14.659–20.297 秒 | 16.550 秒 | 最慢样本仍下降 41.0% |
| provider 合计 | 139.702 秒 | 67.244–90.757 秒 | 73.714 秒 | 最慢样本仍下降 35.0% |
| 总 token | 14908 | 10153–10802 | 10392 | 至少下降 27.5% |
| builder raw output | 7570 字符 | 5432–5547 字符 | 5497 字符 | 范围整体下降 26.7%–28.2% |
| selector 实际投影 | 7466 字符 | 4294–4450 字符 | 4426 字符 | 范围整体下降 40.4%–42.5% |
| selector tool arguments | 3739 字符 | 2128–3300 字符 | 2209 字符 | 随扣分数量变化，均未超过 Task 14 |

- 三个样本全部为 builder attempt 1 + selector attempt 1，`reasoning_tokens=0`；没有 provider retry、本地 repair、structured fallback、业务 full regeneration 或请求预算阻断。
- 三次 provider 合计平均为 77.238 秒、总 token 平均为 10449；相对 Task 14 分别下降 44.7% 和 29.9%。三样本不支持 P95，但足以证明本轮性能收益不是单次最快值。
- 页面首次观察到结果约为 80、125、93 秒；观察间隔较粗，尤其后两次晚于精确 provider 完成时间，因此只能视为用户等待上界，不能据此反推精确前端开销。

### 三样本人工质量聚合

- 范围保护：24 个原始候选中只有首轮 1 项越出指定时代，后两轮没有复现；12 个最终展示候选全部在指定时代。selector 的范围安全网有效，但 builder 首轮硬约束仍不是绝对可靠。
- 稳定缺陷：同一个“魏晋至唐宋·高张力”输入两次都生成了主体指向含混的短切口，且 selector 两次都排到第 1、没有给出一致性扣分。该问题已由单样本风险升级为可重复缺陷，不能再用随机波动解释。
- 语言质量：同输入复验的一个非最终候选在三段 preview 中混入英文连接词；selector 因题材疲劳将其排出最终 4 项，但没有识别语言污染本身。不得用本地关键词规则替代此类语义判断。
- 多样性：两个高张力样本的最终 4 项都包含 3 个宫廷/政变型事件，说明该组合仍有类型集中；均衡叙事样本的最终 4 项覆盖宫廷阴谋、刺杀、绝境翻盘与战略博弈，组合明显更均衡。
- 边界样本：8 个原始候选和最终 4 项均在先秦至两汉范围，主体、动作、因果与三段推进整体连贯；selector 能识别高频题材、兵力争议和同圈层疲劳，但一个最终候选仍存在结局表述过于绝对的风险。
- 观测缺陷：两个新增项目的 `recommendation-diagnostics.md` 仍把 builder 原顺序前 4 项写在 `Candidates`，与页面和 `runtime-diagnostics.json` 的 selector 最终 4 项不一致。该文件不能继续作为最终选择证据，需单独窄整改。
- semantic reviewer 继续保持 shadow-only，没有接入主链路或自动门禁；人工判断未使用本地字符串或关键词门禁。

### 阶段结论

- Task 15 的 topic 性能优化通过小型固定样本扩展：成功路径稳定保持两次请求，provider 总等待约 67–91 秒，token 与文本规模同向下降。无需继续用付费样本证明同一性能方向。
- 质量尚未收口：selector 对同一主体歧义连续漏判，语言污染与绝对化结果也没有被准确归因。下一任务应先做非 live 的质量合同与诊断真相源设计，不应继续堆 prompt 口号、增加本地关键词规则或直接增加第三次 LLM 调用。
- S2-0 继续保持打开，不进入 S2-1；下一窄任务应把“修正 diagnostics 最终候选记录”和“为最终候选提供可验证的 LLM 语义一致性合同”分成低耦合步骤，再决定是否需要新的 live 授权。

## 2026-07-16 Task 15 diagnostics 真相源窄整改（非 live）

- 根因确认：页面和 `runtime-diagnostics.json` 均消费 `selected.candidates`，但 `recommendation-diagnostics.md` 写入调用误传 selector 之前的 `postProcessed.candidates`，因此稳定记录 builder 原顺序前 4 项。
- 新增真实 service 回归：builder 生成 8 项、selector 明确把第 5–8 项排到最终 4 项；旧代码红灯显示 Markdown 仍写第 1–4 项。
- 最小修复只把 Markdown 写入参数改为 `selected.candidates`，不改 renderer、prompt、schema、API、模型、selector 行为或 raw trace。
- 定向红灯后绿灯通过；完整 `topic-runtime-recommendation` 为 51/51 通过，`npm run typecheck:backend` 通过。未执行 live 请求。
- diagnostics 最终候选真相源已修复；同输入主体歧义连续漏判仍未修，S2-0 继续保持打开。下一独立任务是语义一致性合同设计，不得把本次观测修复表述为内容质量修复。
