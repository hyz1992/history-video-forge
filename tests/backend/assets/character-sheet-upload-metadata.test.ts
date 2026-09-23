/**
 * 手动上传的角色 sheet 必须参与参考图注入（2026-09-23 计划自审发现 1）。
 *
 * 背景：注入解析按 artifact metadata（`sheet_role` + `character_id`）查找；上传路径原先
 * 由服务端探针生成 metadata（只有 width/height），不盖章 → "面板换了图，注入静默失效"。
 * 本文件锁定两条：① 上传件带同一套元数据；② 该上传件能被注入解析命中。
 * 同时回归：非 sheet 任务的上传元数据**不**被盖章（零变化）。
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

import type { AssetPlan, ProjectRecord } from "../../../backend/src/db/client.js";
import { createDbClient } from "../../../backend/src/db/client.js";
import { registerManualArtifact } from "../../../backend/src/modules/assets/assets-run.service.js";
import { buildInitialAssetManifest } from "../../../backend/src/modules/assets/assets-manifest-builder.js";
import { resolveCharacterSheetReferenceImages } from "../../../backend/src/modules/assets/character-sheet-reference.js";

const PROJECT_ID = "project_sheet_upload";
const TASK_ID = "sheet_001";

function makePlan(): AssetPlan {
  return {
    plan_version: "asset_plan_v1",
    source_storyboard_record_id: "storyboard_001",
    source_script_record_id: "script_001",
    source_topic_package_id: "topic_001",
    art_bible: {
      era_style: "初唐",
      visual_tone: "冷峻",
      characters: [],
      locations: [],
      props: [],
      global_prompt_prefix: "写实历史",
      global_negative_prompts: [],
      consistency_notes: [],
    },
    visual_budget: {},
    downgrade_policy: {},
    global_audio_strategy: {},
    tts_plan: { voice_profile_id: "voice_001", estimated_total_duration_sec: 10, chunking_strategy: "segment_boundary", chunks: [] },
    tasks: [
      {
        task_id: "sheet_001",
        order: 0,
        task_type: "character_sheet",
        source_segment_id: null,
        source_excerpt: "束发深衣",
        production_intent: "定妆参考图",
        recommended_mode: "manual_allowed",
        provider_hint: null,
        prompt_draft: "角色定妆参考图「李世民」",
        parameters: { character_id: "char_1", character_label: "李世民", sheet_role: "character_sheet", size: "2048*1152" },
        manual_upload_policy: { allowed: true, required: false, accepted_file_types: ["image/png", "image/jpeg"], acceptance_notes: [] },
        risk_notes: [],
        cost_tier: "low",
        initial_status: "planned",
      },
      {
        task_id: "img_s000_01",
        order: 1,
        task_type: "image_still",
        source_segment_id: "sb_001",
        source_excerpt: "画面",
        production_intent: "分镜图",
        recommended_mode: "auto",
        provider_hint: null,
        prompt_draft: "朝堂对峙",
        parameters: { image_role: "anchor", character_sheet_task_ids: ["sheet_001"] },
        manual_upload_policy: { allowed: true, required: false, accepted_file_types: ["image/png", "image/jpeg"], acceptance_notes: [] },
        risk_notes: [],
        cost_tier: "low",
        initial_status: "planned",
      },
      {
        task_id: "img_s001_01",
        order: 2,
        task_type: "image_still",
        source_segment_id: "sb_001",
        source_excerpt: "画面",
        production_intent: "分镜图（用于非 sheet 上传回归的分镜图任务）",
        recommended_mode: "auto",
        provider_hint: null,
        prompt_draft: "宫门伏兵",
        parameters: { image_role: "anchor" },
        manual_upload_policy: { allowed: true, required: false, accepted_file_types: ["image/png"], acceptance_notes: [] },
        risk_notes: [],
        cost_tier: "low",
        initial_status: "planned",
      },
    ],
    dependencies: [],
    cost_summary: { total_tasks: 3, by_type: {}, by_cost_tier: {}, estimated_provider_calls: 0, notes: [] },
    global_production_notes: [],
  } as unknown as AssetPlan;
}

async function makeContext(storageDir: string) {
  const db = createDbClient();
  const plan = makePlan();
  const project = {
    id: PROJECT_ID,
    ownerId: "owner_1",
    name: "sheet upload 验收",
    storageKey: "sheet-upload",
    storageDisplayName: "sheet upload",
    storageRootDir: storageDir,
    status: "assets_partial",
    activeAssetPlanRecordId: "plan_001",
    activeAssetManifestRecordId: "manifest_001",
    activeTopicPackageId: "topic_001",
    activeScriptRecordId: "script_001",
    activeStoryboardRecordId: "storyboard_001",
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as ProjectRecord;
  db.projects.set(project.id, project);
  db.assetPlanRecords.set("plan_001", {
    id: "plan_001",
    projectId: PROJECT_ID,
    planJson: plan,
    validationResultJson: {},
    executionStateJson: null,
    graphTraceSummaryJson: null,
    runtimeDiagnosticsJson: null,
    createdAt: new Date(),
  } as never);
  const manifest = buildInitialAssetManifest({
    assetPlanRecordId: "plan_001",
    assetPlan: plan,
    segmentIds: ["sb_001"],
  });
  db.assetManifestRecords.set("manifest_001", {
    id: "manifest_001",
    projectId: PROJECT_ID,
    topicPackageId: "topic_001",
    scriptRecordId: "script_001",
    storyboardRecordId: "storyboard_001",
    assetPlanRecordId: "plan_001",
    manifestJson: manifest,
    validationResultJson: {},
    executionStateJson: null,
    graphTraceSummaryJson: null,
    runtimeDiagnosticsJson: null,
    createdAt: new Date(),
  } as never);
  return { db, project, plan, manifest };
}

async function uploadSheet(storageDir: string, taskId: string, fileName: string) {
  const filePath = join(storageDir, fileName);
  await writeFile(filePath, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const { db, project, plan, manifest } = await makeContext(storageDir);
  const result = await registerManualArtifact({
    db,
    project,
    taskId,
    artifactType: "image",
    fileUri: filePath,
    mimeType: "image/png",
    // 与真实控制器一致：服务端探针只给尺寸，不含任何 sheet 语义字段。
    metadata: { width: 2048, height: 1152 },
  });
  const manifestRecord = db.assetManifestRecords.get("manifest_001")!;
  const stored = (manifestRecord.manifestJson as typeof manifest).artifacts.at(-1)!;
  return { result, plan, manifest: manifestRecord.manifestJson as typeof manifest, stored };
}

describe("手动上传的角色 sheet 参与注入（自审发现 1）", () => {
  let storageDir: string | null = null;

  afterEach(async () => {
    if (storageDir) {
      await rm(storageDir, { recursive: true, force: true });
      storageDir = null;
    }
  });

  it("上传 sheet 后 artifact 带 sheet_role/character_id，且注入解析能命中它", async () => {
    storageDir = join(tmpdir(), `sheet-upload-${Date.now()}`);
    await mkdir(storageDir, { recursive: true });
    const { result, plan, manifest, stored } = await uploadSheet(storageDir, TASK_ID, "replacement.png");

    expect(result.statusCode).toBe(200);
    expect(stored.metadata).toMatchObject({
      width: 2048,
      height: 1152,
      sheet_role: "character_sheet",
      character_id: "char_1",
      character_label: "李世民",
    });

    // 关键：分镜图任务的注入解析必须能找到这张手动上传件（改写前这里会 refs=0）。
    const injection = await resolveCharacterSheetReferenceImages({
      manifest,
      assetPlan: plan,
      planTask: plan.tasks.find((task) => task.task_id === "img_s000_01")!,
      model: "wan2.7-image",
      referenceLimit: 9,
    });
    expect(injection.notes).toEqual([]);
    expect(injection.images).toHaveLength(1);
  });

  it("上传替换后解析必须选中上传件（旧 provider 产物仍在数组前面）", async () => {
    storageDir = join(tmpdir(), `sheet-upload-select-${Date.now()}`);
    await mkdir(storageDir, { recursive: true });
    const { result, plan, manifest, stored } = await uploadSheet(storageDir, TASK_ID, "replacement-select.png");
    expect(result.statusCode).toBe(200);

    // 造出"旧 provider 产物排在前、上传件排在后"的真实形态（provider 产物先入库）。
    const olderProviderArtifact = {
      artifact_id: "artifact_provider_sheet_old",
      artifact_type: "image" as const,
      origin: "provider" as const,
      file_uri: join(storageDir, "replacement-select.png"),
      created_at: new Date().toISOString(),
      metadata: { sheet_role: "character_sheet", character_id: "char_1", width: 2048, height: 1152 },
    };
    manifest.artifacts.unshift(olderProviderArtifact);

    const injection = await resolveCharacterSheetReferenceImages({
      manifest,
      assetPlan: plan,
      planTask: plan.tasks.find((task) => task.task_id === "img_s000_01")!,
      model: "wan2.7-image",
      referenceLimit: 9,
    });
    // 解析必须取"当前选择"（execution.output_artifact_ids[0] = 上传件），而不是数组里第一个匹配项。
    expect(injection.images).toHaveLength(1);
    expect(injection.images[0]!.base64).toBe(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString("base64"),
    );
    expect(stored.artifact_id).toBe(
      (manifest.executions.find((execution) => execution.task_id === TASK_ID)!.output_artifact_ids[0]),
    );
  });

  it("局部重跑：sheet execution 被过滤时仍按 metadata 回退解析（P3 防线不回退）", async () => {
    storageDir = join(tmpdir(), `sheet-upload-rerun-${Date.now()}`);
    await mkdir(storageDir, { recursive: true });
    const { plan, manifest } = await uploadSheet(storageDir, TASK_ID, "replacement-rerun.png");
    const rerunManifest = {
      ...manifest,
      executions: manifest.executions.filter((execution) => execution.task_id !== TASK_ID),
    };
    const injection = await resolveCharacterSheetReferenceImages({
      manifest: rerunManifest,
      assetPlan: plan,
      planTask: plan.tasks.find((task) => task.task_id === "img_s000_01")!,
      model: "wan2.7-image",
      referenceLimit: 9,
    });
    expect(injection.images).toHaveLength(1);
  });

  it("上传结果必须落库（既有缺口回归：只改内存会让后续 run 完全看不到上传件）", async () => {
    storageDir = join(tmpdir(), `sheet-upload-persist-${Date.now()}`);
    await mkdir(storageDir, { recursive: true });
    const { db, project, plan, manifest } = await makeContext(storageDir);
    const saved: Array<{ manifestArtifacts: number; projectStatus: string }> = [];
    db.thirdAggregateWriter = {
      async saveAssetManifest(record: { manifestJson: unknown }) {
        saved.push({
          manifestArtifacts: ((record.manifestJson as { artifacts?: unknown[] }).artifacts ?? []).length,
          projectStatus: project.status,
        });
      },
    } as never;
    const filePath = join(storageDir, "persist.png");
    await writeFile(filePath, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));

    const result = await registerManualArtifact({
      db,
      project,
      taskId: TASK_ID,
      artifactType: "image",
      fileUri: filePath,
      mimeType: "image/png",
      metadata: { width: 2048, height: 1152 },
    });

    expect(result.statusCode).toBe(200);
    // 内存侧：artifact 已并入 manifest
    expect((db.assetManifestRecords.get("manifest_001")!.manifestJson as typeof manifest).artifacts).toHaveLength(
      manifest.artifacts.length + 1,
    );
    // 持久化侧：writer 收到的是**含上传件**的 manifest（缺这一步上传就是"内存态假成功"）
    expect(saved).toHaveLength(1);
    expect(saved[0]!.manifestArtifacts).toBe(manifest.artifacts.length + 1);
  });

  it("非 sheet 任务的上传元数据不被盖章（零变化）", async () => {
    storageDir = join(tmpdir(), `sheet-upload-plain-${Date.now()}`);
    await mkdir(storageDir, { recursive: true });
    const { result, stored } = await uploadSheet(storageDir, "img_s001_01", "plain.png");
    expect(result.statusCode).toBe(200);
    expect(stored.metadata).toEqual({ width: 2048, height: 1152 });
    expect(stored.metadata).not.toHaveProperty("sheet_role");
  });
});
