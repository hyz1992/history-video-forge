import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { DbClient } from "../../db/client";
import { createZipBuffer } from "./zip-builder";

export interface ExportResult {
  /** ZIP file buffer */
  zipBuffer: Buffer;
  /** Suggested download filename */
  filename: string;
  /** Content manifest for UI preview */
  manifest: ExportManifest;
}

export interface ExportManifest {
  project_id: string;
  project_title: string;
  files: string[];
  title: string;
  description: string;
  hashtags: string[];
  cover_origin: string;
  has_cover_image: boolean;
  has_video: boolean;
  exported_at: string;
  readiness: string;
  missing_fields: string[];
}

export async function exportPublishPackage(
  db: DbClient,
  projectId: string,
): Promise<ExportResult> {
  const project = db.projects.get(projectId);
  if (!project) throw new Error("project_not_found");

  if (!project.activePublishPackageRecordId) {
    throw new Error("no_active_publish_package");
  }

  const record = db.publishPackageRecords.get(project.activePublishPackageRecordId);
  if (!record) throw new Error("publish_package_not_found");

  const pkg = record.packageJson as Record<string, unknown>;
  const manifestRecord = db.assetManifestRecords.get(record.assetManifestRecordId);

  const title = (pkg.selected_title as string) || project.name || "未命名项目";
  const description = (pkg.description as string) || "";
  const hashtags = (pkg.hashtags as string[]) || [];
  const coverOrigin = (pkg.cover_origin as string) || "storyboard_image";
  const readiness = (pkg.readiness as string) || "draft";
  const coverArtifactId = pkg.cover_artifact_id as string | null | undefined;
  const exportTime = new Date().toISOString();

  // Sanitize project name for filename
  const safeName = title.replace(/[/\\:*?"<>|]/g, "_").slice(0, 40);

  // Resolve cover image
  let coverArtifact: Record<string, unknown> | undefined;
  if (coverArtifactId && manifestRecord) {
    const artifacts = ((manifestRecord.manifestJson as Record<string, unknown>).artifacts ?? []) as Array<Record<string, unknown>>;
    coverArtifact = artifacts.find((a) => a.artifact_id === coverArtifactId) as Record<string, unknown> | undefined;
  }

  // Resolve video
  let videoArtifact: Record<string, unknown> | undefined;
  const renderJob = project.activeRenderJobRecordId
    ? db.renderJobRecords.get(project.activeRenderJobRecordId)
    : null;
  if (renderJob?.outputArtifactJson) {
    videoArtifact = renderJob.outputArtifactJson as Record<string, unknown>;
  }

  // Missing fields check
  const missingFields: string[] = [];
  if (!pkg.selected_title) missingFields.push("标题");
  if (!pkg.description) missingFields.push("描述");
  if (!hashtags.length) missingFields.push("话题标签");
  if (!coverArtifactId) missingFields.push("封面图");

  const hasCoverImage = !!coverArtifact?.file_uri;
  const hasVideo = !!videoArtifact?.file_uri;

  // Build publish.json
  const publishJson = {
    project_id: projectId,
    project_title: title,
    video_export_artifact_id: pkg.video_export_artifact_id ?? null,
    video_filename: videoArtifact?.file_uri ? basename(String(videoArtifact.file_uri)) : null,
    cover_artifact_id: coverArtifactId ?? null,
    cover_filename: coverArtifact?.file_uri ? basename(String(coverArtifact.file_uri)) : null,
    cover_prompt: pkg.cover_prompt_draft ?? null,
    cover_origin: coverOrigin,
    selected_title: pkg.selected_title ?? "",
    title_candidates: pkg.title_candidates ?? [],
    description,
    hashtags,
    platform_profile: pkg.platform_profile ?? "generic",
    readiness,
    exported_at: exportTime,
  };

  // Build README
  const readme = buildReadme(publishJson, missingFields);

  // Build ZIP entries
  const zipEntries = [
    { filename: "publish.json", data: Buffer.from(JSON.stringify(publishJson, null, 2), "utf8") },
    { filename: "README.txt", data: Buffer.from(readme, "utf8") },
  ];

  // Add cover image if exists
  if (coverArtifact?.file_uri) {
    try {
      const coverPath = String(coverArtifact.file_uri);
      const coverData = await readFile(coverPath);
      const ext = coverPath.split(".").pop() || "png";
      zipEntries.push({ filename: `cover.${ext}`, data: coverData });
    } catch {
      // File not accessible — skip
      zipEntries.push({
        filename: "cover.url.txt",
        data: Buffer.from(`封面图文件路径：${coverArtifact.file_uri}\n（文件未在服务器可访问路径）`, "utf8"),
      });
    }
  }

  // Add video URL reference
  if (videoArtifact?.file_uri) {
    zipEntries.push({
      filename: "video.url.txt",
      data: Buffer.from(
        `视频文件路径：${videoArtifact.file_uri}\n` +
        `时长：${videoArtifact.duration_sec ?? "未知"}秒\n` +
        `分辨率：${videoArtifact.width ?? "?"}x${videoArtifact.height ?? "?"}\n`,
        "utf8",
      ),
    });
  }

  const manifest: ExportManifest = {
    project_id: projectId,
    project_title: title,
    files: zipEntries.map((e) => e.filename),
    title,
    description,
    hashtags,
    cover_origin: coverOrigin,
    has_cover_image: hasCoverImage,
    has_video: hasVideo,
    exported_at: exportTime,
    readiness,
    missing_fields: missingFields,
  };

  return {
    zipBuffer: createZipBuffer(zipEntries),
    filename: `${safeName}-发布包.zip`,
    manifest,
  };
}

function buildReadme(json: Record<string, unknown>, missing: string[]): string {
  return [
    `发布交付包 — ${json.project_title || "未命名"}`,
    `导出时间：${json.exported_at}`,
    `平台配置：${json.platform_profile || "generic"}`,
    "",
    "=== 文件清单 ===",
    "  publish.json      — 发布数据（标题、描述、话题、封面提示词）",
    "  cover.png         — 封面图（如有）",
    "  video.url.txt     — 视频文件路径引用",
    "  README.txt        — 本说明文件",
    "",
    "=== 发布内容 ===",
    `  标题：${json.selected_title || "（未设置）"}`,
    `  描述：${json.description || "（未设置）"}`,
    `  话题：${(json.hashtags as string[])?.join("、") || "（未设置）"}`,
    `  封面来源：${json.cover_origin || "未知"}`,
    `  就绪状态：${json.readiness || "draft"}`,
    "",
    missing.length > 0
      ? `⚠ 缺失项：${missing.join("、")}`
      : "✓ 发布资料完整",
    "",
    "=== 各平台使用建议 ===",
    "  抖音：使用 publish.json 中的 selected_title + description + hashtags",
    "  B站：将 description 粘贴到视频简介，hashtags 粘贴到标签区",
    "  YouTube：使用 selected_title 作为视频标题，description 作为描述",
    "",
    "=== 封面提示词 ===",
    `  ${json.cover_prompt || "（未设置）"}`,
  ].join("\n");
}
