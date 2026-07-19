# Strict Structured Provider Capability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a minimal strict structured output capability so `topic.selector` can use provider-level tool-call constraints with local schema and business validation, without migrating writer, reviewer, or the whole LLM stack.

**Architecture:** Add a new optional `invokeStrictStructured` provider capability beside the existing `invokeStructuredPrompt` path. The OpenAI-compatible provider gets a strict tool-call strategy, the gateway exposes it, and `topic.selector` becomes the first caller. Existing json-object behavior remains the default fallback for all other tasks.

**Tech Stack:** TypeScript, Vitest, existing prompt registry, existing OpenAI-compatible `/chat/completions` provider, existing topic recommendation runtime and harness.

---

## Scope

This plan implements only the first low-coupling proof path:

- provider capability contract
- OpenAI-compatible raw tool-call request and response parsing
- gateway delegation
- `topic.selector` strict schema and strict invocation
- prompt wording cleanup for `topic.selector`
- focused unit verification and one live probe record

This plan does not implement:

- script writer changes
- semantic reviewer changes
- DeepSeek-specific provider
- LangChain adapter
- native provider `json_schema`
- automatic model racing
- local semantic quality judging
- downstream storyboard, asset, compose, or UI work

## File Map

- Modify `backend/src/runtime/llm/provider-contract.ts`  
  Owns shared provider-facing strict structured types and optional capability declaration.

- Modify `backend/src/config/env.ts`  
  Owns runtime parsing for strict structured strategy and structured-only sampling controls.

- Modify `tests/backend/runtime/env-loading.test.ts`  
  Proves the new environment fields are parsed and defaulted without changing existing behavior.

- Modify `backend/src/runtime/llm/openai-compatible-provider.ts`  
  Owns OpenAI-compatible tool-call request body, response parsing, retry, timeout, and interaction logging.

- Modify `tests/backend/runtime/provider-hardening.test.ts`  
  Proves tool-call requests, parsed arguments, failure shape, and no silent alias acceptance.

- Modify `backend/src/runtime/llm/llm-gateway.ts`  
  Owns prompt lookup and strict invocation delegation.

- Modify `tests/backend/runtime/prompt-runtime.test.ts`  
  Proves the gateway passes prompt, schema, parser, operation name, and log writer to the provider.

- Modify `backend/src/modules/topic/topic-recommendation.service.ts`  
  Owns the `topic.selector` strict schema, business parser, and strict-first invocation.

- Modify `tests/backend/topic/topic-runtime-recommendation.test.ts`  
  Proves `topic.selector` uses strict invocation when available and preserves existing business validation.

- Modify `prompts/topic/selector.prompt.md`  
  Tightens the selector prompt so schema responsibility moves to tool parameters and the prompt stops inviting explanations.

- Modify `tests/backend/runtime/topic-prompt-contract.test.ts`  
  Proves the selector prompt remains zh-CN, short, tool-oriented, and does not ask for explanation fields.

- Create `docs/records/2026-05-08-strict-structured-provider-topic-selector-probe.md`  
  Records the GLM-5.1 probe result and any observed raw tool-call shape.

## Shared Constraints

- Work directly on `dev`; do not create a worktree.
- Use TDD inside each implementation task.
- Do not stage or commit `storage/topic-candidate-library/`.
- If `.env.example` already has unrelated local changes, inspect them before editing and stage only the lines introduced by this plan.
- Commit messages must be Chinese.
- The default runtime must remain compatible with the current stable path unless the operator explicitly sets strict structured strategy.
- `semantic reviewer` remains shadow-only.
- Do not add local keyword, blacklist, or semantic scoring rules.

---

### Task 1: Strict Structured Contract And Env Parsing

**Files:**
- Modify: `backend/src/runtime/llm/provider-contract.ts`
- Modify: `backend/src/config/env.ts`
- Modify: `tests/backend/runtime/env-loading.test.ts`

- [ ] **Step 1: Write the failing env test**

Add the new env keys to `RUNTIME_ENV_KEYS` in `tests/backend/runtime/env-loading.test.ts`:

```ts
"LLM_STRUCTURED_STRATEGY",
"LLM_STRUCTURED_THINKING",
"LLM_STRUCTURED_TEMPERATURE",
"LLM_STRUCTURED_TOP_P",
"LLM_STRUCTURED_MAX_TOKENS",
```

Extend `reads explicit LLM_* variables for runtime configuration`:

```ts
process.env.LLM_STRUCTURED_STRATEGY = "tool_call";
process.env.LLM_STRUCTURED_THINKING = "disabled";
process.env.LLM_STRUCTURED_TEMPERATURE = "0.5";
process.env.LLM_STRUCTURED_TOP_P = "0.9";
process.env.LLM_STRUCTURED_MAX_TOKENS = "2048";
```

Extend the expected `env.llm` object:

```ts
structuredStrategy: "tool_call",
structuredThinking: "disabled",
structuredTemperature: 0.5,
structuredTopP: 0.9,
structuredMaxTokens: 2048,
```

Add a defaulting assertion in `falls back to OPENAI_* variables when LLM_* variables are absent`:

