import { statSync } from "node:fs";
import type { DbClient, ScriptRecord } from "../../db/client";
import { getProjectStorageProfile } from "../../runtime/trace/project-storage.js";
import { getProjectGenerationConfiguration } from "../generation-config/generation-config.repository.js";
import { decodeStoredStoryboardPlan } from "../storyboard/storyboard-plan-compatibility.js";
import { resolveGenerationConfiguration } from "../../../../shared/src/index.js";
import { resolveSystemGenerationConstraints, unavailableReasonFromRoute } from "../generation-config/system-constraints.js";

function summarizeTraceRun(trace: Record<string, unknown> | null | undefined) {
  if (!trace) {
    return null;
  }

  const steps = Array.isArray(trace.steps) ? trace.steps : [];
  const latestStep = steps.at(-1);

  return {
    run_id: typeof trace.run_id === "string" ? trace.run_id : null,
    phase: typeof trace.phase === "string" ? trace.phase : null,
    step_count: steps.length,
    latest_step:
      latestStep && typeof latestStep === "object" && latestStep
        ? ((latestStep as Record<string, unknown>).step_name as string | undefined) ?? null
        : null,
  };
}

function statusToStep(status: string): string {
  if (status === "topic_candidates_ready") return "topic";
  if (status.startsWith("topic")) return "topic";
  if (status.startsWith("script")) return "script";
  if (status.startsWith("storyboard")) return "storyboard";
  if (status.startsWith("asset_plan") || status.startsWith("assets")) return "asset";
  if (status.startsWith("compos")) return "compose";
  if (status.startsWith("render")) return "render";
  return "topic";
}

function isDraft(status: string): boolean {
  return status.startsWith("topic") || status === "topic_candidates_ready" || status === "topic_pending";
}

function mapScriptRecordToSnapshot(record: ScriptRecord) {
  return {
    script_record_id: record.id,
    script_text: record.scriptText,
    opening_span: record.openingSpan,
    ending_span: record.endingSpan,
    estimated_duration_sec: record.estimatedDurationSec,
    review_decision:
      (record.semanticReviewResultJson?.decision as string | undefined) ??
      record.reviewStatus,
    patch_intent:
      (record.semanticReviewResultJson?.patch_intent as
        | string
        | null
        | undefined) ?? null,
    local_validation: record.validationResultJson,
    semantic_review: record.semanticReviewResultJson,
    execution_state: record.executionStateJson ?? {
      patch_used: false,
      regenerate_used: false,
    },
    graph_trace_summary: record.graphTraceSummaryJson,
    runtime_diagnostics: record.runtimeDiagnosticsJson,
    created_at: record.createdAt.toISOString(),
  };
}

/**
 * Downgrade the project status based on which active records actually exist.
 * A project recovered from disk may have lost its in-memory active records;
 * we must not claim it is at a stage whose data is missing.
 */
export function resolveEffectiveStatus(project: {
  status: string;
  activeTopicPackageId: string | null;
  activeScriptRecordId: string | null;
  activeStoryboardRecordId: string | null;
  activeAssetManifestRecordId: string | null;
  activeComposeRecordId: string | null;
  activeRenderJobRecordId: string | null;
}): string {
  const s = project.status;
  // Walk down from the claimed stage to the highest stage that has data
  if (s.startsWith("render") && !project.activeComposeRecordId) return resolveEffectiveStatus({ ...project, status: "compose_ready" });
  if (s.startsWith("compos") && !project.activeAssetManifestRecordId) return resolveEffectiveStatus({ ...project, status: "assets_ready" });
  if ((s.startsWith("assets") || s.startsWith("asset_plan")) && !project.activeStoryboardRecordId) return resolveEffectiveStatus({ ...project, status: "storyboard_ready" });
  if (s.startsWith("storyboard") && !project.activeScriptRecordId) return resolveEffectiveStatus({ ...project, status: "script_ready" });
  if (s.startsWith("script") && !project.activeTopicPackageId) return "topic_pending";
  return s;
}

/**
 * S2-2A 任务 4：storyboard 快照段。
 * - plan 经兼容解码器输出（旧记录不含 visual_strategy_preference）。
 * - 附加 segment_strategies 投影：suitability、override、override_revision、
 *   resolved_route、reason_code（前端三态展示的数据源）。
 */
