import { z } from "zod";

import type { StoryboardPlan } from "../../../../shared/src/index.js";

export const SegmentAssetIntentKind = z.enum([
  "image_still",
  "video_clip",
  "render_motion_cue",
  "sfx_cue",
  "bgm_cue",
]);
export type SegmentAssetIntentKind = z.infer<typeof SegmentAssetIntentKind>;

const NonemptyNotes = z.array(z.string().min(1)).min(1);
const AudioTimingBasis = z.enum(["none", "tts"]);

const ImageStillIntent = z
  .object({
    asset_kind: z.literal("image_still"),
    production_intent: z.string().min(1),
    image_prompt: z.string().min(1),
    video_prompt_reserve: z.string().min(1),
    image_role: z.enum(["anchor", "support"]),
    support_reason: z.string().min(1).nullable(),
    risk_notes: NonemptyNotes,
  })
  .strict();

const VideoClipIntent = z
  .object({
    asset_kind: z.literal("video_clip"),
    production_intent: z.string().min(1),
    video_prompt: z.string().min(1),
    why_static_insufficient: z.string().min(1),
    risk_notes: NonemptyNotes,
  })
  .strict();

const RenderMotionCueIntent = z
  .object({
    asset_kind: z.literal("render_motion_cue"),
    production_intent: z.string().min(1),
    risk_notes: NonemptyNotes,
  })
  .strict();

const SfxCueIntent = z
  .object({
    asset_kind: z.literal("sfx_cue"),
    production_intent: z.string().min(1),
    required_tags: z.array(z.string().min(1)).min(1),
    mood_tags: z.array(z.string().min(1)),
    selection_label: z.string().min(1).nullable(),
    timing_basis: AudioTimingBasis,
    risk_notes: z.array(z.string().min(1)),
  })
  .strict();

const BgmCueIntent = z
  .object({
    asset_kind: z.literal("bgm_cue"),
    production_intent: z.string().min(1),
    required_tags: z.array(z.string().min(1)).min(1),
    mood_tags: z.array(z.string().min(1)),
    selection_label: z.string().min(1).nullable(),
    timing_basis: AudioTimingBasis,
    scope: z.enum(["global", "segment", "segment_span"]),
    segment_ids: z.array(z.string().min(1)),
    volume: z.number().min(0).max(1),
    fade_in_sec: z.number().nonnegative(),
    fade_out_sec: z.number().nonnegative(),
    risk_notes: z.array(z.string().min(1)),
  })
  .strict();

export const SegmentAssetIntent = z
  .discriminatedUnion("asset_kind", [
    ImageStillIntent,
    VideoClipIntent,
    RenderMotionCueIntent,
    SfxCueIntent,
    BgmCueIntent,
  ])
  .superRefine((intent, refinement) => {
    if (
      intent.asset_kind === "image_still" &&
      intent.image_role === "anchor" &&
      intent.support_reason !== null
    ) {
      refinement.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["support_reason"],
        message: "anchor image support_reason must be null",
      });
    }
    if (
      intent.asset_kind === "image_still" &&
      intent.image_role === "support" &&
      intent.support_reason === null
    ) {
      refinement.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["support_reason"],
        message: "support image requires support_reason",
      });
    }
  });
export type SegmentAssetIntent = z.infer<typeof SegmentAssetIntent>;

const SegmentIntentEntry = z
  .object({
    source_segment_id: z.string().min(1),
    intents: z.array(SegmentAssetIntent),
  })
  .strict();

export const SegmentAssetIntentBatchDraft = z
  .object({
    planning_mode: z.literal("segment_intent_batch"),
    segments: z.array(SegmentIntentEntry).min(1),
    budget_notes: z.array(z.string().min(1)),
  })
  .strict();
export type SegmentAssetIntentBatchDraft = z.infer<
  typeof SegmentAssetIntentBatchDraft
>;

const ReplaceFieldOperation = z
  .object({
    operation: z.literal("replace_field"),
    path: z.array(z.union([z.string(), z.number().int().nonnegative()])).min(1),
    value: z.unknown(),
  })
  .strict();