```ts
expect(env.llm.structuredStrategy).toBe("json_object");
expect(env.llm.structuredThinking).toBeUndefined();
expect(env.llm.structuredTemperature).toBeUndefined();
expect(env.llm.structuredTopP).toBeUndefined();
expect(env.llm.structuredMaxTokens).toBeUndefined();
```

- [ ] **Step 2: Run red test**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/runtime/env-loading.test.ts
```

Expected: FAIL because `env.llm.structuredStrategy` and related fields do not exist yet.

- [ ] **Step 3: Add strict structured types**

In `backend/src/runtime/llm/provider-contract.ts`, add these exports above `StructuredPromptInvocation`:

```ts
export type StrictStructuredStrategy = "json_object" | "tool_call" | "auto";

export type StrictStructuredThinking = "enabled" | "disabled";

export interface LlmProviderCapabilities {
  jsonObject: boolean;
  toolCall: boolean;
  thinkingControl: boolean;
  samplingControl: boolean;
}

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

export interface StrictStructuredInvocation<T> {
  prompt: LoadedPrompt;
  input: unknown;
  operationName: string;
  schema: StrictStructuredToolSchema;
  parse: (candidate: unknown) => T;
  options?: {
    strategy?: StrictStructuredStrategy;
    temperature?: number;
    topP?: number;
    maxTokens?: number;
    thinking?: StrictStructuredThinking;
  };
  interactionLogWriter?: LlmInteractionLogWriter;
}
```

Extend `StructuredPromptProvider`:

```ts
export interface StructuredPromptProvider {
  capabilities?: LlmProviderCapabilities;
  invokeStructuredPrompt<T>(request: StructuredPromptInvocation): Promise<T>;
  invokeStrictStructured?<T>(request: StrictStructuredInvocation<T>): Promise<T>;
}
```

- [ ] **Step 4: Add env fields**

In `backend/src/config/env.ts`, add local types near `RuntimeProvider`:

```ts
type StrictStructuredStrategy = "json_object" | "tool_call" | "auto";
type StrictStructuredThinking = "enabled" | "disabled";
```

Extend `AppEnv["llm"]`:

```ts
structuredStrategy: StrictStructuredStrategy;
structuredThinking?: StrictStructuredThinking;
structuredTemperature?: number;
structuredTopP?: number;
structuredMaxTokens?: number;
```

Add fields inside `buildEnv().llm`:

```ts
structuredStrategy: readStrictStructuredStrategy(
  readEnvValue("LLM_STRUCTURED_STRATEGY", dotEnvValues),
),
structuredThinking: readStrictStructuredThinking(
  readEnvValue("LLM_STRUCTURED_THINKING", dotEnvValues),
),
structuredTemperature: readOptionalNumber(
  readEnvValue("LLM_STRUCTURED_TEMPERATURE", dotEnvValues),
),
structuredTopP: readOptionalNumber(
  readEnvValue("LLM_STRUCTURED_TOP_P", dotEnvValues),
),
structuredMaxTokens: readOptionalNumber(
  readEnvValue("LLM_STRUCTURED_MAX_TOKENS", dotEnvValues),
),
```

Add helpers below `readEnvValue`:

```ts
function readStrictStructuredStrategy(
  value: string | undefined,
): StrictStructuredStrategy {
  if (value === "tool_call" || value === "auto") {
    return value;
  }

  return "json_object";
}

function readStrictStructuredThinking(
  value: string | undefined,
): StrictStructuredThinking | undefined {
  if (value === "enabled" || value === "disabled") {
    return value;
  }

  return undefined;
}

