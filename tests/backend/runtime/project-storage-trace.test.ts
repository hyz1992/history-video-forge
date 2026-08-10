import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createDbClient } from "../../../backend/src/db/client.js";
import { createProject } from "../../../backend/src/modules/projects/project.repository.js";
import {
  createCompositeInteractionLogWriter,
  createProjectTraceAppender,
  getProjectStorageProfile,
} from "../../../backend/src/runtime/trace/project-storage.js";

const roots: string[] = [];
const originalStorageRootDir = process.env.STORAGE_ROOT_DIR;

afterEach(() => {
  if (originalStorageRootDir === undefined) {
    delete process.env.STORAGE_ROOT_DIR;
  } else {
    process.env.STORAGE_ROOT_DIR = originalStorageRootDir;
  }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("project storage diagnostic trace", () => {
  it("appends a Service Diagnostic section without creating an LLM interaction file", async () => {
    const root = mkdtempSync(resolve(tmpdir(), "asset-plan-diagnostic-trace-"));
    roots.push(root);
    process.env.STORAGE_ROOT_DIR = root;
    const project = await createProject(createDbClient(), {
      name: "Global Structure Diagnostic",
    });
    const writer = createCompositeInteractionLogWriter({
      project,
      phase: "asset_planning",
      runId: "run_diagnostic",
    });

    writer.writeDiagnostic("asset-planning.global-structure", {
      type: "repair_failed",
      initial_issues: [{ path: ["art_bible", "props", 0, "consistency_notes"] }],
      patch_issues: [],
      final_issues: [{ path: ["tasks", 2, "risk_notes"] }],
    });

    const profile = getProjectStorageProfile(project);
    expect(profile).not.toBeNull();
    const trace = readFileSync(resolve(root, profile!.trace_dir, "trace.md"), "utf8");
    expect(trace).toContain("Service Diagnostic");
    expect(trace).toContain("asset-planning.global-structure");
    expect(trace).toContain('"type": "repair_failed"');
    expect(trace).not.toContain("## [Error]");
    const interactionDir = resolve(
      root,
      profile!.asset_plan_runs_dir,
      "run_diagnostic",
      "llm-interactions",
    );
    expect(existsSync(interactionDir) ? readdirSync(interactionDir) : []).toEqual([]);
  });

  it("keeps existing interaction and error trace behavior", async () => {
    const root = mkdtempSync(resolve(tmpdir(), "asset-plan-trace-regression-"));
    roots.push(root);
    process.env.STORAGE_ROOT_DIR = root;
    const project = await createProject(createDbClient(), { name: "Trace Regression" });
    const writer = createProjectTraceAppender(project);

    writer.writeError("known failure");

    const profile = getProjectStorageProfile(project)!;
    const trace = readFileSync(resolve(root, profile.trace_dir, "trace.md"), "utf8");
    expect(trace).toContain("known failure");
    expect(trace).toContain("[Error]");
  });

  it("redacts legacy resilience action values and keeps bounded diagnostic facts", async () => {
    const root = mkdtempSync(resolve(tmpdir(), "asset-plan-resilience-trace-"));
    roots.push(root);
    process.env.STORAGE_ROOT_DIR = root;
    const project = await createProject(createDbClient(), {
      name: "Legacy Resilience Diagnostic",
    });
    const writer = createProjectTraceAppender(project);

    writer.writeDiagnostic("asset-planning.resilience", {
      type: "legacy_audio_timing_canonicalized",
      actions: [
        {
          type: "audio_timing_rebound",
          dependency_id: "dep-secret",
          before_task_id: "motion-secret",
          after_task_id: "tts-secret",
          reason_code: "invalid_audio_timing_source",
        },
      ],
    });

    const profile = getProjectStorageProfile(project)!;
    const trace = readFileSync(resolve(root, profile.trace_dir, "trace.md"), "utf8");
    expect(trace).toContain("asset-planning.resilience");
    expect(trace).toContain('"type": "legacy_audio_timing_canonicalized"');
    expect(trace).toContain('"action_types"');
    expect(trace).toContain('"action_count": 1');
    expect(trace).not.toContain("dep-secret");
    expect(trace).not.toContain("motion-secret");
    expect(trace).not.toContain("tts-secret");
    expect(trace).not.toContain("before_task_id");
    expect(trace).not.toContain("after_task_id");
  });

  it.each([
    ["undefined", undefined],
    ["function", () => undefined],
    ["symbol", Symbol("diagnostic")],
  ])("serializes unsupported top-level %s payloads with a stable fallback", async (valueType, payload) => {
    const root = mkdtempSync(resolve(tmpdir(), "asset-plan-unsupported-diagnostic-"));
    roots.push(root);
    process.env.STORAGE_ROOT_DIR = root;
    const project = await createProject(createDbClient(), {
      name: "Unsupported Diagnostic Payload",
    });
    const writer = createProjectTraceAppender(project);

    writer.writeDiagnostic("unsupported-payload", payload);

    const profile = getProjectStorageProfile(project)!;
    const trace = readFileSync(resolve(root, profile.trace_dir, "trace.md"), "utf8");
    expect(trace).toContain('"serialization_error": "unsupported_top_level_value"');
    expect(trace).toContain(`"value_type": "${valueType}"`);
    expect(trace).not.toContain("```json\n\n```");
  });
});
