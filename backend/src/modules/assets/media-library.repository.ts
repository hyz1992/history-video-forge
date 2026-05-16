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
