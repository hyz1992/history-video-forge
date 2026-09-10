import { mkdir, rm } from "node:fs/promises";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * S2-2C 任务 6（详细设计 §6.2）：媒体执行绑定（快照权威）。
 *
 * - buildProviderRegistry 提供 resolvedCapabilities 时，tts/image/video 三个
 *   DashScope adapter 一律按快照冻结的 model_id 构造（auto/fixed 同源，
 *   mode 只说明选择来源）；缺省走 env 模型（现状回归）。
 * - provider_key 非 dashscope 或固定到未注册/未过 gate 的模型 → 该 adapter
 *   不注册（no-adapter 路径，零外部调用）。
 * - createAssetsDispatchHandler 与 LLM handler 等价（复审整改 P1）：
 *   内存无快照 + DB 有（prisma SQLite 冷镜像）→ 经 repository 恢复执行且
 *   按快照模型构造；内存与 DB 均缺失 → dispatch_snapshot_missing 拒绝派发，
 *   禁止无快照执行/回退 env。
 */

const TOPIC_PACKAGE_ID = "topic_001";
const SCRIPT_RECORD_ID = "script_001";
const STORYBOARD_RECORD_ID = "storyboard_001";
const ASSET_PLAN_RECORD_ID = "asset_plan_001";

/** 快照冻结的媒体模型（目录默认行），与 env 模型刻意不同。 */
const FROZEN_MEDIA = {
  tts: "qwen3-tts-frozen-snapshot",
  image: "wanx2.1-t2i-frozen",
  video: "wan2.7-frozen-i2v",
};

/** env 配置的媒体模型（现状默认）。 */
const ENV_MEDIA = {
  tts: "qwen3-tts-instruct-flash",
  image: "wan2.6-t2i",
  video: "wan2.7-i2v-2026-04-25",
};

const DASHSCOPE_ENV: Record<string, string> = {
  ALIYUN_DASHSCOPE_API_KEY: "test-key",
  ALIYUN_DASHSCOPE_BASE_URL: "https://dashscope.aliyuncs.com",
  ALIYUN_DASHSCOPE_TEXT_TO_IMAGE_MODEL: ENV_MEDIA.image,
  ALIYUN_DASHSCOPE_TTS_MODEL: ENV_MEDIA.tts,
  ALIYUN_DASHSCOPE_IMAGE_TO_VIDEO_MODEL: ENV_MEDIA.video,
};

function injectDashscopeEnv() {
  for (const [key, value] of Object.entries(DASHSCOPE_ENV)) {
    vi.stubEnv(key, value);
  }
}

import { buildApp } from "../../../backend/src/app.js";
import { createDbClient } from "../../../backend/src/db/client.js";
import type { DbClient, GenerationRunRecord, ProjectRecord } from "../../../backend/src/db/client.js";
import { createPrismaClient } from "../../../backend/src/db/prisma-client.js";
import { PrismaThirdAggregateWriter } from "../../../backend/src/db/repositories/prisma-third-aggregate-writer.js";
import { applyAllDatabaseMigrations } from "../db/migration-test-utils.js";
import { createLegacyProject as createProject } from "../projects/legacy-project.fixture.js";
import { buildProviderRegistry, createAssetsDispatchHandler } from "../../../backend/src/modules/assets/assets-run.service.js";
import { buildPricingCatalogSeed } from "../../../backend/src/modules/generation-cost/pricing-catalog.seed.js";
import { createGenerationRunRepository } from "../../../backend/src/modules/generation-run/generation-run.repository.js";
import type { GenerationRunRepository } from "../../../backend/src/modules/generation-run/generation-run.repository.js";
import { createOrRestoreGenerationRun } from "../../../backend/src/modules/generation-run/generation-run.service.js";
import { seedGlobalVoiceProfiles } from "../../../backend/src/modules/assets/voice/voice-profile.repository.js";
import type { GenerationCapabilityReadinessInput } from "../../../backend/src/modules/generation-cost/generation-capability-readiness.js";
import type { AssetPlan, ResolvedCapabilityMap, StoryboardPlan } from "../../../shared/src/index.js";

const scriptText = "Narration for segment one. A tense hall waits for the answer.";

