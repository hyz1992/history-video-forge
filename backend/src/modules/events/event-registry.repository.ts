import type { DbClient, EventRegistryRecord } from "../../db/client";

export interface CreateProvisionalEventInput {
  canonicalName: string;
  aliases?: string[];
  canonicalQuotes?: string[];
  sourceType?: string;
}

export async function findEventByCanonicalOrAlias(
  db: DbClient,
  term: string,
): Promise<EventRegistryRecord | null> {
  for (const event of db.events.values()) {
    if (event.canonicalName === term || event.aliases.includes(term)) {
      return event;
    }
  }

  return null;
}

export async function createProvisionalEvent(
  db: DbClient,
  input: CreateProvisionalEventInput,
): Promise<EventRegistryRecord> {
  const now = new Date();
  const event: EventRegistryRecord = {
    id: db.generateId(),
    canonicalName: input.canonicalName,
    aliases: input.aliases ?? [],
    canonicalQuotesJson: normalizeCanonicalQuotes(input.canonicalQuotes),
    sourceType: input.sourceType ?? "provisional",
    isProvisional: true,
    createdAt: now,
    updatedAt: now,
  };

  db.events.set(event.id, event);

  return event;
}

function normalizeCanonicalQuotes(quotes: string[] | undefined): string[] {
  return Array.from(
    new Set((quotes ?? []).map((quote) => quote.trim()).filter(Boolean)),
  );
}
