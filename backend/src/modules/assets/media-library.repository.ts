import type { DbClient } from "../../db/client.js";
import type { MediaLibraryItem } from "../../../../shared/src/index.js";

export async function saveMediaLibraryItem(
  db: DbClient,
  item: MediaLibraryItem,
): Promise<MediaLibraryItem> {
  db.mediaLibraryItems.set(item.library_item_id, item);
  return item;
}

export async function getMediaLibraryItem(
  db: DbClient,
  id: string,
): Promise<MediaLibraryItem | null> {
  return db.mediaLibraryItems.get(id) ?? null;
}

export async function listMediaLibraryItems(
  db: DbClient,
): Promise<MediaLibraryItem[]> {
  return [...db.mediaLibraryItems.values()];
}

export async function seedMediaLibraryItems(
  db: DbClient,
  items: MediaLibraryItem[],
): Promise<{ inserted: number; skipped_existing: number }> {
  let inserted = 0;
  let skippedExisting = 0;

  for (const item of items) {
    if (db.mediaLibraryItems.has(item.library_item_id)) {
      skippedExisting += 1;
      continue;
    }
    db.mediaLibraryItems.set(item.library_item_id, item);
    inserted += 1;
  }

  return { inserted, skipped_existing: skippedExisting };
}
