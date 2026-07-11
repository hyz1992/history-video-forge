import { readFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

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

    expect(round).toContain("@@unique([projectId, roundIndex])");
    expect(exposure).toContain("@@unique([roundId, fingerprint])");
    expect(exposure).toMatch(/round\s+RecommendationRound\s+@relation\([^\n]*onDelete:\s*Cascade/);
    expect(schema).not.toContain("storageRootDir String");
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
