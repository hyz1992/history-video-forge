import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { buildApp } from "../../../backend/src/app.js";
import { createProject } from "../../../backend/src/modules/projects/project.repository.js";
import type { AssetManifest, AssetPlan } from "../../../shared/src/index.js";

export interface ImageToVideoLiveCheckPlan {
  mode: "assets_dashscope_image_to_video_live_check";
  automated_gate: false;
  requires_real_env: true;
  provider_mode: "dashscope";
  output_dir: string;
  required_env_keys: string[];
  optional_env_keys: string[];
  required_artifacts: string[];
  tasks: AssetPlan["tasks"];
  asset_plan: AssetPlan;
}

export interface ImageToVideoLiveCheckStatus {
  status: "assets_dashscope_image_to_video_live_check_completed";
  status_code: number;
  output_dir: string;
  project_id: string | null;
  asset_manifest_record_id: string | null;
  local_validation_decision: string | null;
  local_validation_errors: string[];
  local_validation_warnings: string[];
  provider_names: string[];
  artifact_types: string[];
}

interface DashScopeImageToVideoLiveEnv {
  ALIYUN_DASHSCOPE_API_KEY?: string;
  ALIYUN_DASHSCOPE_BASE_URL?: string;
  ALIYUN_DASHSCOPE_TEXT_TO_IMAGE_MODEL?: string;
  ALIYUN_DASHSCOPE_TTS_MODEL?: string;
  ALIYUN_DASHSCOPE_IMAGE_TO_VIDEO_MODEL?: string;
  ALIYUN_DASHSCOPE_IMAGE_TO_VIDEO_RESOLUTION?: string;
  ALIYUN_DASHSCOPE_IMAGE_TO_VIDEO_DURATION_SEC?: string;
  ALIYUN_DASHSCOPE_IMAGE_TO_VIDEO_POLL_INTERVAL_MS?: string;
  ALIYUN_DASHSCOPE_IMAGE_TO_VIDEO_MAX_POLL_ATTEMPTS?: string;
}

const DEFAULT_OUTPUT_DIR = resolve(
  process.cwd(),
  "harness/scripts/runtime/output/assets-dashscope-image-to-video-live-check",
);

export function buildImageToVideoLiveCheckPlan(input: {
  outputDir?: string;
} = {}): ImageToVideoLiveCheckPlan {
  const assetPlan = buildLiveCheckAssetPlan();
  return {
    mode: "assets_dashscope_image_to_video_live_check",
    automated_gate: false,
    requires_real_env: true,
    provider_mode: "dashscope",
    output_dir: input.outputDir ?? DEFAULT_OUTPUT_DIR,
    required_env_keys: [
      "ALIYUN_DASHSCOPE_API_KEY",
      "ALIYUN_DASHSCOPE_IMAGE_TO_VIDEO_MODEL",
    ],
    optional_env_keys: [
      "ALIYUN_DASHSCOPE_BASE_URL",
      "ALIYUN_DASHSCOPE_TEXT_TO_IMAGE_MODEL",
      "ALIYUN_DASHSCOPE_TTS_MODEL",
      "ALIYUN_DASHSCOPE_IMAGE_TO_VIDEO_RESOLUTION",
      "ALIYUN_DASHSCOPE_IMAGE_TO_VIDEO_DURATION_SEC",
      "ALIYUN_DASHSCOPE_IMAGE_TO_VIDEO_POLL_INTERVAL_MS",
      "ALIYUN_DASHSCOPE_IMAGE_TO_VIDEO_MAX_POLL_ATTEMPTS",
    ],
    required_artifacts: [
      "assets-response.json",
      "assets-snapshot.json",
      "status.json",
      "trace.md",
    ],
    tasks: assetPlan.tasks,
    asset_plan: assetPlan,
  };
}

