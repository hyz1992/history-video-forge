import { TopicCandidateCard } from "../../../../shared/src/index";
import type {
  TopicRecommendationFilter,
  TopicRecommendationFilterInput,
} from "../../../../shared/src/topic/topic-recommendation-filter.schema";

import {
  classifyEventFamily,
  type TopicFamily,
} from "./event-family.classifier";

type RubricLevel = "low" | "medium" | "high";

export interface CandidateRubric {
  hook_power: RubricLevel;
  novelty_gap: RubricLevel;
  emotion_gap: RubricLevel;
  share_impulse: RubricLevel;
  visual_promise: RubricLevel;
}

export interface BuildTopicCandidatesInput {
  canonicalName: string;
  summary: string;
  coreConflict: string;
  strongScene: string;
  sourceHint: string;
  recentUsageHint: string;
  canonicalQuotes?: string[];
  canonicalQuoteIntents?: Array<{ quote: string; intent: string }>;
  tags?: string[];
  familyHint?: string;
  slotRubricOverrides?: CandidateRubric[];
  filters?: TopicRecommendationFilterInput;
  topic_filter?: TopicRecommendationFilter;
  topic_filter_fingerprint?: string;
  /**
   * builder 原始候选池目标数量。
   * 由 recommendTopicCandidatesWithTrace 注入；缺省时回退 TOPIC_RAW_CANDIDATE_POOL_TARGET_COUNT。
   * 该字段会被透传到 candidate-builder prompt 的 input（target_candidate_count），
   * 也会被 graph runtime 用于切片与 slotsInsufficient 判定。
   */
  target_candidate_count?: number;
  /**
   * selector 后最终候选数量。
   * 由 recommendTopicCandidatesWithTrace 注入；缺省时回退 TOPIC_CANDIDATE_TARGET_COUNT。
   * 用于 graph 内部持久化切片（L455/L507），保证 cache 写入数量与最终返回数量一致。
   */
  final_candidate_count?: number;
  /**
   * 用户选定的切入角度（来自事件库入口）。
   * 由 from-library controller 注入；recommended / custom 入口不传。
   * 透传到 candidate-builder prompt 后，builder 必须围绕此角度的不同侧面生成候选，
   * 不得偏离到其他人物视角或无关事件（详见 candidate-builder.prompt.md 的 angle_hint 约束）。
   */
  angle_hint?: {
    /** 角度描述，对应 EventLibraryAngle.angleLabel */
    label: string;
    /** 角度家族标签，对应 EventLibraryAngle.familyLabel */
    family: string;
  };
}

interface FamilySlot {
  key: string;
  angle: (input: BuildTopicCandidatesInput) => string;
}

