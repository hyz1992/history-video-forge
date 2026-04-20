import { describe, expect, it, vi } from "vitest";

import { runScriptRunGraph } from "../../../backend/src/runtime/orchestration/script-run-graph.js";

const inputBundle = {
  topic_package: {
    topic_id: "topic-yanzi",
  },
} as any;

const passDraft = {
  script_text: "graph runner pass draft",
  estimated_duration_sec: 86,
  beat_trace: [],
  quote_trace: [],
  opening_span: "graph runner pass opening",
  ending_span: "graph runner pass ending",
};

const patchedDraft = {
  ...passDraft,
  script_text: "graph runner patched draft",
  opening_span: "patched opening",
};

const regeneratedDraft = {
  ...passDraft,
  script_text: "graph runner regenerated draft",
  opening_span: "regenerated opening",
};

function createPassLocalValidation() {
  return {
    stage: "script_local_validation" as const,
    decision: "pass" as const,
    hard_issues: [],
    soft_issues: [],
    summary: "local validation passed",
  };
}

function createRegenLocalValidation() {
  return {
    stage: "script_local_validation" as const,
    decision: "regen_once" as const,
    hard_issues: ["script_too_short"],
    soft_issues: [],
    summary: "local validation requests regenerate once",
  };
}

function createPassSemanticReview() {
  return {
    stage: "script_semantic_review" as const,
    decision: "pass" as const,
    patch_intent: null,
    hard_issues: [],
    soft_issues: [],
    patch_targets: [],
    summary: "semantic review passed",
    confidence: 0.9,
  };
}

function createPatchSemanticReview() {
  return {
    stage: "script_semantic_review" as const,
    decision: "patch_once" as const,
    patch_intent: "lift" as const,
    hard_issues: [],
    soft_issues: ["hook_kill_power_weak"],
    patch_targets: ["opening"],
    summary: "semantic review requests one patch",
    confidence: 0.82,
  };
}

describe("script run graph", () => {
  it("runs the base script-generate -> local-validate -> semantic-review path", async () => {
    const calls: string[] = [];

    const result = await runScriptRunGraph(
      {
        bundle: inputBundle,
        allowPatch: true,
        allowRegen: true,
      },
      {
        generateDraft: vi.fn(async () => {
          calls.push("script-generate");
          return passDraft;
        }),
        validateDraft: vi.fn(() => {
          calls.push("local-validate");
          return createPassLocalValidation();
        }),
        reviewSemantics: vi.fn(() => {
          calls.push("semantic-review");
          return createPassSemanticReview();
        }),
        patchDraft: vi.fn(async () => {
          calls.push("patch-once");
          return patchedDraft;
        }),
        regenerateDraft: vi.fn(async () => {
          calls.push("regen-once");
          return regeneratedDraft;
        }),
      },
    );

    expect(calls).toEqual([
      "script-generate",
      "local-validate",
      "semantic-review",
    ]);
    expect(result.draft).toEqual(passDraft);
    expect(result.localValidation.decision).toBe("pass");
    expect(result.semanticReview.decision).toBe("pass");
    expect(result.executionState).toEqual({
      patch_used: false,
      regenerate_used: false,
    });
  });

  it("allows patch_once only once and keeps the final response contract stable", async () => {
    const calls: string[] = [];
    const validateDraft = vi
      .fn()
      .mockImplementation(() => {
        calls.push("local-validate");
        return createPassLocalValidation();
      });
    const reviewSemantics = vi
      .fn()
      .mockImplementationOnce(() => {
        calls.push("semantic-review");
        return createPatchSemanticReview();
      })
      .mockImplementationOnce(() => {
        calls.push("semantic-review");
        return createPassSemanticReview();
      });

    const result = await runScriptRunGraph(
      {
        bundle: inputBundle,
        allowPatch: true,
        allowRegen: true,
      },
      {
        generateDraft: vi.fn(async () => {
          calls.push("script-generate");
          return passDraft;
        }),
        validateDraft,
        reviewSemantics,
        patchDraft: vi.fn(async () => {
          calls.push("patch-once");
          return patchedDraft;
        }),
        regenerateDraft: vi.fn(async () => {
          calls.push("regen-once");
          return regeneratedDraft;
        }),
      },
    );

    expect(calls).toEqual([
      "script-generate",
      "local-validate",
      "semantic-review",
      "patch-once",
      "local-validate",
      "semantic-review",
    ]);
    expect(result.draft).toEqual(patchedDraft);
    expect(result.localValidation.decision).toBe("pass");
    expect(result.semanticReview).toMatchObject({
      stage: "script_semantic_review",
      decision: "pass",
      patch_intent: "lift",
    });
    expect(result.executionState).toEqual({
      patch_used: true,
      regenerate_used: false,
    });
  });

  it("allows regen_once only once and reuses the formal generate callback", async () => {
    const calls: string[] = [];
    const generateDraft = vi
      .fn()
      .mockImplementationOnce(async () => {
        calls.push("script-generate");
        return passDraft;
      })
      .mockImplementationOnce(async () => {
        calls.push("script-generate");
        return regeneratedDraft;
      });
    const validateDraft = vi
      .fn()
      .mockImplementationOnce(() => {
        calls.push("local-validate");
        return createRegenLocalValidation();
      })
      .mockImplementationOnce(() => {
        calls.push("local-validate");
        return createPassLocalValidation();
      });

    const result = await runScriptRunGraph(
      {
        bundle: inputBundle,
        allowPatch: true,
        allowRegen: true,
      },
      {
        generateDraft,
        validateDraft,
        reviewSemantics: vi.fn(() => {
          calls.push("semantic-review");
          return createPassSemanticReview();
        }),
        patchDraft: vi.fn(async () => {
          calls.push("patch-once");
          return patchedDraft;
        }),
        regenerateDraft: vi.fn(async ({ generateDraft: rerunGenerateDraft }) => {
          calls.push("regen-once");
          return rerunGenerateDraft();
        }),
      },
    );

    expect(calls).toEqual([
      "script-generate",
      "local-validate",
      "regen-once",
      "script-generate",
      "local-validate",
      "semantic-review",
    ]);
    expect(generateDraft).toHaveBeenCalledTimes(2);
    expect(result.draft).toEqual(regeneratedDraft);
    expect(result.localValidation.decision).toBe("pass");
    expect(result.semanticReview.decision).toBe("pass");
    expect(result.executionState).toEqual({
      patch_used: false,
      regenerate_used: true,
    });
  });
});
