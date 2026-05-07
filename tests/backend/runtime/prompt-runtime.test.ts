import { describe, expect, it, vi } from "vitest";

import { createLlmGateway } from "../../../backend/src/runtime/llm/llm-gateway.js";
import { renderLlmInteractionMarkdown } from "../../../backend/src/runtime/llm/interaction-log.js";
import type { StructuredPromptProvider } from "../../../backend/src/runtime/llm/provider-contract.js";
import { createPromptRegistry } from "../../../backend/src/runtime/prompts/prompt-registry.js";

describe("prompt runtime", () => {
  it("loads topic.candidate-builder from harness prompts with zh-CN metadata", () => {
    const registry = createPromptRegistry();

    const prompt = registry.getPrompt("topic.candidate-builder");

    expect(prompt.metadata.id).toBe("topic.candidate-builder");
    expect(prompt.metadata.language).toBe("zh-CN");
    expect(prompt.filePath.replace(/\\/g, "/")).toContain("/harness/prompts/topic/");
    expect(prompt.body).toContain("根据当前推荐种子");
  });

  it("keeps prompt metadata zh-CN and includes diversity instructions for open discovery", () => {
    const registry = createPromptRegistry();

    const prompt = registry.getPrompt("topic.candidate-builder");

    expect(prompt.metadata.language).toBe("zh-CN");
    expect(prompt.body).toContain("开放发现差异化要求");
    expect(prompt.body).toMatch(/事件.*多样性/);
    expect(prompt.body).toMatch(/角度.*明显不同/);
  });

  it("keeps builder focused on open discovery while reusing prior event identities from recent memory", () => {
    const registry = createPromptRegistry();

    const prompt = registry.getPrompt("topic.candidate-builder");

    expect(prompt.body).toContain("recent_event_memory");
    expect(prompt.body).toContain("复用已有");
    expect(prompt.body).toContain("`event_identity`");
  });

  it("keeps builder source expansion lightweight while preventing recent hot events from dominating the raw pool", () => {
    const registry = createPromptRegistry();

    const prompt = registry.getPrompt("topic.candidate-builder");

    expect(prompt.body).toContain("原始 8 候选");
    expect(prompt.body).toContain("大多数槽位");
    expect(prompt.body).toContain("朝代分布");
    expect(prompt.body).toContain("冲突类型");
    expect(prompt.body).toContain("叙事结构");
    expect(prompt.body).not.toContain("至少覆盖 3 个朝代");
  });

  it("gives builder a single legal TopicCandidateCard[] output skeleton", () => {
    const registry = createPromptRegistry();

    const prompt = registry.getPrompt("topic.candidate-builder");

    expect(prompt.body).toContain("唯一合法输出骨架");
    expect(prompt.body).toContain("`TopicCandidateCard[]`");
    expect(prompt.body).toContain("\"event_identity\"");
    expect(prompt.body).toContain("\"title\"");
    expect(prompt.body).toContain("\"one_line_angle\"");
    expect(prompt.body).toContain("\"family_label\"");
    expect(prompt.body).toContain("\"scope_label\"");
    expect(prompt.body).not.toContain("\"TopicCandidateCard\": [");
  });

  it("keeps builder-repair focused on filling missing fields without reopening discovery", () => {
    const registry = createPromptRegistry();

    const prompt = registry.getPrompt("topic.candidate-builder-repair");

    expect(prompt.metadata.language).toBe("zh-CN");
    expect(prompt.body).toContain("缺失字段");
    expect(prompt.body).toContain("不重开候选发现");
    expect(prompt.body).toContain("不得新增候选");
    expect(prompt.body).toContain("不得改写已有 `event_identity`");
  });

  it("normalizes annotation lines before rendering markdown interaction notes", () => {
    const markdown = renderLlmInteractionMarkdown({
      sequence: 1,
      generatedAt: "2026-04-29T00:00:00.000Z",
      provider: "stub",
      model: "stub",
      operationName: "topic.candidate-builder",
      promptId: "topic.candidate-builder",
      promptStage: "topic",
      promptLanguage: "zh-CN",
      promptFilePath: "harness/prompts/topic/candidate-builder.prompt.md",
      systemPrompt: "prompt",
      input: {
        seed: "topic",
      },
      rawOutput: "[]",
      parsedOutput: [],
      annotations: ["候选保留：第一槽位\n- 注入项\n```code```"],
      errorMessage: null,
    });

    expect(markdown).toContain("## 归因注记");
    expect(markdown).toContain("- 候选保留：第一槽位");
    expect(markdown).not.toContain("\n- 注入项");
    expect(markdown).not.toContain("```code```");
  });

  it("loads script.script-writer through registry compatibility lookup", () => {
    const registry = createPromptRegistry();

    const prompt = registry.getPrompt("script.script-writer");

    expect(prompt.metadata.id).toBe("script.writer");
    expect(prompt.aliases).toContain("script.script-writer");
    expect(prompt.metadata.language).toBe("zh-CN");
    expect(prompt.filePath.replace(/\\/g, "/")).toContain("/harness/prompts/script/");
  });

  it("keeps script writer opening contract scene-grounded without treating hook_claim as a draft template", () => {
    const prompt = createPromptRegistry().getPrompt("script.writer");

    expect(prompt.metadata.language).toBe("zh-CN");
    expect(prompt.body).toContain("再立刻落到具体历史场面、动作或危险局面");
    expect(prompt.body).toContain("`hook_claim` 只是包装 promise 弱参考");
    expect(prompt.body).toContain("不能机械复述或照搬");
    expect(prompt.body).toContain("不使用固定统一开头模板");
    expect(prompt.body).not.toContain(
      "前两句必须直接复用 `hook_claim` 或 `strong_scene`",
    );
  });

  it("requires script writer openings to break the fourth wall before entering the scene", () => {
    const prompt = createPromptRegistry().getPrompt("script.writer");

    expect(prompt.metadata.language).toBe("zh-CN");
    expect(prompt.body).toContain("破壁开头");
    expect(prompt.body).toContain("先用一句面向观众的反问或短判断");
    expect(prompt.body).toContain("再立刻落到具体历史场面");
    expect(prompt.body).toContain("不得为了开头铺垫而空泛解释背景");
    expect(prompt.body).toContain("不使用固定统一开头模板");
  });

  it("keeps script writer focused on oral story drafts instead of summaries", () => {
    const prompt = createPromptRegistry().getPrompt("script.writer");

    expect(prompt.metadata.language).toBe("zh-CN");
    expect(prompt.body).toContain("不能写成摘要稿");
    expect(prompt.body).toContain("每个 `must_include_beats` 要写成局面推进");
    expect(prompt.body).toContain("至少一个核心场面包含人物、动作、压力源、即时后果");
    expect(prompt.body).toContain("问句后必须进入具体场面");
    expect(prompt.body).toContain("结尾要留下代价、反讽或判断");
  });

  it("keeps script writer endings anchored to residue instead of generic historical praise", () => {
    const prompt = createPromptRegistry().getPrompt("script.writer");

    expect(prompt.metadata.language).toBe("zh-CN");
    expect(prompt.body).toContain("ending_span");
    expect(prompt.body).toContain("代价、反讽、未平后果或场景内判断");
    expect(prompt.body).toContain("不要默认写成改变历史、成为典范、留名史册式空泛收尾");
  });

  it("tells script writer to honor regen context structural floors without changing topic contract", () => {
    const prompt = createPromptRegistry().getPrompt("script.writer");

    expect(prompt.metadata.language).toBe("zh-CN");
    expect(prompt.body).toContain("`regeneration_context`");
    expect(prompt.body).toContain("不得改写 `TopicPackage`");
    expect(prompt.body).toContain("min_script_chars_for_band");
    expect(prompt.body).toContain("min_sentence_count_for_band");
    expect(prompt.body).toContain("下限");
  });

  it("requires thin-draft regeneration to expand existing beats instead of rephrasing the same short draft", () => {
    const prompt = createPromptRegistry().getPrompt("script.writer");

    expect(prompt.metadata.language).toBe("zh-CN");
    expect(prompt.body).toContain("如 `regeneration_context` 指出 `script_body_too_thin`");
    expect(prompt.body).toContain("必须沿用既有 `must_include_beats` 扩写");
    expect(prompt.body).toContain("新增场景动作、对方反应、压力后果");
    expect(prompt.body).toContain("不得只重排、改写或缩短上一稿");
  });

  it("requires thin-draft regeneration to clear the floor comfortably with beat-level substance", () => {
    const prompt = createPromptRegistry().getPrompt("script.writer");

    expect(prompt.metadata.language).toBe("zh-CN");
    expect(prompt.body).toContain("script_body_too_thin");
    expect(prompt.body).toContain("不能只刚刚贴线");
    expect(prompt.body).toContain("要明显高于 `min_script_chars_for_band`");
    expect(prompt.body).toContain("每条 beat 至少补足一个动作、一个反应、一个后果");
    expect(prompt.body).toContain("不得写成比上一稿稍长一点的压缩摘要");
  });

  it("requires sparse-material thin regen to add pre-action reaction and consequence around existing beats", () => {
    const prompt = createPromptRegistry().getPrompt("script.writer");

    expect(prompt.metadata.language).toBe("zh-CN");
    expect(prompt.body).toContain("script_body_too_thin");
    expect(prompt.body).toContain("quote_trace");
    expect(prompt.body).toContain("动作前一拍");
    expect(prompt.body).toContain("即时反应");
    expect(prompt.body).toContain("后果句");
    expect(prompt.body).toContain("不得新增人物、事件、结局或改写因果");
    expect(prompt.body).toContain("可以补原场景内不改变事实的动作、反应、停顿、目光、场面压力");
  });

  it("requires medium body volume to come from narrative substance instead of padding", () => {
    const prompt = createPromptRegistry().getPrompt("script.writer");

    expect(prompt.metadata.language).toBe("zh-CN");
    expect(prompt.body).toContain("`medium` 首稿正文至少约 240 个汉字等价长度");
    expect(prompt.body).toContain("85 秒稿不能只有 190-200 字");
    expect(prompt.body).toContain("只能用场景、动作、对话或转述、压力升级、即时后果补足体量");
    expect(prompt.body).toContain("不得为了凑字数重复解释、空泛评价或喊口号");
  });

  it("requires each script beat to become a developed narrative unit instead of compressed coverage", () => {
    const prompt = createPromptRegistry().getPrompt("script.writer");

    expect(prompt.metadata.language).toBe("zh-CN");
    expect(prompt.body).toContain("每条 `must_include_beats` 至少展开成一个叙事单元");
    expect(prompt.body).toContain("不能只用一句话点名后立刻跳到下一条 beat");
    expect(prompt.body).toContain("人物动作、对方反应、场面压力、即时后果");
    expect(prompt.body).toContain("三条 beat 不能压缩成列表式交代");
  });

  it("loads script.semantic-reviewer from harness prompts with zh-CN metadata", () => {
    const registry = createPromptRegistry();

    const prompt = registry.getPrompt("script.semantic-reviewer");

    expect(prompt.metadata.id).toBe("script.semantic-reviewer");
    expect(prompt.metadata.language).toBe("zh-CN");
    expect(prompt.body).toContain("执行单一语义审校");
  });

  it("keeps script semantic reviewer calibrated for off-contract and weak-lift boundaries", () => {
    const prompt = createPromptRegistry().getPrompt("script.semantic-reviewer");

    expect(prompt.metadata.language).toBe("zh-CN");
    expect(prompt.body).toContain("完全换成无关题材");
    expect(prompt.body).toContain("优先判为 `return_topic`");
    expect(prompt.body).toContain("结构覆盖但表达像梗概");
    expect(prompt.body).toContain("可判 `patch_once/lift`");
    expect(prompt.body).toContain("不能因此压低首稿通过率");
    expect(prompt.body).toContain("不能仅因所有 `must_include_beats` 已覆盖就判 `pass`");
  });

  it("invokes script.semantic-reviewer through the prompt registry and llm gateway", async () => {
    const { reviewScriptSemantics } = await import(
      "../../../backend/src/modules/script/script-semantic-review.service.js"
    );
    const { createOpenAiCompatibleProvider } = await import(
      "../../../backend/src/runtime/llm/openai-compatible-provider.js"
    );
    const reviewerOutput = {
      stage: "script_semantic_review",
      decision: "patch_once",
      patch_intent: "lift",
      hard_issues: [],
      soft_issues: ["hook_kill_power_weak"],
      patch_targets: ["opening"],
      summary: "开头抓力不足，建议只做影子评估记录。",
      confidence: 0.78,
    };
    const invokeApi = vi.fn(async () => JSON.stringify(reviewerOutput));
    const gateway = createLlmGateway({
      registry: createPromptRegistry(),
      provider: createOpenAiCompatibleProvider({
        model: "glm-4.5",
        invokeApi,
      }),
    });

    const bundle = {
      hard_lane: {
        must_include_beats: ["入楚受辱"],
        scope_label: "完整事件",
        selected_angle: "楚王连压三次，晏子一次没退。",
      },
      soft_lane: {
        narrative_tension_map: {
          hook_claim: "楚王连压三次",
          pressure_escalation: "压力逐层升级",
          mid_reveal: "晏子守住场面",
          peak_payoff: "橘枳之喻顶回去",
          ending_residue: "一退就不只是退掉自己",
        },
      },
    };
    const draft = {
      script_text: "楚王连续压场，晏子一句句顶回去。",
      opening_span: "楚王连续压场，晏子一句句顶回去。",
      ending_span: "一退就不只是退掉自己。",
    };

    const result = await reviewScriptSemantics({
      bundle,
      draft,
      llmGateway: gateway,
    } as any);

    expect(result).toMatchObject(reviewerOutput);
    expect(invokeApi).toHaveBeenCalledWith(
      expect.objectContaining({
        operationName: "script.semantic-reviewer",
        prompt: expect.objectContaining({
          metadata: expect.objectContaining({
            id: "script.semantic-reviewer",
            language: "zh-CN",
          }),
        }),
        input: {
          bundle,
          draft,
        },
      }),
    );
  });

  it("delegates invokeStructuredPrompt through the provider contract", async () => {
    const interactionLogWriter = {
      write: vi.fn(),
    };
    const provider: StructuredPromptProvider = {
      invokeStructuredPrompt: vi.fn(async ({ prompt, input, operationName }) => ({
        promptId: prompt.metadata.id,
        input,
        operationName,
      })),
    };
    const gateway = createLlmGateway({
      provider,
      registry: createPromptRegistry(),
    });

    const result = await gateway.invokeStructuredPrompt<{
      promptId: string;
      input: unknown;
      operationName: string;
    }>({
      promptId: "topic.candidate-builder",
      input: {
        requestId: "seed-1",
      },
      interactionLogWriter,
    });

    expect(provider.invokeStructuredPrompt).toHaveBeenCalledTimes(1);
    expect(provider.invokeStructuredPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        input: {
          requestId: "seed-1",
        },
        operationName: "topic.candidate-builder",
        interactionLogWriter,
        prompt: expect.objectContaining({
          metadata: expect.objectContaining({
            id: "topic.candidate-builder",
            language: "zh-CN",
          }),
        }),
      }),
    );
    expect(result).toEqual({
      promptId: "topic.candidate-builder",
      input: {
        requestId: "seed-1",
      },
      operationName: "topic.candidate-builder",
    });
  });

  it("classifies rate limits as retryable external service errors and retries once", async () => {
    const { ExternalServiceError, withRetry } = await import(
      "../../../backend/src/runtime/llm/external-errors.js"
    );

    let attempts = 0;
    const result = await withRetry(
      async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("429 rate limit exceeded");
        }

        return "ok";
      },
      {
        provider: "llm",
        operation: "topic.candidate-builder",
        maxAttempts: 2,
        baseDelayMs: 0,
        maxDelayMs: 0,
      },
    );

    expect(result).toBe("ok");
    expect(attempts).toBe(2);

    try {
      await withRetry(
        async () => {
          throw new Error("401 unauthorized api key");
        },
        {
          provider: "llm",
          operation: "topic.candidate-builder",
          maxAttempts: 1,
          baseDelayMs: 0,
          maxDelayMs: 0,
        },
      );
    } catch (error) {
      expect(error).toBeInstanceOf(ExternalServiceError);
      expect(error).toMatchObject({
        retryable: false,
        code: "configuration",
        operation: "topic.candidate-builder",
        provider: "llm",
      });
    }
  });

  it("uses the openai-compatible provider through the unified prompt contract", async () => {
    const { createOpenAiCompatibleProvider } = await import(
      "../../../backend/src/runtime/llm/openai-compatible-provider.js"
    );
    const invokeApi = vi.fn(async ({ prompt, input, operationName }) =>
      JSON.stringify({
        promptId: prompt.metadata.id,
        operationName,
        input,
      }),
    );
    const provider = createOpenAiCompatibleProvider({
      model: "glm-4.5",
      invokeApi,
    });
    const prompt = createPromptRegistry().getPrompt("topic.candidate-builder");

    const result = await provider.invokeStructuredPrompt<{
      promptId: string;
      operationName: string;
      input: { seed: string };
    }>({
      prompt,
      input: {
        seed: "family-slot",
      },
      operationName: "topic.candidate-builder",
    });

    expect(invokeApi).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt,
        input: {
          seed: "family-slot",
        },
        operationName: "topic.candidate-builder",
        model: "glm-4.5",
      }),
    );
    expect(result).toEqual({
      promptId: "topic.candidate-builder",
      operationName: "topic.candidate-builder",
      input: {
        seed: "family-slot",
      },
    });
  });

  it("retries timeout failures inside the openai-compatible provider", async () => {
    const { createOpenAiCompatibleProvider } = await import(
      "../../../backend/src/runtime/llm/openai-compatible-provider.js"
    );
    const invokeApi = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("request timeout"), { name: "AbortError" }))
      .mockResolvedValueOnce('{"ok":true}');
    const provider = createOpenAiCompatibleProvider({
      model: "glm-4.5",
      invokeApi,
      timeoutMs: 10,
      maxAttempts: 2,
      baseDelayMs: 0,
      maxDelayMs: 0,
    });

    const result = await provider.invokeStructuredPrompt<{ ok: boolean }>({
      prompt: createPromptRegistry().getPrompt("topic.candidate-builder"),
      input: {
        seed: "family-slot",
      },
      operationName: "topic.candidate-builder",
    });

    expect(invokeApi).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ ok: true });
  });

  it("runs deterministic recovery before auto-fix for structured output repair", async () => {
    const { createStructuredOutputFixer } = await import(
      "../../../backend/src/runtime/llm/structured-output-fix.js"
    );
    const autoFix = vi.fn(async () => '{"value": 3}');
    const fixer = createStructuredOutputFixer({
      autoFix,
    });

    const result = await fixer.fix<{ value: number }>({
      operationName: "topic.candidate-builder",
      rawOutput: '{"value": 2',
      parse: (candidate) => JSON.parse(candidate) as { value: number },
      deterministicRecovery: (rawOutput) => `${rawOutput}}`,
    });

    expect(result).toEqual({ value: 2 });
    expect(autoFix).not.toHaveBeenCalled();
  });

  it("falls back to auto-fix after deterministic recovery cannot repair structured output", async () => {
    const { createStructuredOutputFixer } = await import(
      "../../../backend/src/runtime/llm/structured-output-fix.js"
    );
    const autoFix = vi.fn(async ({ rawOutput }) => {
      expect(rawOutput).toBe("not-json");
      return '{"value": 4}';
    });
    const fixer = createStructuredOutputFixer({
      autoFix,
    });

    const result = await fixer.fix<{ value: number }>({
      operationName: "script.semantic-reviewer",
      rawOutput: "not-json",
      parse: (candidate) => JSON.parse(candidate) as { value: number },
      deterministicRecovery: () => null,
    });

    expect(autoFix).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ value: 4 });
  });
  it("keeps selector focused on choosing from the pool while considering recent event memory", () => {
    const prompt = createPromptRegistry().getPrompt("topic.selector");

    expect(prompt.metadata.language).toBe("zh-CN");
    expect(prompt.body).toContain("recent_event_memory");
    expect(prompt.body).toContain("语义上等价或明显过近");
  });
});
