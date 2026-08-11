# S2-1 多模型多供应商切换设计

## 0. 状态

- 阶段：S2-1（V2 provider 治理第一棒）
- 日期：2026-07-17
- 上游：S2-0 选题链路冻结（`2968c5e 回滚选题链路到 builder+selector 架构`）
- 下游：S2-2 用户偏好、生成策略与成本控制
- 关联文档：
  - `docs/plans/2026-07-13-v2-overall-design.md`（V2 provider 治理整体设计）
  - `docs/plans/2026-07-13-v2-roadmap-step3-10.md`（Step 3 provider/model 路线图）
  - `docs/plans/2026-07-17-s2-0-topic-rollback-to-builder-selector-design.md`（S2-0 回滚决策）
  - `docs/records/2026-07-17-topic-light-review-thinking-isolation-live-check.md`（thinking 召回实测）
  - `docs/records/2026-05-08-glm-5-1-structured-profile-issue.md`（早期 glm-4 vs 5.x 对照）

## 1. 背景与动机

### 1.1 S2-0 试错得到的核心规律

S2-0 阶段（含本次会话的 light-review 试错）共经历 67 个提交 + 1 次回滚，最终得到一个明确规律：

> **任务难度存在明显的二元分化：需要 reasoning 深度的任务（writer、planner、selector）必须用高能力模型；不需要 reasoning 的短结构化任务（title、description、cover-prompt）用快速模型更合适。**

实测证据：
- `topic.light-review` 在 GLM-5.2 thinking off 下召回 0/2；在 glm-4 下召回 0/2（[thinking-isolation-live-check](../../../docs/records/2026-07-17-topic-light-review-thinking-isolation-live-check.md)）。
- `topic.selector` 在 GLM-5.2 thinking off 下固定回放召回 0/2；thinking on 下 2/2 但单次 31s→424s。
- `publish.*` 系列短输出在 glm-4 上延迟更低（[2026-05-08 记录](../../../docs/records/2026-05-08-glm-5-1-structured-profile-issue.md)）。

### 1.2 当前配置的根本问题

当前 [env.ts](../../../backend/src/config/env.ts) 用 `LLM_MODEL` / `LLM_STRUCTURED_MODEL` 两个全局变量定位模型，存在三个根本缺陷：

1. **维度错配**：`STRUCTURED` 实际混合了"模型路由"和"调用方式（tool_call vs json_object）"两个独立职责，导致切换模型时牵一发动全身。
2. **粒度过粗**：所有 short_structured_decision 类 operation 共用一个模型，无法区分"`topic.selector` 需要 reasoning"和"`publish.title-generator` 不需要 reasoning"。
3. **单 provider 硬编码**：只支持单一 base_url + api_key，无法按 operation 路由到不同厂商。

### 1.3 为什么不直接做 V2 完整版

V2 overall-design 定义的完整 provider 治理包含 RunConfigurationSnapshot、UsageCostRecord、数据库 ProviderModel、ProviderCredential、admin UI 等。这些是 S2-2（用户偏好与成本控制）与后续 admin 阶段的职责。S2-1 聚焦最小可用版：**让每个 operation 能按 tier 路由到合适的 provider:model**，解决 S2-0 暴露的速度/质量错配问题。

## 2. 目标与非目标

### 2.1 目标

1. 引入 `tier` 作为模型路由的唯一配置维度（`smart` / `flash` 两档）。
2. 每个 operation 在代码中声明所需 tier，运行时由 gateway 解析为具体 `provider:model`。
3. 支持多 provider 注册，每个 provider 绑定一套 base_url + api_key + 多个可选 model。
4. 向后兼容现有 `LLM_MODEL` / `LLM_STRUCTURED_MODEL`，提供过渡期。
5. selector 切换到新模型后，通过 A/B 实测决定其 thinking 策略。

### 2.2 非目标

- ❌ BYOK（用户自带 key）。
- ❌ 通用 AI Gateway / 插件市场。
- ❌ 自动模型选择（agent 自主选模型）。
- ❌ RunConfigurationSnapshot 持久化（留给 S2-2）。
- ❌ UsageCostRecord 成本追踪（留给 S2-2）。
- ❌ 数据库 ProviderModel 实体（留给 S2-2 / admin 阶段）。
- ❌ DashScope（image/video/tts）统一治理（独立后续阶段）。
- ❌ admin UI 模型管理界面。
- ❌ 引入第三个 tier（如 `standard`）。
- ❌ 改变 mode（tool_call vs json_object）的判定规则。

