import { isProxy } from "node:util/types";

import type { AssetPlan, NarrationVisualRange, ResolvedVisualRoute, StoryboardPlan } from "../../../../shared/src/index.js";
import {
  SegmentAssetIntentBatchDraft,
  SegmentAssetIntentKind,
  SegmentIntentRepairPatch,
  type SegmentIntentIssue,
} from "./segment-asset-intent.js";

export const SEGMENT_INTENT_PLANNER_OUTPUT_SCHEMA =
  SegmentAssetIntentBatchDraft;
export const SEGMENT_INTENT_REPAIR_OUTPUT_SCHEMA = SegmentIntentRepairPatch;

/**
 * S2-2A 任务 5：prompt 专用分镜段投影（Prompt Segment DTO）。
 * 只保留 resolved route 与视觉叙事字段，剔除 api_video_suitability 等
 * 上游解析字段——LLM 不得看到或解释适配度，路线只由 resolver 决定。
 */
export type SegmentIntentPromptSegment = Pick<
  StoryboardPlan["segments"][number],
  | "segment_id"
  | "order"
  | "script_excerpt"
  | "narrative_role"
  | "visual_intent"
  | "scene_description"
  | "visual_elements"
  | "framing_hint"
  | "content_type"
  | "motion_hint"
  | "editing_hint"
  | "on_screen_text"
  | "risk_notes"
> & Partial<NarrationVisualRange> & {
  resolved_visual_route: ResolvedVisualRoute;
};

/**
 * 机械投影：把 StoryboardPlan 段映射为 prompt 段 DTO。
 * routes 必须与 segments 一一对应（调用方先校验），缺失时抛错而不是静默降级。
 */
export function projectSegmentIntentPromptSegments(
  segments: StoryboardPlan["segments"],
  routes: ReadonlyMap<string, ResolvedVisualRoute>,
): SegmentIntentPromptSegment[] {
  return segments.map((segment) => {
    const route = routes.get(segment.segment_id);
    if (!route) {
      throw new Error("segment_routes 缺少分段路线");
    }
    return {
      ...("start_boundary_id" in segment ? { start_boundary_id: segment.start_boundary_id, end_boundary_id: segment.end_boundary_id, source_start: segment.source_start, source_end: segment.source_end, visual_start_ms: segment.visual_start_ms, visual_end_ms: segment.visual_end_ms } : {}),
      segment_id: segment.segment_id,
      order: segment.order,
      script_excerpt: segment.script_excerpt,
      narrative_role: segment.narrative_role,
      visual_intent: segment.visual_intent,
      scene_description: segment.scene_description,
      visual_elements: segment.visual_elements,
      framing_hint: segment.framing_hint,
      content_type: segment.content_type,
      motion_hint: segment.motion_hint,
      editing_hint: segment.editing_hint,
      on_screen_text: segment.on_screen_text,
      risk_notes: segment.risk_notes,
      resolved_visual_route: route,
    };
  });
}

export interface SegmentIntentPlannerInput {
  chunk_id: string;
  is_first_chunk: boolean;
  segments: SegmentIntentPromptSegment[];
  /**
   * S2-2A 任务 5：resolver 输出的每段最终视觉路线（机械编排输入）。
   * LLM 只按该路线规划意图，不得自行增删 API 视频。
   */
  segment_routes: Array<{ segment_id: string; resolved_route: ResolvedVisualRoute }>;
  art_bible: AssetPlan["art_bible"];
  visual_budget: AssetPlan["visual_budget"];
  downgrade_policy: AssetPlan["downgrade_policy"];
  global_audio_strategy: AssetPlan["global_audio_strategy"];
}

export type AllowedSegmentIntentRepairOperation =
  | {
      operation: "replace_field";
      path: Array<string | number>;
    }
  | {
      operation: "append_intent";
      segment_id: string;
      expected_kind: SegmentAssetIntentKind;
    };

export interface SegmentIntentRepairInput {
  normalized_draft: unknown;
  issues: SegmentIntentIssue[];
  allowed_operations: AllowedSegmentIntentRepairOperation[];
  context: {
    chunk_id: string;
    is_first_chunk: boolean;
    segment_ids: string[];
    segment_routes: Array<{ segment_id: string; resolved_route: ResolvedVisualRoute }>;
  };
}