const AppendIntentOperation = z
  .object({
    operation: z.literal("append_intent"),
    segment_id: z.string().min(1),
    expected_kind: SegmentAssetIntentKind,
    value: SegmentAssetIntent,
  })
  .strict();

const SegmentIntentRepairOperation = z.discriminatedUnion("operation", [
  ReplaceFieldOperation,
  AppendIntentOperation,
]);

export const SegmentIntentRepairPatch = z
  .object({
    patch_type: z.literal("segment_asset_intent_repair"),
    operations: z.array(SegmentIntentRepairOperation).min(1),
  })
  .strict();
export type SegmentIntentRepairPatch = z.infer<typeof SegmentIntentRepairPatch>;

export interface SegmentIntentValidationContext {
  segments: StoryboardPlan["segments"];
  isFirstChunk: boolean;
}

export interface SegmentIntentIssue {
  code: string;
  path: Array<string | number>;
  segment_id: string | null;
  expected_kind: SegmentAssetIntentKind | null;
}

export interface SegmentIntentInspection {
  normalizedDraft: unknown;
  issues: SegmentIntentIssue[];
  parsedDraft?: SegmentAssetIntentBatchDraft;
}

export class SegmentIntentRepairError extends Error {
  readonly code = "segment_intent_repair_rejected";

