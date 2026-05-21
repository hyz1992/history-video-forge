import { readFile } from "node:fs/promises";

import type { MediaLibraryItem } from "../../../../shared/src/index.js";

interface LightweightBgmCatalog {
  generated_at?: string;
  items?: LightweightBgmCatalogItem[];
}

interface LightweightBgmCatalogItem {
  library_item_id?: string;
  type?: string;
  status?: string;
  file_uri?: string;
  mime_type?: string;
  duration_sec?: number | null;
  file_hash?: string;
  loopable?: boolean;
  tags?: string[];
  mood_tags?: string[];
}

export async function loadLightweightBgmCatalogItems(
  catalogPath: string,
): Promise<MediaLibraryItem[]> {
  const catalog = JSON.parse(
    await readFile(catalogPath, "utf8"),
  ) as LightweightBgmCatalog;
  const importedAt = catalog.generated_at ?? new Date().toISOString();

  return (catalog.items ?? [])
    .filter(isGeneratedBgmItem)
    .map((item) => ({
      library_item_id: item.library_item_id!,
      type: "bgm",
      file_uri: item.file_uri!,
      mime_type: item.mime_type!,
      duration_sec: item.duration_sec!,
      loopable: item.loopable ?? true,
      tags: item.tags!,
      mood_tags: item.mood_tags ?? [],
      license: {
        license_type: "provider_generated",
        commercial_use_allowed: true,
        attribution_required: false,
        source_url: "https://elevenlabs.io/",
      },
      file_hash: item.file_hash!,
      imported_at: importedAt,
      approved_for_use: true,
    }));
}

function isGeneratedBgmItem(
  item: LightweightBgmCatalogItem,
): item is Required<
  Pick<
    LightweightBgmCatalogItem,
    | "library_item_id"
    | "file_uri"
    | "mime_type"
    | "duration_sec"
    | "file_hash"
    | "tags"
  >
> &
  LightweightBgmCatalogItem {
  return (
    item.type === "bgm" &&
    item.status === "generated_pending_review" &&
    typeof item.library_item_id === "string" &&
    item.library_item_id.length > 0 &&
    typeof item.file_uri === "string" &&
    item.file_uri.length > 0 &&
    typeof item.mime_type === "string" &&
    item.mime_type.length > 0 &&
    typeof item.duration_sec === "number" &&
    item.duration_sec > 0 &&
    typeof item.file_hash === "string" &&
    item.file_hash.length > 0 &&
    Array.isArray(item.tags) &&
    item.tags.length > 0
  );
}