export interface SegmentIntentPlannerSource
  extends Omit<SegmentIntentPlannerInput, "segments"> {
  /** 输入是原始 StoryboardPlan 段；build 内部投影为 prompt DTO。 */
  segments: StoryboardPlan["segments"];
  [key: string]: unknown;
}

export interface SegmentIntentRepairSource {
  normalized_draft: unknown;
  issues: SegmentIntentIssue[];
  context: SegmentIntentRepairInput["context"];
  [key: string]: unknown;
}

const NOT_JSON_SAFE = "segment_intent_prompt_input_not_json_safe" as const;

export class SegmentIntentPromptInputError extends Error {
  readonly code = NOT_JSON_SAFE;

  constructor() {
    super(NOT_JSON_SAFE);
    this.name = "SegmentIntentPromptInputError";
  }
}

const REPLACEABLE_FIELDS = new Set([
  "production_intent",
  "image_prompt",
  "video_prompt_reserve",
  "image_role",
  "support_reason",
  "risk_notes",
  "video_prompt",
  "why_static_insufficient",
  "required_tags",
  "mood_tags",
  "selection_label",
  "timing_basis",
  "scope",
  "segment_ids",
  "volume",
  "fade_in_sec",
  "fade_out_sec",
]);

const REPLACEABLE_ARRAY_FIELDS = new Set([
  "risk_notes",
  "required_tags",
  "mood_tags",
  "segment_ids",
]);

const REPLACEABLE_ISSUE_CODES = new Set([
  "missing_required_field",
  "too_small",
  "too_big",
  "invalid_value",
  "invalid_enum_value",
  "invalid_type",
  "invalid_literal",
  "custom",
  "global_bgm_segment_ids_invalid",
  "bgm_segment_ids_empty",
  "bgm_segment_ids_duplicate",
  "bgm_segment_ids_outside_chunk",
  "bgm_segment_ids_not_ordered",
]);

function isSafeReplacementPath(path: Array<string | number>): boolean {
  if (
    !path.every(
      (part) =>
        typeof part === "string" ||
        (Number.isSafeInteger(part) && part >= 0),
    ) ||
    path[0] !== "segments" ||
    !isSafePathIndex(path[1]) ||
    path[2] !== "intents" ||
    !isSafePathIndex(path[3])
  ) {
    return false;
  }
  if (
    path.length === 5 &&
    typeof path[4] === "string" &&
    REPLACEABLE_FIELDS.has(path[4])
  ) {
    return true;
  }
  return (
    path.length === 6 &&
    typeof path[4] === "string" &&
    REPLACEABLE_ARRAY_FIELDS.has(path[4]) &&
    isSafePathIndex(path[5])
  );
}