  constructor(readonly issues: SegmentIntentIssue[]) {
    super("segment_intent_repair_rejected");
    this.name = "SegmentIntentRepairError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneAndNormalize(
  raw: unknown,
  context: SegmentIntentValidationContext,
): unknown {
  const cloned: unknown = structuredClone(raw);
  if (!isRecord(cloned) || !Array.isArray(cloned.segments)) return cloned;
  const orderById = new Map(
    context.segments.map((segment, index) => [segment.segment_id, index]),
  );
  const originalPositions = new Map(
    cloned.segments.map((entry, index) => [entry, index]),
  );
  cloned.segments.sort((left, right) => {
    const leftId = isRecord(left) ? left.source_segment_id : undefined;
    const rightId = isRecord(right) ? right.source_segment_id : undefined;
    const leftOrder = typeof leftId === "string" ? orderById.get(leftId) : undefined;
    const rightOrder = typeof rightId === "string" ? orderById.get(rightId) : undefined;
    return (
      (leftOrder ?? Number.MAX_SAFE_INTEGER) -
        (rightOrder ?? Number.MAX_SAFE_INTEGER) ||
      (originalPositions.get(left) ?? 0) - (originalPositions.get(right) ?? 0)
    );
  });
  return cloned;
}

function getAtPath(value: unknown, path: Array<string | number>): unknown {
  let current = value;
  for (const part of path) {
    if (Array.isArray(current) && typeof part === "number") {
      current = current[part];
    } else if (isRecord(current) && typeof part === "string") {
      current = current[part];
    } else {
      return undefined;
    }
  }
  return current;
}

function normalizeZodPath(path: PropertyKey[]): Array<string | number> {
  return path.flatMap((part) =>
    typeof part === "string" || typeof part === "number" ? [part] : [],
  );
}

function metadataForPath(
  draft: unknown,
  path: Array<string | number>,
): Pick<SegmentIntentIssue, "segment_id" | "expected_kind"> {
  if (path[0] !== "segments" || typeof path[1] !== "number") {
    return { segment_id: null, expected_kind: null };
  }
  const entry = getAtPath(draft, ["segments", path[1]]);
  const segmentId =
    isRecord(entry) && typeof entry.source_segment_id === "string"
      ? entry.source_segment_id
      : null;
  if (path[2] !== "intents" || typeof path[3] !== "number") {
    return { segment_id: segmentId, expected_kind: null };
  }
  const intent = getAtPath(entry, ["intents", path[3]]);
  const kind = SegmentAssetIntentKind.safeParse(
    isRecord(intent) ? intent.asset_kind : undefined,
  );
  return {
    segment_id: segmentId,
    expected_kind: kind.success ? kind.data : null,
  };
}

function schemaIssues(draft: unknown, error: z.ZodError): SegmentIntentIssue[] {
  return error.issues.map((zodIssue) => {
    const path = normalizeZodPath(zodIssue.path);
    return {
      code:
        zodIssue.code === "invalid_type" && getAtPath(draft, path) === undefined
          ? "missing_required_field"
          : zodIssue.code,
      path,
      ...metadataForPath(draft, path),
    };
  });
}

function contextIssue(
  code: string,
  path: Array<string | number>,
  segmentId: string | null,
  expectedKind: SegmentAssetIntentKind | null,
): SegmentIntentIssue {
  return { code, path, segment_id: segmentId, expected_kind: expectedKind };
}

function validateBgm(
  draft: SegmentAssetIntentBatchDraft,
  context: SegmentIntentValidationContext,
): SegmentIntentIssue[] {
  const issues: SegmentIntentIssue[] = [];
  const orderById = new Map(
    context.segments.map((segment, index) => [segment.segment_id, index]),
  );
  const chunkIds = new Set(orderById.keys());
  const bgms = draft.segments.flatMap((entry, entryIndex) =>
    entry.intents.flatMap((intent, intentIndex) =>
      intent.asset_kind === "bgm_cue"
        ? [{ intent, entry, entryIndex, intentIndex }]
        : [],
    ),
  );
  const globals = bgms.filter(({ intent }) => intent.scope === "global");
  const firstSegmentId = context.segments[0]?.segment_id ?? null;

  if (context.isFirstChunk) {
    const correctlyOwned = globals.filter(
      ({ entry }) => entry.source_segment_id === firstSegmentId,
    );
    if (correctlyOwned.length === 0) {
      issues.push(
        contextIssue(
          "missing_required_intent_kind",
          ["segments", 0, "intents"],
          firstSegmentId,
          "bgm_cue",
        ),
      );
    }
    if (globals.length !== 1 || correctlyOwned.length !== 1) {
      issues.push(
        contextIssue(
          "global_bgm_owner_invalid",
          ["segments"],
          firstSegmentId,
          "bgm_cue",
        ),
      );
    }
  } else if (globals.length > 0) {
    issues.push(
      contextIssue("global_bgm_owner_invalid", ["segments"], null, "bgm_cue"),
    );
  }

  for (const { intent, entry, entryIndex, intentIndex } of bgms) {
    const basePath = ["segments", entryIndex, "intents", intentIndex, "segment_ids"];
    if (intent.scope === "global") {
      if (intent.segment_ids.length > 0) {
        issues.push(
          contextIssue(
            "global_bgm_segment_ids_invalid",
            basePath,
            entry.source_segment_id,
            "bgm_cue",
          ),
        );
      }
      continue;
    }
    if (intent.segment_ids.length === 0) {
      issues.push(
        contextIssue(
          "bgm_segment_ids_empty",
          basePath,
          entry.source_segment_id,
          "bgm_cue",
        ),
      );
    }
    const seen = new Set<string>();
    let previousOrder = -1;
    intent.segment_ids.forEach((segmentId) => {
      const itemPath = basePath;
      if (seen.has(segmentId)) {
        issues.push(
          contextIssue(
            "bgm_segment_ids_duplicate",
            itemPath,
            entry.source_segment_id,
            "bgm_cue",
          ),
        );
      }
      seen.add(segmentId);
      if (!chunkIds.has(segmentId)) {
        issues.push(
          contextIssue(
            "bgm_segment_ids_outside_chunk",
            itemPath,
            entry.source_segment_id,
            "bgm_cue",
          ),
        );
        return;
      }
      const currentOrder = orderById.get(segmentId);
      if (currentOrder !== undefined && currentOrder <= previousOrder) {
        issues.push(
          contextIssue(
            "bgm_segment_ids_not_ordered",
            itemPath,
            entry.source_segment_id,
            "bgm_cue",
          ),
        );
      }
      previousOrder = currentOrder ?? previousOrder;
    });
  }
  return issues;
}

function validateContext(
  draft: SegmentAssetIntentBatchDraft,
  context: SegmentIntentValidationContext,
): SegmentIntentIssue[] {
  const issues: SegmentIntentIssue[] = [];
  const expectedIds = context.segments.map((segment) => segment.segment_id);
  const expectedSet = new Set(expectedIds);
  const seen = new Set<string>();
  const storyboardById = new Map(
    context.segments.map((segment) => [segment.segment_id, segment]),
  );

  draft.segments.forEach((entry, entryIndex) => {
    if (!expectedSet.has(entry.source_segment_id)) {
      issues.push(
        contextIssue(
          "unknown_segment",
          ["segments", entryIndex, "source_segment_id"],
          entry.source_segment_id,
          null,
        ),
      );
    }
    if (seen.has(entry.source_segment_id)) {
      issues.push(
        contextIssue(
          "duplicate_segment",
          ["segments", entryIndex, "source_segment_id"],
          entry.source_segment_id,
          null,
        ),
      );
    }
    seen.add(entry.source_segment_id);

    const anchorCount = entry.intents.filter(
      (intent) => intent.asset_kind === "image_still" && intent.image_role === "anchor",
    ).length;
    const videoCount = entry.intents.filter(
      (intent) => intent.asset_kind === "video_clip",
    ).length;
    const motionCount = entry.intents.filter(
      (intent) => intent.asset_kind === "render_motion_cue",
    ).length;
    const intentsPath = ["segments", entryIndex, "intents"];
    if (anchorCount !== 1) {
      issues.push(
        contextIssue(
          "visual_anchor_count_invalid",
          intentsPath,
          entry.source_segment_id,
          "image_still",
        ),
      );
      if (anchorCount === 0) {
        issues.push(
          contextIssue(
            "missing_required_intent_kind",
            intentsPath,
            entry.source_segment_id,
            "image_still",
          ),
        );
      }
    }
    if (videoCount > 1) {
      issues.push(
        contextIssue(
          "duplicate_intent_kind",
          intentsPath,
          entry.source_segment_id,
          "video_clip",
        ),
      );
    }
    if (motionCount > 1) {
      issues.push(
        contextIssue(
          "duplicate_intent_kind",
          intentsPath,
          entry.source_segment_id,
          "render_motion_cue",
        ),
      );
    }
    if ((videoCount > 0 || motionCount > 0) && anchorCount !== 1) {
      issues.push(
        contextIssue(
          "visual_anchor_binding_invalid",
          intentsPath,
          entry.source_segment_id,
          "image_still",
        ),
      );
    }

    const preference = storyboardById.get(entry.source_segment_id)
      ?.visual_strategy_preference;
    if (preference === "api_video") {
      if (videoCount === 0) {
        issues.push(
          contextIssue(
            "missing_required_intent_kind",
            intentsPath,
            entry.source_segment_id,
            "video_clip",
          ),
        );
      }
    } else {
      if (motionCount === 0) {
        issues.push(
          contextIssue(
            "missing_required_intent_kind",
            intentsPath,
            entry.source_segment_id,
            "render_motion_cue",
          ),
        );
      }
      if (preference === "remotion_motion" && videoCount > 0) {
        issues.push(
          contextIssue(
            "visual_strategy_mismatch",
            intentsPath,
            entry.source_segment_id,
            "video_clip",
          ),
        );
      }
    }
  });

  expectedIds.forEach((segmentId) => {
    if (!seen.has(segmentId)) {
      issues.push(
        contextIssue("missing_segment", ["segments"], segmentId, null),
      );
    }
  });
  return [...issues, ...validateBgm(draft, context)];
}

export function inspectSegmentIntentBatch(input: {
  raw: unknown;
  context: SegmentIntentValidationContext;
}): SegmentIntentInspection {
  const normalizedDraft = cloneAndNormalize(input.raw, input.context);
  const parsed = SegmentAssetIntentBatchDraft.safeParse(normalizedDraft);
  if (!parsed.success) {
    return {
      normalizedDraft,
      issues: schemaIssues(normalizedDraft, parsed.error),
    };
  }
  const issues = validateContext(parsed.data, input.context);
  return { normalizedDraft, issues, parsedDraft: parsed.data };
}

function pathsEqual(
  left: Array<string | number>,
  right: Array<string | number>,
): boolean {
  return (
    left.length === right.length &&
    left.every((part, index) => part === right[index])
  );
}

function isPathPrefix(
  possibleParent: Array<string | number>,
  possibleChild: Array<string | number>,
): boolean {
  return (
    possibleParent.length < possibleChild.length &&
    possibleParent.every((part, index) => part === possibleChild[index])
  );
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

const REPLACEABLE_SCHEMA_ISSUE_CODES = new Set([
  "missing_required_field",
  "too_small",
  "too_big",
  "invalid_value",
  "invalid_enum_value",
  "invalid_type",
  "invalid_literal",
  "custom",
]);

const REPLACEABLE_BGM_CONTEXT_ISSUE_CODES = new Set([
  "global_bgm_segment_ids_invalid",
  "bgm_segment_ids_empty",
  "bgm_segment_ids_duplicate",
  "bgm_segment_ids_outside_chunk",
  "bgm_segment_ids_not_ordered",
]);

function isSafeReplacementPath(path: Array<string | number>): boolean {
  if (
    path[0] !== "segments" ||
    typeof path[1] !== "number" ||
    path[2] !== "intents" ||
    typeof path[3] !== "number"
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
    typeof path[5] === "number"
  );
}

function replaceAtPath(
  target: unknown,
  path: Array<string | number>,
  value: unknown,
): boolean {
  const leaf = path.at(-1);
  const parent = getAtPath(target, path.slice(0, -1));
  if (typeof leaf === "string" && isRecord(parent)) {
    parent[leaf] = structuredClone(value);
    return true;
  }
  if (
    typeof leaf === "number" &&
    Array.isArray(parent) &&
    leaf < parent.length
  ) {
    parent[leaf] = structuredClone(value);
    return true;
  }
  return false;
}

function issueFingerprint(issue: SegmentIntentIssue): string {
  return JSON.stringify([
    issue.code,
    issue.path,
    issue.segment_id,
    issue.expected_kind,
  ]);
}

function issueSetsEqual(
  left: SegmentIntentIssue[],
  right: SegmentIntentIssue[],
): boolean {
  const leftKeys = left.map(issueFingerprint).sort();
  const rightKeys = right.map(issueFingerprint).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key, index) => key === rightKeys[index])
  );
}

