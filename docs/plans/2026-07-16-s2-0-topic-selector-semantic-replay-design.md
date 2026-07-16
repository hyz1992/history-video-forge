# S2-0 Topic Selector 语义回放设计

**状态：** 已经用户确认，等待实施计划与非 live 实施

**日期：** 2026-07-16

**范围：** 仅固化 Task 17 真实失败样本，并建立显式、可预算的 Selector-only 语义回放；本设计不修改正式 Selector prompt、strict schema/parser、selection、shared/API、前端或 Builder。

## 一、背景与问题边界

Task 17 已完成两组 GLM-5.2 真实页面验收。紧凑 provider DTO 在结构和成本方向上达到预期：两次 Selector 都以目标工具首次返回，parser、候选覆盖、trace、pass 优先和最终四项链路正常，且 arguments 字符、completion token 与 Selector duration 相比 Task 16 均下降。

但两次真实 Selector 响应都把 8 个候选全部判为 `consistency_issue=none`，人工复核发现三处高置信度漏判：

1. 高张力样本 `selector_candidate_7`（靖康之变）：`one_line_angle` 用一个“皇帝”串联徽宗禅位南逃与钦宗出城赴金营，混淆了两个行为主体，期望识别为风险，人工首选标签为 `actor_role_mismatch`。
2. 均衡叙事样本 `selector_candidate_3`（鸿门宴）：标题把“项羽放过刘邦”直接升级为“天下归属已经注定”，内部材料只支持刘邦脱身和范增失望，期望识别为风险，人工首选标签为 `overclaim_or_ambiguity`。
3. 均衡叙事样本 `selector_candidate_7`（党锢之祸）：候选同时使用“永久禁止做官”“整个知识阶层的沉默”“清议传统彻底断绝”等绝对化表述，内部材料不足以支持这些强断言，期望识别为风险，人工首选标签为 `overclaim_or_ambiguity`。

实际交互日志已经证明：

- 正式 System Prompt 包含逐候选 verdict、断言强度核对和 `overclaim_or_ambiguity` 规则；
- provider 原始 arguments 已直接输出 8 个 `none`；
- parser 只做确定性结构映射，没有丢失 risk；
- 当前失败位于模型语义 verdict 层，而不是 schema、parser、trace、selection 或前端传输层。

因为 Builder 每次生成的候选不同，继续完整重跑项目无法稳定复现这三处输入，也无法把结果变化可靠归因于 Selector。下一步必须先冻结真实 Selector 输入，再讨论 prompt 单变量实验。

## 二、目标与非目标

### 2.1 目标

- 将 Task 17 两份生产实际 Selector 输入固化为可审计 fixture。
- 每份 fixture 同时包含高置信度风险正例和高置信度 `none` 对照，避免只优化召回而把模型推向“全报风险”。
- 建立默认不联网、显式 live 才联网的 Selector-only 回放入口。
- live 回放直接使用生产 Prompt Registry、`TOPIC_SELECTOR_STRICT_SCHEMA` 和 `parseStrictSelectorDecision()`，不复制正式 prompt 或 tool schema。
- 把语义验收分为“是否识别出风险”的主指标和“具体 issue enum 是否一致”的辅助指标。
- 为后续单变量 prompt 实验提供稳定、低成本、可重复的输入基线。

### 2.2 非目标

- 本设计不直接修改或扩写正式 Selector prompt。
- 不修改 provider DTO、strict schema、parser、内部 scorecard、trace 或 selection。
- 不增加本地关键词、字符串匹配、黑名单或语义启发式。
- 不把 fixture 期望结果接入生产自动门禁。
- 不升级 semantic reviewer，不增加 reviewer 调用。
- 不重跑 Builder，不新建项目，不写数据库，不做浏览器生成操作。
- 不在本阶段声称 GLM-5.2 召回已经改善。

## 三、方案比较

### 3.1 方案 A：完整 Selector 输入快照 + Selector-only 回放

每个真实 run 保存一份完整 `recommendation_seed`、`selector_pool` 和 `recent_event_memory`，回放时只执行一次 strict Selector 调用。

优点：

