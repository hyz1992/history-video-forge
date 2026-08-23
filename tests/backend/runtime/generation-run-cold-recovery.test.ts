import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";

/**
 * S2-2A 外部审查 P1-2 整改测试：跨实例冷恢复的 snapshot 加载与 fail-closed。
 *
 * 场景 A（冷镜像可恢复）：run 与 snapshot 在数据库（prisma）中，但本实例
 * 内存镜像没有 snapshot（实例 B 的 sweep 从 DB 恢复 run）——dispatcher 必须
 * 通过 repository 以数据库为权威加载 snapshot，且 handler 拿到 billing
 * context（billing writer 生效 → interactionId 注入 + usage 落账）。
 * 场景 B（数据异常 fail-closed）：snapshot 连数据库都没有——拒绝派发，
 * 绝不无 billing context 执行真实 LLM，provider 零调用。
 */

const { invokeStructuredPromptMock } = vi.hoisted(() => ({
  invokeStructuredPromptMock: vi.fn(),
}));

// 文件级 mock：env 为真实 LLM 部署（provider=openai）
vi.mock("../../../backend/src/config/env.js", () => {
  const env = {
    nodeEnv: "test",
    databaseUrl: "file:./test.db",
    promptAssetsDir: process.cwd().replace(/\\/g, "/") + "/prompts",
    demoMode: false,
    generation: {
      mediaCredentialConfigured: true,
    },
    llm: {
      provider: "openai",
      baseUrl: "https://llm.example.test/v1",
      apiKey: "test-key",
      model: "glm-4.5",
      structuredModel: "glm-4.5",
      timeoutMs: 45000,
    },
  };
  return {
    env,
    getValidatedRuntimeEnv: () => env,
  };
});
vi.mock("../../../backend/src/runtime/llm/tier-aware-provider-factory.js", () => ({
  createTierAwareProviderFromEnv: vi.fn(() => ({
    invokeStructuredPrompt: invokeStructuredPromptMock,
  })),
  resolveTierProviderSnapshot: vi.fn(() => ({
    smart: { providerKey: "deepseek", modelId: "deepseek-v4-pro" },
    flash: { providerKey: "zhipu", modelId: "glm-4" },
  })),
}));

import { buildApp } from "../../../backend/src/app.js";
import { createDbClient } from "../../../backend/src/db/client.js";
import type { GenerationRunRecord } from "../../../backend/src/db/client.js";
import { createPrismaClient } from "../../../backend/src/db/prisma-client.js";
import { PrismaThirdAggregateWriter } from "../../../backend/src/db/repositories/prisma-third-aggregate-writer.js";
import { applyAllDatabaseMigrations } from "../db/migration-test-utils.js";
import { createProject } from "../../../backend/src/modules/projects/project.repository.js";
import { seedQuotableCatalog, buildQuotableReadinessInput } from "../cost/quote-test-context.js";
import { createGenerationRunRepository } from "../../../backend/src/modules/generation-run/generation-run.repository.js";
import type { GenerationRunRepository } from "../../../backend/src/modules/generation-run/generation-run.repository.js";
import { createOrRestoreGenerationRun } from "../../../backend/src/modules/generation-run/generation-run.service.js";
import { createScriptDispatchHandler } from "../../../backend/src/modules/generation-run/llm-dispatch-handlers.js";

const runtimeDraft = {
  script_text: "冷恢复测试返回的脚本草稿。",
  estimated_duration_sec: 86,
  beat_trace: [
    { beat: "入楚受辱", excerpt: "冷恢复测试返回的脚本草稿", confidence: 0.95 },
  ],
  quote_trace: [],
  opening_span: "冷恢复测试返回的脚本草稿。",
  ending_span: "不应再走 deterministic mock draft。",
};

