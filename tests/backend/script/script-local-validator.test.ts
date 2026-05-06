import { describe, expect, it } from "vitest";

import {
  ScriptDraftPackage,
  ScriptInputBundle,
  ScriptValidationResult,
  TopicDeliveryPack,
  TopicPackage,
} from "../../../shared/src/index.js";
import { generateScriptDraft } from "../../../backend/src/modules/script/script-generation.service.js";
import { validateScriptDraft } from "../../../backend/src/modules/script/script-local-validator.js";

const topicPackage = TopicPackage.parse({
  topic_id: "topic_yanzi_shichu",
  title: "晏子使楚",
  selected_angle: "楚王不是只压晏子一次，而是连续压了三次。",
  family_label: "外交压场型",
  scope_label: "完整事件",
  core_conflict: "楚王借公开场合连续羞辱晏子与齐国，晏子必须当场顶回去。",
  strong_scene: "楚王连续压场，晏子一句句顶回去。",
  packaging_seed: "楚王连压三次，晏子一次没退。",
  stakes: "当场退让，丢掉的不只是个人体面，还有齐国场面。",
  must_include_beats: ["入楚受辱", "橘淮之辩"],
  forbidden_expansions: ["不要扩写到未定 downstream 阶段"],
  risk_hints: ["不要把内容写成课堂导入"],
  source_anchor_refs: ["《晏子春秋》"],
  canonical_quotes: ["橘生淮南则为橘"],
  ambiguity_notes: [],
  duration_band: "medium",
  narrative_tension_map: {
    hook_claim: "楚王不是只压晏子一次，而是连续压了三次。",
    pressure_escalation: "从羞辱身形升级到羞辱齐国，再升级到羞辱齐人风气。",
    mid_reveal: "晏子不是在斗口舌，而是在守住齐国场面。",
    peak_payoff: "橘淮之辩把第三次压场原样顶回。",
    ending_residue: "这种场面，一退就不只是退掉自己。",
  },
});

const topicDeliveryPack = TopicDeliveryPack.parse({
  opening_move: "question",
  opening_pressure_level: "high",
  voice_tilt: "sharper",
  pacing_tilt: "fast",
  ending_tilt: "judgment",
  visual_tilt: ["faces", "courtroom"],
  hook_claim: "楚王不是只压晏子一次，而是连续压了三次，你敢当场顶回去吗？",
  hook_emotion: "压迫",
  reveal_position: "mid",
  caution_notes: [
    "不要把 hook 写成课堂导入",
    "不要让包装 promise 偏离 narrative_tension_map.hook_claim",
  ],
});

const scriptInputBundle = ScriptInputBundle.parse({
  topic_package: topicPackage,
  topic_delivery_pack: topicDeliveryPack,
  hard_lane: {
    event_identity: "yanzi-envoy-to-chu",
    selected_angle: topicPackage.selected_angle,
    scope_label: topicPackage.scope_label,
    core_conflict: topicPackage.core_conflict,
    stakes: topicPackage.stakes,
    must_include_beats: topicPackage.must_include_beats,
    forbidden_expansions: topicPackage.forbidden_expansions,
    source_anchor_refs: topicPackage.source_anchor_refs,
    canonical_quotes: topicPackage.canonical_quotes,
    ambiguity_notes: topicPackage.ambiguity_notes,
    duration_band: topicPackage.duration_band,
  },
  soft_lane: {
    narrative_tension_map: topicPackage.narrative_tension_map,
    strong_scene: topicPackage.strong_scene,
    voice_hint: "冷静压迫型旁白 / sharper",
  },
  packaging_lane: {
    hook_claim: topicDeliveryPack.hook_claim,
    hook_emotion: topicDeliveryPack.hook_emotion,
    reveal_position: topicDeliveryPack.reveal_position,
    title_profile: "conflict_first",
    cover_profile: "faces_closeup",
    risk_posture: "controlled",
  },
});

