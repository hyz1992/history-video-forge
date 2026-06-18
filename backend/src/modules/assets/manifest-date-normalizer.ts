/**
 * Normalize Date objects back to ISO strings inside asset manifest
 * structures.  The Zod schemas for AssetManifest expect z.string()
 * for started_at / completed_at / created_at, but the db snapshot
 * persistence layer may revive ISO date strings back into Date objects.
 *
 * This helper walks the manifest and converts any Date it finds
 * back to .toISOString().  It also normalizes legacy artifact origin
 * values that were persisted before the shared AssetArtifact contract
 * was enforced.
 *
 * Must be called every time a manifest is read from a record before
 * it is passed to Zod validation or downstream consumers (compose,
 * render, etc.).
 */
export function normalizeAssetManifestDates(
  manifest: Record<string, unknown>,
): Record<string, unknown> {
  return JSON.parse(JSON.stringify(manifest, (key, value) => {
    if (value instanceof Date) {
      return value.toISOString();
    }
    if (key === "origin" && value === "generated") {
      return "provider";
    }
    return value;
  }));
}
