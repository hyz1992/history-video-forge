import { readFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { applyAllDatabaseMigrations } from "./migration-test-utils.js";

const schemaPath = join(process.cwd(), "backend/prisma/schema.prisma");
const migrationPath = join(
  process.cwd(),
  "backend/prisma/migrations/0001_v2_baseline/migration.sql",
);

function modelBody(schema: string, modelName: string): string {
  const match = schema.match(new RegExp(`model ${modelName} \\{([\\s\\S]*?)^\\}`, "m"));
  expect(match, `缺少 Prisma 模型 ${modelName}`).not.toBeNull();
  return match?.[1] ?? "";
}

describe("V2 Prisma baseline schema", () => {
  it("contains every required V2 baseline model", () => {
    const schema = readFileSync(schemaPath, "utf8");
    const requiredModels = [
      "User",
      "Session",
      "Project",
      "EventRegistryEntry",
      "TopicPackage",
      "RecommendationCandidateCache",
      "ScriptRecord",
      "StoryboardRecord",
      "AssetPlanRecord",
      "AssetManifestRecord",
      "ComposeRecord",
      "RenderJobRecord",
      "PublishPackageRecord",
      "AssetProviderJobRecord",
      "RecommendationRound",
      "RecommendationExposure",
      "AuditLog",
      "DataMigrationRun",
      "DatabaseActivation",
    ];

    for (const modelName of requiredModels) modelBody(schema, modelName);
  });

  it("defines project ownership, stable storage, active records, and traces", () => {
    const schema = readFileSync(schemaPath, "utf8");
    const user = modelBody(schema, "User");
    const session = modelBody(schema, "Session");
    const project = modelBody(schema, "Project");
    for (const fieldName of ["displayName", "lastLoginAt"]) {
      expect(user, `User.${fieldName} 必须存在`).toMatch(new RegExp(`^\\s*${fieldName}\\s`, "m"));
    }
    for (const fieldName of ["userAgentHash", "ipPrefix"]) {
      expect(session, `Session.${fieldName} 必须存在`).toMatch(new RegExp(`^\\s*${fieldName}\\s`, "m"));
    }
    const requiredFields = [
      "ownerId",
      "createdById",
      "storageKey",
      "activeTopicPackageId",
      "activeScriptRecordId",
      "activeStoryboardRecordId",
      "activeAssetPlanRecordId",
      "activeAssetManifestRecordId",
      "activeComposeRecordId",
      "activeRenderJobRecordId",
      "activePublishPackageRecordId",
      "latestTopicRunTraceJson",
      "latestScriptRunTraceJson",
      "latestStoryboardRunTraceJson",
      "latestAssetPlanRunTraceJson",
      "latestAssetsRunTraceJson",
      "latestComposeRunTraceJson",
      "latestRenderRunTraceJson",
    ];

    for (const fieldName of requiredFields) {
      expect(project, `Project.${fieldName} 必须存在`).toMatch(new RegExp(`^\\s*${fieldName}\\s`, "m"));
    }
    expect(project).toMatch(/storageKey\s+String\s+@unique/);
    expect(project).toMatch(/owner\s+User\s+@relation\([^\n]*onDelete:\s*Restrict/);
    expect(project).toMatch(/createdBy\s+User\s+@relation\([^\n]*onDelete:\s*Restrict/);
  });

  it("constrains user role and status in the committed SQLite migration", () => {
    const migrationSql = readFileSync(migrationPath, "utf8");
    expect(migrationSql).toMatch(/CHECK\s*\(\s*"role"\s+IN\s*\(\s*'ADMIN'\s*,\s*'USER'\s*\)\s*\)/);
    expect(migrationSql).toMatch(/CHECK\s*\(\s*"status"\s+IN\s*\(\s*'ACTIVE'\s*,\s*'DISABLED'\s*\)\s*\)/);
    expect(migrationSql).toContain("'importing', 'imported', 'verified', 'verification_failed', 'import_failed', 'activated'");
    for (const errorCode of [
      "project_active_topic_package_mismatch",
      "project_active_script_record_mismatch",
      "project_active_storyboard_record_mismatch",
      "project_active_asset_plan_record_mismatch",
      "project_active_asset_manifest_record_mismatch",
      "project_active_compose_record_mismatch",
      "project_active_render_job_record_mismatch",
      "project_active_publish_package_record_mismatch",
    ]) {
      expect(migrationSql).toContain(errorCode);
    }
  });

  it("defines persistent recommendation memory and explicit deletion policies", () => {
    const schema = readFileSync(schemaPath, "utf8");
    const round = modelBody(schema, "RecommendationRound");
    const exposure = modelBody(schema, "RecommendationExposure");
    const cache = modelBody(schema, "RecommendationCandidateCache");

    expect(round).toContain("@@unique([projectId, roundIndex])");
    expect(exposure).toContain("@@unique([roundId, fingerprint])");
    expect(exposure).toMatch(/round\s+RecommendationRound\s+@relation\([^\n]*onDelete:\s*Cascade/);
    expect(schema).not.toContain("storageRootDir String");
    for (const field of ["sourceHint", "recentUsageHint", "whyThisNow", "riskHintsJson"]) {
      expect(cache).toMatch(new RegExp(`^\\s*${field}\\s`, "m"));
    }
  });

  it("applies the full ordered migration set including candidate recovery fields", () => {
    const database = new Database(":memory:");
    try {
      applyAllDatabaseMigrations(database);
      const columns = database.prepare(`PRAGMA table_info("RecommendationCandidateCache")`).all()
        .map((row) => (row as { name: string }).name);
      expect(columns).toEqual(expect.arrayContaining(["sourceHint", "recentUsageHint", "whyThisNow", "riskHintsJson"]));
    } finally { database.close(); }
  });

  it("applies the committed baseline migration to an empty SQLite database", () => {
    const migrationSql = readFileSync(migrationPath, "utf8");
    const database = new Database(":memory:");

    try {
      database.pragma("foreign_keys = ON");
      database.exec(migrationSql);
      const tableNames = database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((row) => (row as { name: string }).name);

      for (const tableName of [
        "User",
        "Project",
        "TopicPackage",
        "PublishPackageRecord",
        "RecommendationRound",
        "RecommendationExposure",
        "AuditLog",
        "DataMigrationRun",
      ]) {
        expect(tableNames, `迁移后应存在 ${tableName} 表`).toContain(tableName);
      }
      expect(database.pragma("foreign_keys", { simple: true })).toBe(1);
    } finally {
      database.close();
    }
  });
});

describe("S2-5 EventLibrary schema", () => {
  it("contains EventLibraryEntry / EventLibraryAngle / EventLibraryDraft models", () => {
    const schema = readFileSync(schemaPath, "utf8");
    for (const modelName of ["EventLibraryEntry", "EventLibraryAngle", "EventLibraryDraft"]) {
      modelBody(schema, modelName);
    }
  });

  it("defines sourceMode and sourceRefJson on TopicPackage", () => {
    const schema = readFileSync(schemaPath, "utf8");
    const tp = modelBody(schema, "TopicPackage");
    expect(tp).toMatch(/sourceMode\s+String\s+@default\("recommended"\)/);
    expect(tp).toMatch(/sourceRefJson\s+Json\?/);
  });

  it("defines EventLibraryEntry with status=enumerated, time/location/relationship fields", () => {
    const schema = readFileSync(schemaPath, "utf8");
    const el = modelBody(schema, "EventLibraryEntry");
    for (const fieldName of [
      "eventRegistryEntryId",
      "canonicalTitle",
      "summary",
      "dynasty",
      "era",
      "characterTagsJson",
      "eventTypeTagsJson",
      "conflictTypeTagsJson",
      "themeMotifsJson",
      "timeRangeJson",
      "locationTagsJson",
      "relationshipTagsJson",
      "credibilityLevel",
      "visibility",
      "status",
      "ownerId",
      "originKind",
      "originRefJson",
      "libraryFingerprint",
      "filePath",
      "fileContentHash",
    ]) {
      expect(el, `EventLibraryEntry.${fieldName} 必须存在`).toMatch(new RegExp(`^\\s*${fieldName}\\s`, "m"));
    }
    expect(el).toMatch(/libraryFingerprint\s+String\s+@unique/);
  });

  it("rejects invalid EventLibraryEntry status/visibility/credibilityLevel in migration", () => {
    const database = new Database(":memory:");
    try {
      applyAllDatabaseMigrations(database);
      database.exec("INSERT INTO User (id, username, displayName, passwordHash, updatedAt) VALUES ('u1','t','T','h',CURRENT_TIMESTAMP)");
      database.exec("INSERT INTO EventRegistryEntry (id, canonicalName, aliasesJson, canonicalQuotesJson, canonicalQuoteIntentsJson, sourceType, updatedAt) VALUES ('ev1','E1','[]','[]','[]','builtin',CURRENT_TIMESTAMP)");
      database.exec("INSERT INTO EventRegistryEntry (id, canonicalName, aliasesJson, canonicalQuotesJson, canonicalQuoteIntentsJson, sourceType, updatedAt) VALUES ('ev2','E2','[]','[]','[]','builtin',CURRENT_TIMESTAMP)");
      database.exec("INSERT INTO EventRegistryEntry (id, canonicalName, aliasesJson, canonicalQuotesJson, canonicalQuoteIntentsJson, sourceType, updatedAt) VALUES ('ev3','E3','[]','[]','[]','builtin',CURRENT_TIMESTAMP)");
      database.exec("INSERT INTO EventRegistryEntry (id, canonicalName, aliasesJson, canonicalQuotesJson, canonicalQuoteIntentsJson, sourceType, updatedAt) VALUES ('ev4','E4','[]','[]','[]','builtin',CURRENT_TIMESTAMP)");
      database.exec("INSERT INTO EventRegistryEntry (id, canonicalName, aliasesJson, canonicalQuotesJson, canonicalQuoteIntentsJson, sourceType, updatedAt) VALUES ('ev5','E5','[]','[]','[]','builtin',CURRENT_TIMESTAMP)");
      expect(() => database.exec("INSERT INTO EventLibraryEntry (id, eventRegistryEntryId, canonicalTitle, summary, libraryFingerprint, status, visibility, credibilityLevel, updatedAt) VALUES ('e1', 'ev1', 'T', 'S', 'fp1', 'curated', 'public', 'high', CURRENT_TIMESTAMP)")).not.toThrow();
      expect(() => database.exec("INSERT INTO EventLibraryEntry (id, eventRegistryEntryId, canonicalTitle, summary, libraryFingerprint, status, updatedAt) VALUES ('e2', 'ev2', 'T', 'S', 'fp2', 'invalid_status', CURRENT_TIMESTAMP)")).toThrow();
      expect(() => database.exec("INSERT INTO EventLibraryEntry (id, eventRegistryEntryId, canonicalTitle, summary, libraryFingerprint, visibility, updatedAt) VALUES ('e3', 'ev3', 'T', 'S', 'fp3', 'invalid_vis', CURRENT_TIMESTAMP)")).toThrow();
      expect(() => database.exec("INSERT INTO EventLibraryEntry (id, eventRegistryEntryId, canonicalTitle, summary, libraryFingerprint, credibilityLevel, updatedAt) VALUES ('e4', 'ev4', 'T', 'S', 'fp4', 'unknown', CURRENT_TIMESTAMP)")).toThrow();
      expect(() => database.exec("INSERT INTO EventLibraryEntry (id, eventRegistryEntryId, canonicalTitle, summary, libraryFingerprint, originKind, updatedAt) VALUES ('e5', 'ev5', 'T', 'S', 'fp5', 'foo', CURRENT_TIMESTAMP)")).toThrow();
    } finally {
      database.close();
    }
  });

  it("defines EventLibraryAngle with unique angleFingerprint per entry", () => {
    const schema = readFileSync(schemaPath, "utf8");
    const angle = modelBody(schema, "EventLibraryAngle");
    expect(angle).toContain("@@unique([eventLibraryEntryId, angleFingerprint])");
    for (const fieldName of ["eventLibraryEntryId", "angleLabel", "familyLabel", "angleFingerprint"]) {
      expect(angle, `EventLibraryAngle.${fieldName} 必须存在`).toMatch(new RegExp(`^\\s*${fieldName}\\s`, "m"));
    }
  });

  it("defines EventLibraryDraft with nullable candidateFingerprint and draftKind", () => {
    const schema = readFileSync(schemaPath, "utf8");
    const draft = modelBody(schema, "EventLibraryDraft");
    expect(draft).toMatch(/candidateFingerprint\s+String\?/);
    expect(draft).toMatch(/draftKind\s+String/);
    for (const fieldName of ["projectId", "proposedTitle", "proposedSummary", "ownerId", "status", "rawCustomDigest", "customRefinedEventJson", "mergedEntryId"]) {
      expect(draft, `EventLibraryDraft.${fieldName} 必须存在`).toMatch(new RegExp(`^\\s*${fieldName}\\s`, "m"));
    }
  });

  it("rejects invalid draftKind and enforces candidateFingerprint non-null for reflux", () => {
    const database = new Database(":memory:");
    try {
      applyAllDatabaseMigrations(database);
      database.exec("INSERT INTO User (id, username, displayName, passwordHash, updatedAt) VALUES ('u1','t','T','h',CURRENT_TIMESTAMP)");
      database.exec("INSERT INTO Project (id, name, ownerId, createdById, storageKey, storageDisplayName, updatedAt) VALUES ('p1', 'P', 'u1', 'u1', 'p1', 'P', CURRENT_TIMESTAMP)");
      // Valid: custom draft, null fingerprint
      expect(() => database.exec("INSERT INTO EventLibraryDraft (id, draftKind, projectId, proposedTitle, proposedSummary, ownerId, updatedAt) VALUES ('d1', 'custom', 'p1', 'T', 'S', 'u1', CURRENT_TIMESTAMP)")).not.toThrow();
      // Valid: reflux draft, fingerprint present
      expect(() => database.exec("INSERT INTO EventLibraryDraft (id, draftKind, projectId, proposedTitle, proposedSummary, ownerId, candidateFingerprint, updatedAt) VALUES ('d2', 'recommendation_reflux', 'p1', 'T', 'S', 'u1', 'fp1', CURRENT_TIMESTAMP)")).not.toThrow();
      // Invalid: invalid draftKind
      expect(() => database.exec("INSERT INTO EventLibraryDraft (id, draftKind, projectId, proposedTitle, proposedSummary, ownerId, updatedAt) VALUES ('d3', 'foo', 'p1', 'T', 'S', 'u1', CURRENT_TIMESTAMP)")).toThrow();
      // Invalid: reflux draft, fingerprint null
      expect(() => database.exec("INSERT INTO EventLibraryDraft (id, draftKind, projectId, proposedTitle, proposedSummary, ownerId, updatedAt) VALUES ('d4', 'recommendation_reflux', 'p1', 'T', 'S', 'u1', CURRENT_TIMESTAMP)")).toThrow();
      // Invalid: draft status
      expect(() => database.exec("INSERT INTO EventLibraryDraft (id, draftKind, projectId, proposedTitle, proposedSummary, ownerId, status, updatedAt) VALUES ('d5', 'custom', 'p1', 'T', 'S', 'u1', 'invalid_status', CURRENT_TIMESTAMP)")).toThrow();
    } finally {
      database.close();
    }
  });

  it("applies S2-5 migration cleanly to in-memory database", () => {
    const database = new Database(":memory:");
    try {
      applyAllDatabaseMigrations(database);
      const tableNames = database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((row) => (row as { name: string }).name);

      for (const tableName of ["EventLibraryEntry", "EventLibraryAngle", "EventLibraryDraft"]) {
        expect(tableNames, `迁移后应存在 ${tableName} 表`).toContain(tableName);
      }

      // sourceMode 默认值
      const tpCols = database.prepare("PRAGMA table_info('TopicPackage')").all()
        .map((row) => (row as { name: string }).name);
      expect(tpCols).toEqual(expect.arrayContaining(["sourceMode", "sourceRefJson"]));

      // candidateFingerprint 可空
      const draftCols = database.prepare("PRAGMA table_info('EventLibraryDraft')").all()
        .map((row) => (row as { name: string; notnull: number }).name + (row as { notnull: number }).notnull);
      const cfCol = database.prepare("PRAGMA table_info('EventLibraryDraft')").all()
        .find((row) => (row as { name: string }).name === "candidateFingerprint") as { notnull: number };
      expect(cfCol.notnull).toBe(0); // nullable
    } finally {
      database.close();
    }
  });
});
