/**
 * 角色 sheet 一致性 live check（实施计划 §1 T6，显式授权、付费）。
 *
 * 复用 harness:assets-dashscope-live-check 的骨架惯例（plan → 真实调用 → summary/trace），
 * 专门测角色 sheet 一致性：1 个高出场角色 → sheet 两种画幅（16:9 / 9:16）→ 引用它的
 * 分镜图 3 张（注入参考图）→ wan2.6-image 对照 1 张 + 纯文本基线 1 张。
 *
 * 不进入默认自动化 gate；不输出 API key；不做质量自动判定——一致性结论由人工比对
 * （产物落盘后逐张目视）写入 docs/records/。
 *
 * 运行：npm run harness:assets-character-sheet-live-check [-- --plan-only]
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { createDbClient, type DbClient } from "../../../backend/src/db/client.js";
import { executeAssetManifest } from "../../../backend/src/modules/assets/assets-execution-engine.js";
import { createAssetProviderRegistry } from "../../../backend/src/modules/assets/assets-provider-registry.js";
import { buildInitialAssetManifest } from "../../../backend/src/modules/assets/assets-manifest-builder.js";
import { createDashscopeImageProvider } from "../../../backend/src/modules/assets/providers/dashscope/dashscope-image-provider.js";
import {
  compileAssetPlanFromIntents,
  type AssetPlanCompilerInput,
} from "../../../backend/src/modules/asset-planning/asset-plan-intent-compiler.js";
import type { AssetManifest, AssetPlan } from "../../../shared/src/index.js";

const DEFAULT_OUTPUT_DIR = resolve(
  process.cwd(),
  "harness/scripts/runtime/output/assets-character-sheet-live-check",
);

/** 角色与分镜：单一高出场角色（3/3 段命中）触发 sheet 阈值。 */
const CHARACTER = {
  character_id: "char_jingke",
  label: "荆轲",
  role: "主角",
  visual_description:
    "战国末期燕国侠士，三十余岁男子，束发加冠，深褐色窄袖短衣外罩青色直裾，腰束革带，足踏麻履，面容清瘦、眉目坚毅、短须",
  consistency_notes: ["服饰形制为战国末燕地", "不得出现后世冠帽与甲胄"],
} as const;

const SEGMENT_TEXTS = [
  "燕市酒肆中，荆轲独坐饮酒，案上横放长剑",
  "荆轲在易水边与众人诀别，风起衣袂翻飞",
  "荆轲捧匣上殿，殿上秦王端坐，气氛凝滞",
];

const SEGMENT_IDS = ["seg_001", "seg_002", "seg_003"];

export interface CharacterSheetLiveCheckPlan {
  mode: "assets_character_sheet_live_check";
  automated_gate: false;
  requires_real_env: true;
  output_dir: string;
  character_label: string;
  expected_images: number;
  estimated_cost_cny: string;
  planned_steps: string[];
}

export interface CharacterSheetLiveCheckStepResult {
  step: string;
  model: string;
  size: string;
  reference_image_count: number;
  execution_status: string;
  artifact_count: number;
  artifact_files: string[];
  elapsed_ms: number;
  usage: Record<string, unknown> | null;
  receipts: Array<{
    task_id: string;
    provider_job_id: string | null;
    request_id: string | null;
    reference_image_count: number;
    status: string;
  }>;
  artifacts: Array<{ artifact_id: string; file_uri: string; metadata: Record<string, unknown> }>;
  notes: string[];
  failure_mode: string | null;
}

export interface CharacterSheetLiveCheckResult extends CharacterSheetLiveCheckPlan {
  status: "live-check-completed";
  steps: CharacterSheetLiveCheckStepResult[];
}

