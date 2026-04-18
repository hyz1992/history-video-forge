import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runTopicToScriptSample } from "./run-topic-to-script-sample.ts";

test("runtime harness 生成最小 topic->script 样例产物", () => {
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
    assert.equal(existsSync(join(outputDir, file)), true, `缺少输出文件：${file}`);
  }

  const status = JSON.parse(readFileSync(join(outputDir, "status.json"), "utf8"));
  assert.equal(status.status, "sample-ready");
  assert.equal(status.stage, "topic-to-script");

  const topicCandidates = JSON.parse(
    readFileSync(join(outputDir, "topic-candidates.json"), "utf8"),
  );
  assert.equal(Array.isArray(topicCandidates), true);
  assert.equal(topicCandidates.length > 0, true);
  assert.equal(topicCandidates[0].viral_rubric.hook_power, "high");

  const topicPackage = JSON.parse(readFileSync(join(outputDir, "topic-package.json"), "utf8"));
  assert.equal(topicPackage.narrative_tension_map.hook_claim.length > 0, true);

  const scriptInput = JSON.parse(
    readFileSync(join(outputDir, "script-input-bundle.json"), "utf8"),
  );
  assert.equal(scriptInput.packaging_lane.hook_claim.length > 0, true);

  const scriptDraft = JSON.parse(readFileSync(join(outputDir, "script-draft.json"), "utf8"));
  assert.equal(scriptDraft.beat_trace.length > 0, true);

  const validation = JSON.parse(
    readFileSync(join(outputDir, "validation-result.json"), "utf8"),
  );
  assert.equal(validation.stage, "script_local_validation");

  const semantic = JSON.parse(
    readFileSync(join(outputDir, "semantic-review-result.json"), "utf8"),
  );
  assert.equal(semantic.stage, "script_semantic_review");
  assert.equal(result.outputDir, outputDir);
});
