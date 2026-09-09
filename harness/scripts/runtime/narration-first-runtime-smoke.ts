import { mkdirSync, mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildApp } from "../../../backend/src/app";
import { buildPricingCatalogSeed } from "../../../backend/src/modules/generation-cost/pricing-catalog.seed.js";
import { seedGlobalVoiceProfiles } from "../../../backend/src/modules/assets/voice/voice-profile.repository.js";
import { createProject as createLegacyProject } from "../../../backend/src/modules/projects/project.repository.js";
import { saveScriptRecord } from "../../../backend/src/modules/script/script-record.repository.js";
import { saveAssetPlanRecord } from "../../../backend/src/modules/asset-planning/asset-plan-record.repository.js";
import { narrationTextHash } from "../../../backend/src/modules/narration/narration-readiness.js";
import { NARRATION_FIRST_MODEL_POLICY_V1 as policy } from "../../../backend/src/modules/narration/narration-model-policy.js";
import { DashScopeNarrationProvider } from "../../../backend/src/modules/narration/providers/dashscope-narration-provider.js";
import { getProjectGenerationConfiguration, findProjectConfigRecord } from "../../../backend/src/modules/generation-config/generation-config.repository.js";
import { narrationStorage } from "../../../backend/src/modules/narration/narration-run.service.js";
import { validateAssetPlan } from "../../../backend/src/modules/asset-planning/asset-planning-local-validator.js";
import type { AppInstance } from "../../../backend/src/app";
import type { AssetPlanV2, StoryboardPlan } from "../../../shared/src/index.js";
import type { AuthContext } from "../../../backend/src/auth/auth-context.js";

/** 任务12：ASR 零参与的可失败断言——字幕 artifact 的 timing 来源不得为 forced_alignment
 *  （local-subtitle-provider 仅在真实 ASR 对齐成功时写入该键；narration_first 字幕来自 revision 派生）。 */
export function assertNoAsrAlignment(artifacts: unknown): boolean {
  const list = Array.isArray(artifacts) ? artifacts as Array<{ artifact_type?: unknown; metadata?: Record<string, unknown> }> : [];
  return !list.some((artifact) => artifact.artifact_type === "subtitle_track" && artifact.metadata?.timing_source === "forced_alignment");
}

export interface NarrationFirstRuntimeSmokeResult {
  outputDir: string;
  passed: boolean;
  projectId: string;
  narrationRecordId: string | null;
  storyboardRecordId: string | null;
  assetManifestRecordId: string | null;
  composeRecordId: string | null;
  renderJobRecordId: string | null;
  narrationSynthesizeCalls: number;
  asrCheckedSubtitleArtifacts: number;
  legacyProjectId: string | null;
  legacyStoryboardRecordId: string | null;
  subtitleRevisions: string[];
  checks: Record<string, string>;
}

const WORD_TIMES = Array.from({ length: 8 }, (_, index) => ({ begin: index * 250, end: (index + 1) * 250 }));
const SCRIPT_TEXT = "一二三四五六七八";
const WORDS = WORD_TIMES.map((time, index) => ({
  text: SCRIPT_TEXT[index]!,
  begin_index: index,
  end_index: index + 1,
  begin_time: time.begin,
  end_time: time.end,
}));
const AUDIO_BYTES = 96000; // 24kHz × 16bit × 1ch × 2s
const DURATION_MS = 2000;

function event(name: string, output?: unknown) {
  return { kind: "json" as const, elapsedMs: 0, data: { header: { event: name, task_id: "task" }, payload: output === undefined ? {} : { output } } };
}

