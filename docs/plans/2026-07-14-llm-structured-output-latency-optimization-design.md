# S2-0 旗舰模型结构化生成延迟与质量优化设计

> 设计日期：2026-07-14
> 状态：已完成代码、历史记录与运行配置复核，等待按配套实施计划执行
> 适用范围：当前智谱 OpenAI-compatible 路由下的 LLM 调用；多供应商抽象仍属于 S2-1

## 1. 决策摘要

当前 `GLM-4 + GLM-5` 混用是复杂结构化输出过慢后的临时降级方案，不是目标架构。S2-0 的首要目标也不是通过更弱模型换速度，而是：

> 让经过项目质量验收的旗舰模型尽可能承担 topic、script、storyboard 等高语义价值生成，通过观测、thinking、超时重试、结构化策略、局部 repair 和调用编排优化，把等待时间控制在用户可接受范围，并保留同供应商后续旗舰模型的配置化升级与回退能力。

本设计采用两个连续阶段：

1. **S2-0a：观测与固定样本基线。**补齐真实请求、attempt、usage、finish reason、校验和 repair 记录；不改变生成行为。
2. **S2-0b：基于基线的低风险编排优化。**显式控制 operation 参数，阻止长生成超时后的原样重复等待，验证强模型的 thinking 与结构化策略，保持语义质量不退化。

以下工作不并入本轮实现：script 输出合同瘦身、storyboard 分层生成、asset planning 全链路重构、多供应商路由、Prompt Registry 重构、成本系统和用户模型偏好。这些方向需要独立 design + implementation plan。

## 2. 目标与非目标

### 2.1 目标

- 找出各 operation 用户等待时间的真实组成，而不是笼统归因于“模型太大”。
- 在当前供应商内，让候选旗舰模型通过配置、能力检查、固定样本回归和回退完成升级，不要求修改业务 operation。
- 对质量敏感和纯结构整理任务采用不同的 thinking、timeout、retry 与结构化策略。
- 保持 topic/script 的叙事、口播和历史边界质量，不以 JSON 通过率替代内容质量。
- 让失败可以定位到具体 operation、attempt、错误类型和 repair/full regeneration 阶段。
- 改善用户对等待阶段、重试和失败位置的理解，不伪造进度或 TTFT。

### 2.2 非目标

- 不要求所有 operation 立即统一到同一个模型。
- 不把 GLM-4 固化为长期结构化模型；它只是当前基线和必要回退。
- 不在 S2-0 建立 DeepSeek、OpenAI 等多供应商 adapter、routing 或 fallback。
- 不自动采用供应商 `latest` 别名；新旗舰必须经过本项目样本验收后才成为 approved model。
- 不修改 topic、script、storyboard、asset planning 的正式语义合同。
- 不把 semantic reviewer 从 shadow-only 升级为自动门禁或自动 patch 动作。
- 不用关键词、字符串规则或本地启发式判断历史准确性、叙事质量或“爆款感”。

## 3. 当前事实基线

### 3.1 当前有效配置

2026-07-14 的只读环境解析结果为：

| 配置 | 当前值 |
|---|---|
| provider | `openai`（OpenAI-compatible 实现） |
| main model | `glm-5.1` |
| structured model | `glm-4` |
| structured strategy | `json_object` |
| structured thinking | 未显式配置 |
| timeout | `240000ms` |
| max attempts | `3` |
| request budget | `20` |

main 与 structured profile 当前都指向智谱路由。模型名称可以通过环境配置更换，但当前缺少统一的 effective options、能力验证、升级回归和运行快照，因此“能改模型名”还不等于“可以安全无缝升级”。

用户指定 GLM-5.2 为第一轮候选旗舰模型，但它不是当前运行事实。正式诊断前必须确认当前通用 Chat Completions 路由接受的准确 model ID，以及 thinking、usage、tool call 的真实行为；不能把 Coding Plan 或官网宣传页中的模型名称直接当成当前 API 合同。

### 3.2 Provider 与重试事实

`backend/src/runtime/llm/openai-compatible-provider.ts` 当前行为：

- 普通 `invokeStructuredPrompt()` 只发送 `response_format: { type: "json_object" }`。
- 普通路径不发送 `thinking`、`max_tokens`、`temperature`、`top_p`。
- 普通路径只返回 `message.content`，供应商响应中的 usage、finish reason 等信息被丢弃。
- strict 路径只支持 tool call，并可发送 thinking、sampling 和 max tokens。
- strict 请求当前使用 `tool_choice: "auto"`，没有强制指定目标 function，也没有发送供应商级 `strict: true`。
- 请求通过 `AbortController` 实现 timeout。

