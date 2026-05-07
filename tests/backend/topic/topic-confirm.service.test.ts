import { describe, expect, it } from "vitest";

import { createDbClient } from "../../../backend/src/db/client.js";
import { createProvisionalEvent } from "../../../backend/src/modules/events/event-registry.repository.js";
import { createProject } from "../../../backend/src/modules/projects/project.repository.js";
import { confirmTopicCandidate } from "../../../backend/src/modules/topic/topic-confirm.service.js";
import { assessTopicPackageScriptSufficiency } from "../../../backend/src/modules/topic/topic-package-script-sufficiency.js";
import type { TopicPackage } from "../../../shared/src/index.js";

describe("topic confirm service", () => {
  it("builds a minimally complete story contract when confirming a candidate", async () => {
    const db = createDbClient();
    const project = await createProject(db, {
      name: "Topic Confirm Service",
    });
    const event = await createProvisionalEvent(db, {
      canonicalName: "晏子使楚",
      aliases: ["晏子出使楚国"],
      canonicalQuotes: [
        "使狗国者，从狗门入",
        "橘生淮南则为橘，生于淮北则为枳",
      ],
    });

    const result = await confirmTopicCandidate({
      projectDb: db,
      project,
      candidate: {
        candidateId: "yanzi-shichu",
        projectId: project.id,
        event,
        title: "晏子使楚",
        oneLineAngle: "楚王不是只压了晏子一次，而是连压三次。",
        familyLabel: "外交压场型",
        scopeLabel: "完整事件",
        coreConflict:
          "楚王借公开场合连续羞辱晏子与齐国，晏子必须当场顶回去。",
        strongScene: "楚王连续压场，晏子一句句顶回去。",
        sourceHint: "《晏子春秋》",
        recentUsageHint: "近期未出现同 event_id",
      },
    });

    expect(result.topic_package.stakes).toEqual(expect.any(String));
    expect(result.topic_package.stakes.length).toBeGreaterThan(0);
    expect(result.topic_package.source_anchor_refs).toEqual(["《晏子春秋》"]);
    expect(result.topic_package.must_include_beats.length).toBeGreaterThanOrEqual(3);
    expect(result.topic_package.must_include_beats).not.toEqual([
      result.topic_package.strong_scene,
    ]);
    expect(result.topic_package.canonical_quotes).toEqual([
      "使狗国者，从狗门入",
      "橘生淮南则为橘，生于淮北则为枳",
    ]);
    expect(
      db.topicPackages.get(result.topic_package.topic_package_id)
        ?.canonicalQuotesJson,
    ).toEqual([
      "使狗国者，从狗门入",
      "橘生淮南则为橘，生于淮北则为枳",
    ]);
    expect(result.topic_package.ambiguity_notes).toEqual([]);
  });

  it("keeps topic package tension map and beats free of reusable pressure templates", async () => {
    const db = createDbClient();
    const project = await createProject(db, {
      name: "Topic Template Pollution",
    });
    const event = await createProvisionalEvent(db, {
      canonicalName: "巨鹿之战",
      aliases: ["破釜沉舟"],
    });

    const result = await confirmTopicCandidate({
      projectDb: db,
      project,
      candidate: {
        candidateId: "julu-zhizhan",
        projectId: project.id,
        event,
        title: "巨鹿之战",
        oneLineAngle: "项羽真正狠的不是喊冲，而是先把退路砸碎。",
        familyLabel: "战场翻盘型",
        scopeLabel: "完整事件",
        coreConflict: "退路还在，士气就散；退路砸碎，所有人只能向前。",
        strongScene: "项羽下令砸锅沉船，楚军回头看见退路已经没了。",
        sourceHint: "《史记·项羽本纪》",
        recentUsageHint: "扩展 smoke 样例",
      },
    });

    const contractText = [
      result.topic_package.narrative_tension_map.pressure_escalation,
      result.topic_package.narrative_tension_map.mid_reveal,
      result.topic_package.narrative_tension_map.ending_residue,
      ...result.topic_package.must_include_beats,
    ].join("\n");

    expect(contractText).not.toContain("公开压场");
    expect(contractText).not.toContain("局势先被对方抢走");
    expect(contractText).not.toContain("必须把这口气当场顶回去");
    expect(contractText).not.toContain("这类场面一旦退掉");
    expect(contractText).toContain("退路还在，士气就散");
    expect(contractText).toContain("项羽下令砸锅沉船");
  });

  it("prefers candidate must cover preview as script-writable beats", async () => {
    const db = createDbClient();
    const project = await createProject(db, {
      name: "Topic Must Cover Preview",
    });
    const event = await createProvisionalEvent(db, {
      canonicalName: "Zhuanzhu Assassinates Wang Liao",
      aliases: ["Fish belly dagger"],
    });
    const mustCoverPreview = [
      "The cook carries the fish into the inner banquet.",
      "The blade comes out from the fish at the serving table.",
      "The guards close in as the assassin pays the price.",
    ];

    const result = await confirmTopicCandidate({
      projectDb: db,
      project,
      candidate: {
        candidateId: "zhuanzhu-ciwangliao",
        projectId: project.id,
        event,
        title: "Zhuanzhu Assassinates Wang Liao",
        oneLineAngle:
          "A banquet assassination turns Wu power in one instant.",
        familyLabel: "assassination pressure",
        scopeLabel: "single event",
        coreConflict: "There is only one chance to strike at the banquet.",
        strongScene: "The sword is hidden inside the fish.",
        mustCoverPreview,
        sourceHint: "Shiji",
        recentUsageHint: "No recent same event.",
      },
    });

    expect(result.topic_package.must_include_beats).toEqual(mustCoverPreview);
  });

  it("uses candidate preview material to reduce topic package repetition", async () => {
    const db = createDbClient();
    const project = await createProject(db, {
      name: "Topic Repetition Reduction",
    });
    const event = await createProvisionalEvent(db, {
      canonicalName: "Zhuanzhu Assassinates Wang Liao",
      aliases: ["Fish belly dagger"],
    });
    const oneLineAngle =
      "A banquet assassination turns Wu power in one instant.";
    const coreConflict = "There is only one chance to strike at the banquet.";
    const strongScene = "The sword is hidden inside the fish.";
    const mustCoverPreview = [
      "The cook carries the fish into the inner banquet.",
      "The blade comes out from the fish at the serving table.",
      "The guards close in as the assassin pays the price.",
    ];

    const result = await confirmTopicCandidate({
      projectDb: db,
      project,
      candidate: {
        candidateId: "zhuanzhu-ciwangliao",
        projectId: project.id,
        event,
        title: "Zhuanzhu Assassinates Wang Liao",
        oneLineAngle,
        familyLabel: "assassination pressure",
        scopeLabel: "single event",
        coreConflict,
        strongScene,
        mustCoverPreview,
        sourceHint: "Shiji",
        recentUsageHint: "No recent same event.",
      },
    });

    const topicPackage: TopicPackage = {
      topic_id: result.topic_package.topic_package_id,
      title: result.topic_package.canonical_title,
      selected_angle: result.topic_package.selected_angle,
      family_label: result.topic_package.family_label,
      scope_label: result.topic_package.scope_label,
      core_conflict: result.topic_package.core_conflict,
      stakes: result.topic_package.stakes,
      strong_scene: result.topic_package.strong_scene,
      packaging_seed: result.topic_package.selected_angle,
      must_include_beats: result.topic_package.must_include_beats as string[],
      forbidden_expansions: result.topic_package
        .forbidden_expansions as string[],
      risk_hints: [],
      source_anchor_refs: result.topic_package.source_anchor_refs as string[],
      canonical_quotes: result.topic_package.canonical_quotes as string[],
      ambiguity_notes: result.topic_package.ambiguity_notes as string[],
      duration_band: "medium",
      narrative_tension_map: result.topic_package
        .narrative_tension_map as TopicPackage["narrative_tension_map"],
    };
    const report = assessTopicPackageScriptSufficiency(topicPackage);

    expect(result.topic_package.narrative_tension_map.mid_reveal).toBe(
      mustCoverPreview[1],
    );
    expect(result.topic_package.narrative_tension_map.ending_residue).toBe(
      mustCoverPreview[2],
    );
    expect(result.topic_package.stakes).not.toBe(
      `${coreConflict}${oneLineAngle}`,
    );
    expect(report.metrics.distinctTensionFieldCount).toBeGreaterThanOrEqual(4);
    expect(report.metrics.selectedAngleRepeatCount).toBeLessThanOrEqual(2);
  });
});
