import { describe, expect, it } from "vitest";

/**
 * Pure helper extracted from ComposePanel.vue.
 * Tests that the real SegmentAssetRoute schema fields produce correct user-facing messages.
 */
function deriveMissingAssetItems(manifest: Record<string, unknown>): string[] {
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
        const typeLabel: Record<string, string> = { image: "分镜图", video: "视频", tts: "口播", subtitle: "字幕" };
        items.push(`${segRef}${typeLabel[taskType] ?? taskType} 生成失败`);
      }
    }
  }

  return items.slice(0, 10);
}

describe("deriveMissingAssetItems", () => {
  it("detects missing primary_visual_artifact_id for image_only route", () => {
    const manifest = {
      segment_routes: [
        {
          segment_id: "sb_001",
          readiness: "blocked",
          visual_route_type: "image_only",
          primary_visual_artifact_id: null,
          tts_artifact_id: "tts_001",
          subtitle_artifact_id: "sub_001",
        },
      ],
      artifacts: [
        { artifact_id: "tts_001" },
        { artifact_id: "sub_001" },
      ],
      executions: [],
    };
    const items = deriveMissingAssetItems(manifest);
    expect(items).toContain("#1 分镜图未生成或未上传");
  });

  it("detects missing video for video_clip route", () => {
    const manifest = {
      segment_routes: [
        {
          segment_id: "sb_003",
          readiness: "blocked",
          visual_route_type: "video_clip",
          primary_visual_artifact_id: null,
          tts_artifact_id: null,
          subtitle_artifact_id: null,
        },
      ],
      artifacts: [],
      executions: [],
    };
    const items = deriveMissingAssetItems(manifest);
    expect(items).toContain("#3 分镜视频未生成");
  });

  it("detects missing tts and subtitle", () => {
    const manifest = {
      segment_routes: [
        {
          segment_id: "sb_002",
          readiness: "partial",
          visual_route_type: "image_only",
          primary_visual_artifact_id: "vis_002",
          tts_artifact_id: null,
          subtitle_artifact_id: null,
        },
      ],
      artifacts: [{ artifact_id: "vis_002" }],
      executions: [],
    };
    const items = deriveMissingAssetItems(manifest);
    expect(items).toContain("#2 口播音频缺失");
    expect(items).toContain("#2 字幕缺失");
  });

  it("skips ready routes", () => {
    const manifest = {
      segment_routes: [
        {
          segment_id: "sb_001",
          readiness: "ready",
          visual_route_type: "image_only",
          primary_visual_artifact_id: null,
          tts_artifact_id: null,
          subtitle_artifact_id: null,
        },
      ],
      artifacts: [],
      executions: [],
    };
    const items = deriveMissingAssetItems(manifest);
    expect(items).toEqual([]);
  });

  it("falls back to failed executions", () => {
    const manifest = {
      segment_routes: [],
      artifacts: [],
      executions: [
        {
          task_type: "tts",
          status: "failed",
          source_segment_id: "sb_004",
        },
      ],
    };
    const items = deriveMissingAssetItems(manifest);
    expect(items).toContain("#4 口播 生成失败");
  });
});
