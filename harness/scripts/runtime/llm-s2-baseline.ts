import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { createLlmGateway } from "../../../backend/src/runtime/llm/llm-gateway.js";
import { createOpenAiCompatibleProvider } from "../../../backend/src/runtime/llm/openai-compatible-provider.js";
import { createPromptRegistry } from "../../../backend/src/runtime/prompts/prompt-registry.js";
import { renderLlmInteractionMarkdown } from "../../../backend/src/runtime/llm/interaction-log.js";
import type {
  LlmInteractionLogEntry,
  LlmInteractionLogWriter,
} from "../../../backend/src/runtime/llm/interaction-log.js";
import type { StrictStructuredToolSchema } from "../../../backend/src/runtime/llm/provider-contract.js";

interface SampleCase {
  id: string;
  operation: string;
  description: string;
  input: Record<string, unknown>;
}

interface ObservationSnapshot {
  sampleId: string;
  operation: string;
  status: "succeeded" | "failed" | "capability_check";
  effectiveRequest: unknown;
  attempts: unknown;
  responseMetadata: unknown;
  timing: unknown;
  rawOutputPreview: string;
  errorMessage?: string;
}

interface RuntimeReport {
  generatedAt: string;
  live: boolean;
  candidateModel: string;
  currentModel: string;
  totalSamples: number;
  totalRequests: number;
  capabilityProbes: number;
  results: Array<{
    sampleId: string;
    operation: string;
    status: "succeeded" | "failed" | "capability_check" | "dry_run";
  }>;
  constraints: {
    maxRequests: number;
    maxCostCny: number;
    ttft: string;
    costEnforcement: string;
  };
  observations: ObservationSnapshot[];
}

function parseArgs(args: string[]): {
  dryRun: boolean;
  live: boolean;
  candidateModel?: string;
  currentModel?: string;
  maxRequests?: number;
  maxCostCny?: number;
  allowCapabilityProbe?: boolean;
} {
  const live = args.includes("--live");
  const dryRun = args.includes("--dry-run") || !live;

  const candidateModelIndex = args.indexOf("--candidate-model");
  const candidateModel =
    candidateModelIndex >= 0 ? args[candidateModelIndex + 1] : undefined;

  const currentModelIndex = args.indexOf("--current-model");
  const currentModel =
    currentModelIndex >= 0 ? args[currentModelIndex + 1] : "glm-5.1";

  const maxRequestsIndex = args.indexOf("--max-requests");
  const maxRequests =
    maxRequestsIndex >= 0 ? Number(args[maxRequestsIndex + 1]) : undefined;

  const maxCostCnyIndex = args.indexOf("--max-cost-cny");
  const maxCostCny =
    maxCostCnyIndex >= 0 ? Number(args[maxCostCnyIndex + 1]) : undefined;

  const allowCapabilityProbe = !args.includes("--no-capability-probe");

  return { dryRun, live, candidateModel, maxRequests, maxCostCny, allowCapabilityProbe };
}

export function validateLiveOptions(args: ReturnType<typeof parseArgs>): string[] {
  const errors: string[] = [];

  if (!args.live) return errors;

  if (!args.candidateModel) {
    errors.push("--live 需要 --candidate-model <model-id>");
  }
  if (args.maxRequests === undefined) {
    errors.push("--live 需要 --max-requests <N>");
  }
  if (args.maxCostCny === undefined) {
    errors.push("--live 需要 --max-cost-cny <金额>");
  }
  if (args.maxRequests !== undefined && args.maxRequests > 8) {
    errors.push("--max-requests 不得超过 8");
  }

  return errors;
}

