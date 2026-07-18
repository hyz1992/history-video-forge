# S2-1 Task 8 Selector Thinking 决策记录

日期：2026-07-18

## 验证目标

在 S2-1 改造后的 tier-aware-provider 链路上，针对新接入的 DeepSeek 与智谱组合，对 `topic.selector` 跑 thinking A/B 与跨 tier 对比，决定 S2-1 后该 operation 的 thinking 策略。

本验证不复跑 S2-0 阶段的 `harness/scripts/runtime/topic-selector-semantic-replay.ts`（其 `validateLiveInput` 硬编码 `model === "glm-5.2"` 且 `createTopicSelectorSemanticReplayLiveRunner` 直接构造 `createOpenAiCompatibleProvider`，绕过 S2-1 tier 路由），而是另写一次性 S2-1 专用脚本，走完整的 `createTierAwareProviderFromEnv` 链路。

## 实测配置

- smart tier：`deepseek:deepseek-v4-pro`（baseUrl=`https://api.deepseek.com`）
- flash tier：`zhipu:glm-4`（baseUrl=`https://open.bigmodel.cn/api/paas/v4`）
- 调用路径：S2-1 `createTierAwareProviderFromEnv` → `invokeStrictStructured`，`strategy=tool_call`、`toolChoice=target_function`
- fixture：S2-0 Task 17 留下的 `task17-high-tension.fixture.json` 与 `task17-balanced.fixture.json`，每份含 1 个 RISK 正例与 1 个 NONE 对照
- 总请求预算：3 轮共 8 次（A/B 4 次 + 扩大样本 4 次 + glm-4 flash 对比 2 次，扣除 DeepSeek thinking=enabled 被 API 拒绝的 2 次不计入有效）

## 三组对比数据

### 组 1：DeepSeek smart tier × thinking=enabled（2 次）

| fixture | 耗时 | 结果 |
|---|---|---|
| task17-high-tension | 134ms | ❌ 400 `Thinking mode does not support this tool_call` |
| task17-balanced | 191ms | ❌ 400 同上 |

**DeepSeek API 在 strict structured（tool_call）路径下不支持 thinking 参数**，请求在到达模型前被 API 网关拒绝。

### 组 2：DeepSeek smart tier × thinking=disabled（4 次有效 / 6 次总）

| 轮次 | fixture | 耗时 | completion | 召回 | 备注 |
|---|---|---:|---:|---|---|
| A/B 1 | high-tension | 21.1s | 1308 | 1/1（enum 偏） | `risk_recalled_enum_differed` |
| A/B 1 | balanced | 26.1s | 1689 | — | ❌ JSON 在 3771 位置失败 |
| 扩大 1 | high-tension r1 | 14.6s | 1057 | 0/1 | `risk_missed` |
| 扩大 1 | high-tension r2 | 17.2s | 1197 | 1/1（enum 偏） | `risk_recalled_enum_differed` |
| 扩大 1 | balanced r1 | 15.3s | 1110 | — | ❌ JSON 在 2637 位置失败 |
| 扩大 1 | balanced r2 | 15.3s | 1226 | 0/1 | `risk_missed` |

- 风险召回：2/4 有效样本 = **50%**（design §6.1 期望 ≥ 1/2，刚好达到下限）
- enum 精确匹配：0/4 = 0%（全部 `risk_recalled_enum_differed` 或 `risk_missed`）
- JSON 解析失败率：2/6 = **33%**（两次失败都在 `task17-balanced`，疑似 fixture 特定触发）
- NONE 对照：4/4 = 100%
- 平均耗时：约 17s；平均 completion：约 1160 tokens

### 组 3：智谱 glm-4 flash tier × thinking=disabled（2 次）

| fixture | 耗时 | completion | 召回 | NONE 对照 |
|---|---|---:|---|---|
| task17-high-tension | 15.9s | 706 | 0/1（`risk_missed`） | 1/1 |
| task17-balanced | 14.8s | 808 | 0/1（`risk_missed`） | 1/1 |

- 风险召回：0/2 = **0%**
- JSON 解析失败率：0/2 = 0%
- 平均耗时：约 15s；平均 completion：约 757 tokens

**与 S2-0 阶段 GLM-4 flash selector 表现完全一致**，验证 design §4.2 / §8 R5 强制 selector 走 smart tier 的判断。

## 决策

依据 design §6.2 决策矩阵触发路径 C「thinking on 仍慢到不可接受 → 评估换模型」的变体——**DeepSeek 上 thinking on 在 strict structured 路径根本不可用**（API 不支持 thinking+tool_call 组合）。

综合三组数据，S2-1 selector 决策如下：

1. **维持 `topic.selector` 当前 operation policy**（不登记 thinking override，落 provider default）。S2-1 不调整 `operation-tier-registry.ts` 与 `operation-policy.ts`。
2. **维持 `topic.selector` 在 OPERATION_TIER_REGISTRY 强制 smart tier**（不切 flash）。本验证组 3 再次确认 flash tier 在 selector 上召回 0/2，与 S2-0 实测一致。
3. **DeepSeek thinking=disabled 作为生产路径**：召回 50% 刚好达到 design §6.1 下限，耗时 17s 远低于 S2-0 GLM-5.2 thinking=enabled 的 212s（中位数）。这是 S2-1 在"换 provider 解决 reasoning 长尾"目标下能拿到的最优组合。

## 已知风险

登记后续观察项，不在 S2-1 范围内修复：

1. **DeepSeek 长输出 JSON 失败率 33%**：失败集中在 `task17-balanced` fixture，疑似特定输入触发的稳定问题；structured-output-fixer 未能救回。生产路径靠 `maxAttempts` retry 兜底，但失败率仍偏高。后续若影响主链路稳定性，需考虑：
   - 加 selector prompt 输出约束（如禁止追加解释）
   - 切回 GLM-5.2 thinking=enabled 作 selector 专用 provider（需扩展 S2-1 支持按 operation 覆盖 model，超出 tier 唯一维度原则，留待 S2-2 用户偏好阶段）
2. **enum 精确匹配 0/4**：DeepSeek selector 全部以 `risk_recalled_enum_differed` 形式召回（识别为风险但 issue 类型与 fixture 期望不一致）。生产 selector 用 `consistency_issue` 字段做软信号，不阻塞主链路；但语义精度低于 S2-0 GLM-5.2 thinking=enabled 的 exact enum 匹配。
3. **样本量小**：本次仅 4 个 DeepSeek 有效样本 + 2 个 glm-4 样本，不足以做统计显著性判断。生产中需通过 interaction log 持续观察实际召回率与 JSON 失败率。

## 不修改的项

- `backend/src/runtime/llm/operation-tier-registry.ts`：`topic.selector` 维持 `"smart"`
- `backend/src/runtime/llm/operation-policy.ts`：`topic.selector` 维持当前 policy（不登记 thinking override）
- `harness/scripts/runtime/topic-selector-semantic-replay.ts`：维持 S2-0 Task 17 形态（保留历史可重放性）

## S2-1 收口

至此 S2-1 阶段二（live 验收）完成。S2-1 全部交付：

- 阶段一（主链路改造）：operation-tier-registry / provider-registry / tier-resolver / tier-aware-provider / tier-aware-provider-factory / env 接入新变量 / providers.json 示例 / 8 个调用方接入 tier 路由 / 启动诊断日志
- 阶段二（live 验收）：DeepSeek smart 链路冒烟通过、智谱 flash 链路冒烟通过、selector thinking 三组对比完成并形成本决策

S2-1 进入冻结状态，作为 S2-2（用户偏好、生成策略与成本控制）的输入。
