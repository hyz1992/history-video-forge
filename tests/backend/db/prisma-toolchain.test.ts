import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const repositoryRoot = process.cwd();

describe("Prisma 7 toolchain", () => {
  it("validates the backend schema through the committed Prisma config", () => {
    const result = spawnSync(
      process.execPath,
      [join(repositoryRoot, "node_modules/prisma/build/index.js"), "validate", "--config", "prisma.config.ts"],
      {
        cwd: join(repositoryRoot, "backend"),
        encoding: "utf8",
        env: {
          ...process.env,
          DATABASE_URL: "file:./storage/test-prisma-toolchain.db",
        },
        shell: false,
        timeout: 20_000,
      },
    );

    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}\n${result.error?.message ?? ""}`;
    expect(output, "Prisma validate 输出").toContain("schema.prisma");
    expect(result.status, output).toBe(0);

    const schema = readFileSync(join(repositoryRoot, "backend/prisma/schema.prisma"), "utf8");
    expect(schema).toContain('provider = "prisma-client"');
    expect(schema).toContain('output   = "../src/generated/prisma"');
    expect(schema).toMatch(/datasource db\s*\{\s*provider\s*=\s*"sqlite"\s*\}/m);
  }, 25_000);
});