describe("script local validator", () => {
  it("returns pass for a structurally valid draft and stays serializable", async () => {
    const draft = await generateScriptDraft({
      bundle: scriptInputBundle,
    });

    const result = validateScriptDraft({
      bundle: scriptInputBundle,
      draft,
    });

    expect(result.decision).toBe("pass");

    const persisted = JSON.parse(JSON.stringify(result));
    expect(() => ScriptValidationResult.parse(persisted)).not.toThrow();
  });

  it("uses the nearest duration boundary instead of the center point", async () => {
    const draft = await generateScriptDraft({
      bundle: scriptInputBundle,
    });

    const upperBoundaryResult = validateScriptDraft({
      bundle: scriptInputBundle,
      draft: {
        ...draft,
        estimated_duration_sec: 95,
      },
    });

    expect(upperBoundaryResult.decision).toBe("pass");
    expect(upperBoundaryResult.errors).not.toContain("duration_extreme");
    expect(upperBoundaryResult.errors).not.toContain("duration_severe");
    expect(upperBoundaryResult.warnings).not.toContain("duration_mild_drift");

    const severeDriftResult = validateScriptDraft({
      bundle: scriptInputBundle,
      draft: {
        ...draft,
        estimated_duration_sec: 120,
      },
    });

    expect(severeDriftResult.decision).toBe("regen_once");
    expect(severeDriftResult.errors).toContain("duration_severe");
    expect(severeDriftResult.errors).not.toContain("duration_extreme");
  });

  it("returns regen_once for recoverable structural issues", async () => {
    const draft = await generateScriptDraft({
      bundle: scriptInputBundle,
    });

    const result = validateScriptDraft({
      bundle: scriptInputBundle,
      draft: {
        ...draft,
        opening_span: "",
      },
    });

    expect(result.decision).toBe("regen_once");
    expect(result.errors).toContain("opening_missing");
  });

  it("returns regen_once when a medium draft is too thin to be an oral script", async () => {
    const draft = await generateScriptDraft({
      bundle: scriptInputBundle,
    });
    const thinScript =
      "楚王接连羞辱晏子，晏子没有退让。他先借入门规制反击，又在橘淮之辩中顶回楚王。整件事说明外交场面不能软，一退就会丢掉齐国体面。";

    const result = validateScriptDraft({
      bundle: scriptInputBundle,
      draft: {
        ...draft,
        script_text: thinScript,
        estimated_duration_sec: 85,
        opening_span: "楚王接连羞辱晏子，晏子没有退让。",
        ending_span: "一退就会丢掉齐国体面。",
        beat_trace: [
          {
            beat: "入楚受辱",
            excerpt: "楚王接连羞辱晏子，晏子没有退让。",
            confidence: 0.9,
          },
          {
            beat: "橘淮之辩",
            excerpt: "又在橘淮之辩中顶回楚王。",
            confidence: 0.9,
          },
        ],
      },
    });

    expect(result.decision).toBe("regen_once");
    expect(result.errors).toContain("script_body_too_thin");
    expect(result.metrics).toMatchObject({
      script_char_count: thinScript.length,
      min_script_chars_for_band: 240,
      min_sentence_count_for_band: 7,
    });
  });

  it("keeps structurally complete drafts with reasonable body volume passing", async () => {
    const draft = await generateScriptDraft({
      bundle: scriptInputBundle,
    });
    const body = [
      "楚王把门开在侧边，意思很明白：你晏子个子矮，就从这里进去。",
      "晏子没有急，也没有退，他站在门前先把规矩抬出来。",
      "他说，出使狗国的人，才从狗门入；现在他来的是楚国，就该走楚国使臣该走的门。",
      "第一下羞辱被顶回去，楚王没有收手，又把话压到齐国头上。",
      "晏子顺势把压力接住，让这场争脸面的话，变成两国礼法的较量。",
      "到橘淮之辩时，楚王想借盗贼羞辱齐人，晏子反把问题推回楚地。",
      "橘生淮南为橘，生于淮北为枳；人到楚国才变坏，难道不是楚国水土的问题？",
      "这不是逞口舌，是在所有人面前守住齐国的场面。",
      "所以这一退，退掉的就不只是晏子自己，而是齐国被人按下去的资格。",
    ].join("");

    const result = validateScriptDraft({
      bundle: scriptInputBundle,
      draft: {
        ...draft,
        script_text: body,
        estimated_duration_sec: 85,
        opening_span: "楚王把门开在侧边，意思很明白：你晏子个子矮，就从这里进去。",
        ending_span: "所以这一退，退掉的就不只是晏子自己，而是齐国被人按下去的资格。",
        beat_trace: [
          {
            beat: "入楚受辱",
            excerpt: "楚王把门开在侧边，意思很明白：你晏子个子矮，就从这里进去。",
            confidence: 0.9,
          },
          {
            beat: "橘淮之辩",
            excerpt: "到橘淮之辩时，楚王想借盗贼羞辱齐人，晏子反把问题推回楚地。",
            confidence: 0.9,
          },
        ],
      },
    });

    expect(result.decision).toBe("pass");
    expect(result.errors).not.toContain("script_body_too_thin");
    expect(result.metrics).toMatchObject({
      script_char_count: body.length,
      min_script_chars_for_band: 240,
      min_sentence_count_for_band: 7,
    });
  });

  it("returns hard_fail for unrecoverable bundle or draft issues", async () => {
    const draft = await generateScriptDraft({
      bundle: scriptInputBundle,
    });

    const result = validateScriptDraft({
      bundle: {
        ...scriptInputBundle,
        hard_lane: {
          ...scriptInputBundle.hard_lane,
          forbidden_expansions: ["不要扩写到未定 downstream 阶段"],
        },
      },
      draft: ScriptDraftPackage.parse({
        ...draft,
        script_text: `${draft.script_text}\n不要扩写到未定 downstream 阶段`,
      }),
    });

    expect(result.decision).toBe("hard_fail");
    expect(result.errors).toContain("forbidden_expansion_hit");
  });
});