`backend/src/runtime/llm/external-errors.ts` 当前行为：

- timeout 被统一标记为 retryable。
- retry 重新执行同一个闭包，因此输入、模型和请求参数不变。
- 当前最多 3 attempts，退避为 1500ms、3000ms。
- 按当前 240 秒 timeout 计算，单次 invocation 的理论最坏等待约为：

```text
240s × 3 + 1.5s + 3s = 724.5s
```

即约 12 分 4.5 秒，而不是旧草稿中的 6 分钟。

JSON 解析发生在网络 retry 包装之后，因此 invalid JSON 不会触发 provider 网络重试；它会进入 deterministic recovery、上层 repair 或 full regeneration。

### 3.3 结构化输出职责

| 层 | 当前职责 | 不负责什么 |
|---|---|---|
| 普通 JSON mode | 要求供应商返回 JSON object | 不保证具体字段、枚举、引用和业务语义 |
| strict/tool call | 通过 function arguments 缩小输出形态 | 当前没有强制目标工具，也未证明所有模型和路由都支持严格 schema |
| Zod | 解析并验证 TypeScript/领域结构合同 | 不判断整体叙事、历史质量或口播效果 |
| 本地 validator | 检查引用、体量下限、顺序、合同和确定性业务规则 | 不做只有 LLM/人工才能完成的语义判断 |
| deterministic repair | 提取 fenced JSON 等确定性恢复 | 不创作缺失语义内容 |
| LLM repair | 对已定位的语义或结构缺口生成 patch | 不应默认返回完整新产物或无限重试 |

### 3.4 Operation 清单

| Operation | 当前路径与模型 | thinking | timeout/retry | validator/repair | 主要风险 |
|---|---|---|---|---|---|
| topic candidate builder/repair | structured profile，`glm-4`，普通 JSON | 未显式发送 | 全局 240s/3 attempts | Zod、后处理、去重；缺字段可再调 repair，候选不足可再调 builder | 8 个 Candidate Card 输出较长，多次补齐可能放大总等待 |
| topic selector | structured profile，`glm-4`，strict tool call | 显式 disabled | 全局 240s/3 attempts | 自定义 parse；特定错误回退普通 JSON | 当前 `tool_choice=auto`；旧 probe 合同已过时 |
| script writer | main profile，`glm-5.1`，普通 JSON | 未显式发送 | 全局 240s/3 attempts | 归一化、Zod、本地 validator；显式用户 regen | 长正文与 trace 字段同返；质量高价值，不能简单换弱模型或截断 |
| semantic reviewer | structured profile，`glm-4`，普通 JSON | 未显式发送 | 全局 240s/3 attempts | 失败时 skipped；shadow-only | 当前串行处于用户等待路径，失败前仍会消耗 retry 时间 |
| storyboard planner | main profile，`glm-5.1`，普通 JSON | 未显式发送 | 全局 240s/3 attempts | Zod、本地 validator；特定结果会完整 regen 一次 | 完整 script 输入和多 segment 长输出；现有 trace 计时不真实 |
| storyboard segment regen | main profile，`glm-5.1`，普通 JSON | 未显式发送 | 全局 240s/3 attempts | 合并锁定字段后 Zod | 仍携带完整 plan 上下文，但只修一个 segment |
| asset planning global/chunks | main profile，`glm-5.1`，普通 JSON | 未显式发送 | 全局 240s/3 attempts；chunk 有界并发 | Zod、本地 validator；chunk 已有 compact patch；必要时全量 regen | 多 chunk、repair 和 full regen 叠加；生产诊断未汇总完整链路 |
| asset prompt optimizer / image-to-video prompt | structured profile，`glm-4`，普通 JSON | 未显式发送 | 全局 240s/3 attempts | 局部 fallback | 独立调用缺少完整计时；fallback 可能掩盖 provider 延迟 |
| publish cover/description/title/cover optimizer | structured profile，`glm-4`，普通 JSON | 未显式发送 | 全局 240s/3 attempts | 各自 fallback | generate 链路串行；未接 interaction log，失败前仍先经历 provider retry |

