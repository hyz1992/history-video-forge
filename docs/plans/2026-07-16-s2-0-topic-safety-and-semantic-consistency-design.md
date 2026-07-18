# S2-0 Topic 首次安全表达与语义一致性优化设计

## 1. 文档定位

本文档收敛 S2-0 Task 14 第一批优化：在保持 GLM-5.2、8 个原始候选、4 个最终展示项、现有 `TopicCandidateCard`、API 与 selector tool schema 不变的前提下，减少 `topic.candidate-builder` 因供应商内容过滤产生的完整重生成，并利用现有 selector 语义能力降低标题与正文自相矛盾的候选进入最终 4 项的概率。

本设计只覆盖首次安全表达和 selector 语义一致性；builder 输出瘦身、候选分层生成、多供应商抽象和成本系统属于后续独立任务。

## 2. 当前事实

### 2.1 Task 13 真实证据

真实浏览器项目 `e478735a-6b92-4483-8923-e5e2a48e9b4d` 使用 GLM-5.2 和“魏晋至唐宋·高张力历史事件推荐”输入：

- 首次 builder 在 49.386 秒后返回供应商 `1301` 内容过滤，错误 payload 的 `contentFilter.role` 为 `assistant`；现有证据指向生成内容被过滤，而不是网络超时或 JSON/Zod 失败。
- topic service 在输入中追加 `safety_retry_context` 后完整调用 builder 第二次；第二次耗时 84.484 秒并成功，`reasoning_tokens=0`。
- selector 随后耗时 28.449 秒，完整 provider 等待为 162.319 秒。
- 相对优化前 193.893 秒，完整页面链路仅下降 16.3%；关闭 thinking 对成功 builder 调用本身有效，但首次 1301 抵消了大部分收益。
- 第二次输出的题材多样性有所改善，但出现“李世民玄武门射杀建成元吉”与正文元吉由尉迟敬德杀死不一致、“石勒夜营焚杀王衍”与正文推墙压死不一致。

### 2.2 请求预算事实纠正

当前代码已经存在跨同一 provider 实例共享的 `RequestBudget`：

- `createOpenAiCompatibleProvider()` 创建一次 budget；
- 普通与 strict 路径每次真实 HTTP attempt 都调用 `requestBudget.consume(operationName)`；
- topic 推荐的一次运行复用同一个 gateway/provider，因此 builder、service-level safety retry、repair 和 selector 会消费同一个 budget；
- 默认 `LLM_REQUEST_BUDGET_MAX_REQUESTS` 为 20。

Task 13 实际发生 3 次请求，不是因为完全缺少跨 service-level 硬闸门，而是启动 backend 时没有把用户授权的最大 2 次请求显式传入，沿用了默认 20。后续真实验收必须在启动进程时显式设置预算，不为此重复实现第二套预算系统。

### 2.3 Builder 输出负担

Task 13 成功 builder 的原始响应约 6371 个序列化字符，主要字段占比为：

- `must_cover_preview`：1269 字符；
- `viral_rubric`：1042 字符；
- `strong_scene`：878 字符；
- `core_conflict`：472 字符；
- `why_this_now`：443 字符；
- `risk_hints`：434 字符。

这证明 builder 输出仍有进一步瘦身空间，但其中多个字段直接参与 selector、持久化或后续 Topic Package，不适合在本任务中凭单样本删除。输出瘦身需单独审计和设计。

## 3. 方案比较

### 方案 A：首次安全表达前置 + selector 一致性检查（采用）

在正式中文 builder prompt 中加入一段短约束：保留人物、冲突、动作、赌注和后果，但避免具体血腥、尸体、酷刑和猎奇化处决描写。内容过滤 retry 只传结构化原因标记，具体语义仍由正式 prompt 解释。selector 增加标题、主体、动作、因果与叙事节点一致性检查。

收益：

- 直接针对已证实的 49.386 秒无效等待；
- 不改变 schema、API、候选数量或主链路阶段；
- 语义质量判断继续由 LLM selector 完成，不引入本地字符串启发式；
- 改动面小，可独立回退。

风险：

- 安全表达可能把高张力内容写得过于平淡；
- 单样本不能证明以后不再触发 1301；
- selector 新约束只能降低矛盾候选排序，不能替代正式事实核查。

### 方案 B：只调整 budget/retry，不改 prompt（不采用）

通过更小预算或 deadline 阻止第三次请求。

该方案能防止授权超额，但无法减少首次等待；如果 builder 被过滤，用户只会更快得到失败，不能满足“更快且更好地产出结果”的目标。现有 budget 已能完成硬限制，不应重复建设。

### 方案 C：轻量候选池 → selector → 最终候选丰富（后续独立设计）

让 builder 先生成较轻的 8 个候选，selector 排序后只丰富最终 4 个。

该方案可能减少 builder output token，但需要引入内部 draft 合同、最终 enrichment、缓存/repair/持久化重新分层，并可能增加一次 LLM 调用。收益和复杂度都更高，不与本次低风险修复混合。

## 4. 正式设计

### 4.1 Builder 首次安全表达

修改 `prompts/topic/candidate-builder.prompt.md`，新增一段简短中文规则：

