import { describe, expect, it } from "vitest";

import { PublishPackage } from "../../shared/src/index.js";

describe("PublishPackage schema", () => {
  const validPackage = {
    package_version: "publish_package_v1" as const,
    source_render_job_record_id: "render_001",
    source_topic_package_id: "topic_001",
    source_script_record_id: "script_001",
    source_storyboard_record_id: "storyboard_001",
    source_asset_manifest_record_id: "asset_manifest_001",
    video_export_artifact_id: "export_artifact_001",
    cover_artifact_id: null,
    cover_prompt_draft: null,
    cover_origin: "storyboard_image" as const,
    title_candidates: [],
    selected_title: "",
    description: "",
    hashtags: [],
    platform_profile: "generic" as const,
    readiness: "draft" as const,
    notes: [],
  };

  it("parses a minimal valid PublishPackage", () => {
    const result = PublishPackage.safeParse(validPackage);
    expect(result.success).toBe(true);
  });

  it("defaults cover_origin to storyboard_image", () => {
    const { cover_origin, ...rest } = validPackage;
    const result = PublishPackage.parse(rest);
    expect(result.cover_origin).toBe("storyboard_image");
  });

  it("defaults platform_profile to generic", () => {
    const { platform_profile, ...rest } = validPackage;
    const result = PublishPackage.parse(rest);
    expect(result.platform_profile).toBe("generic");
  });

  it("parses a full PublishPackage with title candidates and cover", () => {
    const pkg = PublishPackage.parse({
      ...validPackage,
      cover_artifact_id: "cover_art_001",
      cover_prompt_draft: "战国宫廷场景，冷色调，晏子面对楚王",
      cover_origin: "storyboard_image",
      title_candidates: [
        { candidate_id: "c1", text: "楚王连压三次，晏子一次没退", style: "standard" },
        { candidate_id: "c2", text: "他身高不足五尺，却让楚王三次低头", style: "suspense" },
        { candidate_id: "c3", text: "晏子使楚：弱国外交的顶级操作", style: "knowledge" },
        { candidate_id: "c4", text: "当众羞辱一个使节，国王踢到了铁板", style: "emotional" },
      ],
      selected_title: "楚王连压三次，晏子一次没退",
      description: "晏子出使楚国，楚王连续三次当众羞辱...",
      hashtags: ["历史", "晏子", "春秋", "外交"],
      platform_profile: "bilibili",
      readiness: "ready",
      notes: ["封面已上传"],
    });

    expect(pkg.title_candidates).toHaveLength(4);
    expect(pkg.selected_title).toBe("楚王连压三次，晏子一次没退");
    expect(pkg.readiness).toBe("ready");
  });

  it("rejects invalid cover_origin", () => {
    expect(() =>
      PublishPackage.parse({
        ...validPackage,
        cover_origin: "ai_generated",
      }),
    ).toThrow();
  });

  it("rejects invalid platform_profile", () => {
    expect(() =>
      PublishPackage.parse({
        ...validPackage,
        platform_profile: "twitter",
      }),
    ).toThrow();
  });

  it("rejects invalid readiness", () => {
    expect(() =>
      PublishPackage.parse({
        ...validPackage,
        readiness: "published",
      }),
    ).toThrow();
  });

  it("rejects invalid title style", () => {
    expect(() =>
      PublishPackage.parse({
        ...validPackage,
        title_candidates: [
          { candidate_id: "c1", text: "test", style: "clickbait" },
        ],
      }),
    ).toThrow();
  });

  it("rejects missing required fields", () => {
    expect(() =>
      PublishPackage.parse({
        package_version: "publish_package_v1",
      }),
    ).toThrow();
  });

  it("rejects wrong package_version", () => {
    expect(() =>
      PublishPackage.parse({
        ...validPackage,
        package_version: "publish_package_v2",
      }),
    ).toThrow();
  });

  it("rejects extra unknown fields", () => {
    expect(() =>
      PublishPackage.parse({
        ...validPackage,
        extra_field: "should not be here",
      }),
    ).toThrow();
  });
});