## 3. 核心概念

### 3.1 Tier（模型档位）

tier 是模型路由的唯一配置维度，按"是否需要 reasoning 深度"二分：

| tier | 含义 | 典型模型 | 典型任务 |
|---|---|---|---|
| `smart` | 高能力、支持深度 reasoning、较长生成 | deepseek-v4-pro、glm-5.x、claude-sonnet | 长文案、规划、需要召回的判断 |
| `flash` | 快速、轻量、足够处理短结构化输出 | glm-4、deepseek-v4-flash | 短文本生成、字段补全、提示词优化 |

设计原则：
- **两档固定**，不预设第三档。若未来确实需要中间档，单独 design，不在 S2-1 顺手扩。
- tier 只决定"用哪个模型"，**不决定"怎么调用"**（调用方式由 mode 决定，见 3.3）。
- tier 配置在 env / 配置文件，**不在代码硬编码模型名**。

### 3.2 Provider 与 Model

- **Provider**：一家模型供应商（deepseek、zhipu、anthropic 等），绑定一套 `base_url` + `api_key`。
- **Model**：provider 下的一个具体模型 ID（`deepseek-v4-pro`、`glm-4`）。
- **定位**：`provider:model` 组合唯一确定一个模型（opencode 风格）。例如 `deepseek:deepseek-v4-pro`。
- **tier 映射**：每个 tier 指向一个 `provider:model`，由配置文件声明。

### 3.3 Mode（调用方式，不在 S2-1 配置范围）

mode 描述"如何与模型交互"，当前已有两种：

| mode | 请求格式 | 当前使用 |
|---|---|---|
| `json_object` | `response_format: { type: "json_object" }` | 大多数 operation |
| `tool_call` | `tools: [{ function: { parameters: <schema> } }]` + `tool_choice` | 仅 `topic.selector` |

**mode 与 tier 正交**：同一个 tier（如 smart = deepseek:v4-pro）可以被两种方式调用：
- `topic.selector`（smart + tool_call）
- `script.writer`（smart + json_object）

**S2-1 不动 mode 配置**：mode 由调用代码按 operation 输出特征决定。判定标准见 3.4。

### 3.4 Mode 判定标准（科学化）

mode 不进配置，但**判定必须有明确依据**，不能凭感觉。判定流程：

1. 看输出体量：单次输出 > 200 token 或字段值是创意长文本 → `json_object`
2. 看字段刚性：字段有 enum / required / `additionalProperties: false` 约束 → 倾向 `tool_call`
3. 看容错成本：格式错误后能否走 Zod 兜底修复 → 能则 `json_object`，不能则 `tool_call`
4. 看模型兼容：模型/厂商是否支持 strict tool_call → 不支持则强制 `json_object`

**优先级**：1 > 4 > 2 > 3。即只要输出是长文本，无论字段刚性多强都走 `json_object`（tool_call 会憋死创意）；只要模型不支持 tool_call，无论多想严格都只能 `json_object`。

#### 当前所有 operation 的 mode 现状与评估

