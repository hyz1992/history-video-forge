/**
 * 角色 sheet 浏览器验收夹具（独立验收库）。
 *
 * 目的：把项目喂到"资产阶段且含 character_sheet 任务"的状态，供内置浏览器逐项验收
 * T4 的面板承载面（类型标签 / 定妆图预览 / 降级 note / 重生成入口 / 费用清单归组）。
 *
 * 事实边界（必须如实理解）：
 * - 计划由**真实 intent compiler** 产出（characterSheet 开关打开），不是手写 JSON；
 * - manifest 由 buildInitialAssetManifest 产出；
 * - **执行态与产物是合成的**：为了让面板同时展示"已完成定妆图"与"降级跳过"两种承载面，
 *   夹具把主角 sheet 置 completed 并把 T6 live check 的真实产物拷进项目存储，
 *   把配角 sheet 置 skipped_with_fallback 并写入引擎同款 note。它**不证明**运行时行为，
 *   运行时行为由 T5 冒烟与 T6 live check 证明。
 *
 * 用法：DATABASE_URL=file:./storage/tmp-sheet-acceptance.db npx tsx <本文件> --confirm-fixture
 */

import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { createPrismaClient } from "../../../backend/src/db/prisma-client.js";
import { hashPassword } from "../../../backend/src/auth/password-hash.js";
import { compileAssetPlanFromIntents } from "../../../backend/src/modules/asset-planning/asset-plan-intent-compiler.js";
import { buildInitialAssetManifest } from "../../../backend/src/modules/assets/assets-manifest-builder.js";

const args = new Set(process.argv.slice(2));
const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const USERNAME = "sheet_acceptance";
const PASSWORD = "sheet-acceptance-2026";
const LIVE_CHECK_DIR = resolve(
  process.cwd(),
  "harness/scripts/runtime/output/assets-character-sheet-live-check/project-storage/assets-runs",
);
const PROJECT_NAME = "浏览器验收：角色定妆图（合成状态）";

const SEGMENT_IDS = ["seg_001", "seg_002", "seg_003"];
const SEGMENT_TEXTS = [
  "燕市酒肆中，荆轲与秦舞阳对坐饮酒，案上横放长剑",
  "荆轲与秦舞阳在易水边诀别，风起衣袂翻飞",
  "荆轲捧匣上殿，秦舞阳随行，殿上秦王端坐",
];

function imagePath(step: string, fileName: string): string {
  return join(LIVE_CHECK_DIR, step, "images", fileName);
}

