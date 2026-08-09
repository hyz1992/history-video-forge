import {
  appendFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { ProjectRecord } from "../../db/client.js";
import {
  renderLlmInteractionMarkdown,
  renderTraceSectionMarkdown,
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
  assets_runs_dir: string;
  publish_runs_dir: string;
  rename_locked: boolean;
}

type ProjectRunPhase = "topic" | "script" | "storyboard" | "asset_planning" | "assets" | "publish";

const workspaceRoot = resolve(fileURLToPath(new URL("../../../../", import.meta.url)));

export function resolveStorageBaseDir(): string {
  return process.env.STORAGE_ROOT_DIR ? resolve(process.env.STORAGE_ROOT_DIR) : workspaceRoot;
}

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

  const relativeRoot = `storage/projects/${dateSegment}/${input.displayName} [${input.shortId}]`;
  return process.env.STORAGE_ROOT_DIR ? resolve(resolveStorageBaseDir(), relativeRoot) : relativeRoot;
}

/** Build the project storage directory path relative to the workspace root,
 *  without resolving against STORAGE_ROOT_DIR. Used by the hydrator to
 *  reconstruct the on-disk path from persisted DB fields. */
export function buildProjectStorageRelativeDir(input: {
  createdAt: Date;
  displayName: string;
  shortId: string;
}): string {
  const dateSegment = input.createdAt.toISOString().slice(0, 10);
  return `storage/projects/${dateSegment}/${input.displayName} [${input.shortId}]`;
}

function resolveStoragePath(relativePath: string) {
  return isAbsolute(relativePath) ? relativePath : resolve(resolveStorageBaseDir(), relativePath);
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
          : input.phase === "asset_planning"
            ? profile.asset_plan_runs_dir
            : input.phase === "publish"
              ? profile.publish_runs_dir
              : profile.assets_runs_dir;
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
    assets_runs_dir: `${rootDir}/trace/assets-runs`,
    publish_runs_dir: `${rootDir}/trace/publish-runs`,
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
    assets_runs_dir: `${rootDir}/trace/assets-runs`,
    publish_runs_dir: `${rootDir}/trace/publish-runs`,
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
    profile.assets_runs_dir,
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

/**
 * Create an appender that writes to a project-level `trace.md` in the old
 * single-file format. The file is created on first write and appended to
 * on subsequent writes, giving a unified chronological view of all LLM
 * interactions across every pipeline phase.
 */
export interface TraceLogWriter extends LlmInteractionLogWriter {
  writeError(message: string): void;
  writeDiagnostic(label: string, payload: unknown): void;
}

export function createProjectTraceAppender(
  project: ProjectRecord,
): TraceLogWriter {
  const profile = ensureProjectStorageStructure(project);
  const traceFilePath = resolveStoragePath(`${profile.trace_dir}/trace.md`);
  const projectId = profile.display_name
    ? `${profile.display_name} [${profile.short_id}]`
    : project.id;

  let headerWritten = existsSync(traceFilePath);
  const phaseCounter = new Map<string, number>();

  return {
    write(entry) {
      if (!headerWritten) {
        const header = [
          "# StoryForge LLM Trace Log",
          "",
          `- **Project ID**: \`${projectId}\``,
          "",
          "---",
          "",
        ].join("\n");
        writeFileSync(traceFilePath, header, "utf8");
        headerWritten = true;
      }

      const phase = entry.promptStage;
      const count = (phaseCounter.get(phase) ?? 0) + 1;
      phaseCounter.set(phase, count);

      appendFileSync(
        traceFilePath,
        renderTraceSectionMarkdown(entry, count),
        "utf8",
      );
    },

    writeError(message: string) {
      if (!headerWritten) {
        const header = [
          "# StoryForge LLM Trace Log",
          "",
          `- **Project ID**: \`${projectId}\``,
          "",
          "---",
          "",
        ].join("\n");
        writeFileSync(traceFilePath, header, "utf8");
        headerWritten = true;
      }

      const now = new Date().toISOString();
      const lines = [
        "## [Error] 服务层异常",
        "",
        "| Field | Value |",
        "|---|---|",
        `| Time | \`${now}\` |`,
        `| Status | \`error\` |`,
        "",
        "",
        "### 错误信息",
        "",
        "```text",
        message,
        "```",
        "",
        "---",
        "",
      ].join("\n");
      appendFileSync(traceFilePath, lines, "utf8");
    },

    writeDiagnostic(label: string, payload: unknown) {
      if (!headerWritten) {
        const header = [
          "# StoryForge LLM Trace Log",
          "",
          `- **Project ID**: \`${projectId}\``,
          "",
          "---",
          "",
        ].join("\n");
        writeFileSync(traceFilePath, header, "utf8");
        headerWritten = true;
      }

      let serialized: string;
      try {
        serialized = JSON.stringify(payload, null, 2);
      } catch (error) {
        serialized = JSON.stringify({
          serialization_error:
            error instanceof Error ? error.message : String(error),
        }, null, 2);
      }
      appendFileSync(
        traceFilePath,
        [
          "## Service Diagnostic",
          "",
          `- **Label**: \`${label}\``,
          `- **Time**: \`${new Date().toISOString()}\``,
          "",
          "```json",
          serialized,
          "```",
          "",
          "---",
          "",
        ].join("\n"),
        "utf8",
      );
    },
  };
}

/**
 * Create a composite writer that writes to both:
 * 1. Per-run individual `.md` files (existing behaviour)
 * 2. Project-level unified `trace.md` (new behaviour)
 */
export function createCompositeInteractionLogWriter(input: {
  project: ProjectRecord;
  phase: ProjectRunPhase;
  runId: string;
}): TraceLogWriter {
  const fileWriter = createProjectRunInteractionLogWriter(input);
  const traceAppender = createProjectTraceAppender(input.project);

  return {
    write(entry) {
      fileWriter.write(entry);
      traceAppender.write(entry);
    },
    writeError(message: string) {
      traceAppender.writeError(message);
    },
    writeDiagnostic(label: string, payload: unknown) {
      traceAppender.writeDiagnostic(label, payload);
    },
  };
}
