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
      initial_issues: [{
        path: ["art_bible", "props", 0, "consistency_notes"],
        message: "RAW_GLOBAL_SINK_SECRET",
        value: "secret_token_123",
      }],
      patch_issues: [],
      final_issues: [{ path: ["tasks", 2, "risk_notes"] }],
      actions: [{ type: "secret_action_123", value: "RAW_GLOBAL_SINK_SECRET" }],
      stack: "RAW_GLOBAL_SINK_SECRET stack",
      cause: { message: "RAW_GLOBAL_SINK_SECRET cause" },
    });

    const profile = getProjectStorageProfile(project);
    expect(profile).not.toBeNull();
    const trace = readFileSync(resolve(root, profile!.trace_dir, "trace.md"), "utf8");
    expect(trace).toContain("Service Diagnostic");
    expect(trace).toContain("asset-planning.global-structure");
    expect(trace).toContain('"type": "repair_failed"');
    expect(trace).toContain('"issue_count": 2');
    expect(trace).toContain('"issue_paths"');
    expect(trace).not.toContain("RAW_GLOBAL_SINK_SECRET");
    expect(trace).not.toContain("secret_token_123");
    expect(trace).not.toContain('"initial_issues"');
    expect(trace).not.toContain('"actions"');
    expect(trace).not.toContain('"stack"');
    expect(trace).not.toContain('"cause"');
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

  it("redacts intent chunk diagnostics to bounded status, stage, counts, and compiler action codes", async () => {
    const root = mkdtempSync(resolve(tmpdir(), "asset-plan-intent-chunk-trace-"));
    roots.push(root);
    process.env.STORAGE_ROOT_DIR = root;
    const project = await createProject(createDbClient(), {
      name: "Intent Chunk Diagnostic",
    });
    const writer = createProjectTraceAppender(project);
    const rawSecret = `RAW_INTENT_TRACE_SECRET_${"x".repeat(200)}`;

    writer.writeDiagnostic("asset-planning.intent-chunks", {
      chunk_count: 1,
      chunks: [{
        chunk_id: "chunk_001",
        chunk_index: 0,
        status: "failed",
        stage: "regenerated",
        error_code: "secret_token_123",
        failure_class: "llm_output",
        compiler_actions: ["visual_strategy_applied", rawSecret],
        issue_paths: ["segments[0].source_segment_id", rawSecret],
        accounting: {
          business_slot: 3,
          logical_invocation: 3,
          safety_invocation: 1,
          provider_attempts: 6,
          network_request_count: 6,
        },
        prompt: rawSecret,
        raw_response: rawSecret,
        issues: [{ path: [rawSecret], message: rawSecret, value: rawSecret }],
        task_id: rawSecret,
        dependency_id: rawSecret,
      }],
    });

    const profile = getProjectStorageProfile(project)!;
    const trace = readFileSync(resolve(root, profile.trace_dir, "trace.md"), "utf8");
    expect(trace).toContain("asset-planning.intent-chunks");
    expect(trace).toContain('"chunk_id": "chunk_001"');
    expect(trace).toContain('"logical_invocation": 3');
    expect(trace).toContain('"compiler_actions"');
    expect(trace).toContain("visual_strategy_applied");
    expect(trace).toContain("segments[0].source_segment_id");
    expect(trace).toContain('"error_code": "intent_chunk_business_failed"');
    expect(trace).not.toContain("secret_token_123");
    expect(trace).not.toContain("RAW_INTENT_TRACE_SECRET");
    expect(trace).not.toContain("raw_response");
    expect(trace).not.toContain('"issues"');
    expect(trace).not.toContain("task_id");
    expect(trace).not.toContain("dependency_id");
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

  it("uses a stable fallback when diagnostic serialization throws", async () => {
    const root = mkdtempSync(resolve(tmpdir(), "asset-plan-throwing-diagnostic-"));
    roots.push(root);
    process.env.STORAGE_ROOT_DIR = root;
    const project = await createProject(createDbClient(), {
      name: "Throwing Diagnostic Payload",
    });
    const writer = createProjectTraceAppender(project);

    writer.writeDiagnostic("throwing-payload", {
      toJSON() {
        throw new Error("RAW_SERIALIZATION_SECRET");
      },
    });

    const profile = getProjectStorageProfile(project)!;
    const trace = readFileSync(resolve(root, profile.trace_dir, "trace.md"), "utf8");
    expect(trace).toContain(
      '"serialization_error": "diagnostic_serialization_failed"',
    );
    expect(trace).not.toContain("RAW_SERIALIZATION_SECRET");
  });
});
