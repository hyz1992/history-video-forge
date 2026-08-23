import { describe, expect, it, vi } from "vitest";

const buildInitialAssetManifestMock = vi.hoisted(() => vi.fn());
const validateAssetsManifestMock = vi.hoisted(() => vi.fn());

vi.mock("../../../backend/src/modules/assets/assets-manifest-builder.js", () => ({
  buildInitialAssetManifest: buildInitialAssetManifestMock,
}));
vi.mock("../../../backend/src/modules/assets/assets-local-validator.js", () => ({
  validateAssetsManifest: validateAssetsManifestMock,
}));

import { buildApp } from "../../../backend/src/app.js";
import { createProject } from "../../../backend/src/modules/projects/project.repository.js";
import { saveScriptRecord } from "../../../backend/src/modules/script/script-record.repository.js";
import { saveStoryboardRecord } from "../../../backend/src/modules/storyboard/storyboard-record.repository.js";
import { saveAssetPlanRecord } from "../../../backend/src/modules/asset-planning/asset-plan-record.repository.js";
import { saveTopicPackage } from "../../../backend/src/modules/topic/topic-package.repository.js";
import { saveAssetManifestRecord } from "../../../backend/src/modules/assets/asset-manifest-record.repository.js";
import type { AssetManifest, AssetPlan, StoryboardPlan } from "../../../shared/src/index.js";
import { buildTestAuth } from "../auth/test-utils.js";
import { buildQuotableReadinessInput, makeQuoteAssetPlan, makeQuoteStoryboardPlan, prepareQuoteProject, seedQuotableCatalog } from "../cost/quote-test-context.js";
import type { AuthenticatedAuthContext } from "../../../backend/src/auth/auth-context.js";

/**
 * S2-2A 任务 8：成本 API 验收（详细设计 8.1 / 9.4）。
 * 覆盖：报价 API 响应合同（十进制字符串金额）、提交协议（assets/generate 携带
 * cost_quote_id/idempotency_key）、幂等重放、成本只读 API owner 隔离。
 */

const scriptText = "Opening pressure.";

async function prepareAssetsApiProject(app: ReturnType<typeof buildApp>, auth: AuthenticatedAuthContext) {
  const project = await createProject(app.db, { name: "API Assets", ownerId: auth.userId });
  const topicPackage = await saveTopicPackage(app.db, { projectId: project.id, title: "T" } as never);
  const script = await saveScriptRecord(app.db, { projectId: project.id, topicPackageId: topicPackage.id, scriptText, estimatedDurationSec: 82 } as never);
  const storyboard = await saveStoryboardRecord(app.db, {
    projectId: project.id,
    topicPackageId: topicPackage.id,
    scriptRecordId: script.id,
    planJson: makeQuoteStoryboardPlan({ scriptRecordId: script.id, topicPackageId: topicPackage.id }),
  } as never);
  const plan = await saveAssetPlanRecord(app.db, {
    projectId: project.id,
    topicPackageId: topicPackage.id,
    scriptRecordId: script.id,
    storyboardRecordId: storyboard.id,
    planJson: makeQuoteAssetPlan({ storyboardRecordId: storyboard.id, scriptRecordId: script.id, topicPackageId: topicPackage.id }),
  } as never);
  project.activeStoryboardRecordId = storyboard.id;
  project.activeScriptRecordId = script.id;
  project.activeAssetPlanRecordId = plan.id;
  return { project, storyboard, plan };
}

function makeManifest(input: { assetPlanRecordId: string; storyboardRecordId: string; scriptRecordId: string; assetPlan: AssetPlan }): AssetManifest {
  return {
    manifest_version: "asset_manifest_v1",
    source_asset_plan_id: input.assetPlanRecordId,
    source_storyboard_record_id: input.storyboardRecordId,
    source_script_record_id: input.scriptRecordId,
    execution_options: { execution_mode: "auto_available" },
    readiness: "ready_for_compose",
    segment_routes: [
      {
        segment_id: "sb_001",
        visual_route_type: "image_with_motion",
        image_route: { status: "completed" },
        video_route: { status: "not_applicable" },
        readiness: "ready",
      },
    ],
    audio_summary: { narrator_voice_id: "voice_default_male_storyteller", total_duration_sec: 82, segments: [] },
    artifacts: [],
    executions: [],
    notes: [],
    route_events: [],
    plan_drift_notes: [],
  };
}

