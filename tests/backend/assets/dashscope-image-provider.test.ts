/**
 * DashScope image provider payload builder shell tests.
 *
 * Checked docs: https://help.aliyun.com/zh/model-studio/ (2026-05-16).
 */

import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createDbClient } from "../../../backend/src/db/client.js";
import { executeAssetManifest } from "../../../backend/src/modules/assets/assets-execution-engine.js";
import { createAssetProviderRegistry } from "../../../backend/src/modules/assets/assets-provider-registry.js";
import {
  buildDashscopeImagePayload,
  createDashscopeImageProvider,
} from "../../../backend/src/modules/assets/providers/dashscope/dashscope-image-provider.js";
import type { AssetProviderContext } from "../../../backend/src/modules/assets/assets-provider-adapter.js";
import type { AssetArtifact, AssetManifest, AssetPlan } from "../../../shared/src/index.js";


/**
 * S2-2A 任务 9A：引擎级 adapter 测试需要 quote 绑定 run/snapshot
 * （付费闸门：billing adapter 无授权上下文拒绝派发）。
 */
function createQuotedDb(assetRunId = "assets_run_001") {
  const db = createDbClient();
  const now = new Date();
  const snapshot = {
    id: "snap_quoted_001", projectId: "project_quoted_001", userId: null, stage: "assets",
    operation: "assets.generate", runId: assetRunId, projectConfigurationRevision: 1,
    schemaVersion: "resolved_generation_configuration_v1", configurationHash: "h",
    resolvedConfigurationJson: {}, resolutionTraceJson: [], quoteId: "quote_quoted_001",
    quoteFingerprint: "sha256:x", estimatedCostMicros: "1000000", authorizationCostMicros: "999999999",
    budgetLimitMicros: null, budgetOverrideAuthorized: false, pricingHash: null, pricingVersionSetJson: [],
    createdAt: now, updatedAt: now,
  };
  db.runConfigurationSnapshots.set(snapshot.id, snapshot);
  db.generationRuns.set(assetRunId, {
    id: assetRunId, projectId: "project_quoted_001", userId: null, operation: "assets.generate",
    idempotencyKey: assetRunId, payloadFingerprint: "f", quoteId: "quote_quoted_001",
    runConfigurationSnapshotId: snapshot.id, dispatchPayloadJson: {}, status: "running",
    dispatchLeaseOwner: "test-worker", dispatchLeaseExpiresAt: new Date(now.getTime() + 30_000),
    dispatchClaimCount: 1, createdAt: now, updatedAt: now,
  });
  return db;
}

