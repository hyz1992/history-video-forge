import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  parseScriptBriefShadowFiveRoundArgs,
  runScriptBriefShadowFiveRoundCheck,
} from "../../harness/scripts/runtime/script-brief-shadow-five-round-check";

describe("script brief shadow five-round post-run check", () => {
  it("writes shadow briefs next to topic packages without touching script drafts", async () => {
    const root = mkdtempSync(join(tmpdir(), "svf2-brief-shadow-five-"));
    const sampleDir = join(root, "yanzi-shichu");
    mkdirSync(sampleDir, { recursive: true });
    writeFileSync(
      join(sampleDir, "topic-package.json"),
      JSON.stringify({
        topic_id: "topic_yanzi_shichu",
        canonical_title: "鏅忓瓙浣挎",
        must_include_beats: ["鍏ユ鍙楄颈", "姗樻灣涔嬪柣"],
      }),
      "utf8",
    );
    writeFileSync(
      join(sampleDir, "script-draft.json"),
      JSON.stringify({ script_text: "鍘熻剼鏈笉寰楄淇敼" }),
      "utf8",
    );
    const fixture = JSON.parse(
      readFileSync(
        "harness/samples/script-writing-brief-shadow/yanzi-shichu.fixture.json",
        "utf8",
      ),
    );
    const llmGateway = {
      invokeStructuredPrompt: vi.fn(async () => fixture),
    };

    const result = await runScriptBriefShadowFiveRoundCheck({
      sourceOutputDir: root,
      llmGateway: llmGateway as any,
    });

    expect(result.processedSamples).toBe(1);
    expect(result.writtenFiles).toEqual([
      join(sampleDir, "script-writing-brief-shadow.json"),
    ]);
    expect(
      JSON.parse(readFileSync(join(sampleDir, "script-draft.json"), "utf8")),
    ).toEqual({ script_text: "鍘熻剼鏈笉寰楄淇敼" });
  });

  it("parses npm-forwarded positional source output dir", () => {
    expect(
      parseScriptBriefShadowFiveRoundArgs([
        "node.exe",
        "script-brief-shadow-five-round-check.ts",
        "C:\\tmp\\brief-shadow",
      ]),
    ).toEqual({
      sourceOutputDir: "C:\\tmp\\brief-shadow",
    });
  });
});
