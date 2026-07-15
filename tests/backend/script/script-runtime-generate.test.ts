import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  ScriptDraftPackage,
  ScriptInputBundle,
  TopicDeliveryPack,
  TopicPackage,
} from "../../../shared/src/index.js";
import { createDbClient } from "../../../backend/src/db/client.js";
import { createProject } from "../../../backend/src/modules/projects/project.repository.js";
import { generateScriptDraft } from "../../../backend/src/modules/script/script-generation.service.js";
import { validateScriptDraft } from "../../../backend/src/modules/script/script-local-validator.js";
import { runScriptGeneration } from "../../../backend/src/modules/script/script-run.service.js";
import { saveTopicPackage } from "../../../backend/src/modules/topic/topic-package.repository.js";
import type { LlmInteractionLogEntry } from "../../../backend/src/runtime/llm/interaction-log.js";
import { createLlmGateway } from "../../../backend/src/runtime/llm/llm-gateway.js";
import { createOpenAiCompatibleProvider } from "../../../backend/src/runtime/llm/openai-compatible-provider.js";

function env(content: string) {
  return { rawOutput: content, content, metadata: {} };
}
import { createPromptRegistry } from "../../../backend/src/runtime/prompts/prompt-registry.js";
import { getProjectStorageProfile } from "../../../backend/src/runtime/trace/project-storage.js";

const topicPackage = TopicPackage.parse({
  topic_id: "topic_yanzi_shichu",
  title: "晏子使楚",
  selected_angle: "楚王不是只压了晏子一次，而是连压三次。",
  family_label: "外交压场",
  scope_label: "完整事件",
  core_conflict:
    "楚王借公开场合连续羞辱晏子与齐国，晏子必须当场顶回去。",
  stakes:
    "一旦退让，丢掉的不只是晏子个人体面，而是齐国在楚廷上的国格。",
  strong_scene: "楚王连续压场，晏子一句句顶回去。",
  packaging_seed: "楚王连压三次，晏子一次没退。",
  must_include_beats: ["入楚受辱", "橘枳之喻"],
  forbidden_expansions: ["不要扩写到未设计的 downstream 阶段"],
  risk_hints: ["不要写成课堂导入"],
  source_anchor_refs: ["《晏子春秋》"],
  canonical_quotes: ["橘生淮南则为橘"],
  ambiguity_notes: [],
  duration_band: "medium",
  narrative_tension_map: {
    hook_claim: "楚王不是只压了晏子一次，而是连压三次",
    pressure_escalation:
      "从羞辱身形升级到羞辱齐国，再升级到羞辱齐人的风土。",
    mid_reveal: "晏子不是在逞口舌，而是在守住齐国的场面。",
    peak_payoff: "橘枳之喻把第三次压场原样顶回。",
    ending_residue: "这种场面，一退就不只是退掉自己。",
  },
});

const topicDeliveryPack = TopicDeliveryPack.parse({
  opening_move: "question",
  opening_pressure_level: "high",
  voice_tilt: "sharper",
  pacing_tilt: "fast",
  ending_tilt: "judgment",
  visual_tilt: ["faces", "courtroom"],
  hook_claim: "楚王连压三次，晏子为什么一次都没退？",
  hook_emotion: "压迫",
  reveal_position: "mid",
  caution_notes: [
    "不要把 hook 写成课堂导入",
    "不要让包装 promise 偏离 narrative_tension_map.hook_claim",
  ],
});

const localValidationPassingStakes = `${topicPackage.stakes} 这不是一句抽象评价，而是当场所有人的目光、楚王的逼问、齐国使者的退路同时压到一个人身上；只要他慢一拍，后面的羞辱就会继续落下来。`;

type ScriptGenerationResponse = Awaited<ReturnType<typeof runScriptGeneration>>;
type ScriptGenerationSuccessBody = Exclude<
  ScriptGenerationResponse["body"],
  { error: string }
>;

const scriptInputBundle = ScriptInputBundle.parse({
  topic_package: topicPackage,
  topic_delivery_pack: topicDeliveryPack,
  hard_lane: {
    event_identity: "晏子使楚",
    selected_angle: topicPackage.selected_angle,
    scope_label: topicPackage.scope_label,
    core_conflict: topicPackage.core_conflict,
    stakes: topicPackage.stakes,
    must_include_beats: topicPackage.must_include_beats,
    forbidden_expansions: topicPackage.forbidden_expansions,
    source_anchor_refs: topicPackage.source_anchor_refs,
    canonical_quotes: topicPackage.canonical_quotes,
    ambiguity_notes: topicPackage.ambiguity_notes,
    duration_band: topicPackage.duration_band,
  },
  soft_lane: {
    narrative_tension_map: topicPackage.narrative_tension_map,
    strong_scene: topicPackage.strong_scene,
    voice_hint: "冷静压迫型旁白 / sharper",
  },
  packaging_lane: {
    hook_claim: topicDeliveryPack.hook_claim,
    hook_emotion: topicDeliveryPack.hook_emotion,
    reveal_position: topicDeliveryPack.reveal_position,
    title_profile: "conflict_first",
    cover_profile: "faces_closeup",
    risk_posture: "controlled",
  },
});

