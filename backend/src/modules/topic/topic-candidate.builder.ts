import { TopicCandidateCard } from "../../../../shared/src/index";

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

function buildMustCoverPreview(input: BuildTopicCandidatesInput): string[] {
  return [input.summary, input.strongScene, input.coreConflict].map((item) =>
    item.trim(),
  );
}

export function buildTopicCandidates(input: BuildTopicCandidatesInput) {
  const familyLabel = classifyEventFamily(input);
  const slots = FAMILY_SLOTS[familyLabel];

  return slots
    .map((slot, slotIndex) => {
      const viralRubric = deriveRubric(input, slotIndex);

      if (!shouldKeepCandidate(viralRubric)) {
        return null;
      }

      return TopicCandidateCard.parse({
        event_identity: input.canonicalName,
        title: input.canonicalName,
        one_line_angle: slot.angle(input),
        family_label: familyLabel,
        scope_label: "单事件",
        estimated_duration_band: "medium",
        why_this_now: `${input.recentUsageHint}，且当前具备可讲张力。`,
        core_conflict: input.coreConflict,
        strong_scene: input.strongScene,
        must_cover_preview: buildMustCoverPreview(input),
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
