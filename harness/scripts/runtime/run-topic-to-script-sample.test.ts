import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { runTopicToScriptSample } from "./run-topic-to-script-sample.ts";

describe("run topic to script sample", () => {
  it("runtime harness 生成最小 topic->script 样例产物", () => {
    const outputDir = mkdtempSync(join(tmpdir(), "svf2-runtime-sample-"));

    const result = runTopicToScriptSample(outputDir);

    const expectedFiles = [
      "topic-candidates.json",
      "topic-package.json",
      "script-input-bundle.json",
      "script-draft.json",
      "validation-result.json",
      "semantic-review-result.json",
      "trace.md",
      "status.json",
    ];

    for (const file of expectedFiles) {
      expect(existsSync(join(outputDir, file)), `缺少输出文件：${file}`).toBe(true);
    }

    const status = JSON.parse(readFileSync(join(outputDir, "status.json"), "utf8"));
    expect(status.status).toBe("sample-ready");
    expect(status.stage).toBe("topic-to-script");

    const topicCandidates = JSON.parse(
      readFileSync(join(outputDir, "topic-candidates.json"), "utf8"),
    );
    expect(Array.isArray(topicCandidates)).toBe(true);
    expect(topicCandidates.length > 0).toBe(true);
    expect(topicCandidates[0].viral_rubric.hook_power).toBe("high");

    const topicPackage = JSON.parse(
      readFileSync(join(outputDir, "topic-package.json"), "utf8"),
    );
    expect(topicPackage.narrative_tension_map.hook_claim.length > 0).toBe(true);

    const scriptInput = JSON.parse(
      readFileSync(join(outputDir, "script-input-bundle.json"), "utf8"),
    );
    expect(scriptInput.packaging_lane.hook_claim.length > 0).toBe(true);

    const scriptDraft = JSON.parse(
      readFileSync(join(outputDir, "script-draft.json"), "utf8"),
    );
    expect(scriptDraft.beat_trace.length > 0).toBe(true);

    const validation = JSON.parse(
      readFileSync(join(outputDir, "validation-result.json"), "utf8"),
    );
    expect(validation.stage).toBe("script_local_validation");

    const semantic = JSON.parse(
      readFileSync(join(outputDir, "semantic-review-result.json"), "utf8"),
    );
    expect(semantic.stage).toBe("script_semantic_review");
    expect(result.outputDir).toBe(outputDir);
  });
});
