import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  parseRenderRuntimeSmokeCliArgs,
  runRenderRuntimeSmoke,
} from "../../harness/scripts/runtime/render-runtime-smoke";
import { createToneWavBuffer } from "../../backend/src/modules/assets/providers/audio-fixture";

describe("render runtime smoke harness", () => {
  it("runs assets to compose to render and clears stale render after compose refresh", async () => {
    const outputDir = mkdtempSync(join(tmpdir(), "svf2-render-runtime-smoke-"));

    const result = await runRenderRuntimeSmoke({ outputDir });

    expect(result.status.stage).toBe("compose-to-render");
    expect(result.status.status).toBe("sample-ready");
    expect(result.status.activeComposeAfterGenerate).toBeTruthy();
    expect(result.status.activeRenderAfterGenerate).toBeTruthy();
    expect(result.status.activeComposeAfterRefresh).toBeTruthy();
    expect(result.status.activeRenderAfterComposeRefresh).toBeNull();

    for (const filename of [
      "assets-snapshot.json",
      "compose-snapshot.json",
      "render-snapshot.json",
      "compose-refresh-snapshot.json",
      "status.json",
      "trace.md",
    ]) {
      expect(existsSync(join(outputDir, filename))).toBe(true);
    }

    const renderSnapshot = JSON.parse(
      readFileSync(join(outputDir, "render-snapshot.json"), "utf8"),
    ) as {
      active_render: { render_job_record_id: string } | null;
      trace_summary: { latest_render_run: { phase: string } | null };
    };
    expect(renderSnapshot.active_render?.render_job_record_id).toBe(
      result.status.activeRenderAfterGenerate,
    );
    expect(renderSnapshot.trace_summary.latest_render_run?.phase).toBe("render");

    const composeRefreshSnapshot = JSON.parse(
      readFileSync(join(outputDir, "compose-refresh-snapshot.json"), "utf8"),
    ) as {
      active_render: unknown;
      trace_summary: { latest_render_run: unknown };
    };
    expect(composeRefreshSnapshot.active_render).toBeNull();
    expect(composeRefreshSnapshot.trace_summary.latest_render_run).toBeNull();
  });

  it("registers the smoke command in package.json", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts["harness:render-runtime-smoke"]).toBe(
      "tsx harness/scripts/runtime/render-runtime-smoke.ts",
    );
  });

  it("parses positional BGM id when npm strips option flags", () => {
    expect(
      parseRenderRuntimeSmokeCliArgs([
        "--adapter=remotion",
        "bgm_hist_reflective_ending_001",
      ]),
    ).toMatchObject({
      adapter: "remotion",
      bgmLibraryItemId: "bgm_hist_reflective_ending_001",
    });
  });

  it("parses the DashScope TTS provider option", () => {
    expect(
      parseRenderRuntimeSmokeCliArgs([
        "--adapter=remotion",
        "--tts-provider",
        "dashscope_tts",
      ]),
    ).toMatchObject({
      adapter: "remotion",
      ttsProvider: "dashscope_tts",
    });
  });

  it("can run runtime smoke with DashScope TTS and local fake visuals", async () => {
    const outputDir = mkdtempSync(join(tmpdir(), "svf2-render-dashscope-tts-smoke-"));
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const urlText = String(url);
      const headers = new Headers(init?.headers);
      if (urlText.startsWith("https://dashscope.test/")) {
        expect(headers.get("authorization")).toBe("Bearer test-key");
      }

      if (urlText.endsWith("/api/v1/services/aigc/multimodal-generation/generation")) {
        expect(headers.get("x-dashscope-async")).toBe("disable");
        return new Response(
          JSON.stringify({
            output: {
              audio: {
                url: "https://example.test/audio.wav",
              },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (urlText === "https://example.test/audio.wav") {
        return new Response(createToneWavBuffer({ durationSec: 1 }), {
          status: 200,
          headers: { "content-type": "audio/wav" },
        });
      }

      throw new Error(`unexpected fetch: ${urlText}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await runRenderRuntimeSmoke({
      outputDir,
      ttsProvider: "dashscope_tts",
      dashscope: {
        apiKey: "test-key",
        baseUrl: "https://dashscope.test",
      },
    });

    const assetsResponse = JSON.parse(
      readFileSync(join(outputDir, "assets-response.json"), "utf8"),
    ) as {
      manifest?: {
        artifacts?: Array<{
          artifact_type: string;
          metadata?: { provider_name?: string };
        }>;
      };
    };

    expect(
      assetsResponse.manifest?.artifacts?.some(
        (artifact) => artifact.metadata?.provider_name === "dashscope_tts",
      ),
    ).toBe(true);
    expect(
      assetsResponse.manifest?.artifacts?.some(
        (artifact) => artifact.artifact_type === "image",
      ),
    ).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uses the requested BGM id when provided", async () => {
    const outputDir = mkdtempSync(join(tmpdir(), "svf2-render-bgm-id-smoke-"));

    await runRenderRuntimeSmoke({
      outputDir,
      bgmLibraryItemId: "bgm_hist_reflective_ending_001",
    });

    const assetsResponse = JSON.parse(
      readFileSync(join(outputDir, "assets-response.json"), "utf8"),
    ) as {
      manifest?: {
        artifacts?: Array<{
          artifact_type: string;
          metadata?: { library_item_id?: string };
        }>;
      };
    };

    expect(
      assetsResponse.manifest?.artifacts?.some(
        (artifact) =>
          artifact.artifact_type === "bgm_audio" &&
          artifact.metadata?.library_item_id ===
            "bgm_hist_reflective_ending_001",
      ),
    ).toBe(true);
  });

  it("fails when an explicitly requested BGM id is unavailable", async () => {
    const outputDir = mkdtempSync(join(tmpdir(), "svf2-render-bgm-missing-"));

    await expect(
      runRenderRuntimeSmoke({
        outputDir,
        bgmLibraryItemId: "bgm_missing_or_not_passed",
      }),
    ).rejects.toThrow("smoke_bgm_not_found: bgm_missing_or_not_passed");
  });

  it("runs the Remotion adapter smoke path and writes an MP4 output", async () => {
    const outputDir = mkdtempSync(join(tmpdir(), "svf2-render-remotion-smoke-"));

    const result = await runRenderRuntimeSmoke({
      adapter: "remotion",
      outputDir,
    });

    expect(result.status.stage).toBe("compose-to-render");
    expect(result.status.activeRenderAfterGenerate).toBeTruthy();

    const renderResponse = JSON.parse(
      readFileSync(join(outputDir, "render-response.json"), "utf8"),
    ) as {
      output_artifact: {
        file_uri: string;
        mime_type: string;
      };
      runtime_diagnostics: {
        renderer?: string;
        audio_clip_count?: number;
        visual_clip_count?: number;
        subtitle_cue_count?: number;
      };
    };
    expect(renderResponse.output_artifact.mime_type).toBe("video/mp4");
    expect(renderResponse.runtime_diagnostics.renderer).toBe("remotion");
    expect(
      renderResponse.runtime_diagnostics.audio_clip_count,
    ).toBeGreaterThanOrEqual(3);
    expect(
      renderResponse.runtime_diagnostics.visual_clip_count,
    ).toBeGreaterThan(0);
    expect(
      renderResponse.runtime_diagnostics.subtitle_cue_count,
    ).toBeGreaterThan(0);
    expect(existsSync(renderResponse.output_artifact.file_uri)).toBe(true);

    const assetsResponse = JSON.parse(
      readFileSync(join(outputDir, "assets-response.json"), "utf8"),
    ) as {
      manifest?: {
        artifacts?: Array<{
          artifact_id: string;
          artifact_type: string;
          metadata?: { library_item_id?: string };
        }>;
        audio_summary?: {
          bgm_placements?: Array<{
            artifact_id: string | null;
            volume?: number;
          }>;
        };
      };
    };
    const artifactTypes =
      assetsResponse.manifest?.artifacts?.map(
        (artifact) => artifact.artifact_type,
      ) ?? [];
    expect(artifactTypes).toContain("bgm_audio");
    expect(artifactTypes).toContain("sfx_audio");
    const smokeBgmArtifact = assetsResponse.manifest?.artifacts?.find(
      (artifact) =>
        artifact.artifact_type === "bgm_audio" &&
        artifact.metadata?.library_item_id ===
          "bgm_hist_ancient_china_solemn_001",
    );
    expect(smokeBgmArtifact).toBeTruthy();
    const smokeBgmPlacement =
      assetsResponse.manifest?.audio_summary?.bgm_placements?.find(
        (placement) =>
          placement.artifact_id === smokeBgmArtifact?.artifact_id,
      );
    expect(smokeBgmPlacement?.volume).toBeCloseTo(0.16, 3);
    expect(
      assetsResponse.manifest?.artifacts?.some(
        (artifact) =>
          artifact.artifact_type === "sfx_audio" &&
          artifact.metadata?.library_item_id === "sfx_hit_sharp_001",
      ),
    ).toBe(true);
  }, 180_000);
});
