import type { DbClient, EventRegistryRecord } from "../../db/client";
import {
  createProvisionalEvent,
  findEventByCanonicalOrAlias,
} from "../events/event-registry.repository";

export interface NormalizeEventInput {
  rawInput: string;
  aliases?: string[];
  canonicalQuotes?: string[];
  canonicalQuoteIntents?: Array<{ quote: string; intent: string }>;
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
      mergeCanonicalQuoteIntents(existing, input.canonicalQuoteIntents);
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
    canonicalQuoteIntents: input.canonicalQuoteIntents,
    sourceType: input.sourceType ?? "provisional",
  });

  return {
    event: provisional,
    created: true,
  };
}

function mergeCanonicalQuoteIntents(
  event: EventRegistryRecord,
  intents: Array<{ quote: string; intent: string }> | undefined,
): void {
  const seen = new Set(
    (event.canonicalQuoteIntentsJson ?? []).map(
      (item) => `${item.quote.trim()}\n${item.intent.trim()}`,
    ),
  );
  event.canonicalQuoteIntentsJson = event.canonicalQuoteIntentsJson ?? [];

  for (const item of intents ?? []) {
    const quote = item.quote.trim();
    const intent = item.intent.trim();
    const key = `${quote}\n${intent}`;

    if (!quote || !intent || seen.has(key)) {
      continue;
    }

    seen.add(key);
    event.canonicalQuoteIntentsJson.push({ quote, intent });
  }

  event.updatedAt = new Date();
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
