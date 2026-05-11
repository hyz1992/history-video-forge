# Asset Planning Chunk Concurrency Design

日期：2026-05-11

状态：设计草案，等待 implementation plan 执行

## 任务

优化 asset planning 生成阶段的 segment chunk 调用速度。

当前 asset planning 已经不是让 LLM 一次性生成完整 `AssetPlan`：它先生成全局 `ProjectArtBible`，再把 storyboard segments 分块生成视觉 / SFX / BGM 草稿，最后由本地 merger 合成完整 `AssetPlan`。

问题在于当前 chunk 调用仍是串行执行：

```text
global -> chunk 1 -> chunk 2 -> chunk 3 -> chunk 4 -> merge
```

本设计将其改为有限并发：

```text
global -> chunk 1 + chunk 2 并发 -> chunk 3 + chunk 4 并发 -> merge
```

## 稳定性优先原则

本优化不是为了最大化并发，而是在稳定性和速度之间取保守收益。

- `global` 规划必须保持串行先执行，因为所有 chunk 都依赖 `ProjectArtBible`、视觉预算和全局音频策略。
- chunk 之间不得共享局部 ID，不得引用其他 chunk 的局部任务。
- chunk 可以并发生成，但最终合并必须按原 storyboard chunk 顺序进行。
- 默认并发数使用 `2`，不做全并发，降低 provider 429、超时和上下文压力。
- 任一 chunk 失败时，整个 asset planning run 失败，不静默丢弃 chunk，不返回部分 `AssetPlan`。
- 不改变 retry 语义。现有 provider 层如果支持重试，继续由 provider 层负责；本层不新增额外重试风暴。
- 不改变 prompt、schema、API 或 validator 语义。

## 设计方案

### 入口参数

`GenerateAssetPlanInput` 新增可选参数：

```ts
chunkConcurrency?: number;
```

规则：

- 未传时默认 `2`。
- 小于 `1` 时按 `1` 处理。
- 大于 `3` 时按 `3` 处理。
- `1` 等价于现有串行行为，作为保守回退路径。

第一版不暴露 API 参数，不把并发数交给前端或用户配置。真实运行需要更高并发时，后续再单独设计环境变量或运行配置。

### 并发池

在 `asset-planning-generation.service.ts` 内部增加一个小型本地 helper，例如：

```ts
async function mapWithConcurrency<TInput, TOutput>(
  items: TInput[],
  concurrency: number,
  worker: (item: TInput, index: number) => Promise<TOutput>,
): Promise<TOutput[]>
```

要求：

- 最多同时运行 `concurrency` 个 worker。
- 返回数组顺序必须与输入数组顺序一致。
- 任一 worker reject 时，整体 reject。
- 不吞错误、不包装成与原错误无关的新错误。
- 不引入第三方依赖。

### 数据流

生成流程保持原边界：

1. 本地生成 TTS / subtitle skeleton。
2. 串行调用 global prompt，得到 `GlobalPlanningDraft`。
3. 将 storyboard segments 切成 chunks。
4. 用 `mapWithConcurrency` 并发调用 chunk prompt。
5. 每个 chunk 仍执行：
   - `rejectForbiddenChunkTasks`
   - `SegmentChunkPlanningDraft.parse`
   - `validateChunkDraft`
6. 所有 chunk draft 返回后，按原 chunk 顺序传给 `mergeAssetPlan`。
7. 本地 merger 分配全局 task id、重写依赖、计算 cost summary。
8. `AssetPlan.parse` 做最终结构校验。

### 错误处理

并发优化不改变错误语义：

- global 调用失败：直接失败，不启动 chunks。
- 某个 chunk 调用失败：整个 run 失败。
- 某个 chunk parse / validate 失败：整个 run 失败。
- 已经开始的其他 chunk 可能会自然完成，但结果不会合成或激活。
- run service 后续仍负责 stale source guard；本优化不改变激活保护。

### 顺序稳定

必须保持以下稳定性：

- chunk prompt 的输入 `chunk_id` 仍由原 index 生成，如 `chunk_001`、`chunk_002`。
- `chunkDrafts` 传入 `mergeAssetPlan` 的顺序仍与 storyboard 顺序一致。
- 全局 `task_id` 和 `order` 仍由 merger 按稳定顺序分配。
- 同一组 LLM 输出在并发前后应得到同样顺序的 `AssetPlan.tasks`。

### 不做范围

- 不改 prompt。
- 不改 shared schema。
- 不改 API 形态。
- 不引入队列、后台任务或取消机制。
- 不新增 provider 配置。
- 不做真实 assets / compose。
- 不跑完整五轮真实巡检作为本任务默认验收。

## 测试策略

第一版只做确定性单元测试，不依赖真实 LLM。

需要覆盖：

- 默认并发下，第二个 chunk 可以在第一个 chunk 未 resolve 前启动。
- `chunkConcurrency: 1` 时保持串行。
- 即使 chunk resolve 顺序乱序，最终 `AssetPlan.tasks` 仍按 chunk 顺序稳定合并。
- chunk worker 抛错时，`generateAssetPlan` reject，且不返回部分计划。

## 风险

- 并发会增加 provider 同时请求数，默认值必须保守。
- 如果 provider 端存在隐性速率限制，并发 `2` 仍可能比串行更容易触发 429。已有 provider retry 逻辑应继续负责这一层。
- 如果未来 interaction log writer 需要严格全局顺序，并发会导致日志写入完成顺序不等于 chunk 顺序。当前日志文件以写入 sequence 命名，适合记录真实完成顺序；review 时仍以输出 plan 为准。

