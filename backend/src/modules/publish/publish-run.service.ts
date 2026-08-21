import type { AppResponse } from "../../app";
import type { DbClient, ProjectRecord } from "../../db/client.js";
import { createCompositeInteractionLogWriter } from "../../runtime/trace/project-storage.js";
import { createBillingInteractionLogWriter, type LlmBillingContext } from "../generation-cost/llm-billing-writer.js";
import { generateCoverPromptDraft, buildCoverPromptContext } from "./cover.service.js";
import { generateDescription } from "./description-generator.service.js";
import { generateTitleCandidates } from "./title-generator.service.js";
import { deriveHashtags } from "./hashtag-derivation.service.js";
import { initializeCoverFromStoryboard } from "./cover.service.js";
import { buildDefaultPublishPackage, savePublishPackageRecord } from "./publish-record.repository.js";
import { getProjectSnapshot } from "../projects/project-snapshot.service.js";

/**
 * S2-2A 任务 9B：publish.generate 的生成主体（从 controller 抽出，供
 * 路由直调与 dispatcher handler 共用）。付费 quote 绑定 run 经 billingContext
 * 对 LLM interaction 记账；免 quote 本地路径不传 billingContext。
 */
export interface RunPublishGenerationInput {
  db: DbClient;
  project: ProjectRecord;
  billingContext?: LlmBillingContext;
}

