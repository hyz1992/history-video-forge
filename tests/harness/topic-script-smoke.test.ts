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
      narrative_tension_map: { hook_claim: string };
    };
    expect(topicPackage.canonical_title).toBe("晏子使楚");
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
    expect(["pass", "patch_once"]).toContain(semanticReview.decision);
  });
});
