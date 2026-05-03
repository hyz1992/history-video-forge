import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { buildApp } from "../../../backend/src/app.js";

export interface TopicCandidateLibraryRealCheckRequest {
  canonical_name: string;
  summary: string;
  core_conflict: string;
  strong_scene: string;
  source_hint: string;
  recent_usage_hint: string;
  tags: string[];
}

export interface TopicCandidateLibraryRealCheckRoundResult {
  round: number;
  statusCode: number;
  runId: string | null;
  candidateCount: number;
  candidates: Array<{
    candidate_id: string;
    event_identity: string;
    title: string;
    one_line_angle: string;
  }>;
  diagnosticCodes: string[];
  fallbackLoaded: boolean;
  selectorContainsFallbackCandidate: boolean;
  selectorTracePath: string | null;
  runDir: string | null;
}

export interface RunTopicCandidateLibraryRealCheckInput {
  request?: TopicCandidateLibraryRealCheckRequest;
  rounds?: number;
  outputDir?: string;
}

export interface RunTopicCandidateLibraryRealCheckResult {
  generatedAt: string;
  projectId: string;
  projectName: string;
  request: TopicCandidateLibraryRealCheckRequest;
  rounds: TopicCandidateLibraryRealCheckRoundResult[];
}

export interface TopicCandidateLibraryRealCheckDependencies {
  sampleRunner?: (input: {
    projectId: string;
    request: TopicCandidateLibraryRealCheckRequest;
    round: number;
  }) => Promise<TopicCandidateLibraryRealCheckRoundResult>;
}

export function buildDefaultChinaTopicCandidateLibraryRequest(): TopicCandidateLibraryRealCheckRequest {
  return {
    canonical_name: "中国古代重大历史事件",
    summary:
      "聚焦中国古代范围内具有强冲突、强反转、强传播潜力的具体历史事件，优先选择能够落到单一事件并兼具戏剧性的题材。",
    core_conflict: "王权、制度、战争、谋略与人性之间的激烈冲突",
    strong_scene: "宫廷博弈、战场决断、朝堂翻盘、边疆危局等强戏剧场景",
    source_hint: "system recommendation",
    recent_usage_hint:
      "近期避免重复高频知名事件，优先扩展不同朝代、不同冲突类型与不同叙事结构。",
    tags: ["china", "ancient-history", "history", "conflict"],
  };
}

export async function runTopicCandidateLibraryRealCheck(
  input: RunTopicCandidateLibraryRealCheckInput = {},
  dependencies: TopicCandidateLibraryRealCheckDependencies = {},
): Promise<RunTopicCandidateLibraryRealCheckResult> {
  const request = input.request ?? buildDefaultChinaTopicCandidateLibraryRequest();
  const rounds = input.rounds ?? 5;
  const outputDir =
    input.outputDir ??
    resolve(
      process.cwd(),
      "harness/scripts/runtime/output/topic-candidate-library-real-check",
    );
  const projectName = `China Topic Candidate Library ${new Date()
    .toISOString()
    .replace(/[.:]/g, "-")}`;

  const app = buildApp();
  const projectResponse = await app.inject({
    method: "POST",
    url: "/api/projects",
    payload: {
      name: projectName,
    },
  });
  const projectId = projectResponse.json().project_id as string;
  const sampleRunner =
    dependencies.sampleRunner ??
    (async ({ projectId, request, round }) => {
      const response = await app.inject({
        method: "POST",
        url: `/api/projects/${projectId}/topic/recommendations`,
        payload: request,
      });
      const body = response.json() as {
        current_round?: {
          round_id?: string;
        };
        candidates?: Array<{
          candidate_id: string;
          event_identity: string;
          title: string;
          one_line_angle: string;
        }>;
        runtime_diagnostics?: {
          checks?: Array<{
            code: string;
          }>;
        };
      };

      const diagnosticCodes = (body.runtime_diagnostics?.checks ?? []).map(
        (entry) => entry.code,
      );

      return {
        round,
        statusCode: response.statusCode,
        runId: body.current_round?.round_id ?? null,
        candidateCount: body.candidates?.length ?? 0,
        candidates: body.candidates ?? [],
        diagnosticCodes,
        fallbackLoaded: diagnosticCodes.includes(
          "topic_candidate_library_fallback_loaded",
        ),
        selectorContainsFallbackCandidate: false,
        selectorTracePath: null,
        runDir: null,
      } satisfies TopicCandidateLibraryRealCheckRoundResult;
    });

  const results: TopicCandidateLibraryRealCheckRoundResult[] = [];

  for (let round = 1; round <= rounds; round += 1) {
    results.push(
      await sampleRunner({
        projectId,
        request,
        round,
      }),
    );
  }

  mkdirSync(outputDir, { recursive: true });

  const summary: RunTopicCandidateLibraryRealCheckResult = {
    generatedAt: new Date().toISOString(),
    projectId,
    projectName,
    request,
    rounds: results,
  };

  writeFileSync(resolve(outputDir, "summary.json"), JSON.stringify(summary, null, 2), "utf8");

  return summary;
}

async function main() {
  const result = await runTopicCandidateLibraryRealCheck();
  process.stdout.write(
    `${JSON.stringify(
      {
        status: "topic-candidate-library-real-check-completed",
        output_dir: resolve(
          process.cwd(),
          "harness/scripts/runtime/output/topic-candidate-library-real-check",
        ),
        project_id: result.projectId,
        rounds: result.rounds.length,
      },
      null,
      2,
    )}\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
