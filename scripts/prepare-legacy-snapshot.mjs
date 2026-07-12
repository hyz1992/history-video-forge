import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const args = process.argv.slice(2);
const value = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};
const source = value("--source");
const output = value("--output");
if (!source || !output || !args.includes("--confirm")) {
  throw new Error("usage: prepare-legacy-snapshot --source <snapshot> --output <snapshot> --confirm");
}

const document = JSON.parse(readFileSync(resolve(source), "utf8"));
const projectIds = new Set((document.projects ?? []).map(([id]) => id));
const removed = {};
const projectScoped = [
  "topicPackages", "candidateCache", "scriptRecords", "storyboardRecords", "assetPlanRecords",
  "assetManifestRecords", "composeRecords", "renderJobRecords", "publishPackageRecords",
];
for (const collection of projectScoped) {
  const before = document[collection] ?? [];
  document[collection] = before.filter(([, record]) => !record?.projectId || projectIds.has(record.projectId));
  removed[`${collection}_orphan_projects`] = before.length - document[collection].length;
}

const uniqueCandidates = new Map();
for (const entry of document.candidateCache ?? []) {
  const record = entry[1];
  const key = `${record?.projectId ?? ""}\u0000${record?.fingerprint ?? entry[0]}`;
  if (!uniqueCandidates.has(key)) uniqueCandidates.set(key, entry);
}
removed.candidateCache_duplicate_fingerprints = (document.candidateCache ?? []).length - uniqueCandidates.size;
document.candidateCache = [...uniqueCandidates.values()];

const activeTargets = {
  activeTopicPackageId: "topicPackages",
  activeScriptRecordId: "scriptRecords",
  activeStoryboardRecordId: "storyboardRecords",
  activeAssetPlanRecordId: "assetPlanRecords",
  activeAssetManifestRecordId: "assetManifestRecords",
  activeComposeRecordId: "composeRecords",
  activeRenderJobRecordId: "renderJobRecords",
  activePublishPackageRecordId: "publishPackageRecords",
};
let clearedActiveReferences = 0;
for (const [, project] of document.projects ?? []) {
  for (const [field, collection] of Object.entries(activeTargets)) {
    if (!project?.[field]) continue;
    const ids = new Set((document[collection] ?? []).map(([id]) => id));
    if (!ids.has(project[field])) {
      project[field] = null;
      clearedActiveReferences += 1;
    }
  }
}
removed.cleared_active_references = clearedActiveReferences;

const rounds = document.recommendationRounds ?? [];
document.recommendationRounds = rounds.filter(([projectId]) => projectIds.has(projectId));
removed.recommendationRounds_orphan_projects = rounds.length - document.recommendationRounds.length;
document.topicRunCounts = (document.topicRunCounts ?? []).filter(([projectId]) => projectIds.has(projectId));
document.topicCandidateStore = Object.fromEntries(
  Object.entries(document.topicCandidateStore ?? {}).filter(([projectId]) => projectIds.has(projectId)),
);

const outputPath = resolve(output);
const temporaryPath = `${outputPath}.tmp`;
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
renameSync(temporaryPath, outputPath);
console.log(JSON.stringify({ status: "legacy_snapshot_prepared", source: resolve(source), output: outputPath, removed }, null, 2));