`topic.light-review` 和 `script.patch-lift` 虽在 prompt registry 中存在，但不是当前正式自动 operation，不纳入本轮性能基线。

### 3.5 当前运行证据

- 7 份已持久化 script graph trace 中，writer 约 46.5–106.5 秒，中位数约 64.5 秒；reviewer 约 2.1–9.5 秒；二者合计约 49.4–108.7 秒，中位数约 70.5 秒。这是机会样本，不是固定输入基线。
- 两次 asset planning live trace 的单调用约 91–124 秒；按时间戳和并发重建的整体时间约 3 分 46 秒与 4 分 50 秒。整体时间是推算值，不是现有日志直接记录值。
- DeepSeek V4 约 9 分 21 秒的记录只有一份完整链路单样本，不能把全部时间归因于 script、thinking 或模型本身。
- 2026-05-12 asset planning 首轮 946857ms、repair 724525ms 的记录是单样本，且后续 compact chunk repair 已改变当前实现，不能当成现状基线。
- 当前 5 份 topic selector 交互日志均返回 `rank_topic_candidates` tool call，并包含 raw usage；旧的 2026-05-08 probe 使用的是另一版 selected IDs 合同，只能证明历史能力。

## 4. 已确认原因与待验证假设

### 4.1 已由代码或运行记录确认

1. **超时会放大等待。**长生成 timeout 后会用相同输入、模型和参数原样重试，最坏可放大到约 12 分钟。
2. **长输出和多调用会累积。**script、storyboard 和 asset planning 都包含长 JSON；review、repair、chunk 和 full regeneration 会继续叠加调用。
3. **多个链路串行阻塞。**script 后的 shadow reviewer、publish 的多个辅助生成当前都处于串行路径。
4. **普通 JSON mode 不保证业务 schema。**模型完整返回后才进入 JSON/Zod/validator，结构失败时此前等待已经发生。
5. **当前接口不提供用户可见的流式结果。**完整响应返回前用户只能等待；当前无法测量 TTFT。
6. **观测不足。**普通路径缺失 usage、finish reason、attempt 和 effective options；topic/storyboard 有不真实或缺失计时；publish 没有 interaction log。

### 4.2 高置信但仍需验证

1. **旗舰模型默认 thinking 可能是主要延迟来源。**普通路径不发送 thinking；供应商对不同 GLM 版本的默认行为会变化。必须记录真实请求并用同输入 A/B，不能只根据文档推断。
2. **复杂 schema 的负担来自长数组、重复文本和跨字段一致性，而不只是字段数量。**需要用相同语义、不同结构策略对照。
3. **强制目标 tool call 可能提高首次结构通过率并减少 repair。**当前 `tool_choice=auto`，且当前路由是否完整支持指定 function/strict schema 尚未验证。
4. **供应商排队或服务波动可能占据部分耗时。**非流式当前只能看到总耗时，无法分离排队、prefill、reasoning 和正文生成。

### 4.3 尚不能声称

- 不能声称 GLM-5/GLM-5.2 一定比 GLM-4 慢或一定质量更高；必须在本项目固定样本上比较。
- 不能声称关闭 thinking 不损害 topic/script 质量。
- 不能声称 strict structured 一定更快；严格约束也可能增加模型生成负担。
- 不能声称 TTFT 已经可测。当前非流式接口只能测 request wall time。
- 不能在没有 usage 和价格快照时声称精确成本受控。

## 5. 目标设计

### 5.1 质量优先的 operation policy

模型版本、thinking 和结构化策略必须分开决策。使用旗舰模型不等于每个请求都使用最长 thinking。

| Operation 类型 | 模型原则 | thinking 原则 | retry 原则 |
|---|---|---|---|
| topic/script 等核心语义生成 | 优先 approved flagship | 以质量 A/B 决定，不能一刀切关闭 | 长生成 timeout 不做同参数原样自动重试 |
| selector、短 reviewer、publish 辅助生成 | 先验证 flagship non-thinking | 默认候选为显式 disabled | 只对网络、429、5xx 做有限重试 |
| storyboard/asset planning 长结构生成 | 优先保持语义能力 | 先测显式策略，再决定 | 保留已完成 chunk，只重试失败单元 |
| 局部 repair | 使用能够理解原语义的模型 | 通常不需要长 thinking | 最多一次目标 patch，不升级为无限 regen |