function getOutputDir(): string {
  const now = new Date();
  const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return resolve(
    process.cwd(),
    "harness",
    "scripts",
    "runtime",
    "output",
    "llm-s2-baseline",
    ts,
  );
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function loadManifest(manifestPath?: string): SampleCase[] {
  const path = manifestPath
    ? resolve(manifestPath!)
    : resolve(
        process.cwd(),
        "harness",
        "samples",
        "llm-s2-baseline",
        "manifest.json",
      );

  if (!existsSync(path)) {
    throw new Error(`manifest not found: ${path}`);
  }

  const raw = readFileSync(path, "utf-8");
  return JSON.parse(raw) as SampleCase[];
}

const CAPABILITY_PROBE_STRICT_SCHEMA: StrictStructuredToolSchema = {
  name: "rank_topic_candidates",
  description: "Rank every topic candidate in the selector pool with scorecards.",
  parameters: {
    type: "object",
    properties: {
      ranked_candidates: {
        type: "array",
        items: {
          type: "object",
          properties: {
            candidate_id: { type: "string" },
            quality_rank: { type: "integer", minimum: 1 },
            quality_score: { type: "integer", minimum: 0, maximum: 100 },
            deductions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  axis: { type: "string" },
                  points_lost: { type: "integer", minimum: 1, maximum: 30 },
                  reason: { type: "string" },
                },
                required: ["axis", "points_lost", "reason"],
              },
            },
          },
          required: ["candidate_id", "quality_rank", "quality_score", "deductions"],
        },
      },
    },
    required: ["ranked_candidates"],
  },
};

function safeRenderMd(entries: LlmInteractionLogEntry[]): string {
  if (entries.length === 0) return "# No interaction log entries captured\n\n";
  return entries
    .map((e, i) => renderLlmInteractionMarkdown({ ...e, sequence: i + 1 }))
    .join("\n---\n");
}

