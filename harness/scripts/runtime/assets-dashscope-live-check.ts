import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { createDbClient } from "../../../backend/src/db/client.js";
import { createProject } from "../../../backend/src/modules/projects/project.repository.js";
import { runAssetsGeneration } from "../../../backend/src/modules/assets/assets-run.service.js";

export interface BuildAssetsDashscopeLiveCheckPlanInput {
  outputDir?: string;
}

export interface AssetsDashscopeLiveCheckPlan {
  mode: "assets_dashscope_live_check";
  automated_gate: false;
  requires_real_env: true;
  provider_mode: "dashscope";
  output_dir: string;
  required_env_keys: string[];
  required_artifacts: string[];
  required_checks: string[];
}

export interface AssetsDashscopeLiveCheckSampleResult {
  statusCode: number;
  localValidationDecision: string | null;
  localValidationErrors: string[];
  localValidationWarnings: string[];
  providerNames: string[];
  artifactTypes: string[];
  outputDir: string;
  manifestRecordId: string | null;
  assetRunTracePhase: string | null;
}

export interface AssetsDashscopeLiveCheckResult extends AssetsDashscopeLiveCheckPlan {
  status: "live-check-completed";
  status_code: number;
  local_validation_decision: string | null;
  local_validation_errors: string[];
  local_validation_warnings: string[];
  provider_names: string[];
  artifact_types: string[];
  sample_output_dir: string;
  asset_manifest_record_id: string | null;
  asset_run_trace_phase: string | null;
}

export interface AssetsDashscopeLiveCheckEnv {
  ALIYUN_DASHSCOPE_API_KEY?: string;
  ALIYUN_DASHSCOPE_BASE_URL?: string;
  ALIYUN_DASHSCOPE_TEXT_TO_IMAGE_MODEL?: string;
  ALIYUN_DASHSCOPE_TTS_MODEL?: string;
  ALIYUN_DASHSCOPE_MODEL?: string;
  TTS_MODEL?: string;
}

export interface AssetsDashscopeLiveCheckDependencies {
  requireRealEnv?: boolean;
  env?: AssetsDashscopeLiveCheckEnv;
  sampleRunner?: (input: {
    outputDir: string;
    env: Required<Pick<
      AssetsDashscopeLiveCheckEnv,
      | "ALIYUN_DASHSCOPE_API_KEY"
      | "ALIYUN_DASHSCOPE_BASE_URL"
      | "ALIYUN_DASHSCOPE_TEXT_TO_IMAGE_MODEL"
      | "ALIYUN_DASHSCOPE_TTS_MODEL"
    >>;
  }) => Promise<AssetsDashscopeLiveCheckSampleResult>;
}

const DEFAULT_OUTPUT_DIR = resolve(
  process.cwd(),
  "harness/scripts/runtime/output/assets-dashscope-live-check",
);

export function buildAssetsDashscopeLiveCheckPlan(
  input: BuildAssetsDashscopeLiveCheckPlanInput = {},
): AssetsDashscopeLiveCheckPlan {
  return {
    mode: "assets_dashscope_live_check",
    automated_gate: false,
    requires_real_env: true,
    provider_mode: "dashscope",
    output_dir: input.outputDir ?? DEFAULT_OUTPUT_DIR,
    required_env_keys: [
      "ALIYUN_DASHSCOPE_API_KEY",
      "ALIYUN_DASHSCOPE_BASE_URL",
      "ALIYUN_DASHSCOPE_TEXT_TO_IMAGE_MODEL",
      "ALIYUN_DASHSCOPE_TTS_MODEL",
    ],
    required_artifacts: [
      "live-check-plan.json",
      "live-check-summary.json",
      "trace.md",
    ],
    required_checks: [
      "必须显式运行，不进入默认自动化 gate。",
      "不输出 API key，不提交生成产物。",
      "确认 provider_names 同时包含 dashscope_tts 和 dashscope_image。",
      "记录 local_validation_decision，但不把真实 live check 当作默认发布门禁。",
    ],
  };
}

