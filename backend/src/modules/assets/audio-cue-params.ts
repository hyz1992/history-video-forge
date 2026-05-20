export type BgmScope = "global" | "segment" | "segment_span";

export interface BgmCueParams {
  requiredTags: string[];
  moodTags: string[];
  volume: number;
  fadeInSec: number;
  fadeOutSec: number;
  scope: BgmScope;
  segmentIds: string[];
  libraryItemId: string | null;
  selectionLabel: string | null;
}

export interface SfxCueParams {
  requiredTags: string[];
  moodTags: string[];
  libraryItemId: string | null;
  selectionLabel: string | null;
}

export function readBgmCueParams(
  parameters: Record<string, unknown>,
): BgmCueParams {
  return {
    requiredTags: readStringArray(parameters["required_tags"], ["background"]),
    moodTags: readStringArray(parameters["mood_tags"], []),
    volume: readNumberInRange(parameters["volume"], 0.3, 0, 1),
    fadeInSec: readNonNegative(parameters["fade_in_sec"], 0),
    fadeOutSec: readNonNegative(parameters["fade_out_sec"], 0),
    scope: readBgmScope(parameters["scope"]),
    segmentIds: readStringArray(parameters["segment_ids"], []),
    libraryItemId: readNullableString(parameters["library_item_id"]),
    selectionLabel: readNullableString(parameters["selection_label"]),
  };
}

export function readSfxCueParams(
  parameters: Record<string, unknown>,
): SfxCueParams {
  const sfxTags = readStringArray(parameters["sfx_tags"], []);
  return {
    requiredTags:
      sfxTags.length > 0
        ? sfxTags
        : readStringArray(parameters["required_tags"], []),
    moodTags: readStringArray(parameters["mood_tags"], []),
    libraryItemId: readNullableString(parameters["library_item_id"]),
    selectionLabel: readNullableString(parameters["selection_label"]),
  };
}

function readStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const result = value.filter(
    (item): item is string => typeof item === "string" && item.length > 0,
  );
  return result.length > 0 ? result : fallback;
}

function readNullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readNumberInRange(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

function readNonNegative(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, value)
    : fallback;
}

function readBgmScope(value: unknown): BgmScope {
  return value === "segment" || value === "segment_span" ? value : "global";
}
