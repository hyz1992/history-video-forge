import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { probeVideoMetadata, isFfprobeAvailable } from "../../../backend/src/http/video-probe.js";

describe("probeVideoMetadata", () => {
  it("ffprobe 不可用时抛出异常", async () => {
    // This test is valid in all environments — if ffprobe is missing, it should throw
    // We test by probing a non-existent file; if ffprobe is available, it throws differently
    const available = await isFfprobeAvailable();
    if (!available) {
      await expect(probeVideoMetadata("/nonexistent.mp4")).rejects.toThrow("ffprobe_not_available");
    }
    // If ffprobe IS available, we skip this test (it's covered by integration test)
  });
});
