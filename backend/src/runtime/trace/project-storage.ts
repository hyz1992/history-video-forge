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

function isDiagnosticRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatDiagnosticIssuePath(path: unknown): string | undefined {
  if (
    !Array.isArray(path) ||
    !path.every(
      (part) => typeof part === "string" || typeof part === "number",
    )
  ) {
    return undefined;
  }
  if (path.length === 0) return "<root>";
  return path.reduce<string>((formatted, segment) => {
    if (typeof segment === "number") return `${formatted}[${segment}]`;
    return formatted ? `${formatted}.${segment}` : segment;
  }, "");
}

const SAFE_RESILIENCE_EVENT_TYPES = new Set([
  "legacy_chunk_patch_coerced",
  "legacy_chunk_patch_coercion_failed",
  "legacy_audio_timing_canonicalized",
  "legacy_audio_timing_canonicalization_failed",
]);
const SAFE_RESILIENCE_ERROR_CODES = new Set([
  "asset_legacy_chunk_patch_coercion_failed",
  "asset_legacy_audio_timing_rebind_ambiguous",
]);
const SAFE_RESILIENCE_ACTION_TYPES = new Set([
  "single_wrapper_unwrapped",
  "missing_discriminator_defaulted",
  "audio_timing_rebound",
]);
const SAFE_RESILIENCE_PATH_FIELDS = new Set([
  "patch_fields", "dependencies", "depends_on_task_id", "dependency_type",
  "task_id", "tasks", "local_task_id", "local_dependency_id",
  "task_local_id", "depends_on_local_task_id",
]);

function sanitizeResiliencePath(path: unknown): string | undefined {
  const formatted = Array.isArray(path)
    ? formatDiagnosticIssuePath(path.slice(0, 12))
    : typeof path === "string" && path.length <= 256
      ? path
      : undefined;
  if (formatted === undefined || formatted === "<root>") return formatted;
  const parts = formatted.split(/[.\[\]]/u).filter(Boolean);
  if (parts.length > 12) return undefined;
  return parts.every((part) =>
    /^[0-9]{1,6}$/u.test(part) || SAFE_RESILIENCE_PATH_FIELDS.has(part),
  )
    ? formatted
    : "$unknown";
}

export function sanitizeAssetPlanningResilienceDiagnostic(
  payload: unknown,
): Record<string, unknown> {
  if (!isDiagnosticRecord(payload)) {
    return { type: "unknown_resilience_event" };
  }

  const type = typeof payload.type === "string" &&
      SAFE_RESILIENCE_EVENT_TYPES.has(payload.type)
    ? payload.type
    : "unknown_resilience_event";
  const result: Record<string, unknown> = { type };
  if (typeof payload.error_code === "string" &&
      SAFE_RESILIENCE_ERROR_CODES.has(payload.error_code)) {
    result.error_code = payload.error_code;
  }

  const rawActionTypes = Array.isArray(payload.actions)
    ? payload.actions.flatMap((action) =>
      isDiagnosticRecord(action) && typeof action.type === "string"
        ? [action.type]
        : [])
    : Array.isArray(payload.action_types)
      ? payload.action_types.filter((action): action is string =>
          typeof action === "string")
      : [];
  const actionTypes = rawActionTypes.filter((action) =>
    SAFE_RESILIENCE_ACTION_TYPES.has(action));
  if (rawActionTypes.length > 0 || Number.isSafeInteger(payload.action_count)) {
    result.action_types = [...new Set(actionTypes)].sort().slice(0, 20);
    result.action_count = Array.isArray(payload.actions)
      ? payload.actions.length
      : Math.min(Math.max(Number(payload.action_count), 0), 1_000_000);
  }

  const rawIssuePaths = Array.isArray(payload.issues)
    ? payload.issues.flatMap((issue) => {
      if (!isDiagnosticRecord(issue)) return [];
      const path = sanitizeResiliencePath(issue.path);
      return path === undefined ? [] : [path];
    })
    : Array.isArray(payload.issue_paths)
      ? payload.issue_paths.flatMap((path) => {
          const sanitized = sanitizeResiliencePath(path);
          return sanitized === undefined ? [] : [sanitized];
        })
      : [];
  if (Array.isArray(payload.issues) || Number.isSafeInteger(payload.issue_count)) {
    result.issue_count = Array.isArray(payload.issues)
      ? payload.issues.length
      : Math.min(Math.max(Number(payload.issue_count), 0), 1_000_000);
    result.issue_paths = [...new Set(rawIssuePaths)].sort().slice(0, 20);
    result.issues_truncated = payload.issues_truncated === true || rawIssuePaths.length > 20;
  }

  return result;
}

