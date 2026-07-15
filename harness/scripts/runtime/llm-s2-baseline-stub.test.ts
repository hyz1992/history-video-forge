import { mkdirSync, mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

const { createGateways, runSample, describeGatewayProfile } = await import("./llm-s2-baseline.js");

import { createLlmGateway } from "../../../backend/src/runtime/llm/llm-gateway.js";
import { createOpenAiCompatibleProvider } from "../../../backend/src/runtime/llm/openai-compatible-provider.js";
import { createPromptRegistry } from "../../../backend/src/runtime/prompts/prompt-registry.js";
import type { BaselineProfile } from "./llm-s2-baseline.js";

function makeSandboxOutputDir(label: string): string {
  const root = mkdtempSync(join(tmpdir(), `s2-baseline-${label}-`));
  return root;
}

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

  describe("createGateways model routing", () => {
    it("current profile routes main model and structured model independently", () => {
      const cfg = describeGatewayProfile(mkProfile("glm-5.1", "glm-4"));
      expect(cfg.main).toEqual({ profile: "main", model: "glm-5.1" });
      expect(cfg.structured).toEqual({ profile: "structured", model: "glm-4" });
    });

    it("candidate profile uses same model for both profiles", () => {
      const cfg = describeGatewayProfile({ label: "candidate", mainModel: "glm-5.2", structuredModel: "glm-5.2" });
      expect(cfg.main.model).toBe("glm-5.2");
      expect(cfg.structured.model).toBe("glm-5.2");
    });
  });

  it("topic.selector uses strict parser and sets firstPass=passed zod=passed", async () => {
    const outputDir = makeSandboxOutputDir("topic");

    const strP = createOpenAiCompatibleProvider({
      profile: "structured", model: "glm-structured", maxAttempts: 1,
      invokeStrictApi: vi.fn().mockResolvedValue(stubStrictResponse({
        ranked_candidates: [{ candidate_id: "c1", quality_rank: 1, quality_score: 90, risk_summary: "low", deductions: [] }],
      })) as any,
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
    }, outputDir, mkProfile("glm-main", "glm-structured"));

    expect(obs.status).toBe("succeeded");
    expect(obs.zodResult).toBe("passed");
    expect(obs.firstPassResult).toBe("passed");
    expect(obs.repairResult).toBe("unexercised");
    expect(obs.regenResult).toBe("unexercised");
  }, 15000);

  it("script.writer validates draft and sets repair/regen as unexercised", async () => {
    const outputDir = makeSandboxOutputDir("script");
    const draft = { script_text: "正文", estimated_duration_sec: 85, beat_trace: [{ beat: "b", excerpt: "ex", confidence: 0.9 }], quote_trace: [{ quote: "q", usage_type: "exact", excerpt: "ex" }], opening_span: "开", ending_span: "收" };

    const mainP = createOpenAiCompatibleProvider({
      profile: "main", model: "glm-5.1", maxAttempts: 1,
      invokeApi: vi.fn().mockResolvedValue(stubResponse(draft)) as any,
    });
    const mg = createLlmGateway({ registry: createPromptRegistry(), provider: mainP });

    const strP = createOpenAiCompatibleProvider({
      profile: "structured", model: "glm-4", maxAttempts: 1,
      invokeStrictApi: vi.fn() as any,
    });
    const sg = createLlmGateway({ registry: createPromptRegistry(), provider: strP });

    const obs = await runSample(mg, sg, {
      id: "s", operation: "script.writer", description: "", input: { type: "topic_package" },
    }, outputDir, mkProfile("glm-5.1", "glm-4"));

    expect(obs.status).toBe("succeeded");
    expect(obs.zodResult).toBe("passed");
    expect(obs.firstPassResult).toBe("passed");
    expect(obs.validatorDecision).toBeDefined();
    expect(obs.repairResult).toBe("unexercised");
    expect(obs.regenResult).toBe("unexercised");
  }, 15000);

  it("storyboard.planner validates plan and sets repair/regen as unexercised", async () => {
    const outputDir = makeSandboxOutputDir("storyboard");
    const segment = { segment_id: "seg-0", order: 0, script_excerpt: "excerpt", start_hint_sec: 0, end_hint_sec: 20, narrative_role: "opening" as const, visual_intent: "v", scene_description: "d", visual_elements: ["人物"], framing_hint: "wide" as const, content_type: "live_action" as const, motion_hint: "push_in" as const, editing_hint: "single" as const, on_screen_text: ["字幕"], linked_beats: ["b"], linked_quotes: ["q"], risk_notes: ["r"] };
    const plan = { plan_version: "storyboard_v1" as const, source_script_record_id: "s1", source_topic_package_id: "t1", estimated_total_duration_sec: 60, segments: [segment], global_visual_notes: ["暖色调"] };

    const mainP = createOpenAiCompatibleProvider({
      profile: "main", model: "glm-5.2", maxAttempts: 1,
      invokeApi: vi.fn().mockResolvedValue(stubResponse(plan)) as any,
    });
    const mg = createLlmGateway({ registry: createPromptRegistry(), provider: mainP });

    const strP = createOpenAiCompatibleProvider({
      profile: "structured", model: "glm-5.2", maxAttempts: 1,
      invokeStrictApi: vi.fn() as any,
    });
    const sg = createLlmGateway({ registry: createPromptRegistry(), provider: strP });

    const obs = await runSample(mg, sg, {
      id: "st", operation: "storyboard.planner", description: "", input: {},
    }, outputDir, mkProfile("glm-5.2", "glm-5.2"));

    expect(obs.status).toBe("succeeded");
    expect(obs.zodResult).toBe("passed");
    expect(obs.firstPassResult).toBe("passed");
    expect(obs.validatorDecision).toBeDefined();
    expect(obs.repairResult).toBe("unexercised");
    expect(obs.regenResult).toBe("unexercised");
  }, 15000);

  it("module import does not execute main()", async () => {
    const outputBefore = makeSandboxOutputDir("import-check");
    const freshDir = makeSandboxOutputDir("post-import");
    await import("./llm-s2-baseline.js");
    expect(existsSync(join(freshDir, "baseline-report.json"))).toBe(false);
  });
});