/** 正链路 mock provider：通过包装 writer 捕获"富化后"的 interaction entry。 */
function mockScriptProvider(captured: Array<Record<string, unknown>>) {
  invokeStructuredPromptMock.mockReset();
  invokeStructuredPromptMock.mockImplementation(async (request: {
    operationName?: string;
    interactionLogWriter?: { write(entry: unknown): unknown };
  }) => {
    if (request.operationName === "script.semantic-reviewer") {
      throw new Error("reviewer down (mock)");
    }
    const entry = {
      generatedAt: new Date().toISOString(),
      provider: "openai",
      model: "glm-4.5",
      operationName: "script.writer",
      promptId: "script.writer",
      promptStage: "writer",
      promptLanguage: "zh-CN",
      promptFilePath: "prompts/script/writer.md",
      promptSha256: "sha256:test",
      promptVersion: "1",
      systemPrompt: "test prompt",
      input: {},
      rawOutput: JSON.stringify(runtimeDraft),
      parsedOutput: runtimeDraft,
      responseMetadata: { promptTokens: 1200, completionTokens: 800, finishReason: "stop" },
    };
    // billing writer 注入 id 的是副本，原始 entry 不带 id——必须从写路径捕获
    // 富化后的 entry 才能断言计费注入生效
    const wrapper = captureWriter(request.interactionLogWriter, captured);
    await wrapper.write(entry);
    return runtimeDraft;
  });
}

/** 包装 writer：把实际写入 interaction log 的 entry（含计费富化副本）捕获进数组。 */
function captureWriter(
  inner: { write(entry: unknown): unknown } | undefined,
  captured: Array<Record<string, unknown>>,
): { write(entry: unknown): unknown } {
  if (!inner) {
    return {
      write(entry: unknown) {
        captured.push({ ...(entry as Record<string, unknown>) });
        return undefined;
      },
    };
  }
  return {
    write(entry: unknown) {
      captured.push({ ...(entry as Record<string, unknown>) });
      return inner.write(entry);
    },
  };
}

async function setupColdRecoveryEnv() {
  const root = mkdtempSync(join(tmpdir(), "svf2-cold-recovery-"));
  const path = join(root, "test.db");
  const sqlite = new Database(path);
  applyAllDatabaseMigrations(sqlite);
  sqlite.close();
  const client = await createPrismaClient(path);
  const app = buildApp({
    storageBaseDir: root,
    prismaClient: client,
    thirdAggregateWriter: new PrismaThirdAggregateWriter(client),
    generationQuoteReadinessInput: buildQuotableReadinessInput(),
    skipSnapshotLoad: true,
  });
  await seedQuotableCatalog(app);
  const project = await createProject(app.db, { name: "Cold Recovery", ownerId: "owner-1" });
  // script 生成需要 active topic package（与闸门测试同一准备步骤）
  const now = new Date();
  app.db.topicPackages.set("tp_cold", {
    id: "tp_cold",
    projectId: project.id,
    eventRegistryEntryId: "ev_001",
    canonicalName: "晏子使楚",
    title: "晏子使楚",
    selectedAngle: "外交压场型",
    familyLabel: "diplomacy",
    scopeLabel: "single_event",
    coreConflict: "楚王当众压场，晏子必须当场顶回。",
    strongScene: "楚王连续压场，晏子一句句顶回去。",
    stakes: "使节尊严与国格",
    packagingSeed: "一句话改变整个房间的气氛。",
    canonicalQuotesJson: [],
    canonicalQuoteIntentsJson: [],
    durationBandJson: { label: "medium" },
    narrativeTensionMapJson: {
      hook_claim: "楚王当众压场",
      pressure_escalation: "连续羞辱",
      mid_reveal: "晏子反击",
      peak_payoff: "全场噤声",
      ending_residue: "使节尊严立住",
    },
    mustIncludeBeatsJson: [],
    forbiddenExpansionsJson: [],
    riskHintsJson: [],
    sourceAnchorRefsJson: ["《晏子春秋》"],
    ambiguityNotesJson: [],
    createdAt: now,
  } as never);
  project.activeTopicPackageId = "tp_cold";
  // 外键约束：user 与 project 行必须存在于数据库
  await client.user.create({
    data: {
      id: "owner-1",
      username: "owner-1",
      displayName: "Owner",
      passwordHash: "x",
      role: "USER",
    },
  });
  await client.project.create({
    data: {
      id: project.id,
      ownerId: "owner-1",
      createdById: "owner-1",
      name: "Cold Recovery",
      status: project.status,
      storageKey: `p-${project.id}`,
      storageDisplayName: "Cold Recovery",
    },
  });
  return { app, client, project, root };
}