export function buildCharacterSheetLiveCheckPlan(
  input: { outputDir?: string } = {},
): CharacterSheetLiveCheckPlan {
  return {
    mode: "assets_character_sheet_live_check",
    automated_gate: false,
    requires_real_env: true,
    output_dir: input.outputDir ?? DEFAULT_OUTPUT_DIR,
    character_label: CHARACTER.label,
    expected_images: 7,
    estimated_cost_cny: "1.5-3.0（2K 单价未核实，以控制台为准）",
    planned_steps: [
      "sheet wan2.7-image 16:9 (2048*1152)",
      "sheet wan2.7-image 9:16 (1152*2048)",
      "分镜图 3 张（注入 16:9 sheet 参考图，wan2.7-image）",
      "对照：分镜图 1 张 wan2.6-image（编辑形态，注入同一 sheet）",
      "对照：分镜图 1 张 wan2.7-image 纯文本基线（不注入）",
    ],
  };
}

// ─── 计划与清单构建（真实 compiler / manifest builder） ──────────────────────

function makeCompilerInput(): AssetPlanCompilerInput {
  const storyboard = {
    plan_version: "storyboard_v1" as const,
    source_script_record_id: "script_live_check",
    source_topic_package_id: "topic_live_check",
    estimated_total_duration_sec: SEGMENT_TEXTS.length * 5,
    segments: SEGMENT_IDS.map((segmentId, index) => ({
      segment_id: segmentId,
      order: index,
      script_excerpt: `${SEGMENT_TEXTS[index]}。`,
      start_hint_sec: index * 5,
      end_hint_sec: (index + 1) * 5,
      narrative_role: index === 0 ? ("opening" as const) : index === 2 ? ("ending" as const) : ("setup" as const),
      visual_intent: SEGMENT_TEXTS[index]!,
      scene_description: SEGMENT_TEXTS[index]!,
      visual_elements: [] as string[],
      framing_hint: "medium" as const,
      content_type: "live_action" as const,
      motion_hint: "static" as const,
      editing_hint: "single" as const,
      on_screen_text: [] as string[],
      linked_beats: [] as string[],
      linked_quotes: [] as string[],
      risk_notes: [] as string[],
      api_video_suitability: "remotion_sufficient" as const,
    })),
    global_visual_notes: [] as string[],
  };
  const scriptText = storyboard.segments.map((segment) => segment.script_excerpt).join("");
  return {
    sourceIds: {
      storyboardRecordId: "storyboard_live_check",
      scriptRecordId: "script_live_check",
      topicPackageId: "topic_live_check",
    },
    storyboard,
    draft: {
      script_text: scriptText,
      estimated_duration_sec: storyboard.estimated_total_duration_sec,
      beat_trace: [],
      quote_trace: [],
      opening_span: storyboard.segments[0]!.script_excerpt,
      ending_span: storyboard.segments.at(-1)!.script_excerpt,
    },
    globalDraft: {
      art_bible: {
        era_style: "战国末期（燕地）",
        visual_tone: "冷峻写实，低饱和，戏剧性侧光",
        characters: [{ ...CHARACTER, consistency_notes: [...CHARACTER.consistency_notes] }],
        locations: [],
        props: [],
        global_prompt_prefix: "写实历史电影质感",
        global_negative_prompts: ["现代物品", "现代建筑", "动漫风", "文字水印"],
        consistency_notes: [],
      },
      visual_budget: { mode: "balanced" },
      downgrade_policy: { video_to_image: true },
      global_audio_strategy: {},
      manual_review_notes: [],
    },
    audioSkeleton: {
      // 必须与编译器期望的确定性音频骨架逐字一致（validateInput 用 isDeepStrictEqual 核对）。
      tts_plan: {
        voice_profile_id: "voice_default_male_storyteller",
        estimated_total_duration_sec: storyboard.estimated_total_duration_sec,
        chunking_strategy: "segment_boundary" as const,
        chunks: storyboard.segments.map((segment, index) => ({
          chunk_id: `tts_${String(index + 1).padStart(3, "0")}`,
          order: index,
          script_excerpt: segment.script_excerpt,
          estimated_duration_sec: 5,
        })),
      },
      tasks: [
        {
          task_id: "tts_001",
          order: 0,
          task_type: "tts_audio" as const,
          source_segment_id: null,
          source_excerpt: scriptText,
          production_intent: "生成全片口播音频",
          recommended_mode: "auto" as const,
          provider_hint: "default_tts",
          prompt_draft: null,
          parameters: {
            voice_profile_id: "voice_default_male_storyteller",
            chunk_ids: storyboard.segments.map((_, index) => `tts_${String(index + 1).padStart(3, "0")}`),
          },
          manual_upload_policy: { allowed: false, required: false, accepted_file_types: [], acceptance_notes: [] },
          risk_notes: [],
          cost_tier: "low" as const,
          initial_status: "planned" as const,
        },
        {
          task_id: "subtitle_001",
          order: 1,
          task_type: "subtitle_track" as const,
          source_segment_id: null,
          source_excerpt: scriptText,
          production_intent: "根据 TTS 时间戳生成字幕轨",
          recommended_mode: "auto" as const,
          provider_hint: null,
          prompt_draft: null,
          parameters: { format: "srt", source_tts_task_id: "tts_001" },
          manual_upload_policy: { allowed: false, required: false, accepted_file_types: [], acceptance_notes: [] },
          risk_notes: [],
          cost_tier: "free" as const,
          initial_status: "planned" as const,
        },
      ],
      dependencies: [
        {
          dependency_id: "dep_subtitle_001_after_tts_001",
          task_id: "subtitle_001",
          depends_on_task_id: "tts_001",
          dependency_type: "requires_timing" as const,
        },
      ],
    },
    chunks: [
      {
        chunkIndex: 0,
        inputSegmentIds: SEGMENT_IDS,
        draft: {
          planning_mode: "segment_intent_batch" as const,
          segments: storyboard.segments.map((segment, index) => ({
            source_segment_id: segment.segment_id,
            intents: [
              {
                asset_kind: "image_still" as const,
                production_intent: `第${index + 1}段分镜图`,
                image_prompt: SEGMENT_TEXTS[index]!,
                video_prompt_reserve: "",
                image_role: "anchor" as const,
                support_reason: null,
                risk_notes: ["历史形制需人工复核"],
              },
              {
                asset_kind: "render_motion_cue" as const,
                production_intent: `第${index + 1}段运镜`,
                risk_notes: ["运镜风险"],
              },
              // 编译器硬合同：恰好一个 global bgm_cue 且必须挂在首段。
              ...(index === 0
                ? [
                    {
                      asset_kind: "bgm_cue" as const,
                      production_intent: "全片配乐",
                      required_tags: ["低沉弦乐"],
                      mood_tags: ["肃杀"],
                      selection_label: "配乐选择",
                      timing_basis: "tts" as const,
                      scope: "global" as const,
                      segment_ids: [] as string[],
                      volume: 0.35,
                      fade_in_sec: 0.5,
                      fade_out_sec: 1.5,
                      risk_notes: ["配乐风险"],
                    },
                  ]
                : []),
            ],
          })),
          budget_notes: [],
        },
      },
    ],
    segmentVisualRoutes: new Map(
      storyboard.segments.map((segment) => [
        segment.segment_id,
        {
          segment_id: segment.segment_id,
          segment_override: null,
          api_video_suitability: segment.api_video_suitability,
          resolved_route: "remotion" as const,
          reason_code: "live_check_route",
        },
      ]),
    ),
    characterSheet: { enabled: true, minSegmentHits: 3 },
  };
}