- 必须保留具体人物、对抗力量、关键动作、明确赌注和故事余震；
- 用历史叙事策划语言描述冲突和后果；
- 不展开具体血腥、尸体、酷刑、肢体伤害细节或猎奇化处决画面；
- 不得因为安全表达而退化成抽象主题、无动作概括或空泛价值判断。

该规则正常请求即生效，目标是避免先生成容易被供应商过滤的文本，再等待完整重生成。

### 4.2 Safety retry 元数据

保留现有“1301 最多完整重生成一次”的容错能力，但修改 `withTopicSafetyRetryContext()`：

- 删除业务代码中英文自然语言 `instruction`；
- 只保留结构化元数据，例如：

```json
{
  "safety_retry_context": {
    "reason": "provider_content_filter",
    "mode": "strict_neutral_historical_planning"
  }
}
```

- 正式 prompt 负责解释该 mode：retry 时进一步压缩对物理伤害的描写，只保留决策、压力、场景和后果；
- retry 不增加新的 provider retry、退避或第三次完整生成。

这样可继续区分首次请求和安全重生成，同时遵守正式 prompt 必须集中在 `prompts/`、语言必须为中文的工作契约。

### 4.3 Selector 语义一致性

修改 `prompts/topic/selector.prompt.md`，在现有排序原则中增加：

- 对照 `title`、`one_line_angle`、`core_conflict`、`strong_scene` 与 `must_cover_preview`；
- 检查行为主体、关键动作、因果关系、事件结局是否内部一致；
- 如果标题声称的执行者、动作或结局与正文证据冲突，在现有 `source_or_scope_risk` 轴明确扣分并写明原因；
- 不改写候选，不新增候选，不把 selector 变成事实核查或自动门禁。

该规则使用 selector 已有语义能力和扣分合同，不增加本地关键词、字符串匹配或 schema 字段。

### 4.4 请求与失败数据流

正常链路：

```text
builder 中文 prompt（首次即带安全表达边界）
  → 8 个 TopicCandidateCard
  → 本地结构归一化/去重/疲劳处理
  → selector 语义一致性检查与排序
  → 最终 4 个候选
```

1301 链路：

```text
builder 首次 1301
  → service 追加结构化 safety retry 标记
  → 同一正式 prompt 按 strict mode 完整重生成一次
  → 成功后继续 selector；再次失败则返回原始错误语义
```

预算链路：

```text
共享 RequestBudget
  → 每次普通/strict HTTP attempt 消费 1
  → 达到显式 maxRequests 后阻止后续请求
```

后续付费验收若授权最多 2 次请求，必须以 `LLM_REQUEST_BUDGET_MAX_REQUESTS=2` 启动 backend。若 builder 仍触发 1301，第二次 builder 将耗尽预算，selector 不得成为第三次请求。

## 5. 质量保护

- 8 个原始候选与 4 个最终展示项保持不变；
- `TopicCandidateCard`、selector strict tool schema、API、Topic Package 均不变；
- builder 必须继续交付具体冲突、可视化场景和三段叙事推进；
- selector 只做候选池内语义排序，不生成或改写候选；
- semantic reviewer 保持 shadow-only；
- 不用本地规则判断历史事实、标题好坏或传播质量；
- 真实质量结论必须基于人工整体阅读，不以 JSON/Zod 通过代替。

## 6. 观测与验收

### 6.1 非 live 验收

- TDD 证明首次 builder 使用更新后的正式 prompt；
- TDD 证明 1301 后只追加结构化 reason/mode，不再从业务代码注入英文正式指令；
- TDD 证明非内容过滤错误不进入 safety retry；
- prompt runtime 验证 builder/selector prompt 元数据仍为 `zh-CN`；
- 现有 topic/provider/operation policy 回归全绿；
- backend typecheck 与 `git diff --check` 通过；
- shared schema、API、模型配置、候选数量无 diff。

### 6.2 后续独立 live 验收

本任务不执行付费 live。后续授权应复用同一“魏晋至唐宋·高张力历史事件推荐”输入，最多 2 次请求并显式把 budget 传入 backend，记录：

- builder 是否首次成功；
- 是否仍出现 1301 / safety retry；
- builder、selector、完整页面耗时；
- reasoning/output token；
- 8 个候选与最终 4 项；
- 标题、主体、动作、因果和结局一致性；
- 高张力是否被安全表达过度削弱。

只有等待显著改善且人工质量不劣时，才允许继续收口 S2-0。

## 7. 回退策略

- 首次安全表达导致候选明显平淡时，只回退 builder prompt 本次新增段落；
- selector 一致性约束导致排序偏离整体作品质量时，只回退 selector 本次新增规则；
- 不回退 thinking、观测、timeout/retry policy 或 request budget；
- 不通过增加重试次数掩盖内容过滤或质量退化。

## 8. 后续任务边界

完成本设计的非 live 实施后停止，等待独立 live 授权。若真实页面仍慢，再单独进入 builder 输出瘦身设计，重点评估 `viral_rubric`、`why_this_now`、`estimated_duration_band`、`source_hint` 与 `recent_usage_hint` 的生成时机；不得在本任务提前改变内部合同或增加 enrichment 调用。