operation policy 只描述当前供应商内的 effective options，不负责多供应商路由，也不允许业务代码硬编码未来 GLM-5.3/GLM-6 名称。

### 5.2 同供应商模型升级

当前 `main` 与 `structured` profile 保留，但增加可核验的升级流程：

```text
配置候选模型
  -> 静态能力检查
  -> 最多 2 次显式 capability probe
  -> 3 个固定脱敏样本诊断
  -> 扩展正式质量/延迟基线
  -> 人工确认 approved model
  -> 切换配置
  -> 保留上一 approved model 回退
```

“无缝升级”是指业务 operation、prompt ID 和领域合同不因模型版本变化而修改；不是指新模型发布后自动进入生产。

### 5.3 Provider 观测合同

每次 invocation 至少记录：

- provider profile 和归一化 route 标识，不记录 API key；
- operation name、model、structured strategy；
- effective thinking、temperature、top_p、max tokens、timeout、max attempts；
- invocation started/finished 和总耗时；
- 每个 attempt 的开始、结束、耗时、结果、错误码和退避；
- prompt、completion、reasoning token（供应商未返回时明确为 unavailable）；
- finish reason；
- JSON parse 是否首次通过；
- 后续 Zod、业务 validator、deterministic repair、LLM patch、full regen 由 operation/harness 分层记录。

当前非流式接口不记录 TTFT。只有未来真正接入 SSE 并在收到第一块供应商数据时打点，才允许增加 TTFT。

### 5.4 Retry 语义

错误必须按原因处理：

- 网络中断、429、502/503/504：允许有限退避重试。
- 长生成 timeout：不自动执行相同模型、输入和参数的完整原样重试；保留人工重试或显式改变策略后的新 invocation。
- invalid JSON/schema：不进入网络 retry；优先 deterministic recovery 或最小 patch。
- content filter：使用现有明确安全改写路径，不伪装成普通网络重试。
- 局部 chunk 失败：只重试失败 chunk，并保留已完成结果。

具体 timeout 数值和 attempts 上限必须由 S2-0a 基线决定，本设计不预设硬阈值。

### 5.5 结构化与 repair

- 普通 JSON mode、tool call、Zod 和业务 validator 继续各司其职。
- 对必须返回 tool arguments 的 operation，provider capability probe 通过后才可把 `tool_choice` 改为指定目标 function。
- 不因为 tool call 成功就移除 Zod 或业务 validator。
- deterministic repair 只处理可以确定恢复的 JSON 包裹、格式或派生字段。
- 需要创作的缺失字段只能由 LLM 生成；repair 返回最小 patch。
- 本轮不改变 script/storyboard/asset planning 正式 schema。若基线证明长合同是主因，另开设计。

### 5.6 用户等待体验

S2-0 先提供可信阶段信息：

- 当前 operation；
- 当前是否在首次调用、retry、validation、repair 或 full regeneration；
- 已完成 chunk 数和总 chunk 数；
- 可取消状态与失败位置。

不得展示虚假百分比，不得把 request started 当作 first token，不得把未闭合或未校验 JSON 暴露为正式业务结果。是否引入 SSE/流式正文属于后续独立设计，不能用流式传输掩盖总耗时未下降。

## 6. 分阶段范围

### 6.1 S2-0a：观测与固定样本基线

包含：

- 统一普通与 strict provider 的 response metadata 和 attempt 记录。
- 记录 effective request options，修正 topic/storyboard 虚假计时并补 publish 关键日志。
- 统一稳定 operation name。
- 建立 3 个脱敏固定诊断样本，覆盖短、中、长或易 repair 场景。
- 输出当前生产近似配置的 per-operation 基线报告。
- 建立质量人工盲评表，不启用 reviewer 自动门禁。

不包含：

- 不改变模型、thinking、timeout、retry、prompt、schema 和主链路行为。
- 可以先贯通仅由诊断 harness 显式使用的普通调用 options，但所有生产 call site 保持不传入新参数。
- 不执行付费 live check；只有用户另行提供请求数和费用上限后才能显式启动。

### 6.2 S2-0a → S2-0b 闸门

进入行为优化前必须能回答：

1. 慢调用集中在哪些 operation？
2. 每个慢调用是否经历 timeout/retry/repair/full regen？
3. 当前 GLM-5 请求是否实际开启 thinking，reasoning usage 是否可得？
4. 输出 token 与总耗时是否相关？
5. 结构首次失败发生在 JSON、Zod 还是业务 validator？
6. 用户等待主要来自单调用、串行调用还是多次重生成？