const FAMILY_SLOTS: Record<TopicFamily, FamilySlot[]> = {
  "外交压场型": [
    {
      key: "triple-pressure",
      angle: (input) =>
        `${input.canonicalName}不是只被压了一次，而是被当场连压到底。`,
    },
    {
      key: "identity-guard",
      angle: (input) =>
        `${input.canonicalName}顶回去的不是一句嘴，而是当场守住了身份场面。`,
    },
    {
      key: "public-counter",
      angle: (input) =>
        `${input.canonicalName}最狠的地方，不是会说，而是敢在所有人面前原样顶回去。`,
    },
  ],
  "战场翻盘型": [
    {
      key: "turning-point",
      angle: (input) =>
        `${input.canonicalName}真正的翻盘，不在最后一击，而在局势开始倒转的那一刻。`,
    },
    {
      key: "pressure-crack",
      angle: (input) =>
        `${input.canonicalName}看似已经被压死，真正致命的是对方先露出了裂口。`,
    },
    {
      key: "single-move",
      angle: (input) =>
        `${input.canonicalName}之所以能翻盘，不是运气，而是关键一步踩中了全场命门。`,
    },
  ],
  "刺杀政变型": [
    {
      key: "knife-before-court",
      angle: (input) =>
        `${input.canonicalName}最紧的不是动手一刻，而是所有人都不知道刀已经进场。`,
    },
    {
      key: "single-bet",
      angle: (input) =>
        `${input.canonicalName}从来不是普通行刺，而是一场押上全部退路的单次下注。`,
    },
    {
      key: "hall-silence",
      angle: (input) =>
        `${input.canonicalName}真正压人的，不是刀落下去，而是那一瞬间全场的失声。`,
    },
  ],
  "权谋决断型": [
    {
      key: "decision-cost",
      angle: (input) =>
        `${input.canonicalName}最难的不是看清局势，而是明知道代价也必须立刻决断。`,
    },
    {
      key: "no-middle-ground",
      angle: (input) =>
        `${input.canonicalName}这一步一旦拖，就不再有中间地带。`,
    },
    {
      key: "table-flip",
      angle: (input) =>
        `${input.canonicalName}真正见高下的，不是谁话多，而是谁敢先把桌面掀开。`,
    },
  ],
  "变法治术型": [
    {
      key: "new-order",
      angle: (input) =>
        `${input.canonicalName}最刺人的地方，不是新法本身，而是它先砍向最舒服的旧秩序。`,
    },
    {
      key: "resistance-wave",
      angle: (input) =>
        `${input.canonicalName}每往前推一步，真正扑上来的都不是意见，而是既得利益。`,
    },
    {
      key: "cold-execution",
      angle: (input) =>
        `${input.canonicalName}最狠的不是道理，而是把道理一条条执行到底。`,
    },
  ],
  "君臣博弈型": [
    {
      key: "court-pressure",
      angle: (input) =>
        `${input.canonicalName}最危险的不是君臣意见不同，而是谁先把场面逼到必须站队。`,
    },
    {
      key: "silent-counter",
      angle: (input) =>
        `${input.canonicalName}表面是在回话，实则是在当场夺回话语权。`,
    },
    {
      key: "relationship-edge",
      angle: (input) =>
        `${input.canonicalName}真正的博弈从来不在私下，而在众目睽睽时那一下试探。`,
    },
  ],
  "忠义抉择型": [
    {
      key: "cost-before-name",
      angle: (input) =>
        `${input.canonicalName}真正难的不是讲忠义，而是明知道代价还要把名字押上去。`,
    },
    {
      key: "one-way-choice",
      angle: (input) =>
        `${input.canonicalName}这不是情绪上头，而是选了就再也回不了头。`,
    },
    {
      key: "sacrifice-weight",
      angle: (input) =>
        `${input.canonicalName}最重的一刻，不是牺牲发生时，而是他决定接受那一刻。`,
    },
  ],
  "通用安全槽位": [
    {
      key: "core-conflict",
      angle: (input) =>
        `${input.canonicalName}真正能抓人的，不是事件全貌，而是${input.coreConflict}`,
    },
    {
      key: "scene-focus",
      angle: (input) =>
        `${input.canonicalName}最值得讲的，不是背景铺陈，而是${input.strongScene}`,
    },
    {
      key: "single-scene",
      angle: (input) =>
        `${input.canonicalName}一旦把场面收紧到这一下，整件事的味道就出来了。`,
    },
  ],
};

function deriveRubric(
  input: BuildTopicCandidatesInput,
  slotIndex: number,
): CandidateRubric {
  const tags = new Set(input.tags ?? []);
  const hookPower: RubricLevel =
    tags.has("humiliation") || tags.has("showdown")
      ? "high"
      : tags.has("archive")
        ? "low"
        : "medium";
  const visualPromise: RubricLevel =
    tags.has("court") || tags.has("battle")
      ? "high"
      : tags.has("archive")
        ? "low"
        : "medium";

  const base: CandidateRubric = {
    hook_power: hookPower,
    novelty_gap: slotIndex === 0 ? "high" : "medium",
    emotion_gap:
      tags.has("humiliation") || tags.has("betrayal") ? "high" : "medium",
    share_impulse: hookPower === "high" ? "high" : "medium",
    visual_promise: visualPromise,
  };

  return input.slotRubricOverrides?.[slotIndex] ?? base;
}