describe("dashscope image payload builder", () => {
  it("wan2.7-image 走 messages 形态、n 强制 1、参考图走 data URI、纯文生图不强制 thinking_mode", () => {
    const textOnly = buildDashscopeImagePayload({
      model: "wan2.7-image",
      prompt: "战国宫门",
      negativePrompt: "现代建筑",
      size: "2048*1152",
      n: 12,
    });
    expect(textOnly.input.messages![0].content).toEqual([{ text: "战国宫门" }]);
    // 组图默认 n=12 是供应商的坑：强制 1（设计 §3.4）。
    expect(textOnly.parameters.n).toBe(1);
    expect(textOnly.parameters.prompt_extend).toBe(false);
    expect(textOnly.parameters.negative_prompt).toBe("现代建筑");
    // 无 enable_interleave（wan2.7 无此参数）；纯文生图不强制关闭 thinking_mode。
    expect(textOnly.parameters.enable_interleave).toBeUndefined();
    expect(textOnly.parameters.thinking_mode).toBeUndefined();

    const withReference = buildDashscopeImagePayload({
      model: "wan2.7-image",
      prompt: "战国宫门",
      referenceImages: [{ base64: "QUJD", mimeType: "image/png" }],
    });
    expect(withReference.input.messages![0].content).toEqual([
      { text: "战国宫门" },
      { image: "data:image/png;base64,QUJD" },
    ]);
    expect(withReference.parameters.thinking_mode).toBe(false);
    expect(withReference.parameters.n).toBe(1);
  });

  it("wan2.6-image 走编辑形态（enable_interleave=false）且参考图必须 1~4 张", () => {
    const payload = buildDashscopeImagePayload({
      model: "wan2.6-image",
      prompt: "同一人物",
      n: 4,
      referenceImages: [{ base64: "QUJD", mimeType: "image/jpeg" }],
    });
    expect(payload.parameters.enable_interleave).toBe(false);
    expect(payload.parameters.n).toBe(1);
    expect(payload.input.messages![0].content[1]).toEqual({ image: "data:image/jpeg;base64,QUJD" });

    expect(() =>
      buildDashscopeImagePayload({ model: "wan2.6-image", prompt: "无参考图" }),
    ).toThrow("dashscope_wan26_image_reference_count_invalid");
    expect(() =>
      buildDashscopeImagePayload({
        model: "wan2.6-image",
        prompt: "五张参考图",
        referenceImages: Array.from({ length: 5 }, () => ({ base64: "QUJD", mimeType: "image/png" })),
      }),
    ).toThrow("dashscope_wan26_image_reference_count_invalid");
    expect(() =>
      buildDashscopeImagePayload({
        model: "wan2.7-image",
        prompt: "十张参考图",
        referenceImages: Array.from({ length: 10 }, () => ({ base64: "QUJD", mimeType: "image/png" })),
      }),
    ).toThrow("dashscope_wan27_image_reference_count_invalid");
  });

  it("wan2.6 payload contains prompt text in messages format", () => {
    const payload = buildDashscopeImagePayload({
      model: "wan2.6-test",
      prompt: "古代宫殿中景",
      negativePrompt: "现代建筑",
      size: "1080*1920",
    });

    const json = JSON.stringify(payload);
    expect(json).toContain("古代宫殿中景");
    expect(json).toContain("现代建筑");

    // wan2.6 uses messages array
    expect(payload.input.messages).toBeDefined();
    expect(payload.input.messages![0].content[0].text).toBe("古代宫殿中景");
    expect(payload.parameters.negative_prompt).toBe("现代建筑");
  });

  it("negative prompt is passed only when present", () => {
    const withoutNeg = buildDashscopeImagePayload({
      model: "wan2.6-test",
      prompt: "test prompt",
    });

    expect(withoutNeg.parameters.negative_prompt).toBe("");

    const withNeg = buildDashscopeImagePayload({
      model: "wan2.6-test",
      prompt: "test prompt",
      negativePrompt: "low quality",
    });

    expect(withNeg.parameters.negative_prompt).toBe("low quality");
  });

  it("wanx (non-wan2.6) uses legacy prompt format with default negative", () => {
    const payload = buildDashscopeImagePayload({
      model: "wanx-v1",
      prompt: "战国宫门",
    });

    expect(payload.input.prompt).toBe("战国宫门");
    expect(payload.input.messages).toBeUndefined();
    expect((payload as { input: { negative_prompt: string } }).input.negative_prompt).toContain("低质量");
  });

  it("size normalizes x separator to *", () => {
    const payload = buildDashscopeImagePayload({
      model: "wan2.6-test",
      prompt: "test",
      size: "1920x1080",
    });

    expect(payload.parameters.size).toBe("1920*1080");
  });

  it("sets default size to 1080*1920 when not provided", () => {
    const payload = buildDashscopeImagePayload({
      model: "wan2.6-test",
      prompt: "test",
    });

    expect(payload.parameters.size).toBe("1080*1920");
  });
});

