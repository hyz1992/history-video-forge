import { describe, expect, it } from "vitest";

import {
  ScriptInputBundle,
  TopicDeliveryPack,
  TopicPackage,
} from "../../../shared/src/index.js";
import { buildScriptInputBundle } from "../../../backend/src/modules/script/script-input-bundle.builder.js";
import { planTopicDelivery } from "../../../backend/src/modules/script/topic-delivery-planner.js";

const topicPackage = TopicPackage.parse({
  topic_id: "topic_yanzi_shichu",
  title: "晏子使楚",
  selected_angle: "楚王不是只压了晏子一次，而是连压三次。",
  family_label: "外交压场型",
  scope_label: "完整事件",
  core_conflict: "楚王借公开场合连续羞辱晏子与齐国，晏子必须当场顶回去。",
  stakes: "一旦退让，就不只是晏子个人失场，而是齐国当场被楚国压住。",
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

const projectStylePack = {
  narrator_persona: "冷静压迫型旁白",
  wording_register: "sharp_oral",
  subtitle_profile: "dense_short_lines",
  cover_profile: "faces_closeup",
  title_profile: "conflict_first",
  pacing_baseline: "tight",
  risk_posture: "controlled",
};

const familyBiasPack = {
  family_label: "外交压场型",
  opening_pressure_bias: "high",
  exposition_budget: "low",
  pacing_bias: "fast",
  voice_bias: "sharper",
  anti_patterns: ["不要先讲背景百科"],
};

describe("script input bundle", () => {
  it("accepts and preserves story completeness fields on TopicPackage", () => {
    const parsed = TopicPackage.parse({
      ...topicPackage,
      canonical_quotes: [],
    });

    expect(parsed.stakes).toBe(topicPackage.stakes);
    expect(parsed.source_anchor_refs).toEqual(topicPackage.source_anchor_refs);
    expect(parsed.ambiguity_notes).toEqual(topicPackage.ambiguity_notes);
    expect(parsed.canonical_quotes).toEqual([]);
  });

  it("plans TopicDeliveryPack from TopicPackage plus style and family bias", () => {
    const deliveryPack = planTopicDelivery({
      topicPackage,
      projectStylePack,
      familyBiasPack,
    });

    expect(() => TopicDeliveryPack.parse(deliveryPack)).not.toThrow();
    expect(deliveryPack).toMatchObject({
      hook_claim: expect.any(String),
      hook_emotion: expect.any(String),
      reveal_position: expect.any(String),
    });
    expect(deliveryPack.hook_claim).toContain(
      topicPackage.narrative_tension_map.hook_claim,
    );
  });

  it("builds ScriptInputBundle with hard, soft, and packaging lanes", () => {
    const deliveryPack = planTopicDelivery({
      topicPackage,
      projectStylePack,
      familyBiasPack,
    });

    const bundle = buildScriptInputBundle({
      topicPackage,
      eventIdentity: "evt_yanzi_shichu",
      topicDeliveryPack: deliveryPack,
      projectStylePack,
      familyBiasPack,
    });

    expect(() => ScriptInputBundle.parse(bundle)).not.toThrow();
    expect(bundle.hard_lane).toBeDefined();
    expect(bundle.soft_lane).toBeDefined();
    expect(bundle.packaging_lane).toBeDefined();
    expect(bundle.hard_lane).toMatchObject({
      event_identity: "evt_yanzi_shichu",
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
    });
    expect(bundle.hard_lane.event_identity).not.toBe(topicPackage.title);
    expect(bundle.packaging_lane).toMatchObject({
      hook_claim: expect.any(String),
      hook_emotion: expect.any(String),
      reveal_position: expect.any(String),
      title_profile: "conflict_first",
      cover_profile: "faces_closeup",
      risk_posture: "controlled",
    });
    expect(bundle.packaging_lane.hook_claim).toContain(
      topicPackage.narrative_tension_map.hook_claim,
    );
  });
});