const SAFE_GLOBAL_STRUCTURE_EVENT_TYPES = new Set([
  "normalization_applied", "repair_started", "repair_succeeded",
  "repair_failed", "repair_provider_failed",
]);
const SAFE_GLOBAL_STRUCTURE_ACTION_TYPES = new Set([
  "default_inserted", "forbidden_chunk_key_removed",
]);
const SAFE_GLOBAL_STRUCTURE_PATH_FIELDS = new Set([
  "plan_version", "characters", "locations", "visual_rules", "audio_rules",
  "visual_style", "continuity_rules", "negative_constraints", "bgm_plan",
  "global_ambience", "global_sfx_policy", "art_bible", "props",
  "consistency_notes", "tasks", "risk_notes", "dependencies", "budget_notes",
  "chunk_id",
]);

function sanitizeGlobalStructurePath(path: unknown): string | undefined {
  const rawParts = Array.isArray(path)
    ? path.slice(0, 12)
    : typeof path === "string" && path.length <= 256
      ? path.match(/[^.\[\]]+|\d+/gu)?.slice(0, 12)
      : undefined;
  if (!rawParts) return undefined;
  if (rawParts.length === 0) return "<root>";
  const safeParts = rawParts.map((part) => {
    if (typeof part === "number") {
      return Number.isSafeInteger(part) && part >= 0 ? part : "$index";
    }
    if (/^\d{1,6}$/u.test(part)) return Number(part);
    return SAFE_GLOBAL_STRUCTURE_PATH_FIELDS.has(part) ? part : "$unknown";
  });
  return formatDiagnosticIssuePath(safeParts);
}

function sanitizeGlobalStructureIssues(payload: Record<string, unknown>) {
  const rawCollections = [
    payload.issues,
    payload.initial_issues,
    payload.patch_issues,
    payload.final_issues,
  ].filter(Array.isArray) as unknown[][];
  const rawIssues = rawCollections.flat();
  const paths = rawIssues.length > 0
    ? rawIssues.flatMap((issue) => {
        if (!isDiagnosticRecord(issue)) return [];
        const path = sanitizeGlobalStructurePath(issue.path);
        return path === undefined ? [] : [path];
      })
    : Array.isArray(payload.issue_paths)
      ? payload.issue_paths.flatMap((path) => {
          const sanitized = sanitizeGlobalStructurePath(path);
          return sanitized === undefined ? [] : [sanitized];
        })
      : [];
  const uniquePaths = [...new Set(paths)].sort();
  const issueCount = rawIssues.length > 0
    ? rawIssues.length
    : Number.isSafeInteger(payload.issue_count) && Number(payload.issue_count) >= 0
      ? Math.min(Number(payload.issue_count), 1_000_000)
      : 0;
  return {
    issue_count: issueCount,
    issue_paths: uniquePaths.slice(0, 20),
    issues_truncated: payload.issues_truncated === true || uniquePaths.length > 20,
  };
}

export function sanitizeAssetPlanningGlobalStructureDiagnostic(
  payload: unknown,
): Record<string, unknown> {
  if (!isDiagnosticRecord(payload) ||
      typeof payload.type !== "string" ||
      !SAFE_GLOBAL_STRUCTURE_EVENT_TYPES.has(payload.type)) {
    return { type: "unknown_global_structure_event" };
  }
  const type = payload.type;
  if (type === "repair_succeeded") return { type };
  if (type === "repair_provider_failed") {
    return {
      type,
      error_code: "asset_global_structural_repair_provider_failed",
    };
  }
  if (type === "normalization_applied") {
    const rawActions = Array.isArray(payload.actions) ? payload.actions : [];
    const rawTypes = rawActions.length > 0
      ? rawActions.flatMap((action) =>
          isDiagnosticRecord(action) && typeof action.type === "string"
            ? [action.type]
            : [])
      : Array.isArray(payload.action_types)
        ? payload.action_types.filter((value): value is string =>
            typeof value === "string")
        : [];
    const rawPaths = rawActions.length > 0
      ? rawActions.flatMap((action) => {
          if (!isDiagnosticRecord(action)) return [];
          const path = sanitizeGlobalStructurePath(action.path);
          return path === undefined ? [] : [path];
        })
      : Array.isArray(payload.action_paths)
        ? payload.action_paths.flatMap((path) => {
            const sanitized = sanitizeGlobalStructurePath(path);
            return sanitized === undefined ? [] : [sanitized];
          })
        : [];
    const actionPaths = [...new Set(rawPaths)].sort();
    return {
      type,
      action_count: rawActions.length > 0
        ? rawActions.length
        : Number.isSafeInteger(payload.action_count) && Number(payload.action_count) >= 0
          ? Math.min(Number(payload.action_count), 1_000_000)
          : 0,
      action_types: [...new Set(rawTypes.filter((value) =>
        SAFE_GLOBAL_STRUCTURE_ACTION_TYPES.has(value)))].sort().slice(0, 20),
      action_paths: actionPaths.slice(0, 20),
      actions_truncated: payload.actions_truncated === true || actionPaths.length > 20,
    };
  }
  return { type, ...sanitizeGlobalStructureIssues(payload) };
}