function operationsConflict(
  left: z.infer<typeof SegmentIntentRepairOperation>,
  right: z.infer<typeof SegmentIntentRepairOperation>,
): boolean {
  if (left.operation === "replace_field" && right.operation === "replace_field") {
    return (
      pathsEqual(left.path, right.path) ||
      isPathPrefix(left.path, right.path) ||
      isPathPrefix(right.path, left.path)
    );
  }
  if (left.operation === "append_intent" && right.operation === "append_intent") {
    return (
      left.segment_id === right.segment_id &&
      left.expected_kind === right.expected_kind
    );
  }
  return false;
}

function findOperationConflict(
  operations: Array<z.infer<typeof SegmentIntentRepairOperation>>,
): boolean {
  for (let leftIndex = 0; leftIndex < operations.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < operations.length;
      rightIndex += 1
    ) {
      const left = operations[leftIndex];
      const right = operations[rightIndex];
      if (left && right && operationsConflict(left, right)) return true;
    }
  }
  return false;
}

function repairFailure(
  code: string,
  path: Array<string | number> = [],
  segmentId: string | null = null,
  expectedKind: SegmentAssetIntentKind | null = null,
): SegmentIntentRepairError {
  return new SegmentIntentRepairError([
    contextIssue(code, path, segmentId, expectedKind),
  ]);
}

