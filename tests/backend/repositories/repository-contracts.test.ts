import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { buildApp } from "../../../backend/src/app.js";
import { env } from "../../../backend/src/config/env.js";
import { createDbClient } from "../../../backend/src/db/client.js";
import {
  createProject,
  getProjectById,
} from "../../../backend/src/modules/projects/project.repository.js";
import {
  createProvisionalEvent,
  findEventByCanonicalOrAlias,
} from "../../../backend/src/modules/events/event-registry.repository.js";
import { saveTopicPackage } from "../../../backend/src/modules/topic/topic-package.repository.js";
import {
  getStoryboardRecordById,
  saveStoryboardRecord,
} from "../../../backend/src/modules/storyboard/storyboard-record.repository.js";
import {
  getAssetPlanRecordById,
  saveAssetPlanRecord,
} from "../../../backend/src/modules/asset-planning/asset-plan-record.repository.js";
import {
  getAssetManifestRecordById,
  saveAssetManifestRecord,
} from "../../../backend/src/modules/assets/asset-manifest-record.repository.js";
import {
  getComposeRecordById,
  saveComposeRecord,
} from "../../../backend/src/modules/compose/compose-record.repository.js";
import {
  getRenderJobRecordById,
  saveRenderJobRecord,
} from "../../../backend/src/modules/render/render-record.repository.js";
import { saveCachedCandidate } from "../../../backend/src/modules/cache/candidate-cache.repository.js";

const rootDir = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const prismaSchemaPath = resolve(rootDir, "backend/prisma/schema.prisma");

