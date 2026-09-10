import { describe, expect, it, vi } from "vitest";

import { createDbClient } from "../../../backend/src/db/client.js";
import { createLegacyProject as createProject } from "../projects/legacy-project.fixture.js";
import { runScriptGeneration } from "../../../backend/src/modules/script/script-run.service.js";
import { saveTopicPackage } from "../../../backend/src/modules/topic/topic-package.repository.js";
import { LlmOutputError } from "../../../backend/src/runtime/llm/llm-output-error.js";

// 替换 generateScriptDraft，让它在 run 内抛 LlmOutputError，
// 验证 run service catch 把 executionState.error 写成 schema_invalid code，
// 而不是无差别 internal_server_error。
vi.mock("../../../backend/src/modules/script/script-generation.service.js", () => ({
  generateScriptDraft: vi.fn(() => {
    throw new LlmOutputError("script_draft_schema_invalid", {
      cause: [{ path: ["script_text"], message: "Required" }],
    });
  }),
}));

const topicPackageSeed = {
  title: "晏子使楚",
  selectedAngle: "楚王连压三次，晏子一次没退。",
  familyLabel: "外交压场",
  scopeLabel: "完整事件",
  coreConflict: "楚王借公开场合连续羞辱晏子与齐国，晏子必须当场顶回去。",
  strongScene: "楚王连续压场，晏子一句句顶回去。",
  stakes: "一旦退让，丢掉的是齐国在楚廷上的国格。",
  packagingSeed: "楚王连压三次，晏子一次没退。",
  canonicalQuotesJson: [],
  durationBandJson: { label: "medium", min_sec: 75, max_sec: 95 },
  narrativeTensionMapJson: {
    hook_claim: "楚王连压三次",
    pressure_escalation: "从身形升级到国格",
    mid_reveal: "晏子在守住齐国场面",
    peak_payoff: "橘枳之喻顶回",
    ending_residue: "一退就不只是退掉自己",
  },
  mustIncludeBeatsJson: ["入楚受辱", "橘枳之喻"],
  forbiddenExpansionsJson: [],
  riskHintsJson: [],
  sourceAnchorRefsJson: ["《晏子春秋》"],
  ambiguityNotesJson: [],
};

describe("runScriptGeneration error classification", () => {
  it("writes script_draft_schema_invalid to executionState.error when generateScriptDraft throws LlmOutputError", async () => {
    const db = createDbClient();
    const project = await createProject(db, { name: "Script Schema Error" });
    const topicPackageRecord = await saveTopicPackage(db, {
      projectId: project.id,
      ...topicPackageSeed,
    });
    project.activeTopicPackageId = topicPackageRecord.id;
    project.status = "script_ready";

    const response = await runScriptGeneration({
      db,
      project,
      allowPatch: false,
      allowRegen: false,
    });

    expect(response.statusCode).toBe(500);
    expect(response.body).toMatchObject({
      error: "script_draft_schema_invalid",
    });

    // 失败记录必须清掉 generating，并把 schema code 写入 executionState.error
    const failedRecord = db.scriptRecords.get(
      project.activeScriptRecordId ?? "",
    ) ?? [...db.scriptRecords.values()].at(-1);
    expect(failedRecord).toBeDefined();
    const executionState = (failedRecord!.executionStateJson ?? {}) as Record<
      string,
      unknown
    >;
    expect(executionState.generating).toBe(false);
    expect(executionState.error).toBe("script_draft_schema_invalid");
  });

  it("falls back to internal_server_error for non-LlmOutputError exceptions", async () => {
    const { generateScriptDraft } = await import(
      "../../../backend/src/modules/script/script-generation.service.js"
    );
    vi.mocked(generateScriptDraft).mockImplementationOnce(() => {
      throw new Error("network boom");
    });

    const db = createDbClient();
    const project = await createProject(db, { name: "Script Net Error" });
    const topicPackageRecord = await saveTopicPackage(db, {
      projectId: project.id,
      ...topicPackageSeed,
    });
    project.activeTopicPackageId = topicPackageRecord.id;
    project.status = "script_ready";

    const response = await runScriptGeneration({
      db,
      project,
      allowPatch: false,
      allowRegen: false,
    });

    expect(response.statusCode).toBe(500);
    expect(response.body).toMatchObject({ error: "internal_server_error" });
  });
});