const SAFE_INTENT_CHUNK_STATUSES = new Set([
  "queued", "running", "generated", "repaired", "regenerated", "compiled", "failed",
]);
const SAFE_INTENT_CHUNK_STAGES = new Set([
  "queued", "running", "generated", "repaired", "regenerated", "compiled",
]);
const SAFE_INTENT_FAILURE_CLASSES = new Set(["llm_output", "provider", "business"]);
const SAFE_INTENT_COMPILER_ACTIONS = new Set([
  "visual_strategy_applied",
  "global_bgm_owner_bound",
]);
const SAFE_INTENT_ROUTES = new Set(["api_video", "remotion"]);

/** resolver 的 reason_code 结构化白名单：枚举值或 strategy_matrix_* / segment_override_* / provider 降级。 */
const SAFE_INTENT_ROUTE_REASON_CODES = new Set([
  "strategy_matrix_api_video",
  "strategy_matrix_remotion",
  "segment_override_api_video",
  "segment_override_remotion",
  "api_video_provider_disabled",
]);
const SAFE_INTENT_FAILURE_CODES = new Set([
  "asset_segment_intent_invalid",
  "asset_chunk_plan_schema_invalid",
  "asset_chunk_forbidden_task_type_violated",
  "asset_chunk_task_segment_out_of_scope_violated",
  "asset_chunk_support_image_reason_missing_violated",
  "asset_chunk_anchor_image_budget_exceeded_violated",
  "asset_chunk_dependency_local_id_missing_violated",
  "intent_chunk_business_failed",
  "content_filter",
  "configuration",
  "rate_limited",
  "timeout",
  "network",
  "invalid_request",
  "invalid_response",
  "service_unavailable",
  "budget_exceeded",
  "unknown",
]);
const SAFE_INTENT_DIAGNOSTIC_PATH_FIELDS = new Set([
  "$unknown", "planning_mode", "segments", "source_segment_id", "intents",
  "asset_kind", "production_intent", "image_prompt", "video_prompt_reserve",
  "image_role", "support_reason", "risk_notes", "video_prompt",
  "why_static_insufficient", "required_tags", "mood_tags", "selection_label",
  "timing_basis", "scope", "segment_ids", "volume", "fade_in_sec",
  "fade_out_sec", "budget_notes",
]);

function isSafeIntentDiagnosticPath(path: string): boolean {
  if (path.length === 0 || path.length > 256) return false;
  const parts = path.split(/[.\[\]]/u).filter(Boolean);
  return parts.length <= 12 && parts.every((part) =>
    /^[0-9]{1,6}$/u.test(part) || SAFE_INTENT_DIAGNOSTIC_PATH_FIELDS.has(part),
  );
}

function boundedDiagnosticCount(value: unknown): number {
  return Number.isSafeInteger(value) && Number(value) >= 0
    ? Math.min(Number(value), 1_000_000)
    : 0;
}

