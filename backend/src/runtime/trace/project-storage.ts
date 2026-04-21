import type { ProjectRecord } from "../../db/client.js";

export interface ProjectStorageProfile {
  display_name: string;
  short_id: string;
  root_dir: string;
  trace_dir: string;
  topic_runs_dir: string;
  script_runs_dir: string;
  rename_locked: boolean;
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

  return `storage/projects/${dateSegment}/${input.displayName} [${input.shortId}]`;
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
    return getProjectStorageProfile(project);
  }

  const displayName = sanitizeProjectDisplayName(confirmedProjectName);
  project.storageDisplayName = displayName;
  project.storageRootDir = buildProjectRootDir({
    createdAt: project.createdAt,
    displayName,
    shortId: project.storageShortId || buildProjectShortId(project.id),
  });
  project.storageRenameLocked = true;

  return getProjectStorageProfile(project);
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
    rename_locked: project.storageRenameLocked,
  };
}
