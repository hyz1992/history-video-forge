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
import type { StructuredPromptProvider } from "../../../backend/src/runtime/llm/provider-contract.js";
import {
  parseStrictSelectorDecision,
  TOPIC_SELECTOR_STRICT_SCHEMA,
} from "../../../backend/src/modules/topic/topic-recommendation.service.js";
import { ScriptDraftPackage, StoryboardPlan } from "../../../shared/src/index.js";
import { validateScriptDraft } from "../../../backend/src/modules/script/script-local-validator.js";
import { validateStoryboardPlan } from "../../../backend/src/modules/storyboard/storyboard-local-validator.js";

interface SampleCase {
  id: string;
  operation: string;
  description: string;
  input: Record<string, unknown>;
}

interface ObservationSnapshot {
  sampleId: string;
  operation: string;
  profile: "current" | "candidate";
  status: "succeeded" | "failed" | "capability_check";
  effectiveRequest: unknown;
  attempts: unknown;
  responseMetadata: unknown;
  timing: unknown;
  rawOutputPreview: string;
  zodResult: "passed" | "failed" | "skipped";
  validatorDecision?: string;
  validatorErrors: string[];
  validatorWarnings: string[];
  firstPassResult: "passed" | "failed" | "skipped" | "unexercised";
  repairTriggered: boolean;
  repairResult: "passed" | "failed" | "skipped" | "unexercised";
  regenTriggered: boolean;
  regenResult: "passed" | "failed" | "skipped" | "unexercised";
  errorMessage?: string;
}

interface RuntimeReport {
  generatedAt: string;
  live: boolean;
  candidateModel: string;
  currentMainModel: string;
  currentStructuredModel: string;
  totalSamples: number;
  totalRequests: number;
  capabilityProbes: number;
  executionMatrix: ReturnType<typeof buildExecutionMatrix>;
  results: Array<{
    sampleId: string;
    operation: string;
    profile: "current" | "candidate";
    status: "succeeded" | "failed" | "capability_check" | "dry_run";
    zodResult?: string;
    validatorDecision?: string;
    firstPass?: string;
    repair?: string;
    regen?: string;
  }>;
  constraints: {
    maxRequests: number;
    maxCostCny: number;
    ttft: string;
    costEnforcement: string;
  };
  observations: ObservationSnapshot[];
}

export interface BaselineProfile {
  label: "current" | "candidate";
  mainModel: string;
  structuredModel: string;
}

export interface SampleDiagnosticOptions {
  thinking?: "enabled" | "disabled";
  forceTargetTool?: boolean;
}

export function parseArgs(args: string[]): {
  dryRun: boolean;
  live: boolean;
  candidateModel?: string;
  currentMainModel?: string;
  currentStructuredModel?: string;
  maxRequests?: number;
  maxCostCny?: number;
  enableCapabilityProbe?: boolean;
  profileScope?: string;
  candidateThinking?: string;
  forceTargetTool?: boolean;
} {
  const live = args.includes("--live");
  const dryRun = args.includes("--dry-run") || !live;

  const candidateModelIndex = args.indexOf("--candidate-model");
  const candidateModel =
    candidateModelIndex >= 0 ? args[candidateModelIndex + 1] : undefined;

  const currentMainModelIndex = args.indexOf("--current-main-model");
  const currentMainModel =
    currentMainModelIndex >= 0 ? args[currentMainModelIndex + 1] : "glm-5.1";

  const currentStructuredModelIndex = args.indexOf("--current-structured-model");
  const currentStructuredModel =
    currentStructuredModelIndex >= 0 ? args[currentStructuredModelIndex + 1] : "glm-4";

  const maxRequestsIndex = args.indexOf("--max-requests");
  const maxRequests =
    maxRequestsIndex >= 0 ? Number(args[maxRequestsIndex + 1]) : undefined;

  const maxCostCnyIndex = args.indexOf("--max-cost-cny");
  const maxCostCny =
    maxCostCnyIndex >= 0 ? Number(args[maxCostCnyIndex + 1]) : undefined;

  const enableCapabilityProbe = args.includes("--enable-probe");

  const profileScopeIndex = args.indexOf("--profile-scope");
  const profileScope =
    profileScopeIndex >= 0 ? args[profileScopeIndex + 1] : "both";

  const candidateThinkingIndex = args.indexOf("--candidate-thinking");
  const candidateThinking =
    candidateThinkingIndex >= 0 ? args[candidateThinkingIndex + 1] : undefined;

  const forceTargetTool = args.includes("--force-target-tool");

  return {
    dryRun,
    live,
    candidateModel,
    currentMainModel,
    currentStructuredModel,
    maxRequests,
    maxCostCny,
    enableCapabilityProbe,
    profileScope,
    candidateThinking,
    forceTargetTool,
  };
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
  if (
    args.profileScope !== undefined
    && !["both", "candidate-only"].includes(args.profileScope)
  ) {
    errors.push("--profile-scope 仅支持 both 或 candidate-only");
  }
  if (
    args.candidateThinking !== undefined
    && !["enabled", "disabled"].includes(args.candidateThinking)
  ) {
    errors.push("--candidate-thinking 仅支持 enabled 或 disabled");
  }
  if (
    args.profileScope === "candidate-only"
    && args.maxRequests !== undefined
    && args.maxRequests > 6
  ) {
    errors.push("candidate-only 诊断的 --max-requests 不得超过 6");
  }

  return errors;
}

