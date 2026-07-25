import { readdirSync } from "node:fs";
import { join } from "node:path";

export const EVENT_LIBRARY_ROOT_DIR = "storage/event-library";

export function toAsciiSlug(value: string): string {
  const trimmed = value.trim();

  // 混合输入时保留可识别的 ASCII 段（如 "S2.5 计划" → "s2-5"）
  const ascii = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (ascii) return ascii;

  // 纯非 ASCII（如中文标题/朝代）：
  // 直接返回归一化后的汉字段，不做 hex 转义。
  // 唯一性由 generateLibraryFingerprint(canonicalTitle+dynasty+era) 保证，
  // 不依赖文件名 slug。
  const segments = trimmed
    .split(/[^\p{Letter}\p{Number}]+/u)
    .map((s) => s.trim())
    .filter(Boolean);

  if (segments.length === 0) return "unknown";

  return segments.join("-");
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
