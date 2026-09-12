import { describe, expect, it, vi } from "vitest";

import {
  ScriptDraftPackage,
  ScriptInputBundle,
  TopicDeliveryPack,
  TopicPackage,
} from "../../../shared/src/index.js";
import type {
  InvokeStructuredPromptOptions,
  LlmGateway,
} from "../../../backend/src/runtime/llm/llm-gateway.js";
import { LlmOutputError } from "../../../backend/src/runtime/llm/llm-output-error.js";
import {
  estimateNarrationDurationSec,
  generateScriptDraft,
} from "../../../backend/src/modules/script/script-generation.service.js";

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

describe("generateScriptDraft", () => {
  it("wraps ZodError from ScriptDraftPackage.parse into LlmOutputError with script_draft_schema_invalid", async () => {
    // LLM 返回缺少 script_text 的结构——normalizeScriptDraft 不会补 script_text，
    // ScriptDraftPackage.parse 必报错，应被包装成 LlmOutputError 而非裸 ZodError。
    const gateway: LlmGateway = {
      async invokeStructuredPrompt<T>(
        _options: InvokeStructuredPromptOptions,
      ): Promise<T> {
        return {
          estimated_duration_sec: 88,
          beat_trace: [],
          quote_trace: [],
          opening_span: "x",
          ending_span: "y",
        } as T;
      },
      invokeStrictStructured: vi.fn(),
    };

    await expect(
      generateScriptDraft({ bundle: scriptInputBundle, llmGateway: gateway }),
    ).rejects.toMatchObject({
      code: "script_draft_schema_invalid",
    });

    try {
      await generateScriptDraft({
        bundle: scriptInputBundle,
        llmGateway: gateway,
      });
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(LlmOutputError);
      expect((error as LlmOutputError).code).toBe(
        "script_draft_schema_invalid",
      );
      expect(Array.isArray((error as LlmOutputError).cause)).toBe(true);
    }
  });

  it("returns a parsed ScriptDraftPackage on the deterministic stub success path", async () => {
    const draft = await generateScriptDraft({ bundle: scriptInputBundle });
    expect(() => ScriptDraftPackage.parse(draft)).not.toThrow();
  });

  it("backfills estimated_duration_sec locally from script text on the stub success path", async () => {
    const draft = await generateScriptDraft({ bundle: scriptInputBundle });
    expect(draft.estimated_duration_sec).toBe(
      estimateNarrationDurationSec(draft.script_text),
    );
    expect(draft.estimated_duration_sec).toBeGreaterThan(0);
  });

  it("overrides an LLM-provided estimated_duration_sec with the local backfill", async () => {
    const stubDraft = await generateScriptDraft({ bundle: scriptInputBundle });
    const gateway: LlmGateway = {
      async invokeStructuredPrompt<T>(
        _options: InvokeStructuredPromptOptions,
      ): Promise<T> {
        return { ...stubDraft, estimated_duration_sec: 999 } as T;
      },
      invokeStrictStructured: vi.fn(),
    };

    const draft = await generateScriptDraft({
      bundle: scriptInputBundle,
      llmGateway: gateway,
    });

    expect(draft.estimated_duration_sec).toBe(
      estimateNarrationDurationSec(draft.script_text),
    );
    expect(draft.estimated_duration_sec).not.toBe(999);
  });
});

describe("estimateNarrationDurationSec", () => {
  it("rounds the 698-char measured sample to 132 seconds", () => {
    const text = "楚".repeat(698);
    expect(text.replace(/\s/g, "").length).toBe(698);
    expect(estimateNarrationDurationSec(text)).toBe(132);
  });

  it("strips whitespace before counting", () => {
    const text = "楚王把羞辱压到晏子面前。\n 晏子当场接住压力。\n";
    const stripped = text.replace(/\s/g, "").length;
    expect(estimateNarrationDurationSec(text)).toBe(
      Math.max(1, Math.round(stripped / 5.3)),
    );
  });

  it("returns 0 for empty text and at least 1 second for non-empty text", () => {
    expect(estimateNarrationDurationSec("")).toBe(0);
    expect(estimateNarrationDurationSec(null)).toBe(0);
    expect(estimateNarrationDurationSec(undefined)).toBe(0);
    expect(estimateNarrationDurationSec("楚")).toBe(1);
  });
});
