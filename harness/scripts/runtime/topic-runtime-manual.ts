import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { buildApp } from "../../../backend/src/app.js";
import { createAuthenticatedAuthContext } from "../../../backend/src/auth/auth-context.js";

export interface TopicRuntimeManualRequest {
  canonical_name: string;
  summary: string;
  core_conflict: string;
  strong_scene: string;
  source_hint: string;
  recent_usage_hint: string;
  tags?: string[];
}

export interface RunTopicRuntimeManualInput {
  request: TopicRuntimeManualRequest;
  outputDir?: string;
}

export interface RunTopicRuntimeManualResult {
  outputDir: string;
  projectId: string;
  recommendationResponse: unknown;
}

export async function runTopicRuntimeManual(
  input: RunTopicRuntimeManualInput,
): Promise<RunTopicRuntimeManualResult> {
  const app = buildApp();
  const smokeAuth = createAuthenticatedAuthContext({
    userId: "smoke-owner",
    username: "smoke-owner",
    displayName: "Smoke Owner",
    role: "ADMIN",
    sessionId: "smoke-session",
  });
  const projectResponse = await app.inject({
    method: "POST",
    url: "/api/projects",
    payload: {
      name: `Topic Runtime Manual - ${input.request.canonical_name}`,
    },
    auth: smokeAuth,
  });
  const projectId = projectResponse.json().project_id as string;

  const recommendationResponse = await app.inject({
    method: "POST",
    url: `/api/projects/${projectId}/topic/recommendations`,
    payload: input.request,
    auth: smokeAuth,
  });
  const recommendationBody = recommendationResponse.json();

  const outputDir =
    input.outputDir ?? resolve(process.cwd(), "harness/scripts/runtime/output");
  mkdirSync(outputDir, { recursive: true });

  writeJson(outputDir, "topic-recommendation-response.json", recommendationBody);
  writeJson(outputDir, "status.json", {
    generatedAt: new Date().toISOString(),
    status: "manual-ready",
    stage: "topic-runtime",
    projectId,
    outputDir,
  });
  writeFileSync(
    resolve(outputDir, "trace.md"),
    [
      "# topic runtime manual trace",
      "",
      `- project_id: ${projectId}`,
      "- flow: create-project -> topic-recommendations",
      `- output_dir: ${outputDir}`,
      "",
      "## 说明",
      "",
      "- 当前入口用于无前端条件下的 topic runtime 人工试跑。",
      "- 该脚本只驱动正式 backend API，不复制业务推荐逻辑。",
    ].join("\n"),
    "utf8",
  );

  return {
    outputDir,
    projectId,
    recommendationResponse: recommendationBody,
  };
}

function writeJson(outputDir: string, filename: string, value: unknown): void {
  writeFileSync(resolve(outputDir, filename), JSON.stringify(value, null, 2), "utf8");
}
