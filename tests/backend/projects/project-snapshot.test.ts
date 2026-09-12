import { describe, expect, it } from "vitest";

import type {
  AssetPlan,
  AssetPlanningValidationResult,
} from "../../../shared/src/index.js";
import { createHash } from "node:crypto";
import { canonicalStringify } from "../../../shared/src/index.js";
import { createDbClient } from "../../../backend/src/db/client.js";
import { createLegacyProject as createProject } from "./legacy-project.fixture.js";
import { getProjectSnapshot } from "../../../backend/src/modules/projects/project-snapshot.service.js";
import { buildPricingCatalogSeed } from "../../../backend/src/modules/generation-cost/pricing-catalog.seed.js";
import { seedGlobalVoiceProfiles } from "../../../backend/src/modules/assets/voice/voice-profile.repository.js";
import { findProjectConfigRecord } from "../../../backend/src/modules/generation-config/generation-config.repository.js";
import { normalizeNarrationTiming } from "../../../backend/src/modules/narration/narration-timing-normalizer.js";
import { projectStoryboardTiming } from "../../../backend/src/modules/storyboard/storyboard-timing-projector.js";
import { saveAssetPlanRecord } from "../../../backend/src/modules/asset-planning/asset-plan-record.repository.js";
import {
  saveAssetManifestRecord,
} from "../../../backend/src/modules/assets/asset-manifest-record.repository.js";
import { saveComposeRecord } from "../../../backend/src/modules/compose/compose-record.repository.js";
import { saveRenderJobRecord } from "../../../backend/src/modules/render/render-record.repository.js";
import { saveScriptRecord } from "../../../backend/src/modules/script/script-record.repository.js";
import { saveStoryboardRecord } from "../../../backend/src/modules/storyboard/storyboard-record.repository.js";
import { saveTopicPackage } from "../../../backend/src/modules/topic/topic-package.repository.js";
import { getProjectStorageProfile } from "../../../backend/src/runtime/trace/project-storage.js";

