import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  parseBgmSmokeBatchCliArgs,
  renderBgmSmokeBatch,
} from "../../../harness/scripts/media-library/render-bgm-smoke-batch";

describe("renderBgmSmokeBatch", () => {
  it("runs smoke once per passed BGM entry and writes a batch report", async () => {
    const root = await mkdtemp(join(tmpdir(), "bgm-smoke-batch-"));
    try {
      const catalogPath = join(root, "ai-bgm-prompt-candidates.json");
      const outputDir = join(root, "batch-output");
      await writeFile(
        catalogPath,
        JSON.stringify({
          generated_at: "2026-05-21T00:00:00.000Z",
          items: [
            makeCatalogItem("bgm_one", 0.16),
            makeCatalogItem("bgm_two", 0.2),
            {
              ...makeCatalogItem("bgm_reject", 0.16),
              review: { manual_decision: "reject" },
            },
          ],
        }),
      );

      const calls: Array<{ bgmLibraryItemId?: string; outputDir?: string }> = [];
      const report = await renderBgmSmokeBatch({
        catalogPath,
        outputDir,
        adapter: "fake",
        runSmoke: async (input) => {
          calls.push(input);
          await mkdir(input.outputDir!, { recursive: true });
          await writeFile(
            join(input.outputDir!, "render-response.json"),
            JSON.stringify({
              output_artifact: {
                file_uri: join(input.outputDir!, "output.mp4"),
              },
            }),
          );
          return {
            outputDir: input.outputDir!,
            status: {
              generatedAt: "2026-05-21T01:00:00.000Z",
              status: "sample-ready",
              stage: "compose-to-render",
              projectId: input.bgmLibraryItemId!,
              outputDir: input.outputDir!,
              activeAssetsAfterGenerate: "assets",
              activeComposeAfterGenerate: "compose",
              activeRenderAfterGenerate: "render",
              activeComposeAfterRefresh: "compose_refresh",
              activeRenderAfterComposeRefresh: null,
            },
          };
        },
      });

      expect(calls.map((call) => call.bgmLibraryItemId)).toEqual([
        "bgm_one",
        "bgm_two",
      ]);
      expect(report.summary).toMatchObject({
        total_requested: 2,
        succeeded: 2,
        failed: 0,
      });
      expect(report.items.map((item) => item.library_item_id)).toEqual([
        "bgm_one",
        "bgm_two",
      ]);
      expect(report.items[0]).toMatchObject({
        status: "succeeded",
        output_file: join(outputDir, "bgm_one", "output.mp4"),
        volume_hint: 0.16,
      });

      const persisted = JSON.parse(
        await readFile(join(outputDir, "bgm-smoke-batch-report.json"), "utf8"),
      ) as typeof report;
      expect(persisted.summary.succeeded).toBe(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("honors the limit before running smoke", async () => {
    const root = await mkdtemp(join(tmpdir(), "bgm-smoke-batch-"));
    try {
      const catalogPath = join(root, "ai-bgm-prompt-candidates.json");
      await writeFile(
        catalogPath,
        JSON.stringify({
          items: [makeCatalogItem("bgm_one", 0.16), makeCatalogItem("bgm_two", 0.2)],
        }),
      );

      const report = await renderBgmSmokeBatch({
        catalogPath,
        outputDir: join(root, "batch-output"),
        adapter: "fake",
        limit: 1,
        runSmoke: async (input) => ({
          outputDir: input.outputDir!,
          status: {
            generatedAt: "2026-05-21T01:00:00.000Z",
            status: "sample-ready",
            stage: "compose-to-render",
            projectId: input.bgmLibraryItemId!,
            outputDir: input.outputDir!,
            activeAssetsAfterGenerate: "assets",
            activeComposeAfterGenerate: "compose",
            activeRenderAfterGenerate: "render",
            activeComposeAfterRefresh: "compose_refresh",
            activeRenderAfterComposeRefresh: null,
          },
        }),
      });

      expect(report.items.map((item) => item.library_item_id)).toEqual([
        "bgm_one",
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("parses adapter and limit positionals when npm strips option flags", () => {
    expect(parseBgmSmokeBatchCliArgs(["fake", "2"])).toMatchObject({
      adapter: "fake",
      limit: 2,
    });
  });
});

function makeCatalogItem(libraryItemId: string, volumeHint: number) {
  return {
    library_item_id: libraryItemId,
    type: "bgm",
    status: "generated_pending_review",
    file_uri: `storage/media-library/audio/bgm/${libraryItemId}.wav`,
    mime_type: "audio/wav",
    duration_sec: 90,
    file_hash:
      "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    loopable: true,
    tags: ["background", "historical"],
    mood_tags: ["solemn"],
    volume_hint: volumeHint,
    review: { manual_decision: "pass", notes: "" },
  };
}