function readOptionalNumber(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : undefined;
}
```

- [ ] **Step 5: Run green test**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/runtime/env-loading.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```powershell
git add backend/src/runtime/llm/provider-contract.ts backend/src/config/env.ts tests/backend/runtime/env-loading.test.ts
git commit -m "新增严格结构化输出配置合同"
```

Expected: commit succeeds and does not stage `storage/topic-candidate-library/`.

---

### Task 2: OpenAI-Compatible Strict Tool Call Provider Path

**Files:**
- Modify: `backend/src/runtime/llm/openai-compatible-provider.ts`
- Modify: `tests/backend/runtime/provider-hardening.test.ts`

- [ ] **Step 1: Write failing provider tests**

Add tests to `tests/backend/runtime/provider-hardening.test.ts`:

```ts
it("invokes strict structured requests through tool calls and parses function arguments", async () => {
  const prompt = createPromptRegistry().getPrompt("topic.selector");
  const invokeStrictApi = vi.fn(async () => ({
    rawOutput: JSON.stringify({
      choices: [
        {
          message: {
            tool_calls: [
              {
                type: "function",
                function: {
                  name: "select_topic_candidates",
                  arguments: JSON.stringify({
                    selected_candidate_ids: [
                      "selector_candidate_1",
                      "selector_candidate_2",
                      "selector_candidate_3",
                    ],
                  }),
                },
              },
            ],
          },
        },
      ],
    }),
    argumentsJson: JSON.stringify({
      selected_candidate_ids: [
        "selector_candidate_1",
        "selector_candidate_2",
        "selector_candidate_3",
      ],
    }),
  }));
  const provider = createOpenAiCompatibleProvider({
    model: "glm-5.1",
    invokeStrictApi,
  });

  const result = await provider.invokeStrictStructured?.({
    prompt,
    input: {
      selector_pool: [],
    },
    operationName: "topic.selector",
    schema: {
      name: "select_topic_candidates",
      description: "Select topic candidates.",
      parameters: {
        type: "object",
        properties: {
          selected_candidate_ids: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: ["selected_candidate_ids"],
        additionalProperties: false,
      },
    },
    parse: (candidate) => candidate as { selected_candidate_ids: string[] },
    options: {
      strategy: "tool_call",
      thinking: "disabled",
      temperature: 0.5,
      topP: 0.9,
      maxTokens: 2048,
    },
  });

  expect(result).toEqual({
    selected_candidate_ids: [
      "selector_candidate_1",
      "selector_candidate_2",
      "selector_candidate_3",
    ],
  });
  expect(invokeStrictApi).toHaveBeenCalledWith(
    expect.objectContaining({
      model: "glm-5.1",
      operationName: "topic.selector",
      schema: expect.objectContaining({
        name: "select_topic_candidates",
      }),
      options: expect.objectContaining({
        strategy: "tool_call",
        thinking: "disabled",
      }),
    }),
  );
});

it("fails strict structured tool calls when arguments use an answer wrapper", async () => {
  const prompt = createPromptRegistry().getPrompt("topic.selector");
  const provider = createOpenAiCompatibleProvider({
    model: "glm-5.1",
    invokeStrictApi: async () => ({
      rawOutput: "tool-response",
      argumentsJson: JSON.stringify({
        answer: {
          selected_ids: [
            "selector_candidate_1",
            "selector_candidate_2",
            "selector_candidate_3",
          ],
        },
      }),
    }),
  });

  await expect(
    provider.invokeStrictStructured?.({
      prompt,
      input: {},
      operationName: "topic.selector",
      schema: {
        name: "select_topic_candidates",
        description: "Select topic candidates.",
        parameters: {
          type: "object",
          properties: {
            selected_candidate_ids: {
              type: "array",
              items: { type: "string" },
            },
          },
          required: ["selected_candidate_ids"],
          additionalProperties: false,
        },
      },
      parse: (candidate) => {
        const record = candidate as Record<string, unknown>;
        if (!Array.isArray(record.selected_candidate_ids)) {
          throw new Error("topic_selector_strict_schema_failed");
        }

        return record as { selected_candidate_ids: string[] };
      },
      options: {
        strategy: "tool_call",
      },
    }),
  ).rejects.toThrow("topic_selector_strict_schema_failed");
});
```

- [ ] **Step 2: Run red test**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/runtime/provider-hardening.test.ts
```

Expected: FAIL because `invokeStrictApi` and `invokeStrictStructured` do not exist yet.

- [ ] **Step 3: Add strict provider request types**

In `backend/src/runtime/llm/openai-compatible-provider.ts`, extend imports from `provider-contract.js`:

```ts
StrictStructuredInvocation,
StrictStructuredToolSchema,
StrictStructuredStrategy,
```

Add request and response interfaces after `OpenAiCompatibleInvokeRequest`:

```ts
export interface OpenAiCompatibleStrictInvokeRequest {
  prompt: LoadedPrompt;
  input: unknown;
  operationName: string;
  model: string;
  schema: StrictStructuredToolSchema;
  options: {
    strategy: StrictStructuredStrategy;
    temperature?: number;
    topP?: number;
    maxTokens?: number;
    thinking?: "enabled" | "disabled";
  };
}

export interface OpenAiCompatibleStrictInvokeResult {
  rawOutput: string;
  argumentsJson: string;
}
```

Extend `OpenAiCompatibleProviderOptions`:

```ts
invokeStrictApi?: (
  request: OpenAiCompatibleStrictInvokeRequest,
) => Promise<OpenAiCompatibleStrictInvokeResult>;
```

- [ ] **Step 4: Implement strict invocation in provider**

Inside `createOpenAiCompatibleProvider`, create the strict API function:

```ts
const invokeStrictApi =
  options.invokeStrictApi ??
  createDefaultInvokeStrictApi({
    apiKey: providerConfig.apiKey,
    baseUrl: providerConfig.baseUrl,
    model,
  });
```

Return capabilities and `invokeStrictStructured`:

```ts
capabilities: {
  jsonObject: true,
  toolCall: true,
  thinkingControl: true,
  samplingControl: true,
},
async invokeStrictStructured<T>(
  request: StrictStructuredInvocation<T>,
): Promise<T> {
  let rawOutput = "";
  let parsedOutput: T | undefined;

  try {
    const strictResult = await withRetry(
      () => {
        requestBudget.consume(request.operationName);

        return withTimeout(
          invokeStrictApi({
            prompt: request.prompt,
            input: request.input,
            operationName: request.operationName,
            model,
            schema: request.schema,
            options: {
              strategy:
                request.options?.strategy ??
                providerConfig.structuredStrategy ??
                "json_object",
              temperature:
                request.options?.temperature ??
                providerConfig.structuredTemperature,
              topP:
                request.options?.topP ??
                providerConfig.structuredTopP,
              maxTokens:
                request.options?.maxTokens ??
                providerConfig.structuredMaxTokens,
              thinking:
                request.options?.thinking ??
                providerConfig.structuredThinking,
            },
          }),
          options.timeoutMs ?? env.llm.timeoutMs,
          request.operationName,
        );
      },
      {
        provider: "llm",
        operation: request.operationName,
        maxAttempts: options.maxAttempts ?? env.llm.maxAttempts,
        baseDelayMs: options.baseDelayMs ?? 1500,
        maxDelayMs: options.maxDelayMs ?? 8000,
      },
    );

    rawOutput = strictResult.rawOutput;
    parsedOutput = request.parse(JSON.parse(strictResult.argumentsJson));

    await request.interactionLogWriter?.write({
      generatedAt: new Date().toISOString(),
      provider: "openai-compatible",
      model,
      operationName: request.operationName,
      promptId: request.prompt.metadata.id,
      promptStage: request.prompt.metadata.stage,
      promptLanguage: request.prompt.metadata.language,
      promptFilePath: request.prompt.filePath,
      systemPrompt: request.prompt.body,
      input: request.input,
      rawOutput,
      parsedOutput,
      errorMessage: null,
    });

    return parsedOutput;
  } catch (error) {
    await request.interactionLogWriter?.write({
      generatedAt: new Date().toISOString(),
      provider: "openai-compatible",
      model,
      operationName: request.operationName,
      promptId: request.prompt.metadata.id,
      promptStage: request.prompt.metadata.stage,
      promptLanguage: request.prompt.metadata.language,
      promptFilePath: request.prompt.filePath,
      systemPrompt: request.prompt.body,
      input: request.input,
      rawOutput,
      errorMessage: error instanceof Error ? error.message : String(error),
    });

    throw error;
  }
},
```

- [ ] **Step 5: Extend provider config**

Extend `resolveOpenAiCompatibleProviderConfig` return type:

```ts
structuredStrategy?: StrictStructuredStrategy;
structuredThinking?: "enabled" | "disabled";
structuredTemperature?: number;
structuredTopP?: number;
structuredMaxTokens?: number;
```

In the structured profile branch, return:

```ts
structuredStrategy: options.envConfig.structuredStrategy,
structuredThinking: options.envConfig.structuredThinking,
structuredTemperature: options.envConfig.structuredTemperature,
structuredTopP: options.envConfig.structuredTopP,
structuredMaxTokens: options.envConfig.structuredMaxTokens,
```

Return the same fields from the main profile branch so explicit `model` options still see strict settings.

- [ ] **Step 6: Implement default strict API**

Add this helper near `createDefaultInvokeApi`:

```ts
function createDefaultInvokeStrictApi(options: {
  apiKey?: string;
  baseUrl?: string;
  model: string;
}): (
  request: OpenAiCompatibleStrictInvokeRequest,
) => Promise<OpenAiCompatibleStrictInvokeResult> {
  return async (request) => {
    if (!options.apiKey || !options.baseUrl) {
      throw new Error("LLM API key or base URL is not configured.");
    }

    if (request.options.strategy !== "tool_call") {
      throw new Error("strict_structured_strategy_not_supported");
    }

    const body: Record<string, unknown> = {
      model: options.model,
      messages: [
        {
          role: "system",
          content: request.prompt.body,
        },
        {
          role: "user",
          content: JSON.stringify(request.input, null, 2),
        },
      ],
      tools: [
        {
          type: "function",
          function: request.schema,
        },
      ],
      tool_choice: "auto",
    };

    if (request.options.temperature !== undefined) {
      body.temperature = request.options.temperature;
    }
    if (request.options.topP !== undefined) {
      body.top_p = request.options.topP;
    }
    if (request.options.maxTokens !== undefined) {
      body.max_tokens = request.options.maxTokens;
    }
    if (request.options.thinking === "disabled") {
      body.thinking = { type: "disabled" };
    }

    const response = await fetch(`${trimTrailingSlash(options.baseUrl)}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${options.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }

    const payload = await response.json();
    const rawOutput = JSON.stringify(payload);
    const argumentsJson = extractToolArguments(payload);

    return {
      rawOutput,
      argumentsJson,
    };
  };
}
```

Add tool argument parser:

```ts
function extractToolArguments(payload: unknown): string {
  const root = payload as {
    choices?: Array<{
      message?: {
        tool_calls?: Array<{
          function?: {
            arguments?: string;
          };
        }>;
      };
    }>;
  };

  const argumentsJson =
    root.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;

  if (typeof argumentsJson !== "string" || !argumentsJson.trim()) {
    throw new Error("strict_structured_tool_call_missing");
  }

  return argumentsJson;
}
```

- [ ] **Step 7: Run green provider tests**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/runtime/provider-hardening.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```powershell
git add backend/src/runtime/llm/openai-compatible-provider.ts tests/backend/runtime/provider-hardening.test.ts
git commit -m "实现严格结构化工具调用路径"
```

Expected: commit succeeds.

---

### Task 3: Gateway Strict Invocation Delegation

**Files:**
- Modify: `backend/src/runtime/llm/llm-gateway.ts`
- Modify: `tests/backend/runtime/prompt-runtime.test.ts`

- [ ] **Step 1: Write failing gateway test**

Add a test in `tests/backend/runtime/prompt-runtime.test.ts` after the existing gateway delegation test:

```ts
it("delegates invokeStrictStructured through the provider contract", async () => {
  const interactionLogWriter = {
    write: vi.fn(),
  };
  const provider: StructuredPromptProvider = {
    invokeStructuredPrompt: vi.fn(),
    invokeStrictStructured: vi.fn(async ({ prompt, input, operationName, schema, parse }) =>
      parse({
        promptId: prompt.metadata.id,
        input,
        operationName,
        schemaName: schema.name,
      }),
    ),
  };
  const gateway = createLlmGateway({
    provider,
    registry: createPromptRegistry(),
  });

  const result = await gateway.invokeStrictStructured<{
    promptId: string;
    input: unknown;
    operationName: string;
    schemaName: string;
  }>({
    promptId: "topic.selector",
    input: {
      selector_pool: [],
    },
    schema: {
      name: "select_topic_candidates",
      description: "Select topic candidates.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false,
      },
    },
    parse: (candidate) =>
      candidate as {
        promptId: string;
        input: unknown;
        operationName: string;
        schemaName: string;
      },
    interactionLogWriter,
  });

  expect(provider.invokeStrictStructured).toHaveBeenCalledTimes(1);
  expect(provider.invokeStrictStructured).toHaveBeenCalledWith(
    expect.objectContaining({
      input: {
        selector_pool: [],
      },
      operationName: "topic.selector",
      interactionLogWriter,
      schema: expect.objectContaining({
        name: "select_topic_candidates",
      }),
      prompt: expect.objectContaining({
        metadata: expect.objectContaining({
          id: "topic.selector",
          language: "zh-CN",
        }),
      }),
    }),
  );
  expect(result.schemaName).toBe("select_topic_candidates");
});
```

- [ ] **Step 2: Run red test**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/runtime/prompt-runtime.test.ts
```

