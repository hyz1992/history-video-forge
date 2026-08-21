import { describe, expect, it, vi } from "vitest";

/**
 * S2-2A 外部审查 P1-3 整改测试：billing writer 的记账结算时序。
 *
 * 合同：write() 返回的 Promise 在"账本已落库 或 usage_recording_failed
 * 审计已持久化"之前不得 resolve——run 完成时账本/审计一定已落库，进程崩溃
 * 不会留下 succeeded run 无账本。记账异常仍被吞掉（不影响生成结果）。
 */

import { createDbClient } from "../../../backend/src/db/client.js";
import type { RunConfigurationSnapshotRecord } from "../../../backend/src/db/client.js";
import { createBillingInteractionLogWriter } from "../../../backend/src/modules/generation-cost/llm-billing-writer.js";
import { applyProviderModelCatalogSeed } from "../../../backend/src/modules/generation-cost/provider-model-catalog.repository.js";
import { buildPricingCatalogSeed } from "../../../backend/src/modules/generation-cost/pricing-catalog.seed.js";

function makeSnapshot(): RunConfigurationSnapshotRecord {
  const now = new Date();
  return {
    id: "snap_billing_001",
    projectId: "project_billing_001",
    userId: "user_billing_001",
    stage: "script",
    operation: "script.generate",
    runId: "run_001",
    projectConfigurationRevision: 1,
    schemaVersion: "resolved_generation_configuration_v1",
    configurationHash: "fnv1a64:test",
    resolvedConfigurationJson: {
      resolved_capabilities: {
        "llm.smart": { provider_key: "stub", model_id: "stub-model" },
        "llm.flash": { provider_key: "stub", model_id: "stub-model" },
      },
    },
    resolutionTraceJson: [],
    quoteId: "quote_billing_001",
    quoteFingerprint: "sha256:test",
    estimatedCostMicros: "10000000",
    authorizationCostMicros: "12000000",
    budgetLimitMicros: null,
    budgetOverrideAuthorized: false,
    pricingHash: "sha256:pricing",
    pricingVersionSetJson: [],
    createdAt: now,
    updatedAt: now,
  };
}

function makeEntry() {
  return {
    generatedAt: new Date().toISOString(),
    provider: "stub",
    model: "stub-model",
    operationName: "script.writer",
    promptId: "script.writer",
    promptStage: "writer",
    promptLanguage: "zh-CN",
    promptFilePath: "prompts/script/writer.md",
    promptSha256: "sha256:test",
    promptVersion: "1",
    systemPrompt: "test prompt",
    input: {},
    rawOutput: "{\"ok\":true}",
    responseMetadata: { promptTokens: 1200, completionTokens: 800, finishReason: "stop" },
  };
}

async function setup() {
  const db = createDbClient();
  await applyProviderModelCatalogSeed(
    db,
    buildPricingCatalogSeed({ llm: { mode: "stub" }, media: { deploymentScope: "cn-beijing" } }),
  );
  const snapshot = makeSnapshot();
  db.runConfigurationSnapshots.set(snapshot.id, snapshot);
  const saveUsageCostRecord = vi.fn();
  const appendGenerationRunEvent = vi.fn();
  db.thirdAggregateWriter = { saveUsageCostRecord, appendGenerationRunEvent } as never;
  const inner = { write: vi.fn() };
  const writer = createBillingInteractionLogWriter({
    billing: {
      db,
      snapshot,
      runId: "run_001",
      operation: "script.generate",
      resolved: snapshot.resolvedConfigurationJson as never,
    },
    inner,
  });
  return { db, snapshot, saveUsageCostRecord, appendGenerationRunEvent, inner, writer };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("billing writer 记账结算时序（外部审查 P1-3 整改）", () => {
  it("账本写入延迟时 write() 必须等待落库完成才 resolve", async () => {
    const { writer, saveUsageCostRecord, inner } = await setup();
    let resolveSave!: (value: unknown) => void;
    saveUsageCostRecord.mockReturnValue(
      new Promise((resolve) => {
        resolveSave = resolve;
      }),
    );

    const writePromise = writer.write(makeEntry() as never);
    let settled = false;
    void writePromise.then(() => {
      settled = true;
    });
    await flushMicrotasks();

    // 红灯语义：账本尚未落库，write() 不得提前 resolve
    expect(settled).toBe(false);

    resolveSave(null);
    await writePromise;
    expect(settled).toBe(true);
    expect(saveUsageCostRecord).toHaveBeenCalledTimes(1);
    expect(inner.write).toHaveBeenCalledTimes(1);
  });

  it("记账失败时 write() 仍 resolve，但 usage_recording_failed 审计已持久化", async () => {
    const { writer, db, saveUsageCostRecord, appendGenerationRunEvent } = await setup();
    saveUsageCostRecord.mockRejectedValue(new Error("db down"));
    let resolveAppend!: (value: unknown) => void;
    appendGenerationRunEvent.mockReturnValue(
      new Promise((resolve) => {
        resolveAppend = resolve;
      }),
    );

    const writePromise = writer.write(makeEntry() as never);
    let settled = false;
    void writePromise.then(() => {
      settled = true;
    });
    await flushMicrotasks();

    // 红灯语义：审计尚未落库，write() 不得提前 resolve
    expect(settled).toBe(false);

    resolveAppend(null);
    await writePromise;
    expect(settled).toBe(true);
    expect(appendGenerationRunEvent).toHaveBeenCalledTimes(1);
    const event = appendGenerationRunEvent.mock.calls[0]![0] as {
      eventType: string;
      eventJson: Record<string, unknown>;
    };
    expect(event.eventType).toBe("usage_recording_failed");
    expect(event.eventJson.interaction_id).toMatch(/^run_001:script\.writer:0$/);
    // 内存镜像同样留痕
    expect(db.generationRunEvents.get("run_001")).toHaveLength(1);
  });

  it("成功路径：write() resolve 时账本已落库且 interactionId 可反查", async () => {
    const { writer, saveUsageCostRecord, db } = await setup();
    await writer.write(makeEntry() as never);
    expect(saveUsageCostRecord).toHaveBeenCalledTimes(1);
    expect(db.usageCostRecords.size).toBe(1);
    const usage = [...db.usageCostRecords.values()][0]!;
    expect(usage.interactionId).toMatch(/^run_001:script\.writer:0$/);
    expect(usage.capability).toBe("llm.smart");
    expect(usage.costBasis).toBe("provider_usage");
  });
});