| Operation | 当前 mode | 输出特征 | 评估 | 是否调整 |
|---|---|---|---|---|
| `script.writer` | json_object | 2000+ 字口播文案，创意文本 | ✅ 合理（规则 1） | 不动 |
| `topic.candidate-builder` | json_object | 8 候选 × 13 字段，字段值是创意文本 | ✅ 合理（规则 1） | 不动 |
| `topic.candidate-builder-repair` | json_object | 同上 | ✅ 合理 | 不动 |
| `storyboard.planner` | json_object | 长结构化 + 创意 | ✅ 合理（规则 1） | 不动 |
| `storyboard.segment-regen` | json_object | 同上 | ✅ 合理 | 不动 |
| `asset-planning.planner` | json_object | 长结构化 | ✅ 合理（规则 1） | 不动 |
| `asset-planning.asset-structural-repair` | json_object | 结构修复 | ✅ 合理 | 不动 |
| `topic.selector` | tool_call | ranked_candidates + 多 enum + required | ✅ 合理（规则 2） | 不动（已是最优） |
| `script.semantic-reviewer` | json_object | 评审结构（shadow） | ⚠️ 待评估 | 留给 shadow 评审独立设计 |
| `publish.title-generator` | json_object | 短候选数组 `{title, reason}` | ⚠️ 可优化 | S2-1 顺带改为 tool_call |
| `publish.description-generator` | json_object | 单字段 `{description}` | ⚠️ 可优化 | S2-1 顺带改为 tool_call |
| `publish.cover-prompt-generator` | json_object | 单字段 `{prompt}` | ⚠️ 可优化 | S2-1 顺带改为 tool_call |
| `publish.cover-prompt-optimizer` | json_object | 单字段优化结果 | ⚠️ 可优化 | S2-1 顺带改为 tool_call |
| `asset.prompt-optimizer` | json_object | 单字段优化结果 | ⚠️ 可优化 | S2-1 顺带改为 tool_call |

#### mode 调整边界

- S2-1 主目标是 tier 路由，**mode 调整是顺带优化项**，不阻塞主链路验收。
- `publish.*` 与 `asset.prompt-optimizer` 这 5 个"短输出单字段"operation 改 tool_call 是明确的甜点位：输出小、字段固定、改完后能减少 Zod fallback 触发率。
- 改 mode 必须每个 operation 单独验证（用既有 fixture 跑 A/B），不能批量切换。
- mode 改动**不进 tier 配置**，仍是代码侧调用契约的调整，由 implementation plan 拆 task。

## 4. 配置形态

### 4.1 Provider 注册与 Tier 映射（分离）

tier 与 provider 注册职责分离：
- **tier → provider:model 映射**走 env 变量（运维侧频繁切换，单行修改）。
- **provider 注册（baseUrl + apiKeyEnv 引用）**走 JSON 配置文件（结构稳定，不频繁变）。
- **密钥**仍走 `.env`（通过 `apiKeyEnv` 引用变量名，不存明文）。

#### 4.1.1 Tier 映射（env 变量）

`.env`：

```bash
# Tier → provider:model 映射（opencode 风格）
LLM_SMART_MODEL=deepseek:deepseek-v4-pro
LLM_FLASH_MODEL=zhipu:glm-4
```

设计约束：
- 变量值固定格式 `<provider>:<model>`，由 `provider-registry` 解析。
- 缺省时：`LLM_SMART_MODEL` 回退到旧 `LLM_MODEL`；`LLM_FLASH_MODEL` 回退到旧 `LLM_STRUCTURED_MODEL`（兼容期，见 4.4）。
- 不在代码硬编码模型名。

#### 4.1.2 Provider 注册（JSON 配置文件）

新增 `backend/providers.json`（路径可由 env `LLM_PROVIDERS_CONFIG_PATH` 覆盖）：

```json
{
  "providers": [
    {
      "name": "deepseek",
      "baseUrl": "https://api.deepseek.com",
      "apiKeyEnv": "LLM_PROVIDER_DEEPSEEK_API_KEY"
    },
    {
      "name": "zhipu",
      "baseUrl": "https://open.bigmodel.cn/api/paas/v4",
      "apiKeyEnv": "LLM_PROVIDER_ZHIPU_API_KEY"
    }
  ]
}
```

设计约束：
- `apiKeyEnv` 引用 env 变量名，**不直接存密钥**——符合 V2 ProviderCredential"不存明文"原则。
- 配置文件本身可 git 跟踪（不含密钥），密钥仍走 `.env`。
- provider `name` 必须与 `LLM_SMART_MODEL` / `LLM_FLASH_MODEL` 中冒号前的 provider 名一致。
- 缺失 providers.json 时回退到旧 env 单 provider 模式（兼容期，见 4.4）。

### 4.2 Operation Tier 声明（代码注册表）

新增 `backend/src/runtime/llm/operation-tier-registry.ts`：

