import type { DbClient, EventRegistryRecord } from "../../db/client";
import {
  createProvisionalEvent,
  findEventByCanonicalOrAlias,
} from "../events/event-registry.repository";

export interface NormalizeEventInput {
  rawInput: string;
  aliases?: string[];
  sourceType?: string;
}

export interface NormalizedEventResult {
  event: EventRegistryRecord;
  created: boolean;
}

export async function normalizeEventInput(
  db: DbClient,
  input: NormalizeEventInput,
): Promise<NormalizedEventResult> {
  const searchTerms = [input.rawInput, ...(input.aliases ?? [])].filter(Boolean);

  for (const term of searchTerms) {
    const existing = await findEventByCanonicalOrAlias(db, term.trim());
    if (existing) {
      return {
        event: existing,
        created: false,
      };
    }
  }

  const provisional = await createProvisionalEvent(db, {
    canonicalName: input.rawInput.trim(),
    aliases: input.aliases?.map((alias) => alias.trim()).filter(Boolean),
    sourceType: input.sourceType ?? "provisional",
  });

  return {
    event: provisional,
    created: true,
  };
}
