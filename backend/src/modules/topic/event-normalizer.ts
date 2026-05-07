import type { DbClient, EventRegistryRecord } from "../../db/client";
import {
  createProvisionalEvent,
  findEventByCanonicalOrAlias,
} from "../events/event-registry.repository";

export interface NormalizeEventInput {
  rawInput: string;
  aliases?: string[];
  canonicalQuotes?: string[];
  sourceType?: string;
}

export interface NormalizedEventResult {
  event: EventRegistryRecord;
  created: boolean;
}

export function normalizeEventIdentityValue(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export function buildEventIdentityFingerprint(input: {
  eventIdentity: string;
  angle: string;
}): string {
  return `${normalizeEventIdentityValue(input.eventIdentity)}::${normalizeEventIdentityValue(
    input.angle,
  )}`;
}

export async function normalizeEventInput(
  db: DbClient,
  input: NormalizeEventInput,
): Promise<NormalizedEventResult> {
  const searchTerms = [input.rawInput, ...(input.aliases ?? [])].filter(Boolean);

  for (const term of searchTerms) {
    const existing = await findEventByCanonicalOrAlias(db, term.trim());
    if (existing) {
      mergeCanonicalQuotes(existing, input.canonicalQuotes);
      return {
        event: existing,
        created: false,
      };
    }
  }

  const provisional = await createProvisionalEvent(db, {
    canonicalName: input.rawInput.trim(),
    aliases: input.aliases?.map((alias) => alias.trim()).filter(Boolean),
    canonicalQuotes: input.canonicalQuotes,
    sourceType: input.sourceType ?? "provisional",
  });

  return {
    event: provisional,
    created: true,
  };
}

function mergeCanonicalQuotes(
  event: EventRegistryRecord,
  quotes: string[] | undefined,
): void {
  event.canonicalQuotesJson = Array.from(
    new Set([
      ...event.canonicalQuotesJson,
      ...(quotes ?? []).map((quote) => quote.trim()).filter(Boolean),
    ]),
  );
  event.updatedAt = new Date();
}