```typescript
export type OperationTier = "smart" | "flash";

const OPERATION_TIER_REGISTRY: Record<string, OperationTier> = {
  // 核心语义生成
  "script.writer": "smart",

  // 长结构化生成
  "storyboard.planner": "smart",
  "storyboard.segment-regen": "smart",
  "topic.candidate-builder": "smart",
  "topic.candidate-builder-repair": "smart",
  "asset-planning.planner": "smart",
  "asset-planning.asset-structural-repair": "smart",

  // 短结构化判断（需要 reasoning）
  "topic.selector": "smart",

  // shadow 语义评审
  "script.semantic-reviewer": "smart",

  // 短结构化生成（不需要 reasoning）
  "publish.title-generator": "flash",
  "publish.description-generator": "flash",
  "publish.cover-prompt-generator": "flash",
  "publish.cover-prompt-optimizer": "flash",
  "asset.prompt-optimizer": "flash",
};

export function getOperationTier(operationName: string): OperationTier {
  const tier = OPERATION_TIER_REGISTRY[operationName];
  if (!tier) {
    return "smart";
  }
  return tier;
}
```

tier 分配依据（基于 S2-0 实测）：
- **smart** 的判定：输出长（>200 token）或字段值是创意文本，或需要 reasoning 才能保证质量（如 selector 召回）。
- **flash** 的判定：输出短、字段固定、不需要 reasoning。
- **关键约束**：`topic.selector` 必须是 smart——S2-0 已证明切到 flash 会回到召回 0/2 死结。
- 未知 operation 默认 smart（保守，避免误用 flash 牺牲质量）。
- **已从生产链路移除的 operation 不在 registry 中**：`topic.light-review` 在 S2-0 回滚（`2968c5e`）时已从生产链路移除，故不列入 registry。运行时若被调用（例如遗留 harness 脚本），会落入未知 operation 默认 smart。新增 operation 必须显式登记到 registry，否则同样默认 smart。

### 4.3 运行时解析流程

```
operation "topic.selector"
  → getOperationTier("topic.selector") = "smart"
  → env: LLM_SMART_MODEL = "deepseek:deepseek-v4-pro"
  → 解析 provider=deepseek, model=deepseek-v4-pro
  → providers.json: providers[name=deepseek] → baseUrl + apiKeyEnv
  → process.env[apiKeyEnv] → 实际 api_key
  → 走现有 openai-compatible-provider 发请求（mode 由调用代码决定，不在此层）
```

### 4.4 兼容期与旧 env 迁移

**兼容期策略**（A 方案）：

1. S2-1 上线后，新配置优先级：
   - tier 映射：`LLM_SMART_MODEL` / `LLM_FLASH_MODEL` > 旧 `LLM_MODEL` / `LLM_STRUCTURED_MODEL`
   - provider 注册：`providers.json` > 旧 `LLM_BASE_URL` / `LLM_API_KEY`（单 provider 模式）
2. 回退触发条件：
   - `LLM_SMART_MODEL` 未配置 → smart tier 使用 `LLM_MODEL`，provider 走 `LLM_BASE_URL` / `LLM_API_KEY`
   - `LLM_FLASH_MODEL` 未配置 → flash tier 回退到 smart tier 的解析结果（即两个 tier 用同一模型，等价 S2-0 前的单模型行为）
   - `providers.json` 不存在 → 单 provider 模式，provider 名视为 `default`
3. 旧 env 在 S2-1 验收通过后、S2-2 启动前删除。
4. `.env.example` 同步更新，旧变量加 `# Deprecated, use LLM_SMART_MODEL/LLM_FLASH_MODEL + providers.json` 标注。

兼容期约束：
- 兼容期允许"新 env 缺失时回退到旧 env"，但不允许混用（即 `LLM_SMART_MODEL` 启用后，该 tier 不再读旧 `LLM_MODEL`）。
- 启动时若检测到新旧配置同时存在，记 info 日志说明实际生效的那一套，不阻断。
- `LLM_FLASH_MODEL` 缺失时回退到 smart tier 而非报错，是为了让用户先只配 `LLM_SMART_MODEL` 也能跑通（渐进迁移）。

## 5. 实现边界

### 5.1 改动文件清单（预期）

新增：
- `backend/providers.json`（示例配置，仅含 provider 注册）
- `backend/src/runtime/llm/operation-tier-registry.ts`
- `backend/src/runtime/llm/provider-registry.ts`（providers.json 解析 + tier→provider:model 解析 + 缓存）
- 对应单元测试

