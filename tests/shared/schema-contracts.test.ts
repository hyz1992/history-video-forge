import { describe, expect, it } from "vitest";

import {
  ScriptDraftPackage,
  ScriptInputBundle,
  ScriptValidationResult,
  TopicCandidateCard,
  TopicDeliveryPack,
  TopicPackage,
} from "../../shared/src/index.js";

describe("shared schema contracts", () => {
  it("parses the topic and script shared contracts", () => {
    const candidate = TopicCandidateCard.parse({
      event_identity: "晏子使楚",
      title: "晏子使楚",
      one_line_angle: "楚王不是只压了晏子一次，而是连压三次。",
      family_label: "君臣博弈",
      scope_label: "单事件",
      estimated_duration_band: "medium",
      why_this_now: "近期未出现同 event_id，且有强冲突与强场面。",
      core_conflict: "楚王当众压场，晏子必须当场顶回。",
      strong_scene: "楚王连续压场，晏子一句句顶回去。",
      must_cover_preview: ["入楚受辱", "橘枳之喻"],
      risk_hints: ["避免写成课堂导入"],
      source_hint: "《晏子春秋》",
      recent_usage_hint: "近期未出现同 event_id",
      viral_rubric: {
        hook_power: "high",
        novelty_gap: "medium",
        emotion_gap: "high",
        share_impulse: "high",
        visual_promise: "high",
      },
    });

    const topicPackage = TopicPackage.parse({
      topic_id: "topic-yanzi-shichu",
      title: "晏子使楚",
      selected_angle: "楚王不是只压了晏子一次，而是连压三次。",
      family_label: "君臣博弈",
      scope_label: "单事件",
      core_conflict: "楚王当众压场，晏子必须当场顶回。",
      strong_scene: "楚王连续压场，晏子一句句顶回去。",
      packaging_seed: "楚王连压三次，晏子一次没退。",
      must_include_beats: ["入楚受辱", "橘枳之喻"],
      forbidden_expansions: ["延展到后续分镜"],
      risk_hints: ["避免课堂导入"],
      canonical_quotes: ["橘生淮南则为橘"],
      duration_band: "medium",
      narrative_tension_map: {
        hook_claim: "楚王不是只压了晏子一次，而是连压三次。",
        pressure_escalation: "从羞辱身形升级到羞辱齐国与齐人风气。",
        mid_reveal: "晏子守住的不是口舌，而是齐国场面。",
        peak_payoff: "橘枳之喻把第三次压场原样顶回。",
        ending_residue: "这种场面，一退就不只是退掉自己。",
      },
    });

    const deliveryPack = TopicDeliveryPack.parse({
      opening_move: "question",
      opening_pressure_level: "high",
      voice_tilt: "sharper",
      pacing_tilt: "neutral",
      ending_tilt: "judgment",
      visual_tilt: ["faces", "courtroom"],
      hook_claim: "如果有人当着所有人的面羞辱你，你敢不敢当场顶回去？",
      hook_emotion: "压迫",
      reveal_position: "mid",
      caution_notes: [
        "不要把 hook 写成课堂导入",
        "不要让包装 promise 偏离 narrative_tension_map.hook_claim",
      ],
    });

    const bundle = ScriptInputBundle.parse({
      topic_package: topicPackage,
      topic_delivery_pack: deliveryPack,
      hard_lane: {
        event_identity: "晏子使楚",
        selected_angle: "楚王不是只压了晏子一次，而是连压三次。",
        scope_label: "单事件",
        must_include_beats: ["入楚受辱", "橘枳之喻"],
        forbidden_expansions: ["延展到后续分镜"],
        duration_band: "medium",
      },
      soft_lane: {
        narrative_tension_map: topicPackage.narrative_tension_map,
        strong_scene: topicPackage.strong_scene,
        voice_hint: "克制但不退",
      },
      packaging_lane: {
        hook_claim: deliveryPack.hook_claim,
        hook_emotion: deliveryPack.hook_emotion,
        reveal_position: deliveryPack.reveal_position,
        title_profile: "conflict-first",
        cover_profile: "faces-closeup",
        risk_posture: "controlled",
      },
    });

    const draftPackage = ScriptDraftPackage.parse({
      script_text: "楚王第一次压场时，晏子没有退。",
      estimated_duration_sec: 95,
      beat_trace: [
        {
          beat: "入楚受辱",
          excerpt: "楚王第一次压场时，晏子没有退。",
          confidence: 0.92,
        },
      ],
      quote_trace: [
        {
          quote: "橘生淮南则为橘",
          usage_type: "exact",
          excerpt: "橘生淮南则为橘",
        },
      ],
      opening_span: "如果有人当着所有人的面羞辱你，你敢不敢当场顶回去？",
      ending_span: "这种场面，一退就不只是退掉自己。",
    });

    const localValidation = ScriptValidationResult.parse({
      stage: "script_local_validation",
      decision: "pass",
      errors: [],
      warnings: ["duration_slightly_out_of_band"],
      metrics: {
        estimated_duration_sec: 95,
      },
    });

    const semanticReview = ScriptValidationResult.parse({
      stage: "script_semantic_review",
      decision: "patch_once",
      patch_intent: "lift",
      hard_issues: [],
      soft_issues: ["hook_kill_power_weak"],
      patch_targets: ["opening"],
      summary: "开头停留力偏弱，但可定点提升。",
      confidence: 0.84,
    });

    expect(candidate.viral_rubric.hook_power).toBe("high");
    expect(topicPackage.narrative_tension_map.hook_claim).toContain("连压三次");
    expect(deliveryPack.reveal_position).toBe("mid");
    expect(bundle.packaging_lane.hook_claim).toBe(deliveryPack.hook_claim);
    expect(draftPackage.beat_trace).toHaveLength(1);
    expect(localValidation.stage).toBe("script_local_validation");
    expect(semanticReview.patch_intent).toBe("lift");
  });

  it("restricts viral rubric and reveal position enum values", () => {
    expect(() =>
      TopicCandidateCard.parse({
        event_identity: "test",
        title: "test",
        one_line_angle: "angle",
        family_label: "family",
        scope_label: "scope",
        estimated_duration_band: "medium",
        why_this_now: "now",
        core_conflict: "conflict",
        strong_scene: "scene",
        must_cover_preview: [],
        risk_hints: [],
        source_hint: "source",
        recent_usage_hint: "recent",
        viral_rubric: {
          hook_power: "extreme",
          novelty_gap: "medium",
          emotion_gap: "high",
          share_impulse: "high",
          visual_promise: "high",
        },
      }),
    ).toThrow();

    expect(() =>
      TopicDeliveryPack.parse({
        opening_move: "question",
        opening_pressure_level: "high",
        voice_tilt: "sharper",
        pacing_tilt: "neutral",
        ending_tilt: "judgment",
        visual_tilt: ["faces"],
        hook_claim: "claim",
        hook_emotion: "压迫",
        reveal_position: "finale",
        caution_notes: [],
      }),
    ).toThrow();
  });

  it("models ScriptValidationResult as a discriminated union", () => {
    expect(() =>
      ScriptValidationResult.parse({
        stage: "script_local_validation",
        decision: "pass",
        patch_intent: "lift",
        errors: [],
        warnings: [],
        metrics: {},
      }),
    ).toThrow();

    expect(() =>
      ScriptValidationResult.parse({
        stage: "script_semantic_review",
        decision: "pass",
        hard_issues: [],
        soft_issues: [],
        patch_targets: [],
        summary: "ok",
        confidence: 0.9,
      }),
    ).toThrow();
  });
});