export async function runPublishGeneration(
  input: RunPublishGenerationInput,
): Promise<AppResponse> {
  const { db, project } = input;
  const projectId = project.id;

  // Verify render job exists and is completed
  if (!project.activeRenderJobRecordId) {
    return {
      statusCode: 409,
      body: { error: "no_active_render_job" },
    };
  }

  const renderJob = db.renderJobRecords.get(project.activeRenderJobRecordId);
  if (!renderJob) {
    return {
      statusCode: 409,
      body: { error: "render_job_not_found" },
    };
  }

  if (renderJob.status !== "completed") {
    return {
      statusCode: 409,
      body: { error: "render_job_not_completed" },
    };
  }

  const exportArtifact = renderJob.outputArtifactJson;
  if (!exportArtifact) {
    return {
      statusCode: 409,
      body: { error: "no_export_artifact" },
    };
  }

  // Resolve upstream source record IDs from render job
  const topicPackageId = project.activeTopicPackageId;
  const scriptRecordId = project.activeScriptRecordId;
  const storyboardRecordId = project.activeStoryboardRecordId;
  const assetManifestRecordId = project.activeAssetManifestRecordId;

  if (!topicPackageId || !scriptRecordId || !storyboardRecordId || !assetManifestRecordId) {
    return {
      statusCode: 409,
      body: { error: "incomplete_upstream_pipeline" },
    };
  }

  // Initialize cover from #1 storyboard image (copy file + register artifact)
  let coverArtifactId: string | null = null;
  const notes: string[] = [];
  try {
    const coverResult = await initializeCoverFromStoryboard(
      db,
      projectId,
      assetManifestRecordId,
    );
    coverArtifactId = coverResult.coverArtifactId;
  } catch (err) {
    notes.push(
      `cover_init_skipped: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Resolve upstream records
  const topicPackage = db.topicPackages.get(topicPackageId);
  const scriptRecord = db.scriptRecords.get(scriptRecordId);

  // Save preliminary package as history; do not replace the last valid package.
  const prePackageJson = buildDefaultPublishPackage({
    renderJobRecordId: renderJob.id,
    topicPackageId,
    scriptRecordId,
    storyboardRecordId,
    assetManifestRecordId,
    videoExportArtifactId: exportArtifact.artifact_id,
    coverArtifactId,
    coverPromptDraft: null,
  });
  (prePackageJson as Record<string, unknown>).readiness = "generating";
  (prePackageJson as Record<string, unknown>).notes = notes;

  const generatingRecord = await savePublishPackageRecord(db, {
    projectId,
    renderJobRecordId: renderJob.id,
    topicPackageId,
    scriptRecordId,
    storyboardRecordId,
    assetManifestRecordId,
    packageJson: prePackageJson,
    validationResultJson: null,
    executionStateJson: { generated_at: new Date().toISOString(), generating: true },
  });

  const publishRunId = `publish_run_${db.generateId()}`;
  // 9B：付费 quote 绑定 run 的 writer 包计费包装（LLM interaction 记账）
  const plainWriter = createCompositeInteractionLogWriter({
    project,
    phase: "publish",
    runId: publishRunId,
  });
  const interactionLogWriter = input.billingContext
    ? createBillingInteractionLogWriter({ billing: input.billingContext, inner: plainWriter, interactionRunId: publishRunId })
    : plainWriter;

  // Generate cover prompt via LLM
  let coverPromptDraft: string | null = null;
  let llmUsed = false;
  try {
    const ctx = buildCoverPromptContext(db, projectId, assetManifestRecordId);
    coverPromptDraft = await generateCoverPromptDraft(
      ctx,
      interactionLogWriter,
      // S2-2C（详细设计 §6.1）：单一真相源——从 billingContext.resolved 派生
      input.billingContext?.resolved.resolved_capabilities,
    );
    llmUsed = true;
  } catch (err) {
    notes.push(
      `cover_prompt_gen_failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Generate description via LLM
  let description = "";
  try {
    if (topicPackage && scriptRecord) {
      const descResult = await generateDescription({
        topicTitle: topicPackage.title,
        selectedAngle: topicPackage.selectedAngle,
        scriptSummary: scriptRecord.scriptText.slice(0, 500),
        durationSec: exportArtifact.duration_sec ?? scriptRecord.estimatedDurationSec ?? 60,
        interactionLogWriter,
        snapshotCapabilities: input.billingContext?.resolved.resolved_capabilities,
      });
      description = descResult.description;
      llmUsed = true;
    }
  } catch (err) {
    notes.push(
      `description_gen_failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Generate title candidates via LLM and auto-select first
  let titleCandidates: Array<{ candidate_id: string; text: string; style: string }> = [];
  let selectedTitle = "";
  try {
    if (topicPackage && scriptRecord) {
      const titleResult = await generateTitleCandidates({
        topicTitle: topicPackage.title,
        selectedAngle: topicPackage.selectedAngle,
        scriptSummary: scriptRecord.scriptText.slice(0, 300),
        durationSec: Math.round(exportArtifact.duration_sec ?? scriptRecord.estimatedDurationSec ?? 60),
        interactionLogWriter,
        snapshotCapabilities: input.billingContext?.resolved.resolved_capabilities,
      });
      titleCandidates = titleResult.candidates;
      if (titleCandidates.length > 0) {
        selectedTitle = titleCandidates[0].text;
      }
      llmUsed = true;
    }
  } catch (err) {
    notes.push(
      `title_gen_failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Derive hashtags from structured upstream fields (non-LLM)
  let hashtags: string[] = [];
  if (topicPackage) {
    hashtags = deriveHashtags({
      familyLabel: topicPackage.familyLabel,
      scopeLabel: topicPackage.scopeLabel,
      topicTitle: topicPackage.title,
    });
  }

  // Build and save the publish package
  const packageJson = buildDefaultPublishPackage({
    renderJobRecordId: renderJob.id,
    topicPackageId,
    scriptRecordId,
    storyboardRecordId,
    assetManifestRecordId,
    videoExportArtifactId: exportArtifact.artifact_id,
    coverArtifactId,
    coverPromptDraft,
  });

  if (notes.length > 0) {
    (packageJson as Record<string, unknown>).notes = notes;
  }

  // Set description from LLM generation
  if (description) {
    (packageJson as Record<string, unknown>).description = description;
  }

  // Set hashtags from derivation
  if (hashtags.length > 0) {
    (packageJson as Record<string, unknown>).hashtags = hashtags;
  }

  // Set title candidates and auto-selected title
  if (titleCandidates.length > 0) {
    (packageJson as Record<string, unknown>).title_candidates = titleCandidates;
    (packageJson as Record<string, unknown>).selected_title = selectedTitle;
  }

  const record = await savePublishPackageRecord(db, {
    id: generatingRecord.id,
    projectId,
    renderJobRecordId: renderJob.id,
    topicPackageId,
    scriptRecordId,
    storyboardRecordId,
    assetManifestRecordId,
    packageJson,
    validationResultJson: null,
    executionStateJson: {
      generated_at: new Date().toISOString(),
      llm_used: llmUsed,
    },
  });

  await db.thirdAggregateWriter?.activatePublish(project, record);
  project.activePublishPackageRecordId = record.id;

  // Return the snapshot with the new active_publish_package
  const snapshot = await getProjectSnapshot(db, projectId);

  return {
    statusCode: 201,
    body: snapshot,
  };
}
