import { isProxy } from "node:util/types";

import type { AssetPlan, StoryboardPlan } from "../../../../shared/src/index.js";
import {
  SegmentAssetIntentBatchDraft,
  SegmentAssetIntentKind,
  SegmentIntentRepairPatch,
  type SegmentIntentIssue,
} from "./segment-asset-intent.js";

export const SEGMENT_INTENT_PLANNER_OUTPUT_SCHEMA =
  SegmentAssetIntentBatchDraft;
export const SEGMENT_INTENT_REPAIR_OUTPUT_SCHEMA = SegmentIntentRepairPatch;

export interface SegmentIntentPlannerInput {
  chunk_id: string;
  is_first_chunk: boolean;
  segments: StoryboardPlan["segments"];
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
    visual_strategy_preferences: Array<{
      segment_id: string;
      preference: "api_video" | "remotion_motion" | null;
    }>;
  };
}

export interface SegmentIntentPlannerSource extends SegmentIntentPlannerInput {
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
  return result;
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