export async function runAssetsDashscopeLiveCheck(
  input: BuildAssetsDashscopeLiveCheckPlanInput = {},
  dependencies: AssetsDashscopeLiveCheckDependencies = {},
): Promise<AssetsDashscopeLiveCheckResult> {
  const plan = buildAssetsDashscopeLiveCheckPlan(input);
  mkdirSync(plan.output_dir, { recursive: true });
  writeJson(plan.output_dir, "live-check-plan.json", plan);

  const env = resolveDashscopeEnv(dependencies.env);
  const requireRealEnv = dependencies.requireRealEnv ?? true;
  if (requireRealEnv) {
    assertRequiredEnv(env);
  }
  const resolvedEnv = withEnvDefaults(env);
  const sampleRunner = dependencies.sampleRunner ?? runDefaultSample;
  const sampleResult = await sampleRunner({
    outputDir: plan.output_dir,
    env: resolvedEnv,
  });

  const result: AssetsDashscopeLiveCheckResult = {
    ...plan,
    status: "live-check-completed",
    status_code: sampleResult.statusCode,
    local_validation_decision: sampleResult.localValidationDecision,
    local_validation_errors: sampleResult.localValidationErrors,
    local_validation_warnings: sampleResult.localValidationWarnings,
    provider_names: sampleResult.providerNames,
    artifact_types: sampleResult.artifactTypes,
    sample_output_dir: sampleResult.outputDir,
    asset_manifest_record_id: sampleResult.manifestRecordId,
    asset_run_trace_phase: sampleResult.assetRunTracePhase,
  };

  writeJson(plan.output_dir, "live-check-summary.json", result);
  writeTrace(plan.output_dir, result);

  return result;
}

