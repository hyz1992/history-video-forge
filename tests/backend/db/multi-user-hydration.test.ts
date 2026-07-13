import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { createDbClient } from "../../../backend/src/db/client.js";
import { createPrismaClient } from "../../../backend/src/db/prisma-client.js";
import { hydrateFirstAggregates } from "../../../backend/src/db/repositories/prisma-first-aggregate-hydrator.js";
import { applyAllDatabaseMigrations } from "./migration-test-utils.js";

describe("multi-user Prisma hydration", () => {
  it("loads projects owned by different users after restart (no LOCAL_PROJECT_OWNER_ID filter)", async () => {
    const root = mkdtempSync(join(tmpdir(), "svf2-multi-user-hydrate-"));
    const path = join(root, "test.db");
    const sqlite = new Database(path);
    applyAllDatabaseMigrations(sqlite);
    sqlite.close();
    const client = await createPrismaClient(path);
    try {
      await client.user.create({ data: { id: "local-owner", username: "local", displayName: "Local Owner", passwordHash: "x", role: "ADMIN" } });
      await client.user.create({ data: { id: "user-a", username: "usera", displayName: "User A", passwordHash: "x", role: "USER" } });
      await client.user.create({ data: { id: "user-b", username: "userb", displayName: "User B", passwordHash: "x", role: "USER" } });

      await client.project.create({ data: { id: "p-local", ownerId: "local-owner", createdById: "local-owner", name: "Local", storageKey: "p-local", storageDisplayName: "Local" } });
      await client.project.create({ data: { id: "p-a", ownerId: "user-a", createdById: "user-a", name: "A", storageKey: "p-a", storageDisplayName: "A" } });
      await client.project.create({ data: { id: "p-b", ownerId: "user-b", createdById: "user-b", name: "B", storageKey: "p-b", storageDisplayName: "B" } });

      const db = createDbClient();
      await hydrateFirstAggregates(db, new Map(), client, { storageRoot: root });

      expect(db.projects.size).toBe(3);
      expect(db.projects.get("p-local")?.ownerId).toBe("local-owner");
      expect(db.projects.get("p-a")?.ownerId).toBe("user-a");
      expect(db.projects.get("p-b")?.ownerId).toBe("user-b");

      expect(db.projects.get("p-a")).toMatchObject({ id: "p-a", name: "A", ownerId: "user-a", createdById: "user-a" });
    } finally {
      await client.$disconnect();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