const runtimeDraft = ScriptDraftPackage.parse({
  script_text:
    "楚王第一次压晏子的时候，压的不是身高，而是齐国的面子。可晏子没有退，他知道今天只要退一次，后面每一次都会压上来。入楚受辱只是开始，真正厉害的是他把每次当众羞辱都原样顶了回去。到橘枳之喻落下来时，楚国想压人的场面已经反过来变成自己失手的场面。这件事真正狠的地方，不是晏子会说，而是他敢在众人面前一次不退。",
  estimated_duration_sec: 86,
  beat_trace: [
    {
      beat: "入楚受辱",
      excerpt: "入楚受辱只是开始",
      confidence: 0.95,
    },
    {
      beat: "橘枳之喻",
      excerpt: "到橘枳之喻落下来时",
      confidence: 0.96,
    },
  ],
  quote_trace: [
    {
      quote: "橘生淮南则为橘",
      usage_type: "exact",
      excerpt: "到橘枳之喻落下来时",
    },
  ],
  opening_span: "楚王第一次压晏子的时候，压的不是身高，而是齐国的面子。",
  ending_span:
    "这件事真正狠的地方，不是晏子会说，而是他敢在众人面前一次不退。",
});

describe("script runtime generate", () => {
  it("sends ScriptInputBundle into the formal script-writer prompt and returns a ScriptDraftPackage", async () => {
    const invokeApi = vi.fn(async () => ({ rawOutput: JSON.stringify(runtimeDraft), content: JSON.stringify(runtimeDraft), metadata: {} }));
    const gateway = createLlmGateway({
      registry: createPromptRegistry(),
      provider: createOpenAiCompatibleProvider({
        model: "glm-4.5",
        invokeApi,
      }),
    });

    const draft = await (generateScriptDraft as any)({
      bundle: scriptInputBundle,
      llmGateway: gateway,
    });

    expect(invokeApi).toHaveBeenCalledTimes(1);
    expect(invokeApi).toHaveBeenCalledWith(
      expect.objectContaining({
        operationName: "script.writer",
        prompt: expect.objectContaining({
          metadata: expect.objectContaining({
            id: "script.writer",
            language: "zh-CN",
          }),
        }),
        input: scriptInputBundle,
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(() => ScriptDraftPackage.parse(draft)).not.toThrow();
    expect(draft.script_text).toContain("楚王");
  });

  it("passes regen context into the script-writer prompt input without changing the bundle", async () => {
    const invokeApi = vi.fn(async () => ({ rawOutput: JSON.stringify(runtimeDraft), content: JSON.stringify(runtimeDraft), metadata: {} }));
    const gateway = createLlmGateway({
      registry: createPromptRegistry(),
      provider: createOpenAiCompatibleProvider({
        model: "glm-4.5",
        invokeApi,
      }),
    });
    const regenerationContext = {
      reason: "local_validation_regen_once" as const,
      errors: ["script_body_too_thin"],
      metrics: {
        script_char_count: 67,
        script_sentence_count: 3,
        min_script_chars_for_band: 240,
        min_sentence_count_for_band: 7,
      },
    };

    await generateScriptDraft({
      bundle: scriptInputBundle,
      llmGateway: gateway,
      regenerationContext,
    } as any);

    expect(invokeApi).toHaveBeenCalledWith(
      expect.objectContaining({
        operationName: "script.writer",
        input: {
          bundle: scriptInputBundle,
          regeneration_context: regenerationContext,
        },
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(scriptInputBundle).not.toHaveProperty("regeneration_context");
  });

  it("reports deterministic stub drafts below the current first-draft body floor", async () => {
    const draft = await generateScriptDraft({
      bundle: scriptInputBundle,
    });
    const validation = validateScriptDraft({
      bundle: scriptInputBundle,
      draft,
    });

    expect(draft.opening_span).toBe(topicPackage.strong_scene);
    expect(draft.script_text).toMatch(
      new RegExp(`^${topicPackage.strong_scene.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
    );
    expect(draft.script_text).not.toContain("公开压场");
    expect(validation.decision).toBe("regen_once");
    expect(validation.errors).toContain("script_body_too_thin");
    expect(validation.metrics).toMatchObject({
      min_script_chars_for_band: 320,
      min_sentence_count_for_band: 8,
    });
  });

  it("traces every canonical quote used by deterministic stub drafts", async () => {
    const twoQuoteTopicPackage = TopicPackage.parse({
      ...topicPackage,
      canonical_quotes: [
        "使狗国者，从狗门入",
        "橘生淮南则为橘",
      ],
      must_include_beats: [
        "使狗国者，从狗门入",
        "橘生淮南则为橘",
      ],
      narrative_tension_map: {
        ...topicPackage.narrative_tension_map,
        ending_residue: "橘生淮南则为橘",
      },
    });
    const twoQuoteBundle = ScriptInputBundle.parse({
      ...scriptInputBundle,
      topic_package: twoQuoteTopicPackage,
      hard_lane: {
        ...scriptInputBundle.hard_lane,
        must_include_beats: twoQuoteTopicPackage.must_include_beats,
        canonical_quotes: twoQuoteTopicPackage.canonical_quotes,
      },
      soft_lane: {
        ...scriptInputBundle.soft_lane,
        narrative_tension_map: twoQuoteTopicPackage.narrative_tension_map,
      },
    });

    const draft = await generateScriptDraft({
      bundle: twoQuoteBundle,
    });
    const validation = validateScriptDraft({
      bundle: twoQuoteBundle,
      draft,
    });

    expect(draft.script_text).toContain("使狗国者，从狗门入");
    expect(draft.script_text).toContain("橘生淮南则为橘");
    expect(draft.quote_trace.map((trace) => trace.quote)).toEqual([
      "使狗国者，从狗门入",
      "橘生淮南则为橘",
    ]);
    expect(validation.errors).not.toContain("quote_trace_incomplete");
    expect(validation.errors).toContain("script_body_too_thin");
    expect(validation.decision).toBe("regen_once");
  });

  it("repairs minimally malformed runtime output before validating ScriptDraftPackage", async () => {
    const invokeApi = vi.fn(
      async () => env(`\`\`\`json
${JSON.stringify(runtimeDraft)}
\`\`\``),
    );
    const gateway = createLlmGateway({
      registry: createPromptRegistry(),
      provider: createOpenAiCompatibleProvider({
        model: "glm-4.5",
        invokeApi,
      }),
    });

    const draft = await (generateScriptDraft as any)({
      bundle: scriptInputBundle,
      llmGateway: gateway,
    });

    expect(invokeApi).toHaveBeenCalledTimes(1);
    expect(() => ScriptDraftPackage.parse(draft)).not.toThrow();
  });

  it("unwraps a single script_draft_package envelope before validating ScriptDraftPackage", async () => {
    const invokeApi = vi.fn(
      async () =>
        env(JSON.stringify({
          script_draft_package: runtimeDraft,
        })),
    );
    const gateway = createLlmGateway({
      registry: createPromptRegistry(),
      provider: createOpenAiCompatibleProvider({
        model: "glm-4.5",
        invokeApi,
      }),
    });

    const draft = await (generateScriptDraft as any)({
      bundle: scriptInputBundle,
      llmGateway: gateway,
    });

    expect(invokeApi).toHaveBeenCalledTimes(1);
    expect(draft).toMatchObject(runtimeDraft);
    expect(() => ScriptDraftPackage.parse(draft)).not.toThrow();
  });

  it("maps ordinal beat placeholders back to hard-lane beats before local validation", async () => {
    const invokeApi = vi.fn(
      async () =>
        env(JSON.stringify({
          ...runtimeDraft,
          beat_trace: [1, 2],
        })),
    );
    const gateway = createLlmGateway({
      registry: createPromptRegistry(),
      provider: createOpenAiCompatibleProvider({
        model: "glm-4.5",
        invokeApi,
      }),
    });

    const draft = await (generateScriptDraft as any)({
      bundle: scriptInputBundle,
      llmGateway: gateway,
    });

    expect(draft.beat_trace).toMatchObject([
      {
        beat: scriptInputBundle.hard_lane.must_include_beats[0],
        excerpt:
          "入楚受辱只是开始，真正厉害的是他把每次当众羞辱都原样顶了回去。",
      },
      {
        beat: scriptInputBundle.hard_lane.must_include_beats[1],
        excerpt:
          "到橘枳之喻落下来时，楚国想压人的场面已经反过来变成自己失手的场面。",
      },
    ]);

    const validation = validateScriptDraft({
      bundle: scriptInputBundle,
      draft,
    });

    expect(validation.errors).not.toContain("beat_missing");
  });

  it("canonicalizes beat trace labels back to hard-lane beats before local validation", async () => {
    const invokeApi = vi.fn(
      async () =>
        env(JSON.stringify({
          ...runtimeDraft,
          beat_trace: [
            {
              label: "入楚受辱只是开始",
              excerpt: "入楚受辱只是开始",
              confidence: 0.95,
            },
            {
              label: "到橘枳之喻落下来时",
              excerpt: "到橘枳之喻落下来时",
              confidence: 0.96,
            },
          ],
        })),
    );
    const gateway = createLlmGateway({
      registry: createPromptRegistry(),
      provider: createOpenAiCompatibleProvider({
        model: "glm-4.5",
        invokeApi,
      }),
    });

    const draft = await (generateScriptDraft as any)({
      bundle: scriptInputBundle,
      llmGateway: gateway,
    });

    expect(draft.beat_trace).toMatchObject([
      {
        beat: "入楚受辱",
        excerpt: "入楚受辱只是开始",
      },
      {
        beat: "橘枳之喻",
        excerpt: "到橘枳之喻落下来时",
      },
    ]);

    const validation = validateScriptDraft({
      bundle: scriptInputBundle,
      draft,
    });

    expect(validation.errors).not.toContain("beat_missing");
  });

  it("expands weak beat trace excerpts from script text before local validation", async () => {
    const weakTraceDraft = {
      ...runtimeDraft,
      script_text:
        "楚王连续压场，晏子一句句顶回去。入楚受辱这一刻，不只是晏子被压，也是齐国被当众压住。到橘枳之喻落下来时，楚国想压人的场面已经反过来变成自己失手的场面。这种场面，一退就不只是退掉自己。",
      beat_trace: [
        {
          beat: "入楚受辱",
          excerpt: "入楚受辱",
          confidence: 0.95,
        },
        {
          beat: "橘枳之喻",
          excerpt: "橘枳之喻",
          confidence: 0.96,
        },
      ],
    };
    const gateway = createLlmGateway({
      registry: createPromptRegistry(),
      provider: createOpenAiCompatibleProvider({
        model: "glm-4.5",
        invokeApi: vi.fn(async () => ({ rawOutput: JSON.stringify(weakTraceDraft), content: JSON.stringify(weakTraceDraft), metadata: {} })),
      }),
    });

    const draft = await (generateScriptDraft as any)({
      bundle: scriptInputBundle,
      llmGateway: gateway,
    });

    expect(draft.beat_trace).toMatchObject([
      {
        beat: "入楚受辱",
        excerpt: "入楚受辱这一刻，不只是晏子被压，也是齐国被当众压住。",
      },
      {
        beat: "橘枳之喻",
        excerpt: "到橘枳之喻落下来时，楚国想压人的场面已经反过来变成自己失手的场面。",
      },
    ]);

    const validation = validateScriptDraft({
      bundle: scriptInputBundle,
      draft,
    });

    expect(validation.errors).not.toContain("beat_trace_weak");
  });

  it("fails clearly when script-writer output cannot be repaired", async () => {
    const gateway = createLlmGateway({
      registry: createPromptRegistry(),
      provider: createOpenAiCompatibleProvider({
        model: "glm-4.5",
        invokeApi: vi.fn(async () => env("not-json")),
      }),
    });

    await expect(
      Promise.resolve().then(() =>
        (generateScriptDraft as any)({
          bundle: scriptInputBundle,
          llmGateway: gateway,
        }),
      ),
    ).rejects.toMatchObject({
      name: "ExternalServiceError",
      code: "invalid_response",
      operation: "script.writer",
    });
  });

  it("passes a complete llm interaction entry to the script writer logger", async () => {
    const entries: LlmInteractionLogEntry[] = [];
    const gateway = createLlmGateway({
      registry: createPromptRegistry(),
      provider: createOpenAiCompatibleProvider({
        model: "glm-4.5",
        invokeApi: vi.fn(async () => ({ rawOutput: JSON.stringify(runtimeDraft), content: JSON.stringify(runtimeDraft), metadata: {} })),
      }),
    });

    await generateScriptDraft({
      bundle: scriptInputBundle,
      llmGateway: gateway,
      interactionLogWriter: {
        write(entry) {
          entries.push(entry);
        },
      },
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      provider: "openai-compatible",
      model: "glm-4.5",
      operationName: "script.writer",
      promptId: "script.writer",
      promptStage: "script",
      promptLanguage: "zh-CN",
      input: scriptInputBundle,
      rawOutput: JSON.stringify(runtimeDraft),
      parsedOutput: runtimeDraft,
      errorMessage: null,
    });
    expect(entries[0]?.systemPrompt).toContain("ScriptInputBundle");
    expect(entries[0]?.systemPrompt).toContain("ScriptDraftPackage");
    expect(entries[0]?.systemPrompt).toContain("`beat_trace`");
    expect(entries[0]?.systemPrompt).toContain(
      "`hard_lane.must_include_beats`",
    );
    expect(entries[0]?.systemPrompt).toContain(
      "`beat_trace.excerpt` 必须从自然正文截取",
    );
    expect(entries[0]?.systemPrompt).toContain("不少于 14 个汉字等价长度");
    expect(entries[0]?.systemPrompt).toContain("`estimated_duration_sec`");
    expect(entries[0]?.systemPrompt).toContain("`hard_lane.duration_band`");
    expect(entries[0]?.systemPrompt).toContain("`script_text`");
    expect(entries[0]?.systemPrompt).toContain("short=45-70秒");
    expect(entries[0]?.systemPrompt).toContain("medium=75-95秒");
    expect(entries[0]?.systemPrompt).toContain("long=90-140秒");
    expect(entries[0]?.systemPrompt).toContain(
      "先按档位控制正文体量，再按约 3.6-4.6 个汉字等价长度/秒回填",
    );
    expect(entries[0]?.systemPrompt).toContain("`opening_span`");
    expect(entries[0]?.systemPrompt).toContain(
      "优先从 `core_conflict`、`stakes` 或 `narrative_tension_map` 提炼",
    );
    expect(entries[0]?.systemPrompt).toContain("具体历史场面、动作或危险局面");
    expect(entries[0]?.systemPrompt).toContain(
      "`hook_claim` 只是包装 promise 弱参考",
    );
    expect(entries[0]?.systemPrompt).toContain("不能机械复述或照搬");
    expect(entries[0]?.systemPrompt).toContain("不使用固定统一开头模板");
    expect(entries[0]?.systemPrompt).not.toContain(
      "前两句必须直接复用 `hook_claim` 或 `strong_scene`",
    );
    expect(entries[0]?.systemPrompt).toContain(
      "先单独确定一个可独立成立的 `opening_span` 作为开场钩子；`script_text` 从 `opening_span` 之后的下一拍进入正文推进",
    );
    expect(entries[0]?.systemPrompt).not.toContain("不要只用泛问句空转起手");
    expect(entries[0]?.systemPrompt).toContain("`ending_span`");
    expect(entries[0]?.systemPrompt).toContain("回收到 `ending_residue` 或 `stakes`");
  });

  it("persists readable llm interaction markdown under the script run directory", async () => {
    const db = createDbClient();
    const project = await createProject(db, {
      name: "Script Runtime Logging",
    });
    const topicPackageRecord = await saveTopicPackage(db, {
      projectId: project.id,
      title: "晏子使楚",
      selectedAngle: topicPackage.selected_angle,
      familyLabel: topicPackage.family_label,
      scopeLabel: topicPackage.scope_label,
      coreConflict: topicPackage.core_conflict,
      strongScene: topicPackage.strong_scene,
      stakes: topicPackage.stakes,
      packagingSeed: topicPackage.packaging_seed,
      canonicalQuotesJson: [],
      durationBandJson: {
        label: "medium",
        min_sec: 75,
        max_sec: 95,
      },
      narrativeTensionMapJson: topicPackage.narrative_tension_map,
      mustIncludeBeatsJson: topicPackage.must_include_beats,
      forbiddenExpansionsJson: topicPackage.forbidden_expansions,
      riskHintsJson: topicPackage.risk_hints,
      sourceAnchorRefsJson: topicPackage.source_anchor_refs,
      ambiguityNotesJson: ["《晏子春秋》版本存在后世转述差异。"],
    });
    project.activeTopicPackageId = topicPackageRecord.id;
    project.status = "script_ready";

    const response = await runScriptGeneration({
      db,
      project,
      allowPatch: false,
      allowRegen: false,
    });

    expect(response.statusCode).toBe(200);
    const body = response.body as ScriptGenerationSuccessBody;
    expect(body.draft.opening_span).toBe(topicPackage.strong_scene);
    expect(body.draft.opening_span).not.toBe(
      body.input_bundle.packaging_lane.hook_claim,
    );
    expect(body.draft.script_text).toMatch(
      new RegExp(`^${topicPackage.strong_scene.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
    );
    expect(body.semantic_review).toMatchObject({
      stage: "script_semantic_review",
      decision: "skipped",
      patch_intent: null,
      hard_issues: [],
      soft_issues: [],
      patch_targets: [],
    });
    expect(body.semantic_review.soft_issues).not.toContain(
      "hook_kill_power_weak",
    );
    expect(body.runtime_diagnostics.checks).toContainEqual(
      expect.objectContaining({
        code: "semantic_review_skipped",
        level: "warning",
      }),
    );
    expect(body.runtime_diagnostics.checks).not.toContainEqual(
      expect.objectContaining({
        code: "patch_once",
      }),
    );
    expect(body.input_bundle.hard_lane).toMatchObject({
      core_conflict: topicPackage.core_conflict,
      stakes: topicPackage.stakes,
      source_anchor_refs: topicPackage.source_anchor_refs,
      canonical_quotes: [],
      ambiguity_notes: ["《晏子春秋》版本存在后世转述差异。"],
    });

    const profile = getProjectStorageProfile(project);
    const graphTraceSummary = body.graph_trace_summary as unknown as Record<
      string,
      unknown
    >;
    const runId = String(graphTraceSummary.run_id);
    const interactionLogPath = resolve(
      process.cwd(),
      profile.script_runs_dir,
      runId,
      "llm-interactions",
      "01-script.writer.md",
    );

    expect(existsSync(interactionLogPath)).toBe(true);

    const logContent = readFileSync(interactionLogPath, "utf8");
    expect(logContent).toContain("# LLM");
    expect(logContent).toContain("- prompt_id: script.writer");
    expect(logContent).toContain("## System Prompt");
    expect(logContent).toContain("## 原始模型响应");
    expect(logContent).toContain("## 归一化结果");
    expect(logContent).toContain("晏子使楚");
  });

  it("clears stale active storyboard and asset plan pointers after activating a new script", async () => {
    const db = createDbClient();
    const project = await createProject(db, {
      name: "Script Clears Storyboard",
    });
    const topicPackageRecord = await saveTopicPackage(db, {
      projectId: project.id,
      title: "Storyboard stale pointer topic",
      selectedAngle: topicPackage.selected_angle,
      familyLabel: topicPackage.family_label,
      scopeLabel: topicPackage.scope_label,
      coreConflict: topicPackage.core_conflict,
      strongScene: topicPackage.strong_scene,
      stakes: topicPackage.stakes,
      packagingSeed: topicPackage.packaging_seed,
      canonicalQuotesJson: [],
      durationBandJson: {
        label: "medium",
        min_sec: 75,
        max_sec: 95,
      },
      narrativeTensionMapJson: topicPackage.narrative_tension_map,
      mustIncludeBeatsJson: topicPackage.must_include_beats,
      forbiddenExpansionsJson: topicPackage.forbidden_expansions,
      riskHintsJson: topicPackage.risk_hints,
      sourceAnchorRefsJson: topicPackage.source_anchor_refs,
      ambiguityNotesJson: [],
    });
    project.activeTopicPackageId = topicPackageRecord.id;
    project.activeStoryboardRecordId = "storyboard_record_old";
    project.activeAssetPlanRecordId = "asset_plan_record_old";
    project.activeAssetManifestRecordId = "asset_manifest_record_old";
    project.activeComposeRecordId = "compose_record_old";
    project.activeRenderJobRecordId = "render_job_record_old";
    project.latestStoryboardRunTraceJson = {
      phase: "storyboard",
      run_id: "storyboard_run_old",
      steps: [],
    };
    project.latestAssetPlanRunTraceJson = {
      phase: "asset_planning",
      run_id: "asset_plan_run_old",
      steps: [],
    };
    project.latestAssetsRunTraceJson = {
      phase: "assets",
      run_id: "assets_run_old",
      steps: [],
    };
    project.latestComposeRunTraceJson = {
      phase: "compose",
      run_id: "compose_run_old",
      steps: [],
    };
    project.latestRenderRunTraceJson = {
      phase: "render",
      run_id: "render_run_old",
      steps: [],
    };
    project.status = "storyboard_ready";

    const response = await runScriptGeneration({
      db,
      project,
      allowPatch: false,
      allowRegen: false,
    });

    expect(response.statusCode).toBe(200);
    expect(project.status).toBe("script_ready");
    expect(project.activeScriptRecordId).toBeTypeOf("string");
    expect(project.activeStoryboardRecordId).toBeNull();
    expect(project.latestStoryboardRunTraceJson).toBeNull();
    expect(project.activeAssetPlanRecordId).toBeNull();
    expect(project.latestAssetPlanRunTraceJson).toBeNull();
    expect(project.activeAssetManifestRecordId).toBeNull();
    expect(project.latestAssetsRunTraceJson).toBeNull();
    expect(project.activeComposeRecordId).toBeNull();
    expect(project.latestComposeRunTraceJson).toBeNull();
    expect(project.activeRenderJobRecordId).toBeNull();
    expect(project.latestRenderRunTraceJson).toBeNull();
  });

  it("returns real semantic reviewer output in shadow mode without entering patch", async () => {
    const db = createDbClient();
    const project = await createProject(db, {
      name: "Script Semantic Reviewer Shadow",
    });
    const topicPackageRecord = await saveTopicPackage(db, {
      projectId: project.id,
      title: "晏子使楚",
      selectedAngle: topicPackage.selected_angle,
      familyLabel: topicPackage.family_label,
      scopeLabel: topicPackage.scope_label,
      coreConflict: topicPackage.core_conflict,
      strongScene: topicPackage.strong_scene,
      stakes: localValidationPassingStakes,
      packagingSeed: topicPackage.packaging_seed,
      canonicalQuotesJson: [],
      durationBandJson: {
        label: "medium",
        min_sec: 75,
        max_sec: 95,
      },
      narrativeTensionMapJson: topicPackage.narrative_tension_map,
      mustIncludeBeatsJson: topicPackage.must_include_beats,
      forbiddenExpansionsJson: topicPackage.forbidden_expansions,
      riskHintsJson: topicPackage.risk_hints,
      sourceAnchorRefsJson: topicPackage.source_anchor_refs,
      ambiguityNotesJson: [],
    });
    project.activeTopicPackageId = topicPackageRecord.id;
    project.status = "script_ready";

    const reviewerOutput = {
      stage: "script_semantic_review",
      decision: "patch_once",
      patch_intent: "lift",
      hard_issues: [],
      soft_issues: ["hook_kill_power_weak"],
      patch_targets: ["opening"],
      summary: "开头抓力不足，但本轮只做 shadow 评估。",
      confidence: 0.79,
    };
    const invokeApi = vi.fn(async () => ({ rawOutput: JSON.stringify(reviewerOutput), content: JSON.stringify(reviewerOutput), metadata: {} }));
    const semanticReviewGateway = createLlmGateway({
      registry: createPromptRegistry(),
      provider: createOpenAiCompatibleProvider({
        model: "glm-4.5",
        invokeApi,
      }),
    });

    const response = await runScriptGeneration({
      db,
      project,
      allowPatch: true,
      allowRegen: true,
      semanticReviewGateway,
    } as any);

    expect(response.statusCode).toBe(200);
    const body = response.body as ScriptGenerationSuccessBody;
    expect(invokeApi).toHaveBeenCalledTimes(1);
    expect(body.semantic_review).toMatchObject(reviewerOutput);
    expect((body as Record<string, unknown>).execution_state).toBeUndefined();
    expect(body.graph_trace_summary.steps).not.toContainEqual(
      expect.objectContaining({
        step_name: "patch-once",
      }),
    );
    expect(body.runtime_diagnostics.checks).toContainEqual(
      expect.objectContaining({
        code: "patch_once",
        level: "info",
      }),
    );
  });

  it("normalizes wrapped semantic reviewer output without entering patch", async () => {
    const db = createDbClient();
    const project = await createProject(db, {
      name: "Script Semantic Reviewer Wrapped Output",
    });
    const topicPackageRecord = await saveTopicPackage(db, {
      projectId: project.id,
      title: "晏子使楚",
      selectedAngle: topicPackage.selected_angle,
      familyLabel: topicPackage.family_label,
      scopeLabel: topicPackage.scope_label,
      coreConflict: topicPackage.core_conflict,
      strongScene: topicPackage.strong_scene,
      stakes: localValidationPassingStakes,
      packagingSeed: topicPackage.packaging_seed,
      canonicalQuotesJson: [],
      durationBandJson: {
        label: "medium",
        min_sec: 75,
        max_sec: 95,
      },
      narrativeTensionMapJson: topicPackage.narrative_tension_map,
      mustIncludeBeatsJson: topicPackage.must_include_beats,
      forbiddenExpansionsJson: topicPackage.forbidden_expansions,
      riskHintsJson: topicPackage.risk_hints,
      sourceAnchorRefsJson: topicPackage.source_anchor_refs,
      ambiguityNotesJson: [],
    });
    project.activeTopicPackageId = topicPackageRecord.id;
    project.status = "script_ready";

    const invokeApi = vi.fn(
      async () =>
        env(JSON.stringify({
          answer: {
            decision: "patch_once",
            tags: ["pressure_escalation_missing", "narrative_tension_weak"],
            explanation: "三次压迫层次不够清晰，但本轮只作为 shadow 量尺。",
            patch_points: [
              {
                location: "opening",
                issue: "开头压迫升级不足",
                suggestion: "补足楚王连续压场的递进关系",
              },
            ],
          },
        })),
    );
    const semanticReviewGateway = createLlmGateway({
      registry: createPromptRegistry(),
      provider: createOpenAiCompatibleProvider({
        model: "glm-4.5",
        invokeApi,
      }),
    });

    const response = await runScriptGeneration({
      db,
      project,
      allowPatch: true,
      allowRegen: true,
      semanticReviewGateway,
    } as any);

    expect(response.statusCode).toBe(200);
    const body = response.body as ScriptGenerationSuccessBody;
    expect(body.semantic_review).toMatchObject({
      stage: "script_semantic_review",
      decision: "patch_once",
      patch_intent: "lift",
      hard_issues: [],
      soft_issues: ["pressure_escalation_missing", "narrative_tension_weak"],
      patch_targets: ["opening"],
      summary: "三次压迫层次不够清晰，但本轮只作为 shadow 量尺。",
    });
    expect(body.semantic_review.confidence).toBeLessThanOrEqual(0.7);
    expect(body.graph_trace_summary.steps).not.toContainEqual(
      expect.objectContaining({
        step_name: "patch-once",
      }),
    );
  });

  it("normalizes loose top-level semantic reviewer fields into the formal schema", async () => {
    const db = createDbClient();
    const project = await createProject(db, {
      name: "Script Semantic Reviewer Loose Fields",
    });
    const topicPackageRecord = await saveTopicPackage(db, {
      projectId: project.id,
      title: "晏子使楚",
      selectedAngle: topicPackage.selected_angle,
      familyLabel: topicPackage.family_label,
      scopeLabel: topicPackage.scope_label,
      coreConflict: topicPackage.core_conflict,
      strongScene: topicPackage.strong_scene,
      stakes: localValidationPassingStakes,
      packagingSeed: topicPackage.packaging_seed,
      canonicalQuotesJson: [],
      durationBandJson: {
        label: "medium",
        min_sec: 75,
        max_sec: 95,
      },
      narrativeTensionMapJson: topicPackage.narrative_tension_map,
      mustIncludeBeatsJson: topicPackage.must_include_beats,
      forbiddenExpansionsJson: topicPackage.forbidden_expansions,
      riskHintsJson: topicPackage.risk_hints,
      sourceAnchorRefsJson: topicPackage.source_anchor_refs,
      ambiguityNotesJson: [],
    });
    project.activeTopicPackageId = topicPackageRecord.id;
    project.status = "script_ready";

    const invokeApi = vi.fn(
      async () =>
        env(JSON.stringify({
          stage: "script_semantic_review",
          decision: "patch_once",
          patch_intent: "调整脚本节奏，增强画面感和冲突张力",
          hard_issues: [
            {
              issue_type: "节奏过快",
              description: "脚本整体节奏过快，缺乏必要的场景铺垫。",
              severity: "high",
            },
          ],
          soft_issues: [
            {
              issue_type: "情感铺垫不足",
              description: "缺乏足够的情感铺垫。",
              severity: "medium",
            },
          ],
          patch_targets: [
            {
              target_type: "opening_span",
              suggestion: "增加场景描写。",
            },
          ],
          summary: "脚本核心内容符合主题要求，但需要增强画面感。",
          confidence: 0.85,
        })),
    );
    const semanticReviewGateway = createLlmGateway({
      registry: createPromptRegistry(),
      provider: createOpenAiCompatibleProvider({
        model: "glm-4.5",
        invokeApi,
      }),
    });

    const response = await runScriptGeneration({
      db,
      project,
      allowPatch: true,
      allowRegen: true,
      semanticReviewGateway,
    } as any);

    expect(response.statusCode).toBe(200);
    const body = response.body as ScriptGenerationSuccessBody;
    expect(body.semantic_review).toMatchObject({
      stage: "script_semantic_review",
      decision: "patch_once",
      patch_intent: "lift",
      hard_issues: [
        {
          code: "节奏过快",
          message: "脚本整体节奏过快，缺乏必要的场景铺垫。",
          severity: "high",
        },
      ],
      soft_issues: [
        {
          code: "情感铺垫不足",
          message: "缺乏足够的情感铺垫。",
          severity: "medium",
        },
      ],
      patch_targets: ["opening_span"],
      summary: "脚本核心内容符合主题要求，但需要增强画面感。",
      confidence: 0.85,
    });
    expect(body.graph_trace_summary.steps).not.toContainEqual(
      expect.objectContaining({
        step_name: "patch-once",
      }),
    );
  });

  it("requires semantic reviewer prompt to output top-level ScriptSemanticReviewResult fields", () => {
    const prompt = createPromptRegistry().getPrompt("script.semantic-reviewer");

    expect(prompt.body).toContain("顶层 JSON 对象");
    expect(prompt.body).toContain("不得包在 `answer`");
    expect(prompt.body).toContain("`stage`: `script_semantic_review`");
    expect(prompt.body).toContain("`patch_intent`");
    expect(prompt.body).toContain("`hard_issues`");
    expect(prompt.body).toContain("`soft_issues`");
    expect(prompt.body).toContain("`patch_targets`");
    expect(prompt.body).toContain("`summary`");
    expect(prompt.body).toContain("`confidence`");
  });

  it("requires semantic reviewer prompt to calibrate pass versus lift for first-pass drafts", () => {
    const prompt = createPromptRegistry().getPrompt("script.semantic-reviewer");

    expect(prompt.body).toContain("首稿可接受");
    expect(prompt.body).toContain("必须判为 `pass`");
    expect(prompt.body).toContain("不要把首稿当成终稿精修");
    expect(prompt.body).toContain("不能因为还可以更有画面感");
    expect(prompt.body).toContain("泛泛的“更丰富”");
    expect(prompt.body).toContain("明确定位到局部");
    expect(prompt.body).toContain("只作为 shadow 量尺");
  });
});