function compileLiveCheckPlan(): AssetPlan {
  return compileAssetPlanFromIntents(makeCompilerInput()).plan;
}

/** 付费闸门上下文：run + 快照（image.generate 冻结模型按被测模型写）。 */
function seedPaidContext(db: DbClient, imageModel: string, runId: string): void {
  const now = new Date();
  const snapshot = {
    id: `snap_${runId}`,
    projectId: "project_live_check",
    userId: null,
    stage: "assets",
    operation: "assets.generate",
    runId,
    projectConfigurationRevision: 1,
    schemaVersion: "resolved_generation_configuration_v1",
    configurationHash: "h",
    resolvedConfigurationJson: {
      resolved_capabilities: { "image.generate": { provider_key: "dashscope", model_id: imageModel } },
    },
    resolutionTraceJson: [],
    quoteId: null,
    quoteFingerprint: null,
    estimatedCostMicros: null,
    authorizationCostMicros: null,
    budgetLimitMicros: null,
    budgetOverrideAuthorized: false,
    pricingHash: null,
    pricingVersionSetJson: [],
    createdAt: now,
    updatedAt: now,
  } as unknown as import("../../../backend/src/db/client.js").RunConfigurationSnapshotRecord;
  db.runConfigurationSnapshots.set(snapshot.id, snapshot);
  db.generationRuns.set(runId, {
    id: runId,
    projectId: "project_live_check",
    userId: null,
    operation: "assets.generate",
    idempotencyKey: runId,
    payloadFingerprint: "f",
    quoteId: null,
    runConfigurationSnapshotId: snapshot.id,
    dispatchPayloadJson: {},
    status: "running",
    dispatchLeaseOwner: "live-check",
    dispatchLeaseExpiresAt: new Date(now.getTime() + 3_600_000),
    dispatchClaimCount: 1,
    createdAt: now,
    updatedAt: now,
  } as unknown as import("../../../backend/src/db/client.js").GenerationRunRecord);
}

