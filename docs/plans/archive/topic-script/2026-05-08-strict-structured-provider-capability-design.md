# Strict Structured Provider Capability Design

Date: 2026-05-08

## 背景

当前 LLM 调用已经拆分出 `main` 与 `structured` 两类用途：

- `main`：用于自由生成，典型任务是 script writer。
- `structured`：用于机器可解析的结构化输出，典型任务是 topic candidate builder、topic selector、semantic reviewer。

最新观察表明，`glm-5.1` 可以输出合法 JSON，但在严格结构化任务里会出现 schema 漂移。例如 `topic.selector` 期望：

```json
{
  "selected_candidate_ids": [
    "selector_candidate_1",
    "selector_candidate_2",
    "selector_candidate_3"
  ]
}
```

但真实返回过：

```json
{
  "answer": {
    "selected_ids": [
      "selector_candidate_1",
      "selector_candidate_3",
      "selector_candidate_4"
    ],
    "explanation": "..."
  }
}
```

这说明 `response_format: { "type": "json_object" }` 只能保证 JSON 语法，不足以保证业务 schema。继续靠本地增加字段别名兼容，会让解析器越来越宽，最终掩盖真实 contract 失败。

目标不是写死 GLM-5.1，也不是立即全面引入 LangChain，而是建立一个可扩展的 provider capability 层，让业务只声明“需要 strict structured output”，由 provider 按自身能力选择 `tool_call`、`json_schema`、`json_object + repair` 等策略。

## 当前现状

仓库已经引入并使用：

- `@langchain/core`
- `@langchain/langgraph`

但当前使用点主要是 graph orchestration：

- `backend/src/runtime/orchestration/topic-recommendation-graph.ts`
- `backend/src/runtime/orchestration/script-run-graph.ts`
- `backend/src/runtime/orchestration/topic-script-graph.ts`

LLM 调用仍由自研 provider 完成：

- `backend/src/runtime/llm/provider-contract.ts`
- `backend/src/runtime/llm/openai-compatible-provider.ts`
- `backend/src/runtime/llm/structured-output-fix.ts`

当前 provider 合同只有：

```ts
interface StructuredPromptProvider {
  invokeStructuredPrompt<T>(request: StructuredPromptInvocation): Promise<T>;
}
```

当前 OpenAI-compatible provider 的默认策略是：

1. 发起 `/chat/completions`。
2. 请求体使用 `response_format: { type: "json_object" }`。
3. 从 `message.content` 读取字符串。
4. `JSON.parse()`。
5. deterministic recovery / auto-fix 只处理 JSON 解析层面。

这个合同没有表达：

- provider 是否支持 tool call；
- provider 是否支持强制 tool choice；
- provider 是否支持原生 json schema；
- provider 是否支持关闭 thinking；
- provider 是否支持独立 sampling 参数；
- 当前任务是否要求 strict schema；
- schema validation 失败后的有界 repair 策略；
- tool call arguments 的 raw / parsed / validation trace。

## 目标

建立一个最小但可扩展的 strict structured provider capability 架构。

第一阶段只解决一个低耦合闭环：

- `topic.selector`
- `glm-5.1`
- strict structured output
- tool call 优先
- 本地严格 schema validation
- 单次格式 repair 或 fail loud

第一阶段不以提升文案质量为目标，只证明更强模型可以稳定满足机器合同。

## 非目标

本设计不做以下事情：

- 不改 script writer prompt。
- 不改 topic candidate builder 语义。
- 不改 semantic reviewer 的 shadow-only 地位。
- 不把 reviewer 输出接成 gate。
- 不引入 local semantic judge。
- 不使用关键词、黑名单或字符串规则冒充语义判断。
- 不把 `topic.selector` 的校验放宽为“猜字段”。
- 不做多模型自动竞赛。
- 不一次性迁移所有 LLM 调用。
- 不立即用 LangChain agent 替换现有 runtime。

## 设计原则

### 1. 业务声明需求，不声明供应商细节

业务层应该表达：

- 这是普通 JSON 输出；
- 这是严格结构化输出；
- 这是创作型输出；
- 这是 reviewer shadow 输出；
- 这是需要 tool call 的结构化输出。

业务层不应该知道：

- GLM 的 tool call 返回字段如何组织；
- DeepSeek 是否支持 forced tool choice；
- 某供应商 thinking 参数叫什么；
- 某供应商 json schema 是否原生可用。

### 2. 能力矩阵显式化

provider 必须显式声明能力，而不是靠 if/else 猜。

建议的能力维度：

