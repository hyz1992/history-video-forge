import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { buildApp } from "../../../backend/src/app.js";
import { env } from "../../../backend/src/config/env.js";
import { createDbClient } from "../../../backend/src/db/client.js";
import {
  createProject,
  getProjectById,
} from "../../../backend/src/modules/projects/project.repository.js";
import {
  createProvisionalEvent,
  findEventByCanonicalOrAlias,
} from "../../../backend/src/modules/events/event-registry.repository.js";
import { saveTopicPackage } from "../../../backend/src/modules/topic/topic-package.repository.js";
import { saveCachedCandidate } from "../../../backend/src/modules/cache/candidate-cache.repository.js";

const rootDir = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const prismaSchemaPath = resolve(rootDir, "backend/prisma/schema.prisma");

describe("backend repository contracts", () => {
  it("provides the minimum backend skeleton entrypoints", () => {
    expect(typeof buildApp).toBe("function");
    expect(typeof createDbClient).toBe("function");
    expect(env.nodeEnv).toBeTypeOf("string");
  });

  it("exposes the minimum stable repository methods", async () => {
    expect(typeof createProject).toBe("function");
    expect(typeof getProjectById).toBe("function");
    expect(typeof findEventByCanonicalOrAlias).toBe("function");
    expect(typeof createProvisionalEvent).toBe("function");
    expect(typeof saveTopicPackage).toBe("function");
    expect(typeof saveCachedCandidate).toBe("function");

    const db = createDbClient();
    const project = await createProject(db, {
      name: "Task 3 contract test",
    });

    expect(project.id).toBeTypeOf("string");
    await expect(getProjectById(db, project.id)).resolves.toMatchObject({
      id: project.id,
      name: "Task 3 contract test",
    });
  });

  it("declares the planned JSON persistence fields in prisma schema", () => {
    expect(existsSync(prismaSchemaPath)).toBe(true);

    const schema = readFileSync(prismaSchemaPath, "utf8");

    expect(schema).toContain("model TopicPackage");
    expect(schema).toContain("narrative_tension_map_json");
    expect(schema).toContain("model RecommendationCandidateCache");
    expect(schema).toContain("viral_rubric_json");
    expect(schema).toContain("model ScriptRecord");
    expect(schema).toContain("validation_result_json");
    expect(schema).toContain("semantic_review_result_json");
  });
});
