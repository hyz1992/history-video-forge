import { z } from "zod";

export const GLOBAL_FORBIDDEN_CHUNK_KEYS = [
  "chunk_id",
  "tasks",
  "dependencies",
  "budget_notes",
] as const;

export type GlobalForbiddenChunkKey =
  (typeof GLOBAL_FORBIDDEN_CHUNK_KEYS)[number];

export type GlobalDraftNormalizationAction =
  | { type: "default_inserted"; path: string }
  | {
      type: "forbidden_chunk_key_removed";
      path: string;
      key: GlobalForbiddenChunkKey;
    };

type PlainObject = Record<string, unknown>;
type StructuralPath = Array<string | number>;

export const GlobalPlanningStructuralPatch = z
  .object({
    patch_type: z.literal("global_planning_structural_patch"),
    patches: z.array(
      z
        .object({
          path: z.array(
            z.union([z.string(), z.number().int().nonnegative()]),
          ),
          value: z.unknown(),
        })
        .strict()
        .superRefine((item, context) => {
          if (!Object.prototype.hasOwnProperty.call(item, "value")) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["value"],
              message: "value is required",
            });
          }
        }),
    ),
  })
  .strict();

export type GlobalPlanningStructuralPatch = z.infer<
  typeof GlobalPlanningStructuralPatch
>;

function isPlainObject(value: unknown): value is PlainObject {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cloneStructure(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneStructure);
  if (!isPlainObject(value)) return value;

  const clone: PlainObject = Object.create(Object.getPrototypeOf(value));
  for (const [key, child] of Object.entries(value)) {
    clone[key] = cloneStructure(child);
  }
  return clone;
}

function pathsEqual(left: StructuralPath, right: StructuralPath): boolean {
  return (
    left.length === right.length &&
    left.every((segment, index) => segment === right[index])
  );
}

function isStrictPathPrefix(
  prefix: StructuralPath,
  candidate: StructuralPath,
): boolean {
  return (
    prefix.length < candidate.length &&
    prefix.every((segment, index) => segment === candidate[index])
  );
}

function pathIdentity(path: StructuralPath): string {
  return JSON.stringify(path);
}

function validatePatchTarget(draft: unknown, path: StructuralPath): void {
  if (path.length === 0) return;

  let parent: unknown = draft;
  for (let index = 0; index < path.length; index += 1) {
    const segment = path[index];
    const isFinal = index === path.length - 1;

    if (Array.isArray(parent)) {
      if (
        typeof segment !== "number" ||
        !Number.isInteger(segment) ||
        segment < 0 ||
        segment >= parent.length
      ) {
        throw new Error(`invalid array patch path: ${pathIdentity(path)}`);
      }
      if (!isFinal) parent = parent[segment];
      continue;
    }

    if (!isPlainObject(parent) || typeof segment !== "string") {
      throw new Error(`invalid object patch path: ${pathIdentity(path)}`);
    }
    if (!isFinal) {
      if (!Object.prototype.hasOwnProperty.call(parent, segment)) {
        throw new Error(`missing patch parent: ${pathIdentity(path)}`);
      }
      parent = parent[segment];
    }
  }
}

function applyValidatedPatch(
  draft: unknown,
  path: StructuralPath,
  value: unknown,
): unknown {
  if (path.length === 0) return cloneStructure(value);

  let parent = draft as PlainObject | unknown[];
  for (let index = 0; index < path.length - 1; index += 1) {
    parent = parent[path[index] as never] as PlainObject | unknown[];
  }
  parent[path[path.length - 1] as never] = cloneStructure(value) as never;
  return draft;
}

export function applyGlobalPlanningStructuralPatch(input: {
  draft: unknown;
  patch: GlobalPlanningStructuralPatch;
  allowedRepairPaths: Array<Array<string | number>>;
}): unknown {
  const patch = GlobalPlanningStructuralPatch.parse(input.patch);
  const seenPaths = new Set<string>();

  for (const entry of patch.patches) {
    if (
      !input.allowedRepairPaths.some((allowedPath) =>
        pathsEqual(entry.path, allowedPath),
      )
    ) {
      throw new Error(`patch path is not allowed: ${pathIdentity(entry.path)}`);
    }

    const identity = pathIdentity(entry.path);
    if (seenPaths.has(identity)) {
      throw new Error(`duplicate patch path: ${identity}`);
    }
    seenPaths.add(identity);
    validatePatchTarget(input.draft, entry.path);
  }

  for (let leftIndex = 0; leftIndex < patch.patches.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < patch.patches.length;
      rightIndex += 1
    ) {
      const leftPath = patch.patches[leftIndex].path;
      const rightPath = patch.patches[rightIndex].path;
      if (
        isStrictPathPrefix(leftPath, rightPath) ||
        isStrictPathPrefix(rightPath, leftPath)
      ) {
        throw new Error("global_planning_structural_patch_overlapping_paths");
      }
    }
  }

  let result = cloneStructure(input.draft);
  for (const entry of patch.patches) {
    result = applyValidatedPatch(result, entry.path, entry.value);
  }
  return result;
}

function insertArrayDefault(
  parent: PlainObject,
  key: string,
  path: string,
  actions: GlobalDraftNormalizationAction[],
): void {
  if (parent[key] !== undefined) return;
  parent[key] = [];
  actions.push({ type: "default_inserted", path });
}

function normalizeCollectionNotes(
  artBible: PlainObject,
  collectionKey: "characters" | "locations" | "props",
  actions: GlobalDraftNormalizationAction[],
): void {
  const collection = artBible[collectionKey];
  if (!Array.isArray(collection)) return;

  collection.forEach((entry, index) => {
    if (!isPlainObject(entry)) return;
    insertArrayDefault(
      entry,
      "consistency_notes",
      `art_bible.${collectionKey}[${index}].consistency_notes`,
      actions,
    );
  });
}

function stableUniqueActions(
  actions: GlobalDraftNormalizationAction[],
): GlobalDraftNormalizationAction[] {
  const unique = new Map<string, GlobalDraftNormalizationAction>();
  for (const action of actions) {
    const identity = `${action.type}\u0000${action.path}`;
    if (!unique.has(identity)) unique.set(identity, action);
  }

  return [...unique.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([, action]) => action);
}

export function normalizeGlobalPlanningDraftStructure(raw: unknown): {
  value: unknown;
  actions: GlobalDraftNormalizationAction[];
} {
  const value = cloneStructure(raw);
  const actions: GlobalDraftNormalizationAction[] = [];
  if (!isPlainObject(value)) return { value, actions };

  for (const key of GLOBAL_FORBIDDEN_CHUNK_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    delete value[key];
    actions.push({
      type: "forbidden_chunk_key_removed",
      path: key,
      key,
    });
  }

  insertArrayDefault(
    value,
    "manual_review_notes",
    "manual_review_notes",
    actions,
  );

  const artBible = value.art_bible;
  if (isPlainObject(artBible)) {
    insertArrayDefault(
      artBible,
      "global_negative_prompts",
      "art_bible.global_negative_prompts",
      actions,
    );
    insertArrayDefault(
      artBible,
      "consistency_notes",
      "art_bible.consistency_notes",
      actions,
    );
    normalizeCollectionNotes(artBible, "characters", actions);
    normalizeCollectionNotes(artBible, "locations", actions);
    normalizeCollectionNotes(artBible, "props", actions);
  }

  return { value, actions: stableUniqueActions(actions) };
}
