import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { DbClient } from "../../db/client";
import { saveAssetManifestRecord } from "../assets/asset-manifest-record.repository";
import { getProjectStorageProfile } from "../../runtime/trace/project-storage";
import {
  submitDashscopeAsyncTask,
  pollDashscopeTask,
  downloadDashscopeOutput,
} from "../assets/providers/dashscope/dashscope-client";

export interface CoverGenerateInput {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  prompt: string;
  size?: string;
  pollIntervalMs?: number;
  maxPollAttempts?: number;
}

export interface CoverGenerateResult {
  artifactId: string;
  fileUri: string;
  mimeType: string;
  width: number | null;
  height: number | null;
}

const DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com";
const DEFAULT_MODEL = "wan2.6-t2i";
const DEFAULT_SIZE = "1080*1920";
// Wan2.6 uses the multimodal generation endpoint for text-to-image
const WAN_ENDPOINT = "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation";

/**
 * Generate a cover image via DashScope and register it as an artifact.
 */
export async function generateCoverImage(
  db: DbClient,
  projectId: string,
  assetManifestRecordId: string,
  input: CoverGenerateInput,
): Promise<CoverGenerateResult> {
  const project = db.projects.get(projectId);
  if (!project) throw new Error("project_not_found");

  const manifestRecord = db.assetManifestRecords.get(assetManifestRecordId);
  if (!manifestRecord) throw new Error("asset_manifest_not_found");

  const model = input.model || DEFAULT_MODEL;
  const baseUrl = input.baseUrl || DEFAULT_BASE_URL;

  // Build payload for Wan2.6 multimodal generation
  const payload = buildImagePayload(model, input.prompt, input.size || DEFAULT_SIZE);

  // 1. Submit async task
  const { taskId } = await submitDashscopeAsyncTask({
    apiKey: input.apiKey,
    endpoint: WAN_ENDPOINT,
    payload,
    extraHeaders: model.match(/^wan/i) ? { "X-DashScope-OssResourceResolve": "enable" } : undefined,
  });

  // 2. Poll until completed
  const pollInterval = input.pollIntervalMs || 3000;
  const maxAttempts = input.maxPollAttempts || 60;
  let result = await pollDashscopeTask({ apiKey: input.apiKey, taskId });

  for (let i = 0; i < maxAttempts && (result.status === "PENDING" || result.status === "RUNNING"); i++) {
    await sleep(pollInterval);
    result = await pollDashscopeTask({ apiKey: input.apiKey, taskId });
  }

  if (result.status !== "SUCCEEDED" || !result.outputUrl) {
    throw new Error(
      `Cover image generation failed: ${result.status} ${result.errorMessage || ""}`
    );
  }

  // 3. Download the generated image
  const imageBuffer = await downloadDashscopeOutput(result.outputUrl);

  // 4. Save to project storage
  const storageProfile = getProjectStorageProfile(project);
  const publishDir = join(storageProfile.root_dir, "publish");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(publishDir, { recursive: true });

  const artifactId = db.generateId();
  const destPath = join(publishDir, `cover_generated_${artifactId}.png`);
  const absolutePath = resolve(destPath);
  await writeFile(absolutePath, imageBuffer);

  // 5. Register as artifact in manifest
  const manifestJson = manifestRecord.manifestJson as Record<string, unknown>;
  const artifacts = (manifestJson.artifacts ?? []) as Array<Record<string, unknown>>;
  const newArtifact = {
    artifact_id: artifactId,
    artifact_type: "image",
    origin: "generated",
    file_uri: absolutePath,
    created_at: new Date().toISOString(),
    metadata: {
      mime_type: "image/png",
      width: 1080,
      height: 1920,
      generated_by: model,
      generated_for_cover: true,
      prompt: input.prompt,
    },
  };
  artifacts.push(newArtifact);
  manifestJson.artifacts = artifacts;

  await saveAssetManifestRecord(db, {
    id: manifestRecord.id,
    projectId: manifestRecord.projectId,
    topicPackageId: manifestRecord.topicPackageId,
    scriptRecordId: manifestRecord.scriptRecordId,
    storyboardRecordId: manifestRecord.storyboardRecordId,
    assetPlanRecordId: manifestRecord.assetPlanRecordId,
    manifestJson,
    validationResultJson: manifestRecord.validationResultJson,
    executionStateJson: manifestRecord.executionStateJson,
    graphTraceSummaryJson: manifestRecord.graphTraceSummaryJson,
    runtimeDiagnosticsJson: manifestRecord.runtimeDiagnosticsJson,
    createdAt: manifestRecord.createdAt,
  });

  return {
    artifactId,
    fileUri: absolutePath,
    mimeType: "image/png",
    width: 1080,
    height: 1920,
  };
}

function buildImagePayload(
  model: string,
  prompt: string,
  size: string,
): Record<string, unknown> {
  const isWan = /^wan/i.test(model);

  if (isWan) {
    return {
      model,
      input: {
        messages: [
          {
            role: "user",
            content: [{ text: prompt }],
          },
        ],
      },
      parameters: {
        size,
        n: 1,
        prompt_extend: true,
        watermark: false,
      },
    };
  }

  // Legacy models
  return {
    model,
    input: {
      prompt,
      negative_prompt: "现代元素，水印，文字，低画质，动漫风格",
    },
    parameters: {
      size,
      n: 1,
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
