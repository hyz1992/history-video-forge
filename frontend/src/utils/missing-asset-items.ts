/**
 * Derive human-readable missing asset items from a segment_routes manifest.
 * Extracted as a pure helper so both ComposePanel and tests can share it.
 */

export function deriveMissingAssetItems(manifest: Record<string, unknown>): string[] {
  const routes = (manifest.segment_routes ?? []) as Array<Record<string, unknown>>;
  const artifacts = (manifest.artifacts ?? []) as Array<Record<string, unknown>>;
  const execs = (manifest.executions ?? []) as Array<Record<string, unknown>>;

  const items: string[] = [];

  const toIndex = (segId: string) => {
    const m = segId.match(/(\d+)$/);
    return m ? parseInt(m[1]) : 999;
  };

  for (const route of routes) {
    const segId = String(route.segment_id ?? "");
    const readiness = String(route.readiness ?? "ready");
    if (readiness !== "blocked" && readiness !== "partial") continue;

    const segNum = toIndex(segId);
    const label = segNum < 999 ? `#${segNum}` : segId;

    const visualId = route.primary_visual_artifact_id as string | null | undefined;
    const visualType = String(route.visual_route_type ?? "image_only");
    const ttsId = route.tts_artifact_id as string | null | undefined;
    const subtitleId = route.subtitle_artifact_id as string | null | undefined;

    if (!visualId || !artifacts.some((a) => a.artifact_id === visualId)) {
      if (visualType === "video_clip") {
        items.push(`${label} 分镜视频未生成`);
      } else {
        items.push(`${label} 分镜图未生成或未上传`);
      }
    }
    if (!ttsId || !artifacts.some((a) => a.artifact_id === ttsId)) {
      items.push(`${label} 口播音频缺失`);
    }
    if (!subtitleId || !artifacts.some((a) => a.artifact_id === subtitleId)) {
      items.push(`${label} 字幕缺失`);
    }
  }

  if (items.length === 0) {
    for (const e of execs) {
      if (e.status === "failed" || e.status === "blocked") {
        const segRef = e.source_segment_id ? `${toIndex(String(e.source_segment_id)) < 999 ? "#" + toIndex(String(e.source_segment_id)) : e.source_segment_id} ` : "";
        const taskType = String(e.task_type ?? "unknown");
        items.push(`${segRef}${toTypeLabel(taskType)} 生成失败`);
      }
    }
  }

  return items.slice(0, 10);
}

/** Map real asset task_type values to user-facing Chinese labels. */
function toTypeLabel(taskType: string): string {
  const map: Record<string, string> = {
    image_still: "分镜图",
    image: "分镜图",
    video_clip: "视频",
    video: "视频",
    tts_audio: "口播",
    tts: "口播",
    subtitle_track: "字幕",
    subtitle: "字幕",
    sfx: "音效",
    bgm: "配乐",
    motion: "运镜",
  };
  return map[taskType] ?? taskType;
}
