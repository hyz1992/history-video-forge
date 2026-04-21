import { describe, expect, it } from "vitest";

import { createDbClient } from "../../../backend/src/db/client.js";
import { createProject } from "../../../backend/src/modules/projects/project.repository.js";
import { getProjectSnapshot } from "../../../backend/src/modules/projects/project-snapshot.service.js";
import { saveScriptRecord } from "../../../backend/src/modules/script/script-record.repository.js";
import { saveTopicPackage } from "../../../backend/src/modules/topic/topic-package.repository.js";

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
    expect(snapshot?.active_script?.local_validation.stage).toBe(
      "script_local_validation",
    );
    expect(snapshot?.active_script?.semantic_review.stage).toBe(
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
});
