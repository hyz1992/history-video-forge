import { describe, expect, it } from "vitest";

import { createDbClient } from "../../../backend/src/db/client.js";
import { createProvisionalEvent } from "../../../backend/src/modules/events/event-registry.repository.js";
import { createProject } from "../../../backend/src/modules/projects/project.repository.js";
import { confirmTopicCandidate } from "../../../backend/src/modules/topic/topic-confirm.service.js";

describe("topic confirm service", () => {
  it("builds a minimally complete story contract when confirming a candidate", async () => {
    const db = createDbClient();
    const project = await createProject(db, {
      name: "Topic Confirm Service",
    });
    const event = await createProvisionalEvent(db, {
      canonicalName: "晏子使楚",
      aliases: ["晏子出使楚国"],
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
    expect(result.topic_package.canonical_quotes).toEqual([]);
    expect(result.topic_package.ambiguity_notes).toEqual([]);
  });
});