export function applySegmentIntentRepair(input: {
  draft: unknown;
  patch: SegmentIntentRepairPatch;
  initialIssues: SegmentIntentIssue[];
  context: SegmentIntentValidationContext;
}): SegmentAssetIntentBatchDraft {
  const patch = SegmentIntentRepairPatch.safeParse(input.patch);
  if (!patch.success) throw repairFailure("repair_patch_schema_invalid");

  const currentInspection = inspectSegmentIntentBatch({
    raw: input.draft,
    context: input.context,
  });
  if (!issueSetsEqual(input.initialIssues, currentInspection.issues)) {
    throw repairFailure("repair_initial_issues_mismatch");
  }
  if (findOperationConflict(patch.data.operations)) {
    throw repairFailure("repair_operations_conflict");
  }

  for (const operation of patch.data.operations) {
    if (operation.operation === "replace_field") {
      const metadata = metadataForPath(
        currentInspection.normalizedDraft,
        operation.path,
      );
      const authorized = currentInspection.issues.some(
        (currentIssue) =>
          (REPLACEABLE_SCHEMA_ISSUE_CODES.has(currentIssue.code) ||
            REPLACEABLE_BGM_CONTEXT_ISSUE_CODES.has(currentIssue.code)) &&
          pathsEqual(currentIssue.path, operation.path) &&
          currentIssue.segment_id === metadata.segment_id &&
          currentIssue.expected_kind === metadata.expected_kind &&
          metadata.expected_kind !== null,
      );
      if (!authorized || !isSafeReplacementPath(operation.path)) {
        throw repairFailure(
          "repair_operation_unauthorized",
          operation.path,
          metadata.segment_id,
          metadata.expected_kind,
        );
      }
      continue;
    }
    const authorized = currentInspection.issues.some(
      (currentIssue) =>
        currentIssue.code === "missing_required_intent_kind" &&
        currentIssue.segment_id === operation.segment_id &&
        currentIssue.expected_kind === operation.expected_kind,
    );
    const targetEntry =
      isRecord(currentInspection.normalizedDraft) &&
      Array.isArray(currentInspection.normalizedDraft.segments)
        ? currentInspection.normalizedDraft.segments.find(
            (entry) =>
              isRecord(entry) &&
              entry.source_segment_id === operation.segment_id,
          )
        : undefined;
    if (
      !authorized ||
      !isRecord(targetEntry) ||
      !Array.isArray(targetEntry.intents) ||
      operation.value.asset_kind !== operation.expected_kind
    ) {
      throw repairFailure(
        "repair_operation_unauthorized",
        ["segments"],
        operation.segment_id,
        operation.expected_kind,
      );
    }
  }

  const candidate: unknown = structuredClone(currentInspection.normalizedDraft);
  for (const operation of patch.data.operations) {
    if (operation.operation === "replace_field") {
      if (!replaceAtPath(candidate, operation.path, operation.value)) {
        throw repairFailure(
          "repair_operation_unauthorized",
          operation.path,
          metadataForPath(candidate, operation.path).segment_id,
          metadataForPath(candidate, operation.path).expected_kind,
        );
      }
      continue;
    }
    const entry =
      isRecord(candidate) && Array.isArray(candidate.segments)
        ? candidate.segments.find(
            (value) =>
              isRecord(value) &&
              value.source_segment_id === operation.segment_id,
          )
        : undefined;
    if (!isRecord(entry) || !Array.isArray(entry.intents)) {
      throw repairFailure(
        "repair_operation_unauthorized",
        ["segments"],
        operation.segment_id,
        operation.expected_kind,
      );
    }
    entry.intents.push(structuredClone(operation.value));
  }

  const finalInspection = inspectSegmentIntentBatch({
    raw: candidate,
    context: input.context,
  });
  if (!finalInspection.parsedDraft || finalInspection.issues.length > 0) {
    throw new SegmentIntentRepairError(finalInspection.issues);
  }
  return finalInspection.parsedDraft;
}
