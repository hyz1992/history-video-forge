import { describe, expect, it } from "vitest";

import {
  ScriptDraftPackage,
  ScriptInputBundle,
  TopicDeliveryPack,
  TopicPackage,
} from "../../../shared/src/index.js";
import { generateScriptDraft } from "../../../backend/src/modules/script/script-generation.service.js";

const topicPackage = TopicPackage.parse({
  topic_id: "topic_yanzi_shichu",
  title: "晏子使楚",
  selected_angle: "楚王不是只压了晏子一次，而是连压三次。",
  family_label: "外交压场型",
  scope_label: "完整事件",
  core_conflict: "楚王借公开场合连续羞辱晏子与齐国，晏子必须当场顶回去。",
  strong_scene: "楚王连续压场，晏子一句句顶回去。",
  packaging_seed: "楚王连压三次，晏子一次没退。",
  must_include_beats: ["入楚受辱", "橘枳之喻"],
  forbidden_expansions: ["不要扩写到未定 downstream 阶段"],
  risk_hints: ["不要把内容写成课堂导入"],
  canonical_quotes: ["橘生淮南则为橘"],
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
    must_include_beats: topicPackage.must_include_beats,
    forbidden_expansions: topicPackage.forbidden_expansions,
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

describe("script generation service", () => {
  it("returns a ScriptDraftPackage with required sidecars", async () => {
    const draft = await generateScriptDraft({
      bundle: scriptInputBundle,
    });

    expect(() => ScriptDraftPackage.parse(draft)).not.toThrow();
    expect(draft.script_text).toContain("楚王");
    expect(draft.beat_trace.length).toBeGreaterThan(0);
    expect(draft.quote_trace).toBeDefined();
    expect(draft.opening_span.length).toBeGreaterThan(0);
    expect(draft.ending_span.length).toBeGreaterThan(0);
  });
});
