import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function resolveDatabasePath(databaseUrl: string, cwd = process.cwd()): string {
  const value = databaseUrl.trim();
  if (!value) throw new Error("database_url_required");
  if (value.startsWith("file:")) {
    const fileValue = value.slice(5);
    if (!fileValue) throw new Error("database_url_invalid");
    if (fileValue.startsWith("//")) return fileURLToPath(value);
    return isAbsolute(fileValue) ? fileValue : resolve(cwd, fileValue);
  }
  return isAbsolute(value) ? value : resolve(cwd, value);
}

export function normalizedDatabaseUrl(databaseUrl: string, cwd = process.cwd()): string {
  return `file:${resolveDatabasePath(databaseUrl, cwd).replace(/\\/g, "/")}`;
}