async function runDefaultSample(input: {
  outputDir: string;
  env: Required<Pick<
    AssetsDashscopeLiveCheckEnv,
    | "ALIYUN_DASHSCOPE_API_KEY"
    | "ALIYUN_DASHSCOPE_BASE_URL"
    | "ALIYUN_DASHSCOPE_TEXT_TO_IMAGE_MODEL"
    | "ALIYUN_DASHSCOPE_TTS_MODEL"
  >>;
}): Promise<AssetsDashscopeLiveCheckSampleResult> {
  const db = createDbClient();
  const project = await createProject(db, { name: "assets dashscope live check" });
  const projectStorageRootDir = resolve(input.outputDir, "project-storage");
  mkdirSync(projectStorageRootDir, { recursive: true });

  project.storageRootDir = projectStorageRootDir;
  project.activeAssetPlanRecordId = "asset_plan_dashscope_live_check";
  project.status = "asset_plan_ready";

  db.storyboardRecords.set("storyboard_dashscope_live_check", {
    id: "storyboard_dashscope_live_check",
    projectId: project.id,
    topicPackageId: "topic_dashscope_live_check",
    scriptRecordId: "script_dashscope_live_check",
    planJson: {
      segments: [
        {
          segment_id: "sb_001",
        },
      ],
    },
    validationResultJson: {},
    executionStateJson: null,
    graphTraceSummaryJson: null,
    runtimeDiagnosticsJson: null,
    createdAt: new Date(),
  });

  db.assetPlanRecords.set("asset_plan_dashscope_live_check", {
    id: "asset_plan_dashscope_live_check",
    projectId: project.id,
    topicPackageId: "topic_dashscope_live_check",
    scriptRecordId: "script_dashscope_live_check",
    storyboardRecordId: "storyboard_dashscope_live_check",
    planJson: {
      plan_version: "asset_plan_v1",
      source_storyboard_record_id: "storyboard_dashscope_live_check",
      source_script_record_id: "script_dashscope_live_check",
      source_topic_package_id: "topic_dashscope_live_check",
      art_bible: {
        era_style: "ancient Chinese court",
        visual_tone: "cinematic historical tension",
        characters: [],
        locations: [],
        props: [],
        global_prompt_prefix:
          "ancient Chinese historical short video, cinematic vertical frame",
        global_negative_prompts: ["modern building", "text watermark"],
        consistency_notes: [],
      },
      visual_budget: {},
      downgrade_policy: {},
      global_audio_strategy: {},
      tts_plan: {
        voice_profile_id: "Ethan",
        estimated_total_duration_sec: 5,
        chunking_strategy: "segment_boundary",
        chunks: [
          {
            chunk_id: "tts_001",
            order: 0,
            script_excerpt: "宫门忽然合上，殿里只剩下一句没有退路的回答。",
            estimated_duration_sec: 5,
          },
        ],
      },
      tasks: [
        {
          task_id: "tts_001",
          order: 0,
          task_type: "tts_audio",
          source_segment_id: null,
          source_excerpt: "宫门忽然合上，殿里只剩下一句没有退路的回答。",
          production_intent: "Generate narration audio.",
          recommended_mode: "auto",
          provider_hint: "dashscope_tts",
          prompt_draft: null,
          parameters: {},
          manual_upload_policy: {
            allowed: false,
            required: false,
            accepted_file_types: [],
            acceptance_notes: [],
          },
          risk_notes: [],
          cost_tier: "low",
          initial_status: "planned",
        },
        {
          task_id: "sub_001",
          order: 1,
          task_type: "subtitle_track",
          source_segment_id: null,
          source_excerpt: "subtitle",
          production_intent: "Generate subtitles from TTS.",
          recommended_mode: "auto",
          provider_hint: "local_subtitle",
          prompt_draft: null,
          parameters: {},
          manual_upload_policy: {
            allowed: false,
            required: false,
            accepted_file_types: [],
            acceptance_notes: [],
          },
          risk_notes: [],
          cost_tier: "low",
          initial_status: "planned",
        },
        {
          task_id: "img_001",
          order: 2,
          task_type: "image_still",
          source_segment_id: "sb_001",
          source_excerpt: "ancient palace gate at night",
          production_intent: "Create anchor image.",
          recommended_mode: "auto",
          provider_hint: "dashscope_image",
          prompt_draft:
            "ancient Chinese palace gate at night, tense court atmosphere, cinematic vertical frame, detailed historical costume, no text",
          parameters: {
            size: "720*1280",
          },
          manual_upload_policy: {
            allowed: false,
            required: false,
            accepted_file_types: [],
            acceptance_notes: [],
          },
          risk_notes: [],
          cost_tier: "low",
          initial_status: "planned",
        },
      ],
      dependencies: [],
      cost_summary: {
        total_tasks: 3,
        by_type: {
          tts_audio: 1,
          subtitle_track: 1,
          image_still: 1,
        },
        by_cost_tier: {
          low: 3,
        },
        estimated_provider_calls: 2,
        notes: [],
      },
      global_production_notes: [],
    },
    validationResultJson: {
      stage: "asset_planning_local_validation",
      decision: "pass",
      errors: [],
      warnings: [],
      metrics: {},
    },
    executionStateJson: {},
    graphTraceSummaryJson: null,
    runtimeDiagnosticsJson: null,
    createdAt: new Date(),
  });

  const response = await runAssetsGeneration({
    db,
    project,
    voiceProfileId: "Ethan",
    executionMode: "auto_available",
    providerMode: "dashscope",
    dashscope: {
      apiKey: input.env.ALIYUN_DASHSCOPE_API_KEY,
      baseUrl: input.env.ALIYUN_DASHSCOPE_BASE_URL,
      imageModel: input.env.ALIYUN_DASHSCOPE_TEXT_TO_IMAGE_MODEL,
      ttsModel: input.env.ALIYUN_DASHSCOPE_TTS_MODEL,
      imagePollIntervalMs: 3000,
      imageMaxPollAttempts: 40,
    },
  });
  const body = response.body as {
    asset_manifest_record_id?: string;
    manifest?: {
      artifacts?: Array<{
        artifact_type?: string;
        metadata?: Record<string, unknown>;
      }>;
    };
    local_validation?: {
      decision?: string;
      errors?: unknown[];
      warnings?: unknown[];
    };
    graph_trace_summary?: {
      phase?: string;
    };
  };
  const artifacts = body.manifest?.artifacts ?? [];

  return {
    statusCode: response.statusCode,
    localValidationDecision: body.local_validation?.decision ?? null,
    localValidationErrors: stringifyList(body.local_validation?.errors),
    localValidationWarnings: stringifyList(body.local_validation?.warnings),
    providerNames: uniqueStrings(
      artifacts.map((artifact) => artifact.metadata?.provider_name),
    ),
    artifactTypes: uniqueStrings(artifacts.map((artifact) => artifact.artifact_type)),
    outputDir: projectStorageRootDir,
    manifestRecordId: body.asset_manifest_record_id ?? null,
    assetRunTracePhase: body.graph_trace_summary?.phase ?? null,
  };
}

function resolveDashscopeEnv(
  injectedEnv: AssetsDashscopeLiveCheckEnv | undefined,
): AssetsDashscopeLiveCheckEnv {
  return {
    ...readDotEnv(resolve(process.cwd(), ".env")),
    ...readDotEnv(resolve(process.cwd(), "backend/.env")),
    ...process.env,
    ...injectedEnv,
  };
}

function withEnvDefaults(
  env: AssetsDashscopeLiveCheckEnv,
): Required<Pick<
  AssetsDashscopeLiveCheckEnv,
  | "ALIYUN_DASHSCOPE_API_KEY"
  | "ALIYUN_DASHSCOPE_BASE_URL"
  | "ALIYUN_DASHSCOPE_TEXT_TO_IMAGE_MODEL"
  | "ALIYUN_DASHSCOPE_TTS_MODEL"
