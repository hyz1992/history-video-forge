import { beforeEach, describe, expect, it, vi } from "vitest";

const generateStoryboardPlanMock = vi.hoisted(() => vi.fn());

vi.mock("../../../backend/src/modules/storyboard/storyboard-generation.service.js", () => ({
  generateStoryboardPlan: generateStoryboardPlanMock,
}));

import { createDbClient } from "../../../backend/src/db/client.js";
import { createLegacyProject as createProject } from "../projects/legacy-project.fixture.js";
import { saveScriptRecord } from "../../../backend/src/modules/script/script-record.repository.js";
import { saveTopicPackage } from "../../../backend/src/modules/topic/topic-package.repository.js";
import { runStoryboardGeneration } from "../../../backend/src/modules/storyboard/storyboard-run.service.js";
import { LlmOutputError } from "../../../backend/src/runtime/llm/llm-output-error.js";

async function prepareActiveScript(db: ReturnType<typeof createDbClient>) {
  const project = await createProject(db, { name: "Storyboard Run Error" });
  const topicPackage = await saveTopicPackage(db, {
    projectId: project.id,
    title: "Storyboard Topic",
    selectedAngle: "A public answer reverses the pressure.",
    familyLabel: "diplomacy",
    scopeLabel: "single_event",
    coreConflict: "The envoy must answer in front of everyone.",
    strongScene: "The hall falls quiet after the answer.",
    packagingSeed: "One sentence changes the room.",
    canonicalQuotesJson: [],
    durationBandJson: { label: "medium" },
    narrativeTensionMapJson: {
      hook_claim: "A public pressure scene begins.",
      pressure_escalation: "The insult keeps rising.",
      mid_reveal: "The answer is guarding the state's face.",
      peak_payoff: "The reply reverses the pressure.",
      ending_residue: "Retreat would cost more than silence.",
    },
    mustIncludeBeatsJson: ["public answer"],
    forbiddenExpansionsJson: [],
    riskHintsJson: [],
    sourceAnchorRefsJson: ["source-a"],
  });
  const scriptText =
    "Opening pressure. The envoy answers in public. The ending leaves a cost.";
  const scriptRecord = await saveScriptRecord(db, {
    projectId: project.id,
    topicPackageId: topicPackage.id,
    scriptText,
    openingSpan: "Opening pressure.",
    endingSpan: "The ending leaves a cost.",
    estimatedDurationSec: 82,
    beatTraceJson: [
      {
        beat: "public answer",
        excerpt: "The envoy answers in public.",
        confidence: 0.95,
      },
    ],
    quoteTraceJson: [],
    reviewStatus: "pass",
    validationResultJson: {
      stage: "script_local_validation",
      decision: "pass",
    },
    semanticReviewResultJson: {
      stage: "script_semantic_review",
      decision: "pass",
      patch_intent: null,
    },
    executionStateJson: {
      patch_used: false,
      regenerate_used: false,
    },
  });

  project.activeTopicPackageId = topicPackage.id;
  project.activeScriptRecordId = scriptRecord.id;
  project.status = "script_ready";

  return { project, topicPackage, scriptRecord };
}

describe("runStoryboardGeneration error classification", () => {
  beforeEach(() => {
    generateStoryboardPlanMock.mockReset();
  });

  it("writes storyboard_plan_schema_invalid to executionState.error when generateStoryboardPlan throws LlmOutputError", async () => {
    generateStoryboardPlanMock.mockImplementation(() => {
      throw new LlmOutputError("storyboard_plan_schema_invalid", {
        cause: [{ path: ["segments"], message: "Required" }],
      });
    });

    const db = createDbClient();
    const { project } = await prepareActiveScript(db);

    const response = await runStoryboardGeneration({ db, project });

    expect(response.statusCode).toBe(500);
    expect(response.body).toMatchObject({
      error: "storyboard_plan_schema_invalid",
    });

    const failedRecord = [...db.storyboardRecords.values()].at(-1);
    expect(failedRecord).toBeDefined();
    const executionState = (failedRecord!.executionStateJson ?? {}) as Record<
      string,
      unknown
    >;
    expect(executionState.generating).toBe(false);
    expect(executionState.error).toBe("storyboard_plan_schema_invalid");
  });

  it("falls back to internal_server_error for non-LlmOutputError exceptions", async () => {
    generateStoryboardPlanMock.mockImplementation(() => {
      throw new Error("provider network boom");
    });

    const db = createDbClient();
    const { project } = await prepareActiveScript(db);

    const response = await runStoryboardGeneration({ db, project });

    expect(response.statusCode).toBe(500);
    expect(response.body).toMatchObject({ error: "internal_server_error" });

    const failedRecord = [...db.storyboardRecords.values()].at(-1);
    expect(failedRecord).toBeDefined();
    const executionState = (failedRecord!.executionStateJson ?? {}) as Record<
      string,
      unknown
    >;
    expect(executionState.generating).toBe(false);
    expect(executionState.error).toBe("internal_server_error");
  });
});
