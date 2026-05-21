import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  parseBgmReviewCliArgs,
  updateBgmReview,
} from "../../../harness/scripts/media-library/update-bgm-review";

describe("updateBgmReview", () => {
  it("updates the review decision and notes for a single BGM entry", async () => {
    const root = await mkdtemp(join(tmpdir(), "bgm-review-update-"));
    try {
      const catalogPath = join(root, "ai-bgm-prompt-candidates.json");
      await writeFile(
        catalogPath,
        JSON.stringify({
          items: [
            {
              library_item_id: "bgm_keep",
              type: "bgm",
              review: { manual_decision: "pass", notes: "old" },
            },
            {
              library_item_id: "bgm_target",
              type: "bgm",
              review: { manual_decision: "pass", notes: "old target" },
            },
          ],
        }),
      );

      const result = await updateBgmReview({
        catalogPath,
        libraryItemId: "bgm_target",
        decision: "reject",
        notes: "too modern",
      });

      expect(result).toEqual({
        library_item_id: "bgm_target",
        previous_decision: "pass",
        decision: "reject",
      });

      const catalog = JSON.parse(await readFile(catalogPath, "utf8")) as {
        items: Array<{
          library_item_id: string;
          review?: { manual_decision?: string; notes?: string };
        }>;
      };
      expect(catalog.items[0]?.review).toEqual({
        manual_decision: "pass",
        notes: "old",
      });
      expect(catalog.items[1]?.review).toEqual({
        manual_decision: "reject",
        notes: "too modern",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("clears the review decision when decision is clear", async () => {
    const root = await mkdtemp(join(tmpdir(), "bgm-review-update-"));
    try {
      const catalogPath = join(root, "ai-bgm-prompt-candidates.json");
      await writeFile(
        catalogPath,
        JSON.stringify({
          items: [
            {
              library_item_id: "bgm_target",
              type: "bgm",
              review: { manual_decision: "pass", notes: "accepted" },
            },
          ],
        }),
      );

      await updateBgmReview({
        catalogPath,
        libraryItemId: "bgm_target",
        decision: "clear",
      });

      const catalog = JSON.parse(await readFile(catalogPath, "utf8")) as {
        items: Array<{ review?: { manual_decision?: string; notes?: string } }>;
      };
      expect(catalog.items[0]?.review).toEqual({
        manual_decision: "",
        notes: "",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails when the target library item is missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "bgm-review-update-"));
    try {
      const catalogPath = join(root, "ai-bgm-prompt-candidates.json");
      await writeFile(catalogPath, JSON.stringify({ items: [] }));

      await expect(
        updateBgmReview({
          catalogPath,
          libraryItemId: "missing",
          decision: "hold",
        }),
      ).rejects.toThrow("bgm_item_not_found: missing");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("parses positional arguments when npm strips option flags", () => {
    expect(
      parseBgmReviewCliArgs([
        "tmp/catalog.json",
        "bgm_target",
        "reject",
        "too modern",
      ]),
    ).toEqual({
      catalogPath: "tmp/catalog.json",
      libraryItemId: "bgm_target",
      decision: "reject",
      notes: "too modern",
    });
  });
});
