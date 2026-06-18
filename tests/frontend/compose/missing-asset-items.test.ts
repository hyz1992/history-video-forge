import { describe, expect, it } from "vitest";
import { deriveMissingAssetItems } from "../../../frontend/src/utils/missing-asset-items.js";

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

  it("falls back to failed executions with real task_type values", () => {
    const manifest = {
      segment_routes: [],
      artifacts: [],
      executions: [
        { task_type: "tts_audio", status: "failed", source_segment_id: "sb_004" },
        { task_type: "image_still", status: "failed" },
        { task_type: "video_clip", status: "blocked", source_segment_id: "sb_002" },
      ],
    };
    const items = deriveMissingAssetItems(manifest);
    expect(items).toContain("#4 口播 生成失败");
    expect(items).toContain("分镜图 生成失败");
    expect(items).toContain("#2 视频 生成失败");
  });

  it("maps unknown task_type to raw value", () => {
    const manifest = {
      segment_routes: [],
      artifacts: [],
      executions: [
        { task_type: "unknown_internal_name", status: "failed" },
      ],
    };
    const items = deriveMissingAssetItems(manifest);
    // Falls through to raw task_type since not in map
    expect(items).toContain("unknown_internal_name 生成失败");
  });
});
