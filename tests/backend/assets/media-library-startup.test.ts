import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { buildApp } from "../../../backend/src/app.js";

function catalogItem(id: string) {
  return {
    library_item_id: id,
    type: "bgm",
    file_uri: `storage/media-library/audio/bgm/${id}.wav`,
    mime_type: "audio/wav",
    duration_sec: 3,
    loopable: true,
    tags: ["test"],
    mood_tags: ["calm"],
    license: {
      license_type: "cc0",
      commercial_use_allowed: true,
      attribution_required: false,
    },
    file_hash: `sha256:${id}`,
    imported_at: "2026-07-10T00:00:00.000Z",
    approved_for_use: true,
  };
}

describe("media library startup", () => {
  it("loads catalog items into the app database at startup", () => {
    const root = mkdtempSync(join(tmpdir(), "svf2-media-startup-"));
    mkdirSync(join(root, "storage", "media-library"), { recursive: true });
    writeFileSync(join(root, "storage", "media-library", "catalog.json"), JSON.stringify({
      schema_version: "media_library_catalog_v1",
      items: [catalogItem("bgm_test_001"), catalogItem("bgm_test_002")],
    }), "utf8");

    const app = buildApp({ storageBaseDir: root, skipSnapshotLoad: true });

    expect(app.db.mediaLibraryItems.size).toBe(2);
    expect(app.mediaLibraryHealth).toMatchObject({ loaded: true, error: null });
  });

  it("records a strict catalog parse failure for readiness", () => {
    const root = mkdtempSync(join(tmpdir(), "svf2-media-invalid-"));
    mkdirSync(join(root, "storage", "media-library"), { recursive: true });
    writeFileSync(join(root, "storage", "media-library", "catalog.json"), "{broken", "utf8");

    const app = buildApp({ storageBaseDir: root, skipSnapshotLoad: true });

    expect(app.db.mediaLibraryItems.size).toBe(0);
    expect(app.mediaLibraryHealth).toMatchObject({ loaded: false, error: expect.any(String) });
  });
});