Expected: FAIL because `LlmGateway.invokeStrictStructured` does not exist.

- [ ] **Step 3: Add gateway strict types and method**

In `backend/src/runtime/llm/llm-gateway.ts`, extend imports from `provider-contract.js`:

```ts
StrictStructuredInvocation,
StrictStructuredToolSchema,
StrictStructuredThinking,
StrictStructuredStrategy,
```

Add options interface:

```ts
export interface InvokeStrictStructuredOptions<T> {
  promptId: string;
  input: unknown;
  operationName?: string;
  schema: StrictStructuredToolSchema;
  parse: StrictStructuredInvocation<T>["parse"];
  options?: {
    strategy?: StrictStructuredStrategy;
    temperature?: number;
    topP?: number;
    maxTokens?: number;
    thinking?: StrictStructuredThinking;
  };
  interactionLogWriter?: LlmInteractionLogWriter;
}
```

Extend `LlmGateway`:

```ts
invokeStrictStructured<T>(options: InvokeStrictStructuredOptions<T>): Promise<T>;
```

Implement in `DefaultLlmGateway`:

```ts
async invokeStrictStructured<T>(
  options: InvokeStrictStructuredOptions<T>,
): Promise<T> {
  if (!this.provider.invokeStrictStructured) {
    throw classifyExternalError(
      new Error("strict_structured_provider_not_supported"),
      {
        provider: "llm",
        operation: options.operationName ?? options.promptId,
      },
    );
  }

  const prompt = this.registry.getPrompt(options.promptId);
  const operationName = options.operationName ?? options.promptId;

  try {
    return await this.provider.invokeStrictStructured<T>({
      prompt,
      input: options.input,
      operationName,
      schema: options.schema,
      parse: options.parse,
      options: options.options,
      interactionLogWriter: options.interactionLogWriter,
    });
  } catch (error) {
    throw classifyExternalError(error, {
      provider: "llm",
      operation: operationName,
    });
  }
}
```

