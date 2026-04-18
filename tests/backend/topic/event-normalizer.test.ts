import { describe, expect, it } from "vitest";

import { createDbClient } from "../../../backend/src/db/client.js";
import { createProvisionalEvent } from "../../../backend/src/modules/events/event-registry.repository.js";
import { normalizeEventInput } from "../../../backend/src/modules/topic/event-normalizer.js";

describe("event normalizer", () => {
  it("reuses an existing event when canonical name or alias matches", async () => {
    const db = createDbClient();
    const existing = await createProvisionalEvent(db, {
      canonicalName: "晏子使楚",
      aliases: ["晏子出使楚国"],
      sourceType: "library",
    });

    const normalized = await normalizeEventInput(db, {
      rawInput: "晏子出使楚国",
      aliases: ["晏子使楚"],
      sourceType: "library",
    });

    expect(normalized.created).toBe(false);
    expect(normalized.event.id).toBe(existing.id);
    expect(normalized.event.canonicalName).toBe("晏子使楚");
  });

  it("creates a provisional event when no existing event matches", async () => {
    const db = createDbClient();

    const normalized = await normalizeEventInput(db, {
      rawInput: "专诸刺王僚",
      aliases: ["专诸行刺王僚"],
      sourceType: "custom",
    });

    expect(normalized.created).toBe(true);
    expect(normalized.event.canonicalName).toBe("专诸刺王僚");
    expect(normalized.event.isProvisional).toBe(true);
  });
});
