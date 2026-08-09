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
