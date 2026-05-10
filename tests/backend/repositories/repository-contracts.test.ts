import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { buildApp } from "../../../backend/src/app.js";
import { env } from "../../../backend/src/config/env.js";
import { createDbClient } from "../../../backend/src/db/client.js";
import {
  createProject,
  getProjectById,
} from "../../../backend/src/modules/projects/project.repository.js";
import {
  createProvisionalEvent,
  findEventByCanonicalOrAlias,
} from "../../../backend/src/modules/events/event-registry.repository.js";
import { saveTopicPackage } from "../../../backend/src/modules/topic/topic-package.repository.js";
import {
  getStoryboardRecordById,
  saveStoryboardRecord,
} from "../../../backend/src/modules/storyboard/storyboard-record.repository.js";
import { saveCachedCandidate } from "../../../backend/src/modules/cache/candidate-cache.repository.js";

const rootDir = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const prismaSchemaPath = resolve(rootDir, "backend/prisma/schema.prisma");

describe("backend repository contracts", () => {
  it("provides the minimum backend skeleton entrypoints", () => {
    expect(typeof buildApp).toBe("function");
    expect(typeof createDbClient).toBe("function");
    expect(env.nodeEnv).toBeTypeOf("string");
  });

  it("exposes the minimum stable repository methods", async () => {
    expect(typeof createProject).toBe("function");
    expect(typeof getProjectById).toBe("function");
    expect(typeof findEventByCanonicalOrAlias).toBe("function");
    expect(typeof createProvisionalEvent).toBe("function");
    expect(typeof saveTopicPackage).toBe("function");
    expect(typeof saveStoryboardRecord).toBe("function");
    expect(typeof getStoryboardRecordById).toBe("function");
    expect(typeof saveCachedCandidate).toBe("function");

    const db = createDbClient();
    const project = await createProject(db, {
      name: "Task 3 contract test",
    });

    expect(project.id).toBeTypeOf("string");
    expect(project.activeStoryboardRecordId).toBeNull();
    expect(project.latestStoryboardRunTraceJson).toBeNull();
    await expect(getProjectById(db, project.id)).resolves.toMatchObject({
      id: project.id,
      name: "Task 3 contract test",
    });
  });

  it("persists storyboard records in the repository contract", async () => {
    const db = createDbClient();
    const project = await createProject(db, {
      name: "Storyboard repository contract",
    });
    const topicPackage = await saveTopicPackage(db, {
      projectId: project.id,
      title: "Storyboard Topic",
      selectedAngle: "A public pressure scene",
      familyLabel: "diplomacy",
      scopeLabel: "single_event",
      coreConflict: "The envoy must answer without retreating.",
      strongScene: "A reply lands in the hall.",
      packagingSeed: "One reply flips the pressure.",
      durationBandJson: {
        label: "medium",
      },
      narrativeTensionMapJson: {
        hook_claim: "The pressure starts in public.",
        pressure_escalation: "The insult grows.",
        mid_reveal: "The trap is the point.",
        peak_payoff: "The reply reverses it.",
        ending_residue: "Retreat would cost more.",
      },
    });
    const storyboardRecord = await saveStoryboardRecord(db, {
      projectId: project.id,
      topicPackageId: topicPackage.id,
      scriptRecordId: "script_record_1",
      planJson: {
        storyboard_id: "storyboard_plan_1",
        segments: [],
      },
      validationResultJson: {
        stage: "storyboard_local_validation",
        decision: "pass",
        errors: [],
        warnings: [],
        metrics: {},
      },
      executionStateJson: {
        regenerate_used: false,
      },
      graphTraceSummaryJson: {
        phase: "storyboard",
        run_id: "storyboard_run_1",
        steps: [],
      },
      runtimeDiagnosticsJson: {
        checks: [],
      },
    });

    await expect(getStoryboardRecordById(db, storyboardRecord.id)).resolves.toMatchObject({
      id: storyboardRecord.id,
      projectId: project.id,
      topicPackageId: topicPackage.id,
      scriptRecordId: "script_record_1",
    });
  });

  it("declares the planned JSON persistence fields in prisma schema", () => {
    expect(existsSync(prismaSchemaPath)).toBe(true);

    const schema = readFileSync(prismaSchemaPath, "utf8");

    expect(schema).toContain("model TopicPackage");
    expect(schema).toContain("narrative_tension_map_json");
    expect(schema).toContain("model RecommendationCandidateCache");
    expect(schema).toContain("viral_rubric_json");
    expect(schema).toContain("model ScriptRecord");
    expect(schema).toContain("validation_result_json");
    expect(schema).toContain("semantic_review_result_json");
    expect(schema).toContain("active_storyboard_record_id");
    expect(schema).toContain("model StoryboardRecord");
    expect(schema).toContain("script_record_id");
    expect(schema).toContain("plan_json");
    expect(schema).toContain("graph_trace_summary_json");
  });
});