function isSafePathIndex(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

function parseExpectedKind(value: unknown): SegmentAssetIntentKind | null {
  const parsed = SegmentAssetIntentKind.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function isNonemptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function hasStructurallyValidIssuePath(value: unknown): value is Array<
  string | number
> {
  return (
    Array.isArray(value) &&
    value.every(
      (part) => typeof part === "string" || isSafePathIndex(part),
    )
  );
}

function isAppendIntentIssuePath(path: Array<string | number>): boolean {
  return (
    path.length === 3 &&
    path[0] === "segments" &&
    isSafePathIndex(path[1]) &&
    path[2] === "intents"
  );
}

function deriveAllowedOperations(
  normalizedDraft: unknown,
  context: SegmentIntentRepairInput["context"],
  issues: SegmentIntentIssue[],
): AllowedSegmentIntentRepairOperation[] {
  const operations: AllowedSegmentIntentRepairOperation[] = [];
  const seen = new Set<string>();
  const contextSegmentIds = new Set(context.segment_ids);

  for (const issue of issues) {
    const expectedKind = parseExpectedKind(issue.expected_kind);
    if (
      !isNonemptyString(issue.code) ||
      !hasStructurallyValidIssuePath(issue.path)
    ) {
      continue;
    }
    if (
      !isNonemptyString(issue.segment_id) ||
      !contextSegmentIds.has(issue.segment_id)
    ) {
      continue;
    }
    const segmentEntry = getSegmentEntry(normalizedDraft, issue.path[1]);
    if (segmentEntry?.source_segment_id !== issue.segment_id) continue;

    let operation: AllowedSegmentIntentRepairOperation | null = null;
    if (
      expectedKind !== null &&
      REPLACEABLE_ISSUE_CODES.has(issue.code) &&
      isSafeReplacementPath(issue.path) &&
      getIntentKind(segmentEntry, issue.path[3]) === expectedKind
    ) {
      operation = { operation: "replace_field", path: [...issue.path] };
    } else if (
      issue.code === "missing_required_intent_kind" &&
      expectedKind !== null &&
      isAppendIntentIssuePath(issue.path)
    ) {
      operation = {
        operation: "append_intent",
        segment_id: issue.segment_id,
        expected_kind: expectedKind,
      };
    }
    if (!operation) continue;
    const fingerprint = JSON.stringify(operation);
    if (!seen.has(fingerprint)) {
      seen.add(fingerprint);
      operations.push(operation);
    }
  }
  return operations;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getSegmentEntry(
  normalizedDraft: unknown,
  index: unknown,
): Record<string, unknown> | null {
  if (!isSafePathIndex(index) || !isPlainRecord(normalizedDraft)) return null;
  const segments = normalizedDraft.segments;
  if (!Array.isArray(segments)) return null;
  const entry = segments[index];
  return isPlainRecord(entry) ? entry : null;
}

function getIntentKind(
  segmentEntry: Record<string, unknown>,
  index: unknown,
): SegmentAssetIntentKind | null {
  if (!isSafePathIndex(index) || !Array.isArray(segmentEntry.intents)) {
    return null;
  }
  const intent = segmentEntry.intents[index];
  return isPlainRecord(intent) ? parseExpectedKind(intent.asset_kind) : null;
}

function rejectNotJsonSafe(): never {
  throw new SegmentIntentPromptInputError();
}

function assertJsonSafe(value: unknown, active = new WeakSet<object>()): void {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) rejectNotJsonSafe();
    return;
  }
  if (typeof value !== "object") rejectNotJsonSafe();

  const objectValue = value as object;
  if (isProxy(objectValue)) rejectNotJsonSafe();
  if (active.has(objectValue)) rejectNotJsonSafe();
  const prototype = Object.getPrototypeOf(objectValue);
  const isArray = Array.isArray(objectValue);
  if (
    (isArray && prototype !== Array.prototype) ||
    (!isArray && prototype !== Object.prototype && prototype !== null)
  ) {
    rejectNotJsonSafe();
  }

  const descriptors = Object.getOwnPropertyDescriptors(objectValue);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key === "symbol")) rejectNotJsonSafe();

  active.add(objectValue);
  try {
    if (isArray) {
      const arrayValue = objectValue as unknown[];
      for (let index = 0; index < arrayValue.length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
          rejectNotJsonSafe();
        }
        assertJsonSafe(descriptor.value, active);
      }
      const expectedKeys = new Set([
        "length",
        ...Array.from({ length: arrayValue.length }, (_, index) => String(index)),
      ]);
      if (
        keys.some(
          (key) => typeof key !== "string" || !expectedKeys.has(key),
        )
      ) {
        rejectNotJsonSafe();
      }
      return;
    }

    for (const key of keys) {
      if (typeof key !== "string") rejectNotJsonSafe();
      const descriptor = descriptors[key];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        rejectNotJsonSafe();
      }
      assertJsonSafe(descriptor.value, active);
    }
  } finally {
    active.delete(objectValue);
  }
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const descriptor of Object.values(
    Object.getOwnPropertyDescriptors(value),
  )) {
    if ("value" in descriptor) deepFreeze(descriptor.value, seen);
  }
  return Object.freeze(value);
}

function jsonSafeCloneAndFreeze<T>(value: T): T {
  assertJsonSafe(value);
  try {
    return deepFreeze(structuredClone(value));
  } catch {
    return rejectNotJsonSafe();
  }
}