- [ ] **Step 4: Run green gateway tests**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/runtime/prompt-runtime.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```powershell
git add backend/src/runtime/llm/llm-gateway.ts tests/backend/runtime/prompt-runtime.test.ts
git commit -m "开放严格结构化网关调用"
```

Expected: commit succeeds.

---

### Task 4: Topic Selector Strict Schema And Strict-First Invocation

**Files:**
- Modify: `backend/src/modules/topic/topic-recommendation.service.ts`
- Modify: `tests/backend/topic/topic-runtime-recommendation.test.ts`

- [ ] **Step 1: Write failing topic selector test**

Add a focused test in `tests/backend/topic/topic-runtime-recommendation.test.ts` near the existing selector tests:

```ts
it("uses strict structured invocation for topic.selector when the gateway supports it", async () => {
  const strictCalls: unknown[] = [];
  const structuredCalls: unknown[] = [];
  const gateway = {
    invokeStructuredPrompt: vi.fn(async (request) => {
      structuredCalls.push(request);
      return buildRawTopicCandidates();
    }),
    invokeStrictStructured: vi.fn(async (request) => {
      strictCalls.push(request);
      return {
        selected_candidate_ids: [
          "selector_candidate_1",
          "selector_candidate_2",
          "selector_candidate_3",
        ],
      };
    }),
  };

  const result = await recommendTopicCandidatesWithTrace(
    createInMemoryDb(),
    buildRecommendationSeed(),
    {
      llmGateway: gateway,
    },
  );

  expect(result.selector_trace?.selected_candidate_ids).toEqual([
    "selector_candidate_1",
    "selector_candidate_2",
    "selector_candidate_3",
  ]);
  expect(gateway.invokeStrictStructured).toHaveBeenCalledWith(
    expect.objectContaining({
      promptId: "topic.selector",
      schema: expect.objectContaining({
        name: "select_topic_candidates",
      }),
      options: expect.objectContaining({
        strategy: "tool_call",
        thinking: "disabled",
      }),
    }),
  );
  expect(
    structuredCalls.filter(
      (request) =>
        (request as { operationName?: string }).operationName === "topic.selector",
    ),
  ).toHaveLength(0);
  expect(strictCalls).toHaveLength(1);
});
```

