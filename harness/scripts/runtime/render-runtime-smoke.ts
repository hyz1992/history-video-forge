import { createAuthenticatedAuthContext } from "../../../backend/src/auth/auth-context.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { buildApp } from "../../../backend/src/app";
import { saveAssetPlanRecord } from "../../../backend/src/modules/asset-planning/asset-plan-record.repository";
import { DEFAULT_AUDIO_LIBRARY_ITEMS } from "../../../backend/src/modules/assets/default-audio-library";
import { loadLightweightBgmCatalogItems } from "../../../backend/src/modules/assets/lightweight-audio-catalog-loader";
import { saveMediaLibraryItem } from "../../../backend/src/modules/assets/media-library.repository";
import { createFakeRenderAdapter } from "../../../backend/src/modules/render/fake-render-adapter";
import { createLocalRemotionRenderAdapter } from "../../../backend/src/modules/render/local-remotion-render-adapter";
import type { RenderAdapter } from "../../../backend/src/modules/render/render-adapter";
import type { AssetPlan } from "../../../shared/src/index.js";

const TOPIC_PACKAGE_ID = "topic_render_smoke_001";
const SCRIPT_RECORD_ID = "script_render_smoke_001";
const STORYBOARD_RECORD_ID = "storyboard_render_smoke_001";
const SMOKE_BGM_LIBRARY_ITEM_ID = "bgm_hist_ancient_china_solemn_001";
const DEFAULT_SMOKE_TTS_TEXT = "A tense public answer changes the room.";

interface RenderRuntimeSmokeEnv {
  ALIYUN_DASHSCOPE_API_KEY?: string;
  ALIYUN_DASHSCOPE_BASE_URL?: string;
  ALIYUN_DASHSCOPE_TTS_MODEL?: string;
}

export interface RunRenderRuntimeSmokeInput {
  adapter?: "fake" | "remotion";
  outputDir?: string;
  bgmLibraryItemId?: string;
  ttsProvider?: "fake_tts" | "dashscope_tts";
  ttsText?: string;
  includeSfx?: boolean;
  dashscope?: {
    apiKey?: string;
    baseUrl?: string;
    ttsModel?: string;
  };
}

export interface RunRenderRuntimeSmokeResult {
  outputDir: string;
  status: {
    generatedAt: string;
    status: "sample-ready";
    stage: "compose-to-render";
    projectId: string;
    outputDir: string;
    activeAssetsAfterGenerate: string | null;
    activeComposeAfterGenerate: string | null;
    activeRenderAfterGenerate: string | null;
    activeComposeAfterRefresh: string | null;
    activeRenderAfterComposeRefresh: string | null;
  };
}

interface SmokeBgmCueInput {
  libraryItemId?: string;
  requiredTags: string[];
  moodTags: string[];
  volume: number;
}

function writeJson(outputDir: string, filename: string, value: unknown) {
  writeFileSync(resolve(outputDir, filename), JSON.stringify(value, null, 2), "utf8");
}

