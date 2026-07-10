import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = process.cwd();
const dbClientPath = join(repositoryRoot, "backend/src/db/client.ts");
const mappingPath = join(repositoryRoot, "docs/data/v2-domain-model-mapping.md");

function extractInterfaceBody(source: string, interfaceName: string): string {
  const match = source.match(new RegExp(`export interface ${interfaceName} \\{([\\s\\S]*?)^\\}`, "m"));
  expect(match, `应能读取 ${interfaceName} 接口`).not.toBeNull();
  return match?.[1] ?? "";
}

function extractProperties(interfaceBody: string): string[] {
  return [...interfaceBody.matchAll(/^\s{2}([A-Za-z][A-Za-z0-9]*):/gm)].map((match) => match[1]);
}

describe("V2 domain model mapping", () => {
  it("covers every in-memory DbClient collection and ProjectRecord field", () => {
    expect(existsSync(mappingPath), "应先建立 V2 领域模型映射文档").toBe(true);

    const dbClientSource = readFileSync(dbClientPath, "utf8");
    const mapping = readFileSync(mappingPath, "utf8");
    const dbClientBody = extractInterfaceBody(dbClientSource, "DbClient");
    const collectionNames = [...dbClientBody.matchAll(/^\s{2}([A-Za-z][A-Za-z0-9]*): Map</gm)]
      .map((match) => match[1]);
    const projectFields = extractProperties(extractInterfaceBody(dbClientSource, "ProjectRecord"));

    expect(collectionNames.length).toBeGreaterThan(0);
    expect(projectFields.length).toBeGreaterThan(0);

    for (const collectionName of collectionNames) {
      expect(mapping, `DbClient.${collectionName} 必须有明确迁移去向`).toContain(`| \`${collectionName}\` |`);
    }

    for (const fieldName of projectFields) {
      expect(mapping, `ProjectRecord.${fieldName} 必须有明确迁移去向`).toContain(`| \`${fieldName}\` |`);
    }
  });
});
