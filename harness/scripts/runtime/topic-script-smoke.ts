import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { buildApp } from "../../../backend/src/app";
import {
  createAuthenticatedAuthContext,
} from "../../../backend/src/auth/auth-context";
import { mergeGraphTraceSummaries } from "../../../backend/src/runtime/orchestration/graph-trace";

export interface TopicScriptSmokeSample {
  sample_id: string;
  project_name: string;
  topic_request: {
    canonical_name: string;
    summary: string;
    core_conflict: string;
    strong_scene: string;
    source_hint: string;
    recent_usage_hint: string;
    canonical_quotes?: string[];
    canonical_quote_intents?: Array<{ quote: string; intent: string }>;
    tags: string[];
  };
  confirm_candidate_index?: number;
  script_request?: {
    allow_patch?: boolean;
    allow_regen?: boolean;
  };
}

export interface RunTopicScriptSmokeInput {
  samplePath: string;
  outputDir?: string;
}

export interface RunTopicScriptSmokeResult {
  outputDir: string;
  sample: TopicScriptSmokeSample;
  status: {
    generatedAt: string;
    status: string;
    stage: string;
    sampleId: string;
    projectId: string;
    outputDir: string;
    graphTraceSummary: {
      nodes: Array<{
        node_name: string;
        input_ref: string | null;
        output_ref: string | null;
        failure_reason: string | null;
      }>;
    };
  };
}

function writeJson(outputDir: string, filename: string, value: unknown) {
  writeFileSync(resolve(outputDir, filename), JSON.stringify(value, null, 2), "utf8");
}

function loadSample(samplePath: string): TopicScriptSmokeSample {
  const finalSamplePath = resolve(process.cwd(), samplePath);
  return JSON.parse(readFileSync(finalSamplePath, "utf8")) as TopicScriptSmokeSample;
}

export async function runTopicScriptSmoke(
  input: RunTopicScriptSmokeInput,
): Promise<RunTopicScriptSmokeResult> {
  const sample = loadSample(input.samplePath);
  const app = buildApp();
  const auth = createAuthenticatedAuthContext({
    userId: "topic-script-smoke-user",
    username: "topic-script-smoke-user",
    displayName: "Topic Script Smoke User",
    role: "USER",
    sessionId: `topic-script-smoke-${sample.sample_id}`,
  });

  const projectResponse = await app.inject({
    auth,
    method: "POST",
    url: "/api/projects",
    payload: {
      name: sample.project_name,
    },
  });
  const projectBody = projectResponse.json();
  const projectId = projectBody.project_id as string;

  const recommendationResponse = await app.inject({
    auth,
    method: "POST",
    url: `/api/projects/${projectId}/topic/recommendations`,
    payload: sample.topic_request,
  });
  const recommendationBody = recommendationResponse.json();
  if (recommendationResponse.statusCode !== 200) {
    throw new Error(
      `topic_recommendation_failed:${recommendationResponse.statusCode}:${
        recommendationBody.message ?? recommendationBody.error ?? "unknown_error"
      }`,
    );
  }
  const candidates = recommendationBody.candidates as Array<{
    candidate_id: string;
    event_identity: string;
    title: string;
    one_line_angle: string;
    must_cover_preview: string[];
  }>;
  if (!Array.isArray(candidates)) {
    throw new Error("topic_recommendation_candidates_missing");
  }

  const selectedCandidate =
    candidates[sample.confirm_candidate_index ?? 0] ?? candidates[0];
  if (!selectedCandidate) {
    throw new Error("topic_candidate_missing");
  }

  const confirmResponse = await app.inject({
    auth,
    method: "POST",
    url: `/api/projects/${projectId}/topic/candidates/${selectedCandidate.candidate_id}/confirm`,
    payload: {
      confirm_reason: "harness_smoke",
    },
  });
  const confirmBody = confirmResponse.json();

  const scriptResponse = await app.inject({
    auth,
    method: "POST",
    url: `/api/projects/${projectId}/script/generate`,
    payload: {
      allow_patch: sample.script_request?.allow_patch ?? true,
      allow_regen: sample.script_request?.allow_regen ?? true,
    },
  });
  const scriptBody = scriptResponse.json();

  const finalOutputDir =
    input.outputDir ?? resolve(process.cwd(), "harness/scripts/runtime/output");
  mkdirSync(finalOutputDir, { recursive: true });

  writeJson(finalOutputDir, "topic-candidates.json", recommendationBody.candidates);
  writeJson(
    finalOutputDir,
    "topic-candidate-preview-trace.json",
    recommendationBody.runtime_diagnostics?.candidate_preview_trace ?? {
      raw_candidates: [],
      selector_pool: [],
      final_candidates: candidates.map((candidate) => ({
        candidate_id: candidate.candidate_id,
        event_identity: candidate.event_identity,
        title: candidate.title,
        one_line_angle: candidate.one_line_angle,
        must_cover_preview: candidate.must_cover_preview,
      })),
    },
  );
  writeJson(finalOutputDir, "topic-package.json", confirmBody.topic_package);
  writeJson(finalOutputDir, "script-input-bundle.json", scriptBody.input_bundle);
  writeJson(finalOutputDir, "script-draft.json", scriptBody.draft);
  writeJson(finalOutputDir, "validation-result.json", scriptBody.local_validation);
  writeJson(
    finalOutputDir,
    "semantic-review-result.json",
    scriptBody.semantic_review,
  );
  const graphTraceSummary = mergeGraphTraceSummaries(
    recommendationBody.graph_trace_summary,
    scriptBody.graph_trace_summary,
  );
  const runtimeDiagnostics = {
    checks: [
      ...(recommendationBody.runtime_diagnostics?.checks ?? []),
      ...(scriptBody.runtime_diagnostics?.checks ?? []),
    ],
  };
  writeJson(finalOutputDir, "graph-trace-summary.json", graphTraceSummary);
  writeJson(finalOutputDir, "runtime-diagnostics.json", runtimeDiagnostics);

  const generatedAt = new Date().toISOString();
  const status = {
    generatedAt,
    status: "sample-ready",
    stage: "topic-to-script",
    sampleId: sample.sample_id,
    projectId,
    outputDir: finalOutputDir,
    graphTraceSummary,
  };

  writeJson(finalOutputDir, "status.json", status);
  writeFileSync(
    resolve(finalOutputDir, "trace.md"),
    [
      "# topic-script smoke trace",
      "",
      `- sample_id: ${sample.sample_id}`,
      `- project_id: ${projectId}`,
      `- generated_at: ${generatedAt}`,
      "- flow: create-project -> topic-recommendations -> topic-confirm -> script-generate",
      `- output_dir: ${finalOutputDir}`,
      "",
      "## Graph Summary",
      "",
      ...graphTraceSummary.nodes.map(
        (node) =>
          `- ${node.node_name}: ${node.input_ref ?? "null"} -> ${node.output_ref ?? "null"}`,
      ),
      "",
      "## 说明",
      "",
      "- 当前 smoke runner 走最小 backend API 闭环。",
      "- 目标是验证 topic -> script 第一阶段样例链路仍可稳定产出核心中间对象。",
    ].join("\n"),
    "utf8",
  );

  return {
    outputDir: finalOutputDir,
    sample,
    status,
  };
}
