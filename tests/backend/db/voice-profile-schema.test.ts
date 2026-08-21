import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const schemaPath = join(process.cwd(), "backend/prisma/schema.prisma");

function modelBody(schema: string, modelName: string): string {
  const match = schema.match(new RegExp(`model ${modelName} \\{([\\s\\S]*?)^\\}`, "m"));
  expect(match, `缺少 Prisma 模型 ${modelName}`).not.toBeNull();
  return match?.[1] ?? "";
}

/**
 * S2-2B 任务 3：VoiceProfile 数据库合同（详细设计 §6.4）。
 * 外部审查 P1-4：音色库从 JSON 文件迁入数据库，公共/私有可见性与跨实例权威。
 */
describe("S2-2B VoiceProfile schema", () => {
  const schema = readFileSync(schemaPath, "utf8");

  it("contains the VoiceProfile model", () => {
    modelBody(schema, "VoiceProfile");
  });

  it("VoiceProfile has identity, ownership, visibility and execution-critical columns", () => {
    const m = modelBody(schema, "VoiceProfile");
    expect(m).toMatch(/id\s+String\s+@id/);
    expect(m).toMatch(/kind\s+String/);
    expect(m).toMatch(/ownerId\s+String\?/);
    expect(m).toMatch(/visibility\s+String\s+@default\("public"\)/);
    expect(m).toMatch(/providerName\s+String/);
    expect(m).toMatch(/providerVoiceId\s+String\?/);
    expect(m).toMatch(/providerStatus\s+String/);
    expect(m).toMatch(/targetModel\s+String/);
    expect(m).toMatch(/previewAudioUri\s+String\?/);
    expect(m).toMatch(/usageCount\s+Int/);
    expect(m).toMatch(/lastUsedAt\s+DateTime\?/);
    expect(m).toMatch(/qualityScore\s+Float\?/);
    expect(m).toMatch(/metadataJson\s+Json/);
    expect(m).toMatch(/createdAt\s+DateTime/);
    expect(m).toMatch(/updatedAt\s+DateTime\s+@updatedAt/);
  });

  it("VoiceProfile links owner to User (SetNull) and indexes (ownerId, visibility)", () => {
    const m = modelBody(schema, "VoiceProfile");
    expect(m).toMatch(/owner\s+User\?/);
    expect(m).toMatch(/onDelete:\s*SetNull/);
    expect(m).toMatch(/@@index\(\[ownerId,\s*visibility\]\)/);
  });

  it("User model declares the voiceProfiles back-relation", () => {
    const userModel = modelBody(schema, "User");
    expect(userModel).toMatch(/voiceProfiles\s+VoiceProfile\[\]/);
  });
});
