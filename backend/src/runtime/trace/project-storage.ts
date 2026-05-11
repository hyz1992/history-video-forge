import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { ProjectRecord } from "../../db/client.js";
import {
  renderLlmInteractionMarkdown,
  type LlmInteractionLogWriter,
} from "../llm/interaction-log.js";

export interface ProjectStorageProfile {
  display_name: string;
  short_id: string;
  root_dir: string;
  trace_dir: string;
  topic_runs_dir: string;
  script_runs_dir: string;
  storyboard_runs_dir: string;
  asset_plan_runs_dir: string;
  rename_locked: boolean;
}

type ProjectRunPhase = "topic" | "script" | "storyboard" | "asset_planning";

const workspaceRoot = resolve(fileURLToPath(new URL("../../../../", import.meta.url)));

function sanitizeProjectDisplayName(name: string): string {
  const sanitized = name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return sanitized || "untitled-project";
}

function buildProjectShortId(projectId: string): string {
  const compact = projectId.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  const shortBody = (compact.slice(0, 8) || "00000000").padEnd(8, "0");

  return `p_${shortBody}`;
}

function buildProjectRootDir(input: {
  createdAt: Date;
  displayName: string;
  shortId: string;
}): string {
  const dateSegment = input.createdAt.toISOString().slice(0, 10);

  return `storage/projects/${dateSegment}/${input.displayName} [${input.shortId}]`;
}

function resolveStoragePath(relativePath: string) {
  return resolve(workspaceRoot, relativePath);
}

function writeJsonFile(filePath: string, payload: unknown) {
  mkdirSync(dirname(filePath), {
    recursive: true,
  });
  writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
}

function ensureRunDir(input: {
  project: ProjectRecord;
  phase: ProjectRunPhase;
  runId: string;
}) {
  const profile = ensureProjectStorageStructure(input.project);
  const runRootDir =
    input.phase === "topic"
      ? profile.topic_runs_dir
      : input.phase === "script"
        ? profile.script_runs_dir
        : input.phase === "storyboard"
          ? profile.storyboard_runs_dir
          : profile.asset_plan_runs_dir;
  const runDir = resolveStoragePath(`${runRootDir}/${input.runId}`);

  mkdirSync(runDir, {
    recursive: true,
  });

  return runDir;
}

export function createProjectStorageProfile(input: {
  projectId: string;
  projectName: string;
  createdAt: Date;
  renameLocked?: boolean;
}): ProjectStorageProfile {
  const displayName = sanitizeProjectDisplayName(input.projectName);
  const shortId = buildProjectShortId(input.projectId);
  const rootDir = buildProjectRootDir({
    createdAt: input.createdAt,
    displayName,
    shortId,
  });

  return {
    display_name: displayName,
    short_id: shortId,
    root_dir: rootDir,
    trace_dir: `${rootDir}/trace`,
    topic_runs_dir: `${rootDir}/trace/topic-runs`,
    script_runs_dir: `${rootDir}/trace/script-runs`,
    storyboard_runs_dir: `${rootDir}/trace/storyboard-runs`,
    asset_plan_runs_dir: `${rootDir}/trace/asset-planning-runs`,
    rename_locked: input.renameLocked ?? false,
  };
}

export function initializeProjectStorage(project: ProjectRecord): ProjectStorageProfile {
  const profile = createProjectStorageProfile({
    projectId: project.id,
    projectName: project.name,
    createdAt: project.createdAt,
    renameLocked: false,
  });

  project.storageDisplayName = profile.display_name;
  project.storageShortId = profile.short_id;
  project.storageRootDir = profile.root_dir;
  project.storageRenameLocked = false;

  return profile;
}

