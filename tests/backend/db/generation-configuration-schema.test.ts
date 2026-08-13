import { readFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { applyAllDatabaseMigrations } from "./migration-test-utils.js";

const schemaPath = join(process.cwd(), "backend/prisma/schema.prisma");

function modelBody(schema: string, modelName: string): string {
  const match = schema.match(new RegExp(`model ${modelName} \\{([\\s\\S]*?)^\\}`, "m"));
  expect(match, `缺少 Prisma 模型 ${modelName}`).not.toBeNull();
  return match?.[1] ?? "";
}

/**
 * S2-2A 任务 2 步骤 1：数据库合同失败测试。
 *
 * 覆盖九个新实体的 Prisma schema 字段、唯一约束、外键和迁移 SQL 的 CHECK 约束。
 * 设计依据：docs/plans/2026-08-12-s2-2a-configuration-cost-foundation-design.md 第 4 节。
 */
describe("S2-2A generation configuration schema", () => {
  const schema = readFileSync(schemaPath, "utf8");

  it("contains all nine new generation configuration models", () => {
    const requiredModels = [
      "UserGenerationPreference",
      "ProjectGenerationConfiguration",
      "ProviderModelCatalog",
      "StoryboardSegmentOverride",
      "GenerationCostQuote",
      "RunConfigurationSnapshot",
      "GenerationRun",
      "GenerationRunEvent",
      "UsageCostRecord",
    ];
    for (const modelName of requiredModels) modelBody(schema, modelName);
  });

  // --- UserGenerationPreference ---

  it("UserGenerationPreference has userId unique, revision, configurationJson", () => {
    const m = modelBody(schema, "UserGenerationPreference");
    expect(m).toMatch(/userId\s+String/);
    expect(m).toMatch(/userId\s+String\s+@unique/);
    expect(m).toMatch(/revision\s+Int/);
    expect(m).toMatch(/configurationJson\s+Json/);
    expect(m).toMatch(/schemaVersion\s+String/);
  });

  // --- ProjectGenerationConfiguration ---

  it("ProjectGenerationConfiguration has projectId unique, revision, sourceUserPreferenceRevision", () => {
    const m = modelBody(schema, "ProjectGenerationConfiguration");
    expect(m).toMatch(/projectId\s+String\s+@unique/);
    expect(m).toMatch(/revision\s+Int/);
    expect(m).toMatch(/sourceUserPreferenceRevision\s+Int\?/);
    expect(m).toMatch(/configurationJson\s+Json/);
  });

  // --- ProviderModelCatalog ---

  it("ProviderModelCatalog has isDefault, capability, status, stable id PK", () => {
    const m = modelBody(schema, "ProviderModelCatalog");
    expect(m).toMatch(/id\s+String\s+@id/);
    expect(m).toMatch(/capability\s+String/);
    expect(m).toMatch(/providerKey\s+String/);
    expect(m).toMatch(/modelId\s+String/);
    expect(m).toMatch(/status\s+String/);
    expect(m).toMatch(/isDefault\s+Boolean/);
    expect(m).toMatch(/pricingVersion\s+String/);
    expect(m).toMatch(/pricingJson\s+Json/);
    expect(m).toContain("@@index([capability, status])");
  });

  // --- StoryboardSegmentOverride ---

  it("StoryboardSegmentOverride has unique (storyboardRecordId, segmentId), projectId index only", () => {
    const m = modelBody(schema, "StoryboardSegmentOverride");
    expect(m).toMatch(/storyboardRecordId\s+String/);
    expect(m).toMatch(/segmentId\s+String/);
    expect(m).toMatch(/projectId\s+String/);
    expect(m).toMatch(/revision\s+Int/);
    expect(m).toContain("@@unique([storyboardRecordId, segmentId])");
    // projectId 只用于 owner scope/index，不另造第二套唯一语义
    expect(m).toContain("@@index([projectId])");
    expect(m).not.toContain("@@unique([projectId");
  });

  // --- GenerationCostQuote ---

  it("GenerationCostQuote has expiresAt, consumedAt, configurationHash, pricingHash, quoteFingerprint, micros amounts", () => {
    const m = modelBody(schema, "GenerationCostQuote");
    expect(m).toMatch(/expiresAt\s+DateTime/);
    expect(m).toMatch(/consumedAt\s+DateTime\?/);
    expect(m).toMatch(/configurationHash\s+String/);
    expect(m).toMatch(/pricingHash\s+String/);
    expect(m).toMatch(/quoteFingerprint\s+String/);
    expect(m).toMatch(/operation\s+String/);
    expect(m).toMatch(/estimatedCostMicros\s+String/);
    expect(m).toMatch(/authorizationCostMicros\s+String/);
    expect(m).toMatch(/containsUnboundedItem\s+Boolean/);
    expect(m).toMatch(/budgetLimitMicros\s+String\?/);
    expect(m).toMatch(/overBudget\s+Boolean/);
    expect(m).toMatch(/pricingVersionSetJson\s+Json/);
    expect(m).toMatch(/itemsJson\s+Json/);
  });

  // --- RunConfigurationSnapshot ---

  it("RunConfigurationSnapshot has run identity, resolved json, quote binding, costs, pricing", () => {
    const m = modelBody(schema, "RunConfigurationSnapshot");
    expect(m).toMatch(/projectId\s+String/);
    expect(m).toMatch(/stage\s+String/);
    expect(m).toMatch(/operation\s+String/);
    expect(m).toMatch(/runId\s+String\?/);
    expect(m).toMatch(/projectConfigurationRevision\s+Int/);
    expect(m).toMatch(/configurationHash\s+String/);
    expect(m).toMatch(/resolvedConfigurationJson\s+Json/);
    expect(m).toMatch(/resolutionTraceJson\s+Json/);
    expect(m).toMatch(/quoteId\s+String\?/);
    expect(m).toMatch(/quoteFingerprint\s+String\?/);
    expect(m).toMatch(/estimatedCostMicros\s+String\?/);
    expect(m).toMatch(/authorizationCostMicros\s+String\?/);
    expect(m).toMatch(/budgetLimitMicros\s+String\?/);
    expect(m).toMatch(/budgetOverrideAuthorized\s+Boolean/);
    expect(m).toMatch(/pricingHash\s+String\?/);
    expect(m).toMatch(/pricingVersionSetJson\s+Json/);
    expect(m).toContain("@@index([projectId])");
  });

  // --- GenerationRun ---

  it("GenerationRun has unique (projectId, operation, idempotencyKey), payloadFingerprint, dispatch lease", () => {
    const m = modelBody(schema, "GenerationRun");
    expect(m).toMatch(/operation\s+String/);
    expect(m).toMatch(/idempotencyKey\s+String/);
    expect(m).toMatch(/payloadFingerprint\s+String/);
    expect(m).toMatch(/quoteId\s+String\?/);
    expect(m).toMatch(/runConfigurationSnapshotId\s+String/);
    expect(m).toMatch(/status\s+String/);
    expect(m).toMatch(/dispatchLeaseOwner\s+String\?/);
    expect(m).toMatch(/dispatchLeaseExpiresAt\s+DateTime\?/);
    expect(m).toMatch(/dispatchClaimCount\s+Int/);
    expect(m).toContain("@@unique([projectId, operation, idempotencyKey])");
  });

  // --- GenerationRunEvent ---

  it("GenerationRunEvent is append-only with eventType and optional segmentId", () => {
    const m = modelBody(schema, "GenerationRunEvent");
    expect(m).toMatch(/generationRunId\s+String/);
    expect(m).toMatch(/eventType\s+String/);
    expect(m).toMatch(/segmentId\s+String\?/);
    expect(m).toMatch(/eventJson\s+Json/);
    expect(m).toMatch(/createdAt\s+DateTime/);
    // 无 updatedAt 字段（append-only，不提供更新）
    expect(m).not.toMatch(/updatedAt/);
    expect(m).toContain("@@index([generationRunId])");
  });

  // --- UsageCostRecord ---

  it("UsageCostRecord has unique (runConfigurationSnapshotId, providerRequestKey, attemptIndex)", () => {
    const m = modelBody(schema, "UsageCostRecord");
    expect(m).toMatch(/runConfigurationSnapshotId\s+String/);
    expect(m).toMatch(/assetProviderJobRecordId\s+String\?/);
    expect(m).toMatch(/interactionId\s+String\?/);
    expect(m).toMatch(/capability\s+String/);
    expect(m).toMatch(/providerKey\s+String/);
    expect(m).toMatch(/modelId\s+String/);
    expect(m).toMatch(/providerRequestKey\s+String/);
    expect(m).toMatch(/attemptIndex\s+Int/);
    expect(m).toMatch(/status\s+String/);
    expect(m).toMatch(/unitType\s+String/);
    expect(m).toMatch(/estimatedCostMicros\s+String/);
    expect(m).toMatch(/actualCostMicros\s+String\?/);
    expect(m).toMatch(/costBasis\s+String/);
    expect(m).toContain(
      "@@unique([runConfigurationSnapshotId, providerRequestKey, attemptIndex])",
    );
  });

  // --- S2-2A 任务 2 审查整改（20260813090000_s2_2a_review_fixes） ---

  it("AssetProviderJobRecord has generationRunId / providerRequestKey / attemptIndex for call-intent dedup", () => {
    const m = modelBody(schema, "AssetProviderJobRecord");
    expect(m).toMatch(/generationRunId\s+String\?/);
    expect(m).toMatch(/providerRequestKey\s+String\?/);
    expect(m).toMatch(/attemptIndex\s+Int\?/);
    expect(m).toMatch(/generationRun\s+GenerationRun\?/);
    expect(m).toContain("@@index([generationRunId])");
  });

  it("GenerationRun has quote relation and ProviderModelCatalog has isDefault", () => {
    const run = modelBody(schema, "GenerationRun");
    expect(run).toMatch(/quote\s+GenerationCostQuote\?/);
    const catalog = modelBody(schema, "ProviderModelCatalog");
    expect(catalog).toMatch(/isDefault\s+Boolean/);
  });

  it("RunConfigurationSnapshot has quote relation", () => {
    const m = modelBody(schema, "RunConfigurationSnapshot");
    expect(m).toMatch(/quote\s+GenerationCostQuote\?/);
  });

  it("StoryboardSegmentOverride has storyboardRecord relation", () => {
    const m = modelBody(schema, "StoryboardSegmentOverride");
    expect(m).toMatch(/storyboardRecord\s+StoryboardRecord/);
  });

  it("UsageCostRecord has assetProviderJobRecord relation", () => {
    const m = modelBody(schema, "UsageCostRecord");
    expect(m).toMatch(/assetProviderJobRecord\s+AssetProviderJobRecord\?/);
  });
});
