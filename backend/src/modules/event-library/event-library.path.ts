import { readdirSync } from "node:fs";
import { join } from "node:path";

export const EVENT_LIBRARY_ROOT_DIR = "storage/event-library";

export function toAsciiSlug(value: string): string {
  const trimmed = value.trim();
  const ascii = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (ascii) return ascii;

  const unicodeSegments = trimmed
    .toLowerCase()
    .split(/[^\p{Letter}\p{Number}]+/u)
    .map((s) => s.trim())
    .filter(Boolean);

  if (unicodeSegments.length === 0) return "unknown";

  return unicodeSegments
    .map((s) => `u8-${Buffer.from(s, "utf8").toString("hex")}`)
    .join("-");
}

export function scanEventLibraryFiles(rootDir: string): string[] {
  const libDir = join(rootDir, EVENT_LIBRARY_ROOT_DIR);
  try {
    return readdirSync(libDir, { recursive: true, encoding: "utf8" })
      .filter((name) => name.endsWith(".json"))
      .map((name) => join(libDir, name));
  } catch {
    return [];
  }
}