interface StepInput {
  step: string;
  model: string;
  plan: AssetPlan;
  manifest: AssetManifest;
  taskIds: string[];
  storageDir: string;
}

/** 只保留指定任务的 execution（其余任务不出现在 manifest，避免产生额外付费调用）。 */
function selectExecutions(manifest: AssetManifest, taskIds: string[]): AssetManifest {
  return {
    ...manifest,
    executions: manifest.executions.filter((execution) => taskIds.includes(execution.task_id)),
  };
}

async function runStep(input: StepInput, referenceManifest?: AssetManifest): Promise<CharacterSheetLiveCheckStepResult> {
  const db = createDbClient();
  // 每步独立 run id ⇒ 独立产物目录：共用 run id 会让后跑的步骤覆盖前面的产物文件。
  const runId = `assets_run_live_check_${input.step}`;
  seedPaidContext(db, input.model, runId);
  const manifest = referenceManifest
    ? { ...selectExecutions(input.manifest, input.taskIds), artifacts: referenceManifest.artifacts }
    : selectExecutions(input.manifest, input.taskIds);
  const startedAt = Date.now();
  let failureMode: string | null = null;
  let result: { manifest: AssetManifest } | null = null;
  try {
    result = await executeAssetManifest({
      db,
      assetManifestRecordId: "manifest_live_check",
      assetRunId: runId,
      manifest,
      assetPlan: input.plan,
      registry: createAssetProviderRegistry([
        createDashscopeImageProvider({
          apiKey: process.env.ALIYUN_DASHSCOPE_API_KEY ?? "",
          baseUrl: process.env.ALIYUN_DASHSCOPE_BASE_URL,
          model: input.model,
          pollIntervalMs: 3000,
          maxPollAttempts: 80,
        }),
      ]),
      projectStorageRootDir: input.storageDir,
    });
  } catch (error) {
    failureMode = error instanceof Error ? error.message : String(error);
  }
  const elapsedMs = Date.now() - startedAt;

  const executions = result?.manifest.executions ?? [];
  const artifacts = (result?.manifest.artifacts ?? []).filter((artifact) =>
    executions.some((execution) => execution.output_artifact_ids.includes(artifact.artifact_id)),
  );
  const jobs = [...db.assetProviderJobRecords.values()];
  const receipts = jobs.map((job) => {
    const raw = (job.rawResponseJson ?? {}) as Record<string, unknown>;
    return {
      task_id: job.taskId,
      provider_job_id: job.providerJobId,
      request_id: typeof raw.request_id === "string" ? raw.request_id : null,
      reference_image_count: Number(
        (job.rawRequestJson as { reference_image_count?: number }).reference_image_count ?? 0,
      ),
      status: job.status,
    };
  });
  const sheetTask = input.plan.tasks.find((task) => task.task_type === "character_sheet");
  const size =
    executions
      .map((execution) => input.plan.tasks.find((task) => task.task_id === execution.task_id))
      .map((task) => (typeof task?.parameters.size === "string" ? task.parameters.size : "1080*1920"))[0] ??
    "1080*1920";
  const referenceCount = jobs.length > 0
    ? Number((jobs[0]!.rawRequestJson as { reference_image_count?: number }).reference_image_count ?? 0)
    : 0;

  return {
    step: input.step,
    model: input.model,
    size,
    reference_image_count: referenceCount,
    execution_status: executions.map((execution) => `${execution.task_id}:${execution.status}`).join(","),
    artifact_count: artifacts.length,
    artifact_files: artifacts.map((artifact) => artifact.file_uri),
    elapsed_ms: elapsedMs,
    usage: null,
    receipts,
    artifacts: artifacts.map((artifact) => ({
      artifact_id: artifact.artifact_id,
      file_uri: artifact.file_uri,
      metadata: artifact.metadata as Record<string, unknown>,
    })),
    notes: executions.flatMap((execution) => execution.notes),
    failure_mode: failureMode ?? (executions.some((execution) => execution.status === "failed") ? "execution_failed" : null),
    ...(sheetTask ? {} : {}),
  };
}