function makeImageManifest(): AssetManifest {
  return {
    manifest_version: "asset_manifest_v1",
    source_asset_plan_id: "asset_plan_001",
    source_storyboard_record_id: "storyboard_001",
    source_script_record_id: "script_001",
    execution_options: {
      execution_mode: "auto_available",
      voice_profile_id: "voice_001",
      enabled_provider_types: ["image"],
      allow_manual_placeholders: false,
    },
    executions: [
      {
        execution_id: "exec_img_001",
        task_id: "task_img_001",
        task_type: "image_still",
        status: "planned",
        origin: "provider",
        started_at: null,
        completed_at: null,
        provider_id: null,
        attempts: 0,
        output_artifact_ids: [],
        notes: [],
      },
    ],
    artifacts: [],
    audio_summary: {
      voice_profile_id: "voice_001",
      tts_total_duration_sec: null,
      tts_chunk_artifact_ids: [],
      tts_chunk_routes: [],
      tts_merged_artifact_id: null,
      subtitle_artifact_id: null,
      bgm_placements: [],
      sfx_artifact_ids: [],
    },
    segment_routes: [
      {
        segment_id: "sb_001",
        tts_artifact_id: null,
        subtitle_artifact_id: null,
        primary_visual_artifact_id: null,
        visual_route_type: "image_only",
        motion_artifact_id: null,
        fallback_visual_artifact_id: null,
        sfx_artifact_ids: [],
        bgm_placement_ids: [],
        readiness: "blocked",
        notes: [],
      },
    ],
    readiness: "blocked",
    notes: [],
  };
}

