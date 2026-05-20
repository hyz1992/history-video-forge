import { describe, expect, it } from "vitest";

import { DEFAULT_AUDIO_LIBRARY_ITEMS } from "../../../backend/src/modules/assets/default-audio-library.js";
import { MediaLibraryItem } from "../../../shared/src/index.js";

describe("default audio library seed", () => {
  it("contains a small reviewable BGM/SFX starter set", () => {
    const bgm = DEFAULT_AUDIO_LIBRARY_ITEMS.filter((item) => item.type === "bgm");
    const sfx = DEFAULT_AUDIO_LIBRARY_ITEMS.filter((item) => item.type === "sfx");

    expect(bgm.length).toBeGreaterThanOrEqual(5);
    expect(sfx.length).toBeGreaterThanOrEqual(10);
  });

  it("uses approved commercial-use items with license evidence", () => {
    for (const item of DEFAULT_AUDIO_LIBRARY_ITEMS) {
      expect(() => MediaLibraryItem.parse(item)).not.toThrow();
      expect(item.approved_for_use).toBe(true);
      expect(item.license.commercial_use_allowed).toBe(true);
      expect(item.license.source_url).toMatch(/^https?:\/\//);
      expect(item.file_hash).toMatch(/^sha256:/);
    }
  });

  it("keeps selector-facing tags explicit", () => {
    expect(
      DEFAULT_AUDIO_LIBRARY_ITEMS.filter((item) => item.type === "bgm").every(
        (item) => item.tags.includes("background"),
      ),
    ).toBe(true);

    expect(
      DEFAULT_AUDIO_LIBRARY_ITEMS.filter((item) => item.type === "sfx").every(
        (item) => item.tags.length > 0,
      ),
    ).toBe(true);
  });
});