export async function runCharacterSheetLiveCheck(
  input: { outputDir?: string } = {},
): Promise<CharacterSheetLiveCheckResult> {
  const plan = buildCharacterSheetLiveCheckPlan(input);
  mkdirSync(plan.output_dir, { recursive: true });
  const storageDir = resolve(plan.output_dir, "project-storage");
  mkdirSync(storageDir, { recursive: true });
  writeJson(plan.output_dir, "live-check-plan.json", plan);

  const assetPlan = compileLiveCheckPlan();
  const steps: CharacterSheetLiveCheckStepResult[] = [];
  const sheetTaskId = assetPlan.tasks.find((task) => task.task_type === "character_sheet")!.task_id;
  const imageTaskIds = assetPlan.tasks
    .filter((task) => task.task_type === "image_still")
    .map((task) => task.task_id);

  // ① sheet 16:9（编译器冻结的独立画幅）
  const sheet169 = await runStep(
    { step: "sheet_16x9", model: "wan2.7-image", plan: assetPlan, manifest: buildInitialAssetManifest({ assetPlanRecordId: "asset_plan_live_check", assetPlan, segmentIds: SEGMENT_IDS }), taskIds: [sheetTaskId], storageDir },
  );
  steps.push(sheet169);

  // ② sheet 9:16（画幅对照：同一角色/同一 description，仅改画幅）
  const portraitPlan: AssetPlan = {
    ...assetPlan,
    tasks: assetPlan.tasks.map((task) =>
      task.task_id === sheetTaskId
        ? { ...task, parameters: { ...task.parameters, aspect_ratio: "9:16", size: "1152*2048" } }
        : task,
    ),
  };
  const sheetPortrait = await runStep(
    { step: "sheet_9x16", model: "wan2.7-image", plan: portraitPlan, manifest: buildInitialAssetManifest({ assetPlanRecordId: "asset_plan_live_check", assetPlan: portraitPlan, segmentIds: SEGMENT_IDS }), taskIds: [sheetTaskId], storageDir },
  );
  steps.push(sheetPortrait);

  // ③ 注入 sheet 的分镜图 3 张（16:9 sheet 作参考图）
  const injectedManifest = (() => {
    const base = buildInitialAssetManifest({ assetPlanRecordId: "asset_plan_live_check", assetPlan, segmentIds: SEGMENT_IDS });
    const sheetArtifacts = [...sheet169.artifact_files].map((fileUri) => ({
      artifact_id: `artifact_live_sheet_${Date.now().toString(36)}`,
      artifact_type: "image" as const,
      origin: "provider" as const,
      file_uri: fileUri,
      created_at: new Date().toISOString(),
      metadata: { sheet_role: "character_sheet", character_id: CHARACTER.character_id, width: 2048, height: 1152 },
    }));
    return { ...base, artifacts: sheetArtifacts };
  })();
  steps.push(
    await runStep(
      { step: "storyboard_injected", model: "wan2.7-image", plan: assetPlan, manifest: injectedManifest, taskIds: imageTaskIds, storageDir },
    ),
  );

  // ④ 纯文本基线（不注入参考图）
  steps.push(
    await runStep({
      step: "storyboard_text_baseline",
      model: "wan2.7-image",
      plan: assetPlan,
      manifest: selectExecutions(buildInitialAssetManifest({ assetPlanRecordId: "asset_plan_live_check", assetPlan, segmentIds: SEGMENT_IDS }), [imageTaskIds[0]!]),
      taskIds: [imageTaskIds[0]!],
      storageDir,
    }),
  );

  // ⑤ wan2.6-image 对照（编辑形态，注入同一 sheet；需 ≥1 张参考图）
  steps.push(
    await runStep({
      step: "storyboard_injected_wan26",
      model: "wan2.6-image",
      plan: assetPlan,
      manifest: injectedManifest,
      taskIds: [imageTaskIds[0]!],
      storageDir,
    }),
  );

  const result: CharacterSheetLiveCheckResult = { ...plan, status: "live-check-completed", steps };
  writeJson(plan.output_dir, "live-check-summary.json", result);
  writeTrace(plan.output_dir, result);
  return result;
}

