# S2-0 Topic 轻审核 Thinking 隔离诊断设计

## 1. 背景与问题

Topic 轻审核流程在同一“晏子使楚”样本的计时复验中，`topic.candidate-builder` 耗时 `26.743s`，而职责更窄、输出更短的 `topic.light-review` 耗时 `77.357s`。本地编排仅约 `0.031s`，异常耗时位于远端严格结构化调用内部。

当前 `topic.light-review` 没有精确 thinking override。GLM-5.2 structured profile 也没有本地 thinking 默认值，因此请求未显式携带 thinking，实际沿用 provider default。既有运行证据表明 GLM-5.2 的 provider default 可能产生 reasoning tokens；但本次 Topic-only 计时脚本没有保存 response metadata 和 attempt 明细，不能直接证明 `77.357s` 中有多少来自 reasoning、远端排队或瞬时重试。

## 2. 已批准目标

使用完全相同的固定 4 候选输入，对 `topic.light-review` 做一次严格单变量 A/B：

- A：`thinking=provider_default`，即不向 provider 发送 thinking 字段。
- B：`thinking=disabled`。
- 两轮均使用 `glm-5.2`、同一正式中文 Prompt、同一 strict schema、同一 parser、同一目标工具和 `maxAttempts=1`。
- 每轮只允许 1 次 provider 请求，整个实验正好 2 次请求。

实验首先回答“provider-default thinking 是否是轻审核长耗时的主要来源”，其次判断关闭 thinking 是否会破坏轻审核所需的内部一致性召回。

## 3. 方案比较

### 方案 A：固定 4 候选 Light-review-only A/B（采用）

从已经人工复核的 Selector 语义 fixture 中取 2 个风险正例和 2 个 `none` 对照，映射为正式 `review_pool`，分别运行 provider default 与 disabled。优点是只花 2 次请求、输入完全一致、能同时观察耗时和语义门禁；缺点是单次 A/B 仍不能代表长期延迟分布。

### 方案 B：完整 Topic 端到端 A/B（不采用）

每轮重新运行 Builder 和轻审核。候选内容会随机变化，至少需要 4 次请求，无法把差异归因到 thinking，且浪费当前额度。

### 方案 C：直接把生产 Light Review 改成 disabled 再观察（不采用）

调用最少，但没有预先证明语义召回不退化。旧 Selector 已经出现关闭 thinking 后风险召回丢失，不能把生产用户作为实验样本。

## 4. 固定 fixture 与语义门禁

固定 fixture 复用现有人工静态 annotation，不通过关键词、正则或本地推断生成期望标签：

- 靖康候选：期望 `actor_role_mismatch`。
- 鸿门宴候选：期望 `overclaim_or_ambiguity`。
- 玄武门候选：期望 `none`。
- 巫蛊候选：期望 `none`。

源 fixture 中鸿门宴与玄武门均使用 `selector_candidate_3`，不能直接合并。新 fixture 为四项分别分配带源 fixture 前缀的稳定唯一 id，并让静态 annotation 使用同一映射；候选正文和人工期望标签不改。新 fixture 只保留 `topic.light-review` 正式输入需要的字段和上述静态 annotation。比较器只按映射后的唯一 candidate id 对照 provider 返回的 enum，不读取候选正文自行判断语义。

## 5. 实验入口与数据流

新增非默认 harness：

1. 默认运行只生成零请求 dry-run plan。
2. `--live --confirm-live`、精确模型、请求预算和成本声明齐备后才允许真实请求。
3. live runner 在同一进程内复用一套生产 Prompt Registry、LLM Gateway 和 provider，并共享 `RequestBudget(maxRequests=2)`；两轮串行执行，provider `maxAttempts=1`，不允许 fallback 或任何额外请求。
4. 两轮复用 `TOPIC_LIGHT_REVIEW_STRICT_SCHEMA` 和 `parseTopicLightReviewDecision`，只在 invocation options 上分别省略 thinking 或显式传入 disabled。
5. interaction writer 只在内存中捕获单轮元数据。
6. 脱敏结果记录 effective thinking、attempt、duration、prompt/completion/reasoning tokens、finish reason、tool arguments 字符数和四项 enum 对照；不落盘 system prompt、候选正文、raw output、API key 或 base URL。

两轮输出写到不同目录，再生成一个 A/B 汇总记录。任何一轮结构失败都不得自动重试，也不得改用 structured fallback，否则单变量失效。

## 6. 通过条件与生产决策

只有同时满足以下条件，才允许为精确 operation `topic.light-review` 写入 `thinking=disabled`：

1. provider-default 与 disabled 两轮均结构通过、candidate id 唯一覆盖 4/4。
2. provider-default 与 disabled 两轮均召回两个风险正例 2/2，且 exact enum 2/2。
3. provider-default 与 disabled 两轮的两个 `none` 对照均通过 2/2；provider-default 若不通过，对照本身无效，只记录结果，不改生产。
4. disabled 轮 effective thinking 明确为 `disabled`，reasoning tokens 为 0；provider-default 轮 effective thinking 明确为 `provider_default`。
5. 两轮的模型、Prompt SHA、strategy、tool choice、maxAttempts 和其余 effective request 完全相同，唯一允许差异是 thinking。
6. 两轮合计实际 provider attempt 恰为 2，未发生 fallback 或 retry。
7. disabled 轮耗时低于 provider-default 轮；若差异很小或 default reasoning tokens 本来就是 0，只记录结果，不改生产。

生产改动只允许在 `APPROVED_THINKING_OVERRIDE` 中增加 `"topic.light-review": "disabled"`，由 strict 调用和受控 fallback 共同继承。不得顺手修改 Prompt、max tokens、temperature、timeout、retry、Builder 或补充条件。

## 7. 验证范围

- 新 harness 的 fixture、零请求默认、live guard、结构/语义比较、脱敏输出和 production gateway 参数测试。
- operation policy 先写 RED，确认 `topic.light-review` 当前没有 disabled override；live 主门通过后才做最小 GREEN。
- 回跑 Topic light review、runtime recommendation、API、operation policy、Prompt contract、Prompt 语言和 backend typecheck。
- 真实结果写入独立 record，并更新 `docs/plans/README.md` 与 `docs/todos/roadmap-todo.md`；单次 A/B 不得被描述为稳定延迟分布。

## 8. 边界

- 本实验最多 2 次真实请求，不进入 Builder、Script 或浏览器。
- 不把 fixture annotation 接入生产。
- 不新增本地语义规则。
- 不因 disabled 更快就忽略语义门禁。
- 不因单次 provider-default 长尾就声称供应商算力不足。
- 若 disabled 语义失败，保留 provider default，继续把问题记录为审核模型计算成本与交互延迟冲突。