改造：
- `backend/src/config/env.ts`：新增 `LLM_SMART_MODEL` / `LLM_FLASH_MODEL` / `LLM_PROVIDERS_CONFIG_PATH` 读取，保留旧 `LLM_MODEL` / `LLM_STRUCTURED_MODEL` / `LLM_BASE_URL` / `LLM_API_KEY` 兼容回退
- `backend/src/runtime/llm/openai-compatible-provider.ts`：`resolveOpenAiCompatibleProviderConfig` 改为接收已解析的 provider:model + baseUrl + apiKey，而非从 env 自行解析 profile
- `backend/src/runtime/llm/llm-gateway.ts`：invoke 时按 operationName 查 tier registry，按 tier 查 provider:model，再调用 provider
- `.env.example`：新增 `LLM_SMART_MODEL` / `LLM_FLASH_MODEL` 与 `LLM_PROVIDER_*_API_KEY` 示例，旧变量标注 deprecated

不动：
- 所有 prompt 文件
- 所有 schema（`TOPIC_SELECTOR_STRICT_SCHEMA` 等）
- 所有 validator、repair、retry 策略
- operation-policy.ts 中的 thinking override 逻辑（thinking 仍按 operation 名解析）
- DashScope 相关代码

### 5.2 与现有 operation-policy 的关系

`operation-policy.ts` 当前管 thinking / retry / maxAttempts 等"调用参数"。S2-1 新增的 `operation-tier-registry.ts` 管"用哪个模型"。**两者正交，不合并**：

- operation-policy：怎么调（thinking on/off、retry 几次、timeout 多长）
- operation-tier-registry：用谁调（smart / flash）

合并点仅在 gateway invoke 时：先查 tier 选 model，再查 policy 选参数，最后发请求。

## 6. selector thinking 决策子任务

回滚后 `topic.selector` 落入 provider default（GLM-5.2 上 = thinking on，慢）。切到新模型后必须重新决定。

### 6.1 决策流程

1. S2-1 主链路改造完成后，在 providers.json 配置 smart = `<新模型>`。
2. 复用 `harness/scripts/runtime/topic-selector-semantic-replay.ts`，在新模型上跑固定 fixture A/B：
   - thinking on vs thinking off
   - 对比耗时 + reasoning tokens + 风险召回（期望 2/2）
3. 按实测结果决定：
   - 若 thinking off 召回 ≥ 1/2 且耗时可接受 → 不登记 thinking override（落 provider default）。
   - 若 thinking off 召回 0/2 → 显式登记 `topic.selector: enabled`（沿用阶段 2 决策）。
   - 若 thinking on 仍然慢到不可接受 → 评估是否换更快的 reasoning 模型（回到 provider 选型）。

### 6.2 决策边界

- selector thinking 决策**单独成 task**，不与 S2-1 主链路改造混在一起。
- 决策必须基于固定 fixture 实测，不靠主观判断。
- 实测结果记录到 `docs/records/`，作为下一阶段输入。
- 决策完成后，若需要调整 operation-policy.ts，单独提交。

## 7. 验证策略

### 7.1 离线验证

- `npm run typecheck:backend` 通过。
- 新增 `operation-tier-registry` 单测：每个 operation 映射到正确 tier。
- 新增 `provider-registry` 单测：providers.json 解析、缺省回退、tier 不存在时的错误处理。
- 现有 `tests/backend/runtime/llm-operation-policy.test.ts` 不回归。
- stub provider 模式仍能正常跑（不依赖真实模型）。

### 7.2 真实 A/B 验证（需用户授权）

- 配置真实 providers.json + api key。
- 在固定 fixture 上对比：
  - 旧 env 配置（GLM-5.2 单模型）vs 新配置（deepseek smart + zhipu flash）
  - 关键 operation（selector、writer、title-generator）的耗时与质量
- 真实页面冒烟：跑完整 topic → script 链路，确认无回归。

### 7.3 兼容性验证

- 删除 providers.json，确认旧 env 仍能启动并正常工作。
- 同时配置 providers.json 和旧 env，确认 warning 但不阻断。
- providers.json 格式错误时，确认有明确报错而不是静默失败。