function writeJson(dir: string, fileName: string, value: unknown): void {
  writeFileSync(resolve(dir, fileName), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeTrace(dir: string, result: CharacterSheetLiveCheckResult): void {
  const lines = [
    "# 角色 sheet 一致性 live check",
    "",
    `- 角色：${result.character_label}`,
    `- 预估成本：${result.estimated_cost_cny}`,
    `- 产物目录：${result.output_dir}`,
    "",
    "| 步骤 | 模型 | 画幅 | 参考图 | execution | 产物 | 耗时(ms) |",
    "|---|---|---|---|---|---|---|",
    ...result.steps.map((step) =>
      `| ${step.step} | ${step.model} | ${step.size} | ${step.reference_image_count} | ${step.execution_status} | ${step.artifact_count} | ${step.elapsed_ms} |`,
    ),
    "",
    "## 供应商回执（逐图 request_id / task id / 参考图数）",
    "",
    ...result.steps.flatMap((step) =>
      step.receipts.map(
        (receipt) =>
          `- ${step.step} | ${step.model} | ${step.size} | task=${receipt.task_id} | job=${receipt.provider_job_id} | request_id=${receipt.request_id} | refs=${receipt.reference_image_count} | ${receipt.status}`,
      ),
    ),
    "",
    "## 一致性结论",
    "",
    "人工比对（逐张目视产物）结论写入 docs/records/，本 trace 只记录机械事实。",
  ];
  writeFileSync(resolve(dir, "trace.md"), `${lines.join("\n")}\n`, "utf8");
}

async function main(): Promise<void> {
  const planOnly = process.argv.includes("--plan-only") || process.env.LIVE_CHECK_PLAN_ONLY === "1";
  if (!process.env.ALIYUN_DASHSCOPE_API_KEY) {
    const dotEnvPath = resolve(process.cwd(), ".env");
    if (existsSync(dotEnvPath)) {
      for (const line of readFileSync(dotEnvPath, "utf8").split(/\r?\n/)) {
        const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u);
        if (match && process.env[match[1]!] === undefined) process.env[match[1]!] = match[2]!;
      }
    }
  }
  if (planOnly) {
    const plan = buildCharacterSheetLiveCheckPlan();
    mkdirSync(plan.output_dir, { recursive: true });
    writeJson(plan.output_dir, "live-check-plan.json", plan);
    process.stdout.write(`${JSON.stringify({ status: "live-check-plan-ready", output_dir: plan.output_dir, estimated_cost_cny: plan.estimated_cost_cny }, null, 2)}\n`);
    return;
  }
  if (!process.env.ALIYUN_DASHSCOPE_API_KEY) throw new Error("ALIYUN_DASHSCOPE_API_KEY missing");
  const result = await runCharacterSheetLiveCheck();
  process.stdout.write(`${JSON.stringify({ status: result.status, output_dir: result.output_dir, steps: result.steps.map((step) => ({ step: step.step, model: step.model, status: step.execution_status, artifacts: step.artifact_count, reference_images: step.reference_image_count, elapsed_ms: step.elapsed_ms, failure_mode: step.failure_mode })) }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