function syntheticProvider(calls: { count: number }) {
  return new DashScopeNarrationProvider({
    client: {
      async synthesize() {
        calls.count += 1;
        return {
          pcm: Buffer.alloc(AUDIO_BYTES),
          providerTaskId: "task",
          providerRequestId: null,
          usageCharacters: SCRIPT_TEXT.length,
          sentences: [{ providerSentenceIndex: 0, originalText: SCRIPT_TEXT, normalizedText: SCRIPT_TEXT, words: WORDS }],
          rawEvents: [
            event("task-started"),
            event("result-generated", { type: "sentence-begin", sentence: { index: 0 } }),
            { kind: "audio", elapsedMs: 0, byteOffset: 0, byteLength: AUDIO_BYTES },
            event("result-generated", { type: "sentence-end", sentence: { index: 0, words: WORDS }, original_text: SCRIPT_TEXT, normalized_text: SCRIPT_TEXT }),
            event("task-finished"),
          ],
        };
      },
    },
  });
}

function writeJson(outputDir: string, filename: string, value: unknown) {
  writeFileSync(resolve(outputDir, filename), JSON.stringify(value, null, 2), "utf8");
}

async function untilDone(app: AppInstance, runId: string) {
  for (let index = 0; index < 200; index++) {
    const run = await app.generationRunRepository.getRunById(runId);
    if (run && run.status !== "pending_dispatch" && run.status !== "running") return run;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
  }
  throw new Error("smoke_dispatch_timeout");
}

function auth(userId: string): AuthContext {
  return { userId, username: userId, displayName: userId, role: "USER", sessionId: "smoke", anonymous: false } as AuthContext;
}

async function inject(app: AppInstance, request: { method: string; url: string; auth?: AuthContext; payload?: unknown }) {
  return app.inject({ method: request.method, url: request.url, auth: request.auth ?? auth("u"), payload: request.payload });
}

async function seedTopicAndScript(app: AppInstance, projectId: string, scriptId: string) {
  app.db.topicPackages.set("topic", {
    id: "topic", projectId, title: "切点冒烟", familyLabel: "f", scopeLabel: "s", coreConflict: "守城", strongScene: "城门",
    packagingSeed: "城门", selectedAngle: "选择", canonicalQuotesJson: [], canonicalQuoteIntentsJson: [],
    durationBandJson: { min_sec: 1, max_sec: 5 }, narrativeTensionMapJson: {}, mustIncludeBeatsJson: [], forbiddenExpansionsJson: [],
    riskHintsJson: [], sourceAnchorRefsJson: [], ambiguityNotesJson: [],
  } as never);
  await saveScriptRecord(app.db, {
    id: scriptId, projectId, topicPackageId: "topic", scriptText: SCRIPT_TEXT,
    openingSpan: SCRIPT_TEXT, endingSpan: SCRIPT_TEXT, estimatedDurationSec: 2,
    beatTraceJson: [], quoteTraceJson: [], reviewStatus: "pass",
    validationResultJson: { stage: "script_local_validation", decision: "pass", errors: [], warnings: [], metrics: {} },
    semanticReviewResultJson: null, executionStateJson: null,
  });
}

