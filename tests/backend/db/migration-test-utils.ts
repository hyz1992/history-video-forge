import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";

export function applyAllDatabaseMigrations(database: Database.Database): void {
  const root = join(process.cwd(), "backend", "prisma", "migrations");
  for (const entry of readdirSync(root, { withFileTypes: true }).filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    database.exec(readFileSync(join(root, entry.name, "migration.sql"), "utf8"));
  }
}
