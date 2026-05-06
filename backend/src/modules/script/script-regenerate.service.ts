import { ScriptDraftPackage } from "../../../../shared/src/index.js";

interface ScriptInputBundleInput {
  hard_lane: {
    event_identity: string;
  };
}

export interface RegenerateScriptDraftInput {
  bundle: ScriptInputBundleInput;
  regenerateUsed: boolean;
  localValidation?: {
    errors?: unknown[];
    metrics?: Record<string, unknown>;
  };
  generateDraft: (input?: {
    regenerationContext?: {
      reason: "local_validation_regen_once";
      errors: string[];
      metrics: Record<string, unknown>;
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
    },
  });
  return ScriptDraftPackage.parse(regenerated);
}