describe("project snapshot service", () => {
  it("restores active topic, active script, latest validation results, patch/regen execution state, and graph trace summary", async () => {
    const db = createDbClient();
    const project = await createProject(db, {
      name: "Snapshot Project",
    });

    const topicPackage = await saveTopicPackage(db, {
      projectId: project.id,
      title: "晏子使楚",
      selectedAngle: "楚王不是只压了晏子一次，而是连压三次。",
      familyLabel: "外交压场型",
      scopeLabel: "完整事件",
      coreConflict: "楚王借公开场合连续羞辱晏子与齐国，晏子必须当场顶回去。",
      strongScene: "楚王连续压场，晏子一句句顶回去。",
      packagingSeed: "楚王连压三次，晏子一次没退。",
      canonicalQuotesJson: ["橘生淮南则为橘"],
      durationBandJson: {
        label: "medium",
      },
      narrativeTensionMapJson: {
        hook_claim: "楚王不是只压了晏子一次，而是连压三次",
        pressure_escalation: "从羞辱身形升级到羞辱齐国，再升级到羞辱齐人风气",
        mid_reveal: "晏子不是在逞口舌，而是在守住齐国场面",
        peak_payoff: "橘枳之喻把第三次压场原样顶回",
        ending_residue: "这种场面，一退就不只是退掉自己",
      },
      mustIncludeBeatsJson: ["入楚受辱", "橘枳之喻"],
      forbiddenExpansionsJson: ["不要扩写到未定 downstream 阶段"],
      riskHintsJson: ["不要把内容写成课堂导入"],
      sourceAnchorRefsJson: ["《晏子春秋》"],
    });

    project.activeTopicPackageId = topicPackage.id;
    project.status = "script_ready";

    const scriptRecord = await saveScriptRecord(db, {
      projectId: project.id,
      topicPackageId: topicPackage.id,
      scriptText:
        "如果有人当着所有人的面羞辱你，你敢不敢当场顶回去？晏子敢。楚王连续压场，晏子一句句顶回去。",
      openingSpan: "如果有人当着所有人的面羞辱你，你敢不敢当场顶回去？",
      endingSpan: "这种场面，一退掉的就不只是自己。",
      estimatedDurationSec: 86,
      beatTraceJson: [
        {
          beat: "入楚受辱",
          excerpt: "入楚受辱只是第一层",
          confidence: 0.95,
        },
      ],
      quoteTraceJson: [],
      reviewStatus: "pass",
      validationResultJson: {
        stage: "script_local_validation",
        decision: "pass",
        errors: [],
        warnings: [],
        metrics: {
          estimated_duration_sec: 86,
        },
      },
      semanticReviewResultJson: {
        stage: "script_semantic_review",
        decision: "pass",
        patch_intent: "lift",
        hard_issues: [],
        soft_issues: [],
        patch_targets: [],
        summary: "内部 lift patch 后已通过语义审校。",
        confidence: 0.9,
      },
      executionStateJson: {
        patch_used: true,
        regenerate_used: false,
      },
      graphTraceSummaryJson: {
        phase: "script",
        run_id: "script_run_snapshot_1",
        nodes: [
          {
            node_name: "script-generate",
            input_ref: "script-input-bundle:topic-yanzi",
            output_ref: "script-draft:current",
            failure_reason: null,
          },
          {
            node_name: "semantic-review",
            input_ref: "script-local-validation:current",
            output_ref: "script-semantic-review:current",
            failure_reason: null,
          },
        ],
        steps: [
          {
            step_name: "script-generate",
            phase: "script",
            status: "succeeded",
            started_at: "2026-04-21T09:00:00.000Z",
            ended_at: "2026-04-21T09:00:01.000Z",
            duration_ms: 1000,
          },
          {
            step_name: "local-validate",
            phase: "script",
            status: "succeeded",
            started_at: "2026-04-21T09:00:01.000Z",
            ended_at: "2026-04-21T09:00:01.200Z",
            duration_ms: 200,
          },
          {
            step_name: "semantic-review",
            phase: "script",
            status: "succeeded",
            started_at: "2026-04-21T09:00:01.200Z",
            ended_at: "2026-04-21T09:00:02.000Z",
            duration_ms: 800,
          },
        ],
      },
      runtimeDiagnosticsJson: {
        checks: [
          {
            code: "semantic_review_passed",
            level: "info",
          },
        ],
      },
    });

    project.activeScriptRecordId = scriptRecord.id;

    const snapshot = await getProjectSnapshot(db, project.id);

    expect(snapshot).toMatchObject({
      project_id: project.id,
      current_status: "script_ready",
      active_topic_package: {
        topic_package_id: topicPackage.id,
        canonical_title: "晏子使楚",
        selected_angle: "楚王不是只压了晏子一次，而是连压三次。",
      },
      active_script: {
        script_record_id: scriptRecord.id,
        script_text: expect.stringContaining("所有人的面"),
        review_decision: "pass",
        patch_intent: "lift",
        execution_state: {
          patch_used: true,
          regenerate_used: false,
        },
        graph_trace_summary: {
          nodes: [
            {
              node_name: "script-generate",
              input_ref: "script-input-bundle:topic-yanzi",
              output_ref: "script-draft:current",
              failure_reason: null,
            },
            {
              node_name: "semantic-review",
              input_ref: "script-local-validation:current",
              output_ref: "script-semantic-review:current",
              failure_reason: null,
            },
          ],
        },
        runtime_diagnostics: {
          checks: [
            {
              code: "semantic_review_passed",
              level: "info",
            },
          ],
        },
      },
    });
    expect(snapshot?.active_script?.local_validation?.stage).toBe(
      "script_local_validation",
    );
    expect(snapshot?.active_script?.semantic_review?.stage).toBe(
      "script_semantic_review",
    );
    expect(snapshot?.trace_summary).toMatchObject({
      project_storage: {
        root_dir: expect.stringMatching(
          /storage[\\/]projects[\\/]\d{4}-\d{2}-\d{2}[\\/]Snapshot Project \[p_[a-z0-9]{8}\]/i,
        ),
      },
      latest_script_run: {
        run_id: "script_run_snapshot_1",
        phase: "script",
        step_count: 3,
        latest_step: "semantic-review",
      },
    });
  });

  it("restores active storyboard and latest storyboard trace summary", async () => {
    const db = createDbClient();
    const project = await createProject(db, {
      name: "Storyboard Snapshot",
    });
    const topicPackage = await saveTopicPackage(db, {
      projectId: project.id,
      title: "Storyboard Topic",
      selectedAngle: "A public answer reverses the pressure.",
      familyLabel: "diplomacy",
      scopeLabel: "single_event",
      coreConflict: "The envoy must answer in front of everyone.",
      strongScene: "The hall falls quiet after the answer.",
      packagingSeed: "One sentence changes the room.",
      durationBandJson: {
        label: "medium",
      },
      narrativeTensionMapJson: {
        hook_claim: "A public pressure scene begins.",
        pressure_escalation: "The insult keeps rising.",
        mid_reveal: "The answer is guarding the state's face.",
        peak_payoff: "The reply reverses the pressure.",
        ending_residue: "Retreat would cost more than silence.",
      },
    });
    const scriptRecord = await saveScriptRecord(db, {
      projectId: project.id,
      topicPackageId: topicPackage.id,
      scriptText:
        "Opening pressure. The envoy answers in public. The room goes quiet. The ending leaves a cost.",
      openingSpan: "Opening pressure.",
      endingSpan: "The ending leaves a cost.",
      estimatedDurationSec: 82,
      beatTraceJson: [],
      quoteTraceJson: [],
      reviewStatus: "pass",
      validationResultJson: {
        stage: "script_local_validation",
        decision: "pass",
      },
      semanticReviewResultJson: {
        stage: "script_semantic_review",
        decision: "pass",
        patch_intent: null,
      },
      executionStateJson: {
        patch_used: false,
        regenerate_used: false,
      },
    });
    const storyboardTrace = {
      phase: "storyboard",
      run_id: "storyboard_run_snapshot_1",
      steps: [
        {
          step_name: "storyboard-generate",
          phase: "storyboard",
          status: "succeeded",
        },
        {
          step_name: "local-validate",
          phase: "storyboard",
          status: "succeeded",
        },
      ],
    };
    const storyboardRecord = await saveStoryboardRecord(db, {
      projectId: project.id,
      topicPackageId: topicPackage.id,
      scriptRecordId: scriptRecord.id,
      planJson: {
        storyboard_id: "storyboard_plan_snapshot_1",
        source_script_record_id: scriptRecord.id,
        segments: [
          {
            segment_id: "seg_001",
            start_sec: 0,
            end_sec: 8,
            script_excerpt: "Opening pressure.",
            scene_description: "A tense public hall.",
            visual_intent: "faces under pressure",
            camera_plan: "slow push-in",
            on_screen_text: null,
            asset_brief: "court hall",
            continuity_notes: [],
            trace_refs: ["opening_span"],
          },
        ],
      },
      validationResultJson: {
        stage: "storyboard_local_validation",
        decision: "pass",
        errors: [],
        warnings: [],
        metrics: {
          segment_count: 1,
        },
      },
      executionStateJson: {
        regenerate_used: false,
      },
      graphTraceSummaryJson: storyboardTrace,
      runtimeDiagnosticsJson: {
        checks: [
          {
            code: "storyboard_local_validation_passed",
            level: "info",
          },
        ],
      },
    });

    project.activeTopicPackageId = topicPackage.id;
    project.activeScriptRecordId = scriptRecord.id;
    project.activeStoryboardRecordId = storyboardRecord.id;
    project.latestStoryboardRunTraceJson = storyboardTrace;
    project.status = "storyboard_ready";

    const snapshot = await getProjectSnapshot(db, project.id);

    expect(snapshot).toMatchObject({
      project_id: project.id,
      current_status: "storyboard_ready",
      restore_route: `/projects/${project.id}/storyboard`,
      active_storyboard: {
        storyboard_record_id: storyboardRecord.id,
        source_script_record_id: scriptRecord.id,
        local_validation: {
          stage: "storyboard_local_validation",
          decision: "pass",
        },
        execution_state: {
          regenerate_used: false,
        },
        graph_trace_summary: storyboardTrace,
        runtime_diagnostics: {
          checks: [
            {
              code: "storyboard_local_validation_passed",
              level: "info",
            },
          ],
        },
      },
      trace_summary: {
        latest_storyboard_run: {
          run_id: "storyboard_run_snapshot_1",
          phase: "storyboard",
          step_count: 2,
          latest_step: "local-validate",
        },
      },
    });
  });

  it("restores active asset plan and latest asset planning trace summary", async () => {
    const db = createDbClient();
    const project = await createProject(db, {
      name: "Asset Plan Snapshot",
    });
    const storageProfile = getProjectStorageProfile(project);
    expect(storageProfile.asset_plan_runs_dir).toContain("asset-planning-runs");

    const topicPackage = await saveTopicPackage(db, {
      projectId: project.id,
      title: "Asset Plan Topic",
      selectedAngle: "A storyboard becomes production tasks.",
      familyLabel: "diplomacy",
      scopeLabel: "single_event",
      coreConflict: "The envoy must answer in front of everyone.",
      strongScene: "The hall falls quiet after the answer.",
      packagingSeed: "One sentence changes the room.",
      durationBandJson: {
        label: "medium",
      },
      narrativeTensionMapJson: {
        hook_claim: "A public pressure scene begins.",
        pressure_escalation: "The insult keeps rising.",
        mid_reveal: "The answer is guarding the state's face.",
        peak_payoff: "The reply reverses the pressure.",
        ending_residue: "Retreat would cost more than silence.",
      },
    });
    const scriptRecord = await saveScriptRecord(db, {
      projectId: project.id,
      topicPackageId: topicPackage.id,
      scriptText: "Opening pressure. The envoy answers in public.",
      openingSpan: "Opening pressure.",
      endingSpan: "The envoy answers in public.",
      estimatedDurationSec: 30,
      beatTraceJson: [],
      quoteTraceJson: [],
      reviewStatus: "pass",
      validationResultJson: {
        stage: "script_local_validation",
        decision: "pass",
      },
      semanticReviewResultJson: {
        stage: "script_semantic_review",
        decision: "pass",
        patch_intent: null,
      },
      executionStateJson: {
        patch_used: false,
        regenerate_used: false,
      },
    });
    const storyboardRecord = await saveStoryboardRecord(db, {
      projectId: project.id,
      topicPackageId: topicPackage.id,
      scriptRecordId: scriptRecord.id,
      planJson: {
        plan_version: "storyboard_v1",
        source_script_record_id: scriptRecord.id,
        source_topic_package_id: topicPackage.id,
        segments: [
          {
            segment_id: "sb_001",
            script_excerpt: "Opening pressure.",
          },
        ],
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
      graphTraceSummaryJson: null,
      runtimeDiagnosticsJson: null,
    });
    const assetPlanTrace = {
      phase: "asset_planning",
      run_id: "asset_plan_run_1",
      steps: [
        {
          step_name: "asset-planning-generate",
          phase: "asset_planning",
          status: "succeeded",
        },
        {
          step_name: "asset-planning-local-validate",
          phase: "asset_planning",
          status: "succeeded",
        },
      ],
    };
    const assetPlan: AssetPlan = {
      plan_version: "asset_plan_v1",
      source_storyboard_record_id: storyboardRecord.id,
      source_script_record_id: scriptRecord.id,
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
        estimated_total_duration_sec: 30,
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
    };
    const localValidation: AssetPlanningValidationResult = {
      stage: "asset_planning_local_validation",
      decision: "pass",
      errors: [],
      warnings: [],
      metrics: {
        task_count: 1,
      },
    };
    const assetPlanRecord = await saveAssetPlanRecord(db, {
      projectId: project.id,
      topicPackageId: topicPackage.id,
      scriptRecordId: scriptRecord.id,
      storyboardRecordId: storyboardRecord.id,
      planJson: assetPlan,
      validationResultJson: localValidation,
      executionStateJson: {
        regenerate_used: false,
      },
      graphTraceSummaryJson: assetPlanTrace,
      runtimeDiagnosticsJson: {
        checks: [
          {
            code: "asset_planning_local_validation_passed",
            level: "info",
          },
        ],
      },
    });

    project.activeTopicPackageId = topicPackage.id;
    project.activeScriptRecordId = scriptRecord.id;
    project.activeStoryboardRecordId = storyboardRecord.id;
    project.activeAssetPlanRecordId = assetPlanRecord.id;
    project.latestAssetPlanRunTraceJson = assetPlanTrace;
    project.status = "asset_plan_ready";

    const snapshot = await getProjectSnapshot(db, project.id);

    expect(snapshot).toMatchObject({
      project_id: project.id,
      current_status: "asset_plan_ready",
      active_asset_plan: {
        asset_plan_record_id: assetPlanRecord.id,
        source_storyboard_record_id: storyboardRecord.id,
        source_script_record_id: scriptRecord.id,
        source_topic_package_id: topicPackage.id,
        plan: assetPlan,
        local_validation: localValidation,
        execution_state: {
          regenerate_used: false,
        },
        graph_trace_summary: assetPlanTrace,
        runtime_diagnostics: {
          checks: [
            {
              code: "asset_planning_local_validation_passed",
              level: "info",
            },
          ],
        },
      },
      trace_summary: {
        latest_asset_plan_run: {
          run_id: "asset_plan_run_1",
          phase: "asset_planning",
          step_count: 2,
          latest_step: "asset-planning-local-validate",
        },
      },
    });
  });

  it("does not expose stale asset plan records when active pointers are cleared", async () => {
    const db = createDbClient();
    const project = await createProject(db, {
      name: "Cleared Asset Plan Snapshot",
    });
    const assetPlan: AssetPlan = {
      plan_version: "asset_plan_v1",
      source_storyboard_record_id: "storyboard_record_old",
      source_script_record_id: "script_record_old",
      source_topic_package_id: "topic_package_old",
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
        estimated_total_duration_sec: 30,
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
    };
    const assetPlanRecord = await saveAssetPlanRecord(db, {
      projectId: project.id,
      topicPackageId: "topic_package_old",
      scriptRecordId: "script_record_old",
      storyboardRecordId: "storyboard_record_old",
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
      graphTraceSummaryJson: {
        phase: "asset_planning",
        run_id: "asset_plan_run_old",
        steps: [],
      },
      runtimeDiagnosticsJson: null,
    });
    project.activeAssetPlanRecordId = assetPlanRecord.id;
    project.latestAssetPlanRunTraceJson = {
      phase: "asset_planning",
      run_id: "asset_plan_run_old",
      steps: [],
    };

    project.activeAssetPlanRecordId = null;
    project.latestAssetPlanRunTraceJson = null;

    const snapshot = await getProjectSnapshot(db, project.id);

    expect(snapshot?.active_asset_plan).toBeNull();
    expect(snapshot?.trace_summary.latest_asset_plan_run).toBeNull();
  });

  it("restores active asset manifest when project has active manifest pointer", async () => {
    const db = createDbClient();
    const project = await createProject(db, {
      name: "Asset Manifest Snapshot",
    });
    const topicPackage = await saveTopicPackage(db, {
      projectId: project.id,
      title: "Asset Manifest Topic",
      selectedAngle: "A public answer reverses the pressure.",
      familyLabel: "diplomacy",
      scopeLabel: "single_event",
      coreConflict: "The envoy must answer in front of everyone.",
      strongScene: "The hall falls quiet after the answer.",
      packagingSeed: "One sentence changes the room.",
      durationBandJson: { label: "medium" },
      narrativeTensionMapJson: {
        hook_claim: "A public pressure scene begins.",
        pressure_escalation: "The insult keeps rising.",
        mid_reveal: "The answer is guarding the state's face.",
        peak_payoff: "The reply reverses the pressure.",
        ending_residue: "Retreat would cost more than silence.",
      },
    });
    project.activeTopicPackageId = topicPackage.id;

    // Create script and storyboard records so resolveEffectiveStatus
    // does not downgrade the stage.
    const scriptRec = await saveScriptRecord(db, {
      projectId: project.id,
      topicPackageId: topicPackage.id,
      scriptText: "测试脚本",
      openingSpan: "开场",
      endingSpan: "结尾",
      estimatedDurationSec: 60,
      beatTraceJson: [],
      quoteTraceJson: [],
      reviewStatus: "pass",
      validationResultJson: { stage: "script_local_validation", decision: "pass" },
      semanticReviewResultJson: { stage: "script_semantic_review", decision: "pass", patch_intent: null },
      executionStateJson: { patch_used: false, regenerate_used: false },
    });
    project.activeScriptRecordId = scriptRec.id;

    const storyRec = await saveStoryboardRecord(db, {
      projectId: project.id,
      topicPackageId: topicPackage.id,
      scriptRecordId: scriptRec.id,
      planJson: { plan_version: "storyboard_v1", segments: [] },
      validationResultJson: { stage: "storyboard_local_validation", decision: "pass", errors: [], warnings: [], metrics: {} },
      executionStateJson: { regenerate_used: false },
    });
    project.activeStoryboardRecordId = storyRec.id;

    const assetsTrace = {
      phase: "assets",
      run_id: "assets_run_snapshot_1",
      steps: [
        {
          step_name: "assets-generate",
          phase: "assets",
          status: "succeeded",
        },
        {
          step_name: "assets-local-validate",
          phase: "assets",
          status: "succeeded",
        },
      ],
    };
    const manifestRecord = await saveAssetManifestRecord(db, {
      projectId: project.id,
      topicPackageId: topicPackage.id,
      scriptRecordId: scriptRec.id,
      storyboardRecordId: storyRec.id,
      assetPlanRecordId: "asset_plan_record_1",
      manifestJson: {
        manifest_version: "asset_manifest_v1",
        source_asset_plan_record_id: "asset_plan_record_1",
        segments: [
          {
            segment_id: "seg_001",
            asset_route: "image",
          },
        ],
        task_executions: [
          {
            task_id: "task_001",
            status: "completed",
          },
        ],
        bgm_placements: [],
      },
      validationResultJson: {
        stage: "assets_local_validation",
        decision: "pass",
        errors: [],
        warnings: [],
        metrics: { segment_count: 1 },
      },
      executionStateJson: {
        execution_mode: "full_auto",
        activated: true,
      },
      graphTraceSummaryJson: assetsTrace,
      runtimeDiagnosticsJson: null,
    });

    project.activeAssetManifestRecordId = manifestRecord.id;
    project.latestAssetsRunTraceJson = assetsTrace;
    project.status = "assets_ready";

    const snapshot = await getProjectSnapshot(db, project.id);

    expect(snapshot).toMatchObject({
      project_id: project.id,
      current_status: "assets_ready",
      active_assets: {
        asset_manifest_record_id: manifestRecord.id,
        source_topic_package_id: topicPackage.id,
        source_script_record_id: scriptRec.id,
        source_storyboard_record_id: storyRec.id,
        source_asset_plan_record_id: "asset_plan_record_1",
        manifest: {
          manifest_version: "asset_manifest_v1",
        },
        local_validation: {
          stage: "assets_local_validation",
          decision: "pass",
        },
        execution_state: {
          execution_mode: "full_auto",
          activated: true,
        },
        graph_trace_summary: assetsTrace,
      },
      trace_summary: {
        latest_assets_run: {
          run_id: "assets_run_snapshot_1",
          phase: "assets",
          step_count: 2,
          latest_step: "assets-local-validate",
        },
      },
    });
    expect(snapshot?.active_assets?.runtime_diagnostics).toBeNull();
  });

  it("does not expose stale asset manifest when active pointer is cleared", async () => {
    const db = createDbClient();
    const project = await createProject(db, {
      name: "Cleared Asset Manifest Snapshot",
    });
    const manifestRecord = await saveAssetManifestRecord(db, {
      projectId: project.id,
      topicPackageId: "topic_pkg_old",
      scriptRecordId: "script_old",
      storyboardRecordId: "storyboard_old",
      assetPlanRecordId: "asset_plan_old",
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
        activated: false,
      },
      graphTraceSummaryJson: {
        phase: "assets",
        run_id: "assets_run_old",
        steps: [],
      },
      runtimeDiagnosticsJson: null,
    });

    project.activeAssetManifestRecordId = manifestRecord.id;
    project.latestAssetsRunTraceJson = {
      phase: "assets",
      run_id: "assets_run_old",
      steps: [],
    };

    // Clear the pointers
    project.activeAssetManifestRecordId = null;
    project.latestAssetsRunTraceJson = null;

    const snapshot = await getProjectSnapshot(db, project.id);

    expect(snapshot?.active_assets).toBeNull();
    expect(snapshot?.trace_summary.latest_assets_run).toBeNull();
  });

  it("restores active compose timeline when project has active compose pointer", async () => {
    const db = createDbClient();
    const project = await createProject(db, {
      name: "Compose Snapshot",
    });
    const manifestRecord = await saveAssetManifestRecord(db, {
      projectId: project.id,
      topicPackageId: "topic_pkg_1",
      scriptRecordId: "script_record_1",
      storyboardRecordId: "storyboard_record_1",
      assetPlanRecordId: "asset_plan_record_1",
      manifestJson: {
        manifest_version: "asset_manifest_v1",
      },
      validationResultJson: {
        stage: "assets_local_validation",
        decision: "pass",
        errors: [],
        warnings: [],
        metrics: {},
      },
      executionStateJson: {
        activated: true,
      },
      graphTraceSummaryJson: null,
      runtimeDiagnosticsJson: null,
    });
    const composeTrace = {
      phase: "compose",
      run_id: "compose_run_snapshot_1",
      steps: [
        {
          step_name: "compose-build-timeline",
          phase: "compose",
          status: "succeeded",
        },
        {
          step_name: "compose-local-validate",
          phase: "compose",
          status: "succeeded",
        },
      ],
    };
    const composeRecord = await saveComposeRecord(db, {
      projectId: project.id,
      assetManifestRecordId: manifestRecord.id,
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
        metrics: {
          duration_sec: 12,
        },
      },
      executionStateJson: {
        activated: true,
      },
      graphTraceSummaryJson: composeTrace,
      runtimeDiagnosticsJson: {
        checks: [
          {
            code: "compose_local_validation_passed",
            level: "info",
          },
        ],
      },
    });

    project.activeAssetManifestRecordId = manifestRecord.id;
    project.activeComposeRecordId = composeRecord.id;
    project.latestComposeRunTraceJson = composeTrace;
    project.status = "compose_ready";

    const snapshot = await getProjectSnapshot(db, project.id);

    expect(snapshot).toMatchObject({
      project_id: project.id,
      current_status: "compose_ready",
      active_compose: {
        compose_record_id: composeRecord.id,
        source_asset_manifest_record_id: manifestRecord.id,
        timeline: {
          timeline_version: "compose_timeline_v1",
          duration_sec: 12,
        },
        local_validation: {
          stage: "compose_local_validation",
          decision: "ready_for_render",
        },
        execution_state: {
          activated: true,
        },
        graph_trace_summary: composeTrace,
        runtime_diagnostics: {
          checks: [
            {
              code: "compose_local_validation_passed",
              level: "info",
            },
          ],
        },
      },
      trace_summary: {
        latest_compose_run: {
          run_id: "compose_run_snapshot_1",
          phase: "compose",
          step_count: 2,
          latest_step: "compose-local-validate",
        },
      },
    });
  });

  it("does not expose stale compose when active pointer is cleared", async () => {
    const db = createDbClient();
    const project = await createProject(db, {
      name: "Cleared Compose Snapshot",
    });
    const composeRecord = await saveComposeRecord(db, {
      projectId: project.id,
      assetManifestRecordId: "asset_manifest_old",
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
        activated: false,
      },
      graphTraceSummaryJson: {
        phase: "compose",
        run_id: "compose_run_old",
        steps: [],
      },
      runtimeDiagnosticsJson: null,
    });

    project.activeComposeRecordId = composeRecord.id;
    project.latestComposeRunTraceJson = {
      phase: "compose",
      run_id: "compose_run_old",
      steps: [],
    };

    project.activeComposeRecordId = null;
    project.latestComposeRunTraceJson = null;

    const snapshot = await getProjectSnapshot(db, project.id);

    expect(snapshot?.active_compose).toBeNull();
    expect(snapshot?.trace_summary.latest_compose_run).toBeNull();
  });

  it("restores active render job when project has active render pointer", async () => {
    const db = createDbClient();
    const project = await createProject(db, {
      name: "Render Snapshot",
    });

    // Create upstream records so resolveEffectiveStatus does not downgrade
    const rTopic = await saveTopicPackage(db, {
      projectId: project.id,
      title: "Render Topic",
      selectedAngle: "Test angle",
      familyLabel: "test",
      scopeLabel: "single_event",
      coreConflict: "conflict",
      strongScene: "scene",
      packagingSeed: "seed",
      durationBandJson: { label: "medium" },
      narrativeTensionMapJson: { hook_claim: "hook" },
    });
    project.activeTopicPackageId = rTopic.id;

    const rScript = await saveScriptRecord(db, {
      projectId: project.id,
      topicPackageId: rTopic.id,
      scriptText: "测试脚本",
      openingSpan: "开场",
      endingSpan: "结尾",
      estimatedDurationSec: 60,
      beatTraceJson: [],
      quoteTraceJson: [],
      reviewStatus: "pass",
      validationResultJson: { stage: "script_local_validation", decision: "pass" },
      semanticReviewResultJson: { stage: "script_semantic_review", decision: "pass", patch_intent: null },
      executionStateJson: { patch_used: false, regenerate_used: false },
    });
    project.activeScriptRecordId = rScript.id;

    const rStory = await saveStoryboardRecord(db, {
      projectId: project.id,
      topicPackageId: rTopic.id,
      scriptRecordId: rScript.id,
      planJson: { plan_version: "storyboard_v1", segments: [] },
      validationResultJson: { stage: "storyboard_local_validation", decision: "pass", errors: [], warnings: [], metrics: {} },
      executionStateJson: { regenerate_used: false },
    });
    project.activeStoryboardRecordId = rStory.id;

    const rManifest = await saveAssetManifestRecord(db, {
      projectId: project.id,
      topicPackageId: rTopic.id,
      scriptRecordId: rScript.id,
      storyboardRecordId: rStory.id,
      assetPlanRecordId: "asset_plan_001",
      manifestJson: { manifest_version: "asset_manifest_v1", artifacts: [], executions: [], audio_summary: {}, segment_routes: [], readiness: "ready", notes: [] },
      validationResultJson: { stage: "assets_local_validation", decision: "pass", errors: [], warnings: [], metrics: {} },
      executionStateJson: { activated: true },
      graphTraceSummaryJson: null,
      runtimeDiagnosticsJson: null,
    });
    project.activeAssetManifestRecordId = rManifest.id;

    const rCompose = await saveComposeRecord(db, {
      projectId: project.id,
      assetManifestRecordId: rManifest.id,
      timelineJson: { timeline_version: "compose_timeline_v1", duration_sec: 60, tracks: [], segments: [] },
      validationResultJson: { stage: "compose_local_validation", decision: "ready_for_render", errors: [], warnings: [], metrics: {} },
      executionStateJson: { activated: true },
      graphTraceSummaryJson: null,
      runtimeDiagnosticsJson: null,
    });
    project.activeComposeRecordId = rCompose.id;

    const renderTrace = {
      phase: "render",
      run_id: "render_run_snapshot_1",
      steps: [
        {
          step_name: "render-local-validate",
          phase: "render",
          status: "succeeded",
        },
        {
          step_name: "render-export",
          phase: "render",
          status: "succeeded",
        },
      ],
    };
    const outputArtifact = {
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
    };
    const validationResult = {
      stage: "render_local_validation",
      decision: "rendered",
      errors: [],
      warnings: [],
      metrics: {
        duration_sec: 12,
      },
    };
    const renderJobRecord = await saveRenderJobRecord(db, {
      projectId: project.id,
      composeRecordId: rCompose.id,
      assetManifestRecordId: rManifest.id,
      status: "completed",
      profileJson: {
        width: 1080,
        height: 1920,
        fps: 30,
      },
      outputArtifactJson: outputArtifact,
      validationResultJson: validationResult,
      executionStateJson: {
        activated: true,
      },
      graphTraceSummaryJson: renderTrace,
      runtimeDiagnosticsJson: {
        checks: [
          {
            code: "render_output_probe_passed",
            level: "info",
          },
        ],
      },
    });

    project.activeRenderJobRecordId = renderJobRecord.id;
    project.latestRenderRunTraceJson = renderTrace;
    project.status = "render_ready";

    const snapshot = await getProjectSnapshot(db, project.id);

    expect(snapshot).toMatchObject({
      project_id: project.id,
      current_status: "render_ready",
      active_render: {
        render_job_record_id: renderJobRecord.id,
        source_compose_record_id: rCompose.id,
        source_asset_manifest_record_id: rManifest.id,
        status: "completed",
        profile: {
          width: 1080,
          height: 1920,
          fps: 30,
        },
        output_artifact: outputArtifact,
        validation_result: validationResult,
        execution_state: {
          activated: true,
        },
        graph_trace_summary: renderTrace,
        runtime_diagnostics: {
          checks: [
            {
              code: "render_output_probe_passed",
              level: "info",
            },
          ],
        },
      },
      trace_summary: {
        latest_render_run: {
          run_id: "render_run_snapshot_1",
          phase: "render",
          step_count: 2,
          latest_step: "render-export",
        },
      },
    });
  });

  it("does not expose stale render when active pointer is cleared", async () => {
    const db = createDbClient();
    const project = await createProject(db, {
      name: "Cleared Render Snapshot",
    });
    const renderJobRecord = await saveRenderJobRecord(db, {
      projectId: project.id,
      composeRecordId: "compose_old",
      assetManifestRecordId: "asset_manifest_old",
      status: "completed",
      profileJson: {
        width: 1080,
        height: 1920,
        fps: 30,
      },
      outputArtifactJson: null,
      validationResultJson: {
        stage: "render_local_validation",
        decision: "rendered",
        errors: [],
        warnings: [],
        metrics: {},
      },
      executionStateJson: {
        activated: false,
      },
      graphTraceSummaryJson: {
        phase: "render",
        run_id: "render_run_old",
        steps: [],
      },
      runtimeDiagnosticsJson: null,
    });

    project.activeRenderJobRecordId = renderJobRecord.id;
    project.latestRenderRunTraceJson = {
      phase: "render",
      run_id: "render_run_old",
      steps: [],
    };

    project.activeRenderJobRecordId = null;
    project.latestRenderRunTraceJson = null;

    const snapshot = await getProjectSnapshot(db, project.id);

    expect(snapshot?.active_render).toBeNull();
    expect(snapshot?.trace_summary.latest_render_run).toBeNull();
  });

  it("restores active publish package when project has active publish pointer", async () => {
    const db = createDbClient();
    const project = await createProject(db, { name: "Publish Snapshot" });

    // Create upstream records needed for the manifest lookup
    const manifestRecord = await saveAssetManifestRecord(db, {
      projectId: project.id,
      topicPackageId: "topic_001",
      scriptRecordId: "script_001",
      storyboardRecordId: "storyboard_001",
      assetPlanRecordId: "asset_plan_001",
      manifestJson: {
        manifest_version: "asset_manifest_v1",
        artifacts: [
          {
            artifact_id: "cover_art_001",
            artifact_type: "image",
            origin: "provider",
            file_uri: "file://storage/cover.png",
            created_at: "2026-06-17T00:00:00.000Z",
            metadata: {
              mime_type: "image/png",
              width: 1080,
              height: 1920,
            },
          },
        ],
      },
      validationResultJson: { stage: "assets_local_validation", decision: "pass", errors: [], warnings: [], metrics: {} },
      executionStateJson: { activated: true },
      graphTraceSummaryJson: null,
      runtimeDiagnosticsJson: null,
    });

    project.activeAssetManifestRecordId = manifestRecord.id;
    project.activeRenderJobRecordId = "render_001";

    // Create source records so blocked detection passes
    const topicPkg = await saveTopicPackage(db, {
      projectId: project.id,
      title: "测试主题",
      selectedAngle: "测试角度",
      familyLabel: "测试标签",
      scopeLabel: "测试范围",
      coreConflict: "核心冲突",
      strongScene: "强场面",
      packagingSeed: "种子",
      canonicalQuotesJson: [],
      durationBandJson: { label: "medium" },
      narrativeTensionMapJson: { hook_claim: "hook" },
    });
    const scriptRec = await saveScriptRecord(db, {
      projectId: project.id,
      topicPackageId: topicPkg.id,
      scriptText: "测试脚本",
      openingSpan: "开头",
      endingSpan: "结尾",
      estimatedDurationSec: 60,
      beatTraceJson: [],
      quoteTraceJson: [],
      reviewStatus: "pass",
      validationResultJson: { stage: "script_local_validation", decision: "pass" },
      semanticReviewResultJson: { stage: "script_semantic_review", decision: "pass", patch_intent: null },
      executionStateJson: { patch_used: false, regenerate_used: false },
    });
    const renderRec = await saveRenderJobRecord(db, {
      projectId: project.id,
      composeRecordId: "compose_001",
      assetManifestRecordId: manifestRecord.id,
      status: "completed",
      profileJson: { width: 1080, height: 1920, fps: 30 },
      outputArtifactJson: {
        artifact_id: "export_001",
        artifact_type: "rendered_video",
        file_uri: "file://storage/output.mp4",
        duration_sec: 60,
        width: 1080,
        height: 1920,
        fps: 30,
        metadata: {},
      },
      validationResultJson: { stage: "render_local_validation", decision: "rendered", errors: [], warnings: [], metrics: {} },
    });

    project.activeRenderJobRecordId = renderRec.id;

    // Create a publish package record
    const { savePublishPackageRecord } = await import(
      "../../../backend/src/modules/publish/publish-record.repository.js"
    );
    const publishRecord = await savePublishPackageRecord(db, {
      projectId: project.id,
      renderJobRecordId: renderRec.id,
      topicPackageId: topicPkg.id,
      scriptRecordId: scriptRec.id,
      storyboardRecordId: "storyboard_001",
      assetManifestRecordId: manifestRecord.id,
      packageJson: {
        package_version: "publish_package_v1",
        source_render_job_record_id: renderRec.id,
        source_topic_package_id: topicPkg.id,
        source_script_record_id: scriptRec.id,
        source_storyboard_record_id: "storyboard_001",
        source_asset_manifest_record_id: manifestRecord.id,
        video_export_artifact_id: "export_001",
        cover_artifact_id: "cover_art_001",
        cover_prompt_draft: "古代战国宫廷场景",
        cover_origin: "storyboard_image",
        title_candidates: [
          { candidate_id: "c1", text: "测试标题", style: "standard" },
        ],
        selected_title: "测试标题",
        description: "测试描述",
        hashtags: ["历史"],
        platform_profile: "generic",
        readiness: "ready",
        notes: [],
      },
    });

    project.activePublishPackageRecordId = publishRecord.id;

    const snapshot = await getProjectSnapshot(db, project.id);

    expect(snapshot?.active_publish_package).toMatchObject({
      publish_package_record_id: publishRecord.id,
      source_render_job_record_id: renderRec.id,
      is_stale: false,
      stale_reason: null,
      cover_artifact: {
        artifact_id: "cover_art_001",
        file_uri: "file://storage/cover.png",
        mime_type: "image/png",
        width: 1080,
        height: 1920,
      },
    });
    expect(snapshot?.active_publish_package?.package).toMatchObject({
      cover_origin: "storyboard_image",
      readiness: "ready",
    });
  });

  it("marks publish package as stale when render output changed", async () => {
    const db = createDbClient();
    const project = await createProject(db, { name: "Stale Publish" });

    project.activeRenderJobRecordId = "render_v2";

    const { savePublishPackageRecord } = await import(
      "../../../backend/src/modules/publish/publish-record.repository.js"
    );
    const publishRecord = await savePublishPackageRecord(db, {
      projectId: project.id,
      renderJobRecordId: "render_v1",
      topicPackageId: "topic_001",
      scriptRecordId: "script_001",
      storyboardRecordId: "storyboard_001",
      assetManifestRecordId: "asset_manifest_001",
      packageJson: {
        package_version: "publish_package_v1",
        source_render_job_record_id: "render_v1",
        source_topic_package_id: "topic_001",
        source_script_record_id: "script_001",
        source_storyboard_record_id: "storyboard_001",
        source_asset_manifest_record_id: "asset_manifest_001",
        video_export_artifact_id: "export_001",
        cover_artifact_id: null,
        cover_prompt_draft: null,
        cover_origin: "storyboard_image",
        title_candidates: [],
        selected_title: "",
        description: "",
        hashtags: [],
        platform_profile: "generic",
        readiness: "draft",
        notes: [],
      },
    });

    project.activePublishPackageRecordId = publishRecord.id;

    const snapshot = await getProjectSnapshot(db, project.id);

    expect(snapshot?.active_publish_package).toMatchObject({
      is_stale: true,
      stale_reason: "render_output_changed",
    });
  });

  it("does not expose publish package when active pointer is null", async () => {
    const db = createDbClient();
    const project = await createProject(db, { name: "No Publish" });

    expect(project.activePublishPackageRecordId).toBeNull();

    const snapshot = await getProjectSnapshot(db, project.id);

    expect(snapshot?.active_publish_package).toBeNull();
  });

  it("returns null cover_artifact when cover_artifact_id is null", async () => {
    const db = createDbClient();
    const project = await createProject(db, { name: "Null Cover" });

    const { savePublishPackageRecord } = await import(
      "../../../backend/src/modules/publish/publish-record.repository.js"
    );
    const publishRecord = await savePublishPackageRecord(db, {
      projectId: project.id,
      renderJobRecordId: "render_001",
      topicPackageId: "topic_001",
      scriptRecordId: "script_001",
      storyboardRecordId: "storyboard_001",
      assetManifestRecordId: "asset_manifest_001",
      packageJson: {
        package_version: "publish_package_v1",
        source_render_job_record_id: "render_001",
        source_topic_package_id: "topic_001",
        source_script_record_id: "script_001",
        source_storyboard_record_id: "storyboard_001",
        source_asset_manifest_record_id: "asset_manifest_001",
        video_export_artifact_id: "export_001",
        cover_artifact_id: null,
        cover_prompt_draft: null,
        cover_origin: "storyboard_image",
        title_candidates: [],
        selected_title: "",
        description: "",
        hashtags: [],
        platform_profile: "generic",
        readiness: "draft",
        notes: [],
      },
    });

    project.activePublishPackageRecordId = publishRecord.id;

    const snapshot = await getProjectSnapshot(db, project.id);

    expect(snapshot?.active_publish_package?.cover_artifact).toBeNull();
  });

  it("marks publish package readiness as blocked when source records are missing", async () => {
    const db = createDbClient();
    const project = await createProject(db, { name: "Blocked Publish" });

    // Create a publish package referencing non-existent topic/script/render records
    const { savePublishPackageRecord } = await import(
      "../../../backend/src/modules/publish/publish-record.repository.js"
    );
    const publishRecord = await savePublishPackageRecord(db, {
      projectId: project.id,
      renderJobRecordId: "missing_render",
      topicPackageId: "missing_topic",
      scriptRecordId: "missing_script",
      storyboardRecordId: "storyboard_001",
      assetManifestRecordId: "asset_manifest_001",
      packageJson: {
        package_version: "publish_package_v1",
        source_render_job_record_id: "missing_render",
        source_topic_package_id: "missing_topic",
        source_script_record_id: "missing_script",
        source_storyboard_record_id: "storyboard_001",
        source_asset_manifest_record_id: "asset_manifest_001",
        video_export_artifact_id: "export_001",
        cover_artifact_id: null,
        cover_prompt_draft: null,
        cover_origin: "storyboard_image",
        title_candidates: [],
        selected_title: "测试",
        description: "描述",
        hashtags: [],
        platform_profile: "generic",
        readiness: "ready",
        notes: [],
      },
    });

    project.activePublishPackageRecordId = publishRecord.id;

    const snapshot = await getProjectSnapshot(db, project.id);

    // Readiness should be downgraded to blocked because source records don't exist
    expect(snapshot?.active_publish_package?.package).toMatchObject({
      readiness: "blocked",
    });
  });

  it("口播前置绑定音色时每镜路线投影不误报音色不可用", async () => {
    const db = createDbClient();
    for (const m of buildPricingCatalogSeed({ llm: { mode: "stub" }, media: { deploymentScope: "cn-beijing" } })) {
      db.providerModelCatalog.set(m.id, m);
    }
    await seedGlobalVoiceProfiles(db);
    const project = await createProject(db, { name: "Voice Bound Project" });
    // 口播前置模式：创建时绑定系统音色（档案 ready/public）
    const configRecord = findProjectConfigRecord(db, project.id)!;
    (configRecord.configurationJson as { creative: { voice_profile_id: string | null } }).creative.voice_profile_id =
      "voice_narration_qwen_longyimuling";
    // 钉死前置条件：若绑定未生效（如仓储改为返回副本），用例会空转通过
    expect(
      (findProjectConfigRecord(db, project.id)!.configurationJson as { creative: { voice_profile_id: string | null } }).creative.voice_profile_id,
    ).toBe("voice_narration_qwen_longyimuling");

    const topicPackage = await saveTopicPackage(db, {
      projectId: project.id,
      title: "晏子使楚",
      selectedAngle: "楚王不是只压了晏子一次，而是连压三次。",
      familyLabel: "外交压场型",
      scopeLabel: "完整事件",
      coreConflict: "楚王借公开场合连续羞辱晏子与齐国，晏子必须当场顶回去。",
      strongScene: "楚王连续压场，晏子一句句顶回去。",
      packagingSeed: "楚王连压三次，晏子一次没退。",
      canonicalQuotesJson: ["橘生淮南则为橘"],
      durationBandJson: { label: "medium" },
      narrativeTensionMapJson: {
        hook_claim: "楚王不是只压了晏子一次，而是连压三次",
        pressure_escalation: "从羞辱身形升级到羞辱齐国",
        mid_reveal: "晏子不是在逞口舌",
        peak_payoff: "橘枳之喻把第三次压场原样顶回",
        ending_residue: "这种场面，一退就不只是退掉自己",
      },
      mustIncludeBeatsJson: ["入楚受辱", "橘枳之喻"],
      forbiddenExpansionsJson: ["不要扩写到未定 downstream 阶段"],
      riskHintsJson: ["不要把内容写成课堂导入"],
      sourceAnchorRefsJson: ["《晏子春秋》"],
    });
    const scriptRecord = await saveScriptRecord(db, {
      projectId: project.id,
      topicPackageId: topicPackage.id,
      scriptText: "汉".repeat(18),
      openingSpan: "开",
      endingSpan: "尾",
      estimatedDurationSec: 5,
      beatTraceJson: [],
      quoteTraceJson: [],
      reviewStatus: "pass",
      validationResultJson: { stage: "script_local_validation", decision: "pass", errors: [], warnings: [], metrics: {} },
    });

    // 真实 v2 计划（含每镜 api_video_suitability），与口播前置项目一致
    const text = "汉".repeat(18);
    const audioHash = "a".repeat(64);
    const timingMap = normalizeNarrationTiming({
      sourceText: text, audioHash, durationMs: 4500,
      sentences: [{ providerSentenceIndex: 0, originalText: text, normalizedText: text,
        words: Array.from(text, (c, i) => ({ text: c, begin_index: i, end_index: i + 1, begin_time: i * 250, end_time: (i + 1) * 250 })) }],
    });
    const reference = { narration_record_id: "n1", audio_hash: audioHash, timing_map_hash: createHash("sha256").update(canonicalStringify(timingMap)).digest("hex"), duration_ms: 4500 };
    const visual = { narrative_role: "opening", visual_intent: "宫门", scene_description: "宫门", visual_elements: ["门"],
      framing_hint: "wide", content_type: "live_action", motion_hint: "static", editing_hint: "single",
      on_screen_text: [], linked_beats: [], linked_quotes: [], risk_notes: [], api_video_suitability: "remotion_sufficient" as const };
    const plan = projectStoryboardTiming({ timingMap, narrationReference: reference, plan: {
      plan_version: "storyboard_v2", source_script_record_id: scriptRecord.id, source_topic_package_id: topicPackage.id,
      global_visual_notes: [], segments: [
        { ...visual, segment_id: "sb_1", order: 0, start_boundary_id: timingMap.boundaries[0]!.id, end_boundary_id: timingMap.boundaries[6]!.id },
        { ...visual, segment_id: "sb_2", order: 1, start_boundary_id: timingMap.boundaries[6]!.id, end_boundary_id: timingMap.boundaries[18]!.id },
      ] } });

    const storyboardRecord = await saveStoryboardRecord(db, {
      projectId: project.id,
      topicPackageId: topicPackage.id,
      scriptRecordId: scriptRecord.id,
      planJson: plan as unknown as Record<string, unknown>,
      validationResultJson: { stage: "storyboard_local_validation", decision: "pass", errors: [], warnings: [], metrics: { segment_count: 2 } },
      executionStateJson: { regenerate_used: false },
      graphTraceSummaryJson: { steps: [] },
      runtimeDiagnosticsJson: { checks: [] },
    });
    project.activeTopicPackageId = topicPackage.id;
    project.activeScriptRecordId = scriptRecord.id;
    project.activeStoryboardRecordId = storyboardRecord.id;
    project.status = "storyboard_ready";

    const snapshot = await getProjectSnapshot(db, project.id);
    const strategies = (snapshot?.active_storyboard as { segment_strategies?: Array<{ unavailable_reason: string | null; resolved_route: string }> }).segment_strategies;
    expect(strategies).toHaveLength(2);
    for (const s of strategies!) {
      expect(s.unavailable_reason).toBeNull();
      expect(s.resolved_route).toBeTruthy();
    }
  });
});
