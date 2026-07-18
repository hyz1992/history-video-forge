# Trae S2-0b 第一批启动提示词

> 使用方式：在 Trae 新窗口中要求其完整阅读并执行本文件。不要只复制其中一部分。

请严格按照仓库根目录 `AGENTS.md` 的工作契约执行本任务。

## 任务

启动 S2-0b 第一批代码级编排优化，执行正式 implementation plan 中：

1. Task 8：建立单供应商 operation policy；
2. Task 9：区分 timeout 与瞬时错误 retry；
3. 完成 Task 10 的静态可行性检查和下一轮控制变量实验方案，但本轮不得把未经 live 验证的 thinking、max tokens 或指定 tool_choice 策略接入生产调用。

本轮是正式代码实施，不是重新设计 S2-0，也不是进入 S2-1。

## 开始前必须输出

- 任务
- 目标
- 本次改动文件
- 不改什么
- 验证方式

## 必读材料

按顺序阅读：

1. `AGENTS.md`
2. `docs/README.md`
3. `docs/plans/README.md`
4. `docs/todos/roadmap-todo.md`
5. `docs/plans/2026-07-14-llm-structured-output-latency-optimization-design.md`
6. `docs/plans/2026-07-14-llm-structured-output-latency-optimization-implementation-plan.md`
7. `harness/README.md`
8. `harness/docs/s2-0-baseline-protocol.md`
9. S2-0a 首轮真实报告：`harness/scripts/runtime/output/llm-s2-baseline/2026-07-15T173935/baseline-report.json`
10. 同目录下 7 份 interaction markdown
11. 当前 provider、gateway、env、external error、retry、interaction log 和相关测试

实施时使用 `superpowers:executing-plans`，严格执行 TDD：先写失败测试并确认失败，再做最小实现。

不要启动 subagent，除非用户另行明确授权。

## 已确认的 S2-0a 基线事实

不得重新猜测或改写以下事实：

- current：main=`glm-5.1`，structured=`glm-4`
- candidate：`glm-5.2`
- 共执行 7 次真实请求，其中 capability probe 1 次
- 7 次调用均只有 1 个 attempt
- 没有发生 timeout、retry、repair 或 full regen
- 非流式接口下 TTFT 不可观测
- cost enforcement 不可用，不得声称程序精确控制了费用
- 所有 GLM-5.1/5.2 请求均记录为 `thinking=provider_default`
- GLM-5.1/5.2 返回 reasoning tokens，说明 provider default 下实际发生了 reasoning
- GLM-4 topic selector：
  - 7547ms
  - completion 222
  - 首次通过
- GLM-5.2 topic selector：
  - 46443ms
  - completion 1833
  - reasoning 1498
  - tool call 成功，但遗漏必需的 `risk_summary`，业务解析失败
- GLM-5.1 script：
  - 60804ms
  - completion 3151
  - reasoning 2312
  - Zod、本地 validator 首次通过
- GLM-5.2 script：
  - 132110ms
  - completion 5413
  - reasoning 4482
  - 结构通过，但人工复核未证明内容质量全面优于 GLM-5.1
- GLM-5.1 storyboard：
  - 66880ms
  - completion 4052
  - reasoning 2517
  - JSON 合法，但多包一层 `StoryboardPlan`，Zod 首次失败
- GLM-5.2 storyboard：
  - 175280ms
  - completion 8512
  - reasoning 6125
  - Zod、本地 validator 首次通过
- current 三样本总耗时 135231ms
- candidate 三样本总耗时 353833ms，约为 current 的 2.62 倍

这些结果只属于 3 个固定诊断样本，不得声称稳定 P95。

## 本轮实施范围

### Task A：建立 operation policy

按照 implementation plan Task 8 实施。

至少定义明确的 operation class：

- `core_semantic_generation`
- `long_structured_generation`
- `short_structured_decision`
- `shadow_review`
- `targeted_repair`

要求：

1. operation name 必须显式映射，不能用字符串包含关系猜测语义。
2. 未知 operation 使用保守默认并记录 warning。
3. 优先级必须是：

   `invocation options > operation policy > profile/env defaults > provider default`

4. policy 不包含 provider routing。
5. policy 不硬编码 `glm-5.2`、未来模型名或供应商名。
6. 模型仍由现有环境配置选择。
7. 增加 redacted 配置快照，但不得输出 API key 或完整 base URL。
8. 本 Task 不得擅自写入具体 thinking、timeout 或 max tokens 默认值；没有受控实验支持的参数保持原行为。

Task A 必须独立测试、独立中文提交：

`建立LLM操作策略与配置快照`

### Task B：优化 retry 语义