export function sanitizeAssetPlanningIntentChunkDiagnostic(
  payload: unknown,
): Record<string, unknown> {
  const rawChunks = isDiagnosticRecord(payload) && Array.isArray(payload.chunks)
    ? payload.chunks
    : [];
  const chunks = rawChunks.slice(0, 100).flatMap((rawChunk) => {
    if (!isDiagnosticRecord(rawChunk)) return [];
    const chunkId = typeof rawChunk.chunk_id === "string" &&
      /^chunk_[0-9]{3,6}$/u.test(rawChunk.chunk_id)
      ? rawChunk.chunk_id
      : null;
    const chunkIndex = Number.isSafeInteger(rawChunk.chunk_index) &&
      Number(rawChunk.chunk_index) >= 0 && Number(rawChunk.chunk_index) < 100_000
      ? Number(rawChunk.chunk_index)
      : null;
    if (chunkId === null || chunkIndex === null) return [];
    const status = typeof rawChunk.status === "string" &&
      SAFE_INTENT_CHUNK_STATUSES.has(rawChunk.status)
      ? rawChunk.status
      : "failed";
    const stage = typeof rawChunk.stage === "string" &&
      SAFE_INTENT_CHUNK_STAGES.has(rawChunk.stage)
      ? rawChunk.stage
      : "generated";
    const accounting = isDiagnosticRecord(rawChunk.accounting)
      ? rawChunk.accounting
      : {};
    const logicalInvocation = boundedDiagnosticCount(accounting.logical_invocation);
    const safetyInvocation = boundedDiagnosticCount(accounting.safety_invocation);
    const compilerActions = Array.isArray(rawChunk.compiler_actions)
      ? [...new Set(rawChunk.compiler_actions.flatMap((code) =>
          typeof code === "string" && SAFE_INTENT_COMPILER_ACTIONS.has(code)
            ? [code]
            : [],
        ))].sort()
      : [];
    const issuePaths = Array.isArray(rawChunk.issue_paths)
      ? [...new Set(rawChunk.issue_paths.flatMap((path) =>
          typeof path === "string" &&
          isSafeIntentDiagnosticPath(path)
            ? [path]
            : [],
        ))].sort().slice(0, 20)
      : [];
    const visualRouteDecisions = Array.isArray(rawChunk.visual_route_decisions)
      ? rawChunk.visual_route_decisions.slice(0, 50).flatMap((entry) => {
          if (!isDiagnosticRecord(entry)) return [];
          const segmentId = typeof entry.segment_id === "string" &&
            /^[A-Za-z0-9_\-]{1,64}$/u.test(entry.segment_id)
            ? entry.segment_id
            : null;
          const route =
            typeof entry.route === "string" && SAFE_INTENT_ROUTES.has(entry.route)
              ? entry.route
              : null;
          const reasonCode = typeof entry.reason_code === "string" &&
            SAFE_INTENT_ROUTE_REASON_CODES.has(entry.reason_code)
            ? entry.reason_code
            : null;
          return segmentId && route && reasonCode
            ? [{ segment_id: segmentId, route, reason_code: reasonCode }]
            : [];
        })
      : [];
    return [{
      chunk_id: chunkId,
      chunk_index: chunkIndex,
      status,
      stage,
      accounting: {
        business_slot: boundedDiagnosticCount(accounting.business_slot),
        business_invocation: Math.max(0, logicalInvocation - safetyInvocation),
        logical_invocation: logicalInvocation,
        safety_invocation: safetyInvocation,
        provider_attempts: boundedDiagnosticCount(accounting.provider_attempts),
        network_request_count: boundedDiagnosticCount(accounting.network_request_count),
      },
      compiler_actions: compilerActions,
      visual_route_decisions: visualRouteDecisions,
      issue_paths: issuePaths,
      ...(typeof rawChunk.error_code === "string" || status === "failed"
        ? {
            error_code:
              typeof rawChunk.error_code === "string" &&
              SAFE_INTENT_FAILURE_CODES.has(rawChunk.error_code)
                ? rawChunk.error_code
                : "intent_chunk_business_failed",
          }
        : {}),
      ...(typeof rawChunk.failure_class === "string" &&
        SAFE_INTENT_FAILURE_CLASSES.has(rawChunk.failure_class)
        ? { failure_class: rawChunk.failure_class }
        : {}),
    }];
  });
  const statusCounts = Object.fromEntries(
    [...SAFE_INTENT_CHUNK_STATUSES]
      .map((status) => [status, chunks.filter((chunk) => chunk.status === status).length])
      .filter(([, count]) => Number(count) > 0),
  );
  const startedFailureCount = chunks.filter((chunk) => chunk.status === "failed").length;
  return {
    chunk_count: chunks.length,
    chunks,
    status_counts: statusCounts,
    started_failure_count: startedFailureCount,
    attached_failure_count: Math.max(0, startedFailureCount - 1),
    chunks_truncated: rawChunks.length > 100,
  };
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
        const diagnosticPayload =
          label === "asset-planning.resilience"
            ? sanitizeAssetPlanningResilienceDiagnostic(payload)
            : label === "asset-planning.global-structure"
              ? sanitizeAssetPlanningGlobalStructureDiagnostic(payload)
            : label === "asset-planning.intent-chunks"
              ? sanitizeAssetPlanningIntentChunkDiagnostic(payload)
            : payload;
        const candidate = JSON.stringify(diagnosticPayload, null, 2);
        serialized = candidate ?? JSON.stringify({
          serialization_error: "unsupported_top_level_value",
          value_type: typeof payload,
        }, null, 2);
      } catch {
        serialized = JSON.stringify({
          serialization_error: "diagnostic_serialization_failed",
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
