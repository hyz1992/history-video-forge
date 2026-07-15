import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

interface SampleCase {
  id: string;
  operation: string;
  description: string;
  input: Record<string, unknown>;
}

interface RuntimeReport {
  generatedAt: string;
  live: boolean;
  candidateModel?: string;
  totalSamples: number;
  totalRequests: number;
  results: Array<{
    sampleId: string;
    operation: string;
    status: "dry_run" | "pending";
    estimatedRequests: number;
  }>;
  constraints: {
    maxRequests: number;
    maxCostCny: number;
    ttft: string;
    costEnforcement: string;
  };
}

function parseArgs(args: string[]): {
  dryRun: boolean;
  live: boolean;
  candidateModel?: string;
  maxRequests?: number;
  maxCostCny?: number;
} {
  const live = args.includes("--live");
  const dryRun = args.includes("--dry-run") || !live;

  const candidateModelIndex = args.indexOf("--candidate-model");
  const candidateModel =
    candidateModelIndex >= 0 ? args[candidateModelIndex + 1] : undefined;

  const maxRequestsIndex = args.indexOf("--max-requests");
  const maxRequests =
    maxRequestsIndex >= 0 ? Number(args[maxRequestsIndex + 1]) : undefined;

  const maxCostCnyIndex = args.indexOf("--max-cost-cny");
  const maxCostCny =
    maxCostCnyIndex >= 0 ? Number(args[maxCostCnyIndex + 1]) : undefined;

  return { dryRun, live, candidateModel, maxRequests, maxCostCny };
}

export function validateLiveOptions(args: ReturnType<typeof parseArgs>): string[] {
  const errors: string[] = [];

  if (!args.live) return errors;

  if (!args.candidateModel) {
    errors.push("--live 需要 --candidate-model <model-id>");
  }
  if (args.maxRequests === undefined) {
    errors.push("--live 需要 --max-requests <N>");
  }
  if (args.maxCostCny === undefined) {
    errors.push("--live 需要 --max-cost-cny <金额>");
  }
  if (args.maxRequests !== undefined && args.maxRequests > 8) {
    errors.push("--max-requests 不得超过 8");
  }

  return errors;
}

export function buildReport(
  manifest: SampleCase[],
  args: ReturnType<typeof parseArgs>,
): RuntimeReport {
  const totalRequests = args.live
    ? manifest.length
    : 0;

  return {
    generatedAt: new Date().toISOString(),
    live: args.live,
    candidateModel: args.candidateModel,
    totalSamples: manifest.length,
    totalRequests,
    results: manifest.map((c) => ({
      sampleId: c.id,
      operation: c.operation,
      status: args.live ? ("pending" as const) : ("dry_run" as const),
      estimatedRequests: args.live ? 1 : 0,
    })),
    constraints: {
      maxRequests: args.live ? (args.maxRequests ?? 8) : 0,
      maxCostCny: args.live ? (args.maxCostCny ?? 0) : 0,
      ttft: "unobservable_non_streaming",
      costEnforcement: "unavailable",
    },
  };
}

function getOutputDir(): string {
  const now = new Date();
  const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return resolve(
    process.cwd(),
    "harness",
    "scripts",
    "runtime",
    "output",
    "llm-s2-baseline",
    ts,
  );
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function loadManifest(manifestPath?: string): SampleCase[] {
  const path = manifestPath
    ? resolve(manifestPath)
    : resolve(
        process.cwd(),
        "harness",
        "samples",
        "llm-s2-baseline",
        "manifest.json",
      );

  if (!existsSync(path)) {
    throw new Error(`manifest not found: ${path}`);
  }

  const raw = readFileSync(path, "utf-8");
  return JSON.parse(raw) as SampleCase[];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.live) {
    const errors = validateLiveOptions(args);
    if (errors.length > 0) {
      console.error("live 模式参数不足：");
      for (const err of errors) {
        console.error(`  ${err}`);
      }
      process.exit(1);
    }
  }

  const manifest = loadManifest();
  const report = buildReport(manifest, args);

  const outputDir = getOutputDir();
  mkdirSync(outputDir, { recursive: true });

  const reportPath = resolve(outputDir, "baseline-report.json");
  writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf-8");

  console.log(
    JSON.stringify(
      {
        report_path: reportPath,
        summary: {
          live: report.live,
          candidate_model: report.candidateModel ?? "none",
          total_samples: report.totalSamples,
          total_requests: report.totalRequests,
          max_requests: report.constraints.maxRequests,
          max_cost_cny: report.constraints.maxCostCny,
          ttft: report.constraints.ttft,
          cost_enforcement: report.constraints.costEnforcement,
        },
        samples: report.results.map((r) => ({
          sample_id: r.sampleId,
          operation: r.operation,
          status: r.status,
          estimated_requests: r.estimatedRequests,
        })),
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error("llm-s2-baseline 失败:", err.message);
  process.exit(1);
});
