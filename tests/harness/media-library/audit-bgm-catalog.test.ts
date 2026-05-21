import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { auditBgmCatalog } from "../../../harness/scripts/media-library/audit-bgm-catalog";

describe("auditBgmCatalog", () => {
  it("builds a review-oriented report for generated BGM entries", async () => {
    const root = await mkdtemp(join(tmpdir(), "bgm-audit-"));
    try {
      const audioDir = join(root, "storage/media-library/audio/bgm");
      await mkdir(audioDir, { recursive: true });
      await writeFile(join(audioDir, "present.wav"), "fake wav");

      const catalogPath = join(root, "storage/media-library/ai-bgm-prompt-candidates.json");
      await writeFile(
        catalogPath,
        JSON.stringify({
          generated_at: "2026-05-21T00:00:00.000Z",
          items: [
            {
              library_item_id: "bgm_present",
              type: "bgm",
              title: "Present BGM",
              status: "generated_pending_review",
              file_uri: "storage/media-library/audio/bgm/present.wav",
              duration_sec: 88.4,
              tags: ["background", "historical"],
              mood_tags: ["solemn"],
              suitable_for: ["court"],
              avoid_for: ["battle"],
              generation_priority: 2,
              audio_stats: {
                rms_db: -13.9,
                peak_db: -0.1,
                clipped_ratio: 0.002,
                silent_ratio: 0.01,
              },
              quality_notes: ["needs listening"],
              volume_hint: 0.16,
              review: {
                manual_decision: "",
                notes: "",
              },
            },
            {
              library_item_id: "bgm_missing",
              type: "bgm",
              title: "Missing BGM",
              status: "generated_pending_review",
              file_uri: "storage/media-library/audio/bgm/missing.wav",
              duration_sec: 92,
              tags: ["background"],
              mood_tags: [],
            },
            {
              library_item_id: "bgm_prompt_only",
              type: "bgm",
              status: "prompt_only",
              file_uri: "",
              tags: ["background"],
            },
          ],
        }),
      );

      const report = await auditBgmCatalog({
        catalogPath,
        rootDir: root,
        generatedAt: "2026-05-21T01:00:00.000Z",
      });

      expect(report.schema_version).toBe("bgm_quality_audit_report_v1");
      expect(report.summary).toMatchObject({
        total_generated_items: 2,
        files_present: 1,
        files_missing: 1,
        pending_manual_review: 2,
        loud_or_peak_risk_items: 1,
      });
      expect(report.items).toHaveLength(2);
      expect(report.items[0]).toMatchObject({
        library_item_id: "bgm_present",
        title: "Present BGM",
        file_uri: "storage/media-library/audio/bgm/present.wav",
        file_exists: true,
        duration_sec: 88.4,
        volume_hint: 0.16,
        listen_priority: 2,
        tags: ["background", "historical"],
        mood_tags: ["solemn"],
        suitable_for: ["court"],
        avoid_for: ["battle"],
        review: {
          manual_decision: "",
          notes: "",
        },
      });
      expect(report.items[0]?.auto_flags).toEqual([
        "rms_db偏高，做口播背景时要重点听是否抢人声",
        "峰值接近0dB，混音时要留意爆音或压缩感",
        "检测到少量削波风险",
      ]);
      expect(report.items[1]).toMatchObject({
        library_item_id: "bgm_missing",
        file_exists: false,
        auto_flags: ["音频文件缺失"],
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