function makeCompilerInput(): Parameters<typeof compileAssetPlanFromIntents>[0] {
  const segments = SEGMENT_IDS.map((segmentId, index) => ({
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
  }));
  const storyboard = {
    plan_version: "storyboard_v1" as const,
    source_script_record_id: "script_fixture",
    source_topic_package_id: "topic_fixture",
    estimated_total_duration_sec: 15,
    segments,
    global_visual_notes: [] as string[],
  };
  const scriptText = segments.map((segment) => segment.script_excerpt).join("");
  return {
    sourceIds: {
      storyboardRecordId: "storyboard_fixture",
      scriptRecordId: "script_fixture",
      topicPackageId: "topic_fixture",
    },
    storyboard,
    draft: {
      script_text: scriptText,
      estimated_duration_sec: 15,
      beat_trace: [],
      quote_trace: [],
      opening_span: segments[0]!.script_excerpt,
      ending_span: segments[2]!.script_excerpt,
    },
    globalDraft: {
      art_bible: {
        era_style: "战国末期（燕地）",
        visual_tone: "冷峻写实，低饱和",
        characters: [
          {
            character_id: "char_jingke",
            label: "荆轲",
            role: "主角",
            visual_description: "战国末期燕国侠士，束发加冠，深褐色窄袖短衣外罩青色直裾，腰束革带，面容清瘦、短须",
            consistency_notes: ["服饰形制为战国末燕地"],
          },
          {
            character_id: "char_qinwuyang",
            label: "秦舞阳",
            role: "配角",
            visual_description: "少年随从，短衣束带，面色苍白，神情紧张",
            consistency_notes: ["与荆轲服饰同制式但颜色较浅"],
          },
        ],
        locations: [],
        props: [],
        global_prompt_prefix: "写实历史电影质感",
        global_negative_prompts: ["现代物品", "现代建筑"],
        consistency_notes: [],
      },
      visual_budget: { mode: "balanced" },
      downgrade_policy: { video_to_image: true },
      global_audio_strategy: {},
      manual_review_notes: [],
    },
    audioSkeleton: {
      tts_plan: {
        voice_profile_id: "voice_default_male_storyteller",
        estimated_total_duration_sec: 15,
        chunking_strategy: "segment_boundary" as const,
        chunks: segments.map((segment, index) => ({
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
            chunk_ids: segments.map((_, index) => `tts_${String(index + 1).padStart(3, "0")}`),
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
          segments: segments.map((segment, index) => ({
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
      segments.map((segment) => [
        segment.segment_id,
        {
          segment_id: segment.segment_id,
          segment_override: null,
          api_video_suitability: segment.api_video_suitability,
          resolved_route: "remotion" as const,
          reason_code: "fixture_route",
        },
      ]),
    ),
    // 阈值 3：两个角色都命中 3 段 ⇒ 各产出一张 sheet（夹具要让两种承载面同时出现）。
    characterSheet: { enabled: true, minSegmentHits: 3 },
  };
}

async function main(): Promise<void> {
  if (!args.has("--confirm-fixture")) throw new Error("fixture_confirmation_required");
  if (!databaseUrl) throw new Error("fixture_database_url_required");

  const plan = compileAssetPlanFromIntents(makeCompilerInput()).plan;
  const sheetTasks = plan.tasks.filter((task) => task.task_type === "character_sheet");
  if (sheetTasks.length !== 2) throw new Error(`expected_two_sheet_tasks_got_${sheetTasks.length}`);

  const projectId = randomUUID();
  const topicId = randomUUID();
  const scriptId = randomUUID();
  const storyboardId = randomUUID();
  const assetPlanId = randomUUID();
  const manifestId = randomUUID();
  const runId = randomUUID();
  const snapshotId = randomUUID();

  const client = await createPrismaClient(databaseUrl);
  try {
    const existingUser = await client.user.findUnique({ where: { username: USERNAME } });
    const ownerId = existingUser?.id ?? randomUUID();
    if (!existingUser) {
      await client.user.create({
        data: {
          id: ownerId,
          username: USERNAME,
          displayName: "角色定妆图验收账号",
          passwordHash: await hashPassword(PASSWORD),
          status: "ACTIVE",
          role: "USER",
        },
      });
    }

    // 项目存储：把 T6 的真实产物拷进来（面板预览读的就是这些文件）。
    // 与 buildProjectRootDir 同构（storage/projects/<date>/<name> [p_xxxxxxxx]），
    // 并把绝对路径写进 project.storageRootDir —— 应用读 artifact 文件用的就是该字段。
    const createdAt = new Date();
    const shortId = `p_${projectId.replace(/[^A-Za-z0-9]/g, "").toLowerCase().slice(0, 8).padEnd(8, "0")}`;
    const storageRootDir = resolve(
      process.cwd(),
      "storage",
      "projects",
      createdAt.toISOString().slice(0, 10),
      `${PROJECT_NAME} [${shortId}]`,
    );
    const runImagesDir = join(storageRootDir, "assets-runs", runId, "images");
    mkdirSync(runImagesDir, { recursive: true });

    const artifacts: Array<Record<string, unknown>> = [];
    const copyArtifact = (step: string, fileName: string, artifactId: string, metadata: Record<string, unknown>) => {
      const source = imagePath(step, fileName);
      if (!existsSync(source)) throw new Error(`live_check_artifact_missing:${source}`);
      const target = join(runImagesDir, `${artifactId}.png`);
      copyFileSync(source, target);
      artifacts.push({
        artifact_id: artifactId,
        artifact_type: "image",
        origin: "provider",
        file_uri: target,
        created_at: new Date().toISOString(),
        metadata: { ...metadata, file_hash: "fixture", relative_path: `assets-runs/${runId}/images/${artifactId}.png` },
      });
    };

    const [leadSheet, supportSheet] = sheetTasks;
    copyArtifact("assets_run_live_check_sheet_16x9", "dashscope_sheet_001.png", "artifact_sheet_lead", {
      width: 2048,
      height: 1152,
      model: "wan2.7-image",
      provider_name: "dashscope_image",
      provider_job_id: "5531031c-59eb-421b-bd31-2656144d1a73",
      sheet_role: "character_sheet",
      character_id: "char_jingke",
      character_label: "荆轲",
    });
    copyArtifact("assets_run_live_check_storyboard_injected", "dashscope_img_s000_01.png", "artifact_img_s000", {
      width: 1080,
      height: 1920,
      model: "wan2.7-image",
      provider_name: "dashscope_image",
    });
    copyArtifact("assets_run_live_check_storyboard_injected", "dashscope_img_s001_01.png", "artifact_img_s001", {
      width: 1080,
      height: 1920,
      model: "wan2.7-image",
      provider_name: "dashscope_image",
    });

    const manifest = buildInitialAssetManifest({
      assetPlanRecordId: assetPlanId,
      assetPlan: plan,
      segmentIds: SEGMENT_IDS,
    });
    const imageTaskIds = plan.tasks.filter((task) => task.task_type === "image_still").map((task) => task.task_id);
    const artifactByTask: Record<string, string> = {
      [imageTaskIds[0]!]: "artifact_img_s000",
      [imageTaskIds[1]!]: "artifact_img_s001",
    };
    for (const execution of manifest.executions) {
      if (execution.task_id === leadSheet!.task_id) {
        execution.status = "completed";
        execution.origin = "provider";
        execution.completed_at = new Date().toISOString();
        execution.output_artifact_ids = ["artifact_sheet_lead"];
        execution.notes = ["dashscope image generated"];
      } else if (execution.task_id === supportSheet!.task_id) {
        // 引擎同款降级 note（T3 写入形态），用于验收面板的 note 承载面。
        execution.status = "skipped_with_fallback";
        execution.completed_at = new Date().toISOString();
        execution.notes = ["[sheet] 冻结模型 wan2.6-t2i 不具备参考图能力，未生成该角色 sheet（零计费）"];
      } else if (artifactByTask[execution.task_id]) {
        execution.status = "completed";
        execution.origin = "provider";
        execution.completed_at = new Date().toISOString();
        execution.output_artifact_ids = [artifactByTask[execution.task_id]!];
        execution.notes = ["dashscope image generated"];
      }
    }
    const manifestJson = { ...manifest, artifacts };

    await client.$transaction(async (tx) => {
      await tx.project.create({
        data: {
          id: projectId,
          ownerId,
          createdById: ownerId,
          name: PROJECT_NAME,
          createdAt,
          storageKey: `sheet-acceptance-${projectId}`,
          storageDisplayName: PROJECT_NAME,
        },
      });
      await tx.topicPackage.create({
        data: {
          id: topicId,
          projectId,
          title: "荆轲刺秦",
          selectedAngle: "一个人的决死与一个时代的终局",
          familyLabel: "权力博弈",
          scopeLabel: "战国末期",
          coreConflict: "荆轲必须在殿上完成不可能的行刺",
          strongScene: "易水诀别与殿上献图",
          packagingSeed: "图穷匕见",
          canonicalQuotesJson: [],
          canonicalQuoteIntentsJson: [],
          durationBandJson: { label: "short" },
          narrativeTensionMapJson: {
            hook_claim: "匕首已藏于图中",
            pressure_escalation: "秦舞阳失色",
            mid_reveal: "图穷匕见",
            peak_payoff: "殿上追逐",
            ending_residue: "刺杀未成",
          },
          mustIncludeBeatsJson: ["易水诀别", "图穷匕见"],
          forbiddenExpansionsJson: [],
          riskHintsJson: [],
          sourceAnchorRefsJson: ["史记·刺客列传"],
          ambiguityNotesJson: [],
        },
      });
      await tx.scriptRecord.create({
        data: {
          id: scriptId,
          projectId,
          topicPackageId: topicId,
          scriptText: SEGMENT_IDS.map((_, index) => `${SEGMENT_TEXTS[index]}。`).join(""),
          openingSpan: SEGMENT_TEXTS[0]!,
          endingSpan: SEGMENT_TEXTS[2]!,
          estimatedDurationSec: 15,
          beatTraceJson: [],
          quoteTraceJson: [],
          reviewStatus: "pass",
          validationResultJson: { stage: "script_local_validation", decision: "pass", errors: [], warnings: [], metrics: {} },
          semanticReviewResultJson: null,
          executionStateJson: { generating: false },
          graphTraceSummaryJson: null,
          runtimeDiagnosticsJson: null,
        },
      });
      await tx.storyboardRecord.create({
        data: {
          id: storyboardId,
          projectId,
          topicPackageId: topicId,
          scriptRecordId: scriptId,
          planJson: {
            ...makeCompilerInput().storyboard,
            source_script_record_id: scriptId,
            source_topic_package_id: topicId,
          } as never,
          validationResultJson: { stage: "storyboard_local_validation", decision: "pass", errors: [], warnings: [], metrics: { segment_count: 3 } },
          executionStateJson: { generating: false },
          graphTraceSummaryJson: null,
          runtimeDiagnosticsJson: null,
        },
      });
      await tx.assetPlanRecord.create({
        data: {
          id: assetPlanId,
          projectId,
          topicPackageId: topicId,
          scriptRecordId: scriptId,
          storyboardRecordId: storyboardId,
          planJson: plan as never,
          validationResultJson: { stage: "asset_planning_local_validation", decision: "pass", errors: [], warnings: [], metrics: { task_count: plan.tasks.length } },
          executionStateJson: { generating: false },
          graphTraceSummaryJson: null,
          runtimeDiagnosticsJson: { checks: [{ code: "browser_fixture", level: "info" }] },
        },
      });
      await tx.assetManifestRecord.create({
        data: {
          id: manifestId,
          projectId,
          topicPackageId: topicId,
          scriptRecordId: scriptId,
          storyboardRecordId: storyboardId,
          assetPlanRecordId: assetPlanId,
          manifestJson: manifestJson as never,
          validationResultJson: { stage: "assets_local_validation", decision: "partial", errors: [], warnings: [], metrics: {} },
          executionStateJson: { generating: false },
          graphTraceSummaryJson: null,
          runtimeDiagnosticsJson: null,
        },
      });
      await tx.project.update({
        where: { id: projectId },
        data: {
          status: "assets_partial",
          activeTopicPackageId: topicId,
          activeScriptRecordId: scriptId,
          activeStoryboardRecordId: storyboardId,
          activeAssetPlanRecordId: assetPlanId,
          activeAssetManifestRecordId: manifestId,
        },
      });

      // 费用清单：sheet 的 image.generate 记账（0.20 元/张），供面板归组展示。
      await tx.runConfigurationSnapshot.create({
        data: {
          id: snapshotId,
          projectId,
          userId: ownerId,
          stage: "assets",
          operation: "assets.generate",
          runId,
          projectConfigurationRevision: 1,
          schemaVersion: "resolved_generation_configuration_v1",
          configurationHash: "fixture",
          resolvedConfigurationJson: {
            resolved_capabilities: { "image.generate": { provider_key: "dashscope", model_id: "wan2.7-image" } },
          } as never,
          resolutionTraceJson: [] as never,
          quoteId: null,
          quoteFingerprint: null,
          estimatedCostMicros: null,
          authorizationCostMicros: null,
          budgetLimitMicros: null,
          budgetOverrideAuthorized: false,
          pricingHash: null,
          pricingVersionSetJson: [] as never,
        },
      });
      await tx.generationRun.create({
        data: {
          id: runId,
          projectId,
          userId: ownerId,
          operation: "assets.generate",
          idempotencyKey: runId,
          payloadFingerprint: "fixture",
          quoteId: null,
          runConfigurationSnapshotId: snapshotId,
          dispatchPayloadJson: {} as never,
          status: "succeeded",
        },
      });
      for (const [index, entry] of [
        { taskId: leadSheet!.task_id, artifactId: "artifact_sheet_lead" },
        { taskId: imageTaskIds[0]!, artifactId: "artifact_img_s000" },
        { taskId: imageTaskIds[1]!, artifactId: "artifact_img_s001" },
      ].entries()) {
        const jobId = randomUUID();
        await tx.assetProviderJobRecord.create({
          data: {
            id: jobId,
            assetManifestRecordId: manifestId,
            assetRunId: runId,
            executionId: `exec_${entry.taskId}`,
            taskId: entry.taskId,
            providerType: "image",
            providerName: "dashscope_image",
            providerJobId: `fixture_job_${index}`,
            status: "succeeded",
            attemptCount: 1,
          },
        });
        await tx.usageCostRecord.create({
          data: {
            id: randomUUID(),
            runConfigurationSnapshotId: snapshotId,
            assetProviderJobRecordId: jobId,
            capability: "image.generate",
            providerKey: "dashscope",
            modelId: "wan2.7-image",
            providerRequestKey: `fixture:${entry.taskId}`,
            attemptIndex: 0,
            status: "succeeded",
            unitType: "image",
            outputUnits: 1,
            estimatedCostMicros: "200000",
            actualCostMicros: "200000",
            costBasis: "estimate",
            unitDetailJson: { resolution: entry.taskId === leadSheet!.task_id ? "2048*1152" : "1080*1920" } as never,
            durationMs: 12000,
          },
        });
      }
    });

    // 夹具自述文件：说明哪些是真实的、哪些是合成的。
    writeFileSync(
      join(storageRootDir, "FIXTURE-README.md"),
      [
        "# 角色定妆图浏览器验收夹具",
        "",
        `- 项目：${PROJECT_NAME}`,
        `- 登录账号：${USERNAME} / ${PASSWORD}`,
        "- 真实部分：资产计划由真实 intent compiler 产出（characterSheet 开关打开，含两张 character_sheet 任务与注入关系）；manifest 由 buildInitialAssetManifest 产出；定妆图与分镜图产物是 T6 live check 的真实图片（源目录见 harness/scripts/runtime/output/）。",
        "- 合成部分：execution 状态（一张 sheet completed、一张 sheet skipped_with_fallback）与费用记录是为验收面板承载面而设定的，不代表运行时行为；运行时行为证据见 T5 冒烟与 T6 live check。",
      ].join("\n"),
      "utf8",
    );

    process.stdout.write(
      `${JSON.stringify({
        status: "fixture_seeded",
        project_id: projectId,
        manifest_record_id: manifestId,
        asset_plan_record_id: assetPlanId,
        sheet_tasks: sheetTasks.map((task) => task.task_id),
        storage_root_dir: storageRootDir,
        username: USERNAME,
      }, null, 2)}\n`,
    );
  } finally {
    await client.$disconnect();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? `${error.message}\n${error.stack}` : "fixture_seed_failed"}\n`);
  process.exitCode = 1;
});
