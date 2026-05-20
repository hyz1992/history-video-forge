import { describe, expect, it } from "vitest";

import { createDbClient } from "../../../backend/src/db/client.js";
import { saveMediaLibraryItem, listMediaLibraryItems } from "../../../backend/src/modules/assets/media-library.repository.js";
import { selectMediaLibraryItem } from "../../../backend/src/modules/assets/media-library-selector.js";
import type { MediaLibraryItem } from "../../../shared/src/index.js";

const approvedBgmItem: MediaLibraryItem = {
  library_item_id: "bgm_war_001",
  type: "bgm",
  file_uri: "library://bgm/war-drums.wav",
  mime_type: "audio/wav",
  duration_sec: 30,
  loopable: true,
  tags: ["war", "drum", "ancient"],
  mood_tags: ["tense", "epic"],
  license: {
    license_type: "cc0",
    commercial_use_allowed: true,
    attribution_required: false,
  },
  file_hash: "sha256:bgm001",
  imported_at: "2026-05-16T00:00:00.000Z",
  approved_for_use: true,
};

const unapprovedBgmItem: MediaLibraryItem = {
  library_item_id: "bgm_war_002",
  type: "bgm",
  file_uri: "library://bgm/war-horns.wav",
  mime_type: "audio/wav",
  duration_sec: 45,
  loopable: false,
  tags: ["war", "horn"],
  mood_tags: ["tense"],
  license: {
    license_type: "cc0",
    commercial_use_allowed: true,
    attribution_required: false,
  },
  file_hash: "sha256:bgm002",
  imported_at: "2026-05-16T00:00:00.000Z",
  approved_for_use: false,
};

const nonCommercialBgmItem: MediaLibraryItem = {
  library_item_id: "bgm_war_noncommercial",
  type: "bgm",
  file_uri: "library://bgm/war-noncommercial.wav",
  mime_type: "audio/wav",
  duration_sec: 42,
  loopable: true,
  tags: ["war", "drum"],
  mood_tags: ["tense"],
  license: {
    license_type: "royalty_free",
    commercial_use_allowed: false,
    attribution_required: false,
  },
  file_hash: "sha256:bgm-noncommercial",
  imported_at: "2026-05-16T00:00:00.000Z",
  approved_for_use: true,
};

const approvedSfxItem: MediaLibraryItem = {
  library_item_id: "sfx_explosion_001",
  type: "sfx",
  file_uri: "library://sfx/explosion.wav",
  mime_type: "audio/wav",
  duration_sec: 3,
  loopable: false,
  tags: ["explosion", "battle"],
  mood_tags: ["intense", "dramatic"],
  license: {
    license_type: "cc0",
    commercial_use_allowed: true,
    attribution_required: false,
  },
  file_hash: "sha256:sfx001",
  imported_at: "2026-05-16T00:00:00.000Z",
  approved_for_use: true,
};

const approvedBgmEpicItem: MediaLibraryItem = {
  library_item_id: "bgm_war_003",
  type: "bgm",
  file_uri: "library://bgm/war-epic-choir.wav",
  mime_type: "audio/wav",
  duration_sec: 60,
  loopable: true,
  tags: ["war", "drum", "choir"],
  mood_tags: ["tense", "epic", "heroic"],
  license: {
    license_type: "cc0",
    commercial_use_allowed: true,
    attribution_required: false,
  },
  file_hash: "sha256:bgm003",
  imported_at: "2026-05-16T00:00:00.000Z",
  approved_for_use: true,
};

