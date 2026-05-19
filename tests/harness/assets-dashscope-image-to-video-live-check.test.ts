import packageJson from "../../package.json";
import {
  buildImageToVideoLiveCheckPlan,
} from "../../harness/scripts/runtime/assets-dashscope-image-to-video-live-check";

import { describe, expect, it } from "vitest";

describe("assets DashScope image-to-video live check", () => {
  it("registers an explicit package script outside default automation", () => {
    expect(packageJson.scripts["harness:assets-dashscope-image-to-video-live-check"]).toBe(
      "tsx harness/scripts/runtime/assets-dashscope-image-to-video-live-check.ts",
    );
  });

  it("builds a plan with a video_clip task and required image-to-video env", () => {
    const plan = buildImageToVideoLiveCheckPlan();

    expect(plan.tasks.some((task) => task.task_type === "video_clip")).toBe(true);
    expect(plan.tasks.some((task) => task.task_type === "image_still")).toBe(true);
    expect(plan.tasks.some((task) => task.task_type === "render_motion_cue")).toBe(true);
    expect(plan.required_env_keys).toEqual(
      expect.arrayContaining([
        "ALIYUN_DASHSCOPE_API_KEY",
        "ALIYUN_DASHSCOPE_IMAGE_TO_VIDEO_MODEL",
      ]),
    );
    expect(plan.automated_gate).toBe(false);
    expect(plan.provider_mode).toBe("dashscope");
  });
});