async function runCapabilityProbe(
  gateway: ReturnType<typeof createLlmGateway>,
  outputDir: string,
): Promise<{ passed: boolean; probeMdPath: string; observation: ObservationSnapshot }> {
  const registry = createPromptRegistry();
  const prompt = registry.getPrompt("topic.selector");

  const interactionEntries: LlmInteractionLogEntry[] = [];
  const writer: LlmInteractionLogWriter = {
    write(entry) {
      interactionEntries.push(entry);
    },
  };

  const probeInput = {
    candidates: [
      {
        candidate_id: "probe_c1",
        event_identity: "晏子使楚",
        title: "晏子使楚",
        one_line_angle: "楚王连压三次，晏子一次没退",
        core_conflict: "楚王当众羞辱，晏子不能退",
        strong_scene: "殿前对峙",
        narrative_tension_map: { hook_claim: "hook" },
      },
      {
        candidate_id: "probe_c2",
        event_identity: "完璧归赵",
        title: "完璧归赵",
        one_line_angle: "一块玉壁，一场国运赌局",
        core_conflict: "秦王以城换璧的致命博弈",
        strong_scene: "章台之上，秦王观壁",
        narrative_tension_map: { hook_claim: "hook" },
      },
    ],
  };

  try {
    if (!gateway.invokeStrictStructured) {
      return {
        passed: false,
        probeMdPath: "",
        observation: {
          sampleId: "probe-strict",
          operation: "topic.selector",
          status: "capability_check",
          effectiveRequest: null,
          attempts: null,
          responseMetadata: null,
          timing: null,
          rawOutputPreview: "",
          errorMessage: "provider does not support invokeStrictStructured",
        },
      };
    }

    const result = await gateway.invokeStrictStructured({
      promptId: "topic.selector",
      input: probeInput,
      schema: CAPABILITY_PROBE_STRICT_SCHEMA,
      parse: (candidate) => candidate as unknown,
      interactionLogWriter: writer,
      options: {
        strategy: "tool_call",
      },
      operationName: "probe.strict-tool-call",
    });

    const md = safeRenderMd(interactionEntries);
    const probeMdPath = resolve(outputDir, "probe-strict-capability.md");
    writeFileSync(probeMdPath, md, "utf-8");

    const entry = interactionEntries[0];
    return {
      passed: true,
      probeMdPath,
      observation: {
        sampleId: "probe-strict",
        operation: "topic.selector",
        status: "capability_check",
        effectiveRequest: entry?.effectiveRequest ?? null,
        attempts: entry?.attempts ?? [],
        responseMetadata: entry?.responseMetadata ?? null,
        timing: entry?.timing ?? null,
        rawOutputPreview: typeof result === "object" ? JSON.stringify(result).slice(0, 500) : "",
      },
    };
  } catch (error) {
    const md = safeRenderMd(interactionEntries);
    const probeMdPath = resolve(outputDir, "probe-strict-capability.md");
    writeFileSync(probeMdPath, md, "utf-8");

    const entry = interactionEntries[0];
    return {
      passed: false,
      probeMdPath,
      observation: {
        sampleId: "probe-strict",
        operation: "topic.selector",
        status: "capability_check",
        effectiveRequest: entry?.effectiveRequest ?? null,
        attempts: entry?.attempts ?? [],
        responseMetadata: entry?.responseMetadata ?? null,
        timing: entry?.timing ?? null,
        rawOutputPreview: "",
        errorMessage: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

async function runSample(
  gateway: ReturnType<typeof createLlmGateway>,
  sample: SampleCase,
  outputDir: string,
): Promise<ObservationSnapshot> {
  const registry = createPromptRegistry();
  const interactionEntries: LlmInteractionLogEntry[] = [];
  const writer: LlmInteractionLogWriter = {
    write(entry) {
      interactionEntries.push(entry);
    },
  };

  try {
    let result: unknown;

    if (sample.operation === "topic.selector") {
      if (!gateway.invokeStrictStructured) {
        throw new Error("provider does not support invokeStrictStructured");
      }

      const candidates = (sample.input.candidates ?? []) as Array<Record<string, unknown>>;
      result = await gateway.invokeStrictStructured({
        promptId: "topic.selector",
        input: { candidates },
        schema: CAPABILITY_PROBE_STRICT_SCHEMA,
        parse: (candidate) => candidate as unknown,
        interactionLogWriter: writer,
        options: {
          strategy: "tool_call",
        },
        operationName: sample.operation,
      });
    } else {
      const promptId =
        sample.operation === "script.writer"
          ? "script.script-writer"
          : sample.operation === "storyboard.planner"
            ? "storyboard.storyboard-planner"
            : sample.operation;

      const input =
        sample.input.type === "topic_package"
          ? buildScriptInput(sample)
          : sample.operation === "storyboard.planner"
            ? buildStoryboardInput(sample)
            : sample.input;

      result = await gateway.invokeStructuredPrompt({
        promptId,
        input,
        operationName: sample.operation,
        interactionLogWriter: writer,
        options: {
          maxAttempts: 1,
        },
      });
    }

    const md = safeRenderMd(interactionEntries);
    const mdPath = resolve(outputDir, `sample-${sample.id}.md`);
    writeFileSync(mdPath, md, "utf-8");

    const entry = interactionEntries[0];
    return {
      sampleId: sample.id,
      operation: sample.operation,
      status: "succeeded",
      effectiveRequest: entry?.effectiveRequest ?? null,
      attempts: entry?.attempts ?? [],
      responseMetadata: entry?.responseMetadata ?? null,
      timing: entry?.timing ?? null,
      rawOutputPreview: typeof result === "object" ? JSON.stringify(result).slice(0, 500) : "",
    };
  } catch (error) {
    const md = safeRenderMd(interactionEntries);
    const mdPath = resolve(outputDir, `sample-${sample.id}.md`);
    writeFileSync(mdPath, md, "utf-8");

    const entry = interactionEntries[0];
    return {
      sampleId: sample.id,
      operation: sample.operation,
      status: "failed",
      effectiveRequest: entry?.effectiveRequest ?? null,
      attempts: entry?.attempts ?? [],
      responseMetadata: entry?.responseMetadata ?? null,
      timing: entry?.timing ?? null,
      rawOutputPreview: "",
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

function buildScriptInput(sample: SampleCase): Record<string, unknown> {
  return {
    topic_package: {
      event_identity: "晏子使楚",
      title: "晏子使楚",
      selected_angle: "楚王连压三次，晏子一次没退",
      family_label: "外交",
      scope_label: "完整事件",
      core_conflict: "楚王当众羞辱，晏子不能退",
      strong_scene: "殿前对峙，狗门与橘枳",
      duration_band: { label: "medium" },
      packaging_seed: "楚王连压三次，晏子一次没退",
      canonical_quotes: [
        "使狗国者，从狗门入",
        "橘生淮南则为橘，生于淮北则为枳",
      ],
      canonical_quote_intents: [
        {
          quote: "使狗国者，从狗门入",
          intent: "用于反击楚王以狗门羞辱齐国使节",
        },
        {
          quote: "橘生淮南则为橘，生于淮北则为枳",
          intent: "用于反击楚王以齐人善盗羞辱齐国",
        },
      ],
      must_include_beats: [
        "楚王以狗门羞辱晏子",
        "晏子前两次当众顶回楚王压场",
        "橘枳之喻第三次顶回楚王，楚国收场",
      ],
      forbidden_expansions: [],
      risk_hints: [],
      source_anchor_refs: ["《晏子春秋》"],
      narrative_tension_map: { hook_claim: "楚王连压三次，晏子一次没退" },
    },
  };
}

function buildStoryboardInput(sample: SampleCase): Record<string, unknown> {
  return {
    draft: {
      script_text:
        "楚王第一次压场时，晏子没有退。使狗国者从狗门入——他站在殿前，看着那扇为羞辱他而开的矮门，一句话就顶了回去。第二次，楚王又说齐国没人，才派这样的人来。晏子不卑不亢，用出使规矩当面驳斥。最后，楚王故意安排齐人盗劫，想用这个证明齐人本性。晏子终于落下橘生淮南则为橘、生于淮北则为枳——他在众目睽睽之下，把整个场面从羞辱晏子逆转成了羞辱楚国。事毕，楚国君臣再无挑衅之意。",
      estimated_duration_sec: 58,
      beat_trace: [
        { beat: "狗门羞辱", excerpt: "使狗国者从狗门入", confidence: 0.92 },
        { beat: "齐国无人", excerpt: "楚王又说齐国没人", confidence: 0.9 },
        { beat: "橘枳之喻", excerpt: "橘生淮南则为橘", confidence: 0.95 },
      ],
      quote_trace: [
        { quote: "使狗国者，从狗门入", usage_type: "exact", excerpt: "使狗国者从狗门入" },
        { quote: "橘生淮南则为橘，生于淮北则为枳", usage_type: "exact", excerpt: "橘生淮南则为橘" },
      ],
      opening_span: "楚王第一次压场时，晏子没有退。",
      ending_span: "楚国君臣再无挑衅之意。",
    },
    topic_boundary_context: {
      title: "晏子使楚",
      selected_angle: "楚王连压三次，晏子一次没退",
      core_conflict: "楚王连续压场，晏子必须顶回去",
      strong_scene: "殿前对峙",
      forbidden_expansions: [],
      risk_hints: [],
      source_anchor_refs: ["《晏子春秋》"],
      canonical_quotes: ["使狗国者，从狗门入", "橘生淮南则为橘，生于淮北则为枳"],
      narrative_tension_map: { hook_claim: "楚王连压三次，晏子一次没退" },
    },
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.live) {
    const errors = validateLiveOptions(args);
    if (errors.length > 0) {
      console.error("live 模式参数不足：");
      for (const err of errors) {
        console.error(`  ${err}`);
      }
      process.exit(1);
    }
  }

  const manifest = loadManifest();
  const totalBudget = args.live ? (args.maxRequests ?? 6) : 0;
  const probeQuota = args.live && args.allowCapabilityProbe ? 1 : 0;
  const sampleQuota = manifest.length;

  if (args.live && probeQuota + sampleQuota > totalBudget) {
    console.error(
      `请求预算不足：probe(${probeQuota}) + samples(${sampleQuota}) > max-requests(${totalBudget})`,
    );
    process.exit(1);
  }

  const outputDir = getOutputDir();
  mkdirSync(outputDir, { recursive: true });

  if (!args.live) {
    const report: RuntimeReport = {
      generatedAt: new Date().toISOString(),
      live: false,
      candidateModel: args.candidateModel ?? "none",
      currentModel: args.currentModel ?? "glm-5.1",
      totalSamples: manifest.length,
      totalRequests: 0,
      capabilityProbes: 0,
      results: manifest.map((c) => ({
        sampleId: c.id,
        operation: c.operation,
        status: "dry_run" as const,
      })),
      constraints: {
        maxRequests: 0,
        maxCostCny: 0,
        ttft: "unobservable_non_streaming",
        costEnforcement: "unavailable",
      },
      observations: [],
    };

    const reportPath = resolve(outputDir, "baseline-report.json");
    writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf-8");

    console.log(
      JSON.stringify(
        {
          report_path: reportPath,
          summary: {
            live: false,
            candidate_model: report.candidateModel,
            total_samples: report.totalSamples,
          },
        },
        null,
        2,
      ),
    );
    return;
  }

  const candidateModel = args.candidateModel!;
  const maxCostCny = args.maxCostCny!;

  console.error(
    `[baseline] 安全护栏: model=${candidateModel}, max_requests=${totalBudget}, max_cost_cny=${maxCostCny}元, cost_enforcement=unavailable`,
  );

  const provider = createOpenAiCompatibleProvider({
    model: candidateModel,
    maxAttempts: 1,
  });
  const gateway = createLlmGateway({
    registry: createPromptRegistry(),
    provider,
  });

  const observations: ObservationSnapshot[] = [];
  let actualRequests = 0;

  if (probeQuota > 0) {
    console.error("[baseline] 开始 capability probe (strict tool-call) …");
    const probeResult = await runCapabilityProbe(gateway, outputDir);
    observations.push(probeResult.observation);
    actualRequests += 1;

    if (!probeResult.passed) {
      console.error("[baseline] capability probe 失败，跳过后续样本。");
      console.error(`[baseline] 错误: ${probeResult.observation.errorMessage}`);
    } else {
      console.error("[baseline] capability probe 通过。");
    }
  }

  const probeFailed = observations.length > 0 && observations[0].status === "capability_check"
    ? !(observations[0] as { status: string; errorMessage?: string }).errorMessage
      ? false
      : true
    : false;

  if (!probeFailed) {
    for (const sample of manifest) {
      if (actualRequests >= totalBudget) {
        console.error(`[baseline] 请求预算耗尽 (${actualRequests}/${totalBudget})，跳过 ${sample.id}`);
        observations.push({
          sampleId: sample.id,
          operation: sample.operation,
          status: "failed",
          effectiveRequest: null,
          attempts: [],
          responseMetadata: null,
          timing: null,
          rawOutputPreview: "",
          errorMessage: "budget_exhausted",
        });
        continue;
      }

      console.error(`[baseline] 运行样本: ${sample.id} (${sample.operation}) …`);
      const snap = await runSample(gateway, sample, outputDir);
      observations.push(snap);
      actualRequests += 1;

      console.error(
        `[baseline] ${sample.id}: ${snap.status}` +
          (snap.timing ? ` duration=${(snap.timing as { durationMs: number }).durationMs}ms` : ""),
      );
    }
  }

  const report: RuntimeReport = {
    generatedAt: new Date().toISOString(),
    live: true,
    candidateModel,
    currentModel: args.currentModel ?? "glm-5.1",
    totalSamples: manifest.length,
    totalRequests: actualRequests,
    capabilityProbes: probeQuota,
    results: observations.map((o) => ({
      sampleId: o.sampleId,
      operation: o.operation,
      status: o.status,
    })),
    constraints: {
      maxRequests: totalBudget,
      maxCostCny,
      ttft: "unobservable_non_streaming",
      costEnforcement: "unavailable",
    },
    observations,
  };

  const reportPath = resolve(outputDir, "baseline-report.json");
  writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf-8");

  const summary = {
    report_path: reportPath,
    live: true,
    candidate_model: candidateModel,
    total_samples: manifest.length,
    total_requests: actualRequests,
    capability_probes: probeQuota,
    probe_passed: probeQuota > 0 ? !probeFailed : null,
    max_requests: totalBudget,
    max_cost_cny: maxCostCny,
    ttft: "unobservable_non_streaming",
    cost_enforcement: "unavailable",
    results: report.results,
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error("llm-s2-baseline 失败:", err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(1);
});

