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

function writeFixedSource(
  sourceDir: string,
  input: { topicId?: string; title?: string } = {},
) {
  const topicId = input.topicId ?? "topic_yanzi_shichu";
  const title = input.title ?? "晏子使楚";
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
        topic_id: topicId,
        title,
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

function writeArchivedTopicPackageShape(sourceDir: string) {
  writeFileSync(
    join(sourceDir, "topic-package.json"),
    JSON.stringify(
      {
        topic_package_id: "archived-topic-package",
        event_id: "archived-event",
        canonical_title: "晏子使楚",
        selected_angle: "弱国外交官如何在强国宫廷用智慧捍卫国家尊严",
        family_label: "外交智慧",
        scope_label: "春秋外交",
        core_conflict: "楚王当众羞辱，晏子不能退。",
        stakes: "一退就会让齐国在楚廷失掉体面。",
        strong_scene: "楚王连番压场，晏子一句句顶回去。",
        must_include_beats: ["入楚受辱", "橘枳之喻"],
        forbidden_expansions: [],
        source_anchor_refs: ["《晏子春秋》"],
        canonical_quotes: ["橘生淮南则为橘"],
        canonical_quote_intents: [
          {
            quote: "橘生淮南则为橘",
            intent: "反击楚王以齐人善盗羞辱齐国。",
          },
        ],
        ambiguity_notes: [],
        duration_band: {
          label: "medium",
          min_sec: 75,
          max_sec: 95,
        },
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
  it("defines a discoverable five-round storyboard plan from different fixed script artifacts", () => {
    const plan = buildStoryboardFiveRoundQualityCheckPlan({
      outputDir: "storyboard-output",
    });

    expect(plan).toMatchObject({
      mode: "storyboard_real_runtime_live_check",
      automated_gate: false,
      requires_real_env: true,
      total_rounds: 5,
      output_dir: "storyboard-output",
    });
    expect(plan.source_script_dirs).toHaveLength(5);
    expect(new Set(plan.source_script_dirs).size).toBe(5);
    expect(plan.required_artifacts).toEqual(
      expect.arrayContaining([
        "storyboard-plan.json",
        "storyboard-validation-result.json",
        "runtime-diagnostics.json",
        "trace.md",
      ]),
    );
    expect(plan.required_checks).toContain(
      "默认 5 轮分别读取 5 个不同主题的高质量 script 产物，不重新运行 topic 或 script。",
    );
    expect(plan.required_checks).toContain(
      "真实 storyboard live check 建议显式设置 LLM_TIMEOUT_MS=240000；该参数只用于人工巡检运行，不改变默认自动化 gate。",
    );
  });

  it("runs five storyboard planning rounds and writes reviewable artifacts", async () => {
    const sourceDirs = Array.from({ length: 5 }, (_, index) =>
      mkdtempSync(join(tmpdir(), `svf2-storyboard-source-${index + 1}-`)),
    );
    const outputDir = mkdtempSync(join(tmpdir(), "svf2-storyboard-five-round-"));
    sourceDirs.forEach((sourceDir, index) => {
      writeFixedSource(sourceDir, {
        topicId: `topic_${index + 1}`,
        title: `测试主题${index + 1}`,
      });
    });

    const result = await runStoryboardFiveRoundQualityCheck(
      { sourceDirs, outputDir },
      {
        requireRealEnv: false,
        planGenerator: async ({
          sourceScriptRecordId,
          sourceTopicPackageId,
          draft,
          topicBoundaryContext,
        }) => ({
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
              visual_intent: `把${topicBoundaryContext.title}拍成连续升级的视觉段落。`,
              scene_description: `${topicBoundaryContext.title}的压力场面。`,
              visual_elements: [topicBoundaryContext.title, "压力场面"],
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
      rounds: Array<{
        round: number;
        output_dir: string;
        source_title: string;
        validation_decision: string;
      }>;
    };
    expect(summary.total_rounds).toBe(5);
    expect(summary.rounds.map((round) => round.source_title)).toEqual([
      "测试主题1",
      "测试主题2",
      "测试主题3",
      "测试主题4",
      "测试主题5",
    ]);
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
    expect(readme).toContain("5 个不同主题的高质量 script 产物");
    expect(readme).toContain("LLM_TIMEOUT_MS=240000");
    expect(readme).toContain("只作为 storyboard live check 的显式运行参数");
  });

  it("accepts positional output directory and explicit source directory", () => {
    expect(
      parseStoryboardFiveRoundQualityCheckCliArgs([
        "--source-dir",
        "fixed-source",
        "storyboard-output",
      ]),
    ).toEqual({
      sourceDirs: ["fixed-source"],
      outputDir: "storyboard-output",
    });
  });

  it("normalizes archived topic-package artifacts used by historical high-quality script outputs", async () => {
    const sourceDir = mkdtempSync(join(tmpdir(), "svf2-storyboard-archived-source-"));
    const outputDir = mkdtempSync(join(tmpdir(), "svf2-storyboard-archived-output-"));
    writeFixedSource(sourceDir);
    writeArchivedTopicPackageShape(sourceDir);

    const result = await runStoryboardFiveRoundQualityCheck(
      { sourceDir, outputDir, rounds: 1 },
      {
        requireRealEnv: false,
        planGenerator: async ({ sourceTopicPackageId, topicBoundaryContext, draft }) => {
          expect(sourceTopicPackageId).toBe("archived-topic-package");
          expect(topicBoundaryContext.title).toBe("晏子使楚");
          return {
            plan_version: "storyboard_v1",
            source_script_record_id: "fixed-script-record",
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
                scene_description: topicBoundaryContext.strong_scene,
                visual_elements: ["晏子", "楚廷"],
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
            global_visual_notes: [],
          };
        },
      },
    );

    expect(result.passed_rounds).toBe(1);
  });

  it("regenerates once when local storyboard validation requests regen_once", async () => {
    const sourceDir = mkdtempSync(join(tmpdir(), "svf2-storyboard-regen-source-"));
    const outputDir = mkdtempSync(join(tmpdir(), "svf2-storyboard-regen-output-"));
    writeFixedSource(sourceDir);
    let callCount = 0;

    const result = await runStoryboardFiveRoundQualityCheck(
      { sourceDirs: [sourceDir], outputDir, rounds: 1 },
      {
        requireRealEnv: false,
        planGenerator: async ({
          sourceScriptRecordId,
          sourceTopicPackageId,
          draft,
          regenerationContext,
        }) => {
          callCount += 1;
          expect(callCount === 1 ? regenerationContext : regenerationContext?.reason).toBe(
            callCount === 1 ? undefined : "storyboard_local_validation_regen_once",
          );
          return {
            plan_version: "storyboard_v1",
            source_script_record_id: sourceScriptRecordId,
            source_topic_package_id: sourceTopicPackageId,
            estimated_total_duration_sec: draft.estimated_duration_sec,
            segments: [
              {
                segment_id: "sb_001",
                order: 0,
                script_excerpt:
                  callCount === 1
                    ? draft.script_text.slice(0, 30)
                    : draft.script_text,
                start_hint_sec: 0,
                end_hint_sec: draft.estimated_duration_sec,
                narrative_role: "opening",
                visual_intent: "把压力场面拍成连续升级的视觉段落。",
                scene_description: "压力场面。",
                visual_elements: ["压力场面"],
                framing_hint: "medium",
                content_type: "live_action",
                motion_hint: "push_in",
                editing_hint: "single",
                on_screen_text: [],
                linked_beats:
                  callCount === 1 ? [] : draft.beat_trace.map((trace) => trace.beat),
                linked_quotes:
                  callCount === 1 ? [] : draft.quote_trace.map((trace) => trace.quote),
                risk_notes: [],
              },
            ],
            global_visual_notes: [],
          };
        },
      },
    );

    expect(callCount).toBe(2);
    expect(result.rounds[0]).toMatchObject({
      validation_decision: "pass",
      regenerated: true,
    });
    expect(
      JSON.parse(
        readFileSync(join(outputDir, "round-1", "runtime-diagnostics.json"), "utf8"),
      ),
    ).toMatchObject({
      checks: expect.arrayContaining([
        expect.objectContaining({ code: "storyboard_regen_once" }),
      ]),
    });
  });
});