If this file already has local helpers with different names, reuse the nearest existing helpers that produce at least eight raw candidates and a selector pool of at least three valid candidates. Keep the assertion names and strict invocation expectations.

- [ ] **Step 2: Write failing strict schema rejection test**

Add another selector test:

```ts
it("rejects strict topic.selector output that uses answer.selected_ids instead of selected_candidate_ids", async () => {
  const gateway = {
    invokeStructuredPrompt: vi.fn(async () => buildRawTopicCandidates()),
    invokeStrictStructured: vi.fn(async (request) =>
      request.parse({
        answer: {
          selected_ids: [
            "selector_candidate_1",
            "selector_candidate_2",
            "selector_candidate_3",
          ],
        },
      }),
    ),
  };

  await expect(
    recommendTopicCandidatesWithTrace(createInMemoryDb(), buildRecommendationSeed(), {
      llmGateway: gateway,
    }),
  ).rejects.toThrow("topic_selector_strict_schema_failed");
});
```

- [ ] **Step 3: Run red topic tests**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/topic/topic-runtime-recommendation.test.ts --no-file-parallelism
```

Expected: FAIL because `topic.selector` still calls `invokeStructuredPrompt` and the strict schema parser does not exist.

- [ ] **Step 4: Add strict selector schema**

In `backend/src/modules/topic/topic-recommendation.service.ts`, add near `TopicSelectorDecision`:

```ts
const TOPIC_SELECTOR_STRICT_SCHEMA = {
  name: "select_topic_candidates",
  description: "Select exactly three topic candidate ids from the selector pool.",
  parameters: {
    type: "object",
    properties: {
      selected_candidate_ids: {
        type: "array",
        items: {
          type: "string",
        },
        minItems: TOPIC_CANDIDATE_TARGET_COUNT,
        maxItems: TOPIC_CANDIDATE_TARGET_COUNT,
      },
    },
    required: ["selected_candidate_ids"],
    additionalProperties: false,
  },
} as const;
```

Add a strict parser:

```ts
function parseStrictSelectorDecision(rawOutput: unknown): TopicSelectorDecision {
  if (!rawOutput || typeof rawOutput !== "object" || Array.isArray(rawOutput)) {
    throw new Error("topic_selector_strict_schema_failed");
  }

  const record = rawOutput as Record<string, unknown>;
  const ids = record.selected_candidate_ids;

  if (!Array.isArray(ids)) {
    throw new Error("topic_selector_strict_schema_failed");
  }

  if (ids.some((candidateId) => typeof candidateId !== "string")) {
    throw new Error("topic_selector_strict_schema_failed");
  }

  const extraKeys = Object.keys(record).filter(
    (key) => key !== "selected_candidate_ids",
  );
  if (extraKeys.length > 0) {
    throw new Error("topic_selector_strict_schema_failed");
  }

  return {
    selected_candidate_ids: ids,
  };
}
```

- [ ] **Step 5: Use strict-first selector invocation**

Add helper:

```ts
async function invokeTopicSelector(input: {
  llmGateway: LlmGateway;
  selectorInput: unknown;
  interactionLogWriter?: {
    write: (...args: unknown[]) => Promise<void> | void;
  };
}): Promise<TopicSelectorDecision> {
  if (input.llmGateway.invokeStrictStructured) {
    return input.llmGateway.invokeStrictStructured<TopicSelectorDecision>({
      promptId: "topic.selector",
      input: input.selectorInput,
      schema: TOPIC_SELECTOR_STRICT_SCHEMA,
      parse: parseStrictSelectorDecision,
      options: {
        strategy: "tool_call",
        thinking: "disabled",
      },
      interactionLogWriter: input.interactionLogWriter,
    });
  }

  return normalizeSelectorDecision(
    await input.llmGateway.invokeStructuredPrompt<unknown>({
      promptId: "topic.selector",
      input: input.selectorInput,
      interactionLogWriter: input.interactionLogWriter,
    }),
  );
}
```

Replace the first selector call:

```ts
const firstDecision = await invokeTopicSelector({
  llmGateway: input.llmGateway,
  selectorInput: {
    recommendation_seed: input.input,
    selector_pool: input.selectorPool,
    recent_event_memory: input.recentEventMemory,
  },
  interactionLogWriter: input.interactionLogWriter,
});
```

Replace the repair selector call:

```ts
const repairDecision = await invokeTopicSelector({
  llmGateway: input.llmGateway,
  selectorInput: {
    recommendation_seed: input.input,
    selector_pool: input.selectorPool,
    recent_event_memory: input.recentEventMemory,
    repair_context: {
      missing_slot_count: firstPass.missingSlotCount,
      kept_candidate_ids: firstPass.selectedIds,
      excluded_candidate_ids: firstPass.excludedCandidateIds,
      excluded_event_identities: firstPass.excludedEventIdentities,
    },
  },
  interactionLogWriter: input.interactionLogWriter,
});
```

- [ ] **Step 6: Run green topic tests**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/topic/topic-runtime-recommendation.test.ts --no-file-parallelism
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```powershell
git add backend/src/modules/topic/topic-recommendation.service.ts tests/backend/topic/topic-runtime-recommendation.test.ts
git commit -m "让选题选择器优先使用严格结构化输出"
```

Expected: commit succeeds.

---

### Task 5: Topic Selector Prompt Contract Cleanup

**Files:**
- Modify: `prompts/topic/selector.prompt.md`
- Modify: `tests/backend/runtime/topic-prompt-contract.test.ts`

- [ ] **Step 1: Write failing prompt contract tests**

Add tests to `tests/backend/runtime/topic-prompt-contract.test.ts`:

```ts
it("keeps topic.selector prompt aligned with tool-call structured output", () => {
  const prompt = createPromptRegistry().getPrompt("topic.selector");

  expect(prompt.metadata.language).toBe("zh-CN");
  expect(prompt.body).toContain("select_topic_candidates");
  expect(prompt.body).toContain("selected_candidate_ids");
  expect(prompt.body).toContain("不要输出 answer、result、explanation 或任何解释字段");
});