function makeAssetPlanV2(input: {
  projectId: string; scriptId: string; storyboardRecordId: string;
  storyboard: StoryboardPlan & { plan_version: "storyboard_v2" };
  narrationReference: { narration_record_id: string; audio_hash: string; timing_map_hash: string; duration_ms: number };
}): AssetPlanV2 {
  return {
    plan_version: "asset_plan_v2",
    source_storyboard_record_id: input.storyboardRecordId,
    source_script_record_id: input.scriptId,
    source_topic_package_id: "topic",
    art_bible: { era_style: "ancient court", visual_tone: "tense", characters: [], locations: [], props: [], global_prompt_prefix: "ancient Chinese historical short video", global_negative_prompts: [], consistency_notes: [] },
    visual_budget: {},
    downgrade_policy: {},
    global_audio_strategy: {},
    narration_reference: input.narrationReference,
    narration_intervals: input.storyboard.segments.map((segment) => ({
      segment_id: segment.segment_id,
      range: {
        start_boundary_id: (segment as unknown as { start_boundary_id: string }).start_boundary_id,
        end_boundary_id: (segment as unknown as { end_boundary_id: string }).end_boundary_id,
        source_start: (segment as unknown as { source_start: number }).source_start,
        source_end: (segment as unknown as { source_end: number }).source_end,
        visual_start_ms: (segment as unknown as { visual_start_ms: number }).visual_start_ms,
        visual_end_ms: (segment as unknown as { visual_end_ms: number }).visual_end_ms,
      },
    })),
    tasks: input.storyboard.segments.map((segment, index) => ({
      task_id: `img_${index}`,
      order: index,
      task_type: "image_still",
      source_segment_id: segment.segment_id,
      source_excerpt: segment.script_excerpt,
      production_intent: "Create the segment anchor image.",
      recommended_mode: "auto",
      provider_hint: "fake_image",
      prompt_draft: "Ancient court, tense confrontation.",
      parameters: { narration_range: { startMs: (segment as unknown as { visual_start_ms: number }).visual_start_ms, endMs: (segment as unknown as { visual_end_ms: number }).visual_end_ms } },
      manual_upload_policy: { allowed: false, required: false, accepted_file_types: [], acceptance_notes: [] },
      risk_notes: ["烟雾中确定性图生成"],
      cost_tier: "low",
      initial_status: "planned",
    })),
    dependencies: [],
    cost_summary: {
      total_tasks: input.storyboard.segments.length,
      by_type: { image_still: input.storyboard.segments.length },
      by_cost_tier: { low: input.storyboard.segments.length },
      estimated_provider_calls: input.storyboard.segments.length,
      notes: [],
    },
    global_production_notes: [],
  } as AssetPlanV2;
}

