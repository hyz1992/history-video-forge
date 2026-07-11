# V2 数据基础 Task 8.5-1 测试矩阵记录

日期：2026-07-11

## 1. 结论

此前“全量 Vitest 在约 124 秒后无结论”已经定位：主要原因是外部命令运行上限小于真实套件耗时，不是测试跑完后 Node 进程无法退出。

提高命令上限后，完整串行套件在约 372.9 秒内正常退出并写出 JSON 报告：

- 测试文件：187
- 测试项：1031
- 通过：987
- 失败：44
- pending：0
- 退出码：1（存在既有失败）

Task 8.5-1 没有修改业务行为，也没有把既有失败改写为通过。

## 2. 测试入口修复

### 2.1 Prisma CLI 测试异常耗时

`prisma-toolchain.test.ts` 原来在 Windows Vitest worker 中通过 `shell + npm exec` 再启动 Prisma，曾耗时约 31 秒并触发默认 5 秒超时；相同命令在 shell 外只需约 1.7 秒。

修复后测试直接使用当前 Node 可执行文件运行仓库本地 `node_modules/prisma/build/index.js`，不再经过 shell/npm workspace 二次启动：

- 单文件耗时约 1.44 秒。
- 其中 Prisma validate 本身约 1.20 秒。
- 单文件 1/1 通过。

### 2.2 测试发现范围遗漏

最初按 `tests/` 扫描只能发现 183 个文件，会漏掉 Vitest 实际自动发现的 4 个文件、20 项测试：

- `harness/scripts/check-prompt-language.test.ts`
- `harness/scripts/check-schema-doc-drift.test.ts`
- `harness/scripts/runtime/run-topic-to-script-sample.test.ts`
- `renderer/src/audio-rendering.test.ts`

正式分组脚本改为从仓库根目录发现测试，并排除 `node_modules/dist/generated/storage/temp` 等非源码目录。当前 187 个文件全部且仅归属一个分组；出现未归类或重复归类时脚本直接失败。

## 3. 互斥分组矩阵

| 分组 | 文件 | 测试项 | 通过 | 失败 | 实测耗时 | 结果 |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| backend-core | 43 | 277 | 271 | 6 | 约 58 秒 | 既有失败 |
| backend-topic-script | 22 | 136 | 103 | 33 | 约 112 秒 | 既有/此前未完整枚举失败 |
| backend-video-pipeline | 56 | 351 | 349 | 2 | 约 77 秒 | 既有失败 |
| frontend | 16 | 72 | 72 | 0 | 约 39 秒 | 通过 |
| harness | 40 | 135 | 132 | 3 | 约 171 秒（原 37 文件分组） | 既有失败 |
| supporting | 10 | 60 | 60 | 0 | 约 3.4 秒 | 通过 |

说明：harness 首次分组实测为 37 文件/119 项/116 通过/3 失败；补齐 3 个仓库外层 harness 测试后，完整全量报告证明新增 16 项全部通过。supporting 补齐 `renderer/src` 测试后已重新执行，60/60 通过。

## 4. 全量串行复验

命令：

```powershell
npx vitest run --configLoader runner --no-file-parallelism --reporter=json --outputFile=.codex-run-logs/test-partitions/full-suite-2026-07-11.json
```

结果：约 372.9 秒后正常退出，187 文件、1031 项、987 通过、44 失败。没有观察到“测试已经完成但进程因 server/timer/Prisma client 未释放而不退出”。

主要长耗时文件：

| 文件 | 单分组耗时 |
| --- | ---: |
| `tests/harness/render-runtime-smoke.test.ts` | 约 134 秒 |
| `tests/backend/topic/topic-runtime-recommendation.test.ts` | 约 102 秒 |
| `tests/backend/render/local-remotion-render-adapter.test.ts` | 约 43 秒 |

这三个文件的累计时间已经明显超过旧的 124 秒外部上限。

## 5. 失败清单

### `tests/backend/api/assets-api.test.ts`（2）

- `assets generate api creates, validates, persists, and activates a manifest from active asset plan`
- `assets generate api passes DashScope image-to-video config from API payload to assets execution`

### `tests/backend/assets/assets-run-service.test.ts`（1）

- `assets run service integration uses normalized TTS chunks for execution without mutating the stored asset plan`

### `tests/backend/assets/fake-image-provider.test.ts`（1）

- `fake image provider (via execution engine) produces an image artifact and updates segment route`

### `tests/backend/runtime/prompt-runtime.test.ts`（2）

- `prompt runtime invokes script.semantic-reviewer through the prompt registry and llm gateway`
- `prompt runtime uses the openai-compatible provider through the unified prompt contract`

### `tests/backend/runtime/topic-prompt-contract.test.ts`（2）

- `topic prompt contract requires candidate-builder to define a strict structured output contract`
- `topic prompt contract requires topic.selector to return a complete ranked candidate scorecard`

### `tests/backend/script/script-runtime-generate.test.ts`（3）

- `script runtime generate sends ScriptInputBundle into the formal script-writer prompt and returns a ScriptDraftPackage`
- `script runtime generate passes regen context into the script-writer prompt input without changing the bundle`
- `script runtime generate passes a complete llm interaction entry to the script writer logger`

