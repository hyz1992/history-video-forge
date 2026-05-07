import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { runScriptWritingBriefShadow } from "../../harness/scripts/runtime/script-writing-brief-shadow";

describe("script writing brief shadow harness helper", () => {
  it("writes a validated shadow brief without creating writer inputs", async () => {
    const outputDir = mkdtempSync(join(tmpdir(), "svf2-brief-shadow-"));
    const topicPackagePath = join(outputDir, "topic-package.json");
    writeFileSync(
      topicPackagePath,
      JSON.stringify(
        {
          topic_id: "topic_yanzi_shichu",
          canonical_title: "Yanzi envoy to Chu",
          selected_angle: "Chu humiliates Yanzi in public.",
          scope_label: "single_event",
          core_conflict: "Yanzi must answer public humiliation without retreating.",
          stakes: "If he retreats, Qi loses face.",
          must_include_beats: ["鍏ユ鍙楄颈", "姗樻灣涔嬪柣"],
          forbidden_expansions: ["do not expand downstream"],
          source_anchor_refs: ["Yanzi Chunqiu"],
          canonical_quotes: ["浣跨嫍鍥借€咃紝浠庣嫍闂ㄥ叆"],
          canonical_quote_intents: [
            {
              quote: "浣跨嫍鍥借€咃紝浠庣嫍闂ㄥ叆",
              intent: "Answer the dog gate humiliation.",
            },
          ],
          ambiguity_notes: [],
          narrative_tension_map: {
            hook_claim: "Chu keeps humiliating Yanzi.",
            pressure_escalation: "The pressure moves from gate insult to theft insult.",
            mid_reveal: "Yanzi turns the insult back on Chu.",
            peak_payoff: "The orange metaphor turns the blame back to Chu.",
            ending_residue: "Chu's trap pressures itself.",
          },
        },
        null,
        2,
      ),
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

    const result = await runScriptWritingBriefShadow({
      topicPackagePath,
      outputDir,
      llmGateway: llmGateway as any,
    });

    expect(result.outputPath).toBe(join(outputDir, "script-writing-brief-shadow.json"));
    expect(existsSync(result.outputPath)).toBe(true);
    expect(existsSync(join(outputDir, "script-input-bundle.json"))).toBe(false);
    expect(llmGateway.invokeStructuredPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        promptId: "script.writing-brief-shadow",
      }),
    );
  });
});