function shouldKeepCandidate(rubric: CandidateRubric): boolean {
  const values = Object.values(rubric);
  const lowCount = values.filter((value) => value === "low").length;

  if (
    rubric.hook_power === "low" &&
    rubric.visual_promise === "low"
  ) {
    return false;
  }

  if (lowCount >= 4) {
    return false;
  }

  if (
    rubric.novelty_gap === "low" &&
    rubric.emotion_gap === "low" &&
    rubric.share_impulse === "low"
  ) {
    return false;
  }

  return true;
}

function compactUnique(values: Array<string | undefined>): string[] {
  return Array.from(
    new Set(values.map((value) => value?.trim()).filter(Boolean) as string[]),
  );
}

export function buildTopicCandidates(input: BuildTopicCandidatesInput) {
  const familyLabel = classifyEventFamily(input);
  const slots = FAMILY_SLOTS[familyLabel];
  const targetCount =
    input.target_candidate_count ?? slots.length;

  return slots
    .slice(0, targetCount)
    .map((slot, slotIndex) => {
      const viralRubric = deriveRubric(input, slotIndex);

      if (!shouldKeepCandidate(viralRubric)) {
        return null;
      }

      // Generate meaningful core_conflict and strong_scene from the event
      // identity, NOT from the seed's prompt-instruction text.
      const generatedCoreConflict = buildCoreConflict(input, familyLabel);
      const generatedStrongScene = buildStrongScene(input, slot);

      return TopicCandidateCard.parse({
        event_identity: input.canonicalName,
        title: input.canonicalName,
        one_line_angle: slot.angle(input),
        family_label: familyLabel,
        scope_label: "—",
        estimated_duration_band: "medium",
        why_this_now: buildWhyThisNow(input),
        core_conflict: generatedCoreConflict,
        strong_scene: generatedStrongScene,
        must_cover_preview: compactUnique([
          generatedStrongScene,
          ...(input.canonicalQuotes ?? []),
          generatedCoreConflict,
        ]).slice(0, 3),
        risk_hints: ["避免扩成下游阶段对象"],
        source_hint: input.sourceHint,
        recent_usage_hint: input.recentUsageHint,
        viral_rubric: viralRubric,
      });
    })
    .filter((candidate): candidate is ReturnType<typeof TopicCandidateCard.parse> =>
      Boolean(candidate),
    );
}

/** Detect text that reads like an LLM prompt instruction, not like topic content. */
function isInstructionText(text: string): boolean {
  const patterns = [
    "请围绕", "不得超出", "优先推荐", "优先寻找",
    "严格排除", "所有场景必须", "不得采用", "禁止返回",
    "不得返回", "仅使用", "一律排除",
  ];
  return patterns.some((p) => text.includes(p));
}

/** Build a human-readable core conflict from the event identity. */
function buildCoreConflict(
  input: BuildTopicCandidatesInput,
  familyLabel: string,
): string {
  const name = input.canonicalName;
  // Use the summary if it reads like content (not instructions)
  const summary = input.summary ?? "";
  if (!isInstructionText(summary) && summary.length > 10) {
    return summary;
  }
  return `${name}中的关键人物在极端压力下做出不可逆的选择，由此引发的连锁反应改变了局势走向。`;
}

/** Build a human-readable strong scene from the event identity and angle. */
function buildStrongScene(
  input: BuildTopicCandidatesInput,
  slot: { key: string; angle: (input: BuildTopicCandidatesInput) => string },
): string {
  const name = input.canonicalName;
  // Check if the summary is actual content (not instruction text)
  const summary = input.summary ?? "";

  if (isInstructionText(summary)) {
    // Generate from slot angle — this describes the dramatic moment
    const angle = slot.angle(input);
    return `${name}：${angle}`;
  }

  // Use the summary as strong_scene since it's actual content
  if (summary.length > 10) {
    return summary;
  }

  return `${name}的历史关键时刻。`;
}

/** Build a human-readable "why this now" that is not a prompt instruction. */
function buildWhyThisNow(input: BuildTopicCandidatesInput): string {
  const hint = input.recentUsageHint;
  if (isInstructionText(hint)) {
    return "该事件具备可讲张力，适合进入文案阶段。";
  }
  return `${hint}，且当前具备可讲张力。`;
}