export function migrateProjectStorageOnTopicConfirm(
  project: ProjectRecord,
  confirmedProjectName: string,
): ProjectStorageProfile {
  if (project.storageRenameLocked) {
    const lockedProfile = getProjectStorageProfile(project);
    ensureProjectStorageStructure(project);
    return lockedProfile;
  }

  const previousProfile = getProjectStorageProfile(project);
  const displayName = sanitizeProjectDisplayName(confirmedProjectName);
  project.storageDisplayName = displayName;
  project.storageRootDir = buildProjectRootDir({
    createdAt: project.createdAt,
    displayName,
    shortId: project.storageShortId || buildProjectShortId(project.id),
  });
  project.storageRenameLocked = true;

  const nextProfile = getProjectStorageProfile(project);
  const previousRootDir = resolveStoragePath(previousProfile.root_dir);
  const nextRootDir = resolveStoragePath(nextProfile.root_dir);

  if (previousRootDir !== nextRootDir && existsSync(previousRootDir)) {
    mkdirSync(dirname(nextRootDir), {
      recursive: true,
    });
    if (!existsSync(nextRootDir)) {
      renameSync(previousRootDir, nextRootDir);
    }
  }

  ensureProjectStorageStructure(project);

  return nextProfile;
}

export function getProjectStorageProfile(project: ProjectRecord): ProjectStorageProfile {
  const fallback = createProjectStorageProfile({
    projectId: project.id,
    projectName: project.name,
    createdAt: project.createdAt,
    renameLocked: project.storageRenameLocked,
  });
  const rootDir = project.storageRootDir || fallback.root_dir;
  const displayName = project.storageDisplayName || fallback.display_name;
  const shortId = project.storageShortId || fallback.short_id;

  return {
    display_name: displayName,
    short_id: shortId,
    root_dir: rootDir,
    trace_dir: `${rootDir}/trace`,
    topic_runs_dir: `${rootDir}/trace/topic-runs`,
    script_runs_dir: `${rootDir}/trace/script-runs`,
    storyboard_runs_dir: `${rootDir}/trace/storyboard-runs`,
    asset_plan_runs_dir: `${rootDir}/trace/asset-planning-runs`,
    rename_locked: project.storageRenameLocked,
  };
}

export function ensureProjectStorageStructure(project: ProjectRecord) {
  const profile = getProjectStorageProfile(project);

  for (const directoryPath of [
    profile.root_dir,
    profile.trace_dir,
    profile.topic_runs_dir,
    profile.script_runs_dir,
    profile.storyboard_runs_dir,
    profile.asset_plan_runs_dir,
  ]) {
    mkdirSync(resolveStoragePath(directoryPath), {
      recursive: true,
    });
  }

  return profile;
}

export function persistProjectRunArtifacts(input: {
  project: ProjectRecord;
  phase: ProjectRunPhase;
  runId: string;
  traceSummary: Record<string, unknown>;
  runtimeDiagnostics?: Record<string, unknown> | null;
}) {
  const runDir = ensureRunDir(input);
  writeJsonFile(resolve(runDir, "graph-trace-summary.json"), input.traceSummary);

  if (input.runtimeDiagnostics) {
    writeJsonFile(resolve(runDir, "runtime-diagnostics.json"), input.runtimeDiagnostics);
  }

  return runDir;
}

export function createProjectRunInteractionLogWriter(input: {
  project: ProjectRecord;
  phase: ProjectRunPhase;
  runId: string;
}): LlmInteractionLogWriter {
  const runDir = ensureRunDir(input);
  const interactionsDir = resolve(runDir, "llm-interactions");
  mkdirSync(interactionsDir, {
    recursive: true,
  });

  let index = 0;

  return {
    write(entry) {
      index += 1;
      const filename = `${String(index).padStart(2, "0")}-${sanitizeSlug(entry.operationName)}.md`;
      writeFileSync(
        resolve(interactionsDir, filename),
        renderLlmInteractionMarkdown({
          ...entry,
          sequence: index,
        }),
        "utf8",
      );
    },
  };
}

function sanitizeSlug(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-");
}
