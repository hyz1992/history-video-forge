import { describe, expect, it } from "vitest";

import { resolvePipelineStagePhase } from "../../frontend/src/composables/usePipelineStagePhase.js";

describe("resolvePipelineStagePhase", () => {
  it("treats server snapshot queries as loading, not generating", () => {
    expect(
      resolvePipelineStagePhase({
        isLoading: true,
        isGenerating: false,
        hasContent: false,
        loadError: null,
      }),
    ).toEqual({ kind: "loading" });
  });

  it("prefers generating over loading and errors while a stage job is running", () => {
    expect(
      resolvePipelineStagePhase({
        isLoading: true,
        isGenerating: true,
        hasContent: false,
        loadError: "transient_snapshot_error",
      }),
    ).toEqual({ kind: "generating" });
  });

  it("returns ready only after real content is available and no generation is running", () => {
    expect(
      resolvePipelineStagePhase({
        isLoading: false,
        isGenerating: false,
        hasContent: true,
        loadError: null,
      }),
    ).toEqual({ kind: "ready" });
  });

  it("returns empty only after querying finishes without content or a running job", () => {
    expect(
      resolvePipelineStagePhase({
        isLoading: false,
        isGenerating: false,
        hasContent: false,
        loadError: null,
      }),
    ).toEqual({ kind: "empty" });
  });
});
