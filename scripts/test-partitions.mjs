import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const vitestCli = join(root, "node_modules", "vitest", "vitest.mjs");
const outputRoot = join(root, ".codex-run-logs", "test-partitions");
const testFilePattern = /\.(?:test|spec)\.(?:ts|tsx|js|mjs)$/;
const ignoredDirectoryNames = new Set([
  ".codex", ".codex-run-logs", ".git", ".playwright-mcp", ".superpowers", "coverage", "dist", "generated",
  "node_modules", "storage", "temp",
]);

const partitions = [
  {
    name: "backend-core",
    matches: (file) => /^tests\/backend\/(?:api|db|http|projects|repositories|runtime)\//.test(file)
      || file === "tests/backend/server-http.test.ts",
  },
  {
    name: "backend-topic-script",
    matches: (file) => /^tests\/backend\/(?:topic|script)\//.test(file),
  },
  {
    name: "backend-video-pipeline",
    matches: (file) => /^tests\/backend\/(?:asset-planning|assets|compose|publish|render|storyboard)\//.test(file),
  },
  { name: "frontend", matches: (file) => file.startsWith("tests/frontend/") },
  {
    name: "harness",
    matches: (file) => file.startsWith("tests/harness/") || file.startsWith("harness/"),
  },
  {
    name: "supporting",
    matches: (file) => /^tests\/(?:renderer|scripts|shared|workspace)\//.test(file)
      || file.startsWith("renderer/"),
  },
];

function listFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory() && ignoredDirectoryNames.has(entry.name)) return [];
    return entry.isDirectory() ? listFiles(path) : [path];
  });
}

function normalize(path) {
  return relative(root, path).replaceAll("\\", "/");
}

function parseSelection() {
  const requested = [];
  for (let index = 2; index < process.argv.length; index += 1) {
    const argument = process.argv[index];
    if (argument.startsWith("--partition=")) requested.push(argument.slice("--partition=".length));
    if (argument === "--partition") {
      const value = process.argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error("test_partition_name_required");
      requested.push(value);
      index += 1;
    }
  }
  if (requested.length === 0) return new Set(partitions.map(({ name }) => name));
  const known = new Set(partitions.map(({ name }) => name));
  const unknown = requested.filter((name) => !known.has(name));
  if (unknown.length > 0) throw new Error(`unknown_test_partitions:${unknown.join(",")}`);
  return new Set(requested);
}

function validateCoverage(files) {
  const violations = files.flatMap((file) => {
    const owners = partitions.filter(({ matches }) => matches(file)).map(({ name }) => name);
    return owners.length === 1 ? [] : [{ file, owners }];
  });
  if (violations.length > 0) {
    throw new Error(`invalid_test_partition_coverage:${JSON.stringify(violations)}`);
  }
}

function failedAssertions(report) {
  return (report.testResults ?? []).flatMap((testFile) => (
    (testFile.assertionResults ?? [])
      .filter((assertion) => assertion.status === "failed")
      .map((assertion) => ({
        file: normalize(testFile.name),
        name: assertion.fullName,
        failure: assertion.failureMessages?.[0] ?? null,
      }))
  ));
}

function runPartition(partition, files, runId) {
  const reportPath = join(outputRoot, `${runId}-${partition.name}.vitest.json`);
  const startedAt = new Date();
  const startedMs = performance.now();
  const result = spawnSync(process.execPath, [
    vitestCli,
    "run",
    ...files,
    "--configLoader",
    "runner",
    "--no-file-parallelism",
    "--reporter=json",
    `--outputFile=${reportPath}`,
  ], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, TEST_PARTITION: partition.name },
    maxBuffer: 64 * 1024 * 1024,
    timeout: 10 * 60 * 1000,
  });
  const durationMs = Math.round(performance.now() - startedMs);
  const report = existsSync(reportPath)
    ? JSON.parse(readFileSync(reportPath, "utf8"))
    : null;
  return {
    partition: partition.name,
    startedAt: startedAt.toISOString(),
    durationMs,
    fileCount: files.length,
    exitCode: result.status,
    signal: result.signal,
    processError: result.error?.message ?? null,
    totalTests: report?.numTotalTests ?? null,
    passedTests: report?.numPassedTests ?? null,
    failedTests: report?.numFailedTests ?? null,
    pendingTests: report?.numPendingTests ?? null,
    failedAssertions: report ? failedAssertions(report) : [],
    reportPath: normalize(reportPath),
    stdout: result.stdout?.trim() || null,
    stderr: result.stderr?.trim() || null,
  };
}

if (!existsSync(vitestCli)) throw new Error("vitest_cli_missing_run_npm_install");
mkdirSync(outputRoot, { recursive: true });

const files = listFiles(root).filter((file) => testFilePattern.test(file)).map(normalize).sort();
validateCoverage(files);
const selection = parseSelection();
const runId = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
const selectedPartitions = partitions.filter(({ name }) => selection.has(name));

if (process.argv.includes("--list")) {
  process.stdout.write(`${JSON.stringify({ totalFiles: files.length, partitions: partitions.map((partition) => ({
    name: partition.name,
    fileCount: files.filter(partition.matches).length,
  })) }, null, 2)}\n`);
  process.exit(0);
}

const results = [];
for (const partition of selectedPartitions) {
  const partitionFiles = files.filter(partition.matches);
  process.stdout.write(`[test-partitions] ${partition.name}: ${partitionFiles.length} files\n`);
  const result = runPartition(partition, partitionFiles, runId);
  results.push(result);
  process.stdout.write(`[test-partitions] ${partition.name}: exit=${result.exitCode} tests=${result.passedTests}/${result.totalTests} duration=${result.durationMs}ms\n`);
}

const summary = {
  runId,
  generatedAt: new Date().toISOString(),
  discoveredFileCount: files.length,
  selectedFileCount: results.reduce((total, result) => total + result.fileCount, 0),
  allFilesCoveredExactlyOnce: true,
  results,
};
const summaryPath = join(outputRoot, `${runId}-summary.json`);
writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
writeFileSync(join(outputRoot, "latest-summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
process.stdout.write(`[test-partitions] summary=${normalize(summaryPath)}\n`);
process.exitCode = results.every((result) => result.exitCode === 0) ? 0 : 1;
