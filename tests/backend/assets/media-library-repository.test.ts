import { describe, expect, it } from "vitest";

import { createDbClient } from "../../../backend/src/db/client.js";
import { DEFAULT_AUDIO_LIBRARY_ITEMS } from "../../../backend/src/modules/assets/default-audio-library.js";
import {
  getMediaLibraryItem,
  seedMediaLibraryItems,
} from "../../../backend/src/modules/assets/media-library.repository.js";

describe("media library repository", () => {
  it("seeds default items without overwriting existing approved items", async () => {
    const db = createDbClient();
    const existing = {
      ...DEFAULT_AUDIO_LIBRARY_ITEMS[0]!,
      duration_sec: 99,
      file_hash: "sha256:user-kept",
    };
    db.mediaLibraryItems.set(existing.library_item_id, existing);

    const result = await seedMediaLibraryItems(db, DEFAULT_AUDIO_LIBRARY_ITEMS);

    expect(result.inserted).toBe(DEFAULT_AUDIO_LIBRARY_ITEMS.length - 1);
    expect(result.skipped_existing).toBe(1);
    await expect(
      getMediaLibraryItem(db, existing.library_item_id),
    ).resolves.toMatchObject({
      duration_sec: 99,
      file_hash: "sha256:user-kept",
    });
  });
});