function makeImageAssetPlan(): AssetPlan {
  return {
    plan_version: "asset_plan_v1",
    source_storyboard_record_id: "storyboard_001",
    source_script_record_id: "script_001",
    source_topic_package_id: "topic_001",
    art_bible: {
      era_style: "test",
      visual_tone: "test",
      characters: [],
      locations: [],
      props: [],
      global_prompt_prefix: "test",
      global_negative_prompts: ["no text"],
      consistency_notes: [],
    },
    visual_budget: {},
    downgrade_policy: {},
    global_audio_strategy: {},
    tts_plan: {
      voice_profile_id: "voice_001",
      estimated_total_duration_sec: 1,
      chunking_strategy: "segment_boundary",
      chunks: [],
    },
    tasks: [
      {
        task_id: "task_img_001",
        order: 0,
        task_type: "image_still",
        source_segment_id: "sb_001",
        source_excerpt: "palace gate",
        production_intent: "generate one image",
        recommended_mode: "auto",
        provider_hint: "dashscope_image",
        prompt_draft: "ancient palace gate at night",
        parameters: { size: "720*1280", negative_prompt: "modern buildings" },
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
      total_tasks: 1,
      by_type: { image_still: 1 },
      by_cost_tier: { low: 1 },
      estimated_provider_calls: 1,
      notes: [],
    },
    global_production_notes: [],
  };
}

describe("dashscope image provider adapter", () => {
  let tempDir: string | null = null;

  afterEach(async () => {
    vi.unstubAllGlobals();
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it("submits async image task, polls, downloads, and writes image artifact", async () => {
    tempDir = join(tmpdir(), `dashscope-image-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });

    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      fetchCalls.push({ url, init });
      if (url.includes("/api/v1/services/aigc/image-generation/generation")) {
        return new Response(
          JSON.stringify({ output: { task_id: "task_001" } }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("/api/v1/tasks/task_001")) {
        return new Response(
          JSON.stringify({
            output: {
              task_status: "SUCCEEDED",
              results: [{ url: "https://download.test/image.png" }],
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(new Uint8Array([137, 80, 78, 71]).buffer, {
        status: 200,
      });
    });

    const result = await executeAssetManifest({
      db: createQuotedDb(),
      assetManifestRecordId: "manifest_001",
      assetRunId: "assets_run_001",
      manifest: makeImageManifest(),
      assetPlan: makeImageAssetPlan(),
      registry: createAssetProviderRegistry([
        createDashscopeImageProvider({
          apiKey: "test-key",
          baseUrl: "https://dashscope.test",
          model: "wan2.6-t2i",
          pollIntervalMs: 0,
          maxPollAttempts: 1,
        }),
      ]),
      projectStorageRootDir: tempDir,
    });

    const submitCall = fetchCalls.find((call) =>
      call.url.includes("/api/v1/services/aigc/image-generation/generation"),
    );
    expect(submitCall?.init?.headers).toMatchObject({
      Authorization: "Bearer test-key",
      "X-DashScope-Async": "enable",
    });

    const imageArtifact = result.manifest.artifacts.find(
      (artifact) => artifact.artifact_type === "image",
    );
    expect(imageArtifact?.metadata).toMatchObject({
      width: 720,
      height: 1280,
      model: "wan2.6-t2i",
      provider_name: "dashscope_image",
    });
    expect(result.manifest.segment_routes[0]).toMatchObject({
      primary_visual_artifact_id: imageArtifact?.artifact_id,
      visual_route_type: "image_only",
      readiness: "ready",
    });
    await expect(stat(imageArtifact!.file_uri)).resolves.toBeTruthy();
  });
});

// ─── T2：角色 sheet 参考图形态（候选 (c)） ───────────────────────────────────

/** PNG 魔数：既作下载产物，也用于断言注入的 base64 就是该文件内容。 */
const PNG_BYTES = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function makeSheetTask(): AssetPlan["tasks"][number] {
  return {
    task_id: "sheet_001",
    order: 1,
    task_type: "character_sheet",
    source_segment_id: null,
    source_excerpt: "束发深衣",
    production_intent: "为角色「人物甲」生成定妆参考图",
    recommended_mode: "manual_allowed",
    provider_hint: null,
    prompt_draft: "角色定妆参考图「人物甲」：束发深衣",
    parameters: {
      character_id: "char_1",
      character_label: "人物甲",
      sheet_role: "character_sheet",
      aspect_ratio: "16:9",
      size: "2048*1152",
      negative_prompt: "现代建筑",
    },
    manual_upload_policy: {
      allowed: true,
      required: false,
      accepted_file_types: ["image/png", "image/jpeg"],
      acceptance_notes: [],
    },
    risk_notes: [],
    cost_tier: "low",
    initial_status: "planned",
  };
}

/** 分镜图任务：编译期写入 character_sheet_task_ids（T1 的注入关系）。 */
function makeInjectedImageTask(
  sheetTaskIds: string[] = ["sheet_001"],
): AssetPlan["tasks"][number] {
  const task = makeImageAssetPlan().tasks[0]!;
  return { ...task, parameters: { ...task.parameters, character_sheet_task_ids: sheetTaskIds } };
}

function makeSheetArtifact(fileUri: string): AssetArtifact {
  return {
    artifact_id: "artifact_sheet_001",
    artifact_type: "image",
    origin: "provider",
    file_uri: fileUri,
    created_at: "2026-09-21T00:00:00.000Z",
    metadata: { sheet_role: "character_sheet", character_id: "char_1", width: 2048, height: 1152 },
  };
}

function makeCtx(input: {
  planTask: AssetPlan["tasks"][number];
  artifacts?: AssetArtifact[];
  storageDir: string;
  assetPlan?: AssetPlan;
  taskType?: AssetManifest["executions"][number]["task_type"];
}): AssetProviderContext {
  const manifest: AssetManifest = {
    ...makeImageManifest(),
    artifacts: input.artifacts ?? [],
  };
  const execution = manifest.executions[0]!;
  return {
    manifest,
    assetPlan: input.assetPlan ?? makeImageAssetPlan(),
    execution: { ...execution, task_type: input.taskType ?? input.planTask.task_type },
    planTask: input.planTask,
    assetManifestRecordId: "manifest_001",
    assetRunId: "assets_run_001",
    projectStorageRootDir: input.storageDir,
  };
}

describe("dashscope image provider 参考图注入（T2）", () => {
  let tempDir: string | null = null;

  afterEach(async () => {
    vi.unstubAllGlobals();
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  async function prepareWith(input: {
    model: string;
    planTask: AssetPlan["tasks"][number];
    artifacts?: AssetArtifact[];
  }) {
    tempDir = join(tmpdir(), `dashscope-ref-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(tempDir, { recursive: true });
    const adapter = createDashscopeImageProvider({
      apiKey: "test-key",
      baseUrl: "https://dashscope.test",
      model: input.model,
      pollIntervalMs: 0,
      maxPollAttempts: 1,
    });
    const ctx = makeCtx({
      planTask: input.planTask,
      artifacts: input.artifacts,
      storageDir: tempDir,
      // 注入解析要从计划里按 sheet task id 反查 character_id，故计划必须同时含 sheet 与分镜图任务。
      assetPlan: { ...makeImageAssetPlan(), tasks: [makeSheetTask(), makeInjectedImageTask()] },
    });
    const prepared = await adapter.prepare(ctx);
    return { prepared, ctx };
  }

  it("sheet 产物存在时注入 base64 参考图，端点不落 text2image", async () => {
    const sheetFile = join(tmpdir(), `sheet-fixture-${Date.now()}.png`);
    await writeFile(sheetFile, PNG_BYTES);
    const { prepared, ctx } = await prepareWith({
      model: "wan2.7-image",
      planTask: makeInjectedImageTask(),
      artifacts: [makeSheetArtifact(sheetFile)],
    });

    expect(prepared.rawRequestJson.endpoint).toBe(
      "https://dashscope.test/api/v1/services/aigc/image-generation/generation",
    );
    expect(prepared.rawRequestJson.reference_image_count).toBe(1);
    const payload = prepared.rawRequestJson.payload as {
      input: { messages: Array<{ content: Array<{ text?: string; image?: string }> }> };
      parameters: { thinking_mode?: boolean; n: number };
    };
    const imageItem = payload.input.messages[0]!.content.find((item) => item.image);
    expect(imageItem?.image).toBe(`data:image/png;base64,${PNG_BYTES.toString("base64")}`);
    expect(payload.parameters.thinking_mode).toBe(false);
    expect(payload.parameters.n).toBe(1);
    // 注入成功：不写降级 note。
    expect(ctx.execution.notes).toEqual([]);
    await rm(sheetFile, { force: true });
  });

  it("降级分支：产物缺失 / 文件不可读 / 超 10MB / 模型不支持参考图 —— 记 note 且不失败", async () => {
    const missing = await prepareWith({
      model: "wan2.7-image",
      planTask: makeInjectedImageTask(),
    });
    expect(missing.prepared.rawRequestJson.reference_image_count).toBe(0);
    expect(missing.ctx.execution.notes.join("\n")).toContain("未找到角色 char_1 的 sheet 产物");

    const unreadable = await prepareWith({
      model: "wan2.7-image",
      planTask: makeInjectedImageTask(),
      artifacts: [makeSheetArtifact(join(tmpdir(), "definitely-absent-sheet.png"))],
    });
    expect(unreadable.prepared.rawRequestJson.reference_image_count).toBe(0);
    expect(unreadable.ctx.execution.notes.join("\n")).toContain("文件不可读");

    tempDir = join(tmpdir(), `dashscope-ref-oversize-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    const oversizeFile = join(tempDir, "oversize.png");
    await writeFile(oversizeFile, Buffer.alloc(10 * 1024 * 1024 + 1));
    const oversize = await prepareWith({
      model: "wan2.7-image",
      planTask: makeInjectedImageTask(),
      artifacts: [makeSheetArtifact(oversizeFile)],
    });
    expect(oversize.prepared.rawRequestJson.reference_image_count).toBe(0);
    expect(oversize.ctx.execution.notes.join("\n")).toContain("超过");

    // 候选 (c)：冻结模型不具备参考图能力 → 准备阶段即降级（不是静默失效）。
    const unsupported = await prepareWith({
      model: "wan2.6-t2i",
      planTask: makeInjectedImageTask(),
    });
    expect(unsupported.prepared.rawRequestJson.reference_image_count).toBe(0);
    expect(unsupported.ctx.execution.notes.join("\n")).toContain("不支持参考图输入");
  });

  it("未被注入的分镜图任务不解析参考图（无 character_sheet_task_ids）", async () => {
    const { prepared, ctx } = await prepareWith({
      model: "wan2.7-image",
      planTask: makeImageAssetPlan().tasks[0]!,
    });
    expect(prepared.rawRequestJson.reference_image_count).toBe(0);
    expect(ctx.execution.notes).toEqual([]);
  });

  it("引擎端到端：sheet 先于分镜图执行，分镜图提交携带 sheet 参考图", async () => {
    tempDir = join(tmpdir(), `dashscope-sheet-e2e-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });

    const submitBodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (url.includes("/api/v1/services/aigc/image-generation/generation")) {
        const body = JSON.parse(String(init?.body)) as {
          input: { messages: Array<{ content: Array<{ text?: string }> }> };
        };
        submitBodies.push(body as unknown as Record<string, unknown>);
        const prompt = body.input.messages[0]!.content[0]!.text ?? "";
        const taskId = prompt.includes("定妆") ? "task_sheet" : "task_img";
        return new Response(JSON.stringify({ output: { task_id: taskId } }), { status: 200 });
      }
      if (url.includes("/api/v1/tasks/")) {
        return new Response(
          JSON.stringify({
            output: {
              task_status: "SUCCEEDED",
              results: [{ url: `https://download.test/${url.split("/").pop()}.png` }],
            },
          }),
          { status: 200 },
        );
      }
      return new Response(new Uint8Array(PNG_BYTES).buffer, { status: 200 });
    });

    const plan: AssetPlan = {
      ...makeImageAssetPlan(),
      tasks: [makeSheetTask(), makeInjectedImageTask()],
      cost_summary: { ...makeImageAssetPlan().cost_summary, total_tasks: 2 },
    };
    const manifest: AssetManifest = {
      ...makeImageManifest(),
      executions: [
        { ...makeImageManifest().executions[0]!, execution_id: "exec_sheet_001", task_id: "sheet_001", task_type: "character_sheet" },
        { ...makeImageManifest().executions[0]!, execution_id: "exec_img_001" },
      ],
    };

    const result = await executeAssetManifest({
      db: createQuotedDb(),
      assetManifestRecordId: "manifest_001",
      assetRunId: "assets_run_001",
      manifest,
      assetPlan: plan,
      registry: createAssetProviderRegistry([
        createDashscopeImageProvider({
          apiKey: "test-key",
          baseUrl: "https://dashscope.test",
          model: "wan2.7-image",
          pollIntervalMs: 0,
          maxPollAttempts: 1,
        }),
      ]),
      projectStorageRootDir: tempDir,
    });

    // sheet 先执行并产出带 metadata 的 artifact（执行期按 metadata 查找的锚点）。
    const sheetArtifact = result.manifest.artifacts.find(
      (artifact) => artifact.metadata?.sheet_role === "character_sheet",
    );
    expect(sheetArtifact?.metadata).toMatchObject({ character_id: "char_1", model: "wan2.7-image" });
    expect(
      result.manifest.executions.find((execution) => execution.task_id === "sheet_001")?.status,
    ).toBe("completed");

    // 分镜图提交（第二次 submit）携带 sheet 参考图，且内容就是 sheet 产物字节。
    expect(submitBodies).toHaveLength(2);
    const imageSubmit = submitBodies[1] as {
      input: { messages: Array<{ content: Array<{ text?: string; image?: string }> }> };
    };
    const imageItem = imageSubmit.input.messages[0]!.content.find((item) => item.image);
    expect(imageItem?.image).toBe(`data:image/png;base64,${PNG_BYTES.toString("base64")}`);
    // 分镜图任务自身不产生任何降级 note（引擎会把 normalizeResult 的普通 note 追加进来）。
    const imageNotes =
      result.manifest.executions.find((execution) => execution.task_id === "task_img_001")?.notes ?? [];
    expect(imageNotes.filter((note) => note.startsWith("[sheet]"))).toEqual([]);
  });
});