export async function runImageToVideoLiveCheck(input: {
  outputDir?: string;
  env?: DashScopeImageToVideoLiveEnv;
} = {}): Promise<ImageToVideoLiveCheckStatus> {
  const plan = buildImageToVideoLiveCheckPlan(input);
  mkdirSync(plan.output_dir, { recursive: true });

  const env = resolveEnv(input.env);
  assertRequiredEnv(env);

  const app = buildApp();
  const project = await createProject(app.db, {
    name: "assets dashscope image-to-video live check",
  });
  const projectStorageRootDir = resolve(plan.output_dir, "project-storage");
  mkdirSync(projectStorageRootDir, { recursive: true });

  const topicPackageId = "topic_dashscope_i2v_live_check";
  const scriptRecordId = "script_dashscope_i2v_live_check";
  const storyboardRecordId = "storyboard_dashscope_i2v_live_check";
  const assetPlanRecordId = "asset_plan_dashscope_i2v_live_check";

  project.storageRootDir = projectStorageRootDir;
  project.activeAssetPlanRecordId = assetPlanRecordId;
  project.status = "asset_plan_ready";

  app.db.storyboardRecords.set(storyboardRecordId, {
    id: storyboardRecordId,
    projectId: project.id,
    topicPackageId,
    scriptRecordId,
    planJson: {
      segments: [{ segment_id: "sb_001" }],
    },
    validationResultJson: {},
    executionStateJson: null,
    graphTraceSummaryJson: null,
    runtimeDiagnosticsJson: null,
    createdAt: new Date(),
  });

  app.db.assetPlanRecords.set(assetPlanRecordId, {
    id: assetPlanRecordId,
    projectId: project.id,
    topicPackageId,
    scriptRecordId,
    storyboardRecordId,
    planJson: plan.asset_plan,
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

  const response = await app.inject({
    method: "POST",
    url: `/api/projects/${project.id}/assets/generate`,
    payload: {
      voice_profile_id: "Ethan",
      execution_mode: "auto_available",
      provider_mode: "dashscope",
      dashscope: {
        api_key: env.ALIYUN_DASHSCOPE_API_KEY,
        base_url: env.ALIYUN_DASHSCOPE_BASE_URL,
        tts_model: env.ALIYUN_DASHSCOPE_TTS_MODEL,
        image_model: env.ALIYUN_DASHSCOPE_TEXT_TO_IMAGE_MODEL,
        image_to_video_model: env.ALIYUN_DASHSCOPE_IMAGE_TO_VIDEO_MODEL,
        image_to_video_resolution:
          env.ALIYUN_DASHSCOPE_IMAGE_TO_VIDEO_RESOLUTION,
        image_to_video_duration_sec: readOptionalNumber(
          env.ALIYUN_DASHSCOPE_IMAGE_TO_VIDEO_DURATION_SEC,
        ),
        image_to_video_poll_interval_ms: readOptionalNumber(
          env.ALIYUN_DASHSCOPE_IMAGE_TO_VIDEO_POLL_INTERVAL_MS,
        ),
        image_to_video_max_poll_attempts: readOptionalNumber(
          env.ALIYUN_DASHSCOPE_IMAGE_TO_VIDEO_MAX_POLL_ATTEMPTS,
        ),
      },
    },
  });
  const body = response.json() as {
    asset_manifest_record_id?: string;
    manifest?: AssetManifest;
    local_validation?: {
      decision?: string;
      errors?: unknown[];
      warnings?: unknown[];
    };
  };
  const artifacts = body.manifest?.artifacts ?? [];
  const status: ImageToVideoLiveCheckStatus = {
    status: "assets_dashscope_image_to_video_live_check_completed",
    status_code: response.statusCode,
    output_dir: plan.output_dir,
    project_id: project.id,
    asset_manifest_record_id: body.asset_manifest_record_id ?? null,
    local_validation_decision: body.local_validation?.decision ?? null,
    local_validation_errors: stringifyList(body.local_validation?.errors),
    local_validation_warnings: stringifyList(body.local_validation?.warnings),
    provider_names: uniqueStrings(
      artifacts.map((artifact) => artifact.metadata.provider_name),
    ),
    artifact_types: uniqueStrings(
      artifacts.map((artifact) => artifact.artifact_type),
    ),
  };

  writeJson(plan.output_dir, "assets-response.json", body);
  writeJson(plan.output_dir, "assets-snapshot.json", {
    project_id: project.id,
    project_status: project.status,
    active_asset_manifest_record_id: project.activeAssetManifestRecordId,
    manifest_readiness: body.manifest?.readiness ?? null,
    segment_routes: body.manifest?.segment_routes ?? [],
    artifact_types: status.artifact_types,
    provider_names: status.provider_names,
  });
  writeJson(plan.output_dir, "status.json", status);
  writeTrace(plan.output_dir, plan, status);

  return status;
}

function buildLiveCheckAssetPlan(): AssetPlan {
  return {
    plan_version: "asset_plan_v1",
    source_storyboard_record_id: "storyboard_dashscope_i2v_live_check",
    source_script_record_id: "script_dashscope_i2v_live_check",
    source_topic_package_id: "topic_dashscope_i2v_live_check",
    art_bible: {
      era_style: "ancient Chinese court",
      visual_tone: "tense cinematic night scene",
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
          script_excerpt:
            "The palace gate closes, and one answer must hold the room.",
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
        source_excerpt:
          "The palace gate closes, and one answer must hold the room.",
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
        production_intent: "Create the segment anchor image.",
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
      {
        task_id: "motion_001",
        order: 3,
        task_type: "render_motion_cue",
        source_segment_id: "sb_001",
        source_excerpt: "slow push in on still image",
        production_intent: "Create fallback motion over the still image.",
        recommended_mode: "auto",
        provider_hint: "local_motion",
        prompt_draft: null,
        parameters: {
          recipe_type: "slow_push_in",
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
      {
        task_id: "video_001",
        order: 4,
        task_type: "video_clip",
        source_segment_id: "sb_001",
        source_excerpt: "image-to-video clip from palace gate first frame",
        production_intent: "Generate a first-frame image-to-video clip.",
        recommended_mode: "auto",
        provider_hint: "dashscope_image_to_video",
        prompt_draft:
          "A tense historical close-up with a slow push-in, subtle torchlight, no text.",
        parameters: {},
        manual_upload_policy: {
          allowed: false,
          required: false,
          accepted_file_types: [],
          acceptance_notes: [],
        },
        risk_notes: [],
        cost_tier: "high",
        initial_status: "planned",
      },
    ],
    dependencies: [],
    cost_summary: {
      total_tasks: 5,
      by_type: {
        tts_audio: 1,
        subtitle_track: 1,
        image_still: 1,
        render_motion_cue: 1,
        video_clip: 1,
      },
      by_cost_tier: {
        low: 4,
        high: 1,
      },
      estimated_provider_calls: 3,
      notes: [],
    },
    global_production_notes: [],
  };
}

function resolveEnv(injectedEnv: DashScopeImageToVideoLiveEnv | undefined) {
  return {
    ...readDotEnv(resolve(process.cwd(), ".env")),
    ...readDotEnv(resolve(process.cwd(), "backend/.env")),
    ...process.env,
    ...injectedEnv,
  };
}

function assertRequiredEnv(env: DashScopeImageToVideoLiveEnv): void {
  const missing = [
    "ALIYUN_DASHSCOPE_API_KEY",
    "ALIYUN_DASHSCOPE_IMAGE_TO_VIDEO_MODEL",
  ].filter((key) => {
    const value = env[key as keyof DashScopeImageToVideoLiveEnv];
    return typeof value !== "string" || value.trim().length === 0;
  });

  if (missing.length > 0) {
    throw new Error(
      `assets_dashscope_image_to_video_live_env_missing:${missing.join(",")}`,
    );
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

function readOptionalNumber(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
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

function writeTrace(
  outputDir: string,
  plan: ImageToVideoLiveCheckPlan,
  status: ImageToVideoLiveCheckStatus,
): void {
  writeFileSync(
    resolve(outputDir, "trace.md"),
    [
      "# assets DashScope image-to-video live check",
      "",
      `- mode: ${plan.mode}`,
      `- automated_gate: ${plan.automated_gate}`,
      `- provider_mode: ${plan.provider_mode}`,
      `- status_code: ${status.status_code}`,
      `- local_validation_decision: ${status.local_validation_decision ?? "unknown"}`,
      `- local_validation_errors: ${status.local_validation_errors.length}`,
      `- local_validation_warnings: ${status.local_validation_warnings.length}`,
      `- provider_names: ${status.provider_names.join(", ")}`,
      `- artifact_types: ${status.artifact_types.join(", ")}`,
      `- asset_manifest_record_id: ${status.asset_manifest_record_id ?? "unknown"}`,
      `- output_dir: ${status.output_dir}`,
      "",
    ].join("\n"),
    "utf8",
  );
}

function parseCliArgs(argv: string[]) {
  const result: { outputDir?: string } = {};

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];
    if (current === "--output-dir" && next) {
      result.outputDir = next;
      index += 1;
    }
  }

  return result;
}

async function main() {
  const result = await runImageToVideoLiveCheck(parseCliArgs(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