>> {
  return {
    ALIYUN_DASHSCOPE_API_KEY: env.ALIYUN_DASHSCOPE_API_KEY ?? "",
    ALIYUN_DASHSCOPE_BASE_URL:
      env.ALIYUN_DASHSCOPE_BASE_URL ?? "https://dashscope.aliyuncs.com",
    ALIYUN_DASHSCOPE_TEXT_TO_IMAGE_MODEL:
      env.ALIYUN_DASHSCOPE_TEXT_TO_IMAGE_MODEL ??
      env.ALIYUN_DASHSCOPE_MODEL ??
      "wan2.6-t2i",
    ALIYUN_DASHSCOPE_TTS_MODEL:
      env.ALIYUN_DASHSCOPE_TTS_MODEL ??
      env.TTS_MODEL ??
      "qwen3-tts-instruct-flash",
  };
}

function assertRequiredEnv(env: AssetsDashscopeLiveCheckEnv): void {
  const missing = ["ALIYUN_DASHSCOPE_API_KEY"].filter((key) => {
    const value = env[key as keyof AssetsDashscopeLiveCheckEnv];
    return typeof value !== "string" || value.trim().length === 0;
  });

  if (missing.length > 0) {
    throw new Error(`assets_dashscope_live_env_missing:${missing.join(",")}`);
  }
}

function readDotEnv(filePath: string): Record<string, string> {
  if (!existsSync(filePath)) {
    return {};
  }

  const result: Record<string, string> = {};
  for (const rawLine of readFileSync(filePath, "utf8").split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u);
    if (!match) {
      continue;
    }
    const [, key, rawValue] = match;
    result[key] = rawValue.trim().replace(/^["']|["']$/gu, "");
  }
  return result;
}

function uniqueStrings(values: unknown[]): string[] {
  return Array.from(
    new Set(values.filter((value): value is string => typeof value === "string")),
  );
}

function stringifyList(values: unknown[] | undefined): string[] {
  return (values ?? []).map((value) => {
    if (typeof value === "string") {
      return value;
    }
    return JSON.stringify(value);
  });
}

function writeJson(outputDir: string, filename: string, value: unknown): void {
  writeFileSync(resolve(outputDir, filename), JSON.stringify(value, null, 2), "utf8");
}

function writeTrace(outputDir: string, result: AssetsDashscopeLiveCheckResult): void {
  writeFileSync(
    resolve(outputDir, "trace.md"),
    [
      "# assets DashScope live check trace",
      "",
      `- mode: ${result.mode}`,
      `- automated_gate: ${result.automated_gate}`,
      `- requires_real_env: ${result.requires_real_env}`,
      `- provider_mode: ${result.provider_mode}`,
      `- status_code: ${result.status_code}`,
      `- local_validation_decision: ${result.local_validation_decision ?? "unknown"}`,
      `- local_validation_errors: ${result.local_validation_errors.length}`,
      `- local_validation_warnings: ${result.local_validation_warnings.length}`,
      `- provider_names: ${result.provider_names.join(", ")}`,
      `- artifact_types: ${result.artifact_types.join(", ")}`,
      `- asset_manifest_record_id: ${result.asset_manifest_record_id ?? "unknown"}`,
      `- sample_output_dir: ${result.sample_output_dir}`,
      "",
      "## Required Checks",
      "",
      ...result.required_checks.map((item) => `- ${item}`),
      "",
    ].join("\n"),
    "utf8",
  );
}

function parseCliArgs(argv: string[]) {
  const result: BuildAssetsDashscopeLiveCheckPlanInput & { planOnly: boolean } = {
    planOnly: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];

    if (current === "--plan-only") {
      result.planOnly = true;
      continue;
    }

    if (current === "--output-dir" && next) {
      result.outputDir = next;
      index += 1;
    }
  }

  return result;
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));

  if (args.planOnly) {
    const plan = buildAssetsDashscopeLiveCheckPlan(args);
    mkdirSync(plan.output_dir, { recursive: true });
    writeJson(plan.output_dir, "live-check-plan.json", plan);
    process.stdout.write(
      `${JSON.stringify(
        {
          status: "live-check-plan-ready",
          output_dir: plan.output_dir,
          provider_mode: plan.provider_mode,
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  const result = await runAssetsDashscopeLiveCheck(args);
  process.stdout.write(
    `${JSON.stringify(
      {
        status: result.status,
        output_dir: result.output_dir,
        status_code: result.status_code,
        local_validation_decision: result.local_validation_decision,
        local_validation_errors: result.local_validation_errors,
        local_validation_warnings: result.local_validation_warnings,
        provider_names: result.provider_names,
        artifact_types: result.artifact_types,
      },
      null,
      2,
    )}\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