## 8. 风险与缓解

| 风险 | 等级 | 缓解措施 |
|---|---|---|
| R1：providers.json 配置错误导致 pipeline 阻塞 | 中 | 启动时严格校验，格式错误立即报错；保留旧 env 兼容回退 |
| R2：新模型在某 operation 上质量退化 | 高 | selector 必须经过 §6 A/B 实测；其他 smart operation 切换后做真实页面冒烟 |
| R3：多 provider 凭据泄漏到日志/trace | 中 | provider-registry 只暴露 base_url 与 model，api_key 不进任何 trace；interaction log 现有脱敏逻辑保持 |
| R4：兼容期半切换状态 | 低 | 启动时检测两套配置同时存在时记 warning；兼容期结束前不删除旧 env |
| R5：flash tier 被误用到需要 reasoning 的 operation | 高 | operation-tier-registry 未知 operation 默认 smart；selector 强制 smart；registry 改动需 design review |
| R6：selector 切到新模型后 thinking 决策未跟上 | 中 | §6 子任务强制要求，不与主链路改造合并 |

## 9. 与 V2 完整版的关系

S2-1 是 V2 overall-design 中 provider 治理的**第一棒**，对应 [v2-roadmap-step3-10.md](./2026-07-13-v2-roadmap-step3-10.md) Step 3 的最小可交付版本：

| V2 完整版实体 | S2-1 是否实现 | 留给谁 |
|---|---|---|
| Provider（抽象） | ✅（JSON 配置） | — |
| Model（目录） | ✅（tier 映射） | S2-2 扩展为数据库 ProviderModel |
| Credential Reference | ✅（apiKeyEnv 引用） | S2-2 扩展为 ProviderCredential 实体 |
| CapabilityRouter | ✅（operation-tier-registry + gateway） | — |
| RunConfigurationSnapshot | ❌ | S2-2 |
| UsageCostRecord | ❌ | S2-2 |
| admin UI | ❌ | admin 阶段 |
| BYOK | ❌（非目标） | — |

S2-1 完成后，S2-2 在其基础上添加：
- 用户级 tier 偏好（用户可选 smart/flash 默认档）
- 每次运行写入 RunConfigurationSnapshot
- 请求级 UsageCostRecord 持久化
- 数据库 ProviderModel（admin 可启停）

## 10. 验收标准

1. `backend/providers.json` 存在并能正确解析（仅含 provider 注册，不含 tier 映射）。
2. `LLM_SMART_MODEL` / `LLM_FLASH_MODEL` env 变量按 `<provider>:<model>` 格式生效。
3. 每个 operation 在 `operation-tier-registry` 中有明确 tier 声明（或落入未知默认 smart 并有日志）。
4. LLM gateway 按 operation 解析 tier → env 解析 provider:model → providers.json 解析 baseUrl/apiKey → 实际请求，链路打通。
5. 删除 `LLM_SMART_MODEL` 时，smart tier 回退到旧 `LLM_MODEL` 正常工作；删除 `LLM_FLASH_MODEL` 时，flash tier 回退到 smart tier 解析结果。
6. 删除 providers.json 时，单 provider 模式（provider 名为 `default`）正常工作。
7. selector 切换到新模型后，完成 §6 A/B 实测，thinking 策略有明确决定并记录。
8. `npm run typecheck:backend` 通过。
9. 受影响单测全部通过（含新增 registry 单测）。
10. 真实页面冒烟（授权后）：topic → script 链路无回归。
11. 不改动任何 prompt、schema、validator、repair 逻辑。
12. 不纳入 DashScope。
13. 不引入数据库实体。

## 11. 开放问题（S2-1 范围外，登记给后续）

- providers.json 是否需要支持 hot reload（不重启 backend 切换模型）？→ 当前不支持，重启生效。
- tier 是否需要 per-project 覆盖（不同项目用不同 smart 模型）？→ 留给 S2-2 用户偏好。
- 是否需要 fallback chain（smart 主模型挂了自动切备用）？→ 当前不做，错误即失败。
- 模型定价信息如何维护？→ 留给 S2-2 UsageCostRecord。