```ts
interface LlmProviderCapabilities {
  jsonObject: boolean;
  toolCall: boolean;
  forcedToolChoice: boolean;
  nativeJsonSchema: boolean;
  thinkingControl: boolean;
  samplingControl: boolean;
}
```

第一阶段可以只落地必要字段：

```ts
interface LlmProviderCapabilities {
  jsonObject: boolean;
  toolCall: boolean;
  thinkingControl: boolean;
  samplingControl: boolean;
}
```

后续再补 `forcedToolChoice` 和 `nativeJsonSchema`。

### 3. strict structured 不等于宽容 normalizer

strict structured 的核心是：

1. 优先用 provider 的结构化能力约束输出。
2. 本地用 schema 做硬校验。
3. 校验失败时可以有一次格式 repair。
4. repair 只修结构，不重做语义选择。
5. repair 失败必须 fail loud。

不允许：

- 静默接受缺字段；
- 静默接受候选池外 ID；
- 静默接受多余包装层；
- 无限增加字段别名；
- 本地替模型补语义选择。

### 4. 日志必须保留原始形态

每次 strict structured 调用至少记录：

- provider；
- model；
- operationName；
- selected strategy；
- request schema；
- raw message content；
- raw tool_calls；
- parsed arguments；
- schema validation error；
- repair input / output；
- final parsed output。

这样未来比较 GLM、DeepSeek、LangChain adapter 时不会失去证据。

## 建议接口

### Provider contract

保留现有接口，同时新增 strict structured 能力。

```ts
export interface StrictStructuredToolSchema {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
}

export interface StrictStructuredInvocation {
  prompt: LoadedPrompt;
  input: unknown;
  operationName: string;
  schema: StrictStructuredToolSchema;
  options?: {
    temperature?: number;
    topP?: number;
    maxTokens?: number;
    thinking?: "enabled" | "disabled";
    repair?: {
      maxAttempts: 0 | 1;
      freezeSemantics: boolean;
    };
  };
  interactionLogWriter?: LlmInteractionLogWriter;
}

export interface StructuredPromptProvider {
  invokeStructuredPrompt<T>(request: StructuredPromptInvocation): Promise<T>;
  invokeStrictStructured?<T>(request: StrictStructuredInvocation): Promise<T>;
  capabilities?: LlmProviderCapabilities;
}
```

为什么不直接替换 `invokeStructuredPrompt`：

- 当前已有 builder、writer、reviewer 使用该接口。
- 第一阶段只验证 `topic.selector`。
- 保留旧接口可以降低迁移风险。

### Strategy selection

provider 内部策略建议：

```text
if nativeJsonSchema supported:
  use provider-native json_schema
else if toolCall supported:
  use tools + parse message.tool_calls[0].function.arguments
else:
  use json_object + parse message.content

validate parsed output against schema
if validation fails and repair.maxAttempts === 1:
  ask format-only repair
  validate again
if still fails:
  throw strict_structured_validation_failed
```

第一阶段对 GLM-5.1 采用：

```text
toolCall -> local schema validation -> optional one-shot format repair -> fail loud
```

## GLM-5.1 provider 策略

### 请求策略

GLM-5.1 strict structured 应优先使用 tool call，而不是 `json_object`。

请求体方向：

```json
{
  "model": "glm-5.1",
  "messages": [
    {
      "role": "system",
      "content": "..."
    },
    {
      "role": "user",
      "content": "..."
    }
  ],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "select_topic_candidates",
        "description": "Select exactly three topic candidate ids from the selector pool.",
        "parameters": {
          "type": "object",
          "properties": {
            "selected_candidate_ids": {
              "type": "array",
              "items": { "type": "string" },
              "minItems": 3,
              "maxItems": 3
            }
          },
          "required": ["selected_candidate_ids"],
          "additionalProperties": false
        }
      }
    }
  ],
  "tool_choice": "auto",
  "thinking": { "type": "disabled" }
}
```

注意：

- 智谱文档当前提示 `tool_choice` 默认且仅支持 `auto`，所以不要假设可以强制指定某个 tool。
- 如果 GLM-5.1 未返回 tool call，而是返回 content JSON，应按 strategy 失败或进入一次格式 repair，不能静默当成功。
- 是否支持 `thinking: { type: "disabled" }` 需要用 live probe 验证；如果不支持，需要记录 provider capability。

### 参数策略

structured profile 应独立于 main profile 设置。

建议第一阶段做 A/B，而不是写死：

- `thinking=disabled`
- `max_tokens` 足够覆盖 schema 和 arguments
- `temperature` 先从 `0.3` 或 `0.5` 试起
- 或测试 `do_sample=false`

不要同时大幅调整 `temperature` 和 `top_p`。