export function buildExecutionMatrix(
  args: ReturnType<typeof parseArgs>,
  sampleCount: number,
): {
  profiles: Array<"current" | "candidate">;
  probeRequests: number;
  sampleRequests: number;
  requiredRequests: number;
  candidateOptions: SampleDiagnosticOptions;
} {
  const profiles: Array<"current" | "candidate"> =
    args.profileScope === "candidate-only"
      ? ["candidate"]
      : ["current", "candidate"];
  const probeRequests = args.enableCapabilityProbe ? 1 : 0;
  const sampleRequests = profiles.length * sampleCount;
  const candidateThinking =
    args.candidateThinking === "enabled" || args.candidateThinking === "disabled"
      ? args.candidateThinking
      : undefined;
  return {
    profiles,
    probeRequests,
    sampleRequests,
    requiredRequests: probeRequests + sampleRequests,
    candidateOptions: {
      thinking: candidateThinking,
      forceTargetTool: args.forceTargetTool === true,
    },
  };
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

function safeRenderMd(entries: LlmInteractionLogEntry[]): string {
  if (entries.length === 0) return "# No interaction log entries captured\n\n";
  return entries
    .map((e, i) => renderLlmInteractionMarkdown({ ...e, sequence: i + 1 }))
    .join("\n---\n");
}

function createEmptyObs(
  sampleId: string,
  operation: string,
  profile: "current" | "candidate",
): ObservationSnapshot {
  return {
    sampleId,
    operation,
    profile,
    status: "failed",
    effectiveRequest: null,
    attempts: [],
    responseMetadata: null,
    timing: null,
    rawOutputPreview: "",
    zodResult: "skipped",
    validatorDecision: undefined,
    validatorErrors: [],
    validatorWarnings: [],
    firstPassResult: "unexercised",
    repairTriggered: false,
    repairResult: "unexercised",
    regenTriggered: false,
    regenResult: "unexercised",
  };
}

export async function runCapabilityProbe(
  structuredGateway: ReturnType<typeof createLlmGateway>,
  outputDir: string,
  profile: BaselineProfile,
): Promise<{ passed: boolean; probeMdPath: string; observation: ObservationSnapshot }> {
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

  const baseObs = createEmptyObs(
    "probe-strict",
    "probe.strict-tool-call",
    profile.label,
  );

  try {
    if (!structuredGateway.invokeStrictStructured) {
      return {
        passed: false,
        probeMdPath: "",
        observation: { ...baseObs, status: "capability_check", errorMessage: "provider does not support invokeStrictStructured" },
      };
    }

    const result = await structuredGateway.invokeStrictStructured({
      promptId: "topic.selector",
      input: probeInput,
      schema: TOPIC_SELECTOR_STRICT_SCHEMA,
      parse: parseStrictSelectorDecision,
      interactionLogWriter: writer,
      options: {
        strategy: "tool_call",
        toolChoice: "target_function",
      },
      operationName: "probe.strict-tool-call",
    });

    const md = safeRenderMd(interactionEntries);
    const probeMdPath = resolve(outputDir, `probe-${profile.label}-capability.md`);
    writeFileSync(probeMdPath, md, "utf-8");

    const entry = interactionEntries[0];
    return {
      passed: true,
      probeMdPath,
      observation: {
        ...baseObs,
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
    const probeMdPath = resolve(outputDir, `probe-${profile.label}-capability.md`);
    writeFileSync(probeMdPath, md, "utf-8");

    const entry = interactionEntries[0];
    return {
      passed: false,
      probeMdPath,
      observation: {
        ...baseObs,
        status: "capability_check",
        effectiveRequest: entry?.effectiveRequest ?? null,
        attempts: entry?.attempts ?? [],
        responseMetadata: entry?.responseMetadata ?? null,
        timing: entry?.timing ?? null,
        errorMessage: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

export async function runSample(
  mainGateway: ReturnType<typeof createLlmGateway>,
  structuredGateway: ReturnType<typeof createLlmGateway>,
  sample: SampleCase,
  outputDir: string,
  profile: BaselineProfile,
  diagnosticOptions: SampleDiagnosticOptions = {},
): Promise<ObservationSnapshot> {
  const interactionEntries: LlmInteractionLogEntry[] = [];
  const writer: LlmInteractionLogWriter = {
    write(entry) {
      interactionEntries.push(entry);
    },
  };

  const obs = createEmptyObs(sample.id, sample.operation, profile.label);

  try {
    let rawResult: unknown;
    let validatorDecision: string | undefined;
    let validatorErrors: string[] = [];
    let validatorWarnings: string[] = [];

    if (sample.operation === "topic.selector") {
      const candidates = (sample.input.candidates ?? []) as Array<Record<string, unknown>>;
      rawResult = await structuredGateway.invokeStrictStructured({
        promptId: "topic.selector",
        input: { candidates },
        schema: TOPIC_SELECTOR_STRICT_SCHEMA,
        parse: parseStrictSelectorDecision,
        interactionLogWriter: writer,
        options: {
          strategy: "tool_call",
          thinking: diagnosticOptions.thinking,
          toolChoice: diagnosticOptions.forceTargetTool
            ? "target_function"
            : undefined,
        },
        operationName: sample.operation,
      });
      obs.firstPassResult = "passed";
      obs.zodResult = "passed";
    } else if (sample.operation === "script.writer") {
      const input = buildScriptInput(sample, profile);
      rawResult = await mainGateway.invokeStructuredPrompt({
        promptId: "script.script-writer",
        input,
        operationName: sample.operation,
        interactionLogWriter: writer,
        options: {
          maxAttempts: 1,
          thinking: diagnosticOptions.thinking,
        },
      });

      try {
        ScriptDraftPackage.parse(rawResult);
        obs.zodResult = "passed";
        obs.firstPassResult = "passed";

        const validatorBundle = {
          hard_lane: {
            must_include_beats: (input as Record<string, unknown>).hard_lane ? ((input as Record<string, unknown>).hard_lane as Record<string, unknown>).must_include_beats as string[] : [],
            forbidden_expansions: [] as string[],
            duration_band: "medium",
          },
        };
        const validation = validateScriptDraft({ draft: rawResult as any, bundle: validatorBundle as any });
        validatorDecision = validation.decision;
        validatorErrors = (validation.errors ?? []) as string[];
        validatorWarnings = (validation.warnings ?? []) as string[];
      } catch {
        obs.zodResult = "failed";
        obs.firstPassResult = "failed";
      }
    } else if (sample.operation === "storyboard.planner") {
      const input = buildStoryboardInput(sample, profile);
      rawResult = await mainGateway.invokeStructuredPrompt({
        promptId: "storyboard.storyboard-planner",
        input,
        operationName: sample.operation,
        interactionLogWriter: writer,
        options: {
          maxAttempts: 1,
          thinking: diagnosticOptions.thinking,
        },
      });

      try {
        StoryboardPlan.parse(rawResult);
        obs.zodResult = "passed";
        obs.firstPassResult = "passed";

        const draft = ScriptDraftPackage.parse(input.draft);
        const validation = validateStoryboardPlan({ draft, plan: rawResult as any });
        validatorDecision = validation.decision;
        validatorErrors = validation.errors ?? [];
        validatorWarnings = validation.warnings ?? [];
      } catch {
        obs.zodResult = "failed";
        obs.firstPassResult = "failed";
      }
    }

    const md = safeRenderMd(interactionEntries);
    const mdPath = resolve(outputDir, `sample-${profile.label}-${sample.id}.md`);
    writeFileSync(mdPath, md, "utf-8");

    const entry = interactionEntries[0];
    return {
      ...obs,
      status: "succeeded",
      effectiveRequest: entry?.effectiveRequest ?? null,
      attempts: entry?.attempts ?? [],
      responseMetadata: entry?.responseMetadata ?? null,
      timing: entry?.timing ?? null,
      rawOutputPreview: typeof rawResult === "object" ? JSON.stringify(rawResult).slice(0, 500) : "",
      validatorDecision,
      validatorErrors,
      validatorWarnings,
    };
  } catch (error) {
    const md = safeRenderMd(interactionEntries);
    const mdPath = resolve(outputDir, `sample-${profile.label}-${sample.id}.md`);
    writeFileSync(mdPath, md, "utf-8");

    const entry = interactionEntries[0];
    return {
      ...obs,
      status: "failed",
      effectiveRequest: entry?.effectiveRequest ?? null,
      attempts: entry?.attempts ?? [],
      responseMetadata: entry?.responseMetadata ?? null,
      timing: entry?.timing ?? null,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

function buildScriptInput(_sample: SampleCase, _profile: BaselineProfile): Record<string, unknown> {
  return {
    topic_package: {
      source_anchor_refs: ["《晏子春秋》"],
      canonical_quotes: ["使狗国者，从狗门入", "橘生淮南则为橘，生于淮北则为枳"],
    },
    hard_lane: {
      event_identity: "晏子使楚",
      selected_angle: "楚王连压三次，晏子一次没退",
      core_conflict: "楚王当众羞辱，晏子不能退",
      must_include_beats: [
        "楚王以狗门羞辱晏子",
        "晏子前两次当众顶回楚王压场",
        "橘枳之喻第三次顶回楚王，楚国收场",
      ],
      source_anchor_refs: ["《晏子春秋》"],
      canonical_quotes: ["使狗国者，从狗门入", "橘生淮南则为橘，生于淮北则为枳"],
    },
    soft_lane: {
      narrative_tension_map: {
        hook_claim: "楚王连压三次，晏子一次没退",
        pressure_escalation: "楚王连续升级羞辱手段",
        mid_reveal: "晏子每次都以子之矛攻子之盾",
        peak_payoff: "橘枳之喻逆转全场",
        ending_residue: "楚国君臣无言以对",
      },
      strong_scene: "殿前对峙，狗门与橘枳",
    },
    packaging_lane: {
      hook_claim: "楚王连压三次，晏子一次没退",
    },
  };
}

function buildStoryboardInput(_sample: SampleCase, _profile: BaselineProfile): Record<string, unknown> {
  return {
    draft: {
      script_text:
        "楚王第一次压场时，晏子没有退。使狗国者从狗门入——他站在殿前，看着那扇为羞辱他而开的矮门，一句话就顶了回去。第二次，楚王又说齐国没人，才派这样的人来。晏子不卑不亢，用出使规矩当面驳斥。最后，楚王故意安排齐人盗劫，想用这个证明齐人本性。晏子终于落下橘生淮南则为橘、生于淮北则为枳——他在众目睽睽之下，把整个场面从羞辱晏子逆转成了羞辱楚国。事毕，楚国君臣再无挑衅之意。",
      estimated_duration_sec: 85,
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

export type GatewayProviderConfig = {
  profile: "main" | "structured";
  model: string;
  maxAttempts: number;
};

export function describeGatewayProfile(profile: BaselineProfile): {
  main: GatewayProviderConfig;
  structured: GatewayProviderConfig;
} {
  return {
    main: { profile: "main", model: profile.mainModel, maxAttempts: 1 },
    structured: { profile: "structured", model: profile.structuredModel, maxAttempts: 1 },
  };
}

export type ProviderFactory = (config: GatewayProviderConfig) => StructuredPromptProvider;

const defaultProviderFactory: ProviderFactory = (config) =>
  createOpenAiCompatibleProvider(config);

export function createGateways(
  profile: BaselineProfile,
  options: { providerFactory?: ProviderFactory } = {},
) {
  const factory = options.providerFactory ?? defaultProviderFactory;
  const cfg = describeGatewayProfile(profile);

  const mainProvider = factory(cfg.main);
  const mainGateway = createLlmGateway({
    registry: createPromptRegistry(),
    provider: mainProvider,
  });

  const structuredProvider = factory(cfg.structured);
  const structuredGateway = createLlmGateway({
    registry: createPromptRegistry(),
    provider: structuredProvider,
  });

  return { mainGateway, structuredGateway };
}

async function runSamplesForProfile(
  profile: BaselineProfile,
  manifest: SampleCase[],
  outputDir: string,
  budget: { remaining: number },
  diagnosticOptions: SampleDiagnosticOptions = {},
): Promise<ObservationSnapshot[]> {
  const observations: ObservationSnapshot[] = [];

  const { mainGateway, structuredGateway } = createGateways(profile);

  for (const sample of manifest) {
    if (budget.remaining <= 0) {
      console.error(`[baseline] 请求预算耗尽，跳过 ${profile.label}/${sample.id}`);
      observations.push({
        ...createEmptyObs(sample.id, sample.operation, profile.label),
        errorMessage: "budget_exhausted",
      });
      continue;
    }

    console.error(`[baseline] 运行 ${profile.label}: ${sample.id} (${sample.operation}) main=${profile.mainModel} structured=${profile.structuredModel} …`);
    const snap = await runSample(
      mainGateway,
      structuredGateway,
      sample,
      outputDir,
      profile,
      diagnosticOptions,
    );
    observations.push(snap);
    budget.remaining -= 1;

    console.error(
      `[baseline] ${profile.label}/${sample.id}: ${snap.status} zod=${snap.zodResult}` +
        (snap.timing ? ` duration=${(snap.timing as { durationMs: number }).durationMs}ms` : ""),
    );
  }

  return observations;
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
  const executionMatrix = buildExecutionMatrix(args, manifest.length);
  const probeQuota = executionMatrix.probeRequests;
  const totalBudget = args.live ? (args.maxRequests ?? executionMatrix.requiredRequests) : 0;

  if (args.live && executionMatrix.requiredRequests > totalBudget) {
    console.error(
      `请求预算不足：计划 ${executionMatrix.requiredRequests} 次（profiles=${executionMatrix.profiles.join(",")}, probe=${probeQuota}）> max-requests(${totalBudget})`,
    );
    process.exit(1);
  }

  const outputDir = getOutputDir();
  mkdirSync(outputDir, { recursive: true });

  const currentProfile: BaselineProfile = {
    label: "current",
    mainModel: args.currentMainModel ?? "glm-5.1",
    structuredModel: args.currentStructuredModel ?? "glm-4",
  };

  if (!args.live) {
    const report: RuntimeReport = {
      generatedAt: new Date().toISOString(),
      live: false,
      candidateModel: args.candidateModel ?? "none",
      currentMainModel: currentProfile.mainModel,
      currentStructuredModel: currentProfile.structuredModel,
      totalSamples: manifest.length,
      totalRequests: 0,
      capabilityProbes: probeQuota,
      executionMatrix,
      results: [
        ...(probeQuota > 0
          ? [{
              sampleId: "probe-strict",
              operation: "probe.strict-tool-call",
              profile: "candidate" as const,
              status: "dry_run" as const,
            }]
          : []),
        ...manifest.flatMap((c) => executionMatrix.profiles.map((profile) => ({
          sampleId: c.id,
          operation: c.operation,
          profile,
          status: "dry_run" as const,
        }))),
      ],
      constraints: {
        maxRequests: executionMatrix.requiredRequests,
        maxCostCny: args.maxCostCny ?? 0,
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
            current_models: `${currentProfile.mainModel}/${currentProfile.structuredModel}`,
            total_samples: report.totalSamples,
            execution_matrix: executionMatrix,
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
  const budget = { remaining: totalBudget };

  console.error(
    `[baseline] 安全护栏: current=${currentProfile.mainModel}/${currentProfile.structuredModel}, candidate=${candidateModel}, max_requests=${totalBudget}, max_cost_cny=${maxCostCny}元, cost_enforcement=unavailable`,
  );

  const candidateProfile: BaselineProfile = {
    label: "candidate",
    mainModel: candidateModel,
    structuredModel: candidateModel,
  };

  const allObservations: ObservationSnapshot[] = [];

  if (probeQuota > 0) {
    console.error("[baseline] 开始 capability probe (candidate strict tool-call) …");
    const { structuredGateway } = createGateways(candidateProfile);
    const probeResult = await runCapabilityProbe(structuredGateway, outputDir, candidateProfile);
    allObservations.push(probeResult.observation);
    budget.remaining -= 1;

    if (!probeResult.passed) {
      console.error("[baseline] capability probe 失败，跳过后续样本。");
      console.error(`[baseline] 错误: ${probeResult.observation.errorMessage}`);
    } else {
      console.error("[baseline] capability probe 通过。");
    }
  }

  const probeFailed = allObservations.length > 0
    && allObservations[0].status === "capability_check"
    && allObservations[0].errorMessage != null;

  if (!probeFailed) {
    if (executionMatrix.profiles.includes("current")) {
      const currentObs = await runSamplesForProfile(currentProfile, manifest, outputDir, budget);
      allObservations.push(...currentObs);
    }

    if (executionMatrix.profiles.includes("candidate")) {
      const candidateObs = await runSamplesForProfile(
        candidateProfile,
        manifest,
        outputDir,
        budget,
        executionMatrix.candidateOptions,
      );
      allObservations.push(...candidateObs);
    }
  }

  const report: RuntimeReport = {
    generatedAt: new Date().toISOString(),
    live: true,
    candidateModel,
    currentMainModel: currentProfile.mainModel,
    currentStructuredModel: currentProfile.structuredModel,
    totalSamples: manifest.length,
    totalRequests: totalBudget - budget.remaining,
    capabilityProbes: probeQuota,
    executionMatrix,
    results: allObservations.map((o) => ({
      sampleId: o.sampleId,
      operation: o.operation,
      profile: o.profile,
      status: o.status,
      zodResult: o.zodResult,
      validatorDecision: o.validatorDecision,
      firstPass: o.firstPassResult,
      repair: o.repairResult,
      regen: o.regenResult,
    })),
    constraints: {
      maxRequests: totalBudget,
      maxCostCny,
      ttft: "unobservable_non_streaming",
      costEnforcement: "unavailable",
    },
    observations: allObservations,
  };

  const reportPath = resolve(outputDir, "baseline-report.json");
  writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf-8");

  const summary = {
    report_path: reportPath,
    live: true,
    candidate_model: candidateModel,
    current_models: `${currentProfile.mainModel}/${currentProfile.structuredModel}`,
    total_samples: manifest.length,
    total_requests: totalBudget - budget.remaining,
    capability_probes: probeQuota,
    execution_matrix: executionMatrix,
    probe_passed: probeQuota > 0 ? !probeFailed : null,
    max_requests: totalBudget,
    max_cost_cny: maxCostCny,
    ttft: "unobservable_non_streaming",
    cost_enforcement: "unavailable",
    results: report.results,
  };

  console.log(JSON.stringify(summary, null, 2));
}

const isDirectRun = (() => {
  if (typeof process === "undefined" || !process.argv[1]) return false;
  const entry = process.argv[1].replace(/\\/g, "/");
  return entry.endsWith("llm-s2-baseline.ts") || entry.endsWith("llm-s2-baseline.js");
})();

if (isDirectRun) {
  main().catch((err) => {
    console.error("llm-s2-baseline 失败:", err instanceof Error ? (err.stack ?? err.message) : String(err));
    process.exit(1);
  });
}
