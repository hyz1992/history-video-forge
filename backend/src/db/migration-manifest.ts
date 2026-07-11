import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

export interface ExpectedMigration { name: string; checksum: string }

export function expectedMigrations(root = resolve(process.cwd(), "backend", "prisma", "migrations")): ExpectedMigration[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((name) => ({
      name,
      checksum: createHash("sha256").update(readFileSync(join(root, name, "migration.sql"))).digest("hex"),
    }));
}