按照 implementation plan Task 9 实施。

要求：

1. `core_semantic_generation` 和 `long_structured_generation` 遇到 timeout 时只执行一次 attempt，不得用相同输入、模型和参数完整重试。
2. 429、明确的瞬时网络错误和 503 仍允许在 policy 上限内有限 retry。
3. 400、401、JSON/schema invalid、业务 validator failure 不得进入网络 retry。
4. 保持 `classifyExternalError()` 负责分类，operation policy 决定是否 retry。
5. retry observer 只负责记录，不得反向改变 provider 行为。
6. timeout 提示不得声称已经自动重试，除非 attempt log 证明发生过。
7. 不允许通过继续增加全局 timeout 掩盖问题。

Task B 必须独立测试、独立中文提交：

`阻止长生成超时后的原样重试`

### Task C：Task 10 前置核查，不落地未经批准的生产参数

完成以下调查并写入执行报告，不要为了交报告新增正式文档：

1. 当前 provider 如何序列化：
   - `thinking=enabled`
   - `thinking=disabled`
   - 指定目标 function 的 `tool_choice`
2. 当前通用智谱 API 路由是否已有代码或历史 live record 证明接受指定目标 function。
3. 哪些 operation 可以通过现有 options 在 harness 中做控制变量，不修改 prompt/schema。
4. 提出下一轮最小 live 实验矩阵，建议不超过 6 次请求，至少区分：
   - GLM-5.2 topic selector：provider default 与 thinking disabled；
   - GLM-5.2 指定目标 tool_choice 的 capability probe；
   - GLM-5.2 script：provider default 与 thinking disabled；
   - 如预算允许，再测试 storyboard thinking disabled。
5. 明确每个实验的质量回退条件。

不得因为普通 capability probe 成功，就声称供应商已经证明支持“指定目标 function”。现有 probe 使用的是当前真实路径，必须核对它是否仍为 `tool_choice=auto`。

Task C 本轮只输出建议，不提交生产行为改动。

## 明确禁止

- 不执行任何新的付费 live check。
- 不直接把生产模型切换为 GLM-5.2。
- 不修改 prompt。
- 不修改 shared schema 或 API。
- 不修改 frontend。
- 不引入多供应商抽象、用户模型偏好、credential reference 或成本系统。
- 不用关键词或字符串规则冒充语义质量判断。
- 不把 semantic reviewer 从 shadow-only 升级为门禁。
- 不顺手实施 script 瘦身、storyboard 分层、asset repair 重构。
- 不提交 baseline raw output。
- 不 stage `storage/topic-candidate-library/**` 或其他无关生成态文件。
- 不修复与 Task 8/9 无关的问题。
- 当前 npm 11.5.1 可能吞掉 `npm run ... -- --参数` 的参数名；如需运行 baseline dry-run，使用直接入口：`npx tsx harness/scripts/runtime/llm-s2-baseline.ts ...`。本轮不要顺手重构 CLI。

## 最小验证

Task A：

```powershell
npx vitest run --configLoader runner tests/backend/runtime/llm-operation-policy.test.ts tests/backend/runtime/env-loading.test.ts --no-file-parallelism
```

Task B：

```powershell
npx vitest run --configLoader runner tests/backend/runtime/provider-hardening.test.ts tests/backend/runtime/llm-operation-policy.test.ts --no-file-parallelism
```

完成后回归：

```powershell
npx vitest run --configLoader runner tests/backend/runtime/provider-hardening.test.ts tests/backend/runtime/env-loading.test.ts tests/backend/runtime/prompt-runtime.test.ts tests/backend/runtime/llm-operation-policy.test.ts harness/scripts/runtime/llm-s2-baseline.test.ts harness/scripts/runtime/llm-s2-baseline-stub.test.ts --no-file-parallelism
npm run typecheck:backend
git diff --check
git status --short
```

另外必须检查：

- `prompts/**` 无 diff
- `shared/src/**` 无 diff
- API/frontend 无 diff
- baseline raw output 未进入 Git
- 每个提交只包含对应 Task 的文件

## 完成时输出

- 实际改动
- 验证结果
- 原始验收清单逐项状态：已修 / 部分修 / 未修 / 未验证
- 自审结论
- 剩余风险
- Task 10 最小 live 实验矩阵
- 下一步建议
- 提交 hash

## 停止条件

完成 Task A 和 Task B 的两个独立中文提交，并给出 Task C 调查结果后立即停止。

不得自动执行 Task 10 的生产参数落地。
不得执行付费 live。
不得进入 S2-1。

等待用户和 Codex 审查本轮结果后，再决定下一轮 GLM-5.2 控制变量 live 与 Task 10。
