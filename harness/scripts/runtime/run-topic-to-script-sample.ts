import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

type RuntimeSampleResult = {
  outputDir: string;
  generatedAt: string;
};

function writeJson(outputDir: string, filename: string, value: unknown): void {
  writeFileSync(resolve(outputDir, filename), JSON.stringify(value, null, 2), "utf8");
}

export function runTopicToScriptSample(outputDir?: string): RuntimeSampleResult {
  const finalOutputDir =
    outputDir ?? resolve(process.cwd(), "harness/scripts/runtime/output");
  mkdirSync(finalOutputDir, { recursive: true });

  const generatedAt = new Date().toISOString();

  const topicCandidates = [
    {
      candidate_id: "cand_evt_yan_zi_shi_chu_reversal",
      event_id: "evt_yan_zi_shi_chu",
      title: "晏子使楚",
      one_line_angle: "楚王连压三次，晏子一次没退",
      family_label: "外交压场型",
      scope_label: "完整事件",
      estimated_duration_band: {
        min_sec: 75,
        max_sec: 95,
      },
      why_this_now: "强对抗、强反顶、强画面，适合验证 topic->script 最小闭环",
      core_conflict: "楚王借公开场合连续羞辱晏子与齐国，晏子必须当场顶回去。",
      strong_scene: "楚王接连压场，晏子一句句原样顶回。",
      must_cover_preview: ["狗门羞辱", "齐国无人", "橘枳之喻"],
      risk_hints: ["不要写成课堂讲义", "不要只讲狗门，不讲三次压场递进"],
      source_hint: "主要史料：晏子春秋",
      recent_usage_hint: "当前为固定 harness 样例，不代表真实推荐状态",
      viral_rubric: {
        hook_power: "high",
        novelty_gap: "medium",
        emotion_gap: "high",
        share_impulse: "high",
        visual_promise: "high",
      },
    },
  ];

  const topicPackage = {
    topic_package_id: "tpk_runtime_sample_yanzi",
    source_mode: "recommended",
    event_id: "evt_yan_zi_shi_chu",
    canonical_title: "晏子使楚",
    selected_angle: "楚王连压三次，晏子一次没退",
    family_label: "外交压场型",
    scope_label: "完整事件",
    core_conflict: "楚王连续在公开场合压晏子，晏子必须当场守住齐国场面。",
    stakes: "一旦退让，就不只是个人失面，而是齐国被当场压住。",
    must_include_beats: [
      "狗门羞辱",
      "齐国无人",
      "使臣规制反击",
      "楚国借盗贼羞辱齐人",
      "橘枳之喻反顶",
    ],
    forbidden_expansions: ["不要拔高成改写天下格局", "不要追加无史料依据的群臣群像"],
    risk_hints: ["不要写成成语堆砌", "不要压平三次压场递进"],
    source_anchor_refs: ["《晏子春秋》"],
    canonical_quotes: ["使狗国者，从狗门入", "橘生淮南则为橘，生于淮北则为枳"],
    ambiguity_notes: "",
    duration_band: {
      min_sec: 75,
      max_sec: 95,
    },
    voice_hint: "强旁白解说",
    strong_scene: "楚王当场连续压人，晏子句句顶回。",
    packaging_seed: "楚王连压三次，晏子一次没退",
    narrative_tension_map: {
      hook_claim: "楚王不是只压了晏子一次，而是连续压了三次。",
      pressure_escalation: "从狗门羞辱，升级到羞辱齐国，再升级到羞辱齐人风气。",
      mid_reveal: "晏子不是耍嘴皮子，而是在守住齐国场面。",
      peak_payoff: "橘枳之喻把第三次压场原样顶回。",
      ending_residue: "这种场面里，一退就不只是退掉自己。",
    },
  };

  const topicDeliveryPack = {
    opening_move: "question",
    opening_pressure_level: "high",
    voice_tilt: "sharper",
    pacing_tilt: "neutral",
    ending_tilt: "judgment",
    visual_tilt: ["faces", "courtroom"],
    hook_claim: "如果有人当着所有人的面羞辱你，你敢不敢当场顶回去？",
    hook_emotion: "压迫",
    reveal_position: "mid",
    caution_notes: ["不要把 hook 写成课堂导入", "不要让包装 promise 偏离 narrative_tension_map.hook_claim"],
  };

  const scriptInputBundle = {
    hard_lane: {
      event_id: topicPackage.event_id,
      canonical_title: topicPackage.canonical_title,
      selected_angle: topicPackage.selected_angle,
      family_label: topicPackage.family_label,
      scope_label: topicPackage.scope_label,
      core_conflict: topicPackage.core_conflict,
      stakes: topicPackage.stakes,
      must_include_beats: topicPackage.must_include_beats,
      forbidden_expansions: topicPackage.forbidden_expansions,
      source_anchor_refs: topicPackage.source_anchor_refs,
      canonical_quotes: topicPackage.canonical_quotes,
      ambiguity_notes: topicPackage.ambiguity_notes,
    },
    soft_lane: {
      narrator_persona: "冷静犀利",
      wording_register: "sharp_oral",
      pacing_baseline: "tight",
      voice_tilt: topicDeliveryPack.voice_tilt,
      pacing_tilt: topicDeliveryPack.pacing_tilt,
      opening_move: topicDeliveryPack.opening_move,
      opening_pressure_level: topicDeliveryPack.opening_pressure_level,
      ending_tilt: topicDeliveryPack.ending_tilt,
      strong_scene: topicPackage.strong_scene,
      visual_tilt: topicDeliveryPack.visual_tilt,
    },
    packaging_lane: {
      hook_claim: topicDeliveryPack.hook_claim,
      hook_emotion: topicDeliveryPack.hook_emotion,
      reveal_position: topicDeliveryPack.reveal_position,
    },
  };

  const scriptDraft = {
    script_text:
      "楚王见晏子个子矮，偏偏不开正门，只留一扇又矮又窄的小门，意思很明白：我今天先羞辱你，再羞辱你背后的齐国。可晏子根本没顺着走。他一句，使狗国者从狗门入，我今天要是从这门进去，那你楚国先得承认自己是狗国。第一下，楚王没压住。第二下更狠，楚王当着众人说，齐国是不是没人了，怎么派你来？晏子没有急着逞口舌，他直接把使臣规制抬出来：贤者使贤主，不肖者使不肖主。我今天被派到楚国，恰恰说明该怎么派。第三下，楚国又借盗贼当众羞辱齐人风气。到这时候，晏子才把最重的一句压回去：橘生淮南则为橘，生于淮北则为枳。东西没变，变的是水土。你想羞辱齐人，最后反而把楚国自己的场面拆了。晏子使楚最厉害的地方，不是会说，而是在别人连压三次的时候，一次都没退。",
    estimated_duration_sec: 88,
    beat_trace: [
      { beat: "狗门羞辱", excerpt: "偏偏不开正门，只留一扇又矮又窄的小门", confidence: 0.96 },
      { beat: "齐国无人", excerpt: "楚王当着众人说，齐国是不是没人了，怎么派你来", confidence: 0.95 },
      { beat: "使臣规制反击", excerpt: "贤者使贤主，不肖者使不肖主", confidence: 0.93 },
      { beat: "楚国借盗贼羞辱齐人", excerpt: "楚国又借盗贼当众羞辱齐人风气", confidence: 0.9 },
      { beat: "橘枳之喻反顶", excerpt: "橘生淮南则为橘，生于淮北则为枳", confidence: 0.98 },
    ],
    quote_trace: [
      {
        quote: "使狗国者，从狗门入",
        usage_type: "paraphrase",
        excerpt: "我今天要是从这门进去，那你楚国先得承认自己是狗国",
      },
      {
        quote: "橘生淮南则为橘，生于淮北则为枳",
        usage_type: "exact",
        excerpt: "橘生淮南则为橘，生于淮北则为枳",
      },
    ],
    opening_span: "楚王见晏子个子矮，偏偏不开正门，只留一扇又矮又窄的小门。",
    ending_span: "晏子使楚最厉害的地方，不是会说，而是在别人连压三次的时候，一次都没退。",
  };

  const validationResult = {
    stage: "script_local_validation",
    decision: "pass",
    errors: [],
    warnings: [],
    metrics: {
      estimated_duration_sec: 88,
      duration_band_min_sec: 75,
      duration_band_max_sec: 95,
      beat_coverage_count: 5,
      beat_expected_count: 5,
    },
  };

  const semanticReviewResult = {
    stage: "script_semantic_review",
    decision: "pass",
    patch_intent: null,
    hard_issues: [],
    soft_issues: [],
    patch_targets: [],
    summary: "样例脚本结构完整，适合作为 runtime harness 的最小通路验证样本。",
    confidence: 0.84,
  };

  writeJson(finalOutputDir, "topic-candidates.json", topicCandidates);
  writeJson(finalOutputDir, "topic-package.json", topicPackage);
  writeJson(finalOutputDir, "topic-delivery-pack.json", topicDeliveryPack);
  writeJson(finalOutputDir, "script-input-bundle.json", scriptInputBundle);
  writeJson(finalOutputDir, "script-draft.json", scriptDraft);
  writeJson(finalOutputDir, "validation-result.json", validationResult);
  writeJson(finalOutputDir, "semantic-review-result.json", semanticReviewResult);
  writeJson(finalOutputDir, "status.json", {
    generatedAt,
    status: "sample-ready",
    stage: "topic-to-script",
    outputDir: finalOutputDir,
  });

  writeFileSync(
    resolve(finalOutputDir, "trace.md"),
    [
      "# topic-to-script runtime trace",
      "",
      `- generated_at: ${generatedAt}`,
      "- status: sample-ready",
      "- flow: topic-candidates -> topic-package -> script-input-bundle -> script-draft -> validation-result -> semantic-review-result",
      `- output_dir: ${finalOutputDir}`,
      "",
      "## 样例说明",
      "",
      "- 当前为固定样例链路，不调用真实业务服务。",
      "- 目标是验证 harness 在本地能稳定产出最小 topic->script 中间对象与 trace。",
      "- 后续接线真实 topic/script 服务时，应保留相同输出语义。",
      "",
    ].join("\n"),
    "utf8",
  );

  return {
    outputDir: finalOutputDir,
    generatedAt,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const result = runTopicToScriptSample();
  console.log(`runtime harness 样例已生成，输出目录：${result.outputDir}`);
}