async function buildStoryboardSnapshotSegment(
  db: DbClient,
  project: import("../../db/client.js").ProjectRecord,
  storyboardRecord: import("../../db/client.js").StoryboardRecord,
  demoMode: boolean,
): Promise<Record<string, unknown>> {
  const decoded = decodeStoredStoryboardPlan(storyboardRecord.planJson);
  const plan = decoded.ok ? decoded.value.plan : null;

  // P2：真实系统约束单一来源（demo 态禁用真实视频 provider）
  const constraints = resolveSystemGenerationConstraints(demoMode);

  // 解析每段路线（项目配置 + override + suitability）
  let segmentStrategies: Array<Record<string, unknown>> = [];
  if (plan) {
    const overrides = [...db.storyboardSegmentOverrides.values()].filter(
      (o) => o.storyboardRecordId === storyboardRecord.id,
    );
    const configResult = await getProjectGenerationConfiguration(db, project.id, project.ownerId);
    const resolved = resolveGenerationConfiguration({
      projectConfiguration: configResult.configuration,
      projectConfigurationRevision: configResult.revision,
      sourceUserPreferenceRevision: configResult.sourceUserPreferenceRevision,
      systemConstraints: constraints,
      providerModelCatalog: [...db.providerModelCatalog.values()].map((entry) => ({
        provider_model_id: entry.id,
        capability: entry.capability,
        provider_key: entry.providerKey,
        model_id: entry.modelId,
        model_version: entry.modelVersion,
        status: entry.status,
        is_default: entry.isDefault,
      })),
      operation: "assets.generate",
      segmentInputs: plan.segments.map((s) => ({
        segment_id: s.segment_id,
        api_video_suitability: s.api_video_suitability,
      })),
      segmentOverrides: Object.fromEntries(
        overrides.map((o) => [o.segmentId, o.strategyOverride]),
      ),
    });
    const routesById = resolved.ok
      ? new Map(resolved.value.segment_visual_routes.map((r) => [r.segment_id, r]))
      : new Map();
    // P1：统一 reason_code → 不可用原因映射。
    // 系统约束降级时 resolver 正常返回 ok=true（reason_code=api_video_provider_disabled），
    // 此时必须展示降级原因；只有真正解析失败才用错误消息。
    const resolveUnavailable = (reasonCode: string): string | null =>
      resolved.ok
        ? unavailableReasonFromRoute(reasonCode)
        : (resolved.error?.message ?? "配置或目录解析失败，暂按 Remotion 预览");
    segmentStrategies = plan.segments.map((segment) => {
      const override = overrides.find((o) => o.segmentId === segment.segment_id) ?? null;
      const route = routesById.get(segment.segment_id);
      const reasonCode = route?.reason_code ?? "strategy_matrix_remotion";
      return {
        segment_id: segment.segment_id,
        api_video_suitability: segment.api_video_suitability,
        strategy_override: override?.strategyOverride ?? null,
        override_revision: override?.revision ?? null,
        resolved_route: route?.resolved_route ?? "remotion",
        reason_code: reasonCode,
        unavailable_reason: resolveUnavailable(reasonCode),
      };
    });
  }

  return {
    storyboard_record_id: storyboardRecord.id,
    source_script_record_id: storyboardRecord.scriptRecordId,
    plan,
    local_validation: storyboardRecord.validationResultJson,
    execution_state: storyboardRecord.executionStateJson ?? { regenerate_used: false },
    graph_trace_summary: storyboardRecord.graphTraceSummaryJson,
    runtime_diagnostics: storyboardRecord.runtimeDiagnosticsJson,
    // S2-2A：分镜策略投影（四层信息展示：适配度/覆盖/路线/原因）
    segment_strategies: segmentStrategies,
  };
}