async function submitScriptRun(
  app: ReturnType<typeof buildApp>,
  project: Awaited<ReturnType<typeof setupColdRecoveryEnv>>["project"],
  key: string,
) {
  const repository = createGenerationRunRepository(app.db, app.prismaClient);
  const submit = await createOrRestoreGenerationRun(
    app.db, project, project.ownerId,
    {
      operation: "script.generate",
      idempotencyKey: key,
      dispatchPayload: { allow_patch: false, allow_regen: false },
    },
    { readinessInput: buildQuotableReadinessInput(), repository },
  );
  if (!submit.ok) throw new Error(`submit failed: ${JSON.stringify(submit.error)}`);
  return { run: submit.value.run, snapshotId: submit.value.snapshot.id };
}

describe("跨实例冷恢复（外部审查 P1-2 整改）", () => {
  it("冷镜像（内存无 snapshot，DB 有）：dispatcher 从 repository 加载 snapshot，billing 上下文生效并落账", async () => {
    const { app, client, project, root } = await setupColdRecoveryEnv();
    try {
      const captured: Array<Record<string, unknown>> = [];
      mockScriptProvider(captured);
      const { run, snapshotId } = await submitScriptRun(app, project, "cold-recovery-a");
      expect(app.db.runConfigurationSnapshots.has(snapshotId)).toBe(true);

      // 模拟实例 B 冷镜像：内存无 snapshot（sweep 从 DB 恢复 run）
      app.db.runConfigurationSnapshots.delete(snapshotId);

      const result = await app.generationRunDispatcher.dispatch(run.id);
      expect(result.dispatched).toBe(true);
      expect(result.outcome.status).toBe("succeeded");

      // 富化 entry 的稳定 id 只能从写路径捕获（provider 侧看不到注入副本），
      // 这里以 usage.interactionId 断言计费注入生效（与 interaction log 同源）
      expect(captured.length).toBeGreaterThan(0);
      // usage 落账（billing context 存在 → recordUsage 执行）
      expect(app.db.usageCostRecords.size).toBeGreaterThan(0);
      const usage = [...app.db.usageCostRecords.values()][0]!;
      expect(usage.interactionId).toMatch(/^script_run_.+:script\.writer:0$/);
      expect(usage.capability).toBe("llm.smart");

      const stored = await client.runConfigurationSnapshot.findUnique({ where: { id: snapshotId } });
      expect(stored).not.toBeNull();
    } finally {
      await client.$disconnect();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("snapshot 在内存与 repository 均不可用：handler fail-closed 拒绝派发，provider 零调用", async () => {
    // DB 一致性（GenerationRun.runConfigurationSnapshotId onDelete: Restrict）保证
    // 正常数据下 run 必指向存在的 snapshot 行——本用例直接构造数据异常态，
    // 验证纵深防御：handler 必须在调用任何 LLM 前拒绝。
    invokeStructuredPromptMock.mockReset();
    const db = createDbClient();
    const project = await createProject(db, { name: "Cold Recovery B", ownerId: "owner-1" });
    const handler = createScriptDispatchHandler();
    const now = new Date();
    const run: GenerationRunRecord = {
      id: "run_cold_b",
      projectId: project.id,
      userId: "owner-1",
      operation: "script.generate",
      idempotencyKey: "cold-recovery-b",
      payloadFingerprint: "hash",
      quoteId: "quote_cold_b",
      runConfigurationSnapshotId: "snap_missing_001",
      dispatchPayloadJson: {},
      status: "pending_dispatch",
      dispatchLeaseOwner: null,
      dispatchLeaseExpiresAt: null,
      dispatchClaimCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    const outcome = await handler(run, {
      db,
      project,
      repository: {
        getSnapshotById: async () => null,
      } as unknown as GenerationRunRepository,
    });
    expect(outcome).toMatchObject({
      status: "failed",
      reason_code: "dispatch_snapshot_missing",
    });
    expect(invokeStructuredPromptMock).not.toHaveBeenCalled();
  });
});