it("does not invite topic.selector to attach explanations outside the schema", () => {
  const prompt = createPromptRegistry().getPrompt("topic.selector");

  expect(prompt.body).not.toContain("可附带说明");
  expect(prompt.body).not.toContain("解释选择理由");
});
```

If this repository's existing prompt contract tests contain mojibake strings, keep the new assertions in normal UTF-8 Chinese. Vitest loads source and prompt files as UTF-8.

- [ ] **Step 2: Run red prompt tests**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/runtime/topic-prompt-contract.test.ts
```

Expected: FAIL because the selector prompt has not yet declared the tool-call contract.

- [ ] **Step 3: Tighten selector prompt**

In `prompts/topic/selector.prompt.md`, keep the existing selection principles, recent-memory rules, concrete-event anchoring, and exactly-three requirement. Add a short output contract section:

```markdown
## 输出合同

你必须通过 `select_topic_candidates` 返回选择结果。

唯一正式字段是 `selected_candidate_ids`，必须且只能包含 3 个候选 `id`。

不要输出 answer、result、explanation 或任何解释字段；选择理由只体现在最终 id 组合中。
```

Remove or rewrite any sentence that says the selector may attach explanations or choose a wrapper object.

- [ ] **Step 4: Run green prompt tests**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/runtime/topic-prompt-contract.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```powershell
git add prompts/topic/selector.prompt.md tests/backend/runtime/topic-prompt-contract.test.ts
git commit -m "收紧选题选择器输出提示合同"
```

Expected: commit succeeds.

---

### Task 6: Focused Regression Suite

**Files:**
- No source changes expected.

- [ ] **Step 1: Run provider and prompt regressions**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/runtime/env-loading.test.ts tests/backend/runtime/provider-hardening.test.ts tests/backend/runtime/prompt-runtime.test.ts tests/backend/runtime/topic-prompt-contract.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run topic runtime regression serially**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/topic/topic-runtime-recommendation.test.ts --no-file-parallelism
```

Expected: PASS.

- [ ] **Step 3: Run topic API regression serially**

Run:

```powershell
npx vitest run --configLoader runner tests/backend/api/topic-api-runtime.test.ts --no-file-parallelism
```

Expected: PASS.

- [ ] **Step 4: Commit only if a test-only stabilization edit was needed**

If no files changed in this task, do not create an empty commit. If a test-only stabilization edit was needed, commit with:

```powershell
git add tests/backend/runtime/env-loading.test.ts tests/backend/runtime/provider-hardening.test.ts tests/backend/runtime/prompt-runtime.test.ts tests/backend/runtime/topic-prompt-contract.test.ts tests/backend/topic/topic-runtime-recommendation.test.ts tests/backend/api/topic-api-runtime.test.ts
git commit -m "稳定严格结构化输出回归测试"
```

---

### Task 7: GLM-5.1 Topic Selector Live Probe Record

**Files:**
- Create: `docs/records/2026-05-08-strict-structured-provider-topic-selector-probe.md`

- [ ] **Step 1: Confirm runtime env**

Run:

```powershell
$env:LLM_MODEL='glm-5.1'
$env:LLM_STRUCTURED_MODEL='glm-5.1'
$env:LLM_STRUCTURED_STRATEGY='tool_call'
$env:LLM_STRUCTURED_THINKING='disabled'
$env:LLM_STRUCTURED_TEMPERATURE='0.5'
$env:LLM_STRUCTURED_TOP_P='0.9'
$env:LLM_STRUCTURED_MAX_TOKENS='2048'
$env:LLM_TIMEOUT_MS='120000'
node -e "console.log(process.env.LLM_MODEL, process.env.LLM_STRUCTURED_MODEL, process.env.LLM_STRUCTURED_STRATEGY, process.env.LLM_STRUCTURED_THINKING)"
```

Expected output includes:

```text
glm-5.1 glm-5.1 tool_call disabled
```

- [ ] **Step 2: Run one live sample**

Run:

```powershell
$runId='2026-05-08-glm51-strict-selector-single'
npx tsx harness/scripts/runtime/topic-script-live-check.ts --sample harness/samples/topic-script/yanzi-shichu.sample.json --output-dir harness/scripts/runtime/output/$runId
```

Expected: command completes or fails with a concrete strict structured error code. Do not treat a failed probe as implementation failure unless unit tests also fail; record the provider shape and failure mode.

- [ ] **Step 3: Write probe record**

Create `docs/records/2026-05-08-strict-structured-provider-topic-selector-probe.md` with this structure:

```markdown
# Strict Structured Provider Topic Selector Probe

