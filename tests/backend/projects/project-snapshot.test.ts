import { describe, expect, it } from "vitest";

import type {
  AssetPlan,
  AssetPlanningValidationResult,
} from "../../../shared/src/index.js";
import { createDbClient } from "../../../backend/src/db/client.js";
import { createProject } from "../../../backend/src/modules/projects/project.repository.js";
import { getProjectSnapshot } from "../../../backend/src/modules/projects/project-snapshot.service.js";
import { saveAssetPlanRecord } from "../../../backend/src/modules/asset-planning/asset-plan-record.repository.js";
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
          /storage\/projects\/\d{4}-\d{2}-\d{2}\/Snapshot Project \[p_[a-z0-9]{8}\]/i,
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
      restore_route: `/projects/${project.id}/script`,
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
});
