import { describe, expect, it, vi } from "vitest";

import { reviewScriptSemantics } from "../../../backend/src/modules/script/script-semantic-review.service.js";
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
    errors: [],
    warnings: [],
    metrics: {},
  };
}

function createRegenLocalValidation() {
  return {
    stage: "script_local_validation" as const,
    decision: "regen_once" as const,
    errors: ["script_body_too_thin"],
    warnings: [],
    metrics: {
      script_char_count: 67,
      script_sentence_count: 3,
      min_script_chars_for_band: 240,
      min_sentence_count_for_band: 7,
    },
  };
}

function createHardFailLocalValidation() {
  return {
    stage: "script_local_validation" as const,
    decision: "hard_fail" as const,
    errors: ["duration_extreme"],
    warnings: [],
    metrics: {},
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
    expect(result.graphTraceSummary).toMatchObject({
      phase: "script",
      run_id: expect.stringMatching(/^script_run_/),
    });
    expect(result.graphTraceSummary.steps).toEqual([
      expect.objectContaining({
        step_name: "script-generate",
        phase: "script",
        status: "succeeded",
        started_at: expect.any(String),
        ended_at: expect.any(String),
        duration_ms: expect.any(Number),
      }),
      expect.objectContaining({
        step_name: "local-validate",
        phase: "script",
        status: "succeeded",
        started_at: expect.any(String),
        ended_at: expect.any(String),
        duration_ms: expect.any(Number),
      }),
      expect.objectContaining({
        step_name: "semantic-review",
        phase: "script",
        status: "succeeded",
        started_at: expect.any(String),
        ended_at: expect.any(String),
        duration_ms: expect.any(Number),
      }),
    ]);
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
        regenerateDraft: vi.fn(async (regenInput) => {
          calls.push("regen-once");
          const { generateDraft: rerunGenerateDraft, localValidation } = regenInput;
          expect(localValidation).toMatchObject({
            decision: "regen_once",
            errors: ["script_body_too_thin"],
            metrics: {
              script_char_count: 67,
              script_sentence_count: 3,
              min_script_chars_for_band: 240,
              min_sentence_count_for_band: 7,
            },
          });
          expect(regenInput).toMatchObject({
            draft: passDraft,
          });
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

  it("records a diagnostic when thin regen returns unchanged script text", async () => {
    const calls: string[] = [];
    const unchangedThinDraft = {
      ...passDraft,
      script_text: "same thin script text",
      opening_span: "same thin opening",
    };
    const generateDraft = vi.fn(async () => {
      calls.push("script-generate");
      return unchangedThinDraft;
    });
    const validateDraft = vi.fn(() => {
      calls.push("local-validate");
      return createRegenLocalValidation();
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
    ]);
    expect(result.draft).toEqual(unchangedThinDraft);
    expect(result.localValidation.decision).toBe("regen_once");
    expect(result.runtimeDiagnostics.checks).toContainEqual(
      expect.objectContaining({
        code: "regen_output_unchanged_after_thin_context",
        level: "warning",
      }),
    );
  });

  it("records a diagnostic when thin regen changes output but remains too thin", async () => {
    const calls: string[] = [];
    const initialThinDraft = {
      ...passDraft,
      script_text: "initial thin script text",
      opening_span: "initial thin opening",
    };
    const changedStillThinDraft = {
      ...passDraft,
      script_text: "changed but still thin script text",
      opening_span: "changed thin opening",
    };
    const generateDraft = vi
      .fn()
      .mockImplementationOnce(async () => {
        calls.push("script-generate");
        return initialThinDraft;
      })
      .mockImplementationOnce(async () => {
        calls.push("script-generate");
        return changedStillThinDraft;
      });
    const validateDraft = vi.fn(() => {
      calls.push("local-validate");
      return createRegenLocalValidation();
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
    ]);
    expect(result.draft).toEqual(changedStillThinDraft);
    expect(result.localValidation.decision).toBe("regen_once");
    expect(result.runtimeDiagnostics.checks).toContainEqual(
      expect.objectContaining({
        code: "regen_output_still_too_thin_after_repair_context",
        level: "warning",
      }),
    );
    expect(result.runtimeDiagnostics.checks).not.toContainEqual(
      expect.objectContaining({
        code: "regen_output_unchanged_after_thin_context",
      }),
    );
  });

  it("forces one explicit regen run when the caller requests manual regen", async () => {
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

    const result = await runScriptRunGraph(
      {
        bundle: inputBundle,
        allowPatch: false,
        allowRegen: true,
        forceRegen: true,
      },
      {
        generateDraft,
        validateDraft: vi
          .fn()
          .mockImplementation(() => {
            calls.push("local-validate");
            return createPassLocalValidation();
          }),
        reviewSemantics: vi
          .fn()
          .mockImplementation(() => {
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
      "semantic-review",
      "regen-once",
      "script-generate",
      "local-validate",
      "semantic-review",
    ]);
    expect(result.draft).toEqual(regeneratedDraft);
    expect(result.executionState).toEqual({
      patch_used: false,
      regenerate_used: true,
    });
  });

  it("does not expose semantic pass when local validation hard-fails before semantic review", async () => {
    const reviewSemantics = vi.fn(() => {
      throw new Error("semantic review should not run");
    });

    const result = await runScriptRunGraph(
      {
        bundle: inputBundle,
        allowPatch: true,
        allowRegen: false,
      },
      {
        generateDraft: vi.fn(async () => passDraft),
        validateDraft: vi.fn(() => createHardFailLocalValidation()),
        reviewSemantics,
        patchDraft: vi.fn(async () => patchedDraft),
        regenerateDraft: vi.fn(async () => regeneratedDraft),
      },
    );

    expect(reviewSemantics).not.toHaveBeenCalled();
    expect(result.localValidation.decision).toBe("hard_fail");
    expect(result.semanticReview.decision).toBe("skipped");
    expect(result.semanticReview.summary).toContain("未进入语义审校");
    expect(result.runtimeDiagnostics.checks).toContainEqual(
      expect.objectContaining({
        code: "semantic_review_skipped",
        level: "warning",
      }),
    );
    expect(result.runtimeDiagnostics.checks).not.toContainEqual(
      expect.objectContaining({
        code: "semantic_review_passed",
      }),
    );
  });

  it("keeps the no-reviewer semantic step skipped instead of driving patch_once", async () => {
    const calls: string[] = [];
    const reviewSemantics = vi.fn((reviewInput) => {
      calls.push("semantic-review");
      return reviewScriptSemantics(reviewInput as any);
    });
    const patchDraft = vi.fn(async () => {
      calls.push("patch-once");
      return patchedDraft;
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
        validateDraft: vi.fn(() => {
          calls.push("local-validate");
          return createPassLocalValidation();
        }),
        reviewSemantics,
        patchDraft,
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
    expect(patchDraft).not.toHaveBeenCalled();
    expect(result.semanticReview).toMatchObject({
      stage: "script_semantic_review",
      decision: "skipped",
      patch_intent: null,
      hard_issues: [],
      soft_issues: [],
      patch_targets: [],
    });
    expect(result.semanticReview.soft_issues).not.toContain(
      "hook_kill_power_weak",
    );
    expect(result.runtimeDiagnostics.checks).toContainEqual(
      expect.objectContaining({
        code: "semantic_review_skipped",
        level: "warning",
      }),
    );
    expect(result.runtimeDiagnostics.checks).not.toContainEqual(
      expect.objectContaining({
        code: "patch_once",
      }),
    );
  });

  it("auto-triggers one local-repair regen by default when local validation returns regen_once", async () => {
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
      },
      {
        generateDraft,
        validateDraft,
        reviewSemantics: vi.fn(() => {
          calls.push("semantic-review");
          return createPassSemanticReview();
        }),
        patchDraft: vi.fn(async () => patchedDraft),
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
    expect(result.draft).toEqual(regeneratedDraft);
    expect(result.localValidation.decision).toBe("pass");
    expect(result.executionState).toEqual({
      patch_used: false,
      regenerate_used: true,
    });
  });

  it("stops after one auto local-repair regen when the second draft still returns regen_once, and surfaces the layered summary", async () => {
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
    const validateDraft = vi.fn(() => {
      calls.push("local-validate");
      return createRegenLocalValidation();
    });

    const result = await runScriptRunGraph(
      {
        bundle: inputBundle,
      },
      {
        generateDraft,
        validateDraft,
        reviewSemantics: vi.fn(() => {
          throw new Error("semantic review should not run");
        }),
        patchDraft: vi.fn(async () => patchedDraft),
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
    ]);
    expect(result.draft).toEqual(regeneratedDraft);
    expect(result.localValidation.decision).toBe("regen_once");
    expect(result.executionState).toEqual({
      patch_used: false,
      regenerate_used: true,
    });
    expect(result.semanticReview.decision).toBe("skipped");
    expect(result.semanticReview.summary).toContain("已自动重新生成一次");
    expect(result.runtimeDiagnostics.checks).toContainEqual(
      expect.objectContaining({
        code: "regen_output_still_too_thin_after_repair_context",
        level: "warning",
      }),
    );
  });

  it("respects allowLocalRepairRegen=false to disable the auto local-repair regen", async () => {
    const calls: string[] = [];
    const regenerateDraft = vi.fn(async () => {
      calls.push("regen-once");
      return regeneratedDraft;
    });

    const result = await runScriptRunGraph(
      {
        bundle: inputBundle,
        allowLocalRepairRegen: false,
      },
      {
        generateDraft: vi.fn(async () => {
          calls.push("script-generate");
          return passDraft;
        }),
        validateDraft: vi.fn(() => {
          calls.push("local-validate");
          return createRegenLocalValidation();
        }),
        reviewSemantics: vi.fn(() => {
          throw new Error("semantic review should not run");
        }),
        patchDraft: vi.fn(async () => patchedDraft),
        regenerateDraft,
      },
    );

    expect(calls).toEqual(["script-generate", "local-validate"]);
    expect(regenerateDraft).not.toHaveBeenCalled();
    expect(result.localValidation.decision).toBe("regen_once");
    expect(result.executionState.regenerate_used).toBe(false);
    expect(result.semanticReview.decision).toBe("skipped");
    expect(result.semanticReview.summary).toContain("未达到本地结构下限");
  });
});
