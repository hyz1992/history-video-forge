import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { DbClient } from "../../db/client";
import { saveAssetManifestRecord } from "../assets/asset-manifest-record.repository";
import { getProjectStorageProfile } from "../../runtime/trace/project-storage";
import { downloadDashscopeOutput } from "../assets/providers/dashscope/dashscope-client";

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

  // Build payload for Wan2.6 multimodal generation (synchronous endpoint)
  const payload = buildImagePayload(model, input.prompt, input.size || DEFAULT_SIZE);

  // 1. Call DashScope synchronously (Wan2.6 multimodal endpoint is sync)
  const submitResp = await fetch(WAN_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  const submitJson = (await submitResp.json()) as Record<string, unknown>;

  if (!submitResp.ok) {
    throw new Error(
      `DashScope generation failed: ${submitResp.status} ${JSON.stringify(submitJson)}`
    );
  }

  // 2. Extract image URL from response
  const outputUrl = extractImageUrl(submitJson);
  if (!outputUrl) {
    throw new Error(
      `No image URL in DashScope response: ${JSON.stringify(submitJson)}`
    );
  }

  // 3. Download the generated image
  const imageBuffer = await downloadDashscopeOutput(outputUrl);

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
    origin: "provider",
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

function extractImageUrl(response: Record<string, unknown>): string | undefined {
  // Wan2.6 multimodal generation response format:
  // { output: { choices: [{ message: { content: [{ image: "url" }] } }] } }
  const output = response.output as Record<string, unknown> | undefined;
  const choices = output?.choices as Array<Record<string, unknown>> | undefined;
  if (choices) {
    for (const choice of choices) {
      const message = choice.message as Record<string, unknown> | undefined;
      const content = message?.content as Array<Record<string, unknown>> | undefined;
      if (content) {
        for (const item of content) {
          const image = item.image as string | undefined;
          if (image) return image;
        }
      }
    }
  }

  // Fallback: check for results array (legacy format)
  const results = output?.results as Array<Record<string, unknown>> | undefined;
  if (results) {
    for (const item of results) {
      const url = item.url as string | undefined;
      if (url) return url;
    }
  }

  // Deep search
  return deepFindUrl(response);
}

function deepFindUrl(root: unknown): string | undefined {
  const queue: unknown[] = [root];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    if (Array.isArray(current)) { queue.push(...current); continue; }
    if (typeof current !== "object") continue;
    const obj = current as Record<string, unknown>;
    for (const [, val] of Object.entries(obj)) {
      if (typeof val === "string" && val.startsWith("http")) return val;
      if (val && typeof val === "object") queue.push(val);
    }
  }
  return undefined;
}