判断依据必须是真实样本通过率和失败形态，而不是直觉。

## DeepSeek provider 扩展点

DeepSeek 后续接入时不要复用 GLM-specific 代码路径。

建议只复用抽象：

```text
StrictStructuredInvocation
StrictStructuredToolSchema
LlmProviderCapabilities
strategy selection
schema validation
interaction logging
one-shot repair protocol
```

DeepSeek provider 自己实现：

- 是否支持 tool call；
- 是否支持 forced tool choice；
- 是否支持 json schema；
- 是否支持 thinking control；
- 请求参数命名；
- tool_calls 返回形态；
- error code 分类。

如果 DeepSeek 的 OpenAI-compatible tool call 足够标准，它可以走 generic OpenAI-compatible tool path。否则新增 `deepseek-compatible-provider.ts`。

## LangChain / LangGraph 评估

### LangGraph

当前已经在用 LangGraph 做编排。GLM-5.1 schema 漂移问题发生在 LLM provider 输出合同层，不是 graph orchestration 层。

结论：

- 继续使用当前 LangGraph。
- 不需要为这个问题重写 graph。

### LangChain

LangChain JS 的 structured output 能力包括：

- Zod / JSON Schema response format；
- provider strategy；
- tool calling strategy；
- schema validation error handling；
- tool-based retry。

这些能力方向上符合需求，但不建议立即把主链路切到 LangChain，原因：

- 当前未安装 `langchain` 主包、`@langchain/openai`、`@langchain/deepseek`。
- GLM-5.1 通过 OpenAI-compatible 接口暴露的 tool call 细节未验证。
- LangChain adapter 是否完整支持 GLM 的 `thinking`、`tool_choice` 限制、返回形态仍未知。
- 直接引入会增加一层不确定性：失败时难以判断是 GLM、LangChain adapter 还是本地 schema 的问题。

结论：

- LangChain 可以作为第二阶段 provider adapter spike。
- 第一阶段更推荐自研 provider + raw tool call，因为改造面更小，证据链更清楚。

## Topic Selector 第一阶段方案

### 新 schema

定义 `topic.selector` strict structured schema：

```ts
const TopicSelectorDecisionSchema = {
  name: "select_topic_candidates",
  description: "Select exactly three candidate ids from the selector pool.",
  parameters: {
    type: "object",
    properties: {
      selected_candidate_ids: {
        type: "array",
        items: { type: "string" },
        minItems: 3,
        maxItems: 3,
      },
    },
    required: ["selected_candidate_ids"],
    additionalProperties: false,
  },
};
```

本地仍保留 selector 业务校验：

- 必须 3 个；
- 必须来自 selector pool；
- 不得重复；
- 不得选择已排除 ID；
- 不得违反 event identity 排除规则；
- repair 场景只能补缺失槽位。

### Prompt 调整原则

`topic.selector` prompt 应短而硬：

- 不再说“可附带说明”。
- 明确要求调用 tool 返回选择结果。
- 明确禁止输出 `answer`、`result`、`explanation` 等包装或解释字段。
- 不重复堆叠口号。

如果使用 tool call，prompt 只保留选择原则，不再承担 schema 约束主责。schema 约束由 tool parameters 承担。

### Failure handling

失败分层：

```text
no_tool_call
tool_arguments_parse_failed
tool_arguments_schema_failed
tool_arguments_business_validation_failed
tool_repair_failed
```

处理建议：

- `no_tool_call`：可以做一次 format-only repair，或直接 fail loud。
- `parse_failed`：一次 format repair。
- `schema_failed`：一次 format repair。
- `business_validation_failed`：一般不 repair，除非只是数量不足且已有现有 selector repair 语义覆盖。
- `repair_failed`：fail loud。

不要把 business validation failure 伪装成格式问题。

## Format-only repair 协议

repair 输入：

```json
{
  "raw_output": "...",
  "schema_error": "...",
  "allowed_schema": { "...": "..." },
  "frozen_semantics": {
    "original_selected_ids_if_any": ["..."],
    "instruction": "只修复字段结构，不得重新选择候选。"
  }
}
```

repair 输出仍必须满足同一个 schema。

repair 限制：

- 最多一次。
- 不允许重新调用 selector 做语义选择。
- 不允许补候选池外 ID。
- 不允许本地发明 ID。

## 配置建议

新增可选配置，不影响现有 `.env`：

```text
LLM_STRUCTURED_STRATEGY=json_object|tool_call|auto
LLM_STRUCTURED_THINKING=enabled|disabled
LLM_STRUCTURED_TEMPERATURE=0.5
LLM_STRUCTURED_TOP_P=
LLM_STRUCTURED_MAX_TOKENS=2048
```

