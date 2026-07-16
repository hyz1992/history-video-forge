import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it, vi, afterAll } from "vitest";

const { createGateways, runSample, runCapabilityProbe, describeGatewayProfile } = await import("./llm-s2-baseline.js");

import { createLlmGateway } from "../../../backend/src/runtime/llm/llm-gateway.js";
import { createOpenAiCompatibleProvider } from "../../../backend/src/runtime/llm/openai-compatible-provider.js";
import { createPromptRegistry } from "../../../backend/src/runtime/prompts/prompt-registry.js";
import type { BaselineProfile } from "./llm-s2-baseline.js";

const sandboxDirs: string[] = [];

function makeSandboxOutputDir(label: string): string {
  const root = mkdtempSync(join(tmpdir(), `s2-baseline-${label}-`));
  sandboxDirs.push(root);
  return root;
}

afterAll(() => {
  for (const dir of sandboxDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("llm-s2-baseline stub flow", () => {
  function mkProfile(main: string, structured: string): BaselineProfile {
    return { label: "current", mainModel: main, structuredModel: structured };
  }

  function stubResponse(data: unknown) {
    const json = JSON.stringify(data);
    return { rawOutput: json, content: json, metadata: { finishReason: "stop" } };
  }

  function stubStrictResponse(data: unknown) {
    const json = JSON.stringify(data);
    return { rawOutput: json, content: json, argumentsJson: json, metadata: { finishReason: "tool_calls" } };
  }

  describe("createGateways model routing through real factory", () => {
    it("current profile routes main model and structured model to provider with correct profile", () => {
      const captured: Array<{ profile: string; model: string; maxAttempts: number }> = [];

      const { mainGateway, structuredGateway } = createGateways(
        mkProfile("glm-5.1", "glm-4"),
        {
          providerFactory: (cfg) => {
            captured.push({ profile: cfg.profile, model: cfg.model, maxAttempts: cfg.maxAttempts });
            return createOpenAiCompatibleProvider({
              ...cfg,
              invokeApi: vi.fn().mockResolvedValue(stubResponse({})) as any,
            });
          },
        },
      );

      expect(mainGateway).toBeDefined();
      expect(structuredGateway).toBeDefined();
      expect(captured).toContainEqual({ profile: "main", model: "glm-5.1", maxAttempts: 1 });
      expect(captured).toContainEqual({ profile: "structured", model: "glm-4", maxAttempts: 1 });
    });

    it("candidate profile passes same model to both main and structured providers", () => {
      const captured: string[] = [];

      createGateways(
        { label: "candidate", mainModel: "glm-5.2", structuredModel: "glm-5.2" },
        {
          providerFactory: (cfg) => {
            captured.push(`${cfg.profile}:${cfg.model}`);
            return createOpenAiCompatibleProvider({
              ...cfg,
              invokeApi: vi.fn().mockResolvedValue(stubResponse({})) as any,
            });
          },
        },
      );

      expect(captured).toContain("main:glm-5.2");
      expect(captured).toContain("structured:glm-5.2");
    });

    it("describeGatewayProfile is the single source consumed by createGateways", () => {
      const cfgCurrent = describeGatewayProfile(mkProfile("glm-5.1", "glm-4"));
      expect(cfgCurrent.main).toEqual({ profile: "main", model: "glm-5.1", maxAttempts: 1 });
      expect(cfgCurrent.structured).toEqual({ profile: "structured", model: "glm-4", maxAttempts: 1 });
    });
  });

  it("capability probe forces the declared target function without changing normal samples", async () => {
    const outputDir = makeSandboxOutputDir("target-tool-probe");
    let capturedToolChoice: string | undefined;
    let capturedSelectorSchema: Record<string, unknown> | undefined;
    let capturedScorecardSchema: Record<string, unknown> | undefined;
    const provider = createOpenAiCompatibleProvider({
      profile: "structured",
      model: "glm-5.2",
      maxAttempts: 1,
      invokeStrictApi: vi.fn(async (request) => {
        capturedToolChoice = request.options.toolChoice;
        capturedSelectorSchema = request.schema.parameters as Record<string, unknown>;
        const rankedCandidates = request.schema.parameters.properties.ranked_candidates as {
          items?: Record<string, unknown>;
        };
        capturedScorecardSchema = rankedCandidates.items;
        return stubStrictResponse({
          ranked_candidates: [{
            candidate_id: "probe_c1",
            quality_rank: 1,
            quality_score: 90,
            deductions: [],
            risk_summary: "low",
            consistency_issue: "none",
          }, {
            candidate_id: "probe_c2",
            quality_rank: 2,
            quality_score: 80,
            deductions: [],
            risk_summary: "low",
            consistency_issue: "none",
          }],
          consistency_risk_notes: [],
        });
      }) as any,
    });
    const gateway = createLlmGateway({
      registry: createPromptRegistry(),
      provider,
    });

    const result = await runCapabilityProbe(
      gateway,
      outputDir,
      { label: "candidate", mainModel: "glm-5.2", structuredModel: "glm-5.2" },
    );

    expect(result.passed).toBe(true);
    expect(result.observation.operation).toBe("probe.strict-tool-call");
    expect(capturedToolChoice).toBe("target_function");
    expect(
      (result.observation.effectiveRequest as { toolChoice?: string } | null)?.toolChoice,
    ).toBe("target_function");
    expect(capturedSelectorSchema?.required).toContain("consistency_risk_notes");
    expect(capturedScorecardSchema?.required).toContain("risk_summary");
    expect(capturedScorecardSchema?.required).toContain("consistency_issue");
    expect(capturedScorecardSchema?.required).not.toContain("consistency_status");
    expect(capturedScorecardSchema?.required).not.toContain("primary_consistency_issue");
    expect(capturedScorecardSchema?.required).not.toContain("consistency_note");
    expect(capturedScorecardSchema?.additionalProperties).toBe(false);
  });

  it("topic.selector uses strict parser and sets firstPass=passed zod=passed", async () => {
    const outputDir = makeSandboxOutputDir("topic");
    let capturedOptions: Record<string, unknown> | undefined;

    const strP = createOpenAiCompatibleProvider({
      profile: "structured", model: "glm-structured", maxAttempts: 1,
      invokeStrictApi: vi.fn(async (request) => {
        capturedOptions = request.options;
        return stubStrictResponse({
          ranked_candidates: [{
            candidate_id: "c1",
            quality_rank: 1,
            quality_score: 90,
            risk_summary: "low",
            deductions: [],
            consistency_issue: "none",
          }],
          consistency_risk_notes: [],
        });
      }) as any,
    });
    const sg = createLlmGateway({ registry: createPromptRegistry(), provider: strP });

    const mainP = createOpenAiCompatibleProvider({
      profile: "main", model: "glm-main", maxAttempts: 1,
      invokeApi: vi.fn().mockResolvedValue(stubResponse({})) as any,
    });
    const mg = createLlmGateway({ registry: createPromptRegistry(), provider: mainP });

    const obs = await runSample(mg, sg, {
      id: "t", operation: "topic.selector", description: "", input: {
        candidates: [{ candidate_id: "c1", event_identity: "x", title: "x", one_line_angle: "x", core_conflict: "x", strong_scene: "x", narrative_tension_map: { hook_claim: "x" } }],
      },
    }, outputDir, mkProfile("glm-main", "glm-structured"), {
      thinking: "disabled",
      forceTargetTool: true,
    });

    expect(obs.status).toBe("succeeded");
    expect(obs.zodResult).toBe("passed");
    expect(obs.firstPassResult).toBe("passed");
    expect(obs.repairResult).toBe("unexercised");
    expect(obs.regenResult).toBe("unexercised");
    expect(capturedOptions?.thinking).toBe("disabled");
    expect(capturedOptions?.toolChoice).toBe("target_function");
  }, 15000);

  it("script.writer validates draft and sets repair/regen as unexercised", async () => {
    const outputDir = makeSandboxOutputDir("script");
    const draft = { script_text: "正文", estimated_duration_sec: 85, beat_trace: [{ beat: "b", excerpt: "ex", confidence: 0.9 }], quote_trace: [{ quote: "q", usage_type: "exact", excerpt: "ex" }], opening_span: "开", ending_span: "收" };
    let capturedThinking: string | undefined;

    const mainP = createOpenAiCompatibleProvider({
      profile: "main", model: "glm-5.1", maxAttempts: 1,
      invokeApi: vi.fn(async (request) => {
        capturedThinking = request.thinking;
        return stubResponse(draft);
      }) as any,
    });
    const mg = createLlmGateway({ registry: createPromptRegistry(), provider: mainP });

    const strP = createOpenAiCompatibleProvider({
      profile: "structured", model: "glm-4", maxAttempts: 1,
      invokeStrictApi: vi.fn() as any,
    });
    const sg = createLlmGateway({ registry: createPromptRegistry(), provider: strP });

    const obs = await runSample(mg, sg, {
      id: "s", operation: "script.writer", description: "", input: { type: "topic_package" },
    }, outputDir, mkProfile("glm-5.1", "glm-4"), { thinking: "disabled" });

    expect(obs.status).toBe("succeeded");
    expect(obs.zodResult).toBe("passed");
    expect(obs.firstPassResult).toBe("passed");
    expect(obs.validatorDecision).toBeDefined();
    expect(obs.repairResult).toBe("unexercised");
    expect(obs.regenResult).toBe("unexercised");
    expect(capturedThinking).toBe("disabled");
  }, 15000);

  it("storyboard.planner validates plan and sets repair/regen as unexercised", async () => {
    const outputDir = makeSandboxOutputDir("storyboard");
    const segment = { segment_id: "seg-0", order: 0, script_excerpt: "excerpt", start_hint_sec: 0, end_hint_sec: 20, narrative_role: "opening" as const, visual_intent: "v", scene_description: "d", visual_elements: ["人物"], framing_hint: "wide" as const, content_type: "live_action" as const, motion_hint: "push_in" as const, editing_hint: "single" as const, on_screen_text: ["字幕"], linked_beats: ["b"], linked_quotes: ["q"], risk_notes: ["r"] };
    const plan = { plan_version: "storyboard_v1" as const, source_script_record_id: "s1", source_topic_package_id: "t1", estimated_total_duration_sec: 60, segments: [segment], global_visual_notes: ["暖色调"] };
    let capturedThinking: string | undefined;

    const mainP = createOpenAiCompatibleProvider({
      profile: "main", model: "glm-5.2", maxAttempts: 1,
      invokeApi: vi.fn(async (request) => {
        capturedThinking = request.thinking;
        return stubResponse(plan);
      }) as any,
    });
    const mg = createLlmGateway({ registry: createPromptRegistry(), provider: mainP });

    const strP = createOpenAiCompatibleProvider({
      profile: "structured", model: "glm-5.2", maxAttempts: 1,
      invokeStrictApi: vi.fn() as any,
    });
    const sg = createLlmGateway({ registry: createPromptRegistry(), provider: strP });

    const obs = await runSample(mg, sg, {
      id: "st", operation: "storyboard.planner", description: "", input: {},
    }, outputDir, mkProfile("glm-5.2", "glm-5.2"), { thinking: "disabled" });

    expect(obs.status).toBe("succeeded");
    expect(obs.zodResult).toBe("passed");
    expect(obs.firstPassResult).toBe("passed");
    expect(obs.validatorDecision).toBeDefined();
    expect(obs.repairResult).toBe("unexercised");
    expect(obs.regenResult).toBe("unexercised");
    expect(capturedThinking).toBe("disabled");
  }, 15000);

  it("importing module in subprocess does not execute main()", () => {
    const checkPath = resolve(process.cwd(), "harness", "scripts", "runtime", "__import_check__.ts");
    const result = spawnSync(
      "npx",
      ["tsx", checkPath],
      { encoding: "utf-8", cwd: process.cwd(), timeout: 30000, shell: true },
    );

    if (result.status !== 0) {
      throw new Error(`subprocess failed: status=${result.status} stdout=${result.stdout} stderr=${result.stderr}`);
    }
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("IMPORT_OK");
    expect(result.stdout).not.toContain("baseline-report.json");
  }, 45000);
});
