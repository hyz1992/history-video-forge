import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import { createDbClient } from "../../../backend/src/db/client.js";
import { loadLightweightBgmCatalogItems } from "../../../backend/src/modules/assets/lightweight-audio-catalog-loader.js";
import { saveMediaLibraryItem } from "../../../backend/src/modules/assets/media-library.repository.js";
import { selectMediaLibraryItem } from "../../../backend/src/modules/assets/media-library-selector.js";
import { MediaLibraryItem } from "../../../shared/src/index.js";

describe("loadLightweightBgmCatalogItems", () => {
  it("maps generated lightweight BGM entries to selectable media library items", async () => {
    const root = await mkdtemp(join(tmpdir(), "lightweight-bgm-catalog-"));
    try {
      const catalogPath = join(root, "ai-bgm-prompt-candidates.json");
      await writeFile(
        catalogPath,
        JSON.stringify({
          schema_version: "ai_bgm_prompt_candidates_light_v1",
          generated_at: "2026-05-21T00:00:00.000Z",
          items: [
            {
              library_item_id: "bgm_hist_test_001",
              type: "bgm",
              status: "generated_pending_review",
              file_uri: "storage/media-library/audio/bgm/bgm_hist_test_001.wav",
              mime_type: "audio/wav",
              duration_sec: 90,
              file_hash:
                "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              loopable: true,
              tags: ["background", "historical"],
              mood_tags: ["solemn", "low_intrusion"],
              title: "Test BGM",
            },
          ],
        }),
      );

      const items = await loadLightweightBgmCatalogItems(catalogPath);

      expect(items).toHaveLength(1);
      expect(() => MediaLibraryItem.parse(items[0])).not.toThrow();
      expect(items[0]).toMatchObject({
        library_item_id: "bgm_hist_test_001",
        type: "bgm",
        file_uri: "storage/media-library/audio/bgm/bgm_hist_test_001.wav",
        license: {
          license_type: "provider_generated",
          commercial_use_allowed: true,
          attribution_required: false,
        },
        approved_for_use: true,
      });

      const db = createDbClient();
      await saveMediaLibraryItem(db, items[0]!);
      const selected = await selectMediaLibraryItem(db, {
        type: "bgm",
        requiredTags: ["background"],
        moodTags: ["solemn"],
      });

      expect(selected?.library_item_id).toBe("bgm_hist_test_001");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("skips prompt-only or incomplete lightweight entries", async () => {
    const root = await mkdtemp(join(tmpdir(), "lightweight-bgm-catalog-"));
    try {
      const catalogPath = join(root, "ai-bgm-prompt-candidates.json");
      await writeFile(
        catalogPath,
        JSON.stringify({
          schema_version: "ai_bgm_prompt_candidates_light_v1",
          generated_at: "2026-05-21T00:00:00.000Z",
          items: [
            {
              library_item_id: "bgm_prompt_only",
              type: "bgm",
              status: "prompt_only",
              file_uri: "",
              mime_type: "",
              duration_sec: null,
              file_hash: "",
              loopable: true,
              tags: ["background"],
              mood_tags: ["solemn"],
            },
            {
              library_item_id: "sfx_wrong_type",
              type: "sfx",
              status: "generated_pending_review",
              file_uri: "storage/media-library/audio/sfx/sfx.wav",
              mime_type: "audio/wav",
              duration_sec: 1,
              file_hash:
                "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              loopable: false,
              tags: ["hit"],
              mood_tags: ["impact"],
            },
          ],
        }),
      );

      await expect(loadLightweightBgmCatalogItems(catalogPath)).resolves.toEqual(
        [],
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
