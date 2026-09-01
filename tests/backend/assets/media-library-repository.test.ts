import { describe, expect, it } from "vitest";

import { createDbClient } from "../../../backend/src/db/client.js";
import { MediaLibraryItem } from "../../../shared/src/index.js";
import {
  getMediaLibraryItem,
  seedMediaLibraryItems,
} from "../../../backend/src/modules/assets/media-library.repository.js";

/** 内联测试素材（与真实入库路径无关，仅验证 repository seed 语义）。 */
const TEST_LIBRARY_ITEMS = [
  MediaLibraryItem.parse({
    library_item_id: "bgm_test_solemn_001",
    type: "bgm",
    file_uri: "library://bgm-test-solemn",
    mime_type: "audio/wav",
    duration_sec: 12,
    loopable: true,
    tags: ["background"],
    mood_tags: ["solemn"],
    license: {
      license_type: "cc0",
      commercial_use_allowed: true,
      attribution_required: false,
      source_url: "https://example.com/bgm-solemn",
    },
    file_hash: "sha256:test-bgm-solemn",
    imported_at: "2026-08-31T00:00:00.000Z",
    approved_for_use: true,
  }),
  MediaLibraryItem.parse({
    library_item_id: "sfx_test_door_001",
    type: "sfx",
    file_uri: "library://sfx-test-door",
    mime_type: "audio/wav",
    duration_sec: 2,
    loopable: false,
    tags: ["door"],
    mood_tags: ["tense"],
    license: {
      license_type: "cc0",
      commercial_use_allowed: true,
      attribution_required: false,
      source_url: "https://example.com/sfx-door",
    },
    file_hash: "sha256:test-sfx-door",
    imported_at: "2026-08-31T00:00:00.000Z",
    approved_for_use: true,
  }),
];

describe("media library repository", () => {
  it("seeds items without overwriting existing approved items", async () => {
    const db = createDbClient();
    const existing = {
      ...TEST_LIBRARY_ITEMS[0]!,
      duration_sec: 99,
      file_hash: "sha256:user-kept",
    };
    db.mediaLibraryItems.set(existing.library_item_id, existing);

    const result = await seedMediaLibraryItems(db, TEST_LIBRARY_ITEMS);

    expect(result.inserted).toBe(TEST_LIBRARY_ITEMS.length - 1);
    expect(result.skipped_existing).toBe(1);
    await expect(
      getMediaLibraryItem(db, existing.library_item_id),
    ).resolves.toMatchObject({
      duration_sec: 99,
      file_hash: "sha256:user-kept",
    });
  });
});