- 保留生产实际的 8 候选横向比较上下文；
- 隔离 Builder 随机性、数据库状态和 UI 等无关变量；
- 两个 fixture 最多只需要两次 provider 请求；
- 可以复用生产 prompt、schema 和 parser；
- 能稳定比较后续单变量 prompt 改动前后的语义结果。

缺点：

- 需要新增专用 fixture loader、dry-run plan 和回放报告；
- 回放只验证 Selector 语义层，不代替最终完整页面验收。

### 3.2 方案 B：把三个失败候选拆成单候选微样本

每次只把一个候选交给模型判断。

优点是请求更短、定位直接；缺点是改变了生产中 8 候选共同排序和逐项判断的真实上下文，也无法检验风险膨胀。该方案只能作为后续人工诊断工具，不能作为主验收基线。

### 3.3 方案 C：继续重跑完整项目并做浏览器验收

优点是最接近用户路径；缺点是 Builder 候选随机、耗时和成本高，三处漏判大概率不会原样复现。它适合在 Selector-only 回放通过后做最终真实页面复验，不适合定位当前语义退化。

### 3.4 决策

采用方案 A。方案 B 不进入本次实施，方案 C 保留为后续独立授权的最终 live 验收。

## 四、fixture 设计

### 4.1 文件组织

计划新增：

```text
harness/samples/topic-selector-semantic-replay/
  fixture-set.md
  task17-high-tension.fixture.json
  task17-balanced.fixture.json
```

`fixture-set.md` 明确列出 fixture 路径，并声明这些样本只用于 Selector 语义回放，不是生产自动门禁。

### 4.2 JSON 形态

```json
{
  "fixture_id": "task17-high-tension",
  "source": {
    "project_id": "5fda1609-63ed-4f0d-b47a-bb48038b3a6a",
    "topic_run_id": "topic_run_3d8da9c7-aaaa-43f9-80fe-5cc5549ec95f",
    "interaction_index": 2,
    "model": "glm-5.2",
    "task": "S2-0 Task 17",
    "baseline_observation": "all_none"
  },
  "selector_input": {
    "recent_event_memory": [],
    "recommendation_seed": {},
    "selector_pool": []
  },
  "annotations": [
    {
      "candidate_id": "selector_candidate_7",
      "expected_risk": true,
      "expected_issue": "actor_role_mismatch",
      "entered_final_candidates": true,
      "rationale": "徽宗与钦宗的动作被同一个皇帝主体串联。"
    },
    {
      "candidate_id": "selector_candidate_3",
      "expected_risk": false,
      "expected_issue": "none",
      "entered_final_candidates": true,
      "rationale": "候选内部人物、动作和结果相互支持，作为 none 对照。"
    }
  ]
}
```

正式 fixture 中 `selector_input` 保存 interaction log 的完整输入对象，而不是上述省略示例。

### 4.3 两份 fixture 的人工标注

高张力 fixture：

- 风险正例：`selector_candidate_7`，人工首选 `actor_role_mismatch`；
- `none` 对照：`selector_candidate_3`（玄武门之变）。

均衡叙事 fixture：

- 风险正例：`selector_candidate_3`（鸿门宴），人工首选 `overclaim_or_ambiguity`；
- 风险正例：`selector_candidate_7`（党锢之祸），人工首选 `overclaim_or_ambiguity`；
- `none` 对照：`selector_candidate_5`（巫蛊之祸）。

未标注候选不参与语义通过/失败判定。这样不会把仍有史源争议、但未达到高置信度内部冲突的候选强行固化成永久真值。

### 4.4 fixture 边界

- 不提交原始 provider 响应或 tool arguments。
- 不提交完整 interaction log、凭据或 `.env` 内容。
- source 只保存审计所需的项目、run、interaction 和模型标识。
- annotation 是人工语义基线，不用于生产 selection。
- fixture loader 只能做结构与引用完整性检查，不得读取候选文字推导标签。

## 五、回放架构

### 5.1 默认 dry-run

计划新增非默认命令：

```text
npm run harness:topic-selector-semantic-replay
```

不带 `--live` 时只执行：

1. 读取 fixture set；
2. 校验 fixture 结构、候选 ID 和 annotation 引用；
3. 校验每份 fixture 至少有一个风险正例和一个 `none` 对照；
4. 通过 `projectTopicSelectorPool()` 证明保存的候选字段与当前生产投影兼容；
5. 输出请求计划、所需请求数和安全边界；
6. 明确记录 `total_requests=0`。