默认策略建议：

```text
LLM_STRUCTURED_STRATEGY=json_object
```

原因：

- 保持现有链路稳定。
- GLM-5.1 tool call 需要先通过 task-level probe。

在 GLM-5.1 适配任务中显式设置：

```text
LLM_STRUCTURED_STRATEGY=tool_call
LLM_STRUCTURED_MODEL=glm-5.1
LLM_STRUCTURED_THINKING=disabled
```

## 测试策略

### 单元测试

1. provider config 能解析 strict structured 配置。
2. provider capability 能声明 `toolCall=true`。
3. tool call request body 包含 `tools`。
4. tool call arguments 能被解析。
5. 缺失 tool call 时失败。
6. arguments 不是 JSON 时失败或进入 repair。
7. arguments 缺 `selected_candidate_ids` 时失败或进入 repair。
8. `answer.selected_ids` 不应在 strict tool path 中静默成功，除非通过 repair 转换为正式 schema。

### Topic selector 测试

1. `topic.selector` 优先调用 `invokeStrictStructured`。
2. 返回 3 个合法 ID 时通过。
3. 返回池外 ID 时失败。
4. 返回重复 ID 时失败。
5. repair 场景只补缺失槽位。
6. 不发生无限 repair。

### Live probe

先跑一个样本：

```powershell
$env:LLM_MODEL='glm-5.1'
$env:LLM_STRUCTURED_MODEL='glm-5.1'
$env:LLM_STRUCTURED_STRATEGY='tool_call'
$env:LLM_STRUCTURED_THINKING='disabled'
$env:LLM_TIMEOUT_MS='120000'
npx tsx harness/scripts/runtime/topic-script-live-check.ts --sample harness/samples/topic-script/yanzi-shichu.sample.json --output-dir harness/scripts/runtime/output/<run-id>
```

通过后再跑 5 轮：

```powershell
npm run harness:topic-script-five-round-quality-check -- --output-dir harness/scripts/runtime/output/<run-id>
```

## 记录要求

每次 live probe 必须记录：

- model；
- strategy；
- thinking；
- temperature / top_p；
- timeout；
- raw tool call；
- parsed arguments；
- schema validation result；
- business validation result；
- final selected IDs；
- sample status；
- script local validation；
- semantic reviewer shadow；
- 全文 script_text，供人工判断。

## 风险

### 1. GLM tool call 不稳定

可能出现：

- 不返回 tool call；
- tool arguments 不合法；
- tool_choice 无法强制；
- thinking disabled 参数不被接受；
- 延迟显著升高。

应对：

- 记录 raw response；
- fail loud；
- 不自动切主链路；
- 保持 `glm-4 structured` 可回退。

### 2. repair 改变语义

如果 repair 重新选择 ID，就会破坏 selector 语义边界。

应对：

- repair prompt 冻结原始 selected IDs。
- repair 后仍跑 business validation。
- business validation 失败不做语义补救。

### 3. provider 抽象过度

过早抽象所有模型能力会拖慢当前质量工作。

应对：

- 第一阶段只实现 topic.selector 必需能力。
- 只新增接口，不重写所有调用。
- 先 GLM-5.1，再评估 DeepSeek。

### 4. LangChain 引入复杂度

LangChain 有 structured output 能力，但可能增加 adapter 层不确定性。

应对：

- 不作为第一阶段主路径。
- 保留为第二阶段 adapter spike。

## 推荐实施顺序

1. 写 implementation plan，只覆盖 provider capability + topic.selector。
2. TDD 新增 `invokeStrictStructured` 合同。
3. 实现 OpenAI-compatible tool call request / response parse。
4. 为 `topic.selector` 增加 strict schema。
5. `topic.selector` 改用 `invokeStrictStructured`，仅在 provider 不支持时回退旧 `invokeStructuredPrompt`。
6. 跑单元测试。
7. 跑 GLM-5.1 单样本 live probe。
8. 记录结果。
9. 单样本稳定后再跑 5 轮。
10. 再决定是否把 `LLM_STRUCTURED_MODEL=glm-5.1` 推荐为可选配置。

## 决策

当前不建议立即全面引入 LangChain，也不建议继续只靠 `json_object` 适配 GLM-5.1。

推荐第一阶段主路径：

```text
self-managed provider capability layer
-> OpenAI-compatible raw tool call
-> topic.selector strict schema
-> local schema validation
-> one-shot format-only repair
-> live probe
```

这条路径改动最小、证据最清楚，也为后续 DeepSeek 或其他模型接入保留了扩展空间。
