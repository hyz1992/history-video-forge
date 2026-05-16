import type { DbClient } from "../../db/client.js";
import type { MediaLibraryItem } from "../../../../shared/src/index.js";
import { listMediaLibraryItems } from "./media-library.repository.js";

export async function selectMediaLibraryItem(
  db: DbClient,
  input: {
    type: "sfx" | "bgm";
    requiredTags: string[];
    moodTags: string[];
  },
): Promise<MediaLibraryItem | null> {
  const items = await listMediaLibraryItems(db);

  const candidates = items
    .filter((item) => item.approved_for_use)
    .filter((item) => item.type === input.type)
    .filter((item) =>
      input.requiredTags.every((tag) => item.tags.includes(tag)),
    );

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    const aMood = input.moodTags.filter((tag) => a.mood_tags.includes(tag)).length;
    const bMood = input.moodTags.filter((tag) => b.mood_tags.includes(tag)).length;
    if (bMood !== aMood) return bMood - aMood;
    return a.library_item_id.localeCompare(b.library_item_id);
  });

  return candidates[0];
}