默认命令不得创建 provider 或访问网络。

### 5.2 显式 live 回放

未来只有在用户再次明确授权后，才运行类似：

```text
npm run harness:topic-selector-semantic-replay -- \
  --live \
  --confirm-live \
  --model=glm-5.2 \
  --max-requests=2 \
  --max-cost-cny=<显式预算>
```

live 安全规则：

- `--live`、`--confirm-live`、model、请求上限和成本上限缺一不可；
- 请求上限必须覆盖且不得超过本次 fixture 数；本设计固定两份 fixture，因此最多两次请求；
- provider `maxAttempts=1`；
- 每份 fixture 只调用一次 `invokeStrictStructured()`；
- 使用 `strategy=tool_call`、`thinking=disabled`、`toolChoice=target_function`；
- 不运行 capability probe、repair、structured fallback、full regeneration 或 Builder；
- 单份 strict 失败只记录失败，不自动补发请求；
- 结果写入已忽略的 runtime output 目录，不提交 raw output。

这里故意不复用生产 service 的 structured fallback：本回放要测量的是同一个固定输入上的 strict 首次语义判断，自动 fallback 会增加请求并混淆变量。生产主链路的 fallback 行为继续由现有测试和页面验收覆盖。

### 5.3 生产合同复用

回放入口直接导入：

- `createPromptRegistry()`；
- `TOPIC_SELECTOR_STRICT_SCHEMA`；
- `parseStrictSelectorDecision()`；
- `projectTopicSelectorPool()`；
- 现有 gateway/provider factory。

不得复制 Selector prompt、tool schema 或 issue enum。harness 自己只保留 fixture annotation 类型和候选 ID 集合比较；集合比较是测试结果完整性检查，不是本地语义判断。

## 六、验收口径

### 6.1 主指标

用户已确认采用两层口径。主指标只回答“明确风险是否被识别”：

- 三个 `expected_risk=true` 候选的实际 `consistency_issue` 必须为非 `none`；
- 两个 `expected_risk=false` 对照的实际 `consistency_issue` 必须为 `none`；
- 每个响应必须且只能覆盖 fixture 候选池全部 ID，每个 ID 一次；
- strict 调用必须返回目标工具并由生产 parser 首次解析通过。

只要风险正例返回任一非 `none` issue，就计入风险召回。这样不会因为 `overclaim_or_ambiguity` 与 `cause_outcome_mismatch` 等相邻分类的合理差异，掩盖“模型已经发现风险”这一核心事实。

### 6.2 辅助指标

- 实际 issue 与人工首选 enum 的一致数量和一致率；
- 每份 fixture 的风险召回率与 `none` 对照通过率；
- completion token、prompt token、total token；
- tool arguments 字符数；
- duration、attempt、finish reason、reasoning token；
- prompt id、模型和可获得的 prompt/请求指纹。

辅助 enum 不一致必须记录，但不单独把主指标判为失败。

### 6.3 结果分层

- `matched`：主指标通过，且 issue 与人工首选 enum 一致；
- `risk_recalled_enum_differed`：风险已召回，但具体 enum 不同；
- `risk_missed`：风险正例仍返回 `none`；
- `none_control_failed`：对照被错误标成风险；
- `structural_failed`：strict、parser 或候选覆盖失败。

整体只有在三个风险正例均未漏判、两个 `none` 对照均通过且没有结构失败时，才能声明本固定样本的语义主指标通过。该结论仍不等于发布级事实核查通过。

## 七、错误处理与预算边界

### 7.1 调用前失败

以下问题必须在创建 provider 前失败，因此请求数为零：

- fixture set 为空或路径不存在；
- fixture ID 重复；
- selector pool 为空、candidate ID 为空或重复；
- annotation 引用未知或重复 candidate ID；
- issue 不属于生产枚举；
- fixture 缺少风险正例或 `none` 对照；
- live 参数或预算不完整。

### 7.2 调用后失败

- strict tool call、生产 parser 或候选覆盖失败：记录 `structural_failed`，不重试；
- 某个 fixture 调用失败后，可继续执行预算内尚未执行的另一个 fixture，但总请求数不得超过显式上限；
- 语义不匹配只写入报告，不触发新的 LLM 调用；
- 输出目录必须记录计划请求数、实际请求数和未执行原因。