### `tests/backend/topic/topic-graph-recommendation.test.ts`（1）

- `topic recommendation graph returns explicit diagnostics when a single repair pass still cannot fill all three candidate slots`

### `tests/backend/topic/topic-runtime-recommendation.test.ts`（29）

- `topic runtime recommendation persists raw, selector pool, and final selected candidates into the topic candidate library`
- `topic runtime recommendation only reads same family/profile fallback_ready candidates into selector pool`
- `topic runtime recommendation drives candidate generation through the formal prompt registry and caches runtime fields`
- `topic runtime recommendation keeps raw recommendation pool larger than final delivery size`
- `topic runtime recommendation exposes candidate preview trace across raw selector pool and final choices`
- `topic runtime recommendation triggers topic.candidate-builder-repair when builder omits required TopicCandidateCard fields`
- `topic runtime recommendation keeps serving fallback candidates and marks diagnostics degraded when builder repair still leaves required fields missing`
- `topic runtime recommendation performs a single repair call when the first runtime response contains fewer than three candidates`
- `topic runtime recommendation returns explicit diagnostics when the repair call still cannot fill all three slots`
- `topic runtime recommendation only keeps one entry per normalized event identity in the selector pool`
- `topic runtime recommendation keeps multiple same-event candidates when a single-event seed only varies the angle`
- `topic runtime recommendation keeps same-event duplicate angle diagnostics readable`
- `topic runtime recommendation applies fatigue when the same explicit event_identity appears in recent history`
- `topic runtime recommendation asks topic.selector to choose final candidates from the selector pool`
- `topic runtime recommendation uses strict structured invocation for topic.selector when the gateway supports it`
- `topic runtime recommendation rejects strict topic.selector output that wraps ranked_candidates under answer`
- `topic runtime recommendation falls back to regular structured selector output when strict tool-call arguments are malformed`
- `topic runtime recommendation accepts ranked selector outputs returned through the common answer field`
- `topic runtime recommendation accepts selector outputs returned through ranked_candidates`
- `topic runtime recommendation rejects selector outputs that reference unknown candidate ids`
- `topic runtime recommendation uses the complete selector ranking as a deterministic backfill queue when ranked ids repeat`
- `topic runtime recommendation uses project round history for fatigue even after candidate cache is cleared`
- `topic runtime recommendation sends recent_event_memory to topic.selector`
- `topic runtime recommendation sends recent_event_memory to topic.candidate-builder on later rounds`
- `topic runtime recommendation records selector recent event memory in llm interaction trace`
- `topic runtime recommendation records builder recent event memory in llm interaction trace`
- `topic runtime recommendation preserves prior selected title and angle in builder recent_event_memory for identity reuse`
- `topic runtime recommendation accepts ranked selector outputs returned through answer.ranked_candidates`
- `topic runtime recommendation repairs hybrid builder candidates that expose one_line_angle before the full TopicCandidateCard contract`

### `tests/harness/render-runtime-smoke.test.ts`（2）

- `render runtime smoke harness can run runtime smoke with DashScope TTS and local fake visuals`
- `render runtime smoke harness runs the Remotion adapter smoke path and writes an MP4 output`

### `tests/harness/script-brief-shadow-stopped.test.ts`（1）

- `script brief shadow stopped state keeps the stop conclusion visible in planning and observation records`

## 6. 失败归类

- 10 项属于实施前记录已经明确列出名称的 assets、prompt runtime、topic prompt、script runtime 失败。
- 1 项 `fake-image-provider` 是实施前终端输出被截断而未取得名称的剩余 assets 失败，本次已精确补齐。
- 30 项 topic 失败此前被标为“未独立跑完”；近期 V2 数据提交没有修改对应 topic 业务/测试文件，主要表现为候选目标数从 3 变 4、selector/repair 语义和 LLM 调用合同旧断言。
- 3 项 harness 失败此前未独立汇总：两项 render smoke 断言漂移；一项仍读取已迁入 archive 的历史设计文档路径。
- 上述分类说明它们不是 Task 8.5-1 测试入口改动引入，但不等于这些失败可以永久忽略；后续受影响任务必须选择相关分组作为回归基线。

## 7. 可重复入口

```powershell
# 检查测试文件是否全部且仅归属一组
node scripts/test-partitions.mjs --list

# 跑全部分组；某组失败后仍继续其余组，最终返回非零
npm run test:partitions

# 只跑一个分组
node scripts/test-partitions.mjs --partition=backend-core
```

机器可读 JSON 结果写入 `.codex-run-logs/test-partitions/`，该目录不进入 Git。

## 8. 后续判定规则

1. Task 8.5 后续每个任务至少运行自身聚焦测试及相关 partition。
2. 当前全量基线为 44 项失败；新增失败必须修复，旧失败若受改动影响也必须重新判断，不能机械豁免。
3. 只有 187 文件和 1031 项均被纳入，才能声称执行了当前完整测试矩阵。
4. 全量命令需预留至少 8 分钟；124 秒只适合部分分组，不再作为全量运行上限。
