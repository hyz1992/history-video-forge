import { describe, expect, it } from "vitest";

import type { EventRegistryRecord } from "../../../backend/src/db/client.js";
import { createDbClient } from "../../../backend/src/db/client.js";
import { createLegacyProject as createProject } from "../projects/legacy-project.fixture.js";
import {
  confirmTopicCandidate,
  type StoredTopicCandidate,
} from "../../../backend/src/modules/topic/topic-confirm.service.js";

function createEvent(
  overrides: Partial<EventRegistryRecord> = {},
): EventRegistryRecord {
  const now = new Date("2026-05-08T00:00:00.000Z");

  return {
    id: "event-zhuanzhu",
    canonicalName: "专诸刺王僚",
    aliases: [],
    canonicalQuotesJson: [],
    canonicalQuoteIntentsJson: [],
    sourceType: "fixture",
    isProvisional: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function createCandidate(
  projectId: string,
  overrides: Partial<StoredTopicCandidate> = {},
): StoredTopicCandidate {
  return {
    candidateId: "candidate-zhuanzhu",
    projectId,
    event: createEvent(),
    title: "专诸刺王僚",
    oneLineAngle: "真正刺出去的不是一把刀，而是一条已经押上的命。",
    familyLabel: "刺杀政变型",
    scopeLabel: "完整事件",
    coreConflict:
      "公子光把夺位希望压在专诸一人身上，专诸必须用一场鱼宴完成近身刺杀。",
    strongScene: "鱼腹藏剑改变吴国权力。",
    mustCoverPreview: [
      "公子光以国士之礼结恩专诸",
      "专诸端上鱼宴并从鱼腹中抽剑刺向王僚",
      "专诸以命还恩却把家人余债留在身后",
    ],
    sourceHint: "《史记·刺客列传》",
    recentUsageHint: "近期未出现同 event_id",
    ...overrides,
  };
}

describe("topic confirm material shape", () => {
  it("freezes peak payoff from the second preview node instead of generic strong_scene", async () => {
    const db = createDbClient();
    const project = await createProject(db, {
      name: "Topic Material Shape",
    });

    const result = await confirmTopicCandidate({
      projectDb: db,
      project,
      candidate: createCandidate(project.id),
    });

    expect(result.topic_package.must_include_beats).toEqual([
      "公子光以国士之礼结恩专诸",
      "专诸端上鱼宴并从鱼腹中抽剑刺向王僚",
      "专诸以命还恩却把家人余债留在身后",
    ]);
    expect(result.topic_package.narrative_tension_map.peak_payoff).toBe(
      "专诸端上鱼宴并从鱼腹中抽剑刺向王僚",
    );
    expect(result.topic_package.narrative_tension_map.peak_payoff).not.toBe(
      "鱼腹藏剑改变吴国权力。",
    );
    expect(result.topic_package.narrative_tension_map.ending_residue).toBe(
      "专诸以命还恩却把家人余债留在身后",
    );
    expect(result.topic_package.stakes).toContain(
      "专诸以命还恩却把家人余债留在身后",
    );
  });

  it("preserves quote intent material while using preview nodes for payoff shape", async () => {
    const db = createDbClient();
    const project = await createProject(db, {
      name: "Topic Quote Payoff Shape",
    });
    const event = createEvent({
      id: "event-yanzi",
      canonicalName: "晏子使楚",
      canonicalQuotesJson: [
        "使狗国者，从狗门入",
        "橘生淮南则为橘，生于淮北则为枳",
      ],
      canonicalQuoteIntentsJson: [
        {
          quote: "使狗国者，从狗门入",
          intent: "用于反击楚王以狗门羞辱齐国使节。",
        },
        {
          quote: "橘生淮南则为橘，生于淮北则为枳",
          intent: "用于反击楚王以齐人善盗羞辱齐国。",
        },
      ],
    });

    const result = await confirmTopicCandidate({
      projectDb: db,
      project,
      candidate: createCandidate(project.id, {
        candidateId: "candidate-yanzi",
        event,
        title: "晏子使楚",
        familyLabel: "外交压场型",
        coreConflict: "楚王连续羞辱齐国使节，晏子必须把羞辱当场顶回去。",
        strongScene: "楚王连续压场，晏子一句句顶回去。",
        mustCoverPreview: [
          "楚人闭正门开狗门迎齐使",
          "晏子以使狗国者从狗门入反击狗门羞辱",
          "楚王再以齐人善盗压场，晏子以橘枳之喻把羞辱反扣回楚国",
        ],
      }),
    });

    expect(result.topic_package.canonical_quote_intents).toEqual(
      event.canonicalQuoteIntentsJson,
    );
    expect(result.topic_package.narrative_tension_map.peak_payoff).toBe(
      "晏子以使狗国者从狗门入反击狗门羞辱",
    );
    expect(result.topic_package.narrative_tension_map.ending_residue).toBe(
      "楚王再以齐人善盗压场，晏子以橘枳之喻把羞辱反扣回楚国",
    );
  });

  it("carries opening pressure and pressure turn into existing tension fields", async () => {
    const db = createDbClient();
    const project = await createProject(db, {
      name: "Topic Opening Pressure Shape",
    });
    const event = createEvent({
      id: "event-hongmenyan",
      canonicalName: "鸿门宴",
    });

    const candidate = createCandidate(project.id, {
      candidateId: "candidate-hongmenyan",
      event,
      title: "鸿门宴：刘邦如何把自己变成杀了也不体面的人",
      oneLineAngle:
        "刘邦赌的不是项羽善良，而是项羽太在乎自己像不像天下共主。",
      familyLabel: "权力饭局型",
      scopeLabel: "完整事件",
      coreConflict:
        "项羽一念之间可以杀刘邦，但刘邦把自己包装成已经认输的人，让项羽动手也不像霸主。",
      strongScene: "范增举玦，项羽迟迟不令。",
      mustCoverPreview: [
        "刘邦带礼物低头入营谢罪，把自己压成已经认输的人",
        "范增频频举玦催杀，项羽为了霸主姿态迟迟不令",
        "刘邦从项羽的性格裂缝里逃出鸿门宴",
      ],
      sourceHint: "《史记·项羽本纪》",
    });

    const result = await confirmTopicCandidate({
      projectDb: db,
      project,
      candidate,
    });

    expect(result.topic_package.narrative_tension_map.hook_claim).toContain(
      "刘邦带礼物低头入营谢罪，把自己压成已经认输的人",
    );
    expect(result.topic_package.narrative_tension_map.hook_claim).toContain(
      "刘邦赌的不是项羽善良",
    );
    expect(
      result.topic_package.narrative_tension_map.pressure_escalation,
    ).toContain(
      "项羽一念之间可以杀刘邦，但刘邦把自己包装成已经认输的人，让项羽动手也不像霸主。",
    );
    expect(
      result.topic_package.narrative_tension_map.pressure_escalation,
    ).toContain(
      "刘邦带礼物低头入营谢罪，把自己压成已经认输的人",
    );
    expect(
      result.topic_package.narrative_tension_map.pressure_escalation,
    ).toContain("范增频频举玦催杀，项羽为了霸主姿态迟迟不令");
    expect(result.topic_package.narrative_tension_map.peak_payoff).toBe(
      "范增频频举玦催杀，项羽为了霸主姿态迟迟不令",
    );
    expect(result.topic_package.narrative_tension_map.ending_residue).toBe(
      "刘邦从项羽的性格裂缝里逃出鸿门宴",
    );
    expect(result.topic_package.stakes).toContain(
      "刘邦从项羽的性格裂缝里逃出鸿门宴",
    );
  });
});