function makeStoryboardPlan(): StoryboardPlan {
  return {
    plan_version: "storyboard_v1",
    source_script_record_id: SCRIPT_RECORD_ID,
    source_topic_package_id: TOPIC_PACKAGE_ID,
    estimated_total_duration_sec: 12,
    segments: [
      {
        segment_id: "sb_001",
        order: 0,
        script_excerpt: scriptText,
        start_hint_sec: 0,
        end_hint_sec: 12,
        narrative_role: "opening",
        visual_intent: "A tense hall.",
        scene_description: "A public hall.",
        visual_elements: ["envoy"],
        framing_hint: "medium",
        content_type: "live_action",
        motion_hint: "push_in",
        editing_hint: "single",
        on_screen_text: [],
        linked_beats: [],
        linked_quotes: [],
        risk_notes: [],
        api_video_suitability: "remotion_sufficient",
      },
    ],
    global_visual_notes: [],
  };
}

function makeAssetPlan(): AssetPlan {
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
      // 系统就绪音色（provider_voice_id 预置）：提交路径不需要音色设计调用
      voice_profile_id: "voice_system_ethan",
      estimated_total_duration_sec: 12,
      chunking_strategy: "segment_boundary",
      chunks: [
        { chunk_id: "tts_001", order: 0, script_excerpt: scriptText, estimated_duration_sec: 12 },
      ],
    },
    tasks: [
      {
        task_id: "tts_001",
        order: 0,
        task_type: "tts_audio",
        source_segment_id: null,
        source_excerpt: scriptText,
        production_intent: "Generate narration audio.",
        recommended_mode: "auto",
        provider_hint: "fake_tts",
        prompt_draft: null,
        parameters: { voice_profile_id: "voice_system_ethan" },
        manual_upload_policy: { allowed: false, required: false, accepted_file_types: [], acceptance_notes: [] },
        risk_notes: [],
        cost_tier: "low",
        initial_status: "planned",
      },
      {
        task_id: "img_001",
        order: 1,
        task_type: "image_still",
        source_segment_id: "sb_001",
        source_excerpt: scriptText,
        production_intent: "A tense hall.",
        recommended_mode: "auto",
        provider_hint: "fake_image",
        prompt_draft: "A tense hall, envoy answering.",
        parameters: {},
        manual_upload_policy: { allowed: false, required: false, accepted_file_types: [], acceptance_notes: [] },
        risk_notes: [],
        cost_tier: "low",
        initial_status: "planned",
      },
      {
        task_id: "motion_001",
        order: 2,
        task_type: "render_motion_cue",
        source_segment_id: "sb_001",
        source_excerpt: scriptText,
        production_intent: "Slow push in.",
        recommended_mode: "auto",
        provider_hint: null,
        prompt_draft: null,
        parameters: { recipe_type: "slow_push_in" },
        manual_upload_policy: { allowed: false, required: false, accepted_file_types: [], acceptance_notes: [] },
        risk_notes: [],
        cost_tier: "low",
        initial_status: "planned",
      },
    ],
  };
}

/** Map 态项目 + storyboard/asset plan 记录 + 活动指针（与 paid-gate 测试同模式）。 */
async function prepareProjectWithAssetPlan(db: DbClient): Promise<ProjectRecord> {
  const project = await createProject(db, { name: "media binding test", ownerId: "owner-1" });
  project.activeStoryboardRecordId = STORYBOARD_RECORD_ID;
  project.activeAssetPlanRecordId = ASSET_PLAN_RECORD_ID;
  project.status = "asset_plan_ready";
  const now = new Date();
  db.storyboardRecords.set(STORYBOARD_RECORD_ID, {
    id: STORYBOARD_RECORD_ID,
    projectId: project.id,
    topicPackageId: TOPIC_PACKAGE_ID,
    scriptRecordId: SCRIPT_RECORD_ID,
    planJson: makeStoryboardPlan() as unknown as Record<string, unknown>,
    validationResultJson: {},
    executionStateJson: null,
    graphTraceSummaryJson: null,
    runtimeDiagnosticsJson: null,
    createdAt: now,
  });
  db.assetPlanRecords.set(ASSET_PLAN_RECORD_ID, {
    id: ASSET_PLAN_RECORD_ID,
    projectId: project.id,
    topicPackageId: TOPIC_PACKAGE_ID,
    scriptRecordId: SCRIPT_RECORD_ID,
    storyboardRecordId: STORYBOARD_RECORD_ID,
    planJson: makeAssetPlan(),
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
    createdAt: now,
  });
  return project;
}