describe("backend repository contracts", () => {
  it("provides the minimum backend skeleton entrypoints", () => {
    expect(typeof buildApp).toBe("function");
    expect(typeof createDbClient).toBe("function");
    expect(env.nodeEnv).toBeTypeOf("string");
  });

  it("exposes the minimum stable repository methods", async () => {
    expect(typeof createProject).toBe("function");
    expect(typeof getProjectById).toBe("function");
    expect(typeof findEventByCanonicalOrAlias).toBe("function");
    expect(typeof createProvisionalEvent).toBe("function");
    expect(typeof saveTopicPackage).toBe("function");
    expect(typeof saveStoryboardRecord).toBe("function");
    expect(typeof getStoryboardRecordById).toBe("function");
    expect(typeof saveAssetPlanRecord).toBe("function");
    expect(typeof getAssetPlanRecordById).toBe("function");
    expect(typeof saveCachedCandidate).toBe("function");
    expect(typeof saveAssetManifestRecord).toBe("function");
    expect(typeof getAssetManifestRecordById).toBe("function");
    expect(typeof saveComposeRecord).toBe("function");
    expect(typeof getComposeRecordById).toBe("function");
    expect(typeof saveRenderJobRecord).toBe("function");
    expect(typeof getRenderJobRecordById).toBe("function");

    const db = createDbClient();
    const project = await createProject(db, {
      name: "Task 4 contract test",
    });

    expect(project.id).toBeTypeOf("string");
    expect(project.activeStoryboardRecordId).toBeNull();
    expect(project.latestStoryboardRunTraceJson).toBeNull();
    expect(project.activeAssetPlanRecordId).toBeNull();
    expect(project.latestAssetPlanRunTraceJson).toBeNull();
    expect(project.activeAssetManifestRecordId).toBeNull();
    expect(project.latestAssetsRunTraceJson).toBeNull();
    expect(project.activeComposeRecordId).toBeNull();
    expect(project.latestComposeRunTraceJson).toBeNull();
    expect(project.activeRenderJobRecordId).toBeNull();
    expect(project.latestRenderRunTraceJson).toBeNull();
    await expect(getProjectById(db, project.id)).resolves.toMatchObject({
      id: project.id,
      name: "Task 4 contract test",
    });
  });

  it("persists storyboard records in the repository contract", async () => {
    const db = createDbClient();
    const project = await createProject(db, {
      name: "Storyboard repository contract",
    });
    const topicPackage = await saveTopicPackage(db, {
      projectId: project.id,
      title: "Storyboard Topic",
      selectedAngle: "A public pressure scene",
      familyLabel: "diplomacy",
      scopeLabel: "single_event",
      coreConflict: "The envoy must answer without retreating.",
      strongScene: "A reply lands in the hall.",
      packagingSeed: "One reply flips the pressure.",
      durationBandJson: {
        label: "medium",
      },
      narrativeTensionMapJson: {
        hook_claim: "The pressure starts in public.",
        pressure_escalation: "The insult grows.",
        mid_reveal: "The trap is the point.",
        peak_payoff: "The reply reverses it.",
        ending_residue: "Retreat would cost more.",
      },
    });
    const storyboardRecord = await saveStoryboardRecord(db, {
      projectId: project.id,
      topicPackageId: topicPackage.id,
      scriptRecordId: "script_record_1",
      planJson: {
        storyboard_id: "storyboard_plan_1",
        segments: [],
      },
      validationResultJson: {
        stage: "storyboard_local_validation",
        decision: "pass",
        errors: [],
        warnings: [],
        metrics: {},
      },
      executionStateJson: {
        regenerate_used: false,
      },
      graphTraceSummaryJson: {
        phase: "storyboard",
        run_id: "storyboard_run_1",
        steps: [],
      },
      runtimeDiagnosticsJson: {
        checks: [],
      },
    });

    await expect(getStoryboardRecordById(db, storyboardRecord.id)).resolves.toMatchObject({
      id: storyboardRecord.id,
      projectId: project.id,
      topicPackageId: topicPackage.id,
      scriptRecordId: "script_record_1",
    });
  });

  it("persists asset plan records in the repository contract", async () => {
    const db = createDbClient();
    const project = await createProject(db, {
      name: "Asset Plan repository contract",
    });
    const topicPackage = await saveTopicPackage(db, {
      projectId: project.id,
      title: "Asset Plan Topic",
      selectedAngle: "A public pressure scene becomes production tasks.",
      familyLabel: "diplomacy",
      scopeLabel: "single_event",
      coreConflict: "The envoy must answer without retreating.",
      strongScene: "A reply lands in the hall.",
      packagingSeed: "One reply flips the pressure.",
      durationBandJson: {
        label: "medium",
      },
      narrativeTensionMapJson: {
        hook_claim: "The pressure starts in public.",
        pressure_escalation: "The insult grows.",
        mid_reveal: "The trap is the point.",
        peak_payoff: "The reply reverses it.",
        ending_residue: "Retreat would cost more.",
      },
    });
    const assetPlanRecord = await saveAssetPlanRecord(db, {
      projectId: project.id,
      topicPackageId: topicPackage.id,
      scriptRecordId: "script_record_1",
      storyboardRecordId: "storyboard_record_1",
      planJson: {
        plan_version: "asset_plan_v1",
        source_storyboard_record_id: "storyboard_record_1",
        source_script_record_id: "script_record_1",
        source_topic_package_id: topicPackage.id,
        art_bible: {
          era_style: "战国宫廷",
          visual_tone: "冷色压迫",
          characters: [],
          locations: [],
          props: [],
          global_prompt_prefix: "古代中国历史短视频画面",
          global_negative_prompts: ["现代建筑"],
          consistency_notes: [],
        },
        tts_plan: {
          voice_profile_id: "voice_default",
          estimated_total_duration_sec: 70,
          chunking_strategy: "segment_boundary",
          chunks: [
            {
              chunk_id: "tts_001",
              order: 0,
              script_excerpt: "Opening pressure.",
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
            source_excerpt: "Opening pressure.",
            production_intent: "Generate narration.",
            recommended_mode: "auto",
            provider_hint: "default_tts",
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
        ],
        dependencies: [],
        cost_summary: {
          total_tasks: 1,
          by_type: {
            tts_audio: 1,
          },
          by_cost_tier: {
            free: 0,
            low: 1,
            medium: 0,
            high: 0,
          },
          estimated_provider_calls: 1,
          notes: [],
        },
        global_production_notes: ["No physical assets generated."],
      },
      validationResultJson: {
        stage: "asset_planning_local_validation",
        decision: "pass",
        errors: [],
        warnings: [],
        metrics: {
          task_count: 1,
        },
      },
      executionStateJson: {
        regenerate_used: false,
      },
      graphTraceSummaryJson: {
        phase: "asset_planning",
        run_id: "asset_plan_run_1",
        steps: [],
      },
      runtimeDiagnosticsJson: {
        checks: [],
      },
    });

    await expect(getAssetPlanRecordById(db, assetPlanRecord.id)).resolves.toMatchObject({
      id: assetPlanRecord.id,
      projectId: project.id,
      topicPackageId: topicPackage.id,
      scriptRecordId: "script_record_1",
      storyboardRecordId: "storyboard_record_1",
    });
  });

  it("declares the planned JSON persistence fields in prisma schema", () => {
    expect(existsSync(prismaSchemaPath)).toBe(true);

    const schema = readFileSync(prismaSchemaPath, "utf8");

    expect(schema).toContain("model TopicPackage");
    expect(schema).toContain("narrative_tension_map_json");
    expect(schema).toContain("model RecommendationCandidateCache");
    expect(schema).toContain("viral_rubric_json");
    expect(schema).toContain("model ScriptRecord");
    expect(schema).toContain("validation_result_json");
    expect(schema).toContain("semantic_review_result_json");
    expect(schema).toContain("active_storyboard_record_id");
    expect(schema).toContain("model StoryboardRecord");
    expect(schema).toContain("script_record_id");
    expect(schema).toContain("plan_json");
    expect(schema).toContain("graph_trace_summary_json");
    expect(schema).toContain("active_asset_plan_record_id");
    expect(schema).toContain("latest_asset_plan_run_trace_json");
    expect(schema).toContain("model AssetPlanRecord");
    expect(schema).toContain("storyboard_record_id");
    expect(schema).toContain("active_asset_manifest_record_id");
    expect(schema).toContain("latest_assets_run_trace_json");
    expect(schema).toContain("model AssetManifestRecord");
    expect(schema).toContain("active_compose_record_id");
    expect(schema).toContain("latest_compose_run_trace_json");
    expect(schema).toContain("model ComposeRecord");
    expect(schema).toContain("active_render_job_record_id");
    expect(schema).toContain("latest_render_run_trace_json");
    expect(schema).toContain("model RenderJobRecord");
  });

  it("persists asset manifest records in the repository contract", async () => {
    const db = createDbClient();
    const project = await createProject(db, {
      name: "Asset Manifest repository contract",
    });
    const assetManifestRecord = await saveAssetManifestRecord(db, {
      projectId: project.id,
      topicPackageId: "topic_pkg_1",
      scriptRecordId: "script_record_1",
      storyboardRecordId: "storyboard_record_1",
      assetPlanRecordId: "asset_plan_record_1",
      manifestJson: {
        manifest_version: "asset_manifest_v1",
        segments: [],
        task_executions: [],
        bgm_placements: [],
      },
      validationResultJson: {
        stage: "assets_local_validation",
        decision: "pass",
        errors: [],
        warnings: [],
        metrics: {},
      },
      executionStateJson: {
        execution_mode: "full_auto",
        activated: true,
      },
      graphTraceSummaryJson: {
        phase: "assets",
        run_id: "assets_run_1",
        steps: [],
      },
      runtimeDiagnosticsJson: null,
    });

    await expect(getAssetManifestRecordById(db, assetManifestRecord.id)).resolves.toMatchObject({
      id: assetManifestRecord.id,
      projectId: project.id,
      topicPackageId: "topic_pkg_1",
      scriptRecordId: "script_record_1",
      storyboardRecordId: "storyboard_record_1",
      assetPlanRecordId: "asset_plan_record_1",
    });
  });

  it("persists compose records in the repository contract", async () => {
    const db = createDbClient();
    const project = await createProject(db, {
      name: "Compose repository contract",
    });
    const composeRecord = await saveComposeRecord(db, {
      projectId: project.id,
      assetManifestRecordId: "asset_manifest_record_1",
      timelineJson: {
        timeline_version: "compose_timeline_v1",
        duration_sec: 12,
        tracks: [],
        segments: [],
      },
      validationResultJson: {
        stage: "compose_local_validation",
        decision: "ready_for_render",
        errors: [],
        warnings: [],
        metrics: {},
      },
      executionStateJson: {
        activated: true,
      },
      graphTraceSummaryJson: {
        phase: "compose",
        run_id: "compose_run_1",
        steps: [],
      },
      runtimeDiagnosticsJson: null,
    });

    await expect(getComposeRecordById(db, composeRecord.id)).resolves.toMatchObject({
      id: composeRecord.id,
      projectId: project.id,
      assetManifestRecordId: "asset_manifest_record_1",
      validationResultJson: {
        stage: "compose_local_validation",
      },
    });
  });

  it("persists render job records in the repository contract", async () => {
    const db = createDbClient();
    const project = await createProject(db, {
      name: "Render repository contract",
    });
    const record = await saveRenderJobRecord(db, {
      projectId: project.id,
      composeRecordId: "compose_001",
      assetManifestRecordId: "asset_manifest_001",
      status: "completed",
      profileJson: { width: 1080, height: 1920, fps: 30 },
      outputArtifactJson: {
        artifact_id: "render_export_001",
        artifact_type: "rendered_video",
        file_uri: "file://storage/projects/proj_001/renders/render_001/output.mp4",
        mime_type: "video/mp4",
        duration_sec: 12,
        width: 1080,
        height: 1920,
        fps: 30,
        source_compose_record_id: "compose_001",
        source_asset_manifest_record_id: "asset_manifest_001",
        metadata: { renderer: "fake" },
      },
      validationResultJson: {
        stage: "render_local_validation",
        decision: "rendered",
        errors: [],
        warnings: [],
        metrics: {
          duration_sec: 12,
        },
      },
      executionStateJson: {
        activated: true,
      },
      graphTraceSummaryJson: {
        phase: "render",
        run_id: "render_run_1",
        nodes: [],
      },
      runtimeDiagnosticsJson: null,
    });

    await expect(getRenderJobRecordById(db, record.id)).resolves.toMatchObject({
      id: record.id,
      projectId: project.id,
      composeRecordId: "compose_001",
      assetManifestRecordId: "asset_manifest_001",
      status: "completed",
      validationResultJson: {
        stage: "render_local_validation",
      },
    });
  });
});
