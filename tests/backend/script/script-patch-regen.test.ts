import { describe, expect, it, vi } from "vitest";

import {
  ScriptDraftPackage,
  ScriptInputBundle,
  TopicDeliveryPack,
  TopicPackage,
} from "../../../shared/src/index.js";
import { patchScriptDraft } from "../../../backend/src/modules/script/script-patch.service.js";
import { regenerateScriptDraft } from "../../../backend/src/modules/script/script-regenerate.service.js";

const topicPackage = TopicPackage.parse({
  topic_id: "topic_yanzi_shichu",
  title: "晏子使楚",
  selected_angle: "楚王不是只压了晏子一次，而是连压三次。",
  family_label: "外交压场型",
  scope_label: "完整事件",
  core_conflict: "楚王借公开场合连续羞辱晏子与齐国，晏子必须当场顶回去。",
  stakes: "一旦退让，丢掉的不只是晏子个人体面，而是齐国在楚廷上的国格。",
  strong_scene: "楚王连续压场，晏子一句句顶回去。",
  packaging_seed: "楚王连压三次，晏子一次没退。",
  must_include_beats: ["入楚受辱", "橘枳之喻"],
  forbidden_expansions: ["不要扩写到未定 downstream 阶段"],
  risk_hints: ["不要把内容写成课堂导入"],
  source_anchor_refs: ["《晏子春秋》"],
  canonical_quotes: ["橘生淮南则为橘"],
  ambiguity_notes: [],
  duration_band: "medium",
  narrative_tension_map: {
    hook_claim: "楚王不是只压了晏子一次，而是连压三次",
    pressure_escalation: "从羞辱身形升级到羞辱齐国，再升级到羞辱齐人风气",
    mid_reveal: "晏子不是在逞口舌，而是在守住齐国场面",
    peak_payoff: "橘枳之喻把第三次压场原样顶回",
    ending_residue: "这种场面，一退就不只是退掉自己",
  },
});

const topicDeliveryPack = TopicDeliveryPack.parse({
  opening_move: "question",
  opening_pressure_level: "high",
  voice_tilt: "sharper",
  pacing_tilt: "fast",
  ending_tilt: "judgment",
  visual_tilt: ["faces", "courtroom"],
  hook_claim: "楚王不是只压了晏子一次，而是连压三次，你敢当场顶回去吗？",
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
    event_identity: "晏子使楚",
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

const weakDraft = ScriptDraftPackage.parse({
  script_text:
    "楚王第一轮压场时，晏子已经看出这不是一句话的冲突。入楚受辱只是开始，真正的狠处在于后面还会层层加码。到橘枳之喻落下来时，场面才真正翻了过去。",
  estimated_duration_sec: 84,
  beat_trace: [
    {
      beat: "入楚受辱",
      excerpt: "入楚受辱只是开始",
      confidence: 0.94,
    },
    {
      beat: "橘枳之喻",
      excerpt: "到橘枳之喻落下来时",
      confidence: 0.95,
    },
  ],
  quote_trace: [],
  opening_span: "楚王第一轮压场时，晏子已经看出这不是一句话的冲突。",
  ending_span: "场面翻了过去。",
});

const regeneratedDraft = ScriptDraftPackage.parse({
  script_text:
    "如果有人当着所有人的面连压你三次，你敢不敢当场顶回去？晏子敢。入楚受辱只是第一层，真正危险的是楚王一步步把羞辱从个人推进到齐国，再推进到齐人风气。可晏子没有退，到橘枳之喻落下来的那一刻，他把第三次压场原样顶了回去。这种场面，一退掉的就不只是自己，而是整个使节背后的国面。",
  estimated_duration_sec: 88,
  beat_trace: [
    {
      beat: "入楚受辱",
      excerpt: "入楚受辱只是第一层",
      confidence: 0.96,
    },
    {
      beat: "橘枳之喻",
      excerpt: "到橘枳之喻落下来的那一刻",
      confidence: 0.97,
    },
  ],
  quote_trace: [],
  opening_span: "如果有人当着所有人的面连压你三次，你敢不敢当场顶回去？",
  ending_span: "这种场面，一退掉的就不只是自己，而是整个使节背后的国面。",
});

describe("script patch / regenerate services", () => {
  it("allows patch_once only once and patch_intent=lift keeps topic contract fields unchanged", async () => {
    const originalBeats = [...scriptInputBundle.hard_lane.must_include_beats];
    const originalScope = scriptInputBundle.hard_lane.scope_label;
    const originalMap = structuredClone(
      scriptInputBundle.soft_lane.narrative_tension_map,
    );

    const patched = await patchScriptDraft({
      bundle: scriptInputBundle,
      draft: weakDraft,
      semanticReview: {
        stage: "script_semantic_review",
        decision: "patch_once",
        patch_intent: "lift",
        hard_issues: [],
        soft_issues: ["hook_kill_power_weak", "ending_residue_weak"],
        patch_targets: ["opening", "ending"],
        summary: "开头和结尾需要提势能，但不应改 topic 合同。",
        confidence: 0.82,
      },
      patchUsed: false,
    });

    expect(() => ScriptDraftPackage.parse(patched)).not.toThrow();
    expect(patched.opening_span).toContain("所有人");
    expect(patched.ending_span.length).toBeGreaterThan(weakDraft.ending_span.length);
    expect(patched.script_text).toContain("入楚受辱");
    expect(patched.script_text).toContain("橘枳之喻");
    expect(scriptInputBundle.hard_lane.must_include_beats).toEqual(originalBeats);
    expect(scriptInputBundle.hard_lane.scope_label).toBe(originalScope);
    expect(scriptInputBundle.soft_lane.narrative_tension_map).toEqual(originalMap);

    await expect(
      patchScriptDraft({
        bundle: scriptInputBundle,
        draft: patched,
        semanticReview: {
          stage: "script_semantic_review",
          decision: "patch_once",
          patch_intent: "lift",
          hard_issues: [],
          soft_issues: ["hook_kill_power_weak"],
          patch_targets: ["opening"],
          summary: "不允许第二次 patch。",
          confidence: 0.8,
        },
        patchUsed: true,
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining("patch_once"),
    });
  });

  it("allows regen_once only once and reuses the formal generator callback", async () => {
    const generateDraft = vi
      .fn<() => Promise<typeof regeneratedDraft>>()
      .mockResolvedValue(regeneratedDraft);

    const regenerated = await regenerateScriptDraft({
      bundle: scriptInputBundle,
      regenerateUsed: false,
      localValidation: {
        decision: "regen_once",
        errors: ["script_body_too_thin"],
        metrics: {
          script_char_count: 67,
          script_sentence_count: 3,
          min_script_chars_for_band: 240,
          min_sentence_count_for_band: 7,
        },
      },
      generateDraft,
    });

    expect(generateDraft).toHaveBeenCalledTimes(1);
    expect(generateDraft).toHaveBeenCalledWith({
      regenerationContext: {
        reason: "local_validation_regen_once",
        errors: ["script_body_too_thin"],
        metrics: {
          script_char_count: 67,
          script_sentence_count: 3,
          min_script_chars_for_band: 240,
          min_sentence_count_for_band: 7,
        },
      },
    });
    expect(() => ScriptDraftPackage.parse(regenerated)).not.toThrow();
    expect(regenerated.script_text).toContain("所有人");

    await expect(
      regenerateScriptDraft({
        bundle: scriptInputBundle,
        regenerateUsed: true,
        generateDraft,
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining("regen_once"),
    });
  });
});