### 6.3 S2-0b：低风险编排优化

允许：

- 为普通调用增加 operation-level thinking、max tokens、sampling、timeout、max attempts。
- 按错误类型控制 retry，阻止长生成 timeout 后的相同请求原样重试。
- 在 capability probe 通过的 operation 上强制目标 tool call。
- 让局部失败优先走一次最小 patch，而不是完整重生成。
- 对已确认无依赖的辅助调用评估并行或移出关键路径；semantic reviewer 仍为 shadow-only。
- 使用相同固定输入做前后质量与延迟对照。

不预先纳入：

- semantic reviewer 移出关键路径；只有基线证明收益且另行确认后才实施。
- publish 并行化；只有确认三个调用不存在顺序依赖后才实施。
- script/storyboard/asset planning 合同拆分。

### 6.4 独立后续任务

- script 模型输出瘦身和确定性字段装配。
- storyboard global plan + segment/chunk 分层。
- asset planning 更完整的断点恢复和 plan-level repair 改造。
- 流式/SSE 与前端细粒度进度。
- S2-1 多模型、多供应商 capability、routing、fallback 和 credential reference。
- S2-2 成本、预算与用户生成偏好。
- S2-3 Prompt Registry 治理。

## 7. 基线与验收

### 7.1 第一轮诊断样本

第一轮不是 10 个真实样本，而是 3 个固定脱敏样本：

- 一个 topic/selector 或短结构化样本；
- 一个典型 script 样本；
- 一个长输出或易触发 repair 的 storyboard/asset planning 样本。

目标是验证观测链路和找出主导因素。诊断稳定后再扩展到至少 10 个内容分布样本；10 个样本用于覆盖题材和合同差异，不足以宣称稳定 P95。

### 7.2 当前可测指标

- invocation 和 operation 总耗时；
- script writer/reviewer 现有 graph step 耗时；
- asset planning 部分 per-call 耗时；
- 部分 raw strict payload 中的 usage/finish reason；
- 最终 JSON/Zod/业务 validator 结果；
- 部分 repair/full regen 执行状态；
- 用户看到的整体同步等待或轮询阶段。

### 7.3 需要补能力的指标

- 每个 attempt 的耗时、错误和退避；
- 普通路径 usage、reasoning usage、finish reason；
- effective model/thinking/strategy/timeout/max attempts；
- JSON、Zod、业务 validator 首次通过率；
- deterministic repair、LLM patch、full regen 的统一计数；
- topic/storyboard/publish 的真实调用耗时；
- 用户取消、失败位置和阶段进度。

TTFT 当前不可测，不列入 S2-0a 基线硬指标。

### 7.4 内容质量验收

性能方案只有在质量不劣于基线时才可采用。

topic 人工验收至少观察：

- 角度是否闭环；
- 核心冲突和 stakes 是否具体；
- must-include beats 是否有叙事推进价值；
- 是否出现跨题材模板污染或事实边界风险。

script 人工验收至少观察：

- opening 是否立即建立危险、羞辱、选择、杀机或反常识局面；
- 场景密度和 beat 推进是否充足；
- 动作、对话、反应和压力升级是否具体；
- 是否适合自然口播；
- ending 是否有判断、代价和余震；
- 是否覆盖上游 Topic Package 且无模板污染。

semantic reviewer 结果只作为 shadow 量尺；最终比较使用固定 rubric 与人工盲评。不得用关键词或字符串启发式替代语义质量判断。

### 7.5 用户体验验收

- 等待信息与真实 operation 状态一致。
- timeout/retry/repair 不再只显示笼统“生成中”。
- 取消后不得继续无界消耗请求预算。
- 不在没有基线时预设全局硬耗时阈值；基线后分别定义 operation 目标和整体用户等待目标。

## 8. 真实 Provider 诊断边界

S2-0a 的自动化测试和文档工作不执行付费调用。首次真实诊断必须显式启动：

