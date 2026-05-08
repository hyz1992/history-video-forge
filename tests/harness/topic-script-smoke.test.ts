import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runTopicScriptSmoke } from "../../harness/scripts/runtime/topic-script-smoke";

describe("topic script smoke harness", () => {
  it("runs the minimal topic to script chain from external sample files", async () => {
    const outputDir = mkdtempSync(join(tmpdir(), "svf2-topic-script-smoke-"));
    const samples = [
      "harness/samples/topic-script/yanzi-shichu.sample.json",
      "harness/samples/topic-script/zhuanzhu-ciwangliao.sample.json",
    ];

    for (const sample of samples) {
      expect(existsSync(sample)).toBe(true);
    }

    const result = await runTopicScriptSmoke({
      samplePath: samples[0],
      outputDir,
    });

    expect(result.sample.sample_id).toBe("yanzi-shichu");
    expect(result.status.status).toBe("sample-ready");
    expect(result.status.stage).toBe("topic-to-script");

    const topicPackage = JSON.parse(
      readFileSync(join(outputDir, "topic-package.json"), "utf8"),
    ) as {
      canonical_title: string;
      canonical_quotes: string[];
      canonical_quote_intents: Array<{ quote: string; intent: string }>;
      narrative_tension_map: { hook_claim: string };
    };
    expect(topicPackage.canonical_title).toBe("晏子使楚");
    expect(topicPackage.canonical_quotes).toEqual([
      "使狗国者，从狗门入",
      "橘生淮南则为橘，生于淮北则为枳",
    ]);
    expect(topicPackage.canonical_quote_intents).toEqual([
      {
        quote: "使狗国者，从狗门入",
        intent:
          "用于反击楚王以狗门羞辱齐国使节：只有出使狗国才走狗门，出使楚国不应走狗门。",
      },
      {
        quote: "橘生淮南则为橘，生于淮北则为枳",
        intent:
          "用于反击楚王以齐人善盗羞辱齐国：齐人在齐不盗，入楚为盗，是楚国水土/环境使然。",
      },
    ]);
    expect(topicPackage.narrative_tension_map.hook_claim.length).toBeGreaterThan(0);

    const validationResult = JSON.parse(
      readFileSync(join(outputDir, "validation-result.json"), "utf8"),
    ) as { stage: string; decision: string };
    expect(validationResult.stage).toBe("script_local_validation");
    expect(validationResult.decision).toBe("pass");

    const semanticReview = JSON.parse(
      readFileSync(join(outputDir, "semantic-review-result.json"), "utf8"),
    ) as { stage: string; decision: string };
    expect(semanticReview.stage).toBe("script_semantic_review");
    expect(["pass", "patch_once", "skipped"]).toContain(semanticReview.decision);

    const previewTrace = JSON.parse(
      readFileSync(join(outputDir, "topic-candidate-preview-trace.json"), "utf8"),
    ) as {
      raw_candidates: Array<{ must_cover_preview: string[] }>;
      selector_pool: Array<{ must_cover_preview: string[] }>;
      final_candidates: Array<{ must_cover_preview: string[] }>;
    };

    expect(previewTrace.final_candidates.length).toBeGreaterThan(0);
    expect(previewTrace.final_candidates[0]?.must_cover_preview.length).toBeGreaterThan(0);
    expect(Array.isArray(previewTrace.raw_candidates)).toBe(true);
    expect(Array.isArray(previewTrace.selector_pool)).toBe(true);
  });
});