/** 项目配置固定到系统就绪音色（执行与报价同源，避免音色设计外部调用）。 */
function setProjectFixedVoice(db: DbClient, projectId: string): void {
  for (const record of db.projectGenerationConfigurations.values()) {
    if (record.projectId === projectId) {
      record.configurationJson = {
        ...record.configurationJson,
        creative: {
          voice_profile_id: "voice_system_ethan",
          art_style_preset_id: null,
          subtitle_style_preset_id: null,
          subtitle_style_overrides: {},
        },
      };
      return;
    }
  }
  throw new Error(`project config not found for ${projectId}`);
}

/** 五槽 resolved_capabilities：媒体三槽按给定 mode/模型构造。 */
function makeResolvedCapabilities(media: {
  mode: "auto" | "fixed";
  tts: string;
  image: string;
  video: string;
}): ResolvedCapabilityMap {
  return {
    "llm.smart": { mode: "auto", provider_model_id: "llm.smart.dashscope.qwen", provider_key: "dashscope", model_id: "qwen-max" },
    "llm.flash": { mode: "auto", provider_model_id: "llm.flash.dashscope.qwen", provider_key: "dashscope", model_id: "qwen-flash" },
    "image.generate": { mode: media.mode, provider_model_id: "img", provider_key: "dashscope", model_id: media.image },
    "video.image_to_video": { mode: media.mode, provider_model_id: "vid", provider_key: "dashscope", model_id: media.video },
    "tts.synthesize": { mode: media.mode, provider_model_id: "tts", provider_key: "dashscope", model_id: media.tts },
  };
}

/** 目录种入 FROZEN 媒体模型行（active + isDefault，与 env 模型不同）。 */
function seedCatalogWithFrozenMedia(db: DbClient) {
  const seed = buildPricingCatalogSeed({
    llm: { mode: "stub" },
    media: { deploymentScope: "cn-beijing" },
  });
  const frozenByCapability: Record<string, string> = {
    "tts.synthesize": FROZEN_MEDIA.tts,
    "image.generate": FROZEN_MEDIA.image,
    "video.image_to_video": FROZEN_MEDIA.video,
  };
  for (const entry of seed) {
    const frozen = frozenByCapability[entry.capability as string];
    db.providerModelCatalog.set(entry.id, frozen ? { ...entry, modelId: frozen } : entry);
  }
}

/** 目录种入 env 媒体模型行（bootstrap 现状产物）。 */
function seedCatalogWithEnvMedia(db: DbClient) {
  const seed = buildPricingCatalogSeed({
    llm: { mode: "stub" },
    media: { deploymentScope: "cn-beijing" },
  });
  for (const entry of seed) {
    db.providerModelCatalog.set(entry.id, entry);
  }
}

/** 与 FROZEN 目录一致的可报价 readiness（catalog 与 registeredModels 精确匹配）。 */
function buildFrozenMediaReadiness(): GenerationCapabilityReadinessInput {
  return {
    llm: { mode: "stub" },
    media: {
      registeredModels: [
        { capability: "image.generate", providerKey: "dashscope", modelId: FROZEN_MEDIA.image },
        { capability: "video.image_to_video", providerKey: "dashscope", modelId: FROZEN_MEDIA.video },
        { capability: "tts.synthesize", providerKey: "dashscope", modelId: FROZEN_MEDIA.tts },
      ],
      credentialConfigured: true,
      deploymentScope: "cn-beijing",
    },
    environment: { testEnv: false },
  };
}

/** 2026-08-23（报价体系移除）：直连创建 GenerationRun（付费执行上下文）。 */
async function createQuoteBoundAssetsRun(
  app: ReturnType<typeof buildApp>,
  project: ProjectRecord,
  key: string,
  repository: GenerationRunRepository = createGenerationRunRepository(app.db),
) {
  const submit = await createOrRestoreGenerationRun(
    app.db, project, project.ownerId,
    {
      operation: "assets.generate",
      idempotencyKey: key,
      selection: { task_ids: [] },
      dispatchPayload: { execution_mode: "auto_available" },
    },
    { readinessInput: buildFrozenMediaReadiness(), repository },
  );
  if (!submit.ok) throw new Error(`submit failed: ${JSON.stringify(submit.error)}`);
  return { run: submit.value.run, snapshotId: submit.value.snapshot.id };
}

