import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildStoryboardFiveRoundQualityCheckPlan,
  parseStoryboardFiveRoundQualityCheckCliArgs,
  runStoryboardFiveRoundQualityCheck,
} from "../../harness/scripts/runtime/storyboard-five-round-quality-check";

const scriptText =
  "楚王第一次压晏子的时候，压的不是身高，而是齐国的面子。晏子站在门前没有弯腰，他知道只要退一次，后面每一次羞辱都会压上来。等到大殿上又有人拿齐人做文章，他没有急着争辩，而是把楚王的问题一点点推回去。最后橘枳之喻落下来，场面反而变成楚国自己失手。";

function writeFixedSource(sourceDir: string) {
  mkdirSync(sourceDir, { recursive: true });
  writeFileSync(
    join(sourceDir, "script-draft.json"),
    JSON.stringify(
      {
        script_text: scriptText,
        estimated_duration_sec: 82,
        beat_trace: [
          {
            beat: "入楚受辱",
            excerpt: "楚王第一次压晏子的时候，压的不是身高，而是齐国的面子。",
            confidence: 0.95,
          },
          {
            beat: "橘枳之喻",
            excerpt: "最后橘枳之喻落下来，场面反而变成楚国自己失手。",
            confidence: 0.95,
          },
        ],
        quote_trace: [
          {
            quote: "橘生淮南则为橘",
            usage_type: "paraphrase",
            excerpt: "最后橘枳之喻落下来，场面反而变成楚国自己失手。",
          },
        ],
        opening_span:
          "楚王第一次压晏子的时候，压的不是身高，而是齐国的面子。",
        ending_span: "最后橘枳之喻落下来，场面反而变成楚国自己失手。",
      },
      null,
      2,
    ),
    "utf8",
  );
  writeFileSync(
    join(sourceDir, "topic-package.json"),
    JSON.stringify(
      {
        topic_id: "topic_yanzi_shichu",
        title: "晏子使楚",
        selected_angle: "楚王连续羞辱晏子，晏子一次都不能退。",
        family_label: "外交压场",
        scope_label: "完整事件",
        core_conflict: "楚王公开羞辱晏子与齐国，晏子必须当场顶回去。",
        stakes: "一退就会让齐国在楚廷失掉体面。",
        strong_scene: "晏子停在狗门前，没有弯腰。",
        packaging_seed: "楚王连压三次，晏子一次没退。",
        must_include_beats: ["入楚受辱", "橘枳之喻"],
        forbidden_expansions: [],
        risk_hints: [],
        source_anchor_refs: ["《晏子春秋》"],
        canonical_quotes: ["橘生淮南则为橘"],
        ambiguity_notes: [],
        duration_band: "medium",
        narrative_tension_map: {
          hook_claim: "楚王连压三次，晏子为什么一次都没退？",
          pressure_escalation: "从门口羞辱升级到大殿压场。",
          mid_reveal: "晏子不是争口气，而是在守齐国场面。",
          peak_payoff: "橘枳之喻把羞辱推回楚王身上。",
          ending_residue: "这种局面，一退就不只是退掉自己。",
        },
      },
      null,
      2,
    ),
    "utf8",
  );
}

describe("storyboard five round quality check", () => {
  it("defines a discoverable five-round storyboard plan from a fixed script artifact", () => {
    const plan = buildStoryboardFiveRoundQualityCheckPlan({
      sourceDir: "fixed-script",
      outputDir: "storyboard-output",
    });

    expect(plan).toMatchObject({
      mode: "storyboard_real_runtime_live_check",
      automated_gate: false,
      requires_real_env: true,
      total_rounds: 5,
      source_script_dir: "fixed-script",
      output_dir: "storyboard-output",
    });
    expect(plan.required_artifacts).toEqual(
      expect.arrayContaining([
        "storyboard-plan.json",
        "storyboard-validation-result.json",
        "runtime-diagnostics.json",
        "trace.md",
      ]),
    );
    expect(plan.required_checks).toContain(
      "每轮固定读取同一份已通过质量观察的 script 产物，不重新运行 topic 或 script。",
    );
  });

  it("runs five storyboard planning rounds and writes reviewable artifacts", async () => {
    const sourceDir = mkdtempSync(join(tmpdir(), "svf2-storyboard-source-"));
    const outputDir = mkdtempSync(join(tmpdir(), "svf2-storyboard-five-round-"));
    writeFixedSource(sourceDir);

    const result = await runStoryboardFiveRoundQualityCheck(
      { sourceDir, outputDir },
      {
        requireRealEnv: false,
        planGenerator: async ({ sourceScriptRecordId, sourceTopicPackageId, draft }) => ({
          plan_version: "storyboard_v1",
          source_script_record_id: sourceScriptRecordId,
          source_topic_package_id: sourceTopicPackageId,
          estimated_total_duration_sec: draft.estimated_duration_sec,
          segments: [
            {
              segment_id: "sb_001",
              order: 0,
              script_excerpt: draft.script_text,
              start_hint_sec: 0,
              end_hint_sec: draft.estimated_duration_sec,
              narrative_role: "opening",
              visual_intent: "把楚廷压场拍成连续升级的视觉段落。",
              scene_description: "晏子停在门前，大殿压力随后压过来。",
              visual_elements: ["晏子", "楚廷", "门口", "大殿"],
              framing_hint: "medium",
              content_type: "live_action",
              motion_hint: "push_in",
              editing_hint: "single",
              on_screen_text: [],
              linked_beats: draft.beat_trace.map((trace) => trace.beat),
              linked_quotes: draft.quote_trace.map((trace) => trace.quote),
              risk_notes: [],
            },
          ],
          global_visual_notes: ["固定 script 输入，只观察 storyboard planning 稳定性。"],
        }),
      },
    );

    expect(result).toMatchObject({
      automated_gate: false,
      requires_real_env: true,
      total_rounds: 5,
      passed_rounds: 5,
      failed_rounds: 0,
    });

    const summary = JSON.parse(
      readFileSync(join(outputDir, "live-check-summary.json"), "utf8"),
    ) as {
      total_rounds: number;
      rounds: Array<{ round: number; output_dir: string; validation_decision: string }>;
    };
    expect(summary.total_rounds).toBe(5);
    expect(summary.rounds.map((round) => round.validation_decision)).toEqual([
      "pass",
      "pass",
      "pass",
      "pass",
      "pass",
    ]);
    expect(readFileSync(join(outputDir, "round-1", "storyboard-plan.json"), "utf8")).toContain(
      "storyboard_v1",
    );

    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts?: Record<string, string>;
    };
    expect(packageJson.scripts).toMatchObject({
      "harness:storyboard-five-round-quality-check":
        "tsx harness/scripts/runtime/storyboard-five-round-quality-check.ts",
    });

    const readme = readFileSync("harness/README.md", "utf8");
    expect(readme).toContain("harness:storyboard-five-round-quality-check");
    expect(readme).toContain("固定高质量 script 产物");
  });

  it("accepts positional output directory and explicit source directory", () => {
    expect(
      parseStoryboardFiveRoundQualityCheckCliArgs([
        "--source-dir",
        "fixed-source",
        "storyboard-output",
      ]),
    ).toEqual({
      sourceDir: "fixed-source",
      outputDir: "storyboard-output",
    });
  });
});
