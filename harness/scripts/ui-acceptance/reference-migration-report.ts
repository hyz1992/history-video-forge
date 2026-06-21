import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { cwd } from "node:process";

const OUTPUT_ROOT = resolve(cwd(), "harness/scripts/runtime/output/ui-reference-migration");

function findLatestRunId(): string | null {
  if (!existsSync(OUTPUT_ROOT)) {
    return null;
  }

  const entries = readdirSync(OUTPUT_ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith("run-"))
    .map((e) => e.name)
    .sort()
    .reverse();

  return entries[0] ?? null;
}

function findRunDir(runId: string): string {
  const runDir = join(OUTPUT_ROOT, runId);
  if (!existsSync(runDir)) {
    throw new Error(`找不到 run 目录: ${runDir}`);
  }
  return runDir;
}

function main() {
  const args = process.argv.slice(2);
  const runIdFlag = args.indexOf("--run-id");
  const runId = runIdFlag >= 0 ? args[runIdFlag + 1] : null;

  let runDir: string;

  if (runId) {
    runDir = findRunDir(runId);
  } else {
    const latestRunId = findLatestRunId();
    if (!latestRunId) {
      console.error("找不到任何 reference migration 报告。");
      console.error("请先运行: npm run harness:ui-reference-migration");
      process.exit(1);
    }
    runDir = join(OUTPUT_ROOT, latestRunId);
  }

  const summaryMdPath = join(runDir, "summary.md");
  if (!existsSync(summaryMdPath)) {
    console.error(`找不到 summary.md: ${summaryMdPath}`);
    process.exit(1);
  }

  const content = readFileSync(summaryMdPath, "utf8");
  console.log(content);
}

main();