function buildApiApp() {
  const app = buildApp({
    generationQuoteReadinessInput: buildQuotableReadinessInput(),
  });
  return app;
}

describe("generation cost API", () => {
  it("submit protocol: assets/generate creates a run directly; replay with same key returns the same run", async () => {
    const app = buildApiApp();
    await seedQuotableCatalog(app);
    const auth = buildTestAuth({ userId: "user-a" });
    const { project } = await prepareAssetsApiProject(app, auth);
    buildInitialAssetManifestMock.mockReturnValueOnce(makeManifest({
      assetPlanRecordId: project.activeAssetPlanRecordId!,
      storyboardRecordId: project.activeStoryboardRecordId!,
      scriptRecordId: project.activeScriptRecordId!,
      assetPlan: makeQuoteAssetPlan({ storyboardRecordId: project.activeStoryboardRecordId!, scriptRecordId: project.activeScriptRecordId!, topicPackageId: project.activeTopicPackageId ?? "tp" }),
    }));
    validateAssetsManifestMock.mockReturnValueOnce({
      stage: "assets_local_validation",
      decision: "ready_for_compose",
      errors: [],
      warnings: [],
      metrics: { task_count: 3, execution_count: 0, artifact_count: 0, segment_route_count: 1 },
    });

    const submitRes = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/assets/generate`,
      payload: {
        idempotency_key: "api-key-1",
        execution_mode: "auto_available",
      },
      auth,
    });
    expect(submitRes.statusCode).toBe(200);
    const submitBody = submitRes.json();
    expect(submitBody.generation_run_id).toBeTruthy();

    // 幂等重放：同 key 同 payload → 同 run
    const replayRes = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/assets/generate`,
      payload: {
        idempotency_key: "api-key-1",
        execution_mode: "auto_available",
      },
      auth,
    });
    expect(replayRes.statusCode).toBe(200);
    expect(replayRes.json().generation_run_id).toBe(submitBody.generation_run_id);
    expect([...app.db.generationRuns.values()].length).toBe(1);
  });

  it("submit with same key but different payload returns 409 generation_idempotency_payload_conflict", async () => {
    const app = buildApiApp();
    await seedQuotableCatalog(app);
    const auth = buildTestAuth({ userId: "user-a" });
    const { project } = await prepareAssetsApiProject(app, auth);
    buildInitialAssetManifestMock.mockReturnValue(makeManifest({
      assetPlanRecordId: project.activeAssetPlanRecordId!,
      storyboardRecordId: project.activeStoryboardRecordId!,
      scriptRecordId: project.activeScriptRecordId!,
      assetPlan: makeQuoteAssetPlan({ storyboardRecordId: project.activeStoryboardRecordId!, scriptRecordId: project.activeScriptRecordId!, topicPackageId: project.activeTopicPackageId ?? "tp" }),
    }));
    validateAssetsManifestMock.mockReturnValue({
      stage: "assets_local_validation",
      decision: "ready_for_compose",
      errors: [],
      warnings: [],
      metrics: { task_count: 3, execution_count: 0, artifact_count: 0, segment_route_count: 1 },
    });

    const first = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/assets/generate`,
      payload: { idempotency_key: "conflict-key", mode: "missing_only", task_ids: [] },
      auth,
    });
    expect(first.statusCode).toBe(200);

    const conflict = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/assets/generate`,
      payload: { idempotency_key: "conflict-key", mode: "missing_only", task_ids: ["task_img_001"] },
      auth,
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error).toBe("generation_idempotency_payload_conflict");
  });

  it("cost read APIs are owner-scoped: other users get 404, owner gets contract responses", async () => {
    const app = buildApiApp();
    await seedQuotableCatalog(app);
    const auth = buildTestAuth({ userId: "user-a" });
    const otherAuth = buildTestAuth({ userId: "user-b" });
    const { project } = await prepareAssetsApiProject(app, auth);

    // 先创建一条 run（2026-08-23：直接提交，无需 quote）
    buildInitialAssetManifestMock.mockReturnValueOnce(makeManifest({
      assetPlanRecordId: project.activeAssetPlanRecordId!,
      storyboardRecordId: project.activeStoryboardRecordId!,
      scriptRecordId: project.activeScriptRecordId!,
      assetPlan: makeQuoteAssetPlan({ storyboardRecordId: project.activeStoryboardRecordId!, scriptRecordId: project.activeScriptRecordId!, topicPackageId: project.activeTopicPackageId ?? "tp" }),
    }));
    validateAssetsManifestMock.mockReturnValueOnce({
      stage: "assets_local_validation",
      decision: "ready_for_compose",
      errors: [],
      warnings: [],
      metrics: { task_count: 3, execution_count: 0, artifact_count: 0, segment_route_count: 1 },
    });
    await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/assets/generate`,
      payload: { idempotency_key: "read-key-1" },
      auth,
    });

    const run = [...app.db.generationRuns.values()][0]!;

    // owner 可读
    const summary = await app.inject({ method: "GET", url: `/api/projects/${project.id}/costs/summary`, auth });
    expect(summary.statusCode).toBe(200);
    const summaryBody = summary.json();
    expect(summaryBody.total_estimated_cost_cny).toMatch(/^(0|[1-9][0-9]*)\.\d{6}$/);
    expect(summaryBody.run_count).toBe(1);
    expect(summaryBody.currency).toBe("CNY");

    const records = await app.inject({ method: "GET", url: `/api/projects/${project.id}/costs/records`, auth });
    expect(records.statusCode).toBe(200);
    expect(Array.isArray(records.json().records)).toBe(true);
    expect(records.json().total).toBe(0); // usage records 由任务 9A 写入，当前为空

    const config = await app.inject({ method: "GET", url: `/api/projects/${project.id}/runs/${run.id}/configuration`, auth });
    expect(config.statusCode).toBe(200);
    const configBody = config.json();
    expect(configBody.run_id).toBe(run.id);
    expect(configBody.run_status).toBe("succeeded");

    // 其他用户：一律 404（project 反查 owner，禁止凭 id 读数据）
    for (const url of [
      `/api/projects/${project.id}/costs/summary`,
      `/api/projects/${project.id}/costs/records`,
      `/api/projects/${project.id}/runs/${run.id}/configuration`,
    ]) {
      const res = await app.inject({ method: "GET", url, auth: otherAuth });
      expect(res.statusCode, url).toBe(404);
      expect(res.json().error).toBe("project_not_found");
    }
  });
});

describe("generation cost API submit payload fidelity (final review fixes)", () => {
  it("submit without enabled_provider_types keeps the default-open semantics (no empty array)", async () => {
    const app = buildApiApp();
    await seedQuotableCatalog(app);
    const auth = buildTestAuth({ userId: "user-a" });
    const { project } = await prepareAssetsApiProject(app, auth);
    buildInitialAssetManifestMock.mockReturnValue(makeManifest({
      assetPlanRecordId: project.activeAssetPlanRecordId!,
      storyboardRecordId: project.activeStoryboardRecordId!,
      scriptRecordId: project.activeScriptRecordId!,
      assetPlan: makeQuoteAssetPlan({ storyboardRecordId: project.activeStoryboardRecordId!, scriptRecordId: project.activeScriptRecordId!, topicPackageId: project.activeTopicPackageId ?? "tp" }),
    }));
    validateAssetsManifestMock.mockReturnValue({
      stage: "assets_local_validation",
      decision: "ready_for_compose",
      errors: [],
      warnings: [],
      metrics: { task_count: 3, execution_count: 0, artifact_count: 0, segment_route_count: 1 },
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/assets/generate`,
      payload: { idempotency_key: "payload-fidelity-1" },
      auth,
    });
    expect(res.statusCode).toBe(200);
    const run = [...app.db.generationRuns.values()][0]!;
    // 空数组的语义是"全部禁用"；未传必须保持默认全开（不落空数组）
    expect(run.dispatchPayloadJson.enabled_provider_types).toBeUndefined();
  });
});