describe("media library selector", () => {
  it("selects approved items matching required tags", async () => {
    const db = createDbClient();
    await saveMediaLibraryItem(db, approvedBgmItem);
    await saveMediaLibraryItem(db, unapprovedBgmItem);

    const selected = await selectMediaLibraryItem(db, {
      type: "bgm",
      requiredTags: ["war"],
      moodTags: ["tense"],
    });

    expect(selected?.library_item_id).toBe(approvedBgmItem.library_item_id);
  });

  it("returns null when no approved item matches", async () => {
    const db = createDbClient();
    await saveMediaLibraryItem(db, approvedBgmItem);

    const selected = await selectMediaLibraryItem(db, {
      type: "sfx",
      requiredTags: ["explosion"],
      moodTags: [],
    });

    expect(selected).toBeNull();
  });

  it("prefers items with more matching mood tags", async () => {
    const db = createDbClient();
    // bgm_war_001 has mood_tags: ["tense", "epic"]
    // bgm_war_003 has mood_tags: ["tense", "epic", "heroic"]
    // Querying for moodTags: ["tense", "epic", "heroic"] should prefer bgm_war_003 (3 matches vs 2)
    await saveMediaLibraryItem(db, approvedBgmItem);
    await saveMediaLibraryItem(db, approvedBgmEpicItem);

    const selected = await selectMediaLibraryItem(db, {
      type: "bgm",
      requiredTags: ["war"],
      moodTags: ["tense", "epic", "heroic"],
    });

    expect(selected?.library_item_id).toBe(approvedBgmEpicItem.library_item_id);
  });

  it("excludes unapproved items from selection", async () => {
    const db = createDbClient();
    await saveMediaLibraryItem(db, unapprovedBgmItem);

    const selected = await selectMediaLibraryItem(db, {
      type: "bgm",
      requiredTags: ["war"],
      moodTags: ["tense"],
    });

    expect(selected).toBeNull();
  });

  it("excludes non-commercial items from selection", async () => {
    const db = createDbClient();
    await saveMediaLibraryItem(db, nonCommercialBgmItem);

    const selected = await selectMediaLibraryItem(db, {
      type: "bgm",
      requiredTags: ["war"],
      moodTags: ["tense"],
    });

    expect(selected).toBeNull();
  });

  it("selects an explicit approved library item by id", async () => {
    const db = createDbClient();
    await saveMediaLibraryItem(db, approvedBgmItem);

    const selected = await selectMediaLibraryItem(db, {
      type: "bgm",
      libraryItemId: approvedBgmItem.library_item_id,
      requiredTags: ["missing-tag"],
      moodTags: [],
    });

    expect(selected?.library_item_id).toBe(approvedBgmItem.library_item_id);
  });

  it("rejects explicit unapproved library items", async () => {
    const db = createDbClient();
    await saveMediaLibraryItem(db, unapprovedBgmItem);

    const selected = await selectMediaLibraryItem(db, {
      type: "bgm",
      libraryItemId: unapprovedBgmItem.library_item_id,
      requiredTags: [],
      moodTags: [],
    });

    expect(selected).toBeNull();
  });

  it("rejects explicit non-commercial library items", async () => {
    const db = createDbClient();
    await saveMediaLibraryItem(db, nonCommercialBgmItem);

    const selected = await selectMediaLibraryItem(db, {
      type: "bgm",
      libraryItemId: nonCommercialBgmItem.library_item_id,
      requiredTags: [],
      moodTags: [],
    });

    expect(selected).toBeNull();
  });

  it("filters by type", async () => {
    const db = createDbClient();
    await saveMediaLibraryItem(db, approvedBgmItem);
    await saveMediaLibraryItem(db, approvedSfxItem);

    const selected = await selectMediaLibraryItem(db, {
      type: "sfx",
      requiredTags: ["explosion"],
      moodTags: ["intense"],
    });

    expect(selected?.library_item_id).toBe(approvedSfxItem.library_item_id);
  });

  it("requires all requiredTags to be present", async () => {
    const db = createDbClient();
    // approvedBgmItem has tags: ["war", "drum", "ancient"]
    await saveMediaLibraryItem(db, approvedBgmItem);

    const selected = await selectMediaLibraryItem(db, {
      type: "bgm",
      requiredTags: ["war", "ocean"],
      moodTags: [],
    });

    expect(selected).toBeNull();
  });

  it("returns null when library is empty", async () => {
    const db = createDbClient();

    const selected = await selectMediaLibraryItem(db, {
      type: "bgm",
      requiredTags: ["war"],
      moodTags: ["tense"],
    });

    expect(selected).toBeNull();
  });

  it("breaks ties deterministically by library_item_id", async () => {
    const db = createDbClient();

    const itemA: MediaLibraryItem = {
      library_item_id: "bgm_z_item",
      type: "bgm",
      file_uri: "library://bgm/a.wav",
      mime_type: "audio/wav",
      duration_sec: 30,
      loopable: true,
      tags: ["war"],
      mood_tags: ["tense"],
      license: {
        license_type: "cc0",
        commercial_use_allowed: true,
        attribution_required: false,
      },
      file_hash: "sha256:za",
      imported_at: "2026-05-16T00:00:00.000Z",
      approved_for_use: true,
    };

    const itemB: MediaLibraryItem = {
      library_item_id: "bgm_a_item",
      type: "bgm",
      file_uri: "library://bgm/b.wav",
      mime_type: "audio/wav",
      duration_sec: 30,
      loopable: true,
      tags: ["war"],
      mood_tags: ["tense"],
      license: {
        license_type: "cc0",
        commercial_use_allowed: true,
        attribution_required: false,
      },
      file_hash: "sha256:zb",
      imported_at: "2026-05-16T00:00:00.000Z",
      approved_for_use: true,
    };

    // Save in reverse order to ensure sort is what picks the winner
    await saveMediaLibraryItem(db, itemA);
    await saveMediaLibraryItem(db, itemB);

    const selected = await selectMediaLibraryItem(db, {
      type: "bgm",
      requiredTags: ["war"],
      moodTags: ["tense"],
    });

    // Same mood score, so library_item_id asc wins: "bgm_a_item" < "bgm_z_item"
    expect(selected?.library_item_id).toBe("bgm_a_item");
  });
});

describe("media library repository", () => {
  it("saves and retrieves an item", async () => {
    const db = createDbClient();
    const saved = await saveMediaLibraryItem(db, approvedBgmItem);

    expect(saved).toEqual(approvedBgmItem);

    const items = await listMediaLibraryItems(db);
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual(approvedBgmItem);
  });

  it("lists all items", async () => {
    const db = createDbClient();
    await saveMediaLibraryItem(db, approvedBgmItem);
    await saveMediaLibraryItem(db, approvedSfxItem);

    const items = await listMediaLibraryItems(db);
    expect(items).toHaveLength(2);
  });
});
