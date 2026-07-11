import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { normalizedDatabaseUrl, resolveDatabasePath } from "../../../backend/src/db/database-url.js";

describe("database URL normalization", () => {
  it("normalizes relative paths, absolute paths, and file URLs", () => {
    const cwd = resolve("D:/workspace/example");
    const absolute = resolve(cwd, "storage/test.db");
    expect(resolveDatabasePath("storage/test.db", cwd)).toBe(absolute);
    expect(resolveDatabasePath(absolute, cwd)).toBe(absolute);
    expect(resolveDatabasePath("file:storage/test.db", cwd)).toBe(absolute);
    expect(normalizedDatabaseUrl("storage/test.db", cwd)).toBe(`file:${absolute.replace(/\\/g, "/")}`);
  });
});