export async function runNarrationFirstRuntimeSmoke(input: { outputDir?: string } = {}): Promise<NarrationFirstRuntimeSmokeResult> {
  // 冒烟 fail-closed：带真实供应商凭据的环境一律拒绝运行，保证零付费调用不依赖环境运气。
  if (process.env.ALIYUN_DASHSCOPE_API_KEY) throw new Error("narration_smoke_refuses_real_dashscope_credentials");
  // 与后端 stub 闸门同构：任何非 stub 值（openai/deepseek/zhipu 等）均进入真实 LLM 路由，一律拒绝。
  if ((process.env.LLM_PROVIDER ?? "stub") !== "stub") throw new Error("narration_smoke_refuses_real_llm_credentials");
  const outputDir = input.outputDir ?? mkdtempSync(join(tmpdir(), "narration-first-smoke-"));
  mkdirSync(outputDir, { recursive: true });
  const storageBaseDir = join(outputDir, "storage");
  mkdirSync(storageBaseDir, { recursive: true });
  const calls = { count: 0 };
  const app = buildApp({ skipSnapshotLoad: true, storageBaseDir, narrationFirstEnabled: true, narrationProvider: syntheticProvider(calls) });
  for (const model of buildPricingCatalogSeed({ llm: { mode: "stub" }, media: { deploymentScope: "cn-beijing" } })) {
    app.db.providerModelCatalog.set(model.id, model);
  }
  await seedGlobalVoiceProfiles(app.db);
  const checks: Record<string, string> = {};

  // 1) 真实创建路由 + narration_selection（narration_first_v1）
  const created = await inject(app, {
    method: "POST", url: "/api/projects",
    payload: { name: "口播冒烟", narration_selection: { provider_model_id: policy.default_provider_model_id, voice_profile_id: policy.default_voice_profile_id, policy_version: policy.policy_version } },
  });
  if (created.statusCode !== 200 && created.statusCode !== 201) throw new Error(`create_project_failed:${created.statusCode}:${JSON.stringify(created.json())}`);
  const projectId = (created.json() as { project_id: string }).project_id;
  const project = app.db.projects.get(projectId);
  if (!project) throw new Error("project_missing_after_create");
  if (project.narrationTimingMode !== "narration_first_v1") throw new Error("narration_mode_not_applied_on_create");
  await seedTopicAndScript(app, projectId, "s");
  project.activeScriptRecordId = "s";
  project.activeTopicPackageId = "topic";

  // 2) 真实文案确认
  const scriptHash = narrationTextHash(SCRIPT_TEXT);
  const confirmScript = await inject(app, { method: "POST", url: `/api/projects/${projectId}/script/s/confirm`, payload: { source_text_sha256: scriptHash } });
  if (confirmScript.statusCode !== 200) throw new Error(`script_confirm_failed:${confirmScript.statusCode}`);

  // 3) 真实口播生成（原生 timing fixture）→ 确认
  const config = await getProjectGenerationConfiguration(app.db, projectId);
  const generate = await inject(app, {
    method: "POST", url: `/api/projects/${projectId}/script/narration/generate`,
    payload: { source_script_record_id: "s", expected_configuration_revision: config.revision, idempotency_key: "smoke-narration" },
  });
  if (generate.statusCode !== 202) throw new Error(`narration_generate_failed:${generate.statusCode}:${JSON.stringify(generate.json())}`);
  const generateBody = generate.json() as { generation_run_id: string; narration_record_id: string };
  const run = await untilDone(app, generateBody.generation_run_id);
  if (run.status !== "succeeded") throw new Error(`narration_run_${run.status}`);
  const narrationRecordId = generateBody.narration_record_id;
  const narrationRecord = app.db.narrationRecords.get(narrationRecordId);
  if (!narrationRecord?.output) throw new Error("narration_output_missing");
  checks["narration_timing_source"] = narrationRecord.timingSource;
  if (calls.count !== 1) throw new Error(`narration_tts_calls_expected_1_got_${calls.count}`);

  const confirm = await inject(app, {
    method: "POST", url: `/api/projects/${projectId}/script/narrations/${narrationRecordId}/confirm`,
    payload: {
      source_text_sha256: narrationRecord.sourceTextSha256,
      settings_sha256: narrationRecord.settingsSha256,
      expected_active_narration_record_id: null,
      target_duration_band_snapshot: { minMs: 1000, maxMs: 5000 },
      accept_duration_outside_band: true,
    },
  });
  if (confirm.statusCode !== 200) throw new Error(`narration_confirm_failed:${confirm.statusCode}:${JSON.stringify(confirm.json())}`);

  // 4) 真实分镜生成（stub 确定性 narration v2）
  const storyboard = await inject(app, { method: "POST", url: `/api/projects/${projectId}/storyboard/generate`, payload: {} });
  if (storyboard.statusCode !== 202 && storyboard.statusCode !== 200) throw new Error(`storyboard_generate_failed:${storyboard.statusCode}:${JSON.stringify(storyboard.json())}`);
  const storyboardBody = storyboard.json() as { generation_run_id?: string; storyboard_record_id?: string };
  if (storyboardBody.generation_run_id) {
    const storyboardRun = await untilDone(app, storyboardBody.generation_run_id);
    if (storyboardRun.status !== "succeeded") throw new Error(`storyboard_run_${storyboardRun.status}`);
  }
  const projectAfterStoryboard = app.db.projects.get(projectId)!;
  const storyboardRecordId = projectAfterStoryboard.activeStoryboardRecordId;
  if (!storyboardRecordId) throw new Error("storyboard_not_activated");
  const storyboardRecord = app.db.storyboardRecords.get(storyboardRecordId);
  const plan = storyboardRecord?.planJson as StoryboardPlan & { plan_version: "storyboard_v2" } | undefined;
  if (!plan || plan.plan_version !== "storyboard_v2") throw new Error("storyboard_not_v2");

  // 4a) 合法切点：timing 边界含第 6 字后 1500ms 的字级切点（不机械按桶）；分镜段无缝覆盖全篇
  const bundleStorage = narrationStorage(app, project);
  const timingBytes = await bundleStorage.readFile({ record: narrationRecord, kind: "timing" });
  const timingMap = JSON.parse(timingBytes.toString("utf8")) as { boundaries?: Array<{ sourceOffset: number; visualTimeMs: number }> };
  const wordLevelCut = (timingMap.boundaries ?? []).find((boundary) => boundary.sourceOffset === 6 && boundary.visualTimeMs === 1500);
  if (!wordLevelCut) throw new Error("word_level_cut_missing");
  checks["word_level_cut_1500ms"] = "legal";
  const narrationReference = plan.narration_reference;
  checks["narration_duration_ms"] = String(narrationReference.duration_ms);
  if (narrationReference.duration_ms !== DURATION_MS) throw new Error("narration_duration_mismatch");
  const firstSegment = plan.segments[0] as unknown as { visual_start_ms: number };
  const lastSegment = plan.segments.at(-1) as unknown as { visual_end_ms: number };
  if (firstSegment.visual_start_ms !== 0 || lastSegment.visual_end_ms !== DURATION_MS) throw new Error("storyboard_not_covering_full_duration");
  const segmentSum = plan.segments.reduce((sum, segment) => sum + ((segment as unknown as { visual_end_ms: number }).visual_end_ms - (segment as unknown as { visual_start_ms: number }).visual_start_ms), 0);
  if (segmentSum !== DURATION_MS) throw new Error("segment_sum_mismatch");
  checks["storyboard_segment_count"] = String(plan.segments.length);

  // 5) 资产计划 v2：fixture 直写 + 真实 validateAssetPlan 本地校验覆盖（生成路由/intent compiler 由 9C 测试与 Task12-B 覆盖，此处声明不冒充全链路真实生成）
  const assetPlanRecordId = `asset_plan_narration_smoke_${app.db.generateId()}`;
  const assetPlan = makeAssetPlanV2({ projectId, scriptId: "s", storyboardRecordId, storyboard: plan, narrationReference });
  await saveAssetPlanRecord(app.db, {
    id: assetPlanRecordId, projectId, topicPackageId: "topic", scriptRecordId: "s", storyboardRecordId,
    planJson: assetPlan as never,
    validationResultJson: { stage: "asset_planning_local_validation", decision: "pass", errors: [], warnings: [], metrics: {} },
    executionStateJson: { regenerate_used: false }, graphTraceSummaryJson: null, runtimeDiagnosticsJson: null,
  });
  const planValidation = validateAssetPlan({ storyboardRecordId, scriptRecordId: "s", topicPackageId: "topic", storyboard: plan, scriptText: SCRIPT_TEXT, plan: assetPlan, narrationTiming: { timingMap, narrationReference } });
  if (planValidation.decision !== "pass") throw new Error(`asset_plan_validation_failed:${JSON.stringify(planValidation.errors)}`);
  projectAfterStoryboard.activeAssetPlanRecordId = assetPlanRecordId;
  projectAfterStoryboard.status = "asset_plan_ready";

  // 6) 真实资产生成（fake 图）→ 断言零新 TTS、零 ASR 任务
  const assets = await inject(app, { method: "POST", url: `/api/projects/${projectId}/assets/generate`, payload: {} });
  if (assets.statusCode !== 202 && assets.statusCode !== 200) {
    const failure = [...app.db.generationRunEvents.values()].flat().filter((event) => event.eventType === "dispatch_failed").at(-1);
    throw new Error(`assets_generate_failed:${assets.statusCode}:${JSON.stringify((failure?.eventJson as { message?: unknown })?.message ?? assets.json())}`);
  }
  if (calls.count !== 1) throw new Error(`assets_reused_tts_calls_expected_1_got_${calls.count}`);
  const projectAfterAssets = app.db.projects.get(projectId)!;
  const assetManifestRecordId = projectAfterAssets.activeAssetManifestRecordId;
  if (!assetManifestRecordId) throw new Error("manifest_not_activated");
  const manifestRecord = app.db.assetManifestRecords.get(assetManifestRecordId)!;
  const manifest = manifestRecord.manifestJson as { narration_reference?: { duration_ms: number }; segment_routes?: Array<{ narrationRange: { startMs: number; endMs: number } }> };
  if (!manifest.narration_reference || manifest.narration_reference.duration_ms !== DURATION_MS) throw new Error("manifest_narration_reference_mismatch");
  const routeSum = (manifest.segment_routes ?? []).reduce((sum, route) => sum + (route.narrationRange.endMs - route.narrationRange.startMs), 0);
  if (routeSum !== DURATION_MS) throw new Error("manifest_route_sum_mismatch");
  const fullManifest = manifestRecord.manifestJson as { audio_summary?: { tts_chunk_artifact_ids?: unknown[]; tts_merged_artifact_id?: string }; segment_routes?: Array<{ tts_artifact_id?: string }> };
  if ((fullManifest.audio_summary?.tts_chunk_artifact_ids ?? []).length !== 0) throw new Error("unexpected_chunk_artifacts");
  const mergedId = fullManifest.audio_summary?.tts_merged_artifact_id;
  if (!mergedId || (fullManifest.segment_routes ?? []).some((route) => route.tts_artifact_id !== mergedId)) throw new Error("segment_route_not_global_narration");
  const manifestArtifacts = (fullManifest as unknown as { artifacts?: Array<{ artifact_id: string; artifact_type?: string; metadata?: Record<string, unknown> }> }).artifacts ?? [];
  const subtitleArtifacts = manifestArtifacts.filter((artifact) => artifact.artifact_type === "subtitle_track");
  if (!assertNoAsrAlignment(subtitleArtifacts)) throw new Error("asr_unexpected_in_narration_first");
  checks["asr_checked_subtitle_artifacts"] = String(subtitleArtifacts.length);
  const nonFakeJobs = [...app.db.assetProviderJobRecords.values()].filter((job) => job.providerName !== "fake_image");
  if (nonFakeJobs.length > 0) throw new Error(`non_fake_provider_jobs:${nonFakeJobs.map((job) => job.providerName).join(",")}`);
  checks["assets_provider"] = "fake_image_only";
  checks["asr_zero"] = "subtitle_timing_not_forced_alignment";
  checks["manifest_narration_reference"] = "matched";
  const manifestDecision = String(manifestRecord.validationResultJson?.decision ?? "");
  if (manifestDecision === "partial") {
    manifestRecord.manifestJson = { ...manifestRecord.manifestJson, readiness: "ready_for_compose" };
  } else if (manifestDecision !== "ready_for_compose") {
    throw new Error(`manifest_decision_unexpected:${manifestDecision}`);
  }

  // 7) 资产重试 → 仍零新 TTS
  const assetsRetry = await inject(app, { method: "POST", url: `/api/projects/${projectId}/assets/generate`, payload: {} });
  if (assetsRetry.statusCode !== 202 && assetsRetry.statusCode !== 200) throw new Error(`assets_retry_failed:${assetsRetry.statusCode}`);
  if (calls.count !== 1) throw new Error(`assets_retry_tts_calls_expected_1_got_${calls.count}`);

  // 8) 合成（v2 时间轴同源）
  const compose = await inject(app, { method: "POST", url: `/api/projects/${projectId}/compose/generate`, payload: {} });
  if (compose.statusCode !== 202 && compose.statusCode !== 200) throw new Error(`compose_generate_failed:${compose.statusCode}:${JSON.stringify(compose.json())}`);
  const projectAfterCompose = app.db.projects.get(projectId)!;
  const composeRecordId = projectAfterCompose.activeComposeRecordId;
  if (!composeRecordId) throw new Error("compose_not_activated");
  const composeRecord = app.db.composeRecords.get(composeRecordId)!;
  const timeline = composeRecord.timelineJson as { narration_reference?: { duration_ms: number; audio_hash: string }; timeline_version?: string };
  if (timeline.narration_reference?.duration_ms !== DURATION_MS) throw new Error("compose_timeline_narration_mismatch");
  if (timeline.narration_reference.audio_hash !== narrationReference.audio_hash) throw new Error("compose_timeline_hash_mismatch");
  checks["compose_timeline_version"] = String(timeline.timeline_version);

  // 9) 字幕样式变更 → 新 revision、历史保留、合成失效
  const initialSubtitleRevisionId = projectAfterCompose.activeNarrationSubtitleRevisionId;
  const configRecord = findProjectConfigRecord(app.db, projectId);
  if (!configRecord || !initialSubtitleRevisionId) throw new Error("subtitle_revision_missing");
  const changedConfig = structuredClone(configRecord.configurationJson);
  changedConfig.creative.subtitle_style_preset_id = "subtitle_style_bold_stroke";
  const saveConfig = await inject(app, {
    method: "PATCH", url: `/api/projects/${projectId}/generation-configuration`,
    payload: { expected_revision: configRecord.revision, video: changedConfig.video, creative: changedConfig.creative, capabilities: changedConfig.capabilities },
  });
  if (saveConfig.statusCode !== 200) throw new Error(`config_save_failed:${saveConfig.statusCode}:${JSON.stringify(saveConfig.json())}`);
  const saveBody = saveConfig.json() as { subtitle_update?: { status: string } };
  if (saveBody.subtitle_update && saveBody.subtitle_update.status !== "ready") throw new Error(`subtitle_update_not_ready:${JSON.stringify(saveBody.subtitle_update)}`);
  const projectAfterSubtitle = app.db.projects.get(projectId)!;
  const newSubtitleRevisionId = projectAfterSubtitle.activeNarrationSubtitleRevisionId;
  if (!newSubtitleRevisionId || newSubtitleRevisionId === initialSubtitleRevisionId) throw new Error("subtitle_revision_not_derived");
  if (!app.db.narrationSubtitleRevisions.has(initialSubtitleRevisionId)) throw new Error("historical_subtitle_revision_lost");
  if (projectAfterSubtitle.activeComposeRecordId !== null) throw new Error("compose_not_invalidated_on_subtitle_change");
  checks["subtitle_revision_derived"] = `${initialSubtitleRevisionId}->${newSubtitleRevisionId}`;
  checks["compose_invalidated_on_subtitle_change"] = "yes";

  // 10a) 字幕变更后重建合成（消费新 revision 的 manifest）
  const composeAfterSubtitle = await inject(app, { method: "POST", url: `/api/projects/${projectId}/compose/generate`, payload: {} });
  if (composeAfterSubtitle.statusCode !== 202 && composeAfterSubtitle.statusCode !== 200) throw new Error(`compose_regenerate_failed:${composeAfterSubtitle.statusCode}:${JSON.stringify(composeAfterSubtitle.json())}`);
  const projectAfterComposeRegen = app.db.projects.get(projectId)!;
  if (!projectAfterComposeRegen.activeComposeRecordId) throw new Error("compose_not_reactivated");

  // 10b) 渲染（fake adapter，本地落盘）
  const render = await inject(app, { method: "POST", url: `/api/projects/${projectId}/render/generate`, payload: {} });
  if (render.statusCode !== 202 && render.statusCode !== 200) throw new Error(`render_generate_failed:${render.statusCode}:${JSON.stringify(render.json())}`);
  const renderBody = render.json() as { generation_run_id?: string };
  if (renderBody.generation_run_id) {
    const renderRun = await untilDone(app, renderBody.generation_run_id);
    if (renderRun.status !== "succeeded") throw new Error(`render_run_${renderRun.status}`);
  }
  const projectAfterRender = app.db.projects.get(projectId)!;
  const renderJobRecordId = projectAfterRender.activeRenderJobRecordId;
  if (!renderJobRecordId) throw new Error("render_not_activated");
  const renderRecord = app.db.renderJobRecords.get(renderJobRecordId)!;
  const outputArtifact = renderRecord.outputArtifactJson as { file_uri?: string; artifact_type?: string } | null | undefined;
  if (!outputArtifact?.file_uri || !existsSync(join(project.storageRootDir, outputArtifact.file_uri))) throw new Error("render_output_missing");
  checks["render_artifact_type"] = String(outputArtifact.artifact_type);

  // 11) legacy 并存：legacy 项目真实分镜生成（v1），不新增口播合成
  const legacyProject = await createLegacyProject(app.db, { name: "legacy-并存", ownerId: "u" });
  legacyProject.storageRootDir = join(storageBaseDir, "legacy");
  const legacyScript = await saveScriptRecord(app.db, {
    projectId: legacyProject.id, topicPackageId: "topic", scriptText: "他打开城门。", openingSpan: "他打开城门。", endingSpan: "他打开城门。",
    estimatedDurationSec: 2, beatTraceJson: [], quoteTraceJson: [], reviewStatus: "pass",
    validationResultJson: { stage: "script_local_validation", decision: "pass", errors: [], warnings: [], metrics: {} },
    semanticReviewResultJson: null, executionStateJson: null,
  });
  legacyProject.activeScriptRecordId = legacyScript.id;
  app.db.topicPackages.set("legacy-topic", {
    id: "legacy-topic", projectId: legacyProject.id, title: "legacy", familyLabel: "f", scopeLabel: "s", coreConflict: "守城",
    strongScene: "城门", packagingSeed: "城门", selectedAngle: "选择", canonicalQuotesJson: [], canonicalQuoteIntentsJson: [],
    durationBandJson: { min_sec: 1, max_sec: 5 }, narrativeTensionMapJson: {}, mustIncludeBeatsJson: [], forbiddenExpansionsJson: [],
    riskHintsJson: [], sourceAnchorRefsJson: [], ambiguityNotesJson: [],
  } as never);
  const legacyStoryboard = await inject(app, { method: "POST", url: `/api/projects/${legacyProject.id}/storyboard/generate`, payload: {} });
  if (legacyStoryboard.statusCode !== 202 && legacyStoryboard.statusCode !== 200) throw new Error(`legacy_storyboard_failed:${legacyStoryboard.statusCode}`);
  if (legacyStoryboard.json().generation_run_id) {
    const legacyRun = await untilDone(app, legacyStoryboard.json().generation_run_id);
    if (legacyRun.status !== "succeeded") throw new Error(`legacy_storyboard_run_${legacyRun.status}`);
  }
  const legacyProjectAfter = app.db.projects.get(legacyProject.id)!;
  const legacyStoryboardRecordId = legacyProjectAfter.activeStoryboardRecordId;
  const legacyPlan = app.db.storyboardRecords.get(legacyStoryboardRecordId ?? "")?.planJson as { plan_version?: string } | undefined;
  if (legacyPlan?.plan_version !== "storyboard_v1") throw new Error("legacy_plan_not_v1");
  if (calls.count !== 1) throw new Error(`legacy_tts_calls_expected_1_got_${calls.count}`);
  checks["legacy_coexistence"] = "v1_plan_ok";

  const result: NarrationFirstRuntimeSmokeResult = {
    outputDir, passed: true, projectId, narrationRecordId, storyboardRecordId, assetManifestRecordId,
    composeRecordId, renderJobRecordId, narrationSynthesizeCalls: calls.count,
    legacyProjectId: legacyProject.id, legacyStoryboardRecordId, subtitleRevisions: [initialSubtitleRevisionId, newSubtitleRevisionId],
    asrCheckedSubtitleArtifacts: Number(checks["asr_checked_subtitle_artifacts"]), checks,
  };
  writeJson(outputDir, "narration-first-runtime-smoke.json", result);
  return result;
}