Date: 2026-05-08

## Configuration

- LLM_MODEL: glm-5.1
- LLM_STRUCTURED_MODEL: glm-5.1
- LLM_STRUCTURED_STRATEGY: tool_call
- LLM_STRUCTURED_THINKING: disabled
- LLM_STRUCTURED_TEMPERATURE: 0.5
- LLM_STRUCTURED_TOP_P: 0.9
- LLM_STRUCTURED_MAX_TOKENS: 2048
- LLM_TIMEOUT_MS: 120000

## Command

```powershell
npx tsx harness/scripts/runtime/topic-script-live-check.ts --sample harness/samples/topic-script/yanzi-shichu.sample.json --output-dir harness/scripts/runtime/output/2026-05-08-glm51-strict-selector-single
```

## Result

- Status: pass
- Topic selector structured status: tool_call arguments parsed and strict schema passed
- Topic selector selected ids: selector_candidate_1, selector_candidate_2, selector_candidate_3
- Script local validation: pass
- Semantic reviewer: shadow-only result recorded

## Raw Shape Notes

- The provider returned `message.tool_calls[0].function.arguments`.
- Arguments contained only `selected_candidate_ids`.
- No `answer`, `result`, or `explanation` wrapper was accepted.

## Conclusion

The strict tool-call path is viable for this sample. It should remain opt-in until at least one five-round run confirms no provider-shape instability.
```

If the probe fails, replace `Status: pass` with `Status: fail` and write the exact observed error code, raw response shape, and whether the failure was request rejection, missing tool call, arguments parse failure, schema failure, business validation failure, timeout, or rate limit.

- [ ] **Step 4: Optional five-round run after single-sample pass**

Only run this if Step 2 passed:

```powershell
$runId='2026-05-08-glm51-strict-selector-five-round'
npm run harness:topic-script-five-round-quality-check -- --output-dir harness/scripts/runtime/output/$runId
```

Expected: command completes. Present each round's script text to the user before interpreting quality.

- [ ] **Step 5: Commit probe record**

Run:

```powershell
git add docs/records/2026-05-08-strict-structured-provider-topic-selector-probe.md
git commit -m "记录严格结构化选题选择器探测结果"
```

Expected: commit succeeds.

---

## Final Verification Before Completion

Before claiming completion, use `superpowers:verification-before-completion` and run:

```powershell
npx vitest run --configLoader runner tests/backend/runtime/env-loading.test.ts tests/backend/runtime/provider-hardening.test.ts tests/backend/runtime/prompt-runtime.test.ts tests/backend/runtime/topic-prompt-contract.test.ts
```

Then run:

```powershell
npx vitest run --configLoader runner tests/backend/topic/topic-runtime-recommendation.test.ts tests/backend/api/topic-api-runtime.test.ts --no-file-parallelism
```

Then run:

```powershell
git status --short
```

Completion criteria:

- Unit and runtime tests pass.
- `topic.selector` strict path is opt-in and does not change writer/reviewer behavior.
- No generated `storage/topic-candidate-library/` files are staged.
- Any `.env.example` edits are intentional, scoped, and staged separately from unrelated local changes.
- At least one probe record exists if live GLM-5.1 verification was attempted.

## Rollback Plan

If GLM-5.1 tool-call probe is unstable after code tests pass:

- Keep the provider capability code and tests.
- Do not recommend `LLM_STRUCTURED_STRATEGY=tool_call` as the default.
- Set runtime back to `LLM_STRUCTURED_STRATEGY=json_object`.
- Record the exact provider failure shape in the probe record.
- Continue using `LLM_STRUCTURED_MODEL=glm-4` for strict structured production-like runs until a provider-specific adapter is designed.

## Self-Review

Spec coverage:

- Provider capability layer: Task 1 and Task 2.
- GLM-5.1 strict structured tool-call proof: Task 2 and Task 7.
- Topic selector only: Task 4 and Task 5.
- No writer/reviewer/downstream migration: enforced in Scope and Shared Constraints.
- TDD and verification: every implementation task starts with failing tests and has exact Vitest commands.

Placeholder scan:

- This plan does not use open-ended implementation placeholders.
- Commands name concrete files.
- Optional stabilization commits list the concrete tracked test files that may be affected.

Type consistency:

- `StrictStructuredInvocation<T>` is defined in Task 1.
- `invokeStrictStructured<T>` uses the same generic signature in provider and gateway.
- `StrictStructuredToolSchema` is shared between provider, gateway, and topic selector.
- `selected_candidate_ids` remains the only accepted selector output field in the strict path.
