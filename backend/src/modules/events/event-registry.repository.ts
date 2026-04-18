import type { DbClient, EventRegistryRecord } from "../../db/client";

export interface CreateProvisionalEventInput {
  canonicalName: string;
  aliases?: string[];
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
    sourceType: input.sourceType ?? "provisional",
    isProvisional: true,
    createdAt: now,
    updatedAt: now,
  };

  db.events.set(event.id, event);

  return event;
}
