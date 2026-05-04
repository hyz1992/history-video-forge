import { describe, expect, it } from "vitest";

import { createDbClient } from "../../../backend/src/db/client.js";
import { createProject } from "../../../backend/src/modules/projects/project.repository.js";
import { saveTopicPackage } from "../../../backend/src/modules/topic/topic-package.repository.js";

describe("topic package repository", () => {
  it("persists story completeness fields on TopicPackageRecord", async () => {
    const db = createDbClient();
    const project = await createProject(db, {
      name: "Topic Package Repository",
    });

    const saved = await saveTopicPackage(db, {
      projectId: project.id,
      title: "晏子使楚",
      selectedAngle: "楚王不是只压了晏子一次，而是连压三次。",
      familyLabel: "外交压场型",
      scopeLabel: "完整事件",
      coreConflict: "楚王借公开场合连续羞辱晏子与齐国，晏子必须当场顶回去。",
      strongScene: "楚王连续压场，晏子一句句顶回去。",
      stakes: "一旦退让，就不只是晏子个人失场，而是齐国当场被楚国压住。",
      packagingSeed: "楚王连压三次，晏子一次没退。",
      canonicalQuotesJson: ["橘生淮南则为橘"],
      durationBandJson: {
        label: "medium",
        min_sec: 75,
        max_sec: 95,
      },
      narrativeTensionMapJson: {
        hook_claim: "楚王不是只压了晏子一次，而是连压三次",
        pressure_escalation: "从羞辱身形升级到羞辱齐国，再升级到羞辱齐人风气",
        mid_reveal: "晏子不是在逞口舌，而是在守住齐国场面",
        peak_payoff: "橘枳之喻把第三次压场原样顶回",
        ending_residue: "这种场面，一退就不只是退掉自己",
      },
      mustIncludeBeatsJson: ["入楚受辱", "橘枳之喻"],
      forbiddenExpansionsJson: ["不要扩写到未定 downstream 阶段"],
      riskHintsJson: ["不要把内容写成课堂导入"],
      sourceAnchorRefsJson: ["《晏子春秋》"],
      ambiguityNotesJson: ["橘枳之喻存在后世转述差异"],
    } as any);

    const stored = db.topicPackages.get(saved.id);

    expect(stored).toBeDefined();
    expect(stored).toMatchObject({
      stakes: "一旦退让，就不只是晏子个人失场，而是齐国当场被楚国压住。",
      sourceAnchorRefsJson: ["《晏子春秋》"],
      canonicalQuotesJson: ["橘生淮南则为橘"],
      ambiguityNotesJson: ["橘枳之喻存在后世转述差异"],
    });
  });
});