export async function getProjectSnapshot(
  db: DbClient,
  projectId: string,
  topicCandidateStore?: Map<string, any>,
  options?: { demoMode?: boolean },
) {
  const project = db.projects.get(projectId);
  if (!project) {
    return null;
  }
  const storageProfile = getProjectStorageProfile(project);

  const topicRecord = project.activeTopicPackageId
    ? db.topicPackages.get(project.activeTopicPackageId) ?? null
    : null;
  const scriptRecord = project.activeScriptRecordId
    ? db.scriptRecords.get(project.activeScriptRecordId) ?? null
    : null;
  const storyboardRecord = project.activeStoryboardRecordId
    ? db.storyboardRecords.get(project.activeStoryboardRecordId) ?? null
    : null;
  const assetPlanRecord = project.activeAssetPlanRecordId
    ? db.assetPlanRecords.get(project.activeAssetPlanRecordId) ?? null
    : null;
  const assetManifestRecord = project.activeAssetManifestRecordId
    ? db.assetManifestRecords.get(project.activeAssetManifestRecordId) ?? null
    : null;
  const composeRecord = project.activeComposeRecordId
    ? db.composeRecords.get(project.activeComposeRecordId) ?? null
    : null;
  const renderJobRecord = project.activeRenderJobRecordId
    ? db.renderJobRecords.get(project.activeRenderJobRecordId) ?? null
    : null;
  const publishPackageRecord = project.activePublishPackageRecordId
    ? db.publishPackageRecords.get(project.activePublishPackageRecordId) ?? null
    : null;
  const projectScriptRecords = [...db.scriptRecords.values()]
    .filter((record) => record.projectId === project.id)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const latestProjectScriptRecord = projectScriptRecords.at(0) ?? null;
  const scriptHistory = projectScriptRecords.map(mapScriptRecordToSnapshot);
  const latestScriptTrace =
    (project.latestScriptRunTraceJson as Record<string, unknown> | null | undefined) ??
    (latestProjectScriptRecord?.graphTraceSummaryJson as Record<string, unknown> | null | undefined) ??
    null;
  const latestProjectStoryboardRecord = [...db.storyboardRecords.values()]
    .filter((record) => record.projectId === project.id)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .at(0) ?? null;
  const latestStoryboardTrace =
    (project.latestStoryboardRunTraceJson as Record<string, unknown> | null | undefined) ??
    (latestProjectStoryboardRecord?.graphTraceSummaryJson as
      | Record<string, unknown>
      | null
      | undefined) ??
    null;
  const latestAssetPlanTrace =
    (project.latestAssetPlanRunTraceJson as Record<string, unknown> | null | undefined) ?? null;
  const latestAssetsTrace =
    (project.latestAssetsRunTraceJson as Record<string, unknown> | null | undefined) ?? null;
  const latestComposeTrace =
    (project.latestComposeRunTraceJson as Record<string, unknown> | null | undefined) ?? null;
  const latestRenderTrace =
    (project.latestRenderRunTraceJson as Record<string, unknown> | null | undefined) ?? null;

  const effectiveStatus = resolveEffectiveStatus(project);

  // 读取 topic 候选数据（仅存在于内存，不在 DB）
  let topicCandidates: {
    candidate_rounds: Array<{
      round_id: string;
      round_index: number;
      created_at: string;
      candidates: Array<{
        candidate_id: string;
        title: string;
        one_line_angle: string;
        family_label: string;
        scope_label: string;
        why_this_now: string;
        strong_scene: string;
        risk_hints: string[];
        core_conflict: string;
        source_hint: string;
        viral_rubric: Record<string, string>;
        must_cover_preview: string[];
      }>;
    }>;
  } | null = null;

  if (topicCandidateStore?.has(project.id)) {
    const state = topicCandidateStore.get(project.id);
    if (state?.rounds?.length) {
      topicCandidates = {
        candidate_rounds: state.rounds.map((round: any) => ({
          round_id: round.roundId,
          round_index: round.roundIndex,
          created_at: round.createdAt?.toISOString?.() ?? round.createdAt,
          candidates: (round.candidates ?? []).map((c: any) => ({
            candidate_id: c.candidateId ?? c.id ?? "",
            title: c.title ?? "",
            one_line_angle: c.oneLineAngle ?? c.angle ?? "",
            family_label: c.familyLabel ?? c.event?.familyLabel ?? "",
            scope_label: c.scopeLabel ?? c.event?.scopeLabel ?? "",
            why_this_now: c.whyThisNow ?? c.why_now ?? "",
            strong_scene: c.strongScene ?? c.event?.strongScene ?? "",
            risk_hints: c.riskHints ?? [],
            core_conflict: c.coreConflict ?? "",
            source_hint: c.sourceHint ?? "基于历史共识推定",
            viral_rubric: c.viralRubric ?? {},
            must_cover_preview: c.mustCoverPreview ?? [],
          })),
        })),
      };
    }
  }

  return {
    project_id: project.id,
    name: project.name,
    owner_id: project.ownerId,
    current_status: effectiveStatus,
    is_draft: isDraft(effectiveStatus),
    restore_route: `/projects/${project.id}/${statusToStep(effectiveStatus)}`,
    trace_summary: {
      project_storage: {
        root_dir: storageProfile.root_dir,
      },
      latest_topic_run: summarizeTraceRun(
        project.latestTopicRunTraceJson as Record<string, unknown> | null | undefined,
      ),
      latest_script_run: summarizeTraceRun(latestScriptTrace),
      latest_storyboard_run: summarizeTraceRun(latestStoryboardTrace),
      latest_asset_plan_run: summarizeTraceRun(latestAssetPlanTrace),
      latest_assets_run: summarizeTraceRun(latestAssetsTrace),
      latest_compose_run: summarizeTraceRun(latestComposeTrace),
      latest_render_run: summarizeTraceRun(latestRenderTrace),
    },
    active_topic_package: topicRecord
      ? {
          topic_package_id: topicRecord.id,
          canonical_title: topicRecord.title,
          selected_angle: topicRecord.selectedAngle,
          family_label: topicRecord.familyLabel,
          scope_label: topicRecord.scopeLabel,
          narrative_tension_map: topicRecord.narrativeTensionMapJson,
        }
      : null,
    topic_candidates: topicCandidates,
    active_script: scriptRecord
      ? mapScriptRecordToSnapshot(scriptRecord)
      : null,
    script_history: scriptHistory,
    active_storyboard: storyboardRecord
      ? await buildStoryboardSnapshotSegment(db, project, storyboardRecord, options?.demoMode ?? false)
      : null,
    active_asset_plan: assetPlanRecord
      ? {
          asset_plan_record_id: assetPlanRecord.id,
          source_storyboard_record_id: assetPlanRecord.storyboardRecordId,
          source_script_record_id: assetPlanRecord.scriptRecordId,
          source_topic_package_id: assetPlanRecord.topicPackageId,
          plan: assetPlanRecord.planJson,
          local_validation: assetPlanRecord.validationResultJson,
          execution_state: assetPlanRecord.executionStateJson,
          graph_trace_summary: assetPlanRecord.graphTraceSummaryJson,
          runtime_diagnostics: assetPlanRecord.runtimeDiagnosticsJson,
        }
      : null,
    active_assets: assetManifestRecord
      ? {
          asset_manifest_record_id: assetManifestRecord.id,
          // S2-2A 任务 6：暴露 manifest revision，accept-fallback 的 expected_version 来源
          version: String(assetManifestRecord.revision),
          source_topic_package_id: assetManifestRecord.topicPackageId,
          source_script_record_id: assetManifestRecord.scriptRecordId,
          source_storyboard_record_id: assetManifestRecord.storyboardRecordId,
          source_asset_plan_record_id: assetManifestRecord.assetPlanRecordId,
          manifest: assetManifestRecord.manifestJson,
          local_validation: assetManifestRecord.validationResultJson,
          execution_state: assetManifestRecord.executionStateJson,
          graph_trace_summary: assetManifestRecord.graphTraceSummaryJson,
          runtime_diagnostics: assetManifestRecord.runtimeDiagnosticsJson,
        }
      : null,
    active_compose: composeRecord
      ? {
          compose_record_id: composeRecord.id,
          source_asset_manifest_record_id: composeRecord.assetManifestRecordId,
          timeline: composeRecord.timelineJson,
          local_validation: composeRecord.validationResultJson,
          execution_state: composeRecord.executionStateJson,
          graph_trace_summary: composeRecord.graphTraceSummaryJson,
          runtime_diagnostics: composeRecord.runtimeDiagnosticsJson,
        }
      : null,
    active_render: renderJobRecord
      ? (() => {
          const artifact = renderJobRecord.outputArtifactJson;
          // Fallback: stat the file to fill file_size_bytes if missing (old artifacts)
          if (artifact?.file_uri && !artifact.metadata?.file_size_bytes) {
            try {
              const s = statSync(artifact.file_uri);
              (artifact.metadata as Record<string, unknown> ?? (artifact.metadata = {} as never)).file_size_bytes = s.size;
            } catch { /* keep as-is */ }
          }
          return {
            render_job_record_id: renderJobRecord.id,
            source_compose_record_id: renderJobRecord.composeRecordId,
            source_asset_manifest_record_id: renderJobRecord.assetManifestRecordId,
            status: renderJobRecord.status,
            profile: renderJobRecord.profileJson,
            output_artifact: artifact,
            validation_result: renderJobRecord.validationResultJson,
            execution_state: renderJobRecord.executionStateJson,
            graph_trace_summary: renderJobRecord.graphTraceSummaryJson,
            runtime_diagnostics: renderJobRecord.runtimeDiagnosticsJson,
          };
        })()
      : null,
    active_publish_package: publishPackageRecord
      ? (() => {
          const pkg = publishPackageRecord.packageJson as Record<string, unknown>;
          const isStale =
            publishPackageRecord.renderJobRecordId !==
            project.activeRenderJobRecordId;

          // Evaluate readiness: blocked when upstream source records are missing.
          // Note: isStale is NOT a blocked reason — it's a warning that the
          // render output has changed, but the package is still functional.
          let effectiveReadiness = (pkg.readiness as string) ?? "draft";
          const blockedReasons: string[] = [];
          if (!db.topicPackages.has(publishPackageRecord.topicPackageId)) {
            blockedReasons.push("source_topic_package_missing");
          }
          if (!db.scriptRecords.has(publishPackageRecord.scriptRecordId)) {
            blockedReasons.push("source_script_record_missing");
          }
          if (!db.renderJobRecords.has(publishPackageRecord.renderJobRecordId)) {
            blockedReasons.push("source_render_job_record_missing");
          }
          if (blockedReasons.length > 0 && effectiveReadiness !== "blocked") {
            effectiveReadiness = "blocked";
          }

          // Update the package object in the snapshot with the effective readiness
          const effectivePkg = { ...pkg, readiness: effectiveReadiness };
          if (blockedReasons.length > 0) {
            (effectivePkg as Record<string, unknown>).blocked_reasons = blockedReasons;
          }

          // Resolve cover_artifact summary from asset manifest
          let coverArtifact: Record<string, unknown> | null = null;
          const coverArtifactId = pkg.cover_artifact_id as string | null | undefined;
          if (coverArtifactId) {
            const manifestRecord = db.assetManifestRecords.get(
              publishPackageRecord.assetManifestRecordId,
            );
            if (manifestRecord) {
              const artifacts = (manifestRecord.manifestJson as Record<string, unknown>).artifacts as Array<Record<string, unknown>> | undefined;
              const found = artifacts?.find(
                (a) => a.artifact_id === coverArtifactId,
              );
              if (found) {
                const meta = (found.metadata ?? {}) as Record<string, unknown>;
                coverArtifact = {
                  artifact_id: found.artifact_id,
                  file_uri: found.file_uri,
                  mime_type: meta.mime_type ?? (found as Record<string, unknown>).mime_type ?? "image/png",
                  width: (meta.width ?? null) as number | null,
                  height: (meta.height ?? null) as number | null,
                  metadata: meta,
                };
              }
            }
          }

          return {
            publish_package_record_id: publishPackageRecord.id,
            source_render_job_record_id: publishPackageRecord.renderJobRecordId,
            package: effectivePkg,
            is_stale: isStale,
            stale_reason: isStale ? "render_output_changed" : null,
            cover_artifact: coverArtifact,
            validation_result: publishPackageRecord.validationResultJson,
            execution_state: publishPackageRecord.executionStateJson,
          };
        })()
      : null,
    // S2-2A：生成配置快照（只读）。使用 getProjectGenerationConfiguration 确保旧项目
    // 通过普通快照读取时也触发 backfill（返回 source: backfilled_default）。
    generation_configuration: await (async () => {
      const config = await getProjectGenerationConfiguration(db, project.id, project.ownerId);
      return {
        configuration: config.configuration,
        revision: config.revision,
        source: config.source,
        source_user_preference_revision: config.sourceUserPreferenceRevision,
        updated_at: config.updatedAt.toISOString(),
        diff_from_user_default: config.diff_from_user_default,
      };
    })(),
    // S2-2A：配置版本（独立字段，便于前端快速判断是否需要刷新）
    generation_configuration_version: (() => {
      const record = db.projectGenerationConfigurations.size > 0
        ? [...db.projectGenerationConfigurations.values()].find((c) => c.projectId === project.id)
        : null;
      return record?.revision ?? 1;
    })(),
    // S2-2A：失效预览占位（当前配置与上一版的差异影响；无变更时为 none）
    configuration_invalidation_preview: {
      affected_stages: ["none"],
      note: "当前配置为最新冻结版本；如需变更请通过项目配置 API。",
    },
    // S2-2A：只读成本摘要占位（无 usage 时为零）
    cost_summary: {
      total_estimated_cost_micros: "0",
      total_actual_cost_micros: "0",
      record_count: 0,
    },
  };
}