function readOwnDataProperty(source: unknown, key: string): unknown {
  if (typeof source !== "object" || source === null || isProxy(source)) {
    return rejectNotJsonSafe();
  }
  const descriptor = Object.getOwnPropertyDescriptor(source, key);
  if (!descriptor || !("value" in descriptor)) return rejectNotJsonSafe();
  return descriptor.value;
}

export function buildSegmentIntentPlannerInput(
  source: SegmentIntentPlannerSource,
): SegmentIntentPlannerInput {
  const result = jsonSafeCloneAndFreeze({
    chunk_id: readOwnDataProperty(source, "chunk_id") as string,
    is_first_chunk: readOwnDataProperty(source, "is_first_chunk") as boolean,
    segments: readOwnDataProperty(source, "segments") as StoryboardPlan["segments"],
    segment_routes: readOwnDataProperty(source, "segment_routes") as SegmentIntentPlannerInput["segment_routes"],
    art_bible: readOwnDataProperty(source, "art_bible") as AssetPlan["art_bible"],
    visual_budget: readOwnDataProperty(
      source,
      "visual_budget",
    ) as AssetPlan["visual_budget"],
    downgrade_policy: readOwnDataProperty(
      source,
      "downgrade_policy",
    ) as AssetPlan["downgrade_policy"],
    global_audio_strategy: readOwnDataProperty(
      source,
      "global_audio_strategy",
    ) as AssetPlan["global_audio_strategy"],
  });
  if (result.segments.length < 1 || result.segments.length > 3) {
    throw new Error("segment intent chunk 必须包含 1-3 个 segments");
  }
  const ids = result.segments.map((segment) => segment.segment_id);
  if (new Set(ids).size !== ids.length) {
    throw new Error("segment intent chunk 的 segment_id 必须唯一");
  }
  validatePlannerSegmentRoutes(result.segment_routes, result.segments);
  // 任务 5 整改：prompt 只收到投影 DTO（剔除 api_video_suitability 等上游字段）
  const routeById = new Map(
    result.segment_routes.map((route) => [route.segment_id, route.resolved_route]),
  );
  const projectedSegments = projectSegmentIntentPromptSegments(
    result.segments,
    routeById,
  );
  return jsonSafeCloneAndFreeze({
    ...result,
    segments: projectedSegments,
  });
}

/**
 * 任务 5：planner 输入的路线投影必须与 chunk 内 segments 一一对应，
 * 且 resolved_route 只允许 resolver 的两个合法值；缺漏或越权值直接拒绝，
 * 避免 prompt 输入与校验上下文出现两套路线。
 */
function validatePlannerSegmentRoutes(
  routes: SegmentIntentPlannerInput["segment_routes"],
  segments: StoryboardPlan["segments"],
): void {
  const expectedIds = new Set(segments.map((segment) => segment.segment_id));
  const seen = new Set<string>();
  if (routes.length !== segments.length) {
    throw new Error("segment_routes 必须与 chunk 内 segments 一一对应");
  }
  for (const route of routes) {
    if (route.resolved_route !== "api_video" && route.resolved_route !== "remotion") {
      throw new Error("segment_routes 包含非法 resolved_route");
    }
    if (!expectedIds.has(route.segment_id) || seen.has(route.segment_id)) {
      throw new Error("segment_routes 与 chunk 内 segments 不一致");
    }
    seen.add(route.segment_id);
  }
}

export function buildSegmentIntentRepairInput(
  source: SegmentIntentRepairSource,
): SegmentIntentRepairInput {
  const safeSource = jsonSafeCloneAndFreeze({
    normalized_draft: readOwnDataProperty(source, "normalized_draft"),
    issues: readOwnDataProperty(source, "issues") as SegmentIntentIssue[],
    context: readOwnDataProperty(
      source,
      "context",
    ) as SegmentIntentRepairInput["context"],
  });
  return jsonSafeCloneAndFreeze({
    normalized_draft: safeSource.normalized_draft,
    issues: safeSource.issues,
    allowed_operations: deriveAllowedOperations(
      safeSource.normalized_draft,
      safeSource.context,
      safeSource.issues,
    ),
    context: safeSource.context,
  });
}