- 默认 live 请求预算为 0。
- 用户明确提供人民币费用上限、最大请求数和目标候选模型。
- 首轮最多 3 个脱敏样本：当前基线 3 次、候选策略 3 次。
- 最多增加 2 次 capability probe，总请求上限 8。
- 每个诊断 invocation 设置 `maxAttempts=1`，防止付费重试放大。
- 不上传账号、邮箱、登录信息、API key、真实项目名或未脱敏私人内容。
- raw 输出保存在 gitignored runtime output，不 stage、不提交。
- 没有 usage/价格快照时只执行请求数硬上限，不声称精确费用已被程序控制。
- 正式扩大到 10 个以上样本前，必须先复核 3 样本诊断结果。

真正的多供应商 A/B 推迟到 S2-1；S2-0 只比较当前供应商内的现状配置、候选旗舰模型和 operation 参数。

## 9. 与 S2-1 的边界

S2-0 必须先完成：

- 稳定 operation name；
- effective request/attempt/usage/error/timing 合同；
- 当前供应商固定样本基线；
- retry 语义边界；
- 同供应商候选模型的验收和回退流程；
- 基线支持的低风险 operation 参数优化。

S2-1 再实现：

- provider capability matrix 与 adapter；
- 多供应商 routing/fallback；
- provider/model/run snapshot/credential reference；
- 用户可选模型或供应商；
- 跨供应商成本与额度策略。

## 10. 风险与防护

| 风险 | 防护 |
|---|---|
| 关闭 thinking 后叙事质量下降 | 同输入盲评；核心语义 operation 不默认关闭 |
| strict schema 让语义字段变薄 | 结构通过与人工内容质量双验收 |
| timeout 缩短但失败率上升 | S2-0a 后再定数值；区分 timeout 与瞬时网络错误 |
| 并行化造成上下文或风格漂移 | 只并行确认无依赖的辅助调用 |
| 为减少字段破坏下游合同 | 本轮不改正式 schema；合同瘦身另行设计 |
| 新旗舰模型 API 行为变化 | capability probe、固定样本回归和旧模型回退 |
| 日志泄露输入或凭据 | route 归一化、禁止 API key、脱敏样本、raw 输出不提交 |
| 只看 JSON 成功率误判优化成功 | validator 与人工语义质量同时验收 |

## 11. 已确认设计决策

1. S2-0 不止建立观测；S2-0a 后必须进入有证据支持的低风险编排优化。
2. 内容质量优先，速度优化不能以长期使用弱模型或降低 topic/script 质量为代价。
3. GLM-4 保留为当前基线和回退，不作为目标架构默认答案。
4. 当前供应商内的模型配置化升级和回退属于 S2-0；多供应商抽象属于 S2-1。
5. 第一轮使用 3 个诊断样本，稳定后再扩展；不把 10 个样本当成首次启动门槛。
6. semantic reviewer 保持 shadow-only。
7. script 输出瘦身、storyboard 分层和 asset planning 深度改造分别另开任务。
8. 所有付费 live check 都保持显式 opt-in，并由用户提供请求数与费用边界。

## 12. 参考入口

当前代码：

- `backend/src/runtime/llm/openai-compatible-provider.ts`
- `backend/src/runtime/llm/provider-contract.ts`
- `backend/src/runtime/llm/llm-gateway.ts`
- `backend/src/runtime/llm/external-errors.ts`
- `backend/src/runtime/llm/interaction-log.ts`
- `backend/src/config/env.ts`
- `backend/src/modules/topic/topic-recommendation.service.ts`
- `backend/src/modules/script/script-generation.service.ts`
- `backend/src/modules/script/script-semantic-review.service.ts`
- `backend/src/modules/storyboard/storyboard-generation.service.ts`
- `backend/src/modules/asset-planning/asset-planning-generation.service.ts`
- `backend/src/modules/asset-planning/asset-planning-run.service.ts`
- `backend/src/modules/publish/cover.service.ts`
- `backend/src/modules/publish/description-generator.service.ts`
- `backend/src/modules/publish/title-generator.service.ts`

历史记录（只作证据，不作当前真相源）：

- `docs/records/2026-05-08-strict-structured-provider-topic-selector-probe.md`
- `docs/records/2026-05-08-deepseek-v4-script-writer-prompt-replay.md`
- `docs/plans/2026-05-12-asset-planning-repair-stability-and-first-pass-plan.md`

当前规范：

- `AGENTS.md`
- `docs/README.md`
- `docs/plans/README.md`
- `docs/todos/roadmap-todo.md`
- `harness/README.md`
- `harness/docs/prompt-registry-spec.md`