## 八、non-live 测试设计

### 8.1 fixture loader

测试证明：

- fixture set 路径显式稳定；
- 两份 fixture 和来源 run ID 固定；
- 每份正好保留 8 个候选且 ID 唯一；
- annotation 只引用本 fixture 候选；
- 风险正例和 `none` 对照分布符合本设计；
- rationale 非空；
- issue 通过从生产 schema 提取的 enum 校验，不另写一套枚举。

### 8.2 生产投影兼容

测试为保存的投影候选补齐仅供 `projectTopicSelectorPool()` 输入所需、但不会输出的占位字段，再调用生产投影 helper，并断言结果与 fixture 中 `selector_pool` 完全相同。这样可以发现生产投影字段变化，同时不复制投影实现。

### 8.3 dry-run 与预算

测试证明：

- 默认运行只输出 dry-run plan，实际请求为 0；
- 缺少任一 live 确认参数时在 provider 创建前失败；
- 两份 fixture 的计划请求数为 2；
- `max-requests` 小于 2 或大于允许值时拒绝执行；
- output 报告明确 `automated_gate=false` 和 `selector_only=true`。

### 8.4 stub 回放

通过依赖注入的 stub runner 验证：

- 每份 fixture 恰好调用一次；
- 传入的是 fixture 完整 `selector_input`；
- options 固定为 target tool、thinking disabled、一次 attempt；
- 风险召回但 enum 不同会得到 `risk_recalled_enum_differed`；
- `none` 对照误报会得到 `none_control_failed`；
- 漏判和结构失败不会触发重试；
- 报告统计与逐候选记录一致。

### 8.5 不允许的测试方式

- 不断言 prompt 中存在某个历史人物或固定关键词来冒充语义能力；
- 不在本地扫描“注定”“彻底”“永久”等字符串并自动判风险；
- 不用 stub 命中人工标签来声称真实模型通过；
- 不把两份 fixture 的期望写入 production selection。

## 九、预计影响文件

本设计批准后的预计实施范围：

- `harness/samples/topic-selector-semantic-replay/fixture-set.md`
- `harness/samples/topic-selector-semantic-replay/task17-high-tension.fixture.json`
- `harness/samples/topic-selector-semantic-replay/task17-balanced.fixture.json`
- `harness/scripts/runtime/topic-selector-semantic-replay.ts`
- `tests/harness/topic-selector-semantic-replay.test.ts`
- `package.json`
- `harness/README.md`
- `harness/docs/s2-0-baseline-protocol.md`
- `docs/plans/README.md`
- `docs/todos/roadmap-todo.md`
- 对应中文 implementation plan

除非实施中发现当前导出无法复用，否则不修改 `backend/src/modules/topic/topic-recommendation.service.ts` 和 `topic-selector-prompt-projection.ts`。如确需改变生产模块导出或行为，必须停止并重新确认范围，不能顺手扩大。

## 十、non-live 与 live 结论边界

non-live 可以证明：

- fixture 真实来源、结构和人工标注完整；
- 回放入口默认不联网并受显式预算约束；
- 生产 prompt registry、schema、parser 和投影被真实复用；
- 结果比较、报告和错误分层正确；
- 没有新增本地语义启发式。

non-live 不能证明：

- GLM-5.2 会召回三处风险；
- enum 一致率、strict 首通率、token 或 latency 已改善；
- 完整 Builder + Selector + selection + 页面链路仍然通过；
- 两份固定样本可以代表所有历史题材。

这些结论必须分别通过未来显式授权的两次 Selector-only live 回放和后续完整页面验收获得，不得由静态测试外推。

## 十一、后续阶段

1. 先按本设计建立 fixture、dry-run plan、stub 回放和非 live 测试。
2. 完整 non-live 验证通过后停止，不自动调用 provider。
3. 用户另行授权后，用当前正式 prompt 执行两次 Selector-only live 回放，建立固定输入基线。
4. 若主指标仍失败，再独立设计一个短而明确的中文 prompt 单变量实验；不得同时修改 DTO、schema、模型或 provider。
5. prompt 实验在同一 fixture 上通过后，再请求授权执行完整浏览器验收。
