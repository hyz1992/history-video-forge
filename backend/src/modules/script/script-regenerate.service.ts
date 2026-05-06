import { ScriptDraftPackage } from "../../../../shared/src/index.js";

interface ScriptInputBundleInput {
  hard_lane: {
    event_identity: string;
  };
}

interface ScriptDraftInput {
  script_text?: unknown;
  beat_trace?: unknown;
  opening_span?: unknown;
  ending_span?: unknown;
}

export interface RegenerateScriptDraftInput {
  bundle: ScriptInputBundleInput;
  draft?: ScriptDraftInput;
  regenerateUsed: boolean;
  localValidation?: {
    decision?: unknown;
    errors?: unknown[];
    warnings?: unknown[];
    metrics?: Record<string, unknown>;
  };
  generateDraft: (input?: {
    regenerationContext?: {
      reason: "local_validation_regen_once";
      errors: string[];
      metrics: Record<string, unknown>;
      previous_draft?: {
        script_text_excerpt: string;
        opening_span: string;
        ending_span: string;
        beat_trace_summary: Array<{
          beat: string;
          excerpt: string;
        }>;
      };
    };
  }) => Promise<unknown>;
}

export async function regenerateScriptDraft(
  input: RegenerateScriptDraftInput,
) {
  if (input.regenerateUsed) {
    throw new Error("regen_once opportunity already consumed");
  }

  const regenerated = await input.generateDraft({
    regenerationContext: {
      reason: "local_validation_regen_once",
      errors: (input.localValidation?.errors ?? []).filter(
        (error): error is string => typeof error === "string",
      ),
      metrics: input.localValidation?.metrics ?? {},
      previous_draft: buildPreviousDraftSummary(input.draft),
    },
  });
  return ScriptDraftPackage.parse(regenerated);
}

function buildPreviousDraftSummary(draft: ScriptDraftInput | undefined) {
  if (!draft) {
    return undefined;
  }

  return {
    script_text_excerpt:
      typeof draft.script_text === "string"
        ? draft.script_text.trim().slice(0, 500)
        : "",
    opening_span:
      typeof draft.opening_span === "string" ? draft.opening_span : "",
    ending_span: typeof draft.ending_span === "string" ? draft.ending_span : "",
    beat_trace_summary: Array.isArray(draft.beat_trace)
      ? draft.beat_trace
          .map((trace) => {
            if (!trace || typeof trace !== "object") {
              return null;
            }

            const record = trace as Record<string, unknown>;
            if (
              typeof record.beat !== "string" ||
              typeof record.excerpt !== "string"
            ) {
              return null;
            }

            return {
              beat: record.beat,
              excerpt: record.excerpt,
            };
          })
          .filter(
            (
              trace,
            ): trace is {
              beat: string;
              excerpt: string;
            } => trace !== null,
          )
      : [],
  };
}
