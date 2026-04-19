import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runTopicRuntimeManual } from "../../harness/scripts/runtime/topic-runtime-manual.ts";

describe("topic runtime manual harness", () => {
  it("runs the topic recommendation runtime path without frontend and writes frozen api-shaped outputs", async () => {
    const outputDir = mkdtempSync(join(tmpdir(), "svf2-topic-runtime-manual-"));

    const result = await runTopicRuntimeManual({
      outputDir,
      request: {
        canonical_name: "晏子使楚",
        summary: "楚王在公开场合连续压场，晏子当场顶回去。",
        core_conflict: "楚王当众压场，晏子必须当场顶回。",
        strong_scene: "楚王连续压场，晏子一句句顶回去。",
        source_hint: "《晏子春秋》",
        recent_usage_hint: "近期未出现同 event_id",
        tags: ["diplomacy", "court", "humiliation", "showdown"],
      },
    });

    expect(result.outputDir).toBe(outputDir);
    expect(existsSync(join(outputDir, "topic-recommendation-response.json"))).toBe(true);
    expect(existsSync(join(outputDir, "status.json"))).toBe(true);
    expect(existsSync(join(outputDir, "trace.md"))).toBe(true);

    const response = JSON.parse(
      readFileSync(join(outputDir, "topic-recommendation-response.json"), "utf8"),
    ) as {
      project_id: string;
      event_id: string;
      candidates: Array<{
        candidate_id: string;
        title: string;
        one_line_angle: string;
        family_label: string;
      }>;
    };
    expect(response.project_id).toBeTypeOf("string");
    expect(response.event_id).toBeTypeOf("string");
    expect(response.candidates.length).toBeGreaterThan(0);
    expect(response.candidates[0]).toMatchObject({
      candidate_id: expect.any(String),
      title: "晏子使楚",
      one_line_angle: expect.any(String),
      family_label: expect.any(String),
    });

    const status = JSON.parse(
      readFileSync(join(outputDir, "status.json"), "utf8"),
    ) as { status: string; stage: string };
    expect(status).toMatchObject({
      status: "manual-ready",
      stage: "topic-runtime",
    });
  });
});
