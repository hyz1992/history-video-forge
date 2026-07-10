import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { MediaLibraryItem, type MediaLibraryItem as MediaLibraryItemRecord } from "../../../../shared/src/index.js";
import type { DbClient } from "../../db/client.js";
import { seedMediaLibraryItems } from "./media-library.repository.js";

export interface MediaLibraryLoadResult {
  loaded: boolean;
  itemCount: number;
  error: string | null;
}

export function loadMediaLibraryCatalog(
  db: DbClient,
  options: { storageBaseDir: string },
): MediaLibraryLoadResult {
  const catalogPath = join(options.storageBaseDir, "storage", "media-library", "catalog.json");
  if (!existsSync(catalogPath)) {
    return { loaded: true, itemCount: 0, error: null };
  }

  try {
    const raw = JSON.parse(readFileSync(catalogPath, "utf8")) as Record<string, unknown>;
    if (raw.schema_version !== "media_library_catalog_v1" || !Array.isArray(raw.items)) {
      throw new Error("media_library_catalog_invalid_schema");
    }
    const items = raw.items.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw new Error("media_library_item_invalid");
      }
      const source = item as Record<string, unknown>;
      const license = source.license && typeof source.license === "object" && !Array.isArray(source.license)
        ? source.license as Record<string, unknown>
        : source.license;
      const { label: _label, relative_path: _relativePath, ...itemWithoutLegacyFields } = source;
      const normalizedLicense = license && typeof license === "object"
        ? (() => {
            const { direct_download_url: _ignored, ...rest } = license as Record<string, unknown>;
            return rest;
          })()
        : license;
      return MediaLibraryItem.parse({
        ...itemWithoutLegacyFields,
        license: normalizedLicense,
      });
    }) as MediaLibraryItemRecord[];
    seedMediaLibraryItems(db, items);
    return { loaded: true, itemCount: items.length, error: null };
  } catch (error) {
    db.mediaLibraryItems.clear();
    return {
      loaded: false,
      itemCount: 0,
      error: error instanceof Error ? error.message : "media_library_catalog_load_failed",
    };
  }
}