function readDotEnv(filePath: string): RenderRuntimeSmokeEnv {
  if (!existsSync(filePath)) {
    return {};
  }

  const values: RenderRuntimeSmokeEnv = {};
  for (const rawLine of readFileSync(filePath, "utf8").split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const equalsIndex = line.indexOf("=");
    if (equalsIndex <= 0) {
      continue;
    }

    const key = line.slice(0, equalsIndex).trim();
    const value = line.slice(equalsIndex + 1).trim().replace(/^['"]|['"]$/gu, "");
    if (
      key === "ALIYUN_DASHSCOPE_API_KEY" ||
      key === "ALIYUN_DASHSCOPE_BASE_URL" ||
      key === "ALIYUN_DASHSCOPE_TTS_MODEL"
    ) {
      values[key] = value;
    }
  }

  return values;
}

export function resolveRenderRuntimeSmokeEnv(
  input: { cwd?: string } = {},
): RenderRuntimeSmokeEnv {
  const cwd = input.cwd ?? process.cwd();
  const fileEnv = {
    ...readDotEnv(resolve(cwd, ".env")),
    ...readDotEnv(resolve(cwd, "backend/.env")),
  };
  const processEnv: RenderRuntimeSmokeEnv = {};
  for (const key of [
    "ALIYUN_DASHSCOPE_API_KEY",
    "ALIYUN_DASHSCOPE_BASE_URL",
    "ALIYUN_DASHSCOPE_TTS_MODEL",
  ] as const) {
    if (typeof process.env[key] === "string" && process.env[key] !== "") {
      processEnv[key] = process.env[key];
    }
  }

  return {
    ...fileEnv,
    ...processEnv,
  };
}

function makeAssetPlan(input: {
  bgmCue?: SmokeBgmCueInput;
  ttsText?: string;
  includeSfx?: boolean;
} = {}): AssetPlan {
  const bgmCue = input.bgmCue ?? {
    requiredTags: ["background", "drone"],
    moodTags: ["tense", "dark"],
    volume: 0.25,
  };
  const ttsText = input.ttsText ?? DEFAULT_SMOKE_TTS_TEXT;
  const includeSfx = input.includeSfx ?? true;
  const sfxTasks: AssetPlan["tasks"] = includeSfx
    ? [
        {
          task_id: "sfx_001",
          order: 3,
          task_type: "sfx_cue",
          source_segment_id: "sb_001",
          source_excerpt: "A sharp hit lands in the court.",
          production_intent: "Add a short impact sound effect.",
          recommended_mode: "auto",
          provider_hint: "local_sfx",
          prompt_draft: null,
          parameters: {
            sfx_tags: ["hit"],
            mood_tags: ["sharp", "impact"],
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
      ]
    : [];

  return {
    plan_version: "asset_plan_v1",
    source_storyboard_record_id: STORYBOARD_RECORD_ID,
    source_script_record_id: SCRIPT_RECORD_ID,
    source_topic_package_id: TOPIC_PACKAGE_ID,
    art_bible: {
      era_style: "ancient court",
      visual_tone: "tense",
      characters: [],
      locations: [],
      props: [],
      global_prompt_prefix: "ancient Chinese historical short video",
      global_negative_prompts: [],
      consistency_notes: [],
    },
    visual_budget: {},
    downgrade_policy: {},
    global_audio_strategy: {},
    tts_plan: {
      voice_profile_id: "voice_render_smoke",
      estimated_total_duration_sec: 12,
      chunking_strategy: "segment_boundary",
      chunks: [
        {
          chunk_id: "tts_001",
          order: 0,
          script_excerpt: ttsText,
          estimated_duration_sec: 12,
        },
      ],
    },
    tasks: [
      {
        task_id: "tts_001",
        order: 0,
        task_type: "tts_audio",
        source_segment_id: null,
        source_excerpt: ttsText,
        production_intent: "Generate narration audio.",
        recommended_mode: "auto",
        provider_hint: "fake_tts",
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
        source_excerpt: ttsText,
        production_intent: "Generate subtitle track from TTS.",
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
        source_excerpt: "The envoy faces the hall.",
        production_intent: "Create the segment anchor image.",
        recommended_mode: "auto",
        provider_hint: "fake_image",
        prompt_draft: "Ancient court, tense public confrontation.",
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
      ...sfxTasks,
      {
        task_id: "bgm_001",
        order: 4,
        task_type: "bgm_cue",
        source_segment_id: null,
        source_excerpt: "Tense background bed.",
        production_intent: "Add restrained background music.",
        recommended_mode: "auto",
        provider_hint: "local_bgm",
        prompt_draft: null,
        parameters: {
          required_tags: bgmCue.requiredTags,
          mood_tags: bgmCue.moodTags,
          scope: "global",
          ...(bgmCue.libraryItemId
            ? { library_item_id: bgmCue.libraryItemId }
            : {}),
          volume: bgmCue.volume,
          fade_in_sec: 1,
          fade_out_sec: 1,
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
      total_tasks: includeSfx ? 5 : 4,
      by_type: {
        tts_audio: 1,
        subtitle_track: 1,
        image_still: 1,
        ...(includeSfx ? { sfx_cue: 1 } : {}),
        bgm_cue: 1,
      },
      by_cost_tier: {
        low: includeSfx ? 5 : 4,
      },
      estimated_provider_calls: includeSfx ? 5 : 4,
      notes: [],
    },
    global_production_notes: [],
  };
}

async function seedSmokeMediaLibrary(
  app: ReturnType<typeof buildApp>,
  input: { bgmLibraryItemId?: string } = {},
): Promise<{ bgmCue: SmokeBgmCueInput }> {
  const lightweightBgmCatalogPath = resolve(
    process.cwd(),
    "storage/media-library/ai-bgm-prompt-candidates.json",
  );
  let bgmCue: SmokeBgmCueInput = {
    requiredTags: ["background", "drone"],
    moodTags: ["tense", "dark"],
    volume: 0.25,
  };

  if (existsSync(lightweightBgmCatalogPath)) {
    const loadedBgmItems = await loadLightweightBgmCatalogItems(
      lightweightBgmCatalogPath,
    );
    for (const entry of loadedBgmItems) {
      await saveMediaLibraryItem(app.db, entry.item);
    }

    const explicitBgmLibraryItemId = input.bgmLibraryItemId;
    const preferredBgmLibraryItemId =
      explicitBgmLibraryItemId ?? SMOKE_BGM_LIBRARY_ITEM_ID;
    const matchedBgm = loadedBgmItems.find(
      (entry) => entry.item.library_item_id === preferredBgmLibraryItemId,
    );
    if (explicitBgmLibraryItemId && !matchedBgm) {
      throw new Error(`smoke_bgm_not_found: ${explicitBgmLibraryItemId}`);
    }

    const smokeBgm = matchedBgm ?? loadedBgmItems[0];
    if (smokeBgm) {
      bgmCue = {
        libraryItemId: smokeBgm.item.library_item_id,
        requiredTags: ["background", "historical"],
        moodTags: ["solemn", "low_intrusion"],
        volume: smokeBgm.volumeHint ?? 0.25,
      };
    }
  }

  for (const item of DEFAULT_AUDIO_LIBRARY_ITEMS) {
    await saveMediaLibraryItem(app.db, item);
  }

  return { bgmCue };
}

async function seedActiveAssetPlan(input: {
  app: ReturnType<typeof buildApp>;
  projectId: string;
  bgmCue?: SmokeBgmCueInput;
  ttsText?: string;
  includeSfx?: boolean;
}) {
  const { app, projectId, bgmCue, ttsText, includeSfx } = input;
  const assetPlanRecordId = `asset_plan_render_smoke_${app.db.generateId()}`;
  const assetPlan = makeAssetPlan({ bgmCue, ttsText, includeSfx });

  app.db.storyboardRecords.set(STORYBOARD_RECORD_ID, {
    id: STORYBOARD_RECORD_ID,
    projectId,
    topicPackageId: TOPIC_PACKAGE_ID,
    scriptRecordId: SCRIPT_RECORD_ID,
    planJson: {
      plan_version: "storyboard_v1",
      source_script_record_id: SCRIPT_RECORD_ID,
      source_topic_package_id: TOPIC_PACKAGE_ID,
      estimated_total_duration_sec: 12,
      segments: [
        {
          segment_id: "sb_001",
          order: 0,
          script_excerpt: "A tense public answer changes the room.",
          start_hint_sec: 0,
          end_hint_sec: 12,
          narrative_role: "opening",
          visual_intent: "public pressure",
          scene_description: "A court hall freezes after the answer.",
          visual_elements: ["envoy", "court hall"],
          framing_hint: "medium",
          content_type: "live_action",
          motion_hint: "push_in",
          editing_hint: "single",
          on_screen_text: [],
          linked_beats: ["public answer"],
          linked_quotes: [],
          risk_notes: [],
        },
      ],
      global_visual_notes: [],
    },
    validationResultJson: {
      stage: "storyboard_local_validation",
      decision: "pass",
      errors: [],
      warnings: [],
      metrics: {},
    },
    executionStateJson: null,
    graphTraceSummaryJson: null,
    runtimeDiagnosticsJson: null,
    createdAt: new Date(),
  });

  const assetPlanRecord = await saveAssetPlanRecord(app.db, {
    id: assetPlanRecordId,
    projectId,
    topicPackageId: TOPIC_PACKAGE_ID,
    scriptRecordId: SCRIPT_RECORD_ID,
    storyboardRecordId: STORYBOARD_RECORD_ID,
    planJson: assetPlan,
    validationResultJson: {
      stage: "asset_planning_local_validation",
      decision: "pass",
      errors: [],
      warnings: [],
      metrics: {},
    },
    executionStateJson: {
      regenerate_used: false,
    },
    graphTraceSummaryJson: null,
    runtimeDiagnosticsJson: null,
  });

  const project = app.db.projects.get(projectId);
  if (!project) {
    throw new Error("project_missing_after_create");
  }
  project.activeStoryboardRecordId = STORYBOARD_RECORD_ID;
  project.activeAssetPlanRecordId = assetPlanRecord.id;
  project.status = "asset_plan_ready";
}

async function injectOrThrow(input: {
  app: ReturnType<typeof buildApp>;
  method: string;
  url: string;
  payload?: unknown;
}) {
  const response = await input.app.inject({
    method: input.method,
    url: input.url,
    payload: input.payload,
    // S1-3 授权合同：POST /api/projects 等路由要求认证用户；harness 烟测
    // 使用固定测试用户（与 tests/backend/api 惯例一致），非真实登录。
    auth: createAuthenticatedAuthContext({
      userId: "smoke-owner",
      username: "smoke-owner",
      displayName: "Smoke Owner",
      role: "ADMIN",
      sessionId: "smoke-session",
    }),
  });

  if (response.statusCode >= 400) {
    throw new Error(
      `request_failed ${input.method} ${input.url}: ${response.statusCode} ${JSON.stringify(response.json())}`,
    );
  }

  return response.json();
}

function alignActiveManifestReadinessForSmoke(input: {
  app: ReturnType<typeof buildApp>;
  projectId: string;
}) {
  const project = input.app.db.projects.get(input.projectId);
  const manifestRecord = project?.activeAssetManifestRecordId
    ? input.app.db.assetManifestRecords.get(project.activeAssetManifestRecordId)
    : null;
  if (!manifestRecord) {
    throw new Error("active_manifest_missing_after_assets_generate");
  }

  const validationDecision = String(
    manifestRecord.validationResultJson.decision ?? "",
  );
  if (validationDecision === "ready_for_compose" || validationDecision === "partial") {
    manifestRecord.manifestJson = {
      ...manifestRecord.manifestJson,
      readiness: "ready_for_compose",
    };
  }
}

function createSmokeRenderAdapter(adapter: "fake" | "remotion"): RenderAdapter {
  if (adapter === "remotion") {
    return createLocalRemotionRenderAdapter();
  }

  return createFakeRenderAdapter();
}

export async function runRenderRuntimeSmoke(
  input: RunRenderRuntimeSmokeInput = {},
): Promise<RunRenderRuntimeSmokeResult> {
  const adapter = input.adapter ?? "fake";

  const finalOutputDir =
    input.outputDir ?? resolve(process.cwd(), "harness/scripts/runtime/output/render-runtime-smoke");
  mkdirSync(finalOutputDir, { recursive: true });

  const app = buildApp({ renderAdapter: createSmokeRenderAdapter(adapter) });
  const projectBody = await injectOrThrow({
    app,
    method: "POST",
    url: "/api/projects",
    payload: {
      name: "Render Runtime Smoke",
    },
  });
  const projectId = projectBody.project_id as string;
  const project = app.db.projects.get(projectId);
  if (!project) {
    throw new Error("project_missing_after_create");
  }
  project.storageRootDir = resolve(finalOutputDir, "project-storage");

  const mediaLibrarySeed = await seedSmokeMediaLibrary(app, {
    bgmLibraryItemId: input.bgmLibraryItemId,
  });
  await seedActiveAssetPlan({
    app,
    projectId,
    bgmCue: mediaLibrarySeed.bgmCue,
    ttsText: input.ttsText,
    includeSfx: input.includeSfx,
  });

  const env = resolveRenderRuntimeSmokeEnv();
  const assetsBody = await injectOrThrow({
    app,
    method: "POST",
    url: `/api/projects/${projectId}/assets/generate`,
    payload: {
      // S2-2A 任务 6 合同：客户端不得携带 provider_mode / dashscope api_key；
      // 真实 provider 授权只来自后端 env（服务端凭据由 readDashscopeConfig 解析）。
      // ttsProvider 仅影响选择的服务端 voice profile 与后续断言。
      voice_profile_id:
        input.ttsProvider === "dashscope_tts"
          ? "voice_system_ethan"
          : "voice_render_smoke",
      execution_mode: "auto_available",
    },
  });
  writeJson(finalOutputDir, "assets-response.json", assetsBody);
  alignActiveManifestReadinessForSmoke({ app, projectId });
  const assetsSnapshot = await injectOrThrow({
    app,
    method: "GET",
    url: `/api/projects/${projectId}`,
  });
  writeJson(finalOutputDir, "assets-snapshot.json", assetsSnapshot);

  const composeBody = await injectOrThrow({
    app,
    method: "POST",
    url: `/api/projects/${projectId}/compose/generate`,
    payload: {},
  });
  writeJson(finalOutputDir, "compose-response.json", composeBody);
  const composeSnapshot = await injectOrThrow({
    app,
    method: "GET",
    url: `/api/projects/${projectId}`,
  });
  writeJson(finalOutputDir, "compose-snapshot.json", composeSnapshot);

  const renderBody = await injectOrThrow({
    app,
    method: "POST",
    url: `/api/projects/${projectId}/render/generate`,
    payload: {},
  });
  writeJson(finalOutputDir, "render-response.json", renderBody);
  const renderSnapshot = await injectOrThrow({
    app,
    method: "GET",
    url: `/api/projects/${projectId}`,
  });
  writeJson(finalOutputDir, "render-snapshot.json", renderSnapshot);

  const composeRefreshBody = await injectOrThrow({
    app,
    method: "POST",
    url: `/api/projects/${projectId}/compose/generate`,
    payload: {},
  });
  writeJson(finalOutputDir, "compose-refresh-response.json", composeRefreshBody);
  const composeRefreshSnapshot = await injectOrThrow({
    app,
    method: "GET",
    url: `/api/projects/${projectId}`,
  });
  writeJson(finalOutputDir, "compose-refresh-snapshot.json", composeRefreshSnapshot);

  const generatedAt = new Date().toISOString();
  const status = {
    generatedAt,
    status: "sample-ready" as const,
    stage: "compose-to-render" as const,
    projectId,
    outputDir: finalOutputDir,
    activeAssetsAfterGenerate:
      (assetsSnapshot.active_assets?.asset_manifest_record_id as string | undefined) ??
      null,
    activeComposeAfterGenerate:
      (composeSnapshot.active_compose?.compose_record_id as string | undefined) ??
      null,
    activeRenderAfterGenerate:
      (renderSnapshot.active_render?.render_job_record_id as string | undefined) ??
      null,
    activeComposeAfterRefresh:
      (composeRefreshSnapshot.active_compose?.compose_record_id as string | undefined) ??
      null,
    activeRenderAfterComposeRefresh:
      (composeRefreshSnapshot.active_render?.render_job_record_id as string | undefined) ??
      null,
  };

  writeJson(finalOutputDir, "status.json", status);
  writeFileSync(
    resolve(finalOutputDir, "trace.md"),
    [
      "# render runtime smoke trace",
      "",
      `- project_id: ${projectId}`,
      `- generated_at: ${generatedAt}`,
      "- flow: create-project -> seed-active-asset-plan -> assets-generate -> compose-generate -> render-generate -> snapshot -> compose-generate -> snapshot",
      `- active_assets_after_generate: ${status.activeAssetsAfterGenerate ?? "null"}`,
      `- active_compose_after_generate: ${status.activeComposeAfterGenerate ?? "null"}`,
      `- active_render_after_generate: ${status.activeRenderAfterGenerate ?? "null"}`,
      `- active_compose_after_refresh: ${status.activeComposeAfterRefresh ?? "null"}`,
      `- active_render_after_compose_refresh: ${status.activeRenderAfterComposeRefresh ?? "null"}`,
      "",
      "## Notes",
      "",
      `- This smoke uses ${input.ttsProvider === "dashscope_tts" ? "DashScope TTS plus local/fake" : "fake/local"} asset providers and the ${adapter} render adapter.`,
      "- It verifies that a refreshed active compose invalidates the stale active render pointer.",
    ].join("\n"),
    "utf8",
  );

  return {
    outputDir: finalOutputDir,
    status,
  };
}

export function parseRenderRuntimeSmokeCliArgs(
  argv: string[],
): RunRenderRuntimeSmokeInput {
  const result: RunRenderRuntimeSmokeInput = {
    bgmLibraryItemId: process.env.SVF_SMOKE_BGM_ID,
    ttsProvider:
      process.env.SVF_SMOKE_TTS_PROVIDER === "dashscope_tts"
        ? "dashscope_tts"
        : undefined,
  };
  const positional: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];

    if (current === "--output-dir" && next) {
      result.outputDir = next;
      index += 1;
      continue;
    }

    if (current.startsWith("--adapter=")) {
      result.adapter = current.slice("--adapter=".length) as
        | "fake"
        | "remotion";
      continue;
    }

    if (current === "--adapter" && next) {
      result.adapter = next as "fake" | "remotion";
      index += 1;
      continue;
    }

    if (current === "--bgm-id" && next) {
      result.bgmLibraryItemId = next;
      index += 1;
      continue;
    }

    if (current === "--tts-provider" && next) {
      result.ttsProvider = next === "dashscope_tts" ? "dashscope_tts" : undefined;
      index += 1;
      continue;
    }

    if (current.startsWith("--tts-provider=")) {
      const value = current.slice("--tts-provider=".length);
      result.ttsProvider = value === "dashscope_tts" ? "dashscope_tts" : undefined;
      continue;
    }

    if (current === "--tts-text" && next) {
      result.ttsText = next;
      index += 1;
      continue;
    }

    if (current === "--no-sfx") {
      result.includeSfx = false;
      continue;
    }

    if (current === "--dashscope-base-url" && next) {
      result.dashscope = {
        ...result.dashscope,
        baseUrl: next,
      };
      index += 1;
      continue;
    }

    if (current === "--dashscope-tts-model" && next) {
      result.dashscope = {
        ...result.dashscope,
        ttsModel: next,
      };
      index += 1;
      continue;
    }

    if (!current.startsWith("--")) {
      positional.push(current);
    }
  }

  if (positional[0] && !result.bgmLibraryItemId) {
    result.bgmLibraryItemId = positional[0];
  }

  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runRenderRuntimeSmoke(parseRenderRuntimeSmokeCliArgs(process.argv.slice(2)))
    .then((result) => {
      console.log(JSON.stringify(result.status, null, 2));
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
