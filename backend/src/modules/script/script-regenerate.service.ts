import { ScriptDraftPackage } from "../../../../shared/src/index.js";

interface ScriptInputBundleInput {
  hard_lane: {
    event_identity: string;
  };
}

export interface RegenerateScriptDraftInput {
  bundle: ScriptInputBundleInput;
  regenerateUsed: boolean;
  generateDraft: () => Promise<unknown>;
}

export async function regenerateScriptDraft(
  input: RegenerateScriptDraftInput,
) {
  if (input.regenerateUsed) {
    throw new Error("regen_once opportunity already consumed");
  }

  const regenerated = await input.generateDraft();
  return ScriptDraftPackage.parse(regenerated);
}