/** DashScope TTS + image 的最小 fetch mock（tts 含音频下载，image 含提交/轮询/下载）。 */
function stubDashscopeFetch() {
  const fetchMock = vi.fn(async (url: string | URL) => {
    const urlText = String(url);
    if (urlText.endsWith("/api/v1/services/aigc/multimodal-generation/generation")) {
      return new Response(
        JSON.stringify({ output: { audio: { url: "https://example.test/audio.wav" } } }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (
      urlText.endsWith("/api/v1/services/aigc/image-generation/generation") ||
      urlText.endsWith("/api/v1/services/aigc/text2image/image-synthesis")
    ) {
      return new Response(
        JSON.stringify({ output: { task_id: "task_dashscope_image_001" } }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (urlText.endsWith("/api/v1/tasks/task_dashscope_image_001")) {
      return new Response(
        JSON.stringify({
          output: { task_status: "SUCCEEDED", results: [{ url: "https://example.test/image.png" }] },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (urlText === "https://example.test/audio.wav") {
      return new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 200,
        headers: { "content-type": "audio/wav" },
      });
    }
    if (urlText === "https://example.test/image.png") {
      return new Response(new Uint8Array([137, 80, 78, 71]), {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    }
    throw new Error(`unexpected fetch: ${urlText}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Prisma SQLite 冷镜像环境（用户/项目行 + FROZEN 目录 + 音色 seed）。 */
async function setupPrismaEnv() {
  const root = mkdtempSync(join(tmpdir(), "svf2-media-cold-"));
  const path = join(root, "test.db");
  const sqlite = new Database(path);
  applyAllDatabaseMigrations(sqlite);
  sqlite.close();
  const client = await createPrismaClient(path);
  const app = buildApp({
    storageBaseDir: root,
    prismaClient: client,
    thirdAggregateWriter: new PrismaThirdAggregateWriter(client),
    generationQuoteReadinessInput: buildFrozenMediaReadiness(),
    skipSnapshotLoad: true,
  });
  seedCatalogWithFrozenMedia(app.db);
  await seedGlobalVoiceProfiles(app.db);
  const project = await prepareProjectWithAssetPlan(app.db);
  setProjectFixedVoice(app.db, project.id);
  await client.user.create({
    data: {
      id: "owner-1",
      username: "owner-1",
      displayName: "Owner",
      passwordHash: "x",
      role: "USER",
    },
  });
  await client.project.create({
    data: {
      id: project.id,
      ownerId: "owner-1",
      createdById: "owner-1",
      name: "Media Cold Recovery",
      status: project.status,
      storageKey: `p-${project.id}`,
      storageDisplayName: "Media Cold Recovery",
    },
  });
  // 执行路径会经 aggregate writer 落库 manifest，外键链需要四类记录行
  const now = new Date();
  await client.topicPackage.create({
    data: {
      id: TOPIC_PACKAGE_ID,
      projectId: project.id,
      eventRegistryEntryId: null,
      title: "Media Binding Topic",
      selectedAngle: "A public answer reverses the pressure.",
      familyLabel: "diplomacy",
      scopeLabel: "single_event",
      coreConflict: "The envoy must answer in front of everyone.",
      strongScene: "The hall falls quiet.",
      stakes: null,
      packagingSeed: "One sentence changes the room.",
      canonicalQuotesJson: [],
      canonicalQuoteIntentsJson: [],
      durationBandJson: { label: "medium" },
      narrativeTensionMapJson: {},
      mustIncludeBeatsJson: [],
      forbiddenExpansionsJson: [],
      riskHintsJson: [],
      sourceAnchorRefsJson: [],
      ambiguityNotesJson: [],
      createdAt: now,
    },
  });
  await client.scriptRecord.create({
    data: {
      id: SCRIPT_RECORD_ID,
      projectId: project.id,
      topicPackageId: TOPIC_PACKAGE_ID,
      scriptText,
      openingSpan: "Opening pressure.",
      endingSpan: "The ending leaves a cost.",
      estimatedDurationSec: 12,
      beatTraceJson: [],
      quoteTraceJson: [],
      reviewStatus: "approved",
      validationResultJson: null,
      semanticReviewResultJson: null,
      executionStateJson: null,
      graphTraceSummaryJson: null,
      runtimeDiagnosticsJson: null,
      createdAt: now,
    },
  });
  await client.storyboardRecord.create({
    data: {
      id: STORYBOARD_RECORD_ID,
      projectId: project.id,
      topicPackageId: TOPIC_PACKAGE_ID,
      scriptRecordId: SCRIPT_RECORD_ID,
      planJson: makeStoryboardPlan() as never,
      validationResultJson: {},
      executionStateJson: null,
      graphTraceSummaryJson: null,
      runtimeDiagnosticsJson: null,
      createdAt: now,
    },
  });
  await client.assetPlanRecord.create({
    data: {
      id: ASSET_PLAN_RECORD_ID,
      projectId: project.id,
      topicPackageId: TOPIC_PACKAGE_ID,
      scriptRecordId: SCRIPT_RECORD_ID,
      storyboardRecordId: STORYBOARD_RECORD_ID,
      planJson: makeAssetPlan() as never,
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
      createdAt: now,
    },
  });
  // 项目活动指针指向上述记录（activateAssetManifest 校验 activeAssetPlanRecordId 一致）
  await client.project.update({
    where: { id: project.id },
    data: { activeStoryboardRecordId: STORYBOARD_RECORD_ID, activeAssetPlanRecordId: ASSET_PLAN_RECORD_ID },
  });
  return { app, client, project, root };
}

let integrationTempDir = "";

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  if (integrationTempDir) {
    await rm(integrationTempDir, { recursive: true, force: true }).catch(() => {});
    integrationTempDir = "";
  }
});

describe("buildProviderRegistry 按快照模型构造（S2-2C §6.2）", () => {
  it("resolved 提供（fixed）：三个媒体 adapter 使用快照 model（与 env 不同）", () => {
    injectDashscopeEnv();
    const db = createDbClient();
    seedCatalogWithFrozenMedia(db);
    const registry = buildProviderRegistry({
      db,
      resolvedCapabilities: makeResolvedCapabilities({ mode: "fixed", ...FROZEN_MEDIA }),
    });
    expect(
      registry.findAdapter({ taskType: "tts_audio", enabledProviderTypes: ["tts"] })?.billing?.modelId,
    ).toBe(FROZEN_MEDIA.tts);
    expect(
      registry.findAdapter({ taskType: "image_still", enabledProviderTypes: ["image"] })?.billing?.modelId,
    ).toBe(FROZEN_MEDIA.image);
    expect(
      registry.findAdapter({ taskType: "video_clip", enabledProviderTypes: ["video"] })?.billing?.modelId,
    ).toBe(FROZEN_MEDIA.video);
  });

  it("resolved 全 auto：auto 槽位同样按快照冻结模型构造（外部审查 P1 同源）", () => {
    injectDashscopeEnv();
    const db = createDbClient();
    seedCatalogWithFrozenMedia(db);
    const registry = buildProviderRegistry({
      db,
      resolvedCapabilities: makeResolvedCapabilities({ mode: "auto", ...FROZEN_MEDIA }),
    });
    expect(
      registry.findAdapter({ taskType: "tts_audio", enabledProviderTypes: ["tts"] })?.billing?.modelId,
    ).toBe(FROZEN_MEDIA.tts);
    expect(
      registry.findAdapter({ taskType: "image_still", enabledProviderTypes: ["image"] })?.billing?.modelId,
    ).toBe(FROZEN_MEDIA.image);
    expect(
      registry.findAdapter({ taskType: "video_clip", enabledProviderTypes: ["video"] })?.billing?.modelId,
    ).toBe(FROZEN_MEDIA.video);
  });

  it("resolved 缺省：env 模型（现状回归）", () => {
    injectDashscopeEnv();
    const db = createDbClient();
    seedCatalogWithEnvMedia(db);
    const registry = buildProviderRegistry({ db });
    expect(
      registry.findAdapter({ taskType: "tts_audio", enabledProviderTypes: ["tts"] })?.billing?.modelId,
    ).toBe(ENV_MEDIA.tts);
    expect(
      registry.findAdapter({ taskType: "image_still", enabledProviderTypes: ["image"] })?.billing?.modelId,
    ).toBe(ENV_MEDIA.image);
    expect(
      registry.findAdapter({ taskType: "video_clip", enabledProviderTypes: ["video"] })?.billing?.modelId,
    ).toBe(ENV_MEDIA.video);
  });

  it("媒体固定到未注册/未通过 gate 的模型 → adapter 不注册（no-adapter 路径）", () => {
    injectDashscopeEnv();
    const db = createDbClient();
    // 目录只有 env 模型行：固定到 FROZEN（目录外）→ 三个 adapter 全部 gate 拒绝
    seedCatalogWithEnvMedia(db);
    const registry = buildProviderRegistry({
      db,
      resolvedCapabilities: makeResolvedCapabilities({ mode: "fixed", ...FROZEN_MEDIA }),
    });
    expect(
      registry.findAdapter({ taskType: "tts_audio", enabledProviderTypes: ["tts"] }),
    ).toBeNull();
    expect(
      registry.findAdapter({ taskType: "image_still", enabledProviderTypes: ["image"] }),
    ).toBeNull();
    expect(
      registry.findAdapter({ taskType: "video_clip", enabledProviderTypes: ["video"] }),
    ).toBeNull();
  });

  it("resolved provider_key 非 dashscope → 该 adapter 不注册并输出公开原因日志", () => {
    injectDashscopeEnv();
    const db = createDbClient();
    seedCatalogWithFrozenMedia(db);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const resolved: ResolvedCapabilityMap = {
      ...makeResolvedCapabilities({ mode: "fixed", ...FROZEN_MEDIA }),
      "tts.synthesize": { mode: "fixed", provider_model_id: "tts", provider_key: "openai", model_id: "gpt-tts" },
    };
    const registry = buildProviderRegistry({ db, resolvedCapabilities: resolved });
    expect(
      registry.findAdapter({ taskType: "tts_audio", enabledProviderTypes: ["tts"] }),
    ).toBeNull();
    // 其余槽位不受影响，照常按快照模型注册
    expect(
      registry.findAdapter({ taskType: "image_still", enabledProviderTypes: ["image"] })?.billing?.modelId,
    ).toBe(FROZEN_MEDIA.image);
    const messages = warn.mock.calls.map((call) => String(call[0])).join("\n");
    expect(messages).toContain("tts.synthesize");
    expect(messages).toContain("openai");
    expect(messages).not.toContain("ALIYUN_DASHSCOPE_API_KEY");
    warn.mockRestore();
  });
});

describe("createAssetsDispatchHandler 快照权威（复审整改 P1）", () => {
  it("内存有快照：透传 resolvedCapabilities，媒体 adapter 按快照模型构造", async () => {
    integrationTempDir = join(tmpdir(), `media-resolved-${Date.now()}`);
    await mkdir(integrationTempDir, { recursive: true });
    const app = buildApp({ generationQuoteReadinessInput: buildFrozenMediaReadiness() });
    seedCatalogWithFrozenMedia(app.db);
    await seedGlobalVoiceProfiles(app.db);
    const project = await prepareProjectWithAssetPlan(app.db);
    project.storageRootDir = integrationTempDir;
    setProjectFixedVoice(app.db, project.id);
    injectDashscopeEnv();
    stubDashscopeFetch();

    const { run, snapshotId } = await createQuoteBoundAssetsRun(app, project, "media-resolved-1");
    const snapshot = app.db.runConfigurationSnapshots.get(snapshotId)!;
    const resolved = snapshot.resolvedConfigurationJson as unknown as {
      resolved_capabilities: ResolvedCapabilityMap;
    };
    // 快照冻结的是目录默认（FROZEN），与 env 模型不同——执行必须消费快照
    expect(resolved.resolved_capabilities["tts.synthesize"].mode).toBe("auto");
    expect(resolved.resolved_capabilities["tts.synthesize"].model_id).toBe(FROZEN_MEDIA.tts);
    expect(resolved.resolved_capabilities["image.generate"].model_id).toBe(FROZEN_MEDIA.image);

    const handler = createAssetsDispatchHandler();
    const outcome = await handler(run, {
      db: app.db,
      project,
      repository: createGenerationRunRepository(app.db),
    });
    expect(outcome.status).toBe("succeeded");

    // provider job 记录携带快照模型（不是 env 模型）
    const jobs = [...app.db.assetProviderJobRecords.values()];
    const ttsJobs = jobs.filter((job) => job.providerName === "dashscope_tts");
    const imageJobs = jobs.filter((job) => job.providerName === "dashscope_image");
    expect(ttsJobs.length).toBeGreaterThan(0);
    expect(imageJobs.length).toBeGreaterThan(0);
    for (const job of ttsJobs) {
      expect(job.rawRequestJson?.model).toBe(FROZEN_MEDIA.tts);
    }
    for (const job of imageJobs) {
      expect((job.rawRequestJson?.payload as { model?: string }).model).toBe(FROZEN_MEDIA.image);
    }
  });

  it("冷镜像恢复：内存无快照 + DB 有 → repository 恢复且按快照模型构造", async () => {
    const { app, client, project, root } = await setupPrismaEnv();
    try {
      project.storageRootDir = root;
      injectDashscopeEnv();
      stubDashscopeFetch();

      const repository = createGenerationRunRepository(app.db, app.prismaClient);
      const { run, snapshotId } = await createQuoteBoundAssetsRun(app, project, "media-cold-1", repository);
      expect(app.db.runConfigurationSnapshots.has(snapshotId)).toBe(true);

      // 冷镜像：内存无 snapshot（实例 B sweep 从 DB 恢复 run 的视角）
      app.db.runConfigurationSnapshots.delete(snapshotId);

      const handler = createAssetsDispatchHandler();
      const outcome = await handler(run, { db: app.db, project, repository });
      expect(outcome.status).toBe("succeeded");

      // 经 repository 以数据库为权威恢复，且按快照模型构造 adapter
      const jobs = [...app.db.assetProviderJobRecords.values()];
      const ttsJobs = jobs.filter((job) => job.providerName === "dashscope_tts");
      const imageJobs = jobs.filter((job) => job.providerName === "dashscope_image");
      expect(ttsJobs.length).toBeGreaterThan(0);
      expect(imageJobs.length).toBeGreaterThan(0);
      for (const job of ttsJobs) {
        expect(job.rawRequestJson?.model).toBe(FROZEN_MEDIA.tts);
      }
      for (const job of imageJobs) {
        expect((job.rawRequestJson?.payload as { model?: string }).model).toBe(FROZEN_MEDIA.image);
      }
      // repository 加载后回写内存镜像（usage 记账同源）
      expect(app.db.runConfigurationSnapshots.has(snapshotId)).toBe(true);
    } finally {
      await client.$disconnect();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("内存与 DB 均无快照：dispatch_snapshot_missing 拒绝派发，provider 零调用", async () => {
    injectDashscopeEnv();
    const fetchMock = vi.fn(async () => {
      throw new Error("no fetch allowed");
    });
    vi.stubGlobal("fetch", fetchMock);
    const db = createDbClient();
    const project = await createProject(db, { name: "missing snapshot", ownerId: "owner-1" });
    const handler = createAssetsDispatchHandler();
    const now = new Date();
    const run: GenerationRunRecord = {
      id: "run_media_missing",
      projectId: project.id,
      userId: "owner-1",
      operation: "assets.generate",
      idempotencyKey: "media-missing-1",
      payloadFingerprint: "hash",
      quoteId: "quote_missing",
      runConfigurationSnapshotId: "snap_missing_001",
      dispatchPayloadJson: {},
      status: "pending_dispatch",
      dispatchLeaseOwner: null,
      dispatchLeaseExpiresAt: null,
      dispatchClaimCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    const outcome = await handler(run, {
      db,
      project,
      repository: { getSnapshotById: async () => null } as unknown as GenerationRunRepository,
    });
    expect(outcome).toMatchObject({
      status: "failed",
      reason_code: "dispatch_snapshot_missing",
    });
    // 无 provider 调用、无 adapter 构造（无 job 记录）
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.assetProviderJobRecords.size).toBe(0);
  });
});
